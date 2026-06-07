/**
 * PR-P4 — Placement Engine
 *
 * Pure selection/ranking logic for partner placements.
 * Exported as `selectPlacements` for testability — no HTTP concerns here.
 *
 * Design notes vs. schema reality
 * --------------------------------
 * The live `partner_placements` table (PR-P1) has:
 *   - `surface`, `categoryFilter` (JSON int[]), `areaFilter` (JSON int[])
 *   - `activeFrom` / `activeTo` timestamps — used to derive "active" status
 *   - `priority` (lower = higher priority) — used as inverse weight
 *   - `creativeHtml` / `creativeUrl` — raw creative fields
 *
 * The table does NOT have: `status`, `weight`, or `monthly_budget_pence`.
 * Adaptations made:
 *   - "active" = activeFrom <= now AND (activeTo is null OR activeTo >= now)
 *   - weight  = Math.round(100 / max(placement.priority, 1))
 *   - monthly_budget_pence check is omitted (no column); treated as unlimited
 *
 * `partner_events.idempotencyKey` is NOT NULL UNIQUE; format used here:
 *   `impression:<placement_id>:<uuid>`
 */

import type { IStorage } from "./storage";
import type { PartnerPlacement, Partner } from "@shared/schema";

// ── Types ──────────────────────────────────────────────────────────────────

export interface PlacementCreative {
  headline: string;
  body?: string;
  cta?: string;
  image_url?: string;
}

export interface SelectedPlacement {
  id: number;
  partner_id: number;
  surface: string;
  creative: PlacementCreative;
  target_url: string;
  weight: number;
  event_id: string | null;
}

export interface SelectPlacementsInput {
  surface: string;
  category?: number | null;
  area?: number | null;
  limit?: number;
  storage: IStorage;
  env?: {
    PARTNER_PLACEMENTS_ENABLED?: string;
    PARTNER_IMPRESSION_SAMPLE_RATE?: string;
  };
  /** Override Date.now() for deterministic testing */
  nowMs?: number;
  /** Override Math.random for deterministic testing */
  random?: () => number;
}

export interface DebugEntry {
  placement_id: number;
  partner_id: number;
  weight: number;
  status: "selected" | "filtered";
  reason?: string;
}

export interface SelectPlacementsResult {
  placements: SelectedPlacement[];
}

export interface DebugResult {
  surface: string;
  category: number | null;
  area: number | null;
  considered: DebugEntry[];
  selected_placement_ids: number[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function isPlacementTimeActive(p: PartnerPlacement, nowMs: number): boolean {
  return p.activeFrom <= nowMs && (p.activeTo == null || p.activeTo >= nowMs);
}

function isPartnerActive(partner: Partner): boolean {
  // Paused or terminated partners are excluded
  return partner.status !== "paused" && partner.status !== "terminated";
}

function placementWeight(p: PartnerPlacement): number {
  // Lower priority number = higher weight. priority=1 → weight=100, priority=100 → weight=1
  const prio = Math.max(p.priority ?? 100, 1);
  return Math.round(100 / prio);
}

function parseJsonIds(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === "number");
    return [];
  } catch {
    return [];
  }
}

function matchesFilter(ids: number[], filterIds: number[]): boolean {
  // Empty filter = match all
  if (filterIds.length === 0) return true;
  return filterIds.some((fid) => ids.includes(fid));
}

/**
 * Weighted random sample — returns indices in random weighted order.
 * Uses Fisher-Yates variant with weights.
 */
function weightedShuffle(
  weights: number[],
  randomFn: () => number,
): number[] {
  // Assign a key = U^(1/w) for each item (Efraimidis–Spirakis reservoir sampling)
  const keyed = weights.map((w, i) => ({
    i,
    key: Math.pow(randomFn(), 1 / Math.max(w, 0.001)),
  }));
  keyed.sort((a, b) => b.key - a.key);
  return keyed.map((x) => x.i);
}

