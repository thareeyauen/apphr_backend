import { Router } from 'express';
import { requireAuth } from '../auth.js';
import {
  getEmploymentTypes,
  getPositions,
  getBanks,
  getDocumentRequestTypes,
  getAttendanceExceptionTypes,
  getHolidaysForYear,
} from '../supabase/queries.js';

const router = Router();

router.get('/employment-types', requireAuth, async (req, res) => {
  try {
    res.json(await getEmploymentTypes());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/positions', requireAuth, async (req, res) => {
  try {
    res.json(await getPositions());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/banks', requireAuth, async (req, res) => {
  try {
    res.json(await getBanks());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/document-request-types', requireAuth, async (req, res) => {
  try {
    res.json(await getDocumentRequestTypes());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/attendance-exception-types', requireAuth, async (req, res) => {
  try {
    res.json(await getAttendanceExceptionTypes());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Company holidays for a calendar year. Defaults to the current year if `?year=` is omitted.
router.get('/holidays', requireAuth, async (req, res) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    res.json(await getHolidaysForYear(year));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
