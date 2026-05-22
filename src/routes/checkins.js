import { Router } from 'express';
import { requireAuth } from '../auth.js';
import {
  getCheckins,
  createCheckin,
  updateCheckin,
  deleteCheckin,
  getCheckinRaw,
} from '../supabase/queries.js';

const router = Router();

const empIdOf = (req) => req.user.empId || req.user.sub;

router.get('/', requireAuth, async (req, res) => {
  try {
    const rows = await getCheckins(
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
    const result = await createCheckin(req.body || {}, empIdOf(req));
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const att = await getCheckinRaw(req.params.id);
    if (!att) return res.status(404).json({ error: 'not found' });

    const isOwner = att.employee_id === empIdOf(req) || att.employee_id === req.user.sub;
    if (req.user.role !== 'admin' && !isOwner) return res.status(403).json({ error: 'forbidden' });

    const result = await updateCheckin(req.params.id, req.body || {});
    if (!result) return res.status(404).json({ error: 'not found' });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    // Verify ownership before deleting
    const { db: supabase } = await import('../supabase/client.js');
    const { data: att } = await supabase().from('attendances').select('employee_id').eq('id', req.params.id).maybeSingle();
    if (!att) return res.status(404).json({ error: 'not found' });
    if (req.user.role !== 'admin' && att.employee_id !== empIdOf(req)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    await deleteCheckin(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