function buildCreative(p: PartnerPlacement): PlacementCreative {
  // creativeHtml is used as headline; no structured creative fields in v1 schema.
  // If creativeHtml is JSON-parseable as {headline,body,cta,image_url}, use it.
  if (p.creativeHtml) {
    try {
      const parsed = JSON.parse(p.creativeHtml);
      if (typeof parsed === "object" && parsed !== null && typeof parsed.headline === "string") {
        return {
          headline: parsed.headline,
          body: parsed.body ?? undefined,
          cta: parsed.cta ?? undefined,
          image_url: parsed.image_url ?? undefined,
        };
      }
    } catch {
      // not JSON — treat as plain headline text
    }
    return { headline: p.creativeHtml };
  }
  return { headline: "" };
}

// ── Core engine ────────────────────────────────────────────────────────────

export async function selectPlacements(
  input: SelectPlacementsInput,
): Promise<SelectPlacementsResult> {
  const {
    surface,
    category = null,
    area = null,
    limit = 1,
    storage,
    env = {},
    nowMs = Date.now(),
    random = Math.random,
  } = input;

  const effectiveLimit = Math.min(Math.max(limit, 1), 3);

  // Feature flag check
  const enabled = (env.PARTNER_PLACEMENTS_ENABLED ?? process.env.PARTNER_PLACEMENTS_ENABLED ?? "").toLowerCase();
  if (enabled !== "true" && enabled !== "1") {
    return { placements: [] };
  }

  // Impression sample rate (default 0.1 = 10%)
  const sampleRate = parseFloat(
    env.PARTNER_IMPRESSION_SAMPLE_RATE ?? process.env.PARTNER_IMPRESSION_SAMPLE_RATE ?? "0.1",
  );

  // 1. Fetch all placements for this surface from storage
  const allPlacements = await storage.getActivePlacementsBySurface(surface);

  // Filter: time-active, category match, area match
  const categoryId = category ?? null;
  const areaId = area ?? null;

  const eligible: PartnerPlacement[] = [];
  for (const p of allPlacements) {
    // Time-active check
    if (!isPlacementTimeActive(p, nowMs)) continue;

    // Category filter
    const catFilter = parseJsonIds(p.categoryFilter);
    if (categoryId !== null && !matchesFilter([categoryId], catFilter)) continue;

    // Area filter
    const areaFilter = parseJsonIds(p.areaFilter);
    if (areaId !== null && !matchesFilter([areaId], areaFilter)) continue;

    eligible.push(p);
  }

  // 2. Drop placements whose partner is paused/terminated
  const partnerCache = new Map<number, Partner | undefined>();
  const getPartner = async (id: number): Promise<Partner | undefined> => {
    if (partnerCache.has(id)) return partnerCache.get(id);
    const p = await storage.getPartnerById(id);
    partnerCache.set(id, p);
    return p;
  };

  const survivors: PartnerPlacement[] = [];
  for (const p of eligible) {
    const partner = await getPartner(p.partnerId);
    if (!partner || !isPartnerActive(partner)) continue;
    survivors.push(p);
  }

  if (survivors.length === 0) return { placements: [] };

  // 3. Weighted shuffle + de-duplicate by partner_id
  const weights = survivors.map(placementWeight);
  const shuffled = weightedShuffle(weights, random);

  const seenPartners = new Set<number>();
  const selected: PartnerPlacement[] = [];

  for (const idx of shuffled) {
    if (selected.length >= effectiveLimit) break;
    const p = survivors[idx];
    if (seenPartners.has(p.partnerId)) continue;
    seenPartners.add(p.partnerId);
    selected.push(p);
  }

  // 4. Build response — impression event logging is handled by the HTTP layer
  //    (fire-and-forget) so this function just returns the placements.
  //    We generate UUIDs here so the HTTP layer can use them for event_id.
  const effectiveSampleRate = isNaN(sampleRate) ? 0.1 : sampleRate;

  const placements: SelectedPlacement[] = selected.map((p) => {
    const uuid = crypto.randomUUID();
    const sampled = random() < effectiveSampleRate;
    return {
      id: p.id,
      partner_id: p.partnerId,
      surface: p.surface,
      creative: buildCreative(p),
      target_url: p.creativeUrl ?? "",
      weight: placementWeight(p),
      event_id: sampled ? uuid : null,
      // Internal fields for event logging (stripped before HTTP response)
      _uuid: uuid,
      _sampled: sampled,
    } as SelectedPlacement & { _uuid: string; _sampled: boolean };
  });

  return { placements };
}

