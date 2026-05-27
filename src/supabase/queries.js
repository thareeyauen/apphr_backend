// Supabase adapter — presents the same data shapes that routes expect,
// mapping between the flat SQLite model and the normalised Supabase schema.

import { db as supabase } from './client.js';
import {
  LEAVE_TYPES,
  LEAVE_TYPES_BY_ID,
  computeTenureYears,
  annualQuotaForTenure,
} from '../leaveTypes.js';

// ─── Leave-type code maps ────────────────────────────────────────────────────

const LEAVE_ID_TO_CODE = {
  personal: 'PERSONAL', sick: 'SICK', annual: 'ANNUAL',
  compensation: 'COMPENSATION', ordination: 'ORDINATION', unpaid: 'UNPAID',
  sterilization: 'STERILIZATION', training: 'TRAINING', military: 'MILITARY',
  maternity: 'MATERNITY', paternity: 'PATERNITY',
};
const LEAVE_CODE_TO_ID = Object.fromEntries(
  Object.entries(LEAVE_ID_TO_CODE).map(([id, code]) => [code, id])
);
// label (stored in requests.type) → Supabase code
const LEAVE_LABEL_TO_CODE = {
  'Personal Leave': 'PERSONAL', 'Sick Leave': 'SICK', 'Annual Leave': 'ANNUAL',
  'Compensation Leave': 'COMPENSATION', 'Ordination Leave': 'ORDINATION',
  'Unpaid Leave': 'UNPAID', 'Sterilization Leave': 'STERILIZATION',
  'Training Leave': 'TRAINING', 'Military Leave': 'MILITARY',
  'Maternity Leave': 'MATERNITY', 'Paternity Leave': 'PATERNITY',
};

// ─── Lookup cache (loaded once per process) ───────────────────────────────────

let _cache = null;

async function getLookups() {
  if (_cache) return _cache;
  const sb = supabase();
  const [lt, depts, pos, levels, etypes, banks, prefixes, roles] = await Promise.all([
    sb.from('leave_types').select('id, code'),
    sb.from('departments').select('id, name_th, name_en'),
    sb.from('positions').select('id, name_th'),
    sb.from('position_levels').select('id, name_th, name_en'),
    sb.from('employment_types').select('id, name_th'),
    sb.from('banks').select('id, name_th'),
    sb.from('prefixes').select('id, name_th'),
    sb.from('roles').select('id, code'),
  ]);
  _cache = {
    leaveTypeIds: Object.fromEntries((lt.data || []).map(r => [r.code, r.id])),
    departmentIds: {
      ...Object.fromEntries((depts.data || []).map(r => [r.name_th, r.id])),
      ...Object.fromEntries((depts.data || []).filter(r => r.name_en).map(r => [r.name_en, r.id])),
    },
    positionIds: Object.fromEntries((pos.data || []).map(r => [r.name_th, r.id])),
    positionLevelIds: {
      ...Object.fromEntries((levels.data || []).map(r => [r.name_th, r.id])),
      ...Object.fromEntries((levels.data || []).filter(r => r.name_en).map(r => [r.name_en, r.id])),
    },
    employmentTypeIds: Object.fromEntries((etypes.data || []).map(r => [r.name_th, r.id])),
    bankIds: Object.fromEntries((banks.data || []).map(r => [r.name_th, r.id])),
    prefixIds: Object.fromEntries((prefixes.data || []).map(r => [r.name_th, r.id])),
    roleIds: Object.fromEntries((roles.data || []).map(r => [r.code, r.id])),
  };
  return _cache;
}

export function invalidateLookups() { _cache = null; }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeAge(birthDate) {
  if (!birthDate) return null;
  const today = new Date();
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function computeTenureText(startDate) {
  const years = computeTenureYears(startDate);
  const totalMonths = Math.floor(years * 12);
  if (totalMonths <= 0) return '';
  const y = Math.floor(totalMonths / 12);
  const mo = totalMonths % 12;
  if (y === 0) return `${mo} เดือน`;
  return mo > 0 ? `${y} ปี ${mo} เดือน` : `${y} ปี`;
}

// All times in this app are expressed in Asia/Bangkok (UTC+7) — pin the timezone
// so it doesn't matter whether the Node runtime is UTC (Render default) or local.
const APP_TZ = 'Asia/Bangkok';
const APP_TZ_OFFSET = '+07:00';

// Convert a "YYYY-MM-DD" + "HH:MM" pair (user-entered, Bangkok local) to a
// UTC ISO string suitable for storing in timestamptz columns.
function toBangkokISOString(dateKey, timeStr) {
  return new Date(`${dateKey}T${timeStr}:00${APP_TZ_OFFSET}`).toISOString();
}

function toDateKey(v) {
  if (!v) return '';
  const s = String(v);
  // DATE column comes back as 'YYYY-MM-DD' already — keep as is.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(v);
  if (isNaN(d.getTime())) return s.slice(0, 10);
  // sv-SE locale formats date as ISO (YYYY-MM-DD) — pin to Bangkok TZ.
  return d.toLocaleDateString('sv-SE', { timeZone: APP_TZ });
}

function toTimeStr(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: APP_TZ,
  });
}

// ─── Profile mapper: raw Supabase rows → API shape ────────────────────────────

export function buildProfile(user, emp, extras = {}) {
  if (!user || !emp) return null;
  const {
    employment, bankAccounts = [], addresses = [],
    emergency, education = [], salary,
    approverUserIds = [], role = 'employee', documents = [], positionHistory = [],
  } = extras;

  const payrollBank = bankAccounts.find(b => b.is_payroll_account) || bankAccounts[0] || {};
  const addressCard = (addresses.find(a => a.address_type === 'id_card') || {}).address_line || '';
  const addressNow  = (addresses.find(a => a.address_type === 'current') || {}).address_line || '';

  const firstName = emp.first_name_th || '';
  const lastName  = emp.last_name_th  || '';
  const nameTh = [firstName, lastName].filter(Boolean).join(' ');
  const nameEn = [emp.first_name_en, emp.last_name_en].filter(Boolean).join(' ');
  const initial = emp.nickname_th ? emp.nickname_th[0] : (firstName ? firstName[0] : '');

  const empl  = employment || {};
  const dept  = empl.departments     || {};
  const pos   = empl.positions       || {};
  const level = empl.position_levels || {};
  const etype = empl.employment_types|| {};

  return {
    id:             user.id,
    employeeId:     emp.id,
    email:          user.email,
    role,
    name:           nameTh,
    initial,
    label:          level.name_th || '',
    position:       pos.name_th   || '',
    approverUserIds,
    profile: {
      company: {},
      user: {
        prefix:     (emp.prefixes || {}).name_th || '',
        nameTh,
        nameEn,
        nicknameTh: emp.nickname_th || '',
        initial,
        gender:     emp.gender || '',
        age:        computeAge(emp.birth_date),
        dob:        emp.birth_date || '',
        citizenId:  emp.national_id || '',
        phone:      emp.phone   || '',
        line:       emp.line_id || '',
        email:      user.email,
        addressCard,
        addressNow,
        emergency: {
          name:  (emergency || {}).name  || '',
          phone: (emergency || {}).phone || '',
        },
        education: education.map(e => ({
          degreeLevel: e.degree_level || '',
          faculty:     e.faculty      || '',
          major:       e.major        || '',
          institute:   e.institution  || '',
          studyYears:  [e.start_year, e.end_year].filter(Boolean).join('-'),
        })),
      },
      job: {
        code:           emp.id || '',
        roleTh:         pos.name_th   || '',
        department:     dept.name_en  || dept.name_th  || '',
        employeeLevel:  level.name_en || '',
        type:           etype.name_th || '',
        startDate:      empl.start_date           || '',
        tenure:         computeTenureText(empl.start_date),
        probationStart: empl.probation_start_date || '',
        probationEnd:   empl.probation_end_date   || '',
        salary:         (salary || {}).amount?.toString() || '',
        bank: {
          name:    ((payrollBank.banks) || {}).name_th || '',
          branch:  payrollBank.branch         || '',
          acc:     payrollBank.account_number || '',
          accName: payrollBank.account_name   || '',
        },
        positionHistory,
        benefits: {},
      },
      documents,
    },
  };
}

// ─── Core: fetch a single user's full data (parallel) ────────────────────────

