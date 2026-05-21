import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import {
  LEAVE_TYPES,
  LEAVE_TYPES_BY_ID,
  computeTenureYears,
  annualQuotaForTenure,
} from '../leaveTypes.js';

const router = Router();

const parseJson = (s, fallback) => {
  try { return JSON.parse(s || ''); } catch { return fallback; }
};

// Build the canonical per-type quota map for a user.
// Order of precedence: explicit override in entitlements_json → legacy columns → default from LEAVE_TYPES.
//
// Annual leave is special: tier_based(tenure) + carryOver (max 20). Carryover survives
// year-end while other leave types reset implicitly (used-days filter by calendar year).
// An explicit "annual" key in overrides still takes precedence (full override).
export function buildEntitlements(user, row) {
  const overrides = parseJson(row?.entitlements_json, {});
  const tenureYears = computeTenureYears(user?.start_date);
  const annualBase = annualQuotaForTenure(tenureYears);
  const rawCarry = Number(overrides._annualCarryOver);
  const annualCarryOver = Number.isFinite(rawCarry) ? Math.max(0, Math.min(20, rawCarry)) : 0;
  const out = {};
  for (const t of LEAVE_TYPES) {
    // Annual is always derived from tier + carryOver — explicit annual overrides
    // in legacy data are ignored so the system stays consistent with the rule
    // "annual resets to tier_based each year, plus carryover from last year".
    if (t.id === 'annual') {
      out[t.id] = annualBase + annualCarryOver;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(overrides, t.id)) {
      out[t.id] = overrides[t.id];
      continue;
    }
    if (t.id === 'sick' && row?.sick != null) { out[t.id] = row.sick; continue; }
    if (t.id === 'personal' && row?.personal != null) { out[t.id] = row.personal; continue; }
    if (t.id === 'maternity' && row?.maternity != null) { out[t.id] = row.maternity; continue; }
    out[t.id] = t.quota ?? 0;
  }
  out._annualBase = annualBase;
  out._annualCarryOver = annualCarryOver;
  return out;
}

// Catalog of all known leave types (definition shared with the user app).
// Returned to admin UI so it can render the full set instead of a hardcoded subset.
router.get('/types', requireAuth, (_req, res) => {
  res.json(LEAVE_TYPES.map((t) => ({
    id: t.id,
    label: t.label,
    labelTh: t.labelTh,
    quota: t.quota,
    quotaByTenureYears: t.quotaByTenureYears || null,
    minTenureYears: t.minTenureYears || 0,
    advanceDays: t.advanceDays || 0,
    backdateDays: t.backdateDays || 0,
  })));
});

router.get('/', requireAuth, (_req, res) => {
  const rows = db.prepare('SELECT * FROM entitlements').all();
  const users = db.prepare('SELECT id, start_date FROM users').all();
  const userById = Object.fromEntries(users.map((u) => [u.id, u]));
  const map = {};
  for (const r of rows) {
    map[r.user_id] = buildEntitlements(userById[r.user_id], r);
  }
  res.json(map);
});

router.get('/:userId', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM entitlements WHERE user_id = ?').get(req.params.userId);
  const user = db.prepare('SELECT id, start_date FROM users WHERE id = ?').get(req.params.userId);
  res.json(buildEntitlements(user, row || {}));
});

