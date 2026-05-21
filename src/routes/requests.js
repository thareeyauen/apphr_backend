import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import {
  findLeaveType,
  parseFlexibleDate,
  daysBetween,
  computeTenureYears,
  LEAVE_TYPES,
} from '../leaveTypes.js';
import { buildEntitlements } from './entitlements.js';

// Resolve the effective quota for a user/leave-type — honours admin overrides
// and annual carryover stored in entitlements_json. Keeps validation in sync
// with what admin sets and what apphr displays.
function effectiveQuota(owner, leaveCfg) {
  const row = db.prepare('SELECT * FROM entitlements WHERE user_id = ?').get(owner.id);
  const merged = buildEntitlements(owner, row || {});
  return Number(merged[leaveCfg.id]) || 0;
}

const LEAVE_LABELS = LEAVE_TYPES.map((t) => t.label);

const router = Router();

const parseRow = (r) => r && ({
  id: r.id,
  ownerKey: r.owner_key,
  ownerId: r.owner_id,
  ownerName: r.owner_name,
  employeeId: r.owner_key,
  userId: r.owner_id,
  userName: r.owner_name,
  type: r.type,
  detail: r.detail,
  status: r.status,
  date: r.date,
  dateKey: r.date_key,
  startDateKey: r.start_date_key,
  endDateKey: r.end_date_key,
  days: r.days,
  approver: r.approver,
  approverLevels: (() => { try { return JSON.parse(r.approver_levels_json || '[]'); } catch { return []; } })(),
  createdAt: r.created_at,
  ...((() => { try { return JSON.parse(r.payload_json || '{}'); } catch { return {}; } })()),
});

const todayStart = () => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
};

// Sum days already booked (approved + pending) for this user, this leave type, this year.
function usedDaysThisYear(userId, leaveLabel) {
  const yearPrefix = String(new Date().getFullYear());
  const rows = db.prepare(`
    SELECT days, start_date_key FROM requests
    WHERE owner_id = ? AND type = ? AND status IN ('approved', 'pending')
  `).all(userId, leaveLabel);
  return rows
    .filter((r) => (r.start_date_key || '').startsWith(yearPrefix))
    .reduce((sum, r) => sum + (Number(r.days) || 0), 0);
}

// Validate the leave-specific business rules. Returns null on success, or { error } on failure.
function validateLeaveRequest({ owner, leaveCfg, body }) {
  const today = todayStart();
  const start = parseFlexibleDate(body.startDateKey);
  const end = parseFlexibleDate(body.endDateKey) || start;
  if (!start) return { error: 'invalid start date' };
  if (end < start) return { error: 'end date must be on or after start date' };

  const days = Number(body.days);
  if (!Number.isFinite(days) || days <= 0) return { error: 'days must be > 0' };

  // Advance notice
  const leadDays = daysBetween(today, start);
  if (leaveCfg.advanceDays > 0 && leadDays < leaveCfg.advanceDays) {
    return { error: `${leaveCfg.labelTh}: ต้องขอล่วงหน้าอย่างน้อย ${leaveCfg.advanceDays} วัน` };
  }
  // Backdate window
  if (leadDays < 0) {
    const allowedBack = leaveCfg.backdateDays || 0;
    if (-leadDays > allowedBack) {
      return allowedBack > 0
        ? { error: `${leaveCfg.labelTh}: ลาย้อนหลังได้ไม่เกิน ${allowedBack} วัน` }
        : { error: `${leaveCfg.labelTh}: ไม่อนุญาตให้ลาย้อนหลัง` };
    }
  }

  // Annual leave: tenure ≥ 1 year
  if (leaveCfg.id === 'annual') {
    const tenureYears = computeTenureYears(owner.start_date);
    if (tenureYears < (leaveCfg.minTenureYears || 1)) {
      return { error: 'ลาพักร้อน: ใช้สิทธิได้เมื่ออายุงานครบ 1 ปี' };
    }
  }

  // Sick leave: 3+ consecutive days requires medical certificate attachment
  if (leaveCfg.id === 'sick' && leaveCfg.certificateAfterDays) {
    if (days >= leaveCfg.certificateAfterDays && !body.medicalCertificate) {
      return { error: 'ลาป่วยติดต่อกัน 3 วันขึ้นไป ต้องแนบหนังสือรับรองแพทย์' };
    }
  }

  // Compensation leave: must specify the holiday work date
  if (leaveCfg.requiresHolidayWorkDate && !body.holidayWorkDate) {
    return { error: 'ลาชดเชยทำงานวันหยุด: ต้องระบุวันที่ทำงานในวันหยุด' };
  }

  // Paternity: must use within N days from child birth date
  if (leaveCfg.requiresChildBirthDate) {
    const birth = parseFlexibleDate(body.childBirthDate);
    if (!birth) return { error: 'ลาคลอด (พนักงานชาย): ต้องระบุวันที่บุตรคลอด' };
    const sinceBirth = daysBetween(birth, start);
    if (sinceBirth < 0) {
      return { error: 'ลาคลอด (พนักงานชาย): วันเริ่มลาต้องไม่ก่อนวันที่บุตรคลอด' };
    }
    if (sinceBirth > leaveCfg.useWithinDaysFromChildBirth) {
      return { error: `ลาคลอด (พนักงานชาย): ต้องใช้สิทธิภายใน ${leaveCfg.useWithinDaysFromChildBirth} วันนับจากวันที่บุตรคลอด` };
    }
  }

  // Quota check — uses admin's overrides + annual carryover (same source as apphr UI)
  const quota = effectiveQuota(owner, leaveCfg);
  if (quota > 0) {
    const used = usedDaysThisYear(owner.id, leaveCfg.label);
    if (used + days > quota) {
      return { error: `${leaveCfg.labelTh}: เกินสิทธิ (คงเหลือ ${Math.max(quota - used, 0)} วัน)` };
    }
  }
  return null;
}

