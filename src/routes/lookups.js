import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { getEmploymentTypes } from '../supabase/queries.js';

const router = Router();

router.get('/employment-types', requireAuth, async (req, res) => {
  try {
    res.json(await getEmploymentTypes());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
