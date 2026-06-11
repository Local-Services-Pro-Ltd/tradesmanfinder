/**
 * Idempotent seed for SEO landing-page cities.
 *
 * Reads SEO_CITIES from shared/seo-cities and upserts each row into the
 * `areas` table. Existing rows (matched by slug) are left untouched —
 * the unique constraint on `areas.slug` makes this safe to re-run on every
 * deploy. We do NOT update existing rows because:
 *   1. Admins may have edited region/coordinates manually post-seed.
 *   2. Idempotent INSERT is enough for the SEO use case; geo-fixes
 *      are a separate concern handled outside the seed.
 *
 * Usage:
 *   DATABASE_URL=postgres://... npx tsx scripts/seed-seo-cities.ts
 *
 * Why a standalone script (not a one-shot SQL migration):
 *   - Re-runnable as the city list grows (just append to SEO_CITIES).
 *   - Lets CI verify the city list parses cleanly even without a DB.
 *   - The TypeScript source of truth (shared/seo-cities.ts) drives both
 *     the seed and the route scorer; no risk of drift between them.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { areas } from "../shared/schema";
import { SEO_CITIES } from "../shared/seo-cities";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL env var is required");
    process.exit(1);
  }

  const client = postgres(connectionString, { prepare: false });
  const db = drizzle(client);

  console.log(`Seeding ${SEO_CITIES.length} SEO cities into areas table...`);

  let inserted = 0;
  let skipped = 0;

  for (const city of SEO_CITIES) {
    const result = await db
      .insert(areas)
      .values({
        slug: city.slug,
        name: city.name,
        region: city.region,
        latitude: city.latitude,
        longitude: city.longitude,
      })
      .onConflictDoNothing({ target: areas.slug })
      .returning({ id: areas.id });

    if (result.length > 0) {
      inserted += 1;
      console.log(`  + inserted ${city.slug} (id=${result[0].id})`);
    } else {
      skipped += 1;
      console.log(`  = skipped ${city.slug} (already exists)`);
    }
  }

  const total = await db.execute(sql`SELECT COUNT(*)::int AS n FROM areas`);
  const totalRows = (total as unknown as Array<{ n: number }>)[0]?.n ?? -1;

  console.log("");
  console.log(`Done. Inserted: ${inserted}, Skipped: ${skipped}.`);
  console.log(`Total rows in areas: ${totalRows}.`);

  await client.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
