// Run with: npm run test:supabase
// Verifies that Supabase credentials are correct and the schema is in place.

import { supabase, isSupabaseConfigured } from './client.js';

async function main() {
  if (!isSupabaseConfigured()) {
    console.error('❌ Supabase not configured. See .env.example.');
    process.exit(1);
  }

  console.log('→ Pinging Supabase...');
  const { data, error } = await supabase.from('companies').select('id, name_th').limit(1);
  if (error) {
    console.error('❌ Connection failed:', error.message);
    process.exit(1);
  }
  console.log('✅ Connected. Sample row from companies:', data);

  // Check each required table exists by querying its head (no rows fetched)
  const tables = [
    'users', 'employees', 'companies', 'departments', 'positions', 'position_levels',
    'prefixes', 'banks', 'employment_types', 'leave_types', 'welfares',
    'work_location_types', 'document_types', 'document_request_types',
    'roles', 'permissions', 'role_permissions', 'user_roles',
    'employee_employments', 'employee_addresses', 'employee_emergency_contacts',
    'employee_education', 'employee_bank_accounts', 'employee_welfares',
    'salaries', 'employee_documents', 'file_storage',
    'leave_balances', 'leave_requests', 'leave_request_periods',
    'attendances', 'ot_requests', 'wfh_offsite_requests', 'document_requests',
    'approver_mappings', 'approvals',
  ];

  let missing = 0;
  for (const t of tables) {
    const { error: e } = await supabase.from(t).select('*', { count: 'exact', head: true });
    if (e) {
      console.error(`  ✗ ${t}: ${e.message}`);
      missing++;
    } else {
      console.log(`  ✓ ${t}`);
    }
  }

  if (missing > 0) {
    console.error(`\n❌ ${missing} table(s) missing — run the schema DDL first.`);
    process.exit(1);
  }
  console.log('\n✅ All required tables present.');
}

main().catch((e) => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
