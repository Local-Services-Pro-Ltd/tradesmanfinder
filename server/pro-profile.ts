/**
 * Public profile endpoint — /api/pro/:slug (issue #139).
 *
 * This is a SEPARATE endpoint from /api/tradesmen/by-slug/:slug even though
 * both fetch by slug. Reasons:
 *
 *   1. The pre-list flow requires data-minimised responses for unclaimed
 *      rows. /api/tradesmen/by-slug returns the full Tradesman shape (email,
 *      phone, gallery, reviews, etc.), which would be a privacy violation on
 *      an unclaimed listing (per privacy_notice_article14.md §5).
 *
 *   2. The response shape is claim_status-aware. Rather than adding a
 *      discriminated union to the general Tradesman type (which would ripple
 *      through 15+ client callers), we return a purpose-built shape that
 *      matches the /pro/{slug} page's needs exactly.
 *
 *   3. opted_out and deleted rows return 404, not "hidden" — the page must
 *      be indistinguishable from a never-existed slug.
 *
 * The general /api/tradesmen/by-slug endpoint stays unchanged so admin,
 * dashboard, and internal callers keep the shape they expect.
 */

import type { Request, Response } from "express";
import { db } from "./storage";
import { tradesmen, categories, areas } from "@shared/schema";
import { eq } from "drizzle-orm";

/**
 * Public projection returned to the /pro/{slug} client page.
 *
 * Field visibility is enforced at the server (not client) so a badly-behaved
 * client cannot upgrade an unclaimed listing to a full profile response.
 */
export interface ProProfileResponse {
  slug: string;
  claimStatus: "unclaimed" | "pending" | "claimed";
  businessName: string;
  // Trade name (from primary category). Undefined if no categories set.
  primaryCategory: string | null;
  // Location shown publicly: town + postcode district only. Never the full
  // registered residential address on unclaimed listings — GDPR data
  // minimisation per privacy_notice_article14.md §5.
  townLabel: string | null;
  postcodeDistrict: string | null;
  // Incorporation *year band* (e.g. "Incorporated 2022") — never the exact
  // date on unclaimed listings. Present only for ch_public_data pre-list.
  incorporationYear: number | null;
  // isFoundingPro flag (only meaningful post-claim; false on unclaimed).
  isFoundingPro: boolean;
  // Claimed-only fields. All null/absent unless claimStatus === "claimed".
  claimedProfile: {
    bio: string | null;
    heroImageUrl: string | null;
    gallery: string[]; // parsed from JSON string; empty array if none
    videoUrl: string | null;
    yearsExperience: number;
    verified: boolean;
    insured: boolean;
    licensed: boolean;
    gasSafeVerified: boolean;
    ratingAverage: number;
    ratingCount: number;
    responseTimeMinutes: number;
    // Contact routing is via the site's messaging flow, not raw phone/email
    // on the public page. Those remain server-side and only surface through
    // the contact form (rate-limited, spam-guarded).
  } | null;
}

/**
 * Extract postcode district (outward code) from a full postcode.
 * "SW18 7JH" -> "SW18"; "M1 1AA" -> "M1"; whitespace-tolerant.
 * Returns null for anything that doesn't look like a UK postcode.
 */
function postcodeDistrictOf(postcode: string | null | undefined): string | null {
  if (!postcode) return null;
  const trimmed = postcode.trim().toUpperCase();
  const m = trimmed.match(/^([A-Z]{1,2}\d[A-Z0-9]?)\s*\d[A-Z]{2}$/);
  return m ? m[1] : null;
}

/**
 * Extract the year from a "YYYY-MM-DD" date string (ch_incorporation_date).
 * Returns null if the string isn't parseable.
 */
function yearOf(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const m = dateStr.match(/^(\d{4})-\d{2}-\d{2}/);
  return m ? Number(m[1]) : null;
}

/**
 * Build the /pro/{slug} response for a given slug.
 * Returns null if the row doesn't exist OR its claim_status is opted_out /
 * deleted (both must be indistinguishable from "never existed" externally).
 *
 * Exported for direct testing.
 */
