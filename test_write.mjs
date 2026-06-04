const SUPABASE_URL = 'https://jqvrelqnfuczxgpiayvg.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpxdnJlbHFuZnVjenhncGlheXZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1MjUwMDgsImV4cCI6MjA5NjEwMTAwOH0.T66rUFxsvpA7ahG51kdv3mM03Vh5zfqlEqnxKLF968Y';
const r = await fetch(`${SUPABASE_URL}/rest/v1/areas?select=*&limit=1`, {
  headers: { apikey: ANON, Authorization: `Bearer ${ANON}` }
});
console.log('areas:', await r.text());
