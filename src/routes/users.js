import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, userRowToProfile } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';

const router = Router();

const COLUMN_MAP = {
  prefix: 'prefix',
  nameTh: 'name_th',
  nameEn: 'name_en',
  nicknameTh: 'nickname_th',
  initial: 'initial',
  gender: 'gender',
  age: 'age',
  dob: 'dob',
  citizenId: 'citizen_id',
  phone: 'phone',
  line: 'line_id',
  email: 'email',
  addressCard: 'address_card',
  addressNow: 'address_now',
  emergencyName: 'emergency_name',
  emergencyPhone: 'emergency_phone',
  position: 'position_th',
  department: 'department',
  employeeLevel: 'employee_level',
  employeeType: 'employee_type',
  startDate: 'start_date',
  tenure: 'tenure',
  probationStart: 'probation_start',
  probationEnd: 'probation_end',
  salary: 'salary',
  bankName: 'bank_name',
  bankBranch: 'bank_branch',
  bankAcc: 'bank_acc',
  bankAccName: 'bank_acc_name',
};

function flattenPatch(patch = {}) {
  const out = {};
  const user = patch.profile?.user;
  const job = patch.profile?.job;
  const bank = job?.bank;
  const merge = (src, prefix = '') => {
    if (!src) return;
    for (const [k, v] of Object.entries(src)) {
      const col = COLUMN_MAP[k];
      if (col && v !== undefined) out[col] = v;
    }
    if (src.emergency) {
      if (src.emergency.name !== undefined) out.emergency_name = src.emergency.name;
      if (src.emergency.phone !== undefined) out.emergency_phone = src.emergency.phone;
    }
  };
  merge(patch);
  merge(user);
  merge(job);
  if (bank) {
    if (bank.name !== undefined) out.bank_name = bank.name;
    if (bank.branch !== undefined) out.bank_branch = bank.branch;
    if (bank.acc !== undefined) out.bank_acc = bank.acc;
    if (bank.accName !== undefined) out.bank_acc_name = bank.accName;
  }
  if (user?.education !== undefined) out.education_json = JSON.stringify(user.education);
  if (job?.positionHistory !== undefined) out.position_history_json = JSON.stringify(job.positionHistory);
  if (job?.benefits !== undefined) out.benefits_json = JSON.stringify(job.benefits);
  return out;
}

router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT * FROM users WHERE role = 'employee' ORDER BY employee_id`).all();
  res.json(rows.map(userRowToProfile));
});

router.get('/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ? OR employee_id = ?').get(req.params.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (req.user.role !== 'admin' && req.user.sub !== row.id) return res.status(403).json({ error: 'forbidden' });
  const profile = userRowToProfile(row);
  const docs = db.prepare('SELECT id, kind, file, size, date, status FROM documents WHERE user_id = ? ORDER BY id').all(row.id);
  profile.profile.documents = docs;
  res.json(profile);
});

router.patch('/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ? OR employee_id = ?').get(req.params.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (req.user.role !== 'admin' && req.user.sub !== row.id) return res.status(403).json({ error: 'forbidden' });

  const updates = flattenPatch(req.body || {});
  // Password changes must go through PATCH /users/:id/password (which verifies currentPassword).
  // Silently ignore any `password` field on the generic patch route to prevent bypass.

  if (Object.keys(updates).length) {
    const cols = Object.keys(updates);
    const setSql = cols.map((c) => `${c} = @${c}`).join(', ');
    db.prepare(`UPDATE users SET ${setSql}, updated_at = datetime('now') WHERE id = @id`).run({ ...updates, id: row.id });
  }

  if (Array.isArray(req.body?.profile?.documents)) {
    const docs = req.body.profile.documents;
    db.prepare('DELETE FROM documents WHERE user_id = ?').run(row.id);
    const ins = db.prepare('INSERT INTO documents (user_id, kind, file, size, date, status) VALUES (?, ?, ?, ?, ?, ?)');
    for (const d of docs) ins.run(row.id, d.kind || '', d.file || '', d.size || '', d.date || '', d.status || '');
  }

  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(row.id);
  const profile = userRowToProfile(fresh);
  profile.profile.documents = db.prepare('SELECT id, kind, file, size, date, status FROM documents WHERE user_id = ? ORDER BY id').all(row.id);
  res.json(profile);
});

router.post('/', requireAuth, requireAdmin, (req, res) => {
  const body = req.body || {};
  const id = (body.employeeId || `u_${Date.now()}`).toLowerCase();
  const email = body.email || `${id}@apphr.test`;
  const password = body.password || `${(body.employeeId || id).toUpperCase()}@123`;
  const hash = bcrypt.hashSync(password, 10);

  try {
    db.prepare(`
      INSERT INTO users (id, email, password_hash, role, employee_id, name_th, name_en, nickname_th,
        position_th, department, employee_level, employee_type, start_date)
      VALUES (?, ?, ?, 'employee', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, email, hash, body.employeeId || null,
      body.nameTh || '', body.nameEn || body.nameTh || '', body.nicknameTh || '',
      body.position || '', body.department || '', body.employeeLevel || '',
      body.employeeType || '', body.startDate || '');
    db.prepare('INSERT INTO entitlements (user_id) VALUES (?)').run(id);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.status(201).json(userRowToProfile(row));
});

router.patch('/:id/password', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ? OR employee_id = ?').get(req.params.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (req.user.role !== 'admin' && req.user.sub !== row.id) return res.status(403).json({ error: 'forbidden' });

  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || typeof newPassword !== 'string') {
    return res.status(400).json({ error: 'newPassword required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'newPassword must be at least 8 characters' });
  }

  // Admin acting on someone else may skip currentPassword check; otherwise verify.
  const skipVerify = req.user.role === 'admin' && req.user.sub !== row.id;
  if (!skipVerify) {
    if (!currentPassword || typeof currentPassword !== 'string') {
      return res.status(400).json({ error: 'currentPassword required' });
    }
    if (!bcrypt.compareSync(currentPassword, row.password_hash)) {
      return res.status(401).json({ error: 'currentPassword incorrect' });
    }
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`).run(hash, row.id);
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  const row = db.prepare('SELECT id FROM users WHERE id = ? OR employee_id = ?').get(req.params.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  db.prepare('DELETE FROM users WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

export default router;
