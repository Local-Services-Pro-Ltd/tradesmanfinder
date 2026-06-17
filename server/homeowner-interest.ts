/**
 * Homeowner interest waitlist for sub-density boroughs.
 *
 * Endpoint: POST /api/homeowner-interest
 * Helper:   getVerifiedCountByArea(areaId, categoryId?)
 *
 * When the area landing page sees fewer than DENSITY_THRESHOLD verified
 * pros, it surfaces a "notify me when ready" form. This module owns:
 *   - the verified-count helper used by both server and (via /api/areas
 *     downstream JSON) UI gating decisions,
 *   - the upsert logic for the waitlist row (idempotent on email +
 *     area + category),
 *   - the confirmation email send via the mailer (best-effort, never
 *     fails the request).
 *
 * The minimum-density threshold is DENSITY_THRESHOLD below. If we ever
 * want this configurable per-area (different thresholds for emergency
 * trades vs general), pull it onto `areas.min_pro_count` and read it
 * from there.
 */
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "./storage";
import {
  homeownerInterest,
  tradesmen,
  areas,
  categories,
  type InsertHomeownerInterest,
} from "@shared/schema";
import { sendHomeownerInterestConfirmation } from "./mailer";

/**
 * Below this number of verified pros, the area landing page hides
 * search and surfaces the waitlist signup. Three is the floor: at
 * one or two pros, a single illness/holiday closes the borough.
 */
export const DENSITY_THRESHOLD = 3;

/**
 * Defensive JSON parse for tradesmen.categories (stored as JSON text).
 * Returns [] on malformed input rather than throwing.
 */
function parseCategories(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as number[]) : [];
  } catch {
    return [];
  }
}

/**
 * Count verified pros in an area, optionally filtered to those that
 * cover a specific category. Used both by the area landing page and
 * by the homeowner-interest signup form to decide whether to gate.
 */
export async function getVerifiedCountByArea(
  areaId: number,
  categoryId?: number,
): Promise<number> {
  const rows = await db
    .select({ categories: tradesmen.categories })
    .from(tradesmen)
    .where(and(eq(tradesmen.areaId, areaId), eq(tradesmen.verified, true)));

  if (categoryId === undefined) return rows.length;
  return rows.filter((r) => parseCategories(r.categories as string).includes(categoryId)).length;
}

/**
 * Inbound payload schema. Email + optional postcode/area/category + source.
 * Email is lowercased; postcode uppercased + trimmed.
 *
 * `requestedArea` is set ONLY when the user typed a borough/postcode/locality
 * we couldn't resolve to a seeded `areas` row. Mutually exclusive with
 * `areaId`: if both are provided the schema rejects, so we always know which
 * code path produced the row. Sanity caps:
 *   - length 2..80 (rules out one-letter typos and abuse)
 *   - only letters/digits/spaces/hyphens after normalisation (rules out
 *     emoji/script injection vectors)
 */
export const homeownerInterestRequestSchema = z
  .object({
    email: z.string().email().max(254),
    postcode: z.string().trim().max(10).optional(),
    areaId: z.number().int().positive().optional(),
    categoryId: z.number().int().positive().optional(),
    requestedArea: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[A-Za-z0-9 \-]+$/, "requestedArea must be letters, digits, spaces or hyphens")
      .optional(),
    source: z
      .enum([
        "area_landing",
        "category_landing",
        "footer",
        "manual",
        "unmatched_search",
      ])
      .default("area_landing"),
  })
  .refine((d) => !(d.areaId !== undefined && d.requestedArea !== undefined), {
    message: "areaId and requestedArea are mutually exclusive",
    path: ["requestedArea"],
  });
export type HomeownerInterestRequest = z.infer<typeof homeownerInterestRequestSchema>;

export interface HomeownerInterestResult {
  ok: true;
  created: boolean; // true if new row, false if existing row updated
  id: number;
}

/**
 * Idempotent upsert. INSERT ... ON CONFLICT (email, area_id, category_id)
 * DO UPDATE — re-submission from the same email for the same area/category
 * bumps updatedAt and refreshes source, but never duplicates. The COALESCE
 * in the unique index lets nulls participate cleanly (a row with area_id=12
 * and category_id=NULL is one identity).
 *
 * Confirmation email is fire-and-forget: a Resend outage must not break
 * the form submission. Only new (not repeat) signups get the email.
 */