router.get('/', requireAuth, (req, res) => {
  let rows;
  if (req.user.role === 'admin' || req.query.all === '1') {
    rows = db.prepare('SELECT * FROM requests ORDER BY created_at DESC').all();
  } else if (req.query.scope === 'approver') {
    // Per-user approver model: I see a request if the requester's approver_user_ids_json
    // (set by admin) contains my user.id. Falls back to level-based + dept rule for
    // requesters who haven't been assigned an approver yet (admin still pending setup).
    const myId = req.user.sub;
    const me = db.prepare('SELECT department, employee_level FROM users WHERE id = ?').get(myId);
    const lvl = me?.employee_level || '';
    // Match: my id is inside the requester's approver_user_ids_json array.
    // SQLite json_each is the cleanest, but works on TEXT column without explicit cast.
    const idMarker = `%"${myId}"%`;
    if (lvl === 'Board Level' || lvl === 'Director Level') {
      // Eligible approver levels — see assigned requests, plus legacy level-based for
      // requesters with no per-user approver set yet (empty or null array).
      rows = db.prepare(`
        SELECT r.* FROM requests r
        LEFT JOIN users u ON u.id = r.owner_id
        WHERE r.owner_id = ?
           OR u.approver_user_ids_json LIKE ?
           OR (
             (u.approver_user_ids_json IS NULL OR u.approver_user_ids_json = '[]' OR u.approver_user_ids_json = '')
             AND r.approver_levels_json LIKE ?
           )
        ORDER BY r.created_at DESC
      `).all(myId, idMarker, `%"${lvl}"%`);
    } else if (me?.department) {
      const placeholders = LEAVE_LABELS.map(() => '?').join(',');
      rows = db.prepare(`
        SELECT r.* FROM requests r
        LEFT JOIN users u ON u.id = r.owner_id
        WHERE r.owner_id = ?
           OR (r.status = 'approved' AND u.department = ? AND r.type IN (${placeholders}))
        ORDER BY r.created_at DESC
      `).all(myId, me.department, ...LEAVE_LABELS);
    } else {
      rows = db.prepare('SELECT * FROM requests WHERE owner_id = ? ORDER BY created_at DESC').all(myId);
    }
  } else {
    rows = db.prepare('SELECT * FROM requests WHERE owner_id = ? ORDER BY created_at DESC').all(req.user.sub);
  }
  res.json(rows.map(parseRow));
});

