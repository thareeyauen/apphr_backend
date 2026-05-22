import { Router } from 'express';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { requireAuth, requireAdmin } from '../auth.js';

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const SETTINGS_PATH = join(__dirname, '../data/settings.json');

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

function readSettings() {
  try {
    if (existsSync(SETTINGS_PATH)) return JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
  } catch { /* ignore */ }
  return {};
}

function writeSettings(data) {
  writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function buildResponse(saved) {
  return {
    company: { ...DEFAULT_COMPANY, ...(saved.company || {}) },
    benefits: { ...DEFAULT_BENEFITS, ...(saved.benefits || {}) },
  };
}

router.get('/', (req, res) => {
  try {
    res.json(buildResponse(readSettings()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/', requireAuth, requireAdmin, (req, res) => {
  try {
    const saved = readSettings();
    if (req.body.company !== undefined) saved.company = req.body.company;
    if (req.body.benefits !== undefined) saved.benefits = req.body.benefits;
    writeSettings(saved);
    res.json(buildResponse(saved));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
