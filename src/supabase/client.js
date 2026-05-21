// Supabase client for the backend. Uses the *service role key* which bypasses
// Row Level Security — only suitable for trusted server code, never for
// frontend bundles. Read SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from env.

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.warn(
    '[supabase] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set. ' +
    'Set them in .env if you plan to use DATA_SOURCE=supabase.'
  );
}

export const supabase = (url && key)
  ? createClient(url, key, { auth: { persistSession: false } })
  : null;

export const isSupabaseConfigured = () => Boolean(supabase);

// Helper that throws a clean error instead of `.from(...).select(...)` on null
export function db() {
  if (!supabase) {
    throw new Error('Supabase is not configured. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
  }
  return supabase;
}
