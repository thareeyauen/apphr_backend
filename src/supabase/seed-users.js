// Run with: node --experimental-vm-modules src/supabase/seed-users.js
// Or add to package.json: "seed:users": "node src/supabase/seed-users.js"
//
// Seeds admin user + 15 employees into Supabase.
// Idempotent — skips rows that already exist.

import bcrypt from 'bcryptjs';
import { supabase } from './client.js';

function parseDMY(str) {
  if (!str) return null;
  const [d, m, y] = str.split('/');
  if (!d || !m || !y) return null;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

async function getLookups() {
  const [depts, pos, levels, etypes, banks, roles] = await Promise.all([
    supabase.from('departments').select('id, name_th, name_en'),
    supabase.from('positions').select('id, name_th, name_en'),
    supabase.from('position_levels').select('id, name_th, name_en'),
    supabase.from('employment_types').select('id, name_th'),
    supabase.from('banks').select('id, name_th'),
    supabase.from('roles').select('id, code'),
  ]);
  // build maps keyed by both name_th and name_en so either language works
  const byBothNames = (rows) => {
    const m = {};
    for (const r of rows || []) {
      if (r.name_th) m[r.name_th] = r.id;
      if (r.name_en) m[r.name_en] = r.id;
    }
    return m;
  };
  return {
    departmentIds:     byBothNames(depts.data),
    positionIds:       byBothNames(pos.data),
    positionLevelIds:  byBothNames(levels.data),
    employmentTypeIds: Object.fromEntries((etypes.data || []).map(r => [r.name_th, r.id])),
    bankIds:           Object.fromEntries((banks.data  || []).map(r => [r.name_th, r.id])),
    roleIds:           Object.fromEntries((roles.data  || []).map(r => [r.code, r.id])),
  };
}

async function upsertUser(userId, email, hash, lookups, isAdmin = false) {
  const roleCode = isAdmin ? 'admin' : 'employee';
  const roleId   = lookups.roleIds[roleCode];

  // 1. users row
  const { error: uErr } = await supabase.from('users').upsert(
    { id: userId, email, password_hash: hash, must_change_password: false, is_active: true },
    { onConflict: 'id', ignoreDuplicates: true }
  );
  if (uErr) throw new Error(`[users:${userId}] ${uErr.message}`);

  // 2. user_roles row
  if (roleId) {
    await supabase.from('user_roles').upsert(
      { user_id: userId, role_id: roleId },
      { onConflict: 'user_id,role_id', ignoreDuplicates: true }
    );
  }
}

async function upsertEmployee(empId, userId, data, lookups) {
  const nameParts = (data.nameTh || '').replace(/^ดร\.\s*/, '').trim().split(/\s+/);
  const firstTh = nameParts[0] || '';
  const lastTh  = nameParts.slice(1).join(' ');
  const email   = data.email || `${userId}@hand.co.th`;

  // employees row
  const { error: eErr } = await supabase.from('employees').upsert(
    {
      id: empId,
      user_id: userId,
      first_name_th: firstTh,
      last_name_th:  lastTh,
      first_name_en: data.nameEn || firstTh,
      last_name_en:  data.nameEnLast || lastTh,
      nickname_th:   firstTh,
      national_id:   `gen_${empId}`,
      company_email: email,
      is_active:     true,
    },
    { onConflict: 'id', ignoreDuplicates: true }
  );
  if (eErr) throw new Error(`[employees:${empId}] ${eErr.message}`);

  // employee_employments
  const deptId  = lookups.departmentIds[data.department];
  const posId   = lookups.positionIds[data.position];
  const levelId = lookups.positionLevelIds[data.employeeLevel];
  const etypeId = lookups.employmentTypeIds[data.employeeType || ''];

  if (deptId && posId && levelId) {
    // delete existing row then re-insert so the seed is always fresh
    await supabase.from('employee_employments').delete().eq('employee_id', empId);
    const { error: emplErr } = await supabase.from('employee_employments').insert({
      employee_id:          empId,
      department_id:        deptId,
      position_id:          posId,
      position_level_id:    levelId,
      employment_type_id:   etypeId || null,
      start_date:           parseDMY(data.startDate),
      probation_start_date: parseDMY(data.probationStart),
      probation_end_date:   parseDMY(data.probationEnd),
    });
    if (emplErr) console.warn(`  ⚠ employee_employments [${empId}]: ${emplErr.message}`);
  } else {
    console.warn(`  ⚠ missing lookup for [${empId}]: dept=${deptId} pos=${posId} level=${levelId} (dept="${data.department}" pos="${data.position}" level="${data.employeeLevel}")`);
  }

  // bank account
  const bankId = lookups.bankIds['ธนาคารกสิกรไทย'] || null;
  if (data.bankAccount) {
    await supabase.from('employee_bank_accounts').upsert(
      {
        employee_id:     empId,
        bank_id:         bankId,
        account_number:  data.bankAccount,
        account_name:    data.nameTh,
        branch:          data.bankBranch || '',
        is_payroll_account: true,
      },
      { onConflict: 'employee_id,is_payroll_account', ignoreDuplicates: true }
    );
  }
}

// Emails match what's actually in Supabase (transliterated first name @ hand.co.th).
const EMPLOYEES = [
  { email: 'torplus@hand.co.th',     nameTh: 'ดร.ต่อภัสสร์ ยมนาค',   employeeId: 'H0001', position: 'Co-Founder and Chief Advisor',                   department: 'Board of Directors',                                      employeeLevel: 'Board Level' },
  { email: 'suppaut@hand.co.th',     nameTh: 'สุภอรรถ โบสุวรรณ',       employeeId: 'H0002', position: 'Managing Director',                               department: 'Board of Directors',                                      employeeLevel: 'Board Level' },
  { email: 'bhalangrata@hand.co.th', nameTh: 'พลังรัฐ รัชตะนาวิน',    employeeId: 'H0003', position: 'Director of Operations',                          department: 'Board of Directors',                                      employeeLevel: 'Board Level' },
  { email: 'yuthana@hand.co.th',     nameTh: 'ยุทธนา วังวสุ',          employeeId: 'H0004', position: 'Co-Founder and Director',                         department: 'Board of Directors',                                      employeeLevel: 'Board Level' },
  { email: 'supatja@hand.co.th',     nameTh: 'สุภัจจา อังค์สุวรรณ',   employeeId: 'H0006', position: 'Director of Research & Knowledge Management',    department: 'Good Governance Research and Learning Department',        employeeLevel: 'Director Level', employeeType: 'สัญญาจ้างประจำ', startDate: '18/12/2017', bankAccount: '0351293993' },
  { email: 'patcharee@hand.co.th',   nameTh: 'พัชรี ตรีพรม',           employeeId: 'H0007', position: 'Project Manager',                                 department: 'Collaboration and Coordination Department',               employeeLevel: 'Project Level',  employeeType: 'สัญญาจ้างประจำ', startDate: '18/12/2017', bankAccount: '0351575697' },
  { email: 'charassri@hand.co.th',   nameTh: 'จรัสศรี พะลายะสุต',     employeeId: 'H0008', position: 'Director of Accounting and Finance',              department: 'Accounting and Finance Department',                       employeeLevel: 'Director Level', employeeType: 'การจ้างที่ปรึกษา', startDate: '07/04/2019', bankAccount: '7722080984', bankBranch: 'Central World' },
  { email: 'rakpa@hand.co.th',       nameTh: 'รักษ์ป่า อู่สุวรรณ',    employeeId: 'H0015', position: 'Project Manager',                                 department: 'Open Data for Transparency & Participation Department', employeeLevel: 'Project Level',  employeeType: 'สัญญาจ้างประจำ', startDate: '03/07/2022', probationStart: '03/07/2022', probationEnd: '06/07/2022', bankAccount: '0138434362', bankBranch: 'บ้านดู่' },
  { email: 'saranchanok@hand.co.th', nameTh: 'ศรันย์ชนก ลิมวิสิฐธนกร', employeeId: 'H0025', position: 'Executive Assistant',                            department: 'Collaboration and Coordination Department',               employeeLevel: 'Project Level',  employeeType: 'สัญญาจ้างประจำ', startDate: '04/03/2023', probationStart: '04/03/2023', bankAccount: '0238067782', bankBranch: 'บางกระบือ' },
  { email: 'thareeya@hand.co.th',    nameTh: 'ธรีญา อึ้งตระกูล',      employeeId: 'H0029', position: 'Project coordinator',                             department: 'Open Data for Transparency & Participation Department', employeeLevel: 'Project Level',  employeeType: 'สัญญาจ้างประจำ', startDate: '08/07/2023', probationStart: '08/07/2023', bankAccount: '0533261361', bankBranch: 'ฟิวเจอร์ พาร์ค รังสิต' },
  { email: 'jatupron@hand.co.th',    nameTh: 'จตุพร ศิรเลิศมุกุล',    employeeId: 'H0031', position: 'Accountant',                                       department: 'Accounting and Finance Department',                       employeeLevel: 'Project Level',  employeeType: 'สัญญาจ้างประจำ', startDate: '25/03/2024', probationStart: '25/03/2024', bankAccount: '1803680430', bankBranch: 'ฟิวเจอร์ พาร์ค รังสิต' },
  { email: 'thanakan@hand.co.th',    nameTh: 'ธนากาญจน์ กันทอง',      employeeId: 'H0032', position: 'Research Assistant',                              department: 'Good Governance Research and Learning Department',        employeeLevel: 'Project Level',  employeeType: 'สัญญาจ้างประจำ', startDate: '27/05/2024', probationStart: '27/05/2024', bankAccount: '0408689627', bankBranch: 'บิ๊กซี อ่อนนุช' },
  { email: 'suphachai@hand.co.th',   nameTh: 'ศุภชัย เสถียรหมั่น',    employeeId: 'H0033', position: 'Researcher',                                      department: 'Good Governance Research and Learning Department',        employeeLevel: 'Project Level',  employeeType: 'สัญญาจ้างประจำ', startDate: '06/10/2024', probationStart: '06/10/2024', bankAccount: '1861796600', bankBranch: 'จามจุรี สแควร์' },
  { email: 'suppawit@hand.co.th',    nameTh: 'ศุภวิชญ์ แก้วคูนอก',    employeeId: 'H0034', position: 'Center Manager of KRAC',                          department: 'Good Governance Research and Learning Department',        employeeLevel: 'Project Level',  employeeType: 'สัญญาจ้างประจำ', startDate: '09/09/2024', probationStart: '09/09/2024', probationEnd: '12/10/2024', bankAccount: '1928266644', bankBranch: 'ตลาดเกาะโพธิ์' },
  { email: 'sasathorn@hand.co.th',   nameTh: 'ศศธร เอี่ยมสะอาด',      employeeId: 'H0042', position: 'Content Writer',                                  department: 'Open Data for Transparency & Participation Department', employeeLevel: 'Project Level',  employeeType: 'สัญญาจ้างประจำ', startDate: '06/05/2025', probationStart: '06/05/2025', bankAccount: '0252721827', bankBranch: 'สาขาเซ็นทรัลพลาซ่า เชียงใหม่' },
];

async function ensurePositions(lookups) {
  // Positions used by employee data that may not be in the generic seed
  const needed = [
    { code: 'CO_FOUNDER_ADVISOR',  name_en: 'Co-Founder and Chief Advisor',                 name_th: 'Co-Founder and Chief Advisor' },
    { code: 'MANAGING_DIRECTOR',   name_en: 'Managing Director',                             name_th: 'Managing Director' },
    { code: 'DIR_OPERATIONS',      name_en: 'Director of Operations',                        name_th: 'Director of Operations' },
    { code: 'CO_FOUNDER_DIRECTOR', name_en: 'Co-Founder and Director',                       name_th: 'Co-Founder and Director' },
    { code: 'DIR_RESEARCH',        name_en: 'Director of Research & Knowledge Management',   name_th: 'Director of Research & Knowledge Management' },
    { code: 'PROJECT_MANAGER',     name_en: 'Project Manager',                               name_th: 'Project Manager' },
    { code: 'DIR_FINANCE',         name_en: 'Director of Accounting and Finance',            name_th: 'Director of Accounting and Finance' },
    { code: 'EXEC_ASSISTANT',      name_en: 'Executive Assistant',                           name_th: 'Executive Assistant' },
    { code: 'PROJECT_COORDINATOR', name_en: 'Project coordinator',                           name_th: 'Project coordinator' },
    { code: 'ACCOUNTANT',          name_en: 'Accountant',                                    name_th: 'Accountant' },
    { code: 'RESEARCH_ASSISTANT',  name_en: 'Research Assistant',                            name_th: 'Research Assistant' },
    { code: 'RESEARCHER',          name_en: 'Researcher',                                    name_th: 'Researcher' },
    { code: 'CENTER_MANAGER',      name_en: 'Center Manager of KRAC',                        name_th: 'Center Manager of KRAC' },
    { code: 'CONTENT_WRITER',      name_en: 'Content Writer',                                name_th: 'Content Writer' },
    { code: 'SYS_ADMIN',           name_en: 'System Administrator',                          name_th: 'System Administrator' },
  ];
  for (const p of needed) {
    if (!lookups.positionIds[p.name_en]) {
      await supabase.from('positions').upsert(p, { onConflict: 'code', ignoreDuplicates: true });
    }
  }
  // reload positions
  const { data } = await supabase.from('positions').select('id, name_th, name_en');
  for (const r of data || []) {
    if (r.name_th) lookups.positionIds[r.name_th] = r.id;
    if (r.name_en) lookups.positionIds[r.name_en] = r.id;
  }
}

async function main() {
  console.log('→ Loading lookup IDs from Supabase...');
  const lookups = await getLookups();
  await ensurePositions(lookups);

  const missingRoles = ['admin', 'employee'].filter(r => !lookups.roleIds[r]);
  if (missingRoles.length) {
    console.error(`❌ Missing roles in DB: ${missingRoles.join(', ')}. Run seed:supabase first.`);
    process.exit(1);
  }

  // ─── Admin user ────────────────────────────────────────────────────────
  const adminEmail = 'admin@hand.co.th';
  console.log(`\n• Admin user (${adminEmail})`);
  const adminHash = bcrypt.hashSync('Admin@123', 10);
  await upsertUser('admin', adminEmail, adminHash, lookups, true);
  // Admin needs an employees row so getUserByEmail can find them
  await upsertEmployee('admin', 'admin', {
    email: adminEmail,
    nameTh: 'แอดมิน ระบบ', nameEn: 'System', nameEnLast: 'Admin',
    position: 'System Administrator',
    department: Object.keys(lookups.departmentIds)[0] || '',
    employeeLevel: Object.keys(lookups.positionLevelIds)[0] || '',
  }, lookups);
  console.log('  ✓ admin / Admin@123');

  // ─── Employees ─────────────────────────────────────────────────────────
  console.log('\n• Employees');
  for (const e of EMPLOYEES) {
    const userId = e.employeeId.toLowerCase();
    const hash   = bcrypt.hashSync(`${e.employeeId}@123`, 10);
    await upsertUser(userId, e.email, hash, lookups, false);
    await upsertEmployee(e.employeeId, userId, e, lookups);
    console.log(`  ✓ ${e.employeeId}  ${e.email}  ${e.nameTh}`);
  }

  console.log('\n✅ Done. Users in system:');
  console.log('   Admin : admin@hand.co.th  / Admin@123');
  console.log('   Employees: torplus@hand.co.th / H0001@123  (etc., see EMPLOYEES list)');
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