// Year-end carry snapshot: for every employee, set _annualCarryOver to
// min(remaining_annual_this_year, 20). Run by admin at end of calendar year
// before the new year begins (or shortly after). Excess days beyond the 20-day
// cap are reported in the response so HR can settle them in cash separately.
router.post('/snapshot-carry', requireAuth, requireAdmin, (req, res) => {
  const yearPrefix = String(req.body?.year || new Date().getFullYear());
  const employees = db.prepare("SELECT * FROM users WHERE role = 'employee'").all();
  const usedStmt = db.prepare(`
    SELECT days, start_date_key FROM requests
    WHERE owner_id = ? AND type = ? AND status IN ('approved', 'pending')
  `);
  const upsertStmt = db.prepare(`
    INSERT INTO entitlements (user_id, annual, sick, personal, maternity, entitlements_json)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      entitlements_json = excluded.entitlements_json,
      updated_at = datetime('now')
  `);

  const summary = [];
  const tx = db.transaction(() => {
    for (const user of employees) {
      const row = db.prepare('SELECT * FROM entitlements WHERE user_id = ?').get(user.id);
      const ent = buildEntitlements(user, row || {});
      const quota = Number(ent.annual) || 0;
      const previousCarry = Number(ent._annualCarryOver) || 0;

      const usedRows = usedStmt.all(user.id, 'Annual Leave');
      const used = usedRows
        .filter((r) => (r.start_date_key || '').startsWith(yearPrefix))
        .reduce((s, r) => s + (Number(r.days) || 0), 0);
      const remaining = Math.max(quota - used, 0);
      const newCarry = Math.min(remaining, 20);
      const excess = Math.max(remaining - 20, 0);

      const overrides = row?.entitlements_json ? parseJson(row.entitlements_json, {}) : {};
      overrides._annualCarryOver = newCarry;

      // Insert path needs default values; ON CONFLICT only mutates entitlements_json
      // so existing legacy columns are preserved for users who already had a row.
      const annualCol = row?.annual ?? LEAVE_TYPES_BY_ID.annual?.quota ?? 7;
      const sickCol = row?.sick ?? LEAVE_TYPES_BY_ID.sick.quota;
      const personalCol = row?.personal ?? LEAVE_TYPES_BY_ID.personal.quota;
      const maternityCol = row?.maternity ?? LEAVE_TYPES_BY_ID.maternity.quota;
      upsertStmt.run(user.id, annualCol, sickCol, personalCol, maternityCol, JSON.stringify(overrides));

      summary.push({
        userId: user.id,
        employeeId: user.employee_id,
        nameTh: user.name_th,
        quota, used, remaining, previousCarry, newCarry, excess,
      });
    }
  });
  tx();
  res.json({ year: yearPrefix, count: summary.length, summary });
});

router.put('/:userId', requireAuth, requireAdmin, (req, res) => {
  const body = req.body || {};
  const knownIds = new Set(LEAVE_TYPES.map((t) => t.id));
  const overrides = {};
  for (const [k, v] of Object.entries(body)) {
    if (!knownIds.has(k)) continue;
    const n = Number(v);
    if (Number.isFinite(n)) overrides[k] = n;
  }
  // Carryover field is not a LEAVE_TYPE id; capture it from either casing and clamp 0..20.
  const carryRaw = Number(body.annualCarryOver ?? body._annualCarryOver);
  if (Number.isFinite(carryRaw)) {
    overrides._annualCarryOver = Math.max(0, Math.min(20, carryRaw));
  }
  const annual = overrides.annual ?? LEAVE_TYPES_BY_ID.annual?.quota ?? 7;
  const sick = overrides.sick ?? LEAVE_TYPES_BY_ID.sick.quota;
  const personal = overrides.personal ?? LEAVE_TYPES_BY_ID.personal.quota;
  const maternity = overrides.maternity ?? LEAVE_TYPES_BY_ID.maternity.quota;
  db.prepare(`
    INSERT INTO entitlements (user_id, annual, sick, personal, maternity, entitlements_json)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      annual = excluded.annual,
      sick = excluded.sick,
      personal = excluded.personal,
      maternity = excluded.maternity,
      entitlements_json = excluded.entitlements_json,
      updated_at = datetime('now')
  `).run(req.params.userId, annual, sick, personal, maternity, JSON.stringify(overrides));
  const row = db.prepare('SELECT * FROM entitlements WHERE user_id = ?').get(req.params.userId);
  const user = db.prepare('SELECT id, start_date FROM users WHERE id = ?').get(req.params.userId);
  res.json(buildEntitlements(user, row));
});

export default router;
