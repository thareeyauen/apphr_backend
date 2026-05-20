import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'apphr.db');

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'employee',
  employee_id     TEXT UNIQUE,
  initial         TEXT,
  prefix          TEXT,
  name_th         TEXT,
  name_en         TEXT,
  nickname_th     TEXT,
  gender          TEXT,
  age             INTEGER,
  dob             TEXT,
  citizen_id      TEXT,
  phone           TEXT,
  line_id         TEXT,
  address_card    TEXT,
  address_now     TEXT,
  emergency_name  TEXT,
  emergency_phone TEXT,
  position_th     TEXT,
  department      TEXT,
  employee_level  TEXT,
  employee_type   TEXT,
  start_date      TEXT,
  tenure          TEXT,
  probation_start TEXT,
  probation_end   TEXT,
  salary          TEXT,
  bank_name       TEXT,
  bank_branch     TEXT,
  bank_acc        TEXT,
  bank_acc_name   TEXT,
  education_json  TEXT DEFAULT '[]',
  position_history_json TEXT DEFAULT '[]',
  benefits_json   TEXT DEFAULT '{}',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  kind        TEXT NOT NULL,
  file        TEXT,
  size        TEXT,
  date        TEXT,
  status      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id);

CREATE TABLE IF NOT EXISTS entitlements (
  user_id           TEXT PRIMARY KEY,
  annual            INTEGER NOT NULL DEFAULT 7,
  sick              INTEGER NOT NULL DEFAULT 30,
  personal          INTEGER NOT NULL DEFAULT 4,
  maternity         INTEGER NOT NULL DEFAULT 120,
  entitlements_json TEXT    NOT NULL DEFAULT '{}',
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS requests (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL,
  owner_key       TEXT,
  owner_name      TEXT,
  type            TEXT NOT NULL,
  detail          TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  date            TEXT,
  date_key        TEXT,
  start_date_key  TEXT,
  end_date_key    TEXT,
  days            REAL,
  approver        TEXT,
  approver_levels_json TEXT DEFAULT '[]',
  payload_json    TEXT DEFAULT '{}',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_requests_owner ON requests(owner_id);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);

CREATE TABLE IF NOT EXISTS checkin_records (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL,
  owner_key    TEXT,
  date_key     TEXT,
  time         TEXT,
  type         TEXT,
  location_lat REAL,
  location_lng REAL,
  address      TEXT,
  payload_json TEXT DEFAULT '{}',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_checkin_owner ON checkin_records(owner_id);
CREATE INDEX IF NOT EXISTS idx_checkin_date ON checkin_records(date_key);
`);

// Idempotent column migrations for existing databases.
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
ensureColumn('entitlements', 'entitlements_json', "TEXT NOT NULL DEFAULT '{}'");

export function userRowToProfile(row) {
  if (!row) return null;
  const parse = (v, d) => { try { return JSON.parse(v); } catch { return d; } };
  return {
    id: row.id,
    employeeId: row.employee_id,
    email: row.email,
    role: row.role,
    name: row.name_th,
    initial: row.initial,
    label: row.employee_level,
    position: row.position_th,
    profile: {
      user: {
        prefix: row.prefix || '',
        nameTh: row.name_th || '',
        nameEn: row.name_en || '',
        nicknameTh: row.nickname_th || '',
        initial: row.initial || '',
        gender: row.gender || '',
        age: row.age ?? null,
        dob: row.dob || '',
        citizenId: row.citizen_id || '',
        phone: row.phone || '',
        line: row.line_id || '',
        email: row.email || '',
        addressCard: row.address_card || '',
        addressNow: row.address_now || '',
        emergency: { name: row.emergency_name || '', phone: row.emergency_phone || '' },
        education: parse(row.education_json, []),
      },
      job: {
        code: row.employee_id || '',
        roleTh: row.position_th || '',
        department: row.department || '',
        employeeLevel: row.employee_level || '',
        type: row.employee_type || '',
        startDate: row.start_date || '',
        tenure: row.tenure || '',
        probationStart: row.probation_start || '',
        probationEnd: row.probation_end || '',
        salary: row.salary || '',
        bank: {
          name: row.bank_name || '',
          branch: row.bank_branch || '',
          acc: row.bank_acc || '',
          accName: row.bank_acc_name || '',
        },
        positionHistory: parse(row.position_history_json, []),
        benefits: parse(row.benefits_json, {}),
      },
    },
  };
}