router.post('/', requireAuth, (req, res) => {
  const b = req.body || {};
  // Admin can create a request on behalf of another employee by passing ownerId.
  // For non-admin callers this is ignored — request always belongs to the caller.
  const ownerId = (req.user.role === 'admin' && b.ownerId) ? b.ownerId : req.user.sub;
  const owner = db.prepare('SELECT * FROM users WHERE id = ?').get(ownerId);
  if (!owner) return res.status(404).json({ error: 'owner missing' });

  // Admin bypasses leave-specific validation — per requirement they can create
  // any type for any employee without quota / advance / backdate checks.
  if (req.user.role !== 'admin') {
    const leaveCfg = findLeaveType(b.type);
    if (leaveCfg) {
      const err = validateLeaveRequest({ owner, leaveCfg, body: b });
      if (err) return res.status(400).json(err);
    }
  }

  const id = b.id || `REQ-${String(Date.now()).slice(-6)}`;
  const payload = { ...b };
  ['id','type','detail','status','date','dateKey','startDateKey','endDateKey','days','approver','approverLevels','ownerKey','ownerId','ownerName','employeeId','userId','userName','email'].forEach((k) => delete payload[k]);

  // Resolve the approver display text: prefer admin-assigned names from
  // owner.approver_user_ids_json, fall back to the level-based string supplied
  // by the client, and finally to 'แอดมิน' if nothing is assigned.
  let approverText = b.approver || '';
  try {
    const ownerApproverIds = JSON.parse(owner.approver_user_ids_json || '[]');
    if (Array.isArray(ownerApproverIds) && ownerApproverIds.length > 0) {
      const placeholders = ownerApproverIds.map(() => '?').join(',');
      const approverRows = db.prepare(`SELECT name_th FROM users WHERE id IN (${placeholders})`).all(...ownerApproverIds);
      if (approverRows.length > 0) {
        approverText = approverRows.map((r) => r.name_th).filter(Boolean).join(' / ');
      }
    }
  } catch { /* keep fallback */ }
  if (!approverText) approverText = 'แอดมิน';

  db.prepare(`
    INSERT INTO requests (id, owner_id, owner_key, owner_name, type, detail, status,
      date, date_key, start_date_key, end_date_key, days, approver, approver_levels_json, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, owner.id, owner.employee_id, owner.name_th,
    b.type || '', b.detail || '', b.status || 'pending',
    b.date || '', b.dateKey || '', b.startDateKey || '', b.endDateKey || '',
    b.days ?? null, approverText, JSON.stringify(b.approverLevels || []),
    JSON.stringify(payload)
  );
  res.status(201).json(parseRow(db.prepare('SELECT * FROM requests WHERE id = ?').get(id)));
});

router.patch('/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  const me = db.prepare('SELECT employee_level FROM users WHERE id = ?').get(req.user.sub);
  const lvl = me?.employee_level || '';
  const approverLevels = (() => { try { return JSON.parse(row.approver_levels_json || '[]'); } catch { return []; } })();
  const isOwner = row.owner_id === req.user.sub;
  // Per-user approver authorization (set by admin via Approvals page)
  const owner = db.prepare('SELECT approver_user_ids_json FROM users WHERE id = ?').get(row.owner_id);
  const ownerApproverIds = (() => { try { return JSON.parse(owner?.approver_user_ids_json || '[]'); } catch { return []; } })();
  const hasPerUserApprovers = ownerApproverIds.length > 0;
  const isAssignedApprover = hasPerUserApprovers
    ? ownerApproverIds.includes(req.user.sub)
    : approverLevels.includes(lvl);  // legacy fallback for unassigned users
  if (req.user.role !== 'admin' && !isOwner && !isAssignedApprover) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const status = req.body?.status;
  if (status && !['pending','approved','rejected'].includes(status)) {
    return res.status(400).json({ error: 'bad status' });
  }
  if (status && (status === 'approved' || status === 'rejected') && isOwner && !isAssignedApprover && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'cannot self-approve' });
  }

  const updates = {};
  // Status — allowed for admin / assigned approver (already authorized above)
  if (status) updates.status = status;

  // Full edit — admin-only. Used to fix typos, adjust days, change dates etc.
  // The system tracks `used` days dynamically from existing requests, so any
  // change here automatically reflects in entitlement balances on next fetch.
  if (req.user.role === 'admin') {
    const b = req.body || {};
    if (b.type !== undefined) updates.type = b.type;
    if (b.detail !== undefined) updates.detail = b.detail;
    if (b.startDateKey !== undefined) updates.start_date_key = b.startDateKey;
    if (b.endDateKey !== undefined) updates.end_date_key = b.endDateKey;
    if (b.dateKey !== undefined) updates.date_key = b.dateKey;
    if (b.date !== undefined) updates.date = b.date;
    if (b.days !== undefined) {
      const n = Number(b.days);
      if (Number.isFinite(n) && n >= 0) updates.days = n;
    }
  }

  if (Object.keys(updates).length > 0) {
    const cols = Object.keys(updates);
    const setSql = cols.map((c) => `${c} = @${c}`).join(', ');
    db.prepare(`UPDATE requests SET ${setSql}, updated_at = datetime('now') WHERE id = @id`)
      .run({ ...updates, id: req.params.id });
  }

  res.json(parseRow(db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id)));
});

router.delete('/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (req.user.role !== 'admin' && row.owner_id !== req.user.sub) return res.status(403).json({ error: 'forbidden' });
  db.prepare('DELETE FROM requests WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