export async function fetchUserData(userId) {
  const sb = supabase();
  const [userRes, empRes] = await Promise.all([
    sb.from('users').select('id, email, password_hash, is_active').eq('id', userId).maybeSingle(),
    sb.from('employees')
      .select('id, user_id, first_name_th, last_name_th, first_name_en, last_name_en, nickname_th, gender, birth_date, national_id, phone, line_id, prefixes(name_th)')
      .eq('user_id', userId).maybeSingle(),
  ]);
  if (!userRes.data || userRes.data.is_active === false || !empRes.data) return null;

  const user = userRes.data;
  const emp  = empRes.data;

  // documents + position_history stored as JSONB — each queried separately so one missing column doesn't break the other
  let documents = [];
  let positionHistory = [];
  {
    const { data } = await sb.from('employees').select('documents').eq('id', emp.id).maybeSingle();
    documents = Array.isArray(data?.documents) ? data.documents : [];
  }
  {
    const { data } = await sb.from('employees').select('position_history').eq('id', emp.id).maybeSingle();
    positionHistory = Array.isArray(data?.position_history) ? data.position_history : [];
  }

  const [roleRes, emplRes, bankRes, addrRes, emergRes, eduRes, salaryRes, approverRes] = await Promise.all([
    sb.from('user_roles').select('roles(code)').eq('user_id', userId).maybeSingle(),
    sb.from('employee_employments')
      .select('start_date, probation_start_date, probation_end_date, departments(name_th, name_en), positions(name_th), position_levels(name_th, name_en), employment_types(name_th)')
      .eq('employee_id', emp.id).maybeSingle(),
    sb.from('employee_bank_accounts')
      .select('account_number, account_name, branch, is_payroll_account, banks(name_th)')
      .eq('employee_id', emp.id),
    sb.from('employee_addresses').select('address_type, address_line').eq('employee_id', emp.id),
    sb.from('employee_emergency_contacts').select('name, phone').eq('employee_id', emp.id).maybeSingle(),
    sb.from('employee_education')
      .select('degree_level, faculty, major, institution, start_year, end_year')
      .eq('employee_id', emp.id),
    sb.from('salaries').select('amount').eq('employee_id', emp.id).maybeSingle(),
    sb.from('approver_mappings').select('approver_employee_id').eq('employee_id', emp.id),
  ]);

  // Resolve approver emp IDs → user IDs
  const approverEmpIds = (approverRes.data || []).map(m => m.approver_employee_id);
  let approverUserIds = [];
  if (approverEmpIds.length) {
    const { data: aemps } = await sb.from('employees').select('id, user_id').in('id', approverEmpIds);
    approverUserIds = (aemps || []).map(e => e.user_id);
  }

  return {
    user,
    emp,
    role:         roleRes.data?.roles?.code || 'employee',
    employment:   emplRes.data,
    bankAccounts: bankRes.data  || [],
    addresses:    addrRes.data  || [],
    emergency:    emergRes.data,
    education:    eduRes.data   || [],
    salary:       salaryRes.data,
    approverUserIds,
    documents,
    positionHistory,
  };
}

// ─── User queries ─────────────────────────────────────────────────────────────

export async function getUserByEmail(email) {
  const sb = supabase();
  const { data: user } = await sb.from('users').select('id').eq('email', email.trim().toLowerCase()).maybeSingle();
  if (!user) return null;
  const data = await fetchUserData(user.id);
  if (!data) return null;
  return {
    passwordHash: data.user.password_hash,
    userId:       data.user.id,
    empId:        data.emp.id,
    role:         data.role,
    profile:      buildProfile(data.user, data.emp, data),
  };
}

export async function getUserById(userId) {
  const data = await fetchUserData(userId);
  if (!data) return null;
  return buildProfile(data.user, data.emp, data);
}

// Accepts users.id OR employees.id
export async function getUserByEmployeeId(id) {
  const sb = supabase();
  const { data: emp } = await sb.from('employees').select('user_id').eq('id', id).maybeSingle();
  return getUserById(emp ? emp.user_id : id);
}

export async function getUserPasswordHash(userId) {
  const sb = supabase();
  const { data } = await sb.from('users').select('password_hash').eq('id', userId).maybeSingle();
  return data?.password_hash || null;
}

export async function getAllEmployees() {
  const sb = supabase();
  const lookups = await getLookups();
  const employeeRoleId = lookups.roleIds['employee'];
  if (!employeeRoleId) return [];

  const { data: userRoles, error } = await sb.from('user_roles').select('user_id').eq('role_id', employeeRoleId);
  if (error || !userRoles?.length) return [];

  const userIds = userRoles.map(ur => ur.user_id);
  const [usersRes, empsRes] = await Promise.all([
    sb.from('users').select('id, email, is_active').in('id', userIds),
    sb.from('employees').select(`
      id, user_id, first_name_th, last_name_th, first_name_en, last_name_en,
      nickname_th, gender, birth_date, national_id, phone, line_id,
      prefixes(name_th),
      employee_employments(start_date, probation_start_date, probation_end_date, departments(name_th, name_en), positions(name_th), position_levels(name_th, name_en), employment_types(name_th)),
      employee_bank_accounts(account_number, account_name, branch, is_payroll_account, banks(name_th)),
      employee_addresses(address_type, address_line),
      employee_emergency_contacts(name, phone),
      salaries(amount)
    `).in('user_id', userIds),
  ]);

  const userMap = Object.fromEntries((usersRes.data || []).filter(u => u.is_active !== false).map(u => [u.id, u]));
  const allEmpIds = (empsRes.data || []).map(e => e.id);

  // Load all approver mappings in one batch
  const approverByEmpId = {};
  if (allEmpIds.length) {
    const { data: mappings } = await sb.from('approver_mappings').select('employee_id, approver_employee_id').in('employee_id', allEmpIds);
    const approverEmpIds = [...new Set((mappings || []).map(m => m.approver_employee_id))];
    let empToUserId = {};
    if (approverEmpIds.length) {
      const { data: ae } = await sb.from('employees').select('id, user_id').in('id', approverEmpIds);
      empToUserId = Object.fromEntries((ae || []).map(e => [e.id, e.user_id]));
    }
    for (const m of (mappings || [])) {
      const uid = empToUserId[m.approver_employee_id];
      if (!uid) continue;
      if (!approverByEmpId[m.employee_id]) approverByEmpId[m.employee_id] = [];
      approverByEmpId[m.employee_id].push(uid);
    }
  }

  return (empsRes.data || [])
    .filter(emp => userMap[emp.user_id])
    .map(emp => buildProfile(userMap[emp.user_id], emp, {
      employment:   Array.isArray(emp.employee_employments) ? emp.employee_employments[0] : (emp.employee_employments || undefined),
      bankAccounts: Array.isArray(emp.employee_bank_accounts) ? emp.employee_bank_accounts : (emp.employee_bank_accounts ? [emp.employee_bank_accounts] : []),
      addresses:    Array.isArray(emp.employee_addresses) ? emp.employee_addresses : (emp.employee_addresses ? [emp.employee_addresses] : []),
      emergency:    Array.isArray(emp.employee_emergency_contacts) ? emp.employee_emergency_contacts[0] : (emp.employee_emergency_contacts || undefined),
      education:    [],
      salary:       Array.isArray(emp.salaries) ? emp.salaries[0] : (emp.salaries || undefined),
      approverUserIds: approverByEmpId[emp.id] || [],
      role: 'employee',
    }))
    .filter(Boolean)
    .sort((a, b) => (a.employeeId || '').localeCompare(b.employeeId || ''));
}

export async function getEmploymentTypes() {
  const sb = supabase();
  const { data } = await sb.from('employment_types').select('id, name_th').order('id');
  return (data || []).map(r => r.name_th);
}

export async function getPositions() {
  const sb = supabase();
  const { data } = await sb.from('positions').select('id, name_th').order('name_th');
  return (data || []).map(r => r.name_th);
}

export async function getBanks() {
  const sb = supabase();
  const { data } = await sb.from('banks').select('id, name_th').order('name_th');
  return (data || []).map(r => r.name_th);
}

export async function getDocumentRequestTypes() {
  const sb = supabase();
  const { data } = await sb.from('document_request_types')
    .select('id, code, name_th, handled_by, default_processing_days')
    .is('deleted_at', null)
    .order('id');
  return data || [];
}

export async function getAttendanceExceptionTypes() {
  const sb = supabase();
  const { data } = await sb.from('attendance_exception_types')
    .select('id, code, label_th, label_en')
    .order('id');
  return data || [];
}

export async function getAllAdmins() {
  const sb = supabase();
  const lookups = await getLookups();
  const adminRoleId = lookups.roleIds['admin'];
  if (!adminRoleId) return [];

  const { data: userRoles } = await sb.from('user_roles').select('user_id').eq('role_id', adminRoleId);
  if (!userRoles?.length) return [];

  const userIds = userRoles.map(ur => ur.user_id);
  const [usersRes, empsRes] = await Promise.all([
    sb.from('users').select('id, email, is_active').in('id', userIds),
    sb.from('employees').select('id, user_id, first_name_th, last_name_th').in('user_id', userIds),
  ]);

  const empMap = Object.fromEntries((empsRes.data || []).map(e => [e.user_id, e]));
  return (usersRes.data || [])
    .filter(u => u.is_active !== false)
    .map(u => {
      const emp = empMap[u.id] || {};
      return {
        id: u.id,
        email: u.email,
        nameTh: [emp.first_name_th, emp.last_name_th].filter(Boolean).join(' ') || '',
      };
    });
}

export async function createAdmin(body) {
  const sb = supabase();
  const lookups = await getLookups();

  const userId = ('adm' + Date.now().toString(36)).slice(0, 13);
  const email  = (body.email || '').trim().toLowerCase();
  const nameTh = body.nameTh || '';
  const parts  = nameTh.trim().split(/\s+/);
  const firstTh = parts[0] || '';
  const lastTh  = parts.slice(1).join(' ');
  const adminRoleId = lookups.roleIds['admin'];

  const { error: uErr } = await sb.from('users').insert({
    id: userId, email, password_hash: body.passwordHash,
    must_change_password: false, is_active: true,
  });
  if (uErr) throw new Error(uErr.message);

  const { error: eErr } = await sb.from('employees').insert({
    id: userId, user_id: userId,
    first_name_th: firstTh, last_name_th: lastTh,
    first_name_en: '', last_name_en: '',
    national_id: userId.slice(0, 13), company_email: email, is_active: true,
  });
  if (eErr) {
    await sb.from('users').delete().eq('id', userId);
    throw new Error(eErr.message);
  }

  if (adminRoleId) {
    const { error: roleErr } = await sb.from('user_roles').insert({ user_id: userId, role_id: adminRoleId });
    if (roleErr) throw new Error(`user_roles: ${roleErr.message}`);
  }

  return { id: userId, email, nameTh };
}

