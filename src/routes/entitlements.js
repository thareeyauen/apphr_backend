import { Router } from 'express';
import { requireAuth, requireAdmin } from '../auth.js';
import { LEAVE_TYPES } from '../leaveTypes.js';
import {
  getEntitlementForEmployee,
  getAllEntitlements,
  updateEntitlement,
  snapshotAnnualCarry,
  fetchUserData,
} from '../supabase/queries.js';

const router = Router();

router.get('/types', requireAuth, (_req, res) => {
  res.json(LEAVE_TYPES.map((t) => ({
    id:                 t.id,
    label:              t.label,
    labelTh:            t.labelTh,
    quota:              t.quota,
    quotaByTenureYears: t.quotaByTenureYears || null,
    minTenureYears:     t.minTenureYears || 0,
    advanceDays:        t.advanceDays || 0,
    backdateDays:       t.backdateDays || 0,
    countCalendarDays:  Boolean(t.countCalendarDays),
    requiresHolidayWorkDate:      Boolean(t.requiresHolidayWorkDate),
    requiresSupervisorPreApproval: Boolean(t.requiresSupervisorPreApproval),
    requiresChildBirthDate:       Boolean(t.requiresChildBirthDate),
    useWithinDaysFromChildBirth:  t.useWithinDaysFromChildBirth || 0,
    certificateAfterDays:         t.certificateAfterDays || 0,
  })));
});

router.get('/', requireAuth, async (_req, res) => {
  try {
    res.json(await getAllEntitlements());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:userId', requireAuth, async (req, res) => {
  try {
    const data = await fetchUserData(req.params.userId);
    if (!data) return res.status(404).json({ error: 'not found' });
    const startDate = data.employment?.start_date || null;
    res.json(await getEntitlementForEmployee(data.emp.id, startDate));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/snapshot-carry', requireAuth, requireAdmin, async (req, res) => {
  try {
    const yearPrefix = String(req.body?.year || new Date().getFullYear());
    const summary = await snapshotAnnualCarry(yearPrefix);
    res.json({ year: yearPrefix, count: summary.length, summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:userId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const data = await fetchUserData(req.params.userId);
    if (!data) return res.status(404).json({ error: 'not found' });
    await updateEntitlement(data.emp.id, req.body || {});
    const startDate = data.employment?.start_date || null;
    res.json(await getEntitlementForEmployee(data.emp.id, startDate));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
