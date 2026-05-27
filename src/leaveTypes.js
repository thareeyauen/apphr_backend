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
    countCalendarDays: true,
  },
  {
    id: 'unpaid',
    label: 'Unpaid Leave',
    labelTh: 'ลาไม่รับค่าจ้าง',
    quota: 30,
    advanceDays: 30,
    backdateDays: 0,
    countCalendarDays: true,
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
    countCalendarDays: true,
  },
  {
    id: 'maternity',
    label: 'Maternity Leave',
    labelTh: 'ลาคลอด (พนักงานหญิง)',
    quota: 120,
    advanceDays: 30,
    backdateDays: 0,
    countCalendarDays: true,
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
    countCalendarDays: true,
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

// Format a Date as YYYY-MM-DD using LOCAL time (matches how parseFlexibleDate constructs dates).
export function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Count calendar days inclusive of both endpoints (e.g. Mon→Fri = 5).
export function countCalendarDaysInRange(startKey, endKey) {
  const start = parseFlexibleDate(startKey);
  const end   = parseFlexibleDate(endKey) || start;
  if (!start || !end || end < start) return 0;
  return daysBetween(start, end) + 1;
}

// Count working days (Mon–Fri, excluding company holidays) inclusive of both endpoints.
// holidaySet: a Set of YYYY-MM-DD strings.
export function countWorkingDaysInRange(startKey, endKey, holidaySet = new Set()) {
  const start = parseFlexibleDate(startKey);
  const end   = parseFlexibleDate(endKey) || start;
  if (!start || !end || end < start) return 0;
  let count = 0;
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const stop   = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cursor <= stop) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6 && !holidaySet.has(toDateKey(cursor))) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

// Effective leave days based on the leave type's countCalendarDays flag.
// Half-day modes ('half-morning'/'half-afternoon') multiply by 0.5 only when the
// single selected day is actually a working day; otherwise the result stays at 0.
export function computeEffectiveLeaveDays(leaveCfg, startKey, endKey, dayTypeId, holidaySet) {
  if (leaveCfg.countCalendarDays) {
    return countCalendarDaysInRange(startKey, endKey);
  }
  const working = countWorkingDaysInRange(startKey, endKey, holidaySet || new Set());
  if (working === 1 && (dayTypeId === 'half-morning' || dayTypeId === 'half-afternoon')) {
    return 0.5;
  }
  return working;
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