export async function deleteAdmin(userId) {
  const sb = supabase();
  await sb.from('employees').update({ is_active: false }).eq('user_id', userId);
  await sb.from('users').update({ is_active: false }).eq('id', userId);
}

export async function getAllEmployeeIds() {
  const sb = supabase();
  const { data } = await sb.from('employees').select('id');
  return (data || []).map(r => r.id);
}

export async function createUser(body) {
  const sb = supabase();
  const lookups = await getLookups();

  const userId = (body.employeeId || `u_${Date.now()}`).toLowerCase();
  const empId  = body.employeeId || userId;
  const email  = (body.email || `${empId}@hand.co.th`).toLowerCase();

  // Split Thai/English names
  const nameTh    = body.nameTh || '';
  const nameEn    = body.nameEn || '';
  const thParts   = nameTh.trim().split(/\s+/);
  const enParts   = nameEn.trim().split(/\s+/);
  const firstTh   = thParts[0] || '';
  const lastTh    = thParts.slice(1).join(' ');
  const firstEn   = enParts[0] || '';
  const lastEn    = enParts.slice(1).join(' ');

  const departmentId = lookups.departmentIds[body.department] || null;
  const levelId      = lookups.positionLevelIds[body.employeeLevel] || null;
  const etypeId      = lookups.employmentTypeIds[body.employeeType] || null;
  const empRoleId    = lookups.roleIds['employee'];

  // Find or create position by Thai name (body.roleTh takes priority over body.position)
  const roleThName = (body.roleTh || body.position || '').trim();
  console.log('[createUser] roleThName:', roleThName);
  let positionId = lookups.positionIds[roleThName] || null;
  if (!positionId && roleThName) {
    const { data: existingPos, error: posLookupErr } = await sb.from('positions').select('id').eq('name_th', roleThName).maybeSingle();
    if (existingPos) {
      positionId = existingPos.id;
    } else {
      const { data: newPos, error: posInsErr } = await sb.from('positions').insert({ name_th: roleThName, name_en: roleThName, code: `CUSTOM_${Date.now()}` }).select('id').single();
      if (newPos) { positionId = newPos.id; invalidateLookups(); }
      else console.error('[createUser] position insert error:', posInsErr?.message);
    }
  }

  // 1. users
  const { error: uErr } = await sb.from('users').insert({
    id: userId, email, password_hash: body.passwordHash,
    must_change_password: false, is_active: true,
  });
  if (uErr) throw new Error(uErr.message);

  // 2. employees
  const { error: eErr } = await sb.from('employees').insert({
    id: empId, user_id: userId,
    first_name_th: firstTh, last_name_th: lastTh,
    first_name_en: firstEn, last_name_en: lastEn,
    nickname_th: body.nicknameTh || '',
    national_id:   body.citizenId || `gen_${empId}`,
    company_email: email,
    is_active: true,
  });
  if (eErr) {
    await sb.from('users').delete().eq('id', userId);
    throw new Error(eErr.message);
  }

  // 3. user_roles
  if (empRoleId) {
    const { error: roleErr } = await sb.from('user_roles').upsert(
      { user_id: userId, role_id: empRoleId },
      { onConflict: 'user_id,role_id', ignoreDuplicates: true }
    );
    if (roleErr) throw new Error(`user_roles: ${roleErr.message}`);
  }

  // 4. employee_employments
  console.log('[createUser] empId:', empId, 'departmentId:', departmentId, 'positionId:', positionId, 'levelId:', levelId, 'startDate:', body.startDate);
  if (departmentId) {
    const fallbackLevelId = levelId || (await sb.from('position_levels').select('id').limit(1).single()).data?.id;
    const fallbackPosId   = positionId || (await sb.from('positions').select('id').limit(1).single()).data?.id;
    if (fallbackPosId) {
      const { error: eeErr } = await sb.from('employee_employments').insert({
        employee_id:        empId,
        department_id:      departmentId,
        position_id:        fallbackPosId,
        position_level_id:  fallbackLevelId,
        employment_type_id: etypeId,
        start_date:         body.startDate || null,
      });
      if (eeErr) console.error('[createUser] employee_employments insert error:', eeErr.message);
      else console.log('[createUser] employee_employments created OK');
    }
  } else {
    console.warn('[createUser] SKIPPED employee_employments — missing departmentId or positionId');
  }

  // 5. initial leave balances
  const year = new Date().getFullYear();
  const balances = LEAVE_TYPES
    .map(t => {
      const ltId = lookups.leaveTypeIds[LEAVE_ID_TO_CODE[t.id]];
      if (!ltId) return null;
      return { employee_id: empId, leave_type_id: ltId, period_year: year, entitled_days: t.quota || 0, carry_over_days: 0 };
    })
    .filter(Boolean);
  if (balances.length) await sb.from('leave_balances').insert(balances);

  return getUserById(userId);
}

async function upsertAddress(sb, empId, type, line) {
  const { data: ex } = await sb.from('employee_addresses').select('id').eq('employee_id', empId).eq('address_type', type).maybeSingle();
  if (ex) {
    const { error: addrErr } = await sb.from('employee_addresses').update({ address_line: line }).eq('id', ex.id);
    if (addrErr) console.error('[upsertAddress] update error:', addrErr.message);
  } else {
    await sb.from('employee_addresses').insert({ employee_id: empId, address_type: type, address_line: line });
  }
}

