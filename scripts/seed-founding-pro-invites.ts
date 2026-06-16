/**
 * Idempotent seed for Founding Pro pilot invites.
 *
 * Reads a JSON file of pilot recipients (path passed as argv[2]) and upserts
 * each row into `founding_pro_invites` via storage.seedFoundingProInvites —
 * we reuse the storage layer rather than duplicating the upsert logic so the
 * conflict/lifecycle rules (never un-claim a pro on re-seed) stay in one place.
 *
 * The JSON uses the snake_case field names from the outreach payload:
 *   [{ ref, recipient_email, recipient_name?, company_name?,
 *      companies_house_number?, trade, area, postcodes?, campaign? }]
 *
 * `postcodes` may be omitted — we fall back to the area's default coverage
 * postcodes so the claim page has sensible chips pre-ticked.
 *
 * Usage:
 *   DATABASE_URL=postgres://... ADMIN_KEY=… \
 *     npx tsx scripts/seed-founding-pro-invites.ts scripts/founding-pro-pilot-01.sample.json
 */

import { readFileSync } from "node:fs";
import { storage } from "../server/storage";
import type { NewFoundingProInvite } from "../shared/schema";

// Default coverage postcodes per pilot area — mirrors the frontend claim page.
const AREA_POSTCODES: Record<string, string[]> = {
  Wandsworth: ["SW8", "SW11", "SW12", "SW15", "SW17", "SW18"],
  Dulwich: ["SE21", "SE22"],
  "Kensington & Chelsea": ["SW3", "SW5", "SW7", "SW10", "W8", "W10", "W11", "W14"],
  Richmond: ["TW9", "TW10"],
};

type RawRow = {
  ref: string;
  recipient_email: string;
  recipient_name?: string | null;
  company_name?: string | null;
  companies_house_number?: string | null;
  trade: string;
  area: string;
  postcodes?: string[];
  campaign?: string;
};

function toInvite(r: RawRow): NewFoundingProInvite {
  return {
    ref: r.ref,
    recipientEmail: r.recipient_email,
    recipientName: r.recipient_name ?? null,
    companyName: r.company_name ?? null,
    companiesHouseNumber: r.companies_house_number ?? null,
    trade: r.trade,
    area: r.area,
    postcodes: r.postcodes && r.postcodes.length ? r.postcodes : (AREA_POSTCODES[r.area] ?? []),
    campaign: r.campaign,
  };
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: tsx scripts/seed-founding-pro-invites.ts <path-to-json>");
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(path, "utf8")) as RawRow[];
  if (!Array.isArray(raw)) {
    console.error("Expected the JSON file to contain an array of invite rows.");
    process.exit(1);
  }

  const rows = raw.map(toInvite);
  console.log(`Seeding ${rows.length} Founding Pro invites from ${path}...`);

  const written = await storage.seedFoundingProInvites(rows);

  console.log(`Done. Upserted ${written} invite(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
