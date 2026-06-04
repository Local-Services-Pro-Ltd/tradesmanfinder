import fs from 'fs';
const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !ANON) {
  console.error('SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required');
  process.exit(1);
}

const r = await fetch(`${SUPABASE_URL}/rest/v1/categories?select=count`, {
  headers: { apikey: ANON, Authorization: `Bearer ${ANON}` }
});
console.log('GET categories status:', r.status);
console.log('headers:', Object.fromEntries(r.headers));
