import { Router } from 'express';
import { requireAuth, requireAdmin } from '../auth.js';
import {
  findLeaveType,
  parseFlexibleDate,
  daysBetween,
  computeTenureYears,
  LEAVE_TYPES,
} from '../leaveTypes.js';
import {
  getRequests,
  getDeletedRequests,
  getRequestById,
  getRequestRaw,
  createLeaveRequest,
  updateRequest,
  deleteRequest,
  getEntitlementForEmployee,
  getOwnerApproverUserIds,
  usedDaysThisYear,
  getUserByEmployeeId,
  fetchUserData,
  getAttendanceExceptionRequestRaw,
  createAttendanceExceptionRequest,
  updateAttendanceExceptionRequest,
  deleteAttendanceExceptionRequest,
  getDocumentRequestRaw,
  createDocumentRequest,
  updateDocumentRequest,
  deleteDocumentRequest,
} from '../supabase/queries.js';

const router = Router();

const empIdOf = (req) => req.user.empId || req.user.sub;

// ─── Helpers (same logic as before, now async) ────────────────────────────────

async function effectiveQuota(empId, startDate, leaveCfg) {
  const ent = await getEntitlementForEmployee(empId, startDate);
  return Number(ent[leaveCfg.id]) || 0;
}

const todayStart = () => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
};

