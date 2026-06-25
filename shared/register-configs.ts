/**
 * Register configs — single source of truth for the per-register metadata
 * that varies between NICEIC, NAPIT, MCS, OFTEC, TrustMark, F-Gas, and CIPHE.
 *
 * Every other layer (server route, storage method, client form, evidence
 * preview, admin page) reads from this table. Adding an eighth register
 * means: one new entry here, one new kind in VERIFICATION_KINDS / the
 * tv_evidence_shape CHECK constraint, and one thin route/UI binding.
 *
 * What does NOT go here:
 *   - `companies_house` and `gas_safe` keep their own bespoke columns
 *     (company_number / gas_safe_number) and pre-PR-F server routes.
 *     They predate this abstraction; we don't churn them. The seven
 *     entries below ARE the abstraction's customers.
 *   - Badge implications. Those live in shared/register-implications.ts;
 *     this file describes the SUBMISSION FORM and STORAGE shape only.
 *
 * Conventions:
 *   - kind matches the DB row's `kind` (lowercase, snake-case if multi-word).
 *   - normaliseNumber returns the canonical stored form (uppercase, no
 *     whitespace). The DB unique index keys on this canonical form.
 *   - validateNumber returns null on success, an error string on failure.
 *     Format-only validation; the admin does the live register lookup.
 *   - buildRegisterUrl returns a deep-link to the public register so the
 *     admin can click through and visually confirm before approving.
 *
 * Research basis: workspace/uk_trade_registers_research.md (June 2026).
 */

import type { GenericRegisterKind } from "./schema";

export interface RegisterConfig {
  /** DB row kind. Must match a value in GENERIC_REGISTER_KINDS. */
  kind: GenericRegisterKind;
  /** Short label shown in headings, badges, and form titles. */
  label: string;
  /** Lucide icon name (kept as a string so this module stays platform-free). */
  iconName:
    | "Zap"          // electrical
    | "Sun"          // renewables
    | "Flame"        // oil / heat / gas-adjacent
    | "ShieldCheck"  // trustmark
    | "Snowflake"    // f-gas refrigerant
    | "Wrench";      // plumbing / general
  /** Singular noun for the registration number on the form ("certification number", "membership number"). */
  numberLabel: string;
  /** Placeholder shown in the input. */
  numberPlaceholder: string;
  /** One-line description above the form explaining what an admin will check. */
  formDescription: string;
  /** Normalise a user-entered registration number to its canonical stored form. */
  normaliseNumber: (raw: string) => string;
  /** Format-only validation. Returns null on success, error message on failure. */
  validateNumber: (normalised: string) => string | null;
  /** Deep-link to the public register's lookup page for this number. */
  buildRegisterUrl: (normalised: string) => string;
  /** Whether the form should also collect a postcode for the admin reviewer. */
  collectsPostcode: boolean;
  /** Whether the form should also collect a business name. */
  collectsBusinessName: boolean;
}

/** Compact, alphanumeric uppercase normaliser used by most schemes. */
function normaliseAlnumUpper(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s/-]+/g, "");
}

/** Digits-only normaliser, drops leading zeros. Matches the Gas Safe pattern. */
function normaliseDigits(raw: string): string {
  return raw.trim().replace(/\s+/g, "").replace(/^0+(?=\d)/, "");
}

