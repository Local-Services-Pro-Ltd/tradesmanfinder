/**
 * Register-implications lookup table.
 *
 * Each UK trade register declares its own pre-conditions: some mandate
 * insurance, some mandate qualifications, some are scope-specific. When we
 * verify a pro against a register, we infer which of our generic trust
 * badges (verified / insured / licensed) AND which scope badge to light up.
 *
 * This table is the single source of truth. The admin decide endpoint
 * reads from it; future automated register re-check jobs read from it;
 * the public profile renderer reads from it to attribute badges
 * ("Insured — verified via NICEIC"). Adding a new register = one new
 * entry here + the matching verification kind, schema constraint, and
 * lookup helper. No business logic lives in if/else chains.
 *
 * Research basis: /home/user/workspace/uk_trade_registers_research.md
 * (June 2026, all primary sources cited).
 */

import type { VerificationKind } from "./schema";

export type GenericBadge = "verified" | "insured" | "licensed";

export interface RegisterImplication {
  /** The verification kind this implication applies to. Must match a
   *  value in VERIFICATION_KINDS. */
  kind: VerificationKind;
  /** Generic boolean flags on the tradesmen row this register implies.
   *  An approved evidence row of this kind flips each listed flag to TRUE.
   *  Pre-conditions baked into UK register rules — see research doc. */
  impliesBadges: GenericBadge[];
  /** Free-form scope badge shown as a pill on the pro card. NULL for
   *  registers that aren't scope-specific (e.g. Companies House). */
  scopeBadge: string | null;
  /** Short human-readable rationale, embedded in evidence_data when an
   *  evidence row is approved. Powers tooltips like "Insured — verified
   *  via Gas Safe Register" so customers see the provenance. */
  rationale: string;
}

/**
 * The 7 UK registers we plan to support, plus Companies House. Each entry
 * documents the legal/scheme basis for the badges it implies.
 *
 * Currently only `companies_house` and `gas_safe` are wired into
 * VERIFICATION_KINDS. Adding NICEIC/NAPIT/MCS/OFTEC/TrustMark/F-Gas/CIPHE
 * requires extending the enum, the tv_evidence_shape CHECK, and adding
 * the matching createXVerification helper. Each is one small PR.
 */
