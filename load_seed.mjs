import postgres from 'postgres';
import fs from 'fs';

// Supabase pooler connection (port 6543) — works for one-shot scripts
// Format from Supabase docs: postgres://postgres.<project_ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
// We'll use the direct DB URL via env
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

const sql = postgres(url, { ssl: 'require', max: 1 });
const seedSql = fs.readFileSync('/tmp/seed.sql', 'utf8');

console.log('Loading seed...');
try {
  await sql.unsafe(seedSql);
  console.log('✓ Seed loaded');
  // Verify
  const cats = await sql`SELECT COUNT(*)::int as n FROM categories`;
  const areas = await sql`SELECT COUNT(*)::int as n FROM areas`;
  const tradies = await sql`SELECT COUNT(*)::int as n FROM tradesmen`;
  const revs = await sql`SELECT COUNT(*)::int as n FROM reviews`;
  console.log(`categories: ${cats[0].n}, areas: ${areas[0].n}, tradesmen: ${tradies[0].n}, reviews: ${revs[0].n}`);
} catch (e) {
  console.error('error:', e.message);
  process.exit(1);
} finally {
  await sql.end();
}