/**
 * Debug variant — returns full ranking trace including filtered placements.
 * Used by the admin debug endpoint.
 */
export async function debugPlacements(input: Omit<SelectPlacementsInput, "limit"> & { limit?: number }): Promise<DebugResult> {
  const {
    surface,
    category = null,
    area = null,
    limit = 1,
    storage,
    env = {},
    nowMs = Date.now(),
    random = Math.random,
  } = input;

  const effectiveLimit = Math.min(Math.max(limit, 1), 3);
  const allPlacements = await storage.getActivePlacementsBySurface(surface);

  const categoryId = category ?? null;
  const areaId = area ?? null;

  const considered: DebugEntry[] = [];
  const eligible: PartnerPlacement[] = [];

  for (const p of allPlacements) {
    const w = placementWeight(p);

    if (!isPlacementTimeActive(p, nowMs)) {
      considered.push({ placement_id: p.id, partner_id: p.partnerId, weight: w, status: "filtered", reason: "not time-active" });
      continue;
    }

    const catFilter = parseJsonIds(p.categoryFilter);
    if (categoryId !== null && !matchesFilter([categoryId], catFilter)) {
      considered.push({ placement_id: p.id, partner_id: p.partnerId, weight: w, status: "filtered", reason: "category mismatch" });
      continue;
    }

    const areaFilter = parseJsonIds(p.areaFilter);
    if (areaId !== null && !matchesFilter([areaId], areaFilter)) {
      considered.push({ placement_id: p.id, partner_id: p.partnerId, weight: w, status: "filtered", reason: "area mismatch" });
      continue;
    }

    eligible.push(p);
  }

  // Check partner status
  const partnerCache = new Map<number, Partner | undefined>();
  const getPartner = async (id: number) => {
    if (partnerCache.has(id)) return partnerCache.get(id);
    const p = await storage.getPartnerById(id);
    partnerCache.set(id, p);
    return p;
  };

  const survivors: PartnerPlacement[] = [];
  for (const p of eligible) {
    const partner = await getPartner(p.partnerId);
    const w = placementWeight(p);
    if (!partner) {
      considered.push({ placement_id: p.id, partner_id: p.partnerId, weight: w, status: "filtered", reason: "partner not found" });
      continue;
    }
    if (!isPartnerActive(partner)) {
      considered.push({ placement_id: p.id, partner_id: p.partnerId, weight: w, status: "filtered", reason: "inactive partner" });
      continue;
    }
    survivors.push(p);
  }

  // Weighted shuffle
  const weights = survivors.map(placementWeight);
  const shuffled = weightedShuffle(weights, random);

  const seenPartners = new Set<number>();
  const selectedIds: number[] = [];

  for (const idx of shuffled) {
    if (selectedIds.length >= effectiveLimit) break;
    const p = survivors[idx];
    if (seenPartners.has(p.partnerId)) {
      considered.push({ placement_id: p.id, partner_id: p.partnerId, weight: placementWeight(p), status: "filtered", reason: "duplicate partner in response" });
      continue;
    }
    seenPartners.add(p.partnerId);
    selectedIds.push(p.id);
    considered.push({ placement_id: p.id, partner_id: p.partnerId, weight: placementWeight(p), status: "selected" });
  }

  // Any survivors not selected (beyond limit) are filtered
  for (const p of survivors) {
    if (!selectedIds.includes(p.id) && !considered.find((c) => c.placement_id === p.id)) {
      considered.push({ placement_id: p.id, partner_id: p.partnerId, weight: placementWeight(p), status: "filtered", reason: "not selected (limit reached)" });
    }
  }

  return {
    surface,
    category: categoryId,
    area: areaId,
    considered,
    selected_placement_ids: selectedIds,
  };
}