async function validateLeaveRequest({ owner, leaveCfg, body }) {
  const today = todayStart();
  const start = parseFlexibleDate(body.startDateKey);
  const end   = parseFlexibleDate(body.endDateKey) || start;
  if (!start) return { error: 'invalid start date' };
  if (end < start) return { error: 'end date must be on or after start date' };

  const days = Number(body.days);
  if (!Number.isFinite(days) || days <= 0) return { error: 'days must be > 0' };

  const leadDays = daysBetween(today, start);
  if (leaveCfg.advanceDays > 0 && leadDays < leaveCfg.advanceDays) {
    return { error: `${leaveCfg.labelTh}: ต้องขอล่วงหน้าอย่างน้อย ${leaveCfg.advanceDays} วัน` };
  }
  if (leadDays < 0) {
    const allowedBack = leaveCfg.backdateDays || 0;
    if (-leadDays > allowedBack) {
      return allowedBack > 0
        ? { error: `${leaveCfg.labelTh}: ลาย้อนหลังได้ไม่เกิน ${allowedBack} วัน` }
        : { error: `${leaveCfg.labelTh}: ไม่อนุญาตให้ลาย้อนหลัง` };
    }
  }

  if (leaveCfg.id === 'annual') {
    const tenureYears = computeTenureYears(owner.start_date);
    if (tenureYears < (leaveCfg.minTenureYears || 1)) {
      return { error: 'ลาพักร้อน: ใช้สิทธิได้เมื่ออายุงานครบ 1 ปี' };
    }
  }
  if (leaveCfg.id === 'sick' && leaveCfg.certificateAfterDays) {
    if (days >= leaveCfg.certificateAfterDays && !body.medicalCertificate) {
      return { error: 'ลาป่วยติดต่อกัน 3 วันขึ้นไป ต้องแนบหนังสือรับรองแพทย์' };
    }
  }
  if (leaveCfg.requiresHolidayWorkDate && !body.holidayWorkDate) {
    return { error: 'ลาชดเชยทำงานวันหยุด: ต้องระบุวันที่ทำงานในวันหยุด' };
  }
  if (leaveCfg.requiresChildBirthDate) {
    const birth = parseFlexibleDate(body.childBirthDate);
    if (!birth) return { error: 'ลาคลอด (พนักงานชาย): ต้องระบุวันที่บุตรคลอด' };
    const sinceBirth = daysBetween(birth, start);
    if (sinceBirth < 0) return { error: 'ลาคลอด (พนักงานชาย): วันเริ่มลาต้องไม่ก่อนวันที่บุตรคลอด' };
    if (sinceBirth > leaveCfg.useWithinDaysFromChildBirth) {
      return { error: `ลาคลอด (พนักงานชาย): ต้องใช้สิทธิภายใน ${leaveCfg.useWithinDaysFromChildBirth} วันนับจากวันที่บุตรคลอด` };
    }
  }

  const quota = await effectiveQuota(owner.empId, owner.start_date, leaveCfg);
  if (quota > 0) {
    const yearPrefix = String(new Date().getFullYear());
    const used = await usedDaysThisYear(owner.empId, leaveCfg.label, yearPrefix);
    if (used + days > quota) {
      return { error: `${leaveCfg.labelTh}: เกินสิทธิ (คงเหลือ ${Math.max(quota - used, 0)} วัน)` };
    }
  }
  return null;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get('/deleted', requireAuth, requireAdmin, async (req, res) => {
  try {
    const rows = await getDeletedRequests();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const rows = await getRequests(
      { scope: req.query.scope, all: req.query.all },
      req.user.sub,
      empIdOf(req),
      req.user.role,
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const b = req.body || {};

    // Resolve owning employee
    const ownerId = (req.user.role === 'admin' && b.ownerId) ? b.ownerId : req.user.sub;
    const ownerData = await fetchUserData(ownerId);
    if (!ownerData) return res.status(404).json({ error: 'owner missing' });

    const owner = {
      empId:      ownerData.emp.id,
      start_date: ownerData.employment?.start_date || null,
    };

    // Dispatch by request type
    if (b.type === 'Work Outside') {
      const result = await createAttendanceExceptionRequest(b, owner.empId);
      return res.status(201).json(result);
    }
    if (b.type === 'Request Documents') {
      const result = await createDocumentRequest(b, owner.empId);
      return res.status(201).json(result);
    }

    // Leave: validate leave-specific rules (employee only)
    if (req.user.role !== 'admin') {
      const leaveCfg = findLeaveType(b.type);
      if (leaveCfg) {
        const err = await validateLeaveRequest({ owner, leaveCfg, body: b });
        if (err) return res.status(400).json(err);
      }
    }

    // Resolve approver display name from approver_mappings
    const approverUserIds = await getOwnerApproverUserIds(owner.empId);
    let approverDisplay = b.approver || '';
    if (approverUserIds.length) {
      const profiles = await Promise.all(approverUserIds.map(uid => fetchUserData(uid)));
      const names = profiles
        .filter(Boolean)
        .map(d => [d.emp.first_name_th, d.emp.last_name_th].filter(Boolean).join(' '))
        .filter(Boolean);
      if (names.length) approverDisplay = names.join(' / ');
    }
    if (!approverDisplay) approverDisplay = 'แอดมิน';

    const result = await createLeaveRequest(b, owner.empId, approverDisplay);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Locate a request across the 3 tables; return { raw, kind, updater, deleter }
async function locateRequest(reqId) {
  const leave = await getRequestRaw(reqId);
  if (leave) return { raw: leave, kind: 'leave', updater: updateRequest, deleter: deleteRequest };
  const aer = await getAttendanceExceptionRequestRaw(reqId);
  if (aer) return { raw: aer, kind: 'attendance_exception', updater: updateAttendanceExceptionRequest, deleter: deleteAttendanceExceptionRequest };
  const doc = await getDocumentRequestRaw(reqId);
  if (doc) return { raw: doc, kind: 'document', updater: updateDocumentRequest, deleter: deleteDocumentRequest };
  return null;
}

router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const found = await locateRequest(req.params.id);
    if (!found) return res.status(404).json({ error: 'not found' });
    const { raw, kind, updater } = found;

    const myEmpId = empIdOf(req);
    const isOwner = raw.employee_id === myEmpId;

    // Document requests are admin-only to approve/reject (Board/Director cannot review them).
    // Owners may still PATCH their own pending document (e.g. for future cancel-by-status flow),
    // but cannot self-approve.
    if (kind === 'document') {
      if (req.user.role !== 'admin' && !isOwner) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const status = req.body?.status;
      if (status && !['pending', 'approved', 'rejected'].includes(status)) {
        return res.status(400).json({ error: 'bad status' });
      }
      if (status && (status === 'approved' || status === 'rejected') && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'document requests can only be approved by admin' });
      }
      const updates = {};
      if (status) updates.status = status;
      const result = await updater(req.params.id, updates, myEmpId);
      return res.json(result);
    }

    const approverUserIds   = await getOwnerApproverUserIds(raw.employee_id);
    const hasPerUserApprovers = approverUserIds.length > 0;
    const isAssignedApprover  = hasPerUserApprovers
      ? approverUserIds.includes(req.user.sub)
      : false;

    if (req.user.role !== 'admin' && !isOwner && !isAssignedApprover) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const status = req.body?.status;
    if (status && !['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'bad status' });
    }
    if (status && (status === 'approved' || status === 'rejected') && isOwner && !isAssignedApprover && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'cannot self-approve' });
    }

    const updates = {};
    if (status) updates.status = status;

    // Admin-only full edit (leave only — other kinds use status-only path)
    if (req.user.role === 'admin' && kind === 'leave') {
      const b = req.body || {};
      if (b.type       !== undefined) updates.type       = b.type;
      if (b.detail     !== undefined) updates.detail     = b.detail;
      if (b.startDateKey !== undefined) updates.startDateKey = b.startDateKey;
      if (b.endDateKey   !== undefined) updates.endDateKey   = b.endDateKey;
      if (b.dateKey      !== undefined) updates.dateKey      = b.dateKey;
      if (b.date         !== undefined) updates.date         = b.date;
      if (b.days !== undefined) {
        const n = Number(b.days);
        if (Number.isFinite(n) && n >= 0) updates.days = n;
      }
    }

    const result = await updater(req.params.id, updates, myEmpId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const found = await locateRequest(req.params.id);
    if (!found) return res.status(404).json({ error: 'not found' });
    if (req.user.role !== 'admin' && found.raw.employee_id !== empIdOf(req)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const isAdmin = req.user.role === 'admin';
    await found.deleter(req.params.id, isAdmin);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
