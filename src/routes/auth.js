import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { signToken, requireAuth } from '../auth.js';
import { getUserByEmail, getUserById } from '../supabase/queries.js';

const router = Router();

async function authenticate(req, res, expectedRole) {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const result = await getUserByEmail(email);
  if (!result) return res.status(401).json({ error: 'invalid credentials' });
  if (!bcrypt.compareSync(password, result.passwordHash)) return res.status(401).json({ error: 'invalid credentials' });
  if (result.role !== expectedRole) return res.status(403).json({ error: 'wrong portal for this account' });

  // empId added to JWT so routes can access employees.id without extra query
  const token = signToken({ sub: result.userId, empId: result.empId, role: result.role, email: result.profile.email });
  res.json({ token, user: result.profile });
}

router.post('/login', (req, res) =>
  authenticate(req, res, 'employee').catch(err => res.status(500).json({ error: err.message }))
);
router.post('/admin/login', (req, res) =>
  authenticate(req, res, 'admin').catch(err => res.status(500).json({ error: err.message }))
);

router.get('/me', requireAuth, async (req, res) => {
  try {
    const profile = await getUserById(req.user.sub);
    if (!profile) return res.status(404).json({ error: 'user gone' });
    res.json({ user: profile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