export const REGISTER_IMPLICATIONS: Record<string, RegisterImplication> = {
  /**
   * Companies House — identity-only signal. The Companies House register
   * confirms the legal entity exists at the stated address; it doesn't
   * vet insurance or competence. So only `verified` lights up.
   */
  companies_house: {
    kind: "companies_house",
    impliesBadges: ["verified"],
    scopeBadge: null,
    rationale:
      "Companies House confirms the legal entity exists and is active at the registered address.",
  },

  /**
   * Gas Safe Register — legally required for any gas work in the UK
   * (Gas Safety (Installation and Use) Regulations 1998). PLI is
   * universally held at registration (£2m standard). ACS quals
   * mandatory. Therefore: verified + insured + licensed.
   */
  gas_safe: {
    kind: "gas_safe",
    impliesBadges: ["verified", "insured", "licensed"],
    scopeBadge: "Gas Work",
    rationale:
      "Gas Safe Register is legally required for gas work in the UK. Membership requires current public liability insurance and held ACS (or equivalent) gas qualifications, both verified by Gas Safe at registration and renewal.",
  },

  // ──────────────────────────────────────────────────────────────────
  // Future register kinds — declared in advance so the table is
  // complete and the admin/code review can debate badge implications
  // here, not later in a PR per register. The verification kind itself
  // is NOT yet in VERIFICATION_KINDS; uncomment + add migration when
  // shipping each.
  // ──────────────────────────────────────────────────────────────────

  /**
   * NICEIC — leading domestic electrical Competent Person Scheme.
   * £2m PLI mandatory and verified at annual assessment. Level 3
   * Diploma + 18th Edition (BS 7671) + Part P mandatory.
   */
  niceic: {
    kind: "niceic" as VerificationKind,
    impliesBadges: ["verified", "insured", "licensed"],
    scopeBadge: "Electrical Work",
    rationale:
      "NICEIC certification requires £2m public liability insurance and Level 3 electrical qualifications + 18th Edition (BS 7671), all verified at annual on-site assessment.",
  },

  /**
   * NAPIT — broad multi-trade Competent Person Scheme. Same electrical
   * rigour as NICEIC; also covers plumbing/heating/ventilation. £2m PLI
   * mandatory. Level 3 NVQ + BS 7671 18th Ed.
   */
  napit: {
    kind: "napit" as VerificationKind,
    impliesBadges: ["verified", "insured", "licensed"],
    scopeBadge: "Electrical Work",
    rationale:
      "NAPIT certification requires £2m public liability insurance and Level 3 trade qualifications, verified at annual assessment.",
  },

  /**
   * MCS — Microgeneration Certification Scheme. Required for solar PV,
   * heat pumps, biomass, micro-wind, micro-hydro. £2m PLI mandatory.
   * Tech-specific qualifications mandatory per technology installed.
   */
  mcs: {
    kind: "mcs" as VerificationKind,
    impliesBadges: ["verified", "insured", "licensed"],
    scopeBadge: "Renewables",
    rationale:
      "MCS certification requires £2m public liability insurance and MCS-approved technology-specific qualifications, verified at annual certification cycle.",
  },

  /**
   * OFTEC — Oil Firing Technical Association. Dominant register for
   * domestic oil heating. £2m PLI mandatory. OFT codes / City & Guilds
   * 6189 mandatory.
   */
  oftec: {
    kind: "oftec" as VerificationKind,
    impliesBadges: ["verified", "insured", "licensed"],
    scopeBadge: "Oil Heating",
    rationale:
      "OFTEC registration requires £2m public liability insurance and OFTEC-approved oil heating qualifications, with quals refreshed every 5 years.",
  },

  /**
   * TrustMark — government-endorsed cross-trade quality mark.
   * EL £5m + PLI mandatory under TrustMark Framework Operating
   * Requirements. Quality of work audited by approved Scheme Providers
   * (PLI is mandatory, but qualifications come from the underlying
   * Scheme Provider — TrustMark doesn't directly verify quals).
   */
  trustmark: {
    kind: "trustmark" as VerificationKind,
    impliesBadges: ["verified", "insured"],
    scopeBadge: "TrustMark",
    rationale:
      "TrustMark registration requires £5m employer's liability and public liability insurance, plus quality audits via an approved Scheme Provider.",
  },

  /**
   * F-Gas / REFCOM — legally required for refrigerant handling
   * (UK F-Gas Regulation). Quals mandatory (C&G 2079 etc).
   * REFCOM does NOT verify PLI — do not auto-light `insured`.
   */
  fgas: {
    kind: "fgas" as VerificationKind,
    impliesBadges: ["verified", "licensed"],
    scopeBadge: "F-Gas Certified",
    rationale:
      "F-Gas (REFCOM) certification is legally required for refrigerant handling under the UK F-Gas Regulation. Qualifications verified; public liability insurance is NOT verified by REFCOM and must be confirmed separately.",
  },

  /**
   * CIPHE — Chartered Institute of Plumbing & Heating Engineering.
   * Membership body (not a mandatory register). Grades indicate
   * professional standing but CIPHE does NOT mandate PLI and is
   * not a legal register. Surface as scope badge only.
   */
  ciphe: {
    kind: "ciphe" as VerificationKind,
    impliesBadges: ["verified"],
    scopeBadge: "CIPHE Member",
    rationale:
      "CIPHE is a chartered professional membership body. Membership confirms identity and professional standing; CIPHE does not mandate public liability insurance.",
  },
};

/**
 * Resolve which generic flags + scope badge an approved register
 * verification implies. Returns an empty implication if the kind is
 * unknown — callers should fall back to the legacy hardcoded mapping
 * (insurance→insured, qualification→licensed) for the two file-backed
 * kinds, which are not in this table.
 */
export function getRegisterImplication(
  kind: VerificationKind | string,
): RegisterImplication | null {
  return REGISTER_IMPLICATIONS[kind] ?? null;
}
