import { Router } from 'express';
import { requireAuth, requireAdmin } from '../auth.js';
import { db } from '../supabase/client.js';

const router = Router();

const DEFAULT_COMPANY = {
  nameTh: 'บริษัท แฮนด์ วิสาหกิจเพื่อสังคม จำกัด',
  nameEn: 'HAND SOCIAL ENTERPRISE COMPANY LIMITED',
  taxId: '0105559009660',
  phone: '025506141',
  address: 'เลขที่ 13 ซอยอรรคพัฒน์ ถนนสุขุมวิท 49-4 แขวงคลองตันเหนือ เขตวัฒนา กรุงเทพมหานคร 10110',
  employeeCount: '11 คน',
};

const DEFAULT_BENEFITS = {
  socialSecurity: { titleTh: 'ประกันสังคม', titleEn: 'Social Security', icon: 'socialSecurity', status: 'active', detail: 'นายจ้างและลูกจ้างสมทบฝ่ายละ 5% ของค่าจ้าง (สูงสุด 750 บาท/เดือน)' },
  groupInsurance: { titleTh: 'ประกันกลุ่ม', titleEn: 'Group Insurance', icon: 'groupInsurance', status: 'active', detail: 'วงเงิน 100,000 บาท/ปี ครอบคลุม OPD/IPD' },
  suit: { titleTh: 'การเบิกชุดสูท', titleEn: 'Suit Allowance', icon: 'suit', status: 'active', detail: 'เบิกได้ 5,000 บาท/ปี' },
  workWear: { titleTh: 'การเบิกชุดทำงาน', titleEn: 'Work Uniform Allowance', icon: 'workWear', status: 'active', detail: 'เบิกได้ 3,000 บาท/ปี' },
  equipment: { titleTh: 'การเบิกอุปกรณ์ทำงาน', titleEn: 'Work Equipment Allowance', icon: 'equipment', status: 'active', detail: 'เบิกได้ 10,000 บาท/ปี' },
};

async function readSettings() {
  const sb = db();
  const { data, error } = await sb
    .from('app_settings')
    .select('key, value')
    .in('key', ['company', 'benefits']);
  if (error) throw new Error(error.message);
  const out = {};
  for (const row of (data || [])) out[row.key] = row.value;
  return out;
}

async function upsertSetting(key, value) {
  const sb = db();
  const { error } = await sb
    .from('app_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
}

function buildResponse(saved) {
  return {
    company:  { ...DEFAULT_COMPANY,  ...(saved.company  || {}) },
    // Once admin has saved benefits (even an empty object), respect their choice
    // exactly — don't merge DEFAULT_BENEFITS back in, or deleted default items
    // would resurrect on next fetch.
    benefits: saved.benefits ?? DEFAULT_BENEFITS,
  };
}

router.get('/', async (req, res) => {
  try {
    res.json(buildResponse(await readSettings()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const ops = [];
    if (req.body.company   !== undefined) ops.push(upsertSetting('company',  req.body.company));
    if (req.body.benefits  !== undefined) ops.push(upsertSetting('benefits', req.body.benefits));
    await Promise.all(ops);
    res.json(buildResponse(await readSettings()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
