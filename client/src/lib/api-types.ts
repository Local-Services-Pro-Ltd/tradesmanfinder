// Client-side shapes mirroring the server JSON responses.
export interface Category {
  id: number;
  slug: string;
  name: string;
  icon: string;
  description: string;
  parentId: number | null;
}

export interface Area {
  id: number;
  slug: string;
  name: string;
  region: string;
  latitude: number;
  longitude: number;
}

export interface CardSummary {
  warnings: number;
  yellows: number;
  reds: number;
  highestActive: "warning" | "yellow" | "red" | null;
  suspendedUntil: number | null;
  bannedAt: number | null;
  publicBadge: { label: string; tone: "warning" | "yellow" | "red"; tooltip: string } | null;
  isPubliclyHidden: boolean;
  isLoginBlocked: boolean;
  isFeaturedRevoked: boolean;
}

export interface TradesmanCard {
  id: number;
  tradesmanId: number;
  cardType: "warning" | "yellow" | "red";
  reason: string | null;          // null if redacted (not admin/owner)
  grossMisconduct: boolean;
  issuedAt: number;
  expiresAt: number | null;
  rescindedAt: number | null;
  rescindedBy: string | null;
  rescindedReason: string | null;
  issuedBy: string | null;
  active?: boolean;
}

export interface ModerationLogEntry {
  id: number;
  tradesmanId: number;
  cardId: number | null;
  action: "issue" | "rescind";
  cardType: string | null;
  reason: string;
  adminId: string;
  createdAt: number;
}

export interface Tradesman {
  id: number;
  slug: string;
  businessName: string;
  ownerName: string;
  email: string;
  phone: string;
  bio: string;
  postcode: string;
  areaId: number;
  heroImageUrl: string;
  gallery: string; // JSON string
  categories: string; // JSON string of number[]
  yearsExperience: number;
  verified: boolean;
  insured: boolean;
  licensed: boolean;
  gasSafeVerified: boolean;
  scopeBadges: string; // JSON string of string[]
  videoUrl: string | null;
  featured: boolean;
  ratingAverage: number;
  ratingCount: number;
  responseTimeMinutes: number;
  createdAt: number;
  // Stripe / Featured Listing (PR-E3 series). May be null when the
  // tradesperson has never opened a Checkout session.
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null; // 'active' | 'past_due' | 'canceled' | etc.
  featuredUntil: number | null;       // unix ms; >0 while Featured is paid through
  // Attached by the server when card data is loaded:
  cardSummary?: CardSummary;
  cards?: TradesmanCard[];
  // Attached by attachCardSummary for tradesman GET endpoints. Holds the
  // factual metadata from the latest *approved + unexpired* verification of
  // each kind. Null fields mean either (a) no approved doc, or (b) approved
  // but expired. The storage filePath is NEVER exposed here.
  verificationSummary?: VerificationPublicSummary;
  // Added by PR D: homeowner verification access (requires tf_homeowner cookie).
  verificationAccessStatus?: "none" | "pending" | "granted" | "denied" | "revoked";
  verificationProof?: VerificationProof;
  verificationAccessGrantedUntil?: number; // unix ms
}

export interface VerificationProof {
  insurance?: {
    coverGbp: number;
    expiryDate: string;  // YYYY-MM-DD
    verifiedAt: string;  // YYYY-MM-DD
  };
  qualification?: {
    qualificationType: string;
    expiryDate: string;  // YYYY-MM-DD
    verifiedAt: string;  // YYYY-MM-DD
  };
}

export interface VerificationPublicSummary {
  insurance: { coverGbp: number | null; expiryDate: string | null } | null;
  qualification: { qualificationType: string | null; expiryDate: string | null } | null;
}

// Mirrors server tradesman_verifications row (admin queue + dashboard list).
// filePath is included only when the admin is authenticated; the dashboard
// receives objects with filePath omitted (see server/routes.ts).
//
// 'companies_house' rows have no file (file* fields are null) and instead
// carry companyNumber + evidenceData (a trimmed snapshot of the CH response).
export interface VerificationRecord {
  id: number;
  tradesmanId: number;
  kind:
    | "insurance" | "qualification" | "companies_house" | "gas_safe"
    // Generic register kinds (PR-F). All use the shared registration_number /
    // register_url columns and the GenericRegisterEvidence shape below.
    | "niceic" | "napit" | "mcs" | "oftec" | "trustmark" | "fgas" | "ciphe";
  filePath?: string | null;
  fileMimeType: string | null;
  fileSizeBytes: number | null;
  qualificationType: string | null;
  insuranceCoverGbp: number | null;
  expiryDate: string | null;
  status: "pending" | "approved" | "rejected";
  submittedAt: number;
  reviewedAt: number | null;
  reviewedBy: string | null;
  reviewerNote: string | null;
  // Companies House fields (kind='companies_house' only).
  companyNumber?: string | null;
  // Gas Safe fields (kind='gas_safe' only).
  gasSafeNumber?: string | null;
  gasSafeRegisterUrl?: string | null;
  // Generic register fields (PR-F). Populated for kinds in
  // {niceic, napit, mcs, oftec, trustmark, fgas, ciphe}.
  registrationNumber?: string | null;
  registerUrl?: string | null;
  // evidenceData shape varies by kind — CompaniesHouseEvidence for
  // companies_house rows, GasSafeEvidence for gas_safe rows,
  // GenericRegisterEvidence for the seven generic register kinds.
  // Callers discriminate on `kind` before reading the snapshot.
  evidenceData?: CompaniesHouseEvidence | GasSafeEvidence | GenericRegisterEvidence | null;
  verifiedAt?: number | null;
  source?: "pro_submission" | "admin_backfill" | "automated_recheck" | null;
}

