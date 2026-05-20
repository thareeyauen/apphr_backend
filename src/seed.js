import bcrypt from 'bcryptjs';
import { db } from './db.js';

const DEFAULT_BENEFITS = {
  socialSecurity: { titleTh: 'ประกันสังคม', titleEn: 'Social Security', status: 'active', detail: 'นายจ้างและลูกจ้างสมทบฝ่ายละ 5% ของค่าจ้าง (สูงสุด 750 บาท/เดือน)' },
  groupInsurance: { titleTh: 'ประกันกลุ่ม', titleEn: 'Group Insurance', status: 'active', detail: 'วงเงิน 100,000 บาท/ปี ครอบคลุม OPD/IPD' },
  suit:           { titleTh: 'การเบิกชุดสูท', titleEn: 'Suit Allowance', status: 'active', detail: 'เบิกได้ 5,000 บาท/ปี' },
  workWear:       { titleTh: 'การเบิกชุดทำงาน', titleEn: 'Work Uniform Allowance', status: 'active', detail: 'เบิกได้ 3,000 บาท/ปี' },
  equipment:      { titleTh: 'การเบิกอุปกรณ์ทำงาน', titleEn: 'Work Equipment Allowance', status: 'active', detail: 'เบิกได้ 10,000 บาท/ปี' },
};

const EMPLOYEES = [
  { nameTh: 'ดร.ต่อภัสสร์ ยมนาค', employeeId: 'H0001', position: 'Co-Founder and Chief Advisor', department: 'Board of Directors', employeeLevel: 'Board Level', bankName: 'kbank' },
  { nameTh: 'สุภอรรถ โบสุวรรณ', employeeId: 'H0002', position: 'Managing Director', department: 'Board of Directors', employeeLevel: 'Board Level', bankName: 'kbank' },
  { nameTh: 'พลังรัฐ รัชตะนาวิน', employeeId: 'H0003', position: 'Director of Operations', department: 'Board of Directors', employeeLevel: 'Board Level', bankName: 'kbank' },
  { nameTh: 'ยุทธนา วังวสุ', employeeId: 'H0004', position: 'Co-Founder and Director', department: 'Board of Directors', employeeLevel: 'Board Level', bankName: 'kbank' },
  { nameTh: 'สุภัจจา อังค์สุวรรณ', employeeId: 'H0006', position: 'Director of Research & Knowledge Management', department: 'Good Governance Research and Learning Department', employeeLevel: 'Director Level', employeeType: 'สัญญาจ้างประจำ', startDate: '18/12/2017', bankName: 'kbank', bankAccount: '0351293993' },
  { nameTh: 'พัชรี ตรีพรม', employeeId: 'H0007', position: 'Project Manager', department: 'Collaboration and Coordination Department', employeeLevel: 'Project Level', employeeType: 'สัญญาจ้างประจำ', startDate: '18/12/2017', bankName: 'kbank', bankAccount: '0351575697' },
  { nameTh: 'จรัสศรี พะลายะสุต', employeeId: 'H0008', position: 'Director of Accounting and Finance', department: 'Accounting and Finance Department', employeeLevel: 'Director Level', employeeType: 'การจ้างที่ปรึกษา', startDate: '07/04/2019', bankName: 'kbank', bankAccount: '7722080984', bankBranch: 'Central World' },
  { nameTh: 'รักษ์ป่า อู่สุวรรณ', employeeId: 'H0015', position: 'Project Manager', department: 'Open Data for Transparency & Participation Department', employeeLevel: 'Project Level', employeeType: 'สัญญาจ้างประจำ', startDate: '03/07/2022', probationStart: '03/07/2022', probationEnd: '06/07/2022', bankName: 'kbank', bankAccount: '0138434362', bankBranch: 'บ้านดู่' },
  { nameTh: 'ศรันย์ชนก ลิมวิสิฐธนกร', employeeId: 'H0025', position: 'Executive Assistant', department: 'Collaboration and Coordination Department', employeeLevel: 'Project Level', employeeType: 'สัญญาจ้างประจำ', startDate: '04/03/2023', probationStart: '04/03/2023', bankName: 'kbank', bankAccount: '0238067782', bankBranch: 'บางกระบือ' },
  { nameTh: 'ธรีญา อึ้งตระกูล', employeeId: 'H0029', position: 'Project coordinator', department: 'Open Data for Transparency & Participation Department', employeeLevel: 'Project Level', employeeType: 'สัญญาจ้างประจำ', startDate: '08/07/2023', probationStart: '08/07/2023', bankName: 'kbank', bankAccount: '0533261361', bankBranch: 'ฟิวเจอร์ พาร์ค รังสิต' },
  { nameTh: 'จตุพร ศิรเลิศมุกุล', employeeId: 'H0031', position: 'Accountant', department: 'Accounting and Finance Department', employeeLevel: 'Project Level', employeeType: 'สัญญาจ้างประจำ', startDate: '25/03/2024', probationStart: '25/03/2024', bankName: 'kbank', bankAccount: '1803680430', bankBranch: 'ฟิวเจอร์ พาร์ค รังสิต' },
  { nameTh: 'ธนากาญจน์ กันทอง', employeeId: 'H0032', position: 'Research Assistant', department: 'Good Governance Research and Learning Department', employeeLevel: 'Project Level', employeeType: 'สัญญาจ้างประจำ', startDate: '27/05/2024', probationStart: '27/05/2024', bankName: 'kbank', bankAccount: '0408689627', bankBranch: 'บิ๊กซี อ่อนนุช' },
  { nameTh: 'ศุภชัย เสถียรหมั่น', employeeId: 'H0033', position: 'Researcher', department: 'Good Governance Research and Learning Department', employeeLevel: 'Project Level', employeeType: 'สัญญาจ้างประจำ', startDate: '06/10/2024', probationStart: '06/10/2024', bankName: 'kbank', bankAccount: '1861796600', bankBranch: 'จามจุรี สแควร์' },
  { nameTh: 'ศุภวิชญ์ แก้วคูนอก', employeeId: 'H0034', position: 'Center Manager of KRAC', department: 'Good Governance Research and Learning Department', employeeLevel: 'Project Level', employeeType: 'สัญญาจ้างประจำ', startDate: '09/09/2024', probationStart: '09/09/2024', probationEnd: '12/10/2024', bankName: 'kbank', bankAccount: '1928266644', bankBranch: 'ตลาดเกาะโพธิ์' },
  { nameTh: 'ศศธร เอี่ยมสะอาด', employeeId: 'H0042', position: 'Content Writer', department: 'Open Data for Transparency & Participation Department', employeeLevel: 'Project Level', employeeType: 'สัญญาจ้างประจำ', startDate: '06/05/2025', probationStart: '06/05/2025', bankName: 'kbank', bankAccount: '0252721827', bankBranch: 'สาขาเซ็นทรัลพลาซ่า เชียงใหม่' },
];

