import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { requireAuth, requireAdmin } from '../auth.js';
import {
  getAllAdmins,
  createAdmin,
  deleteAdmin,
  getUserPasswordHash,
  updateUserPassword,
} from '../supabase/queries.js';

const router = Router();

router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await getAllAdmins());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const body     = req.body || {};
    const password = body.password || 'Admin@123';
    const hash     = bcrypt.hashSync(password, 10);
    const admin    = await createAdmin({ ...body, passwordHash: hash });
    res.status(201).json(admin);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id/password', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { newPassword, currentPassword } = req.body || {};
    if (!newPassword || typeof newPassword !== 'string')
      return res.status(400).json({ error: 'newPassword required' });
    if (newPassword.length < 8)
      return res.status(400).json({ error: 'newPassword must be at least 8 characters' });

    // Changing own password requires currentPassword verification
    if (req.user.sub === req.params.id) {
      if (!currentPassword)
        return res.status(400).json({ error: 'currentPassword required' });
      const storedHash = await getUserPasswordHash(req.params.id);
      if (!storedHash || !bcrypt.compareSync(currentPassword, storedHash))
        return res.status(401).json({ error: 'currentPassword incorrect' });
    }

    await updateUserPassword(req.params.id, bcrypt.hashSync(newPassword, 10));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (req.user.sub === req.params.id)
      return res.status(400).json({ error: 'cannot delete yourself' });
    await deleteAdmin(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