// Pro-submitted Gas Safe evidence — surfaced verbatim to admin reviewer.
// Critically: this is NOT verified against the Gas Safe Register at
// submission time (the register has no public API and blocks server-side
// access via WAF). The admin clicks gasSafeRegisterUrl to confirm.
export interface GasSafeEvidence {
  gas_safe_number: string;
  business_name: string;
  postcode: string;
  submitted_at: string;
  verification_method: "pro_self_submission_pending_admin_review";
}

// Generic register evidence (PR-F) — shared shape for the seven
// submit-for-admin-review register kinds. Same fields as GasSafeEvidence
// but keyed on the generic registration_number rather than gas_safe_number.
// The admin uses business_name + postcode to confirm a match on the
// public register before approving.
export interface GenericRegisterEvidence {
  registration_number: string;
  business_name: string;
  postcode: string;
  submitted_at: string;
  verification_method: "pro_self_submission_pending_admin_review";
}

export interface CompaniesHouseEvidence {
  company_number: string;
  company_name: string;
  company_status: string;
  type: string;
  date_of_creation?: string | null;
  date_of_cessation?: string | null;
  jurisdiction?: string | null;
  registered_office_address?: {
    address_line_1?: string;
    address_line_2?: string;
    locality?: string;
    region?: string;
    postal_code?: string;
    country?: string;
  } | null;
  fetched_at?: string;
}

// Type guards for narrowing the evidenceData union. Callers should
// discriminate on the verification row's `kind` first; these helpers
// give back a typed snapshot or null when the row has no evidence.
export function asCompaniesHouseEvidence(
  evidence: CompaniesHouseEvidence | GasSafeEvidence | GenericRegisterEvidence | null | undefined
): CompaniesHouseEvidence | null {
  if (!evidence) return null;
  return "company_number" in evidence ? (evidence as CompaniesHouseEvidence) : null;
}

export function asGasSafeEvidence(
  evidence: CompaniesHouseEvidence | GasSafeEvidence | GenericRegisterEvidence | null | undefined
): GasSafeEvidence | null {
  if (!evidence) return null;
  return "gas_safe_number" in evidence ? (evidence as GasSafeEvidence) : null;
}

export function asGenericRegisterEvidence(
  evidence: CompaniesHouseEvidence | GasSafeEvidence | GenericRegisterEvidence | null | undefined
): GenericRegisterEvidence | null {
  if (!evidence) return null;
  return "registration_number" in evidence ? (evidence as GenericRegisterEvidence) : null;
}

export interface CompaniesHouseSearchItem {
  company_number: string;
  title: string;
  company_status: string;
  company_type?: string;
  address_snippet?: string;
  date_of_creation?: string;
}

export interface CompaniesHouseSearchResult {
  items: CompaniesHouseSearchItem[];
  total_results: number;
  page_number: number;
  items_per_page: number;
}

export interface Job {
  id: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  postcode: string;
  categoryId: number;
  areaId: number | null;
  title: string;
  description: string;
  urgency: string;
  budgetRange: string;
  photos: string;
  status: string;
  createdAt: number;
}

export interface Quote {
  id: number;
  jobId: number;
  tradesmanId: number;
  priceEstimate: string;
  message: string;
  status: string;
  createdAt: number;
}

export interface Review {
  id: number;
  tradesmanId: number;
  customerName: string;
  rating: number;
  title: string;
  body: string;
  jobId: number | null;
  verified: boolean;
  createdAt: number;
}

export interface Stats {
  tradesmen: number;
  verified: number;
  jobs: number;
  reviews: number;
  avgResponseMinutes: number;
}

export interface DashboardData {
  tradesman: Tradesman;
  leads: { quote: Quote; job: Job }[];
  credits: number;
  transactions: { id: number; tradesmanId: number; amount: number; reason: string; relatedJobId: number | null; createdAt: number }[];
  reviews: Review[];
  cards?: TradesmanCard[];
  cardSummary?: CardSummary;
}

export function parseJsonArray<T = unknown>(s: string | undefined | null): T[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function formatResponseTime(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.round(minutes / 60);
  return `${h} hr${h > 1 ? "s" : ""}`;
}

export function timeAgo(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months > 1 ? "s" : ""} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years > 1 ? "s" : ""} ago`;
}
