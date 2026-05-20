import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();

const parseRow = (r) => {
  if (!r) return r;
  const payload = (() => { try { return JSON.parse(r.payload_json || '{}'); } catch { return {}; } })();
  const hasCoords = r.location_lat != null;
  const location = hasCoords
    ? { lat: r.location_lat, lng: r.location_lng, address: r.address || '' }
    : (r.address || null);
  return {
    id: r.id,
    ownerId: r.owner_id,
    ownerKey: r.owner_key,
    employeeId: r.owner_key,
    dateKey: r.date_key,
    time: r.time,
    type: r.type,
    ...payload,
    location,
    createdAt: r.created_at,
  };
};

router.get('/', requireAuth, (req, res) => {
  let rows;
  if (req.user.role === 'admin' || req.query.all === '1') {
    rows = db.prepare('SELECT * FROM checkin_records ORDER BY created_at DESC').all();
  } else if (req.query.scope === 'team') {
    const me = db.prepare('SELECT department, employee_level FROM users WHERE id = ?').get(req.user.sub);
    if (me?.employee_level === 'Board Level') {
      rows = db.prepare('SELECT * FROM checkin_records ORDER BY created_at DESC').all();
    } else if (me?.department) {
      rows = db.prepare(`
        SELECT c.* FROM checkin_records c
        JOIN users u ON u.id = c.owner_id
        WHERE u.department = ?
        ORDER BY c.created_at DESC
      `).all(me.department);
    } else {
      rows = db.prepare('SELECT * FROM checkin_records WHERE owner_id = ? ORDER BY created_at DESC').all(req.user.sub);
    }
  } else {
    rows = db.prepare('SELECT * FROM checkin_records WHERE owner_id = ? ORDER BY created_at DESC').all(req.user.sub);
  }
  res.json(rows.map(parseRow));
});

router.post('/', requireAuth, (req, res) => {
  const b = req.body || {};
  const owner = db.prepare('SELECT id, employee_id FROM users WHERE id = ?').get(req.user.sub);
  if (!owner) return res.status(404).json({ error: 'owner missing' });
  const id = b.id || `CHK-${Date.now()}`;
  const loc = b.location;
  const locIsObject = loc && typeof loc === 'object';
  const locLat = locIsObject ? (loc.lat ?? null) : null;
  const locLng = locIsObject ? (loc.lng ?? null) : null;
  const locAddress = typeof loc === 'string' ? loc : (locIsObject ? (loc.address || '') : '');
  const payload = { ...b };
  ['id','dateKey','time','type','location','ownerId','ownerKey','employeeId'].forEach((k) => delete payload[k]);

  db.prepare(`
    INSERT INTO checkin_records (id, owner_id, owner_key, date_key, time, type,
      location_lat, location_lng, address, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, owner.id, owner.employee_id,
    b.dateKey || '', b.time || '', b.type || '',
    locLat, locLng, locAddress,
    JSON.stringify(payload),
  );
  res.status(201).json(parseRow(db.prepare('SELECT * FROM checkin_records WHERE id = ?').get(id)));
});

router.patch('/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM checkin_records WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (req.user.role !== 'admin' && row.owner_id !== req.user.sub) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const b = req.body || {};
  const existingPayload = (() => { try { return JSON.parse(row.payload_json || '{}'); } catch { return {}; } })();
  const incoming = { ...b };
  ['id','ownerId','ownerKey','employeeId','dateKey','time','type','location'].forEach((k) => delete incoming[k]);
  const mergedPayload = { ...existingPayload, ...incoming };

  let locLat = row.location_lat;
  let locLng = row.location_lng;
  let locAddress = row.address;
  if (Object.prototype.hasOwnProperty.call(b, 'location')) {
    const loc = b.location;
    if (loc == null) {
      locLat = null; locLng = null; locAddress = '';
    } else if (typeof loc === 'string') {
      locLat = null; locLng = null; locAddress = loc;
    } else if (typeof loc === 'object') {
      locLat = loc.lat ?? null;
      locLng = loc.lng ?? null;
      locAddress = loc.address || '';
    }
  }
  const dateKey = b.dateKey ?? row.date_key;
  const time = b.time ?? row.time;
  const type = b.type ?? row.type;

  db.prepare(`
    UPDATE checkin_records
    SET date_key = ?, time = ?, type = ?,
        location_lat = ?, location_lng = ?, address = ?, payload_json = ?
    WHERE id = ?
  `).run(dateKey, time, type, locLat, locLng, locAddress, JSON.stringify(mergedPayload), req.params.id);

  res.json(parseRow(db.prepare('SELECT * FROM checkin_records WHERE id = ?').get(req.params.id)));
});

router.delete('/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM checkin_records WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (req.user.role !== 'admin' && row.owner_id !== req.user.sub) return res.status(403).json({ error: 'forbidden' });
  db.prepare('DELETE FROM checkin_records WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
