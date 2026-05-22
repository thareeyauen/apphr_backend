import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { requireAuth, requireAdmin } from '../auth.js';
import {
  getUserById,
  getUserByEmployeeId,
  getUserPasswordHash,
  getAllEmployees,
  getAllEmployeeIds,
  createUser,
  updateUserProfile,
  updateUserApprovers,
  updateUserPassword,
  deleteUser,
} from '../supabase/queries.js';

const router = Router();

// Helper: empId from JWT (falls back to sub for backward compat)
const empIdOf = (req) => req.user.empId || req.user.sub;

router.get('/', requireAuth, async (req, res) => {
  try {
    res.json(await getAllEmployees());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/all-ids', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await getAllEmployeeIds());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const profile = await getUserByEmployeeId(req.params.id);
    if (!profile) return res.status(404).json({ error: 'not found' });
    if (req.user.role !== 'admin' && req.user.sub !== profile.id) return res.status(403).json({ error: 'forbidden' });
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', requireAuth, async (req, res) => {
  console.log('[PATCH /users] id:', req.params.id, 'body keys:', Object.keys(req.body || {}));
  try {
    const profile = await getUserByEmployeeId(req.params.id);
    if (!profile) return res.status(404).json({ error: 'not found' });
    if (req.user.role !== 'admin' && req.user.sub !== profile.id) return res.status(403).json({ error: 'forbidden' });

    const userId = profile.id;
    const empId  = profile.employeeId;

    // Approver mapping — admin only
    if (Array.isArray(req.body?.approverUserIds)) {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin only' });
      const ids = req.body.approverUserIds
        .map(v => (v == null ? '' : String(v).trim()))
        .filter(Boolean)
        .slice(0, 2);
      await updateUserApprovers(empId, ids);
    }

    await updateUserProfile(userId, empId, req.body || {});

    res.json(await getUserById(userId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const body     = req.body || {};
    const password = body.password || `${(body.employeeId || '').toUpperCase()}@123`;
    const hash     = bcrypt.hashSync(password, 10);
    const profile  = await createUser({ ...body, passwordHash: hash });
    res.status(201).json(profile);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id/password', requireAuth, async (req, res) => {
  try {
    const profile = await getUserByEmployeeId(req.params.id);
    if (!profile) return res.status(404).json({ error: 'not found' });
    if (req.user.role !== 'admin' && req.user.sub !== profile.id) return res.status(403).json({ error: 'forbidden' });

    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || typeof newPassword !== 'string') return res.status(400).json({ error: 'newPassword required' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'newPassword must be at least 8 characters' });

    const skipVerify = req.user.role === 'admin' && req.user.sub !== profile.id;
    if (!skipVerify) {
      if (!currentPassword || typeof currentPassword !== 'string') return res.status(400).json({ error: 'currentPassword required' });
      const storedHash = await getUserPasswordHash(profile.id);
      if (!storedHash || !bcrypt.compareSync(currentPassword, storedHash)) {
        return res.status(401).json({ error: 'currentPassword incorrect' });
      }
    }

    await updateUserPassword(profile.id, bcrypt.hashSync(newPassword, 10));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const profile = await getUserByEmployeeId(req.params.id);
    if (!profile) return res.status(404).json({ error: 'not found' });
    await deleteUser(profile.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