export async function updateUserProfile(userId, empId, patch) {
  console.log('[updateUserProfile] START userId:', userId, 'empId:', empId);
  const sb = supabase();
  const lookups = await getLookups();
  const userPatch = patch.profile?.user;
  const jobPatch  = patch.profile?.job;
  const bankPatch = jobPatch?.bank;

  // ── employees table ──
  const empUpdate = {};
  const setIfDef = (col, val) => { if (val !== undefined) empUpdate[col] = val; };

  if (userPatch) {
    if (userPatch.nameTh !== undefined) {
      const p = String(userPatch.nameTh).trim().split(/\s+/);
      empUpdate.first_name_th = p[0] || '';
      empUpdate.last_name_th  = p.slice(1).join(' ');
    }
    if (userPatch.nameEn !== undefined) {
      const p = String(userPatch.nameEn).trim().split(/\s+/);
      empUpdate.first_name_en = p[0] || '';
      empUpdate.last_name_en  = p.slice(1).join(' ');
    }
    setIfDef('nickname_th', userPatch.nicknameTh);
    setIfDef('gender',      userPatch.gender);
    setIfDef('birth_date',  userPatch.dob || null);
    setIfDef('national_id', userPatch.citizenId);
    setIfDef('phone',       userPatch.phone);
    setIfDef('line_id',     userPatch.line);
    if (userPatch.prefix !== undefined) {
      const pid = lookups.prefixIds[userPatch.prefix];
      if (pid) empUpdate.prefix_id = pid;
    }
  }
  // top-level nameTh / nameEn
  if (patch.nameTh !== undefined) {
    const p = String(patch.nameTh).trim().split(/\s+/);
    empUpdate.first_name_th = p[0] || '';
    empUpdate.last_name_th  = p.slice(1).join(' ');
  }
  if (Object.keys(empUpdate).length) {
    const { error: empErr } = await sb.from('employees').update(empUpdate).eq('id', empId);
    if (empErr) console.error('[updateUserProfile] employees update error:', empErr.message);
  }

  // ── email ──
  const newEmail = userPatch?.email || patch.email;
  if (newEmail) {
    await sb.from('users').update({ email: newEmail }).eq('id', userId);
    await sb.from('employees').update({ company_email: newEmail }).eq('id', empId);
  }

  // ── employee_employments ──
  if (jobPatch || patch.department !== undefined || patch.position !== undefined) {
    const emplUpd = {};
    const jp = jobPatch || {};
    const dp = patch;
    if ((jp.department || dp.department) !== undefined) {
      const did = lookups.departmentIds[jp.department ?? dp.department];
      if (did) emplUpd.department_id = did;
    }
    if ((jp.roleTh || dp.position) !== undefined) {
      const rName = ((jp.roleTh != null ? jp.roleTh : dp.position) || '').trim();
      let pid = rName ? (lookups.positionIds[rName] || null) : null;
      if (!pid && rName) {
        const { data: ep } = await sb.from('positions').select('id').eq('name_th', rName).maybeSingle();
        if (ep) {
          pid = ep.id;
        } else {
          const { data: np } = await sb.from('positions').insert({ name_th: rName, code: `CUSTOM_${Date.now()}` }).select('id').single();
          if (np) { pid = np.id; invalidateLookups(); }
        }
      }
      if (pid) emplUpd.position_id = pid;
    }
    if ((jp.employeeLevel || dp.employeeLevel) !== undefined) {
      const lid = lookups.positionLevelIds[jp.employeeLevel ?? dp.employeeLevel];
      if (lid) emplUpd.position_level_id = lid;
    }
    if ((jp.type || dp.employeeType) !== undefined) {
      const tid = lookups.employmentTypeIds[jp.type ?? dp.employeeType];
      if (tid) emplUpd.employment_type_id = tid;
    }
    if (jp.startDate      !== undefined) emplUpd.start_date            = jp.startDate      || null;
    if (jp.probationStart !== undefined) emplUpd.probation_start_date = jp.probationStart  || null;
    if (jp.probationEnd   !== undefined) emplUpd.probation_end_date   = jp.probationEnd    || null;

    console.log('[updateUserProfile] empId:', empId, 'jp.department:', jp.department, 'jp.roleTh:', jp.roleTh, 'jp.employeeLevel:', jp.employeeLevel);
    console.log('[updateUserProfile] emplUpd:', JSON.stringify(emplUpd));
    if (Object.keys(emplUpd).length) {
      const { data: ex } = await sb.from('employee_employments').select('id').eq('employee_id', empId).maybeSingle();
      console.log('[updateUserProfile] existing employment record:', ex ? ex.id : 'NOT FOUND');
      if (ex) {
        const { error: eeErr } = await sb.from('employee_employments').update(emplUpd).eq('employee_id', empId);
        if (eeErr) console.error('[updateUserProfile] employee_employments update error:', eeErr.message);
        else console.log('[updateUserProfile] employee_employments updated OK');
      } else if (emplUpd.department_id) {
        const lvlId = emplUpd.position_level_id || (await sb.from('position_levels').select('id').limit(1).single()).data?.id;
        const posId = emplUpd.position_id || (await sb.from('positions').select('id').limit(1).single()).data?.id;
        if (lvlId && posId) {
          const { error: eeInsErr } = await sb.from('employee_employments').insert({ employee_id: empId, ...emplUpd, position_level_id: lvlId, position_id: posId });
          if (eeInsErr) console.error('[updateUserProfile] employee_employments insert error:', eeInsErr.message);
          else console.log('[updateUserProfile] employee_employments inserted OK (fallback pos)');
        }
      }
    }

    // salary
    const salaryVal = jp.salary ?? patch.salary;
    if (salaryVal !== undefined) {
      const amt = Number(salaryVal);
      if (Number.isFinite(amt) && amt >= 0) {
        const { data: ex } = await sb.from('salaries').select('id').eq('employee_id', empId).maybeSingle();
        if (ex) {
          const { error: salErr } = await sb.from('salaries').update({ amount: amt }).eq('employee_id', empId);
          if (salErr) console.error('[updateUserProfile] salaries update error:', salErr.message);
        } else if (amt > 0) {
          await sb.from('salaries').insert({ employee_id: empId, amount: amt, effective_from: new Date().toISOString().slice(0, 10) });
        }
      }
    }

    // bank
    const bankName = bankPatch?.name ?? patch.bankName;
    if (bankName !== undefined || bankPatch) {
      const bankId = lookups.bankIds[bankName] || null;
      const bd = {};
      if (bankId) bd.bank_id = bankId;
      const acc     = bankPatch?.acc     ?? patch.bankAcc;
      const accName = bankPatch?.accName ?? patch.bankAccName;
      const branch  = bankPatch?.branch  ?? patch.bankBranch;
      if (acc     !== undefined) bd.account_number = acc;
      if (accName !== undefined) bd.account_name   = accName;
      if (branch  !== undefined) bd.branch         = branch;
      if (Object.keys(bd).length) {
        const { data: ex } = await sb.from('employee_bank_accounts').select('id').eq('employee_id', empId).eq('is_payroll_account', true).maybeSingle();
        if (ex) {
          const { error: bankErr } = await sb.from('employee_bank_accounts').update(bd).eq('id', ex.id);
          if (bankErr) console.error('[updateUserProfile] employee_bank_accounts update error:', bankErr.message);
        } else {
          await sb.from('employee_bank_accounts').insert({ employee_id: empId, is_payroll_account: true, bank_id: bankId || 1, ...bd });
        }
      }
    }
  }

  // ── documents + positionHistory (JSONB on employees) ──
  const empJsonbUpdate = {};
  if (patch.profile?.documents !== undefined) empJsonbUpdate.documents = patch.profile.documents;
  if (jobPatch?.positionHistory !== undefined) empJsonbUpdate.position_history = jobPatch.positionHistory;
  if (Object.keys(empJsonbUpdate).length) {
    await sb.from('employees').update(empJsonbUpdate).eq('id', empId);
  }

  // ── addresses / emergency / education ──
  if (userPatch) {
    if (userPatch.addressCard !== undefined) await upsertAddress(sb, empId, 'id_card', userPatch.addressCard);
    if (userPatch.addressNow  !== undefined) await upsertAddress(sb, empId, 'current', userPatch.addressNow);
    if (userPatch.emergency !== undefined) {
      const ec = userPatch.emergency || {};
      const { data: ex } = await sb.from('employee_emergency_contacts').select('id').eq('employee_id', empId).maybeSingle();
      if (ex) {
        const { error: ecErr } = await sb.from('employee_emergency_contacts').update({ name: ec.name || '', phone: ec.phone || '' }).eq('id', ex.id);
        if (ecErr) console.error('[updateUserProfile] emergency_contacts update error:', ecErr.message);
      } else {
        await sb.from('employee_emergency_contacts').insert({ employee_id: empId, name: ec.name || '', phone: ec.phone || '' });
      }
    }
    if (Array.isArray(userPatch.education)) {
      await sb.from('employee_education').delete().eq('employee_id', empId);
      if (userPatch.education.length) {
        await sb.from('employee_education').insert(
          userPatch.education.map(e => {
            const yearParts = (e.studyYears || '').split(/[-–\/]/).map(s => s.trim()).filter(Boolean);
            return {
              employee_id:  empId,
              degree_level: e.degreeLevel || e.degree || '',
              faculty:      e.faculty || '',
              major:        e.major   || '',
              institution:  e.institute || e.institution || '',
              start_year:   e.startYear ?? (yearParts[0] ? Number(yearParts[0]) : null),
              end_year:     e.endYear   ?? (yearParts[1] ? Number(yearParts[1]) : null),
            };
          })
        );
      }
    }
  }

  // ── employee ID rename ──
  const newCode = jobPatch?.code?.trim();
  if (newCode && newCode !== empId) {
    const { error: renameErr } = await sb.from('employees').update({ id: newCode }).eq('id', empId);
    if (renameErr) throw new Error(`ไม่สามารถเปลี่ยนรหัสพนักงานได้: ${renameErr.message}`);
  }
}

export async function updateUserApprovers(empId, approverUserIds) {
  const sb = supabase();
  await sb.from('approver_mappings').delete().eq('employee_id', empId);
  if (!approverUserIds?.length) return;
  const { data: emps } = await sb.from('employees').select('id, user_id').in('user_id', approverUserIds);
  const byUserId = Object.fromEntries((emps || []).map(e => [e.user_id, e.id]));
  const mappings = approverUserIds
    .map((uid, idx) => {
      const aEmpId = byUserId[uid];
      if (!aEmpId) return null;
      return { employee_id: empId, approver_employee_id: aEmpId, priority: idx + 1, effective_from: new Date().toISOString().slice(0, 10) };
    })
    .filter(Boolean);
  if (mappings.length) await sb.from('approver_mappings').insert(mappings);
}

export async function updateUserPassword(userId, hash) {
  const sb = supabase();
  const { error } = await sb.from('users').update({ password_hash: hash, password_changed_at: new Date().toISOString(), must_change_password: false }).eq('id', userId);
  if (error) throw new Error(error.message);
}

export async function deleteUser(userId) {
  const sb = supabase();
  const { data: emp } = await sb.from('employees').select('id').eq('user_id', userId).maybeSingle();
  if (emp) {
    await sb.from('employees').update({ is_active: false }).eq('id', emp.id);
    // remove this employee as approver from all other employees' chains
    await sb.from('approver_mappings').delete().eq('approver_employee_id', emp.id);
  }
  await sb.from('users').update({ is_active: false }).eq('id', userId);
}

// ─── Approver helpers (used in requests route) ────────────────────────────────

export async function getOwnerApproverUserIds(ownerEmpId) {
  const sb = supabase();
  const { data: mappings } = await sb.from('approver_mappings').select('approver_employee_id').eq('employee_id', ownerEmpId);
  if (!mappings?.length) return [];
  const { data: emps } = await sb.from('employees').select('id, user_id').in('id', mappings.map(m => m.approver_employee_id));
  return (emps || []).map(e => e.user_id);
}

// ─── Request queries ──────────────────────────────────────────────────────────

function parseLeaveRequest(r, empMap = {}) {
  if (!r) return null;
  const emp  = empMap[r.employee_id] || {};
  const code = r.leave_types?.code || '';
  const ltId = LEAVE_CODE_TO_ID[code];
  const lt   = LEAVE_TYPES_BY_ID[ltId] || {};
  const periods = [...(r.leave_request_periods || [])].sort((a, b) => (a.leave_date || '').localeCompare(b.leave_date || ''));
  const startDateKey = periods[0]?.leave_date || '';
  const endDateKey   = periods[periods.length - 1]?.leave_date || startDateKey;

  return {
    id:                    r.id,
    ownerKey:              r.employee_id,
    ownerId:               emp.user_id || r.employee_id,
    ownerName:             emp.name    || '',
    employeeId:            r.employee_id,
    userId:                emp.user_id || r.employee_id,
    userName:              emp.name    || '',
    type:                  lt.label    || code,
    detail:                r.reason    || '',
    status:                r.status,
    date:                  startDateKey,
    dateKey:               startDateKey,
    startDateKey,
    endDateKey,
    days:                  Number(r.total_days) || 0,
    approver:              '',
    createdAt:             r.created_at,
    requestCode:           r.request_code,
    medicalCertificate:    null,
    holidayWorkDate:       null,
    childBirthDate:        null,
  };
}

