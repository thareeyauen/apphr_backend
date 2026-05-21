// Run with: npm run seed:supabase
// Idempotent — uses ON CONFLICT (code) DO NOTHING via upsert. Safe to re-run.
//
// Seeds the 13 lookup tables + 1 company + the admin role/permissions so that
// the rest of the app (employees, leave requests, attendances) can reference
// them by FK. After this runs, you can begin migrating employee data.

import { supabase, isSupabaseConfigured } from './client.js';

const CHECK_ICON = '✓';
const CROSS = '✗';

async function upsertByCode(table, rows) {
  const { data, error } = await supabase
    .from(table)
    .upsert(rows, { onConflict: 'code', ignoreDuplicates: false })
    .select('id, code');
  if (error) throw new Error(`[${table}] ${error.message}`);
  return data;
}

async function upsertByNaturalKey(table, rows, conflictColumn) {
  const { data, error } = await supabase
    .from(table)
    .upsert(rows, { onConflict: conflictColumn, ignoreDuplicates: false })
    .select();
  if (error) throw new Error(`[${table}] ${error.message}`);
  return data;
}

async function main() {
  if (!isSupabaseConfigured()) {
    console.error('❌ Supabase not configured.');
    process.exit(1);
  }
  console.log('→ Seeding lookup tables...\n');

  // ─── prefixes ───────────────────────────────────────────────────────
  console.log('• prefixes');
  await upsertByCode('prefixes', [
    { code: 'MR',   name_th: 'นาย' },
    { code: 'MRS',  name_th: 'นาง' },
    { code: 'MISS', name_th: 'นางสาว' },
    { code: 'DR',   name_th: 'ดร.' },
  ]);
  console.log(`  ${CHECK_ICON} 4 rows`);

  // ─── banks ──────────────────────────────────────────────────────────
  console.log('• banks');
  await upsertByCode('banks', [
    { code: 'KBANK', name_th: 'ธนาคารกสิกรไทย',     name_en: 'Kasikornbank' },
    { code: 'SCB',   name_th: 'ธนาคารไทยพาณิชย์',   name_en: 'Siam Commercial Bank' },
    { code: 'BBL',   name_th: 'ธนาคารกรุงเทพ',       name_en: 'Bangkok Bank' },
    { code: 'KTB',   name_th: 'ธนาคารกรุงไทย',       name_en: 'Krungthai Bank' },
    { code: 'BAY',   name_th: 'ธนาคารกรุงศรีอยุธยา', name_en: 'Bank of Ayudhya' },
    { code: 'TTB',   name_th: 'ธนาคารทหารไทยธนชาต',  name_en: 'TMBThanachart Bank' },
    { code: 'GSB',   name_th: 'ธนาคารออมสิน',         name_en: 'Government Savings Bank' },
  ]);
  console.log(`  ${CHECK_ICON} 7 rows`);

  // ─── companies ──────────────────────────────────────────────────────
  console.log('• companies');
  await upsertByNaturalKey('companies', [
    {
      name_th: 'บริษัท แฮนด์ วิสาหกิจเพื่อสังคม จำกัด',
      name_en: 'HAND SOCIAL ENTERPRISE COMPANY LIMITED',
      tax_id: '0105559009660',
      phone: '025506141',
      address_line: 'เลขที่ 13 ซอยอรรคพัฒน์ ถนนสุขุมวิท 49-4 แขวงคลองตันเหนือ เขตวัฒนา กรุงเทพมหานคร 10110',
      postcode: '10110',
    },
  ], 'tax_id');
  console.log(`  ${CHECK_ICON} 1 row`);

  const { data: companies } = await supabase.from('companies').select('id').limit(1);
  const COMPANY_ID = companies?.[0]?.id;
  if (!COMPANY_ID) throw new Error('No company row created');

  // ─── departments ────────────────────────────────────────────────────
  console.log('• departments');
  await upsertByCode('departments', [
    { code: 'BOD',  name_th: 'คณะกรรมการบริษัท',  name_en: 'Board of Directors',                                  company_id: COMPANY_ID, display_order: 1 },
    { code: 'GGR',  name_th: 'ฝ่ายวิจัยและพัฒนาธรรมาภิบาล', name_en: 'Good Governance Research and Learning Department', company_id: COMPANY_ID, display_order: 2 },
    { code: 'CC',   name_th: 'ฝ่ายความร่วมมือและประสานงาน', name_en: 'Collaboration and Coordination Department',     company_id: COMPANY_ID, display_order: 3 },
    { code: 'AF',   name_th: 'ฝ่ายบัญชีและการเงิน',  name_en: 'Accounting and Finance Department',                    company_id: COMPANY_ID, display_order: 4 },
    { code: 'ODTP', name_th: 'ฝ่ายข้อมูลเปิดเพื่อความโปร่งใส', name_en: 'Open Data for Transparency & Participation Department', company_id: COMPANY_ID, display_order: 5 },
  ]);
  console.log(`  ${CHECK_ICON} 5 rows`);

  // ─── position_levels ────────────────────────────────────────────────
  console.log('• position_levels');
  await upsertByCode('position_levels', [
    { code: 'BOARD',    name_en: 'Board Level',    name_th: 'ระดับคณะกรรมการ', rank: 100 },
    { code: 'DIRECTOR', name_en: 'Director Level', name_th: 'ระดับผู้อำนวยการ', rank: 50 },
    { code: 'PROJECT',  name_en: 'Project Level',  name_th: 'ระดับโครงการ',     rank: 10 },
  ]);
  console.log(`  ${CHECK_ICON} 3 rows`);

  // ─── positions ──────────────────────────────────────────────────────
  console.log('• positions');
  const { data: levels } = await supabase.from('position_levels').select('id, code');
  const lvlByCode = Object.fromEntries(levels.map((l) => [l.code, l.id]));
  await upsertByCode('positions', [
    { code: 'BOARD_MEMBER',    name_en: 'Board Member',          name_th: 'กรรมการบริษัท',        default_position_level_id: lvlByCode.BOARD },
    { code: 'DIRECTOR',        name_en: 'Director',              name_th: 'ผู้อำนวยการฝ่าย',      default_position_level_id: lvlByCode.DIRECTOR },
    { code: 'PROJECT_COORD',   name_en: 'Project Coordinator',   name_th: 'ผู้ประสานงานโครงการ', default_position_level_id: lvlByCode.PROJECT },
    { code: 'SR_PROJECT_COORD',name_en: 'Senior Project Coordinator', name_th: 'ผู้ประสานงานโครงการอาวุโส', default_position_level_id: lvlByCode.PROJECT },
    { code: 'HR_OFFICER',      name_en: 'HR Officer',            name_th: 'เจ้าหน้าที่ฝ่ายบุคคล', default_position_level_id: lvlByCode.PROJECT },
    { code: 'ACC_OFFICER',     name_en: 'Accounting Officer',    name_th: 'เจ้าหน้าที่ฝ่ายบัญชี', default_position_level_id: lvlByCode.PROJECT },
  ]);
  console.log(`  ${CHECK_ICON} 6 rows`);

  // ─── employment_types ───────────────────────────────────────────────
  console.log('• employment_types');
  await upsertByCode('employment_types', [
    { code: 'PERMANENT',  name_th: 'สัญญาจ้างประจำ' },
    { code: 'CONTRACT',   name_th: 'พนักงานชั่วคราว' },
    { code: 'PROBATION',  name_th: 'ทดลองงาน' },
    { code: 'PROJECT',    name_th: 'สัญญาจ้างโครงการ' },
  ]);
  console.log(`  ${CHECK_ICON} 4 rows`);

  // ─── leave_types ────────────────────────────────────────────────────
  // Mirrors LEAVE_TYPES in /apphr/src/leaveTypes.js
  console.log('• leave_types');
  await upsertByCode('leave_types', [
    { code: 'PERSONAL',     name_th: 'ลากิจ',                        default_days_per_year: 4,   advance_notice_days: 3,  gender_eligibility: 'all',    min_service_months: 0,  allow_carry_over: false },
    { code: 'SICK',         name_th: 'ลาป่วย',                        default_days_per_year: 30,  advance_notice_days: 0,  gender_eligibility: 'all',    min_service_months: 0,  allow_carry_over: false, requires_doctor_cert: false, use_within_days_from_event: null },
    { code: 'ANNUAL',       name_th: 'ลาพักร้อน',                    default_days_per_year: null, advance_notice_days: 7, gender_eligibility: 'all',    min_service_months: 12, allow_carry_over: true,  max_carry_over_days: 20, convert_excess_to_cash: true,
      accrual_rule: { tiers: [{ minYears: 1, maxYears: 3, days: 7 }, { minYears: 3, maxYears: 5, days: 10 }, { minYears: 5, maxYears: null, days: 15 }] }
    },
    { code: 'MATERNITY',    name_th: 'ลาคลอด',                        default_days_per_year: 120, advance_notice_days: 30, gender_eligibility: 'female', min_service_months: 0,  allow_carry_over: false },
    { code: 'PATERNITY',    name_th: 'ลาคลอด (พนักงานชาย)',          default_days_per_year: 15,  advance_notice_days: 30, gender_eligibility: 'male',   min_service_months: 0,  allow_carry_over: false, use_within_days_from_event: 90 },
    { code: 'COMPENSATION', name_th: 'ลาชดเชยทำงานวันหยุด',           default_days_per_year: null, advance_notice_days: 3,  gender_eligibility: 'all',    min_service_months: 0,  allow_carry_over: false },
    { code: 'ORDINATION',   name_th: 'ลาบวช / ลาปฏิบัติหน้าที่ทางศาสนา', default_days_per_year: 15, advance_notice_days: 30, gender_eligibility: 'all',    min_service_months: 0,  allow_carry_over: false },
    { code: 'UNPAID',       name_th: 'ลาไม่รับค่าจ้าง',               default_days_per_year: 30,  advance_notice_days: 30, gender_eligibility: 'all',    min_service_months: 0,  allow_carry_over: false },
    { code: 'STERILIZATION',name_th: 'ลาทำหมัน',                       default_days_per_year: 5,   advance_notice_days: 3,  gender_eligibility: 'all',    min_service_months: 0,  allow_carry_over: false },
    { code: 'TRAINING',     name_th: 'ลาฝึกอบรม',                      default_days_per_year: 30,  advance_notice_days: 3,  gender_eligibility: 'all',    min_service_months: 0,  allow_carry_over: false },
    { code: 'MILITARY',     name_th: 'ลาราชการทหาร',                   default_days_per_year: 60,  advance_notice_days: 30, gender_eligibility: 'male',   min_service_months: 0,  allow_carry_over: false },
  ]);
  console.log(`  ${CHECK_ICON} 11 rows`);

  // ─── welfares ───────────────────────────────────────────────────────
  console.log('• welfares');
  await upsertByCode('welfares', [
    { code: 'SOCIAL_SECURITY', name_th: 'ประกันสังคม',             requires_detail: true  },
    { code: 'GROUP_INSURANCE', name_th: 'ประกันกลุ่ม',              requires_detail: true  },
    { code: 'SUIT',            name_th: 'การเบิกชุดสูท',           requires_detail: true  },
    { code: 'WORK_WEAR',       name_th: 'การเบิกชุดทำงาน',         requires_detail: true  },
    { code: 'EQUIPMENT',       name_th: 'การเบิกอุปกรณ์ทำงาน',     requires_detail: true  },
  ]);
  console.log(`  ${CHECK_ICON} 5 rows`);

  // ─── work_location_types ────────────────────────────────────────────
  console.log('• work_location_types');
  await upsertByCode('work_location_types', [
    { code: 'OFFICE',  name_th: 'ออฟฟิศ',          requires_custom_location: false },
    { code: 'WFH',     name_th: 'ทำงานที่บ้าน',     requires_custom_location: false },
    { code: 'OFFSITE', name_th: 'นอกสถานที่',       requires_custom_location: true  },
  ]);
  console.log(`  ${CHECK_ICON} 3 rows`);

  // ─── document_types ─────────────────────────────────────────────────
  console.log('• document_types');
  await upsertByCode('document_types', [
    { code: 'ID_CARD',         name_th: 'สำเนาบัตรประชาชน',         requires_otp_to_download: true  },
    { code: 'HOUSE_REG',       name_th: 'สำเนาทะเบียนบ้าน',          requires_otp_to_download: true  },
    { code: 'EDU_CERT',        name_th: 'หนังสือรับรองการศึกษา',     requires_otp_to_download: false },
    { code: 'BANK_BOOK',       name_th: 'สำเนาบัญชีธนาคาร',         requires_otp_to_download: true  },
    { code: 'EMPLOYMENT',      name_th: 'สัญญาจ้างงาน',              requires_otp_to_download: true  },
    { code: 'SALARY_ADJ',      name_th: 'เอกสารแจ้งปรับเงินเดือน',  requires_otp_to_download: true  },
    { code: 'POSITION_ADJ',    name_th: 'เอกสารแจ้งปรับตำแหน่ง',    requires_otp_to_download: false },
  ]);
  console.log(`  ${CHECK_ICON} 7 rows`);

  // ─── document_request_types ─────────────────────────────────────────
  console.log('• document_request_types');
  await upsertByCode('document_request_types', [
    { code: 'SALARY_CERT',  name_th: 'หนังสือรับรองเงินเดือน',  handled_by: 'hr',         default_processing_days: 3 },
    { code: 'WORK_CERT',    name_th: 'หนังสือรับรองการทำงาน',   handled_by: 'hr',         default_processing_days: 3 },
    { code: 'PAYSLIP',      name_th: 'สลิปเงินเดือน',            handled_by: 'accounting', default_processing_days: 1 },
    { code: 'TAX_50_BIS',   name_th: 'แบบฟอร์ม 50 ทวิ',          handled_by: 'accounting', default_processing_days: 7 },
  ]);
  console.log(`  ${CHECK_ICON} 4 rows`);

  // ─── roles ──────────────────────────────────────────────────────────
  console.log('• roles');
  await upsertByCode('roles', [
    { code: 'admin',    name_th: 'ผู้ดูแลระบบ' },
    { code: 'employee', name_th: 'พนักงาน' },
  ]);
  console.log(`  ${CHECK_ICON} 2 rows`);

  // ─── permissions (minimal set) ──────────────────────────────────────
  console.log('• permissions');
  await upsertByCode('permissions', [
    { code: 'users.read',        description: 'View user list and profiles' },
    { code: 'users.write',       description: 'Create / edit / delete users' },
    { code: 'leave.approve',     description: 'Approve / reject leave requests' },
    { code: 'leave.read.all',    description: 'See leave requests of all employees' },
    { code: 'entitlement.write', description: 'Edit leave entitlements' },
    { code: 'attendance.read.all', description: 'See all attendance records' },
    { code: 'system.admin',      description: 'Full system access' },
  ]);
  console.log(`  ${CHECK_ICON} 7 rows`);

  // ─── role_permissions: admin gets all ───────────────────────────────
  console.log('• role_permissions');
  const { data: roles } = await supabase.from('roles').select('id, code');
  const adminRoleId = roles.find((r) => r.code === 'admin').id;
  const { data: perms } = await supabase.from('permissions').select('id');
  // Wipe + rebuild to keep idempotent
  await supabase.from('role_permissions').delete().eq('role_id', adminRoleId);
  const { error } = await supabase.from('role_permissions').insert(
    perms.map((p) => ({ role_id: adminRoleId, permission_id: p.id }))
  );
  if (error) throw new Error(`[role_permissions] ${error.message}`);
  console.log(`  ${CHECK_ICON} ${perms.length} rows (admin: all permissions)`);

  console.log('\n✅ Lookup tables seeded.');
}

main().catch((e) => {
  console.error('\n❌ Seed failed:', e.message);
  process.exit(1);
});
