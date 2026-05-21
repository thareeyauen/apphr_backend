# Supabase Migration (Phase 1 — foundation)

This folder isolates everything related to the Supabase migration so the
existing SQLite-based backend keeps running untouched while we build.

## What's here so far

| File | Purpose |
|------|---------|
| `client.js` | Supabase client wrapper (uses service role key). |
| `test-connection.js` | Verifies credentials + that the full schema is in place. |
| `seed.js` | One-time idempotent seed of the 13 lookup tables + 1 company + admin role/permissions. |
| `README.md` | This file. |

## Setup steps (you do this once)

### 1. Install dependencies
```bash
cd C:\apphr_backend
npm install
```

This adds `@supabase/supabase-js` and `dotenv`.

### 2. Create your Supabase project + schema
1. Sign in to https://supabase.com → create a new project.
2. In the project dashboard, open **SQL Editor** → paste the full DDL you
   provided earlier → **Run**. All ~30 tables should be created.

### 3. Configure `.env`
Copy `C:\apphr_backend\.env.example` → `C:\apphr_backend\.env` and fill in:
```
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...   # Settings → API → service_role (secret)
DATA_SOURCE=sqlite                          # leave this — switch later
```

### 4. Verify connection + schema
```bash
npm run test:supabase
```
Should print "✅ Connected" plus one ✓ for every required table.
If some tables show ✗ — re-run the DDL in Supabase.

### 5. Seed the lookup tables
```bash
npm run seed:supabase
```
Should print 13 sections each ending in ✓ N rows. Safe to re-run (uses upsert).

You're now ready for **Phase 2** — building the mapper layer and
swapping `db.js` to use Supabase.

## What this DOES NOT do yet

- Does not migrate any employee data (we chose `2b`: seed/demo, start fresh).
- Does not change the existing API routes — they all still hit SQLite.
- Does not affect the frontends.

Run the steps above whenever you're ready — they're non-destructive.