export const REGISTER_CONFIGS: Record<GenericRegisterKind, RegisterConfig> = {
  /**
   * NICEIC — UK's leading domestic electrical Competent Person Scheme.
   * Enrolment numbers are typically alphanumeric and printed on the
   * contractor's certificate ("Approved Contractor" or "Domestic
   * Installer"). The public Search the Register tool at
   * https://www.niceic.com/find-a-contractor accepts the contractor name
   * or enrolment number directly.
   */
  niceic: {
    kind: "niceic",
    label: "NICEIC",
    iconName: "Zap",
    numberLabel: "NICEIC enrolment number",
    numberPlaceholder: "e.g. D123456",
    formDescription:
      "Your NICEIC enrolment number, business name, and postcode. An admin will confirm your record on niceic.com before approving.",
    normaliseNumber: normaliseAlnumUpper,
    validateNumber: (n) =>
      /^[A-Z0-9]{4,15}$/.test(n)
        ? null
        : "NICEIC number must be 4–15 letters or digits.",
    buildRegisterUrl: (n) =>
      `https://www.niceic.com/find-a-contractor?search=${encodeURIComponent(n)}`,
    collectsPostcode: true,
    collectsBusinessName: true,
  },

  /**
   * NAPIT — National Association of Professional Inspectors and Testers.
   * Multi-trade Competent Person Scheme (electrical/plumbing/heating).
   * NAPIT IDs are usually numeric with a short alpha prefix.
   * Public search: https://www.napit.org.uk/find-an-installer/
   */
  napit: {
    kind: "napit",
    label: "NAPIT",
    iconName: "Zap",
    numberLabel: "NAPIT membership number",
    numberPlaceholder: "e.g. 12345",
    formDescription:
      "Your NAPIT membership number, business name, and postcode. An admin will confirm your record on napit.org.uk before approving.",
    normaliseNumber: normaliseAlnumUpper,
    validateNumber: (n) =>
      /^[A-Z0-9]{3,15}$/.test(n)
        ? null
        : "NAPIT number must be 3–15 letters or digits.",
    buildRegisterUrl: (n) =>
      `https://www.napit.org.uk/find-an-installer/?searchTerm=${encodeURIComponent(n)}`,
    collectsPostcode: true,
    collectsBusinessName: true,
  },

  /**
   * MCS — Microgeneration Certification Scheme. Required for grant-funded
   * renewables installs (solar PV, heat pumps, biomass).
   * MCS contractor IDs are formatted MCS XXXXXX.
   * Public search: https://mcscertified.com/find-an-installer/
   */
  mcs: {
    kind: "mcs",
    label: "MCS",
    iconName: "Sun",
    numberLabel: "MCS contractor number",
    numberPlaceholder: "e.g. MCS 123456",
    formDescription:
      "Your MCS contractor number, business name, and postcode. An admin will confirm your record on mcscertified.com before approving.",
    normaliseNumber: normaliseAlnumUpper,
    validateNumber: (n) =>
      /^(MCS)?\d{4,8}$/.test(n)
        ? null
        : "MCS number must be 4–8 digits (with optional MCS prefix).",
    buildRegisterUrl: (n) => {
      const digits = n.replace(/^MCS/, "");
      return `https://mcscertified.com/find-an-installer/?search=${encodeURIComponent(digits)}`;
    },
    collectsPostcode: true,
    collectsBusinessName: true,
  },

  /**
   * OFTEC — Oil Firing Technical Association. Dominant register for
   * domestic oil heating. Technician IDs are formatted C/12345 or similar.
   * Public search: https://www.oftec.org/consumers/find-a-technician
   */
  oftec: {
    kind: "oftec",
    label: "OFTEC",
    iconName: "Flame",
    numberLabel: "OFTEC technician ID",
    numberPlaceholder: "e.g. C/12345",
    formDescription:
      "Your OFTEC technician ID, business name, and postcode. An admin will confirm your record on oftec.org before approving.",
    normaliseNumber: normaliseAlnumUpper,
    validateNumber: (n) =>
      /^[A-Z0-9]{4,15}$/.test(n)
        ? null
        : "OFTEC ID must be 4–15 letters or digits (slashes removed).",
    buildRegisterUrl: (n) =>
      `https://www.oftec.org/consumers/find-a-technician?search=${encodeURIComponent(n)}`,
    collectsPostcode: true,
    collectsBusinessName: true,
  },

  /**
   * TrustMark — government-endorsed cross-trade quality mark. Each
   * registered tradesperson has a unique TrustMark licence number.
   * Public search: https://www.trustmark.org.uk/find-a-tradesperson
   */
  trustmark: {
    kind: "trustmark",
    label: "TrustMark",
    iconName: "ShieldCheck",
    numberLabel: "TrustMark licence number",
    numberPlaceholder: "e.g. 1234567",
    formDescription:
      "Your TrustMark licence number, business name, and postcode. An admin will confirm your record on trustmark.org.uk before approving.",
    normaliseNumber: normaliseDigits,
    validateNumber: (n) =>
      /^\d{4,10}$/.test(n)
        ? null
        : "TrustMark licence must be 4–10 digits.",
    buildRegisterUrl: (n) =>
      `https://www.trustmark.org.uk/find-a-tradesperson?search=${encodeURIComponent(n)}`,
    collectsPostcode: true,
    collectsBusinessName: true,
  },

  /**
   * F-Gas (REFCOM) — UK F-Gas Regulation register for refrigerant
   * handling. Company IDs are formatted REF nnnnn.
   * Public search: https://www.refcom.org.uk/find-a-company
   */
  fgas: {
    kind: "fgas",
    label: "F-Gas (REFCOM)",
    iconName: "Snowflake",
    numberLabel: "REFCOM company number",
    numberPlaceholder: "e.g. REF12345",
    formDescription:
      "Your REFCOM (F-Gas) company number, business name, and postcode. An admin will confirm your record on refcom.org.uk before approving.",
    normaliseNumber: normaliseAlnumUpper,
    validateNumber: (n) =>
      /^(REF)?\d{3,8}$/.test(n)
        ? null
        : "REFCOM number must be 3–8 digits (with optional REF prefix).",
    buildRegisterUrl: (n) => {
      const digits = n.replace(/^REF/, "");
      return `https://www.refcom.org.uk/find-a-company?search=${encodeURIComponent(digits)}`;
    },
    collectsPostcode: true,
    collectsBusinessName: true,
  },

  /**
   * CIPHE — Chartered Institute of Plumbing & Heating Engineering.
   * Membership body (not a mandatory register). Members have a numeric
   * membership number printed on the membership card.
   * Public search: members directory at https://www.ciphe.org.uk/find-a-plumber
   */
  ciphe: {
    kind: "ciphe",
    label: "CIPHE",
    iconName: "Wrench",
    numberLabel: "CIPHE membership number",
    numberPlaceholder: "e.g. 123456",
    formDescription:
      "Your CIPHE membership number, business name, and postcode. An admin will confirm your record on ciphe.org.uk before approving.",
    normaliseNumber: normaliseAlnumUpper,
    validateNumber: (n) =>
      /^[A-Z0-9]{4,12}$/.test(n)
        ? null
        : "CIPHE membership number must be 4–12 letters or digits.",
    buildRegisterUrl: (n) =>
      `https://www.ciphe.org.uk/find-a-plumber?search=${encodeURIComponent(n)}`,
    collectsPostcode: true,
    collectsBusinessName: true,
  },
};

/** Return the config for a register kind, or null if not a generic register. */
export function getRegisterConfig(
  kind: string,
): RegisterConfig | null {
  return (REGISTER_CONFIGS as Record<string, RegisterConfig>)[kind] ?? null;
}

/** Type guard for narrowing a string to GenericRegisterKind. */
export function isGenericRegisterKind(kind: string): kind is GenericRegisterKind {
  return kind in REGISTER_CONFIGS;
}