export async function recordHomeownerInterest(
  input: HomeownerInterestRequest,
): Promise<HomeownerInterestResult> {
  const now = Date.now();
  const email = input.email.toLowerCase().trim();
  const postcode = input.postcode ? input.postcode.toUpperCase().trim() : null;
  // Normalise requested-area to lowercase so "Camden", "camden", "CAMDEN" all
  // de-dupe to one waitlist row per email. Display-cased copy is the user's
  // problem (they typed it); we want clean analytics.
  const requestedArea = input.requestedArea ? input.requestedArea.trim().toLowerCase() : null;

  // Resolve display strings for the confirmation email
  const [areaRow] = input.areaId
    ? await db.select().from(areas).where(eq(areas.id, input.areaId)).limit(1)
    : [undefined];
  const [categoryRow] = input.categoryId
    ? await db.select().from(categories).where(eq(categories.id, input.categoryId)).limit(1)
    : [undefined];

  // The unique constraint is on (email, COALESCE(area_id, -1), COALESCE(category_id, -1)),
  // which Drizzle's onConflictDoUpdate can't reference directly (it needs raw
  // columns, not expressions). Do the upsert manually: look up by identity, then
  // update or insert. The race window is tiny and the DB-level UNIQUE will still
  // catch a true concurrent double-insert — we just propagate that error.
  //
  // For `requestedArea` signups (areaId IS NULL), identity is (email,
  // requested_area) and we also enforce that via a partial unique index.
  const areaCondition = input.areaId !== undefined
    ? eq(homeownerInterest.areaId, input.areaId)
    : isNull(homeownerInterest.areaId);
  const categoryCondition = input.categoryId !== undefined
    ? eq(homeownerInterest.categoryId, input.categoryId)
    : isNull(homeownerInterest.categoryId);
  const requestedAreaCondition = requestedArea !== null
    ? eq(homeownerInterest.requestedArea, requestedArea)
    : isNull(homeownerInterest.requestedArea);

  const [existing] = await db
    .select()
    .from(homeownerInterest)
    .where(
      and(
        eq(homeownerInterest.email, email),
        areaCondition,
        categoryCondition,
        requestedAreaCondition,
      ),
    )
    .limit(1);

  let rowId: number;
  if (existing) {
    await db
      .update(homeownerInterest)
      .set({
        source: input.source,
        postcode: postcode ?? existing.postcode,
        updatedAt: now,
      })
      .where(eq(homeownerInterest.id, existing.id));
    rowId = existing.id;
  } else {
    const values: InsertHomeownerInterest & { createdAt: number; updatedAt: number } = {
      email,
      postcode,
      areaId: input.areaId ?? null,
      categoryId: input.categoryId ?? null,
      requestedArea,
      source: input.source,
      createdAt: now,
      updatedAt: now,
    };
    const [inserted] = await db
      .insert(homeownerInterest)
      .values(values)
      .returning({ id: homeownerInterest.id });
    rowId = inserted.id;
  }

  const created = !existing;

  // Confirmation email — best-effort. Don't block the response.
  // When the user typed an unmatched area, surface their string in the
  // confirmation copy ("verified pros in Streatham") so the email feels
  // tailored even when we have no internal record of that area.
  if (created) {
    const areaNameForEmail =
      areaRow?.name ?? (requestedArea ? toTitleCase(requestedArea) : null);
    void sendHomeownerInterestConfirmation({
      to: email,
      areaName: areaNameForEmail,
      categoryName: categoryRow?.name ?? null,
    }).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn("[homeowner-interest] confirmation email failed:", err);
    });
  }

  return { ok: true, created, id: rowId };
}

/**
 * Title-case helper for the user-typed requested-area string when echoing
 * it back in confirmation copy. Handles multi-word inputs like
 * "finsbury park" → "Finsbury Park" and leaves postcodes alone.
 */
function toTitleCase(raw: string): string {
  // Looks like a postcode? Uppercase the whole thing.
  if (/^[a-z]{1,2}\d[a-z\d]?( \d[a-z]{2})?$/i.test(raw)) return raw.toUpperCase();
  return raw
    .split(/\s+/)
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}