export async function buildProProfileResponse(
  slug: string
): Promise<ProProfileResponse | null> {
  const rows = await db
    .select({
      id: tradesmen.id,
      slug: tradesmen.slug,
      claimStatus: tradesmen.claimStatus,
      businessName: tradesmen.businessName,
      bio: tradesmen.bio,
      postcode: tradesmen.postcode,
      areaId: tradesmen.areaId,
      heroImageUrl: tradesmen.heroImageUrl,
      gallery: tradesmen.gallery,
      videoUrl: tradesmen.videoUrl,
      categories: tradesmen.categories,
      yearsExperience: tradesmen.yearsExperience,
      verified: tradesmen.verified,
      insured: tradesmen.insured,
      licensed: tradesmen.licensed,
      gasSafeVerified: tradesmen.gasSafeVerified,
      ratingAverage: tradesmen.ratingAverage,
      ratingCount: tradesmen.ratingCount,
      responseTimeMinutes: tradesmen.responseTimeMinutes,
      foundingPro: tradesmen.foundingPro,
      listingSource: tradesmen.listingSource,
      chIncorporationDate: tradesmen.chIncorporationDate,
    })
    .from(tradesmen)
    .where(eq(tradesmen.slug, slug))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  // opted_out and deleted → 404. Never distinguish from "never existed".
  const status = row.claimStatus ?? "unclaimed";
  if (status === "opted_out" || status === "deleted") return null;

  // Resolve the primary category name and the area town label.
  let primaryCategory: string | null = null;
  try {
    const parsed = JSON.parse(row.categories ?? "[]") as number[];
    if (parsed.length > 0) {
      const cat = await db
        .select({ name: categories.name })
        .from(categories)
        .where(eq(categories.id, parsed[0]))
        .limit(1);
      primaryCategory = cat[0]?.name ?? null;
    }
  } catch {
    // Malformed categories JSON — fail closed to null rather than crashing.
    primaryCategory = null;
  }

  let townLabel: string | null = null;
  if (row.areaId != null) {
    const a = await db
      .select({ name: areas.name })
      .from(areas)
      .where(eq(areas.id, row.areaId))
      .limit(1);
    townLabel = a[0]?.name ?? null;
  }

  const postcodeDistrict = postcodeDistrictOf(row.postcode);
  const incorporationYear = yearOf(row.chIncorporationDate as unknown as string | null);

  // Claimed-only enrichment.
  const isClaimed = status === "claimed";
  const gallery: string[] = (() => {
    try {
      const parsed = JSON.parse(row.gallery ?? "[]");
      return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
    } catch {
      return [];
    }
  })();

  return {
    slug: row.slug,
    claimStatus: status as "unclaimed" | "pending" | "claimed",
    businessName: row.businessName,
    primaryCategory,
    townLabel,
    postcodeDistrict,
    incorporationYear,
    isFoundingPro: Boolean(row.foundingPro),
    claimedProfile: isClaimed
      ? {
          bio: row.bio ?? null,
          heroImageUrl: row.heroImageUrl ?? null,
          gallery,
          videoUrl: row.videoUrl ?? null,
          yearsExperience: row.yearsExperience ?? 0,
          verified: Boolean(row.verified),
          insured: Boolean(row.insured),
          licensed: Boolean(row.licensed),
          gasSafeVerified: Boolean(row.gasSafeVerified),
          ratingAverage: Number(row.ratingAverage ?? 0),
          ratingCount: row.ratingCount ?? 0,
          responseTimeMinutes: row.responseTimeMinutes ?? 0,
        }
      : null,
  };
}

export async function handleProProfile(req: Request, res: Response) {
  const slug = req.params.slug;
  if (!slug || typeof slug !== "string") {
    res.status(400).json({ message: "Invalid slug" });
    return;
  }
  const profile = await buildProProfileResponse(slug);
  if (!profile) {
    res.status(404).json({ message: "Profile not found" });
    return;
  }
  res.json(profile);
}
