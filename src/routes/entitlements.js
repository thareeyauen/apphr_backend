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
function buildEntitlements(user, row) {
  const overrides = parseJson(row?.entitlements_json, {});
  const tenureYears = computeTenureYears(user?.start_date);
  const out = {};
  for (const t of LEAVE_TYPES) {
    if (Object.prototype.hasOwnProperty.call(overrides, t.id)) {
      out[t.id] = overrides[t.id];
      continue;
    }
    if (t.id === 'annual') {
      out[t.id] = row?.annual ?? annualQuotaForTenure(tenureYears);
      continue;
    }
    if (t.id === 'sick' && row?.sick != null) { out[t.id] = row.sick; continue; }
    if (t.id === 'personal' && row?.personal != null) { out[t.id] = row.personal; continue; }
    if (t.id === 'maternity' && row?.maternity != null) { out[t.id] = row.maternity; continue; }
    out[t.id] = t.quota ?? 0;
  }
  return out;
}

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

router.put('/:userId', requireAuth, requireAdmin, (req, res) => {
  const body = req.body || {};
  const knownIds = new Set(LEAVE_TYPES.map((t) => t.id));
  const overrides = {};
  for (const [k, v] of Object.entries(body)) {
    if (!knownIds.has(k)) continue;
    const n = Number(v);
    if (Number.isFinite(n)) overrides[k] = n;
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
