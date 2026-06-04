// Card status helpers shared between client and server.
// A "card" is a moderation strike issued for a SUBSTANTIATED customer complaint
// or a verified negative review. Football-style 3-strike escalation:
//   1st substantiated complaint -> Warning
//   2nd substantiated complaint -> Yellow card
//   3rd substantiated complaint -> Red card (strike-off)
// Gross misconduct = instant Red, skipping warnings.

import type { TradesmanCard } from "./schema";

export const CARD_EXPIRY_MS = {
  warning: 6 * 30 * 24 * 60 * 60 * 1000,   // ~6 months
  yellow:  12 * 30 * 24 * 60 * 60 * 1000,  // ~12 months
  red:     null as null,                    // permanent
};

export const YELLOW_SUSPENSION_DAYS = 7;
export const YELLOW_SUSPENSION_MS = YELLOW_SUSPENSION_DAYS * 24 * 60 * 60 * 1000;

export function isCardActive(c: TradesmanCard, now: number = Date.now()): boolean {
  if (c.rescindedAt) return false;
  if (c.expiresAt && c.expiresAt < now) return false;
  return true;
}

export interface CardSummary {
  warnings: number;
  yellows: number;
  reds: number;
  highestActive: "warning" | "yellow" | "red" | null;
  suspendedUntil: number | null;   // unix ms — non-null while a yellow suspension is active
  bannedAt: number | null;          // when the active red was issued
  // For Name & Shame public badge:
  publicBadge: { label: string; tone: "warning" | "yellow" | "red"; tooltip: string } | null;
  // For functional gating:
  isPubliclyHidden: boolean;        // true if active red (banned)
  isLoginBlocked: boolean;          // true if active red
  isFeaturedRevoked: boolean;       // true if active yellow or red
}

export function summarizeCards(cards: TradesmanCard[], now: number = Date.now()): CardSummary {
  const active = cards.filter((c) => isCardActive(c, now));
  const warnings = active.filter((c) => c.cardType === "warning").length;
  const yellows  = active.filter((c) => c.cardType === "yellow").length;
  const reds     = active.filter((c) => c.cardType === "red").length;

  const activeRed    = active.find((c) => c.cardType === "red");
  const activeYellow = active.find((c) => c.cardType === "yellow");

  let highestActive: CardSummary["highestActive"] = null;
  if (reds > 0) highestActive = "red";
  else if (yellows > 0) highestActive = "yellow";
  else if (warnings > 0) highestActive = "warning";

  // Yellow suspension window: yellow card stays "in effect" forever (12-month expiry)
  // but the *suspension* lasts 7 days. After that the badge stays but they can be searched again.
  let suspendedUntil: number | null = null;
  if (activeYellow) {
    const susEnd = activeYellow.issuedAt + YELLOW_SUSPENSION_MS;
    if (susEnd > now) suspendedUntil = susEnd;
  }

  // Build the public badge (Name & Shame)
  let publicBadge: CardSummary["publicBadge"] = null;
  if (activeRed) {
    publicBadge = { label: "Red card", tone: "red", tooltip: "Removed from directory \u2014 permanent ban" };
  } else if (activeYellow) {
    const stillSuspended = !!suspendedUntil;
    publicBadge = {
      label: yellows > 1 ? `${yellows}\u00d7 Yellow card` : "Yellow card",
      tone: "yellow",
      tooltip: stillSuspended ? "Currently suspended \u2014 under review" : "Under review",
    };
  } else if (warnings > 0) {
    publicBadge = {
      label: warnings > 1 ? `${warnings} warnings` : "1 warning",
      tone: "warning",
      tooltip: "Has received a formal warning from moderators",
    };
  }

  return {
    warnings, yellows, reds,
    highestActive,
    suspendedUntil,
    bannedAt: activeRed?.issuedAt ?? null,
    publicBadge,
    isPubliclyHidden: !!activeRed,
    isLoginBlocked: !!activeRed,
    isFeaturedRevoked: !!activeRed || !!activeYellow,
  };
}

/**
 * Auto-escalation: given a tradesman's current card history, what card should
 * the next "issue card" action create?
 *
 * 3-strike rule:
 *   - 0 active cards  -> Warning  (1st strike)
 *   - 1 active card   -> Yellow   (2nd strike)
 *   - 2+ active cards -> Red      (3rd strike = strike-off)
 *
 * Returns the card type and computed expiry (null = permanent).
 */
export function autoEscalate(activeCards: TradesmanCard[], now: number = Date.now()): {
  cardType: "warning" | "yellow" | "red";
  expiresAt: number | null;
} {
  const active = activeCards.filter((c) => isCardActive(c, now));
  const reds = active.filter((c) => c.cardType === "red").length;

  if (reds > 0) {
    // Already red — issuing another card stays red.
    return { cardType: "red", expiresAt: null };
  }
  if (active.length >= 2) {
    // 3rd strike of any colour -> Red (permanent)
    return { cardType: "red", expiresAt: null };
  }
  if (active.length === 1) {
    // 2nd strike -> Yellow
    return { cardType: "yellow", expiresAt: now + (CARD_EXPIRY_MS.yellow as number) };
  }
  // 1st strike -> Warning
  return { cardType: "warning", expiresAt: now + (CARD_EXPIRY_MS.warning as number) };
}

export function computeExpiry(cardType: "warning" | "yellow" | "red", grossMisconduct: boolean, now: number = Date.now()): number | null {
  if (cardType === "red" || grossMisconduct) return null;
  if (cardType === "yellow") return now + (CARD_EXPIRY_MS.yellow as number);
  return now + (CARD_EXPIRY_MS.warning as number);
}