async function buildEmpMap(sb, empIds) {
  if (!empIds.length) return {};
  const { data } = await sb.from('employees').select('id, user_id, first_name_th, last_name_th').in('id', empIds);
  return Object.fromEntries((data || []).map(e => [
    e.id,
    { user_id: e.user_id, name: [e.first_name_th, e.last_name_th].filter(Boolean).join(' ') },
  ]));
}

// Resolve approver display names per employee id, sourced from approver_mappings.
// Returns { [employeeId]: ['name1', 'name2'] } — same approver chain used by leave requests.
async function buildApproverNameMap(sb, empIds) {
  if (!empIds.length) return {};
  const { data: mappings } = await sb.from('approver_mappings')
    .select('employee_id, approver_employee_id')
    .in('employee_id', empIds);
  const approverEmpIds = [...new Set((mappings || []).map(m => m.approver_employee_id))];
  if (!approverEmpIds.length) return {};
  const { data: aEmps } = await sb.from('employees')
    .select('id, first_name_th, last_name_th')
    .in('id', approverEmpIds);
  const nameById = Object.fromEntries(
    (aEmps || []).map(e => [e.id, [e.first_name_th, e.last_name_th].filter(Boolean).join(' ')])
  );
  const result = {};
  for (const m of (mappings || [])) {
    const name = nameById[m.approver_employee_id];
    if (!name) continue;
    if (!result[m.employee_id]) result[m.employee_id] = [];
    result[m.employee_id].push(name);
  }
  return result;
}

