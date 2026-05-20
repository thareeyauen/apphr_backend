import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, userRowToProfile } from '../db.js';
import { signToken, requireAuth } from '../auth.js';

const router = Router();

function authenticate(req, res, expectedRole) {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (!row) return res.status(401).json({ error: 'invalid credentials' });
  if (!bcrypt.compareSync(password, row.password_hash)) return res.status(401).json({ error: 'invalid credentials' });
  if (row.role !== expectedRole) return res.status(403).json({ error: 'wrong portal for this account' });
  const token = signToken({ sub: row.id, role: row.role, email: row.email });
  res.json({ token, user: userRowToProfile(row) });
}

// Employee portal — rejects admin accounts.
router.post('/login', (req, res) => authenticate(req, res, 'employee'));

// Admin portal — rejects employee accounts.
router.post('/admin/login', (req, res) => authenticate(req, res, 'admin'));

router.get('/me', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub);
  if (!row) return res.status(404).json({ error: 'user gone' });
  res.json({ user: userRowToProfile(row) });
});

export default router;
