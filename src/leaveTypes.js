// Canonical leave-type configuration shared by routes/requests.js and seed.js.
// Mirrors c:/apphr/src/leaveTypes.js on the frontend — keep both in sync.

export const LEAVE_TYPES = [
  {
    id: 'personal',
    label: 'Personal Leave',
    labelTh: 'ลากิจ',
    quota: 4,
    advanceDays: 3,
    backdateDays: 0,
  },
  {
    id: 'sick',
    label: 'Sick Leave',
    labelTh: 'ลาป่วย',
    quota: 30,
    advanceDays: 0,
    backdateDays: 3,
    certificateAfterDays: 3,
  },
  {
    id: 'annual',
    label: 'Annual Leave',
    labelTh: 'ลาพักร้อน',
    quota: null,
    quotaByTenureYears: [
      { minYears: 1, maxYears: 3, days: 7 },
      { minYears: 3, maxYears: 5, days: 10 },
      { minYears: 5, maxYears: Infinity, days: 15 },
    ],
    minTenureYears: 1,
    carryOverMax: 20,
    advanceDays: 7,
    backdateDays: 0,
  },
  {
    id: 'compensation',
    label: 'Compensation Leave',
    labelTh: 'ลาชดเชยทำงานวันหยุด',
    quota: null,
    advanceDays: 3,
    backdateDays: 0,
    requiresHolidayWorkDate: true,
    requiresSupervisorPreApproval: true,
  },
  {
    id: 'ordination',
    label: 'Ordination Leave',
    labelTh: 'ลาบวช / ลาปฏิบัติหน้าที่ทางศาสนา',
    quota: 15,
    advanceDays: 30,
    backdateDays: 0,
  },
  {
    id: 'unpaid',
    label: 'Unpaid Leave',
    labelTh: 'ลาไม่รับค่าจ้าง',
    quota: 30,
    advanceDays: 30,
    backdateDays: 0,
  },
  {
    id: 'sterilization',
    label: 'Sterilization Leave',
    labelTh: 'ลาทำหมัน',
    quota: 5,
    advanceDays: 3,
    backdateDays: 0,
  },
  {
    id: 'training',
    label: 'Training Leave',
    labelTh: 'ลาฝึกอบรม',
    quota: 30,
    advanceDays: 3,
    backdateDays: 0,
  },
  {
    id: 'military',
    label: 'Military Leave',
    labelTh: 'ลาราชการทหาร',
    quota: 60,
    advanceDays: 30,
    backdateDays: 0,
  },
  {
    id: 'maternity',
    label: 'Maternity Leave',
    labelTh: 'ลาคลอด (พนักงานหญิง)',
    quota: 120,
    advanceDays: 30,
    backdateDays: 0,
  },
  {
    id: 'paternity',
    label: 'Paternity Leave',
    labelTh: 'ลาคลอด (พนักงานชาย)',
    quota: 15,
    advanceDays: 30,
    backdateDays: 0,
    requiresChildBirthDate: true,
    useWithinDaysFromChildBirth: 90,
  },
];

export const LEAVE_TYPES_BY_ID = Object.fromEntries(LEAVE_TYPES.map((t) => [t.id, t]));
export const LEAVE_TYPES_BY_LABEL = Object.fromEntries(LEAVE_TYPES.map((t) => [t.label, t]));

export function findLeaveType(typeOrLabel) {
  if (!typeOrLabel) return null;
  return LEAVE_TYPES_BY_ID[typeOrLabel] || LEAVE_TYPES_BY_LABEL[typeOrLabel] || null;
}

// Parse a DD/MM/YYYY (Thai-style) or YYYY-MM-DD date string into a Date in local time.
export function parseFlexibleDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  const ddmmyyyy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const [, d, m, y] = ddmmyyyy;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  const yyyymmdd = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (yyyymmdd) {
    const [, y, m, d] = yyyymmdd;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function daysBetween(a, b) {
  if (!a || !b) return 0;
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const ms = startOfDay(b) - startOfDay(a);
  return Math.round(ms / 86400000);
}

export function computeTenureYears(startDate, asOf = new Date()) {
  const start = parseFlexibleDate(startDate);
  if (!start) return 0;
  const diffMs = asOf - start;
  if (diffMs <= 0) return 0;
  return diffMs / (365.25 * 24 * 60 * 60 * 1000);
}

export function annualQuotaForTenure(tenureYears) {
  const cfg = LEAVE_TYPES_BY_ID.annual;
  if (!cfg) return 0;
  if (tenureYears < cfg.minTenureYears) return 0;
  const tier = cfg.quotaByTenureYears.find(
    (t) => tenureYears >= t.minYears && tenureYears < t.maxYears
  );
  return tier ? tier.days : 0;
}

// Returns the effective quota for a leave type. For annual, computes from tenure.
export function quotaForUser(typeId, user) {
  const cfg = LEAVE_TYPES_BY_ID[typeId];
  if (!cfg) return 0;
  if (typeId === 'annual') {
    const tenureYears = computeTenureYears(user?.start_date || user?.startDate);
    return annualQuotaForTenure(tenureYears);
  }
  return cfg.quota ?? 0;
}