export async function getLeaveRequests({ scope, all } = {}, userId, empId, role) {
  const sb = supabase();
  let query = sb.from('leave_requests')
    .select('id, request_code, employee_id, leave_type_id, reason, total_days, status, submitted_at, created_at, leave_types(code), leave_request_periods(leave_date, days)')
    .is('deleted_at', null);

  if (role !== 'admin' && all !== '1') {
    if (scope === 'approver') {
      const { data: maps } = await sb.from('approver_mappings').select('employee_id').eq('approver_employee_id', empId);
      const ownEmpIds = [...new Set([empId, ...(maps || []).map(m => m.employee_id)])];
      query = query.in('employee_id', ownEmpIds);
    } else {
      query = query.eq('employee_id', empId);
    }
  }

  const { data: rows, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;

  const uniqueEmpIds = [...new Set((rows || []).map(r => r.employee_id))];
  const [empMap, approverNameMap] = await Promise.all([
    buildEmpMap(sb, uniqueEmpIds),
    (async () => {
      if (!uniqueEmpIds.length) return {};
      const { data: mappings } = await sb.from('approver_mappings')
        .select('employee_id, approver_employee_id')
        .in('employee_id', uniqueEmpIds);
      const approverEmpIds = [...new Set((mappings || []).map(m => m.approver_employee_id))];
      if (!approverEmpIds.length) return {};
      const { data: aEmps } = await sb.from('employees')
        .select('id, first_name_th, last_name_th')
        .in('id', approverEmpIds);
      const nameById = Object.fromEntries(
        (aEmps || []).map(e => [e.id, [e.first_name_th, e.last_name_th].filter(Boolean).join(' ')])
      );
      const result = {};
      for (const m of (mappings || [])) {
        const name = nameById[m.approver_employee_id];
        if (!name) continue;
        if (!result[m.employee_id]) result[m.employee_id] = [];
        result[m.employee_id].push(name);
      }
      return result;
    })(),
  ]);

  return (rows || []).map(r => {
    const parsed = parseLeaveRequest(r, empMap);
    if (!parsed) return null;
    const names = approverNameMap[r.employee_id];
    parsed.approver = names?.length ? names.join(' / ') : 'แอดมิน';
    return parsed;
  }).filter(Boolean);
}

export async function getRequestById(reqId) {
  const sb = supabase();
  const { data: r, error } = await sb.from('leave_requests')
    .select('id, request_code, employee_id, leave_type_id, reason, total_days, status, submitted_at, created_at, leave_types(code), leave_request_periods(leave_date, days)')
    .eq('id', reqId).is('deleted_at', null).maybeSingle();
  if (error || !r) return null;
  const [empMap, mappings] = await Promise.all([
    buildEmpMap(sb, [r.employee_id]),
    sb.from('approver_mappings').select('approver_employee_id').eq('employee_id', r.employee_id),
  ]);
  const parsed = parseLeaveRequest(r, empMap);
  if (!parsed) return null;
  const approverEmpIds = (mappings.data || []).map(m => m.approver_employee_id);
  if (approverEmpIds.length) {
    const { data: aEmps } = await sb.from('employees').select('id, first_name_th, last_name_th').in('id', approverEmpIds);
    const names = (aEmps || []).map(e => [e.first_name_th, e.last_name_th].filter(Boolean).join(' ')).filter(Boolean);
    if (names.length) parsed.approver = names.join(' / ');
  }
  if (!parsed.approver) parsed.approver = 'แอดมิน';
  return parsed;
}

export async function getRequestRaw(reqId) {
  const sb = supabase();
  const { data } = await sb.from('leave_requests').select('id, employee_id, status').eq('id', reqId).is('deleted_at', null).maybeSingle();
  return data;
}

export async function createLeaveRequest(body, empId, approverDisplay) {
  const sb = supabase();
  const lookups = await getLookups();
  const code   = LEAVE_LABEL_TO_CODE[body.type];
  const ltId   = code ? lookups.leaveTypeIds[code] : null;
  const reqCode = body.id || `REQ-${String(Date.now()).slice(-6)}`;

  const { data: req, error } = await sb.from('leave_requests').insert({
    request_code:        reqCode,
    employee_id:         empId,
    leave_type_id:       ltId,
    reason:              body.detail              || '',
    total_days:          body.days                ?? 0,
    status:              body.status              || 'pending',
    submitted_at:        new Date().toISOString(),
  }).select().single();
  if (error) throw new Error(error.message);

  // Insert date periods
  const start = body.startDateKey || body.dateKey || '';
  const end   = body.endDateKey   || start;
  if (start) {
    const periods = [];
    for (let d = new Date(start); d <= new Date(end); d.setDate(d.getDate() + 1)) {
      periods.push({ leave_request_id: req.id, leave_date: d.toISOString().slice(0, 10), period_type: 'full_day', days: 1 });
    }
    if (periods.length) await sb.from('leave_request_periods').insert(periods);
  }

  return getRequestById(req.id);
}

export async function updateRequest(reqId, updates, approverEmpId) {
  const sb = supabase();
  const lookups = await getLookups();
  const dbUpd = {};

  if (updates.status) {
    dbUpd.status = updates.status;
    if (updates.status === 'approved') {
      dbUpd.approved_by_employee_id = approverEmpId;
      dbUpd.approved_at = new Date().toISOString();
      await sb.from('approvals').insert({ request_type: 'leave', request_id: reqId, approver_employee_id: approverEmpId, action: 'approved' });
    } else if (updates.status === 'rejected') {
      await sb.from('approvals').insert({ request_type: 'leave', request_id: reqId, approver_employee_id: approverEmpId, action: 'rejected' });
    }
  }
  if (updates.type !== undefined) {
    const c = LEAVE_LABEL_TO_CODE[updates.type];
    if (c && lookups.leaveTypeIds[c]) dbUpd.leave_type_id = lookups.leaveTypeIds[c];
  }
  if (updates.detail !== undefined) dbUpd.reason      = updates.detail;
  if (updates.days   !== undefined) dbUpd.total_days  = updates.days;

  if (Object.keys(dbUpd).length) {
    await sb.from('leave_requests').update({ ...dbUpd, updated_at: new Date().toISOString() }).eq('id', reqId);
  }

  // Re-generate periods when dates change
  if (updates.startDateKey !== undefined || updates.endDateKey !== undefined) {
    const { data: existing } = await sb.from('leave_request_periods').select('leave_date').eq('leave_request_id', reqId).order('leave_date');
    const curStart = existing?.[0]?.leave_date || '';
    const curEnd   = existing?.[existing.length - 1]?.leave_date || curStart;
    const start = updates.startDateKey || curStart;
    const end   = updates.endDateKey   || curEnd;
    await sb.from('leave_request_periods').delete().eq('leave_request_id', reqId);
    const periods = [];
    for (let d = new Date(start); d <= new Date(end); d.setDate(d.getDate() + 1)) {
      periods.push({ leave_request_id: reqId, leave_date: d.toISOString().slice(0, 10), period_type: 'full_day', days: 1 });
    }
    if (periods.length) await sb.from('leave_request_periods').insert(periods);
  }

  return getRequestById(reqId);
}

export async function deleteRequest(reqId, isAdmin = false) {
  const sb = supabase();
  await sb.from('leave_requests').update({ deleted_at: new Date().toISOString(), deleted_by_admin: isAdmin }).eq('id', reqId);
}

// Used by requests route for quota validation
export async function usedDaysThisYear(empId, leaveLabel, yearPrefix) {
  const sb = supabase();
  const lookups = await getLookups();
  const code = LEAVE_LABEL_TO_CODE[leaveLabel];
  if (!code) return 0;
  const ltId = lookups.leaveTypeIds[code];
  if (!ltId) return 0;

  const { data: reqs } = await sb.from('leave_requests')
    .select('total_days, leave_request_periods(leave_date)')
    .eq('employee_id', empId)
    .eq('leave_type_id', ltId)
    .is('deleted_at', null)
    .in('status', ['approved', 'pending']);

  let used = 0;
  for (const r of (reqs || [])) {
    const inYear = (r.leave_request_periods || []).some(p => (p.leave_date || '').startsWith(yearPrefix));
    if (inYear) used += Number(r.total_days) || 0;
  }
  return used;
}

// ─── Checkin / Attendance queries ─────────────────────────────────────────────

export async function getCheckinRaw(id) {
  const sb = supabase();
  const { data } = await sb.from('attendances')
    .select('id, employee_id')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  return data;
}

function parseAttendance(att, empMap = {}) {
  if (!att) return null;
  const emp = empMap[att.employee_id] || {};
  const location = att.check_in_latitude != null
    ? { lat: Number(att.check_in_latitude), lng: Number(att.check_in_longitude), address: att.check_in_custom_location || '' }
    : (att.check_in_custom_location || null);

  return {
    id:           att.id,
    ownerId:      emp.user_id  || att.employee_id,
    ownerKey:     att.employee_id,
    employeeId:   att.employee_id,
    dateKey:      toDateKey(att.work_date),
    time:         toTimeStr(att.check_in_at),
    type:         'checkin',
    location,
    checkOutTime: toTimeStr(att.check_out_at),
    workHours:    att.work_hours,
    isHolidayWork: att.is_holiday_work,
    notes:        att.notes,
    createdAt:    att.created_at,
  };
}

export async function getCheckins({ scope, all } = {}, userId, empId, role) {
  const sb = supabase();
  let query = sb.from('attendances').select('*').is('deleted_at', null);

  if (role !== 'admin' && all !== '1') {
    if (scope === 'team') {
      const { data: empl } = await sb.from('employee_employments')
        .select('department_id, position_levels(name_th, name_en)')
        .eq('employee_id', empId).maybeSingle();
      const empLevelName = empl?.position_levels?.name_en || empl?.position_levels?.name_th || '';
      if (empLevelName === 'Board Level') {
        // sees all — no filter
      } else if (empl?.department_id) {
        const { data: deptEmps } = await sb.from('employee_employments').select('employee_id').eq('department_id', empl.department_id);
        const ids = (deptEmps || []).map(e => e.employee_id);
        query = query.in('employee_id', ids.length ? ids : [empId]);
      }
      // else: no department assigned → no scope restriction, show all team check-ins
    } else {
      query = query.eq('employee_id', empId);
    }
  }

  const { data: rows, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;

  const empIds = [...new Set((rows || []).map(r => r.employee_id))];
  let empMap = {};
  if (empIds.length) {
    const { data: emps } = await sb.from('employees').select('id, user_id').in('id', empIds);
    empMap = Object.fromEntries((emps || []).map(e => [e.id, { user_id: e.user_id }]));
  }
  return (rows || []).map(r => parseAttendance(r, empMap)).filter(Boolean);
}

export async function createCheckin(body, empId) {
  const sb = supabase();
  const dateKey = body.dateKey || new Date().toISOString().slice(0, 10);
  const timeStr = body.time    || new Date().toTimeString().slice(0, 5);
  const type    = body.type    || 'checkin';

  const loc        = body.location;
  const locIsObj   = loc && typeof loc === 'object';
  const lat        = locIsObj ? (loc.lat ?? null) : null;
  const lng        = locIsObj ? (loc.lng ?? null) : null;
  const addr       = typeof loc === 'string' ? loc : (locIsObj ? (loc.address || '') : '');
  const ts         = toBangkokISOString(dateKey, timeStr);

  if (type === 'checkout') {
    const { data: existing } = await sb.from('attendances')
      .select('id').eq('employee_id', empId).eq('work_date', dateKey).is('deleted_at', null).maybeSingle();
    if (existing) {
      const { data: upd } = await sb.from('attendances')
        .update({ check_out_at: ts, check_out_custom_location: addr, updated_at: new Date().toISOString() })
        .eq('id', existing.id).select().single();
      const { data: emp } = await sb.from('employees').select('id, user_id').eq('id', empId).maybeSingle();
      return parseAttendance(upd, emp ? { [emp.id]: { user_id: emp.user_id } } : {});
    }
  }

  const { data: att, error } = await sb.from('attendances').insert({
    employee_id:        empId,
    work_date:          dateKey,
    check_in_at:        ts,
    check_in_latitude:  lat,
    check_in_longitude: lng,
    check_in_custom_location: addr,
    is_holiday_work:    false,
    notes:              body.note || body.notes || null,
  }).select().single();
  if (error) throw new Error(error.message);

  const { data: emp } = await sb.from('employees').select('id, user_id').eq('id', empId).maybeSingle();
  return parseAttendance(att, emp ? { [emp.id]: { user_id: emp.user_id } } : {});
}

export async function updateCheckin(attId, body) {
  const sb = supabase();
  const { data: att } = await sb.from('attendances').select('*').eq('id', attId).maybeSingle();
  if (!att) return null;

  const upd = {};
  if (body.dateKey !== undefined) upd.work_date = body.dateKey;
  if (body.time    !== undefined) {
    const dateStr = body.dateKey || toDateKey(att.work_date);
    upd.check_in_at = toBangkokISOString(dateStr, body.time);
  }
  if (body.notes !== undefined) upd.notes = body.notes;
  if (body.note  !== undefined) upd.notes = body.note;
  if (body.checkOutTime !== undefined) {
    if (body.checkOutTime) {
      const dateStr = body.dateKey || toDateKey(att.work_date);
      upd.check_out_at = toBangkokISOString(dateStr, body.checkOutTime);
    } else {
      upd.check_out_at = null;
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'location')) {
    const loc = body.location;
    if (loc == null) {
      upd.check_in_latitude = null;
      upd.check_in_longitude = null;
      upd.check_in_custom_location = '';
    } else if (typeof loc === 'string') {
      upd.check_in_custom_location = loc;
    } else {
      upd.check_in_latitude  = loc.lat ?? null;
      upd.check_in_longitude = loc.lng ?? null;
      upd.check_in_custom_location = loc.address || '';
    }
  }

  if (Object.keys(upd).length) {
    await sb.from('attendances').update({ ...upd, updated_at: new Date().toISOString() }).eq('id', attId);
  }
  const { data: fresh } = await sb.from('attendances').select('*').eq('id', attId).single();
  const { data: emp }   = await sb.from('employees').select('id, user_id').eq('id', att.employee_id).maybeSingle();
  return parseAttendance(fresh, emp ? { [emp.id]: { user_id: emp.user_id } } : {});
}

export async function deleteCheckin(attId) {
  const sb = supabase();
  await sb.from('attendances').update({ deleted_at: new Date().toISOString() }).eq('id', attId);
}

// ─── Entitlement queries ──────────────────────────────────────────────────────

export async function getEntitlementForEmployee(empId, startDate) {
  const sb = supabase();
  const lookups = await getLookups();
  const year = new Date().getFullYear();

  const { data: balances } = await sb.from('leave_balances')
    .select('leave_type_id, entitled_days, carry_over_days, leave_types(code)')
    .eq('employee_id', empId).eq('period_year', year).is('deleted_at', null);

  const out = {};
  for (const t of LEAVE_TYPES) {
    const code    = LEAVE_ID_TO_CODE[t.id];
    const balance = (balances || []).find(b => b.leave_types?.code === code);

    if (t.id === 'annual') {
      const tenureYears = computeTenureYears(startDate);
      const annualBase  = annualQuotaForTenure(tenureYears);
      const carryOver   = Number(balance?.carry_over_days) || 0;
      out[t.id]          = annualBase + carryOver;
      out._annualBase    = annualBase;
      out._annualCarryOver = carryOver;
    } else {
      out[t.id] = balance ? Number(balance.entitled_days) : (t.quota ?? 0);
    }
  }
  return out;
}

export async function getAllEntitlements() {
  const sb = supabase();
  const lookups = await getLookups();
  const empRoleId = lookups.roleIds['employee'];
  if (!empRoleId) return {};

  const { data: userRoles } = await sb.from('user_roles').select('user_id').eq('role_id', empRoleId);
  const userIds = (userRoles || []).map(ur => ur.user_id);
  if (!userIds.length) return {};

  const { data: emps } = await sb.from('employees')
    .select('id, user_id, employee_employments(start_date)')
    .in('user_id', userIds);

  const result = {};
  for (const emp of (emps || [])) {
    const startDate = (emp.employee_employments || [])[0]?.start_date;
    result[emp.user_id] = await getEntitlementForEmployee(emp.id, startDate);
  }
  return result;
}

export async function updateEntitlement(empId, body) {
  const sb = supabase();
  const lookups = await getLookups();
  const year = new Date().getFullYear();

  for (const t of LEAVE_TYPES) {
    if (!(t.id in body)) continue;
    const n = Number(body[t.id]);
    if (!Number.isFinite(n)) continue;
    const ltId = lookups.leaveTypeIds[LEAVE_ID_TO_CODE[t.id]];
    if (!ltId) continue;

    const carryOver = (t.id === 'annual' && body._annualCarryOver !== undefined)
      ? Math.max(0, Math.min(20, Number(body._annualCarryOver)))
      : undefined;

    const { data: ex } = await sb.from('leave_balances').select('id')
      .eq('employee_id', empId).eq('leave_type_id', ltId).eq('period_year', year).maybeSingle();
    const bd = { entitled_days: n };
    if (carryOver !== undefined) bd.carry_over_days = carryOver;

    if (ex) {
      await sb.from('leave_balances').update({ ...bd, updated_at: new Date().toISOString() }).eq('id', ex.id);
    } else {
      await sb.from('leave_balances').insert({ employee_id: empId, leave_type_id: ltId, period_year: year, entitled_days: n, carry_over_days: carryOver || 0 });
    }
  }

  // _annualCarryOver alone
  if (body._annualCarryOver !== undefined && !('annual' in body)) {
    const ltId = lookups.leaveTypeIds['ANNUAL'];
    if (ltId) {
      const carryOver = Math.max(0, Math.min(20, Number(body._annualCarryOver)));
      const { data: ex } = await sb.from('leave_balances').select('id')
        .eq('employee_id', empId).eq('leave_type_id', ltId).eq('period_year', year).maybeSingle();
      if (ex) await sb.from('leave_balances').update({ carry_over_days: carryOver }).eq('id', ex.id);
    }
  }
}

export async function snapshotAnnualCarry(yearPrefix) {
  const sb = supabase();
  const lookups = await getLookups();
  const year  = Number(yearPrefix) || new Date().getFullYear();
  const ltId  = lookups.leaveTypeIds['ANNUAL'];
  const empRoleId = lookups.roleIds['employee'];

  const { data: userRoles } = await sb.from('user_roles').select('user_id').eq('role_id', empRoleId);
  const userIds = (userRoles || []).map(ur => ur.user_id);
  const { data: emps } = await sb.from('employees')
    .select('id, user_id, first_name_th, last_name_th, employee_employments(start_date)')
    .in('user_id', userIds);

  const summary = [];
  for (const emp of (emps || [])) {
    const startDate    = (emp.employee_employments || [])[0]?.start_date;
    const tenureYears  = computeTenureYears(startDate);
    const annualBase   = annualQuotaForTenure(tenureYears);

    const { data: balance } = await sb.from('leave_balances').select('id, carry_over_days')
      .eq('employee_id', emp.id).eq('leave_type_id', ltId).eq('period_year', year).maybeSingle();
    const previousCarry = Number(balance?.carry_over_days) || 0;
    const quota    = annualBase + previousCarry;
    const used     = await usedDaysThisYear(emp.id, 'Annual Leave', String(year));
    const remaining = Math.max(quota - used, 0);
    const newCarry  = Math.min(remaining, 20);
    const excess    = Math.max(remaining - 20, 0);

    if (balance) {
      await sb.from('leave_balances').update({ carry_over_days: newCarry }).eq('id', balance.id);
    } else if (ltId) {
      await sb.from('leave_balances').insert({ employee_id: emp.id, leave_type_id: ltId, period_year: year, entitled_days: annualBase, carry_over_days: newCarry });
    }
    summary.push({
      userId:     emp.user_id,
      employeeId: emp.id,
      nameTh:     [emp.first_name_th, emp.last_name_th].filter(Boolean).join(' '),
      quota, used, remaining, previousCarry, newCarry, excess,
    });
  }
  return summary;
}

// ─── Attendance Exception (Work Outside) requests ────────────────────────────

function parseAttendanceExceptionRequest(r, empMap = {}) {
  if (!r) return null;
  const emp = empMap[r.employee_id] || {};
  const typeRow = r.attendance_exception_types || {};
  return {
    id:           r.id,
    ownerKey:     r.employee_id,
    ownerId:      emp.user_id || r.employee_id,
    ownerName:    emp.name    || '',
    employeeId:   r.employee_id,
    userId:       emp.user_id || r.employee_id,
    userName:     emp.name    || '',
    type:         'Work Outside',
    subTypeCode:  typeRow.code     || '',
    subType:      typeRow.label_th || '',
    detail:       [typeRow.label_th, r.location, r.reason].filter(Boolean).join(' · '),
    status:       r.status,
    date:         r.start_date || '',
    dateKey:      r.start_date || '',
    startDateKey: r.start_date || '',
    endDateKey:   r.end_date   || r.start_date || '',
    startTime:    r.start_time || '',
    endTime:      r.end_time   || '',
    totalHours:   r.total_hours,
    location:     r.location   || '',
    reason:       r.reason     || '',
    days:         0,
    approver:     '',
    createdAt:    r.created_at,
    requestCode:  r.request_code,
    _kind:        'attendance_exception',
  };
}

export async function getAttendanceExceptionRequestRaw(reqId) {
  const sb = supabase();
  const { data } = await sb.from('attendance_exception_requests')
    .select('id, employee_id, status').eq('id', reqId).is('deleted_at', null).maybeSingle();
  return data;
}

export async function getAttendanceExceptionRequestById(reqId) {
  const sb = supabase();
  const { data: r } = await sb.from('attendance_exception_requests')
    .select('*, attendance_exception_types(code, label_th, label_en)')
    .eq('id', reqId).is('deleted_at', null).maybeSingle();
  if (!r) return null;
  const [empMap, approverNameMap] = await Promise.all([
    buildEmpMap(sb, [r.employee_id]),
    buildApproverNameMap(sb, [r.employee_id]),
  ]);
  const parsed = parseAttendanceExceptionRequest(r, empMap);
  if (parsed) {
    const names = approverNameMap[r.employee_id];
    parsed.approver = names?.length ? names.join(' / ') : 'แอดมิน';
  }
  return parsed;
}

export async function getAttendanceExceptionRequests({ scope, all } = {}, userId, empId, role) {
  const sb = supabase();
  let query = sb.from('attendance_exception_requests')
    .select('*, attendance_exception_types(code, label_th, label_en)')
    .is('deleted_at', null);

  if (role !== 'admin' && all !== '1') {
    if (scope === 'approver') {
      const { data: maps } = await sb.from('approver_mappings').select('employee_id').eq('approver_employee_id', empId);
      const ownEmpIds = [...new Set([empId, ...(maps || []).map(m => m.employee_id)])];
      query = query.in('employee_id', ownEmpIds);
    } else {
      query = query.eq('employee_id', empId);
    }
  }

  const { data: rows, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;

  const empIds = [...new Set((rows || []).map(r => r.employee_id))];
  const [empMap, approverNameMap] = await Promise.all([
    buildEmpMap(sb, empIds),
    buildApproverNameMap(sb, empIds),
  ]);
  return (rows || []).map(r => {
    const parsed = parseAttendanceExceptionRequest(r, empMap);
    if (!parsed) return null;
    const names = approverNameMap[r.employee_id];
    parsed.approver = names?.length ? names.join(' / ') : 'แอดมิน';
    return parsed;
  }).filter(Boolean);
}

export async function createAttendanceExceptionRequest(body, empId) {
  const sb = supabase();
  const code = body.exceptionTypeCode || body.subTypeCode;
  if (!code) throw new Error('exceptionTypeCode required');
  const { data: type } = await sb.from('attendance_exception_types')
    .select('id').eq('code', code).maybeSingle();
  if (!type) throw new Error(`unknown exception type: ${code}`);

  const reqCode = body.id || `WO-${String(Date.now()).slice(-6)}`;
  const { data: req, error } = await sb.from('attendance_exception_requests').insert({
    request_code:                 reqCode,
    employee_id:                  empId,
    attendance_exception_type_id: type.id,
    start_date:                   body.startDateKey,
    end_date:                     body.endDateKey || body.startDateKey,
    start_time:                   body.startTime  || null,
    end_time:                     body.endTime    || null,
    total_hours:                  body.totalHours ?? null,
    location:                     body.location   || null,
    reason:                       body.reason     || body.detail || null,
    status:                       body.status     || 'pending',
  }).select().single();
  if (error) throw new Error(error.message);
  return getAttendanceExceptionRequestById(req.id);
}

export async function updateAttendanceExceptionRequest(reqId, updates, approverEmpId) {
  const sb = supabase();
  const upd = {};
  if (updates.status) {
    upd.status = updates.status;
    if (updates.status === 'approved') {
      upd.approved_by_employee_id = approverEmpId;
      upd.approved_at = new Date().toISOString();
      await sb.from('approvals').insert({ request_type: 'attendance_exception', request_id: reqId, approver_employee_id: approverEmpId, action: 'approved' });
    } else if (updates.status === 'rejected') {
      await sb.from('approvals').insert({ request_type: 'attendance_exception', request_id: reqId, approver_employee_id: approverEmpId, action: 'rejected' });
    }
  }
  if (Object.keys(upd).length) {
    await sb.from('attendance_exception_requests')
      .update({ ...upd, updated_at: new Date().toISOString() }).eq('id', reqId);
  }
  return getAttendanceExceptionRequestById(reqId);
}

export async function deleteAttendanceExceptionRequest(reqId, isAdmin = false) {
  const sb = supabase();
  await sb.from('attendance_exception_requests')
    .update({ deleted_at: new Date().toISOString(), deleted_by_admin: isAdmin }).eq('id', reqId);
}

// ─── Document requests ───────────────────────────────────────────────────────

// Document workflow uses different status values in the DB (pending/ready/collected/rejected)
// than the generic admin UI vocabulary (pending/approved/rejected). Translate at the boundary
// so callers (admin Requests page) keep using the generic vocabulary.
function docDbStatusToApi(s) {
  if (s === 'ready' || s === 'collected') return 'approved';
  return s;
}
function docApiStatusToDb(s) {
  if (s === 'approved') return 'ready';
  return s;
}

function parseDocumentRequest(r, empMap = {}) {
  if (!r) return null;
  const emp = empMap[r.employee_id] || {};
  const typeRow = r.document_request_types || {};
  return {
    id:           r.id,
    ownerKey:     r.employee_id,
    ownerId:      emp.user_id || r.employee_id,
    ownerName:    emp.name    || '',
    employeeId:   r.employee_id,
    userId:       emp.user_id || r.employee_id,
    userName:     emp.name    || '',
    type:         'Request Documents',
    subTypeCode:  typeRow.code    || '',
    subType:      typeRow.name_th || '',
    detail:       [typeRow.name_th, r.purpose].filter(Boolean).join(' · '),
    purpose:      r.purpose || '',
    status:       docDbStatusToApi(r.status),
    date:         toDateKey(r.created_at) || '',
    dateKey:      toDateKey(r.created_at) || '',
    startDateKey: '',
    endDateKey:   '',
    dueDate:      r.due_date || '',
    readyAt:      r.ready_at || '',
    collectedAt:  r.collected_at || '',
    days:         0,
    approver:     '',
    createdAt:    r.created_at,
    requestCode:  r.request_code,
    _kind:        'document',
  };
}

export async function getDocumentRequestRaw(reqId) {
  const sb = supabase();
  const { data } = await sb.from('document_requests')
    .select('id, employee_id, status').eq('id', reqId).is('deleted_at', null).maybeSingle();
  return data;
}

export async function getDocumentRequestById(reqId) {
  const sb = supabase();
  const { data: r } = await sb.from('document_requests')
    .select('*, document_request_types(code, name_th)')
    .eq('id', reqId).is('deleted_at', null).maybeSingle();
  if (!r) return null;
  const empMap = await buildEmpMap(sb, [r.employee_id]);
  const parsed = parseDocumentRequest(r, empMap);
  if (parsed) parsed.approver = 'Admin';
  return parsed;
}

export async function getDocumentRequests({ scope, all } = {}, userId, empId, role) {
  const sb = supabase();
  let query = sb.from('document_requests')
    .select('*, document_request_types(code, name_th)')
    .is('deleted_at', null);

  // Document requests are owned by their submitter and reviewed only by admins.
  // Even if a Board/Director is the leave-approver of someone, they should NOT
  // see other people's document requests — restrict scope=approver to own only.
  if (role !== 'admin' && all !== '1') {
    query = query.eq('employee_id', empId);
  }

  const { data: rows, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;

  const empIds = [...new Set((rows || []).map(r => r.employee_id))];
  const empMap = await buildEmpMap(sb, empIds);
  return (rows || []).map(r => {
    const parsed = parseDocumentRequest(r, empMap);
    if (!parsed) return null;
    parsed.approver = 'Admin';
    return parsed;
  }).filter(Boolean);
}

export async function createDocumentRequest(body, empId) {
  const sb = supabase();
  const code = body.documentTypeCode || body.subTypeCode;
  if (!code) throw new Error('documentTypeCode required');
  const { data: type } = await sb.from('document_request_types')
    .select('id').eq('code', code).is('deleted_at', null).maybeSingle();
  if (!type) throw new Error(`unknown document type: ${code}`);

  const reqCode = body.id || `DOC-${String(Date.now()).slice(-6)}`;
  const purpose = body.purpose
    ?? [body.language, body.note].filter(Boolean).join(' · ')
    ?? null;

  const { data: req, error } = await sb.from('document_requests').insert({
    request_code:             reqCode,
    employee_id:              empId,
    document_request_type_id: type.id,
    purpose:                  purpose || null,
    status:                   body.status || 'pending',
  }).select().single();
  if (error) throw new Error(error.message);
  return getDocumentRequestById(req.id);
}

export async function updateDocumentRequest(reqId, updates, approverEmpId) {
  console.log('[updateDocumentRequest] START reqId=', reqId, 'updates=', JSON.stringify(updates), 'approverEmpId=', approverEmpId);
  const sb = supabase();
  const upd = {};
  if (updates.status) {
    upd.status = docApiStatusToDb(updates.status);
    if (updates.status === 'approved') {
      upd.processed_by_employee_id = approverEmpId;
      upd.ready_at = new Date().toISOString();
      const { error: aErr } = await sb.from('approvals').insert({ request_type: 'document', request_id: reqId, approver_employee_id: approverEmpId, action: 'approved' });
      if (aErr) console.error('[updateDocumentRequest] approvals.insert error:', aErr.message, aErr.details, aErr.hint);
      else console.log('[updateDocumentRequest] approvals.insert OK (approved)');
    } else if (updates.status === 'rejected') {
      const { error: aErr } = await sb.from('approvals').insert({ request_type: 'document', request_id: reqId, approver_employee_id: approverEmpId, action: 'rejected' });
      if (aErr) console.error('[updateDocumentRequest] approvals.insert error:', aErr.message, aErr.details, aErr.hint);
      else console.log('[updateDocumentRequest] approvals.insert OK (rejected)');
    }
  }
  if (Object.keys(upd).length) {
    const { error: uErr } = await sb.from('document_requests')
      .update({ ...upd, updated_at: new Date().toISOString() }).eq('id', reqId);
    if (uErr) console.error('[updateDocumentRequest] document_requests.update error:', uErr.message, uErr.details, uErr.hint);
    else console.log('[updateDocumentRequest] document_requests.update OK upd=', JSON.stringify(upd));
  } else {
    console.warn('[updateDocumentRequest] nothing to update (no upd keys)');
  }
  const result = await getDocumentRequestById(reqId);
  console.log('[updateDocumentRequest] DONE returning status=', result?.status);
  return result;
}

export async function deleteDocumentRequest(reqId, isAdmin = false) {
  const sb = supabase();
  await sb.from('document_requests')
    .update({ deleted_at: new Date().toISOString(), deleted_by_admin: isAdmin }).eq('id', reqId);
}

// ─── Aggregator: combine leave + attendance_exception + document ─────────────

export async function getRequests(opts, userId, empId, role) {
  const [leaves, aers, docs] = await Promise.all([
    getLeaveRequests(opts, userId, empId, role),
    getAttendanceExceptionRequests(opts, userId, empId, role),
    getDocumentRequests(opts, userId, empId, role),
  ]);
  return [...leaves, ...aers, ...docs].sort((a, b) =>
    String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

// ─── Deleted requests history (admin only) ───────────────────────────────────

async function getDeletedLeaveRequests() {
  const sb = supabase();
  const { data: rows, error } = await sb.from('leave_requests')
    .select('id, request_code, employee_id, leave_type_id, reason, total_days, status, submitted_at, created_at, deleted_at, leave_types(code), leave_request_periods(leave_date, days)')
    .not('deleted_at', 'is', null)
    .eq('deleted_by_admin', true)
    .order('deleted_at', { ascending: false });
  if (error) throw error;
  const uniqueEmpIds = [...new Set((rows || []).map(r => r.employee_id))];
  const empMap = await buildEmpMap(sb, uniqueEmpIds);
  return (rows || []).map(r => {
    const parsed = parseLeaveRequest(r, empMap);
    if (!parsed) return null;
    parsed.deletedAt = r.deleted_at;
    return parsed;
  }).filter(Boolean);
}

async function getDeletedAttendanceExceptionRequests() {
  const sb = supabase();
  const { data: rows, error } = await sb.from('attendance_exception_requests')
    .select('*, attendance_exception_types(code, label_th, label_en)')
    .not('deleted_at', 'is', null)
    .eq('deleted_by_admin', true)
    .order('deleted_at', { ascending: false });
  if (error) throw error;
  const empIds = [...new Set((rows || []).map(r => r.employee_id))];
  const empMap = await buildEmpMap(sb, empIds);
  return (rows || []).map(r => {
    const parsed = parseAttendanceExceptionRequest(r, empMap);
    if (!parsed) return null;
    parsed.deletedAt = r.deleted_at;
    return parsed;
  }).filter(Boolean);
}

async function getDeletedDocumentRequests() {
  const sb = supabase();
  const { data: rows, error } = await sb.from('document_requests')
    .select('*, document_request_types(code, name_th)')
    .not('deleted_at', 'is', null)
    .eq('deleted_by_admin', true)
    .order('deleted_at', { ascending: false });
  if (error) throw error;
  const empIds = [...new Set((rows || []).map(r => r.employee_id))];
  const empMap = await buildEmpMap(sb, empIds);
  return (rows || []).map(r => {
    const parsed = parseDocumentRequest(r, empMap);
    if (!parsed) return null;
    parsed.deletedAt = r.deleted_at;
    parsed.approver = 'Admin';
    return parsed;
  }).filter(Boolean);
}

export async function getDeletedRequests() {
  const [leaves, aers, docs] = await Promise.all([
    getDeletedLeaveRequests(),
    getDeletedAttendanceExceptionRequests(),
    getDeletedDocumentRequests(),
  ]);
  return [...leaves, ...aers, ...docs].sort((a, b) =>
    String(b.deletedAt || '').localeCompare(String(a.deletedAt || '')));
}

// ─── Company holidays ────────────────────────────────────────────────────────

export async function getHolidaysInRange(startDate, endDate, companyId = 1) {
  const sb = supabase();
  const { data, error } = await sb
    .from('company_holidays')
    .select('holiday_date')
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .gte('holiday_date', startDate)
    .lte('holiday_date', endDate);
  if (error) throw new Error(error.message);
  return (data || []).map((r) => r.holiday_date);
}

export async function getHolidaysForYear(year, companyId = 1) {
  const sb = supabase();
  const { data, error } = await sb
    .from('company_holidays')
    .select('holiday_date, name, is_compensable')
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .gte('holiday_date', `${year}-01-01`)
    .lte('holiday_date', `${year}-12-31`)
    .order('holiday_date');
  if (error) throw new Error(error.message);
  return data || [];
}
