import fs from 'fs';
const SUPABASE_URL = 'https://jqvrelqnfuczxgpiayvg.supabase.co';
// We need the SERVICE ROLE key to bypass RLS for bulk insert. But we only have publishable.
// Alternative: RLS isn't enabled on these new tables (no policies = denied by default with anon).
// Let me first check by trying a small insert.

const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpxdnJlbHFuZnVjenhncGlheXZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1MjUwMDgsImV4cCI6MjA5NjEwMTAwOH0.T66rUFxsvpA7ahG51kdv3mM03Vh5zfqlEqnxKLF968Y';

const r = await fetch(`${SUPABASE_URL}/rest/v1/categories?select=count`, {
  headers: { apikey: ANON, Authorization: `Bearer ${ANON}` }
});
console.log('GET categories status:', r.status);
console.log('headers:', Object.fromEntries(r.headers));
console.log('body:', await r.text());