const getNickname = (nameTh) => nameTh.split(' ')[0].replace(/^ดร\./, '');
const getInitial = (e) => e.employeeId.replace(/^H/, '').slice(-2);

const args = process.argv.slice(2);
if (args.includes('--reset')) {
  console.log('Resetting all tables…');
  db.exec(`
    DELETE FROM checkin_records;
    DELETE FROM requests;
    DELETE FROM entitlements;
    DELETE FROM documents;
    DELETE FROM users;
  `);
}

const existing = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (existing > 0 && !args.includes('--reset') && !args.includes('--force')) {
  console.log(`users table already has ${existing} rows — skipping seed. (use --reset to wipe)`);
  process.exit(0);
}

const insertUser = db.prepare(`
  INSERT INTO users (
    id, email, password_hash, role, employee_id, initial, prefix,
    name_th, name_en, nickname_th, gender, dob, citizen_id, phone, line_id,
    address_card, address_now, emergency_name, emergency_phone,
    position_th, department, employee_level, employee_type, start_date,
    tenure, probation_start, probation_end, salary,
    bank_name, bank_branch, bank_acc, bank_acc_name,
    education_json, position_history_json, benefits_json
  ) VALUES (
    @id, @email, @password_hash, @role, @employee_id, @initial, @prefix,
    @name_th, @name_en, @nickname_th, @gender, @dob, @citizen_id, @phone, @line_id,
    @address_card, @address_now, @emergency_name, @emergency_phone,
    @position_th, @department, @employee_level, @employee_type, @start_date,
    @tenure, @probation_start, @probation_end, @salary,
    @bank_name, @bank_branch, @bank_acc, @bank_acc_name,
    @education_json, @position_history_json, @benefits_json
  )
`);
const insertEntitlement = db.prepare(`
  INSERT INTO entitlements (user_id, annual, sick, personal, maternity, entitlements_json)
  VALUES (?, 7, 30, 4, 120, '{}')
`);

const seedTx = db.transaction(() => {
  const adminHash = bcrypt.hashSync('Admin@123', 10);
  insertUser.run({
    id: 'admin',
    email: 'admin@apphr.test',
    password_hash: adminHash,
    role: 'admin',
    employee_id: null,
    initial: 'AD',
    prefix: '',
    name_th: 'แอดมิน ระบบ',
    name_en: 'System Admin',
    nickname_th: 'แอดมิน',
    gender: '',
    dob: '',
    citizen_id: '',
    phone: '',
    line_id: '',
    address_card: '',
    address_now: '',
    emergency_name: '',
    emergency_phone: '',
    position_th: 'System Administrator',
    department: 'IT',
    employee_level: 'Admin',
    employee_type: '',
    start_date: '',
    tenure: '',
    probation_start: '',
    probation_end: '',
    salary: '',
    bank_name: '',
    bank_branch: '',
    bank_acc: '',
    bank_acc_name: '',
    education_json: '[]',
    position_history_json: '[]',
    benefits_json: '{}',
  });

  for (const e of EMPLOYEES) {
    const id = e.employeeId.toLowerCase();
    const email = `${id}@apphr.test`;
    const password = `${e.employeeId}@123`;
    const hash = bcrypt.hashSync(password, 10);
    insertUser.run({
      id,
      email,
      password_hash: hash,
      role: 'employee',
      employee_id: e.employeeId,
      initial: getInitial(e),
      prefix: '',
      name_th: e.nameTh,
      name_en: e.nameTh,
      nickname_th: getNickname(e.nameTh),
      gender: '',
      dob: '',
      citizen_id: '',
      phone: '',
      line_id: '',
      address_card: '',
      address_now: '',
      emergency_name: '',
      emergency_phone: '',
      position_th: e.position,
      department: e.department,
      employee_level: e.employeeLevel,
      employee_type: e.employeeType || '',
      start_date: e.startDate || '',
      tenure: '',
      probation_start: e.probationStart || '',
      probation_end: e.probationEnd || '',
      salary: '',
      bank_name: e.bankName || '',
      bank_branch: e.bankBranch || '',
      bank_acc: e.bankAccount || '',
      bank_acc_name: e.bankAccountName || '',
      education_json: '[]',
      position_history_json: '[]',
      benefits_json: JSON.stringify(DEFAULT_BENEFITS),
    });
    insertEntitlement.run(id);
  }
});

seedTx();
console.log(`Seeded admin + ${EMPLOYEES.length} employees.`);
console.log('Login admin: admin@apphr.test / Admin@123');
console.log('Login employee: h0029@apphr.test / H0029@123 (etc.)');
