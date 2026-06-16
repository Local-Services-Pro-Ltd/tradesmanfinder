import { pgTable, text, integer, real, bigint, boolean, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/* ──────────────────────────────────────────────
   CATEGORIES
   ────────────────────────────────────────────── */
export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  icon: text("icon").notNull(), // lucide icon name
  description: text("description").notNull(),
  parentId: integer("parent_id"), // for sub-trades
});

export const insertCategorySchema = createInsertSchema(categories).omit({ id: true });
export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type Category = typeof categories.$inferSelect;

/* ──────────────────────────────────────────────
   AREAS
   ────────────────────────────────────────────── */
export const areas = pgTable("areas", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  region: text("region").notNull(),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
});

export const insertAreaSchema = createInsertSchema(areas).omit({ id: true });
export type InsertArea = z.infer<typeof insertAreaSchema>;
export type Area = typeof areas.$inferSelect;

/* ──────────────────────────────────────────────
   TRADESMEN
   arrays (gallery, categories) stored as JSON text
   ────────────────────────────────────────────── */
export const tradesmen = pgTable("tradesmen", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  businessName: text("business_name").notNull(),
  ownerName: text("owner_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  bio: text("bio").notNull(),
  postcode: text("postcode").notNull(),
  areaId: integer("area_id").notNull(),
  heroImageUrl: text("hero_image_url").notNull(),
  gallery: text("gallery").notNull().default("[]"), // JSON array of urls
  categories: text("categories").notNull().default("[]"), // JSON array of category ids
  yearsExperience: integer("years_experience").notNull().default(0),
  verified: boolean("verified").notNull().default(false),
  insured: boolean("insured").notNull().default(false),
  licensed: boolean("licensed").notNull().default(false),
  featured: boolean("featured").notNull().default(false),
  ratingAverage: real("rating_average").notNull().default(0),
  ratingCount: integer("rating_count").notNull().default(0),
  responseTimeMinutes: integer("response_time_minutes").notNull().default(120),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(0),
  /* ── Stripe linkage (PR-E1, updated PR-D3b) ──
     stripeCustomerId is created lazily the first time a tradesperson opens
     checkout, and reused across all subsequent payments + subscriptions.
     subscriptionStatus is mostly Stripe's subscription.status enum, with
     one product-level remapping for cancel-at-period-end:
       'active' | 'trialing' | 'past_due' | 'unpaid' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'paused' | null
     PR-D3b: when Stripe reports status=active|trialing AND
     cancel_at_period_end=true (portal-initiated cancel), we store 'canceled'
     so shared/featured-state.ts's `lapsing` branch fires immediately rather
     than waiting up to a month for subscription.deleted. featuredUntil is
     still set from the period end so Featured placement persists through
     the paid window. See server/stripe-webhook.ts:resolveSubscriptionStatus.
     featuredUntil is the timestamp the Featured Listing is paid through.
     The legacy `featured` boolean above is retained for back-compat with
     existing query paths; new code should derive featured-ness from
     `featuredUntil != null && featuredUntil > Date.now()`. */
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  subscriptionStatus: text("subscription_status"),
  featuredUntil: bigint("featured_until", { mode: "number" }),
  // Tags a profile created via the Founding Pro pilot claim flow (see
  // founding_pro_invites below). Drives the 30-day free-unlock window copy and
  // any future Founding-Pro-only badging. Defaults false for all existing rows.
  foundingPro: boolean("founding_pro").notNull().default(false),
});

export const insertTradesmanSchema = createInsertSchema(tradesmen).omit({
  id: true,
  ratingAverage: true,
  ratingCount: true,
  createdAt: true,
});
export type InsertTradesman = z.infer<typeof insertTradesmanSchema>;
export type Tradesman = typeof tradesmen.$inferSelect;

/* ──────────────────────────────────────────────
   JOBS (customer-posted leads)
   ────────────────────────────────────────────── */
export const jobs = pgTable("jobs", {
  id: serial("id").primaryKey(),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone").notNull(),
  postcode: text("postcode").notNull(),
  categoryId: integer("category_id").notNull(),
  areaId: integer("area_id"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  urgency: text("urgency").notNull().default("flexible"), // emergency | this_week | flexible
  budgetRange: text("budget_range").notNull().default(""),
  photos: text("photos").notNull().default("[]"), // JSON array
  status: text("status").notNull().default("open"), // open | matched | completed | cancelled
  // Attribution: where the job originated. 'web' for the main site, or
  // 'microsite:<host>' for a mini-site lead so we can report per-domain
  // conversion. Defaults to 'web' for backwards compatibility with existing
  // jobs and the public POST path when no microsite is resolved.
  source: text("source").notNull().default("web"),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(0),
});

export const insertJobSchema = createInsertSchema(jobs).omit({
  id: true,
  status: true,
  createdAt: true,
}).extend({
  // `source` is server-attributed in the route handler from req.microsite,
  // not user input. Allow it through validation but treat it as optional.
  source: z.string().max(120).optional(),
});
export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobs.$inferSelect;

/* ──────────────────────────────────────────────
   QUOTES
   ────────────────────────────────────────────── */
export const quotes = pgTable("quotes", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull(),
  tradesmanId: integer("tradesman_id").notNull(),
  priceEstimate: text("price_estimate").notNull().default(""),
  message: text("message").notNull().default(""),
  status: text("status").notNull().default("sent"), // sent | accepted | declined
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(0),
});

export const insertQuoteSchema = createInsertSchema(quotes).omit({
  id: true,
  createdAt: true,
});
export type InsertQuote = z.infer<typeof insertQuoteSchema>;
export type Quote = typeof quotes.$inferSelect;

/* ──────────────────────────────────────────────
   REVIEWS
   ────────────────────────────────────────────── */
export const reviews = pgTable("reviews", {
  id: serial("id").primaryKey(),
  tradesmanId: integer("tradesman_id").notNull(),
  customerName: text("customer_name").notNull(),
  rating: integer("rating").notNull(), // 1-5
  title: text("title").notNull().default(""),
  body: text("body").notNull(),
  jobId: integer("job_id"),
  verified: boolean("verified").notNull().default(false),
   status: text("status").notNull().default("pending"), // pending | approved | rejected
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(0),
});

export const insertReviewSchema = createInsertSchema(reviews).omit({
  id: true,
  createdAt: true,
   status: true,    // moderation-controlled, never set by submitter
verified: true,
});
export type InsertReview = z.infer<typeof insertReviewSchema>;
export type Review = typeof reviews.$inferSelect;

/* ──────────────────────────────────────────────
   CREDIT TRANSACTIONS
   ────────────────────────────────────────────── */
export const creditTransactions = pgTable("credit_transactions", {
  id: serial("id").primaryKey(),
  tradesmanId: integer("tradesman_id").notNull(),
  amount: integer("amount").notNull(), // negative = spent, positive = topped up
  reason: text("reason").notNull(),
  relatedJobId: integer("related_job_id"),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(0),
});

export const insertCreditTransactionSchema = createInsertSchema(creditTransactions).omit({
  id: true,
  createdAt: true,
});
export type InsertCreditTransaction = z.infer<typeof insertCreditTransactionSchema>;
export type CreditTransaction = typeof creditTransactions.$inferSelect;

/* ──────────────────────────────────────────────
   TRADESMAN CREDITS (balance)
   ────────────────────────────────────────────── */
export const tradesmanCredits = pgTable("tradesman_credits", {
  id: serial("id").primaryKey(),
  tradesmanId: integer("tradesman_id").notNull().unique(),
  balance: integer("balance").notNull().default(0),
});

export const insertTradesmanCreditsSchema = createInsertSchema(tradesmanCredits).omit({ id: true });
export type InsertTradesmanCredits = z.infer<typeof insertTradesmanCreditsSchema>;
export type TradesmanCredits = typeof tradesmanCredits.$inferSelect;

/* ──────────────────────────────────────────────
   TRADESMAN CARDS (Warning / Yellow / Red)
   Football-style 3-strike moderation. Gross-misconduct = instant Red.
   ────────────────────────────────────────────── */
export const tradesmanCards = pgTable("tradesman_cards", {
  id: serial("id").primaryKey(),
  tradesmanId: integer("tradesman_id").notNull(),
  cardType: text("card_type").notNull(), // 'warning' | 'yellow' | 'red'
  reason: text("reason").notNull(),
  grossMisconduct: boolean("gross_misconduct").notNull().default(false),
  issuedAt: bigint("issued_at", { mode: "number" }).notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }), // null = permanent
  rescindedAt: bigint("rescinded_at", { mode: "number" }),
  rescindedBy: text("rescinded_by"),
  rescindedReason: text("rescinded_reason"),
  issuedBy: text("issued_by").notNull().default("admin"),
});
export const insertTradesmanCardSchema = createInsertSchema(tradesmanCards).omit({
  id: true,
  issuedAt: true,
  rescindedAt: true,
  rescindedBy: true,
  rescindedReason: true,
});
export type InsertTradesmanCard = z.infer<typeof insertTradesmanCardSchema>;
export type TradesmanCard = typeof tradesmanCards.$inferSelect;

/* ──────────────────────────────────────────────
   TRADESMAN VERIFICATIONS (Insurance / Qualifications)

   Why a separate table when tradesmen.insured / .licensed already exist:
   the booleans on `tradesmen` are the *current public-facing flag* (used by
   listing cards, badges, search filters). This table holds the *evidence*
   for each submission — kind, uploaded file, reviewer notes, expiry date —
   and a tradesman can re-submit (e.g. annual insurance renewal) over time.
   On admin approve we set the boolean on tradesmen; on rejection or expiry
   we leave it false. Many rows per tradesman, both kinds independent.

   `kind` is one of: "insurance" | "qualification".
   `status` is one of: "pending" | "approved" | "rejected".
   `filePath` is the path inside the Supabase Storage bucket
   `SUPABASE_VERIFICATIONS_BUCKET` (never a public URL — admin views fetch a
   short-lived signed URL on demand via server/verifications-storage.ts).
   `qualificationType` is free-form (e.g. "Gas Safe", "NICEIC",
   "City & Guilds 2391", "Other") for qualification submissions only.
   ────────────────────────────────────────────── */
export const tradesmanVerifications = pgTable("tradesman_verifications", {
  id: serial("id").primaryKey(),
  tradesmanId: integer("tradesman_id").notNull(),
  kind: text("kind").notNull(), // 'insurance' | 'qualification'
  filePath: text("file_path").notNull(), // path inside the private storage bucket
  fileMimeType: text("file_mime_type").notNull(),
  fileSizeBytes: integer("file_size_bytes").notNull(),
  qualificationType: text("qualification_type"), // nullable; only set when kind='qualification'
  insuranceCoverGbp: integer("insurance_cover_gbp"), // nullable; only set when kind='insurance'
  expiryDate: text("expiry_date"), // ISO YYYY-MM-DD, nullable until known
  status: text("status").notNull().default("pending"), // 'pending' | 'approved' | 'rejected'
  submittedAt: bigint("submitted_at", { mode: "number" }).notNull(),
  reviewedAt: bigint("reviewed_at", { mode: "number" }), // nullable until reviewed
  reviewedBy: text("reviewed_by"), // admin identifier ('admin' for now)
  reviewerNote: text("reviewer_note"), // optional message, required when status='rejected'
});
export const VERIFICATION_KINDS = ["insurance", "qualification"] as const;
export const VERIFICATION_STATUSES = ["pending", "approved", "rejected"] as const;
export type VerificationKind = (typeof VERIFICATION_KINDS)[number];
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const insertTradesmanVerificationSchema = createInsertSchema(tradesmanVerifications)
  .omit({
    id: true,
    submittedAt: true,
    reviewedAt: true,
    reviewedBy: true,
    reviewerNote: true,
    status: true,
  })
  .extend({
    kind: z.enum(VERIFICATION_KINDS),
    qualificationType: z.string().min(1).max(80).optional().nullable(),
    insuranceCoverGbp: z.number().int().min(0).max(100_000_000).optional().nullable(),
    expiryDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "expiry_date must be YYYY-MM-DD")
      .optional()
      .nullable(),
  });
export type InsertTradesmanVerification = z.infer<typeof insertTradesmanVerificationSchema>;
export type TradesmanVerification = typeof tradesmanVerifications.$inferSelect;

/* ──────────────────────────────────────────────
   MODERATION LOG — full audit trail of card actions
   ────────────────────────────────────────────── */
export const moderationLog = pgTable("moderation_log", {
  id: serial("id").primaryKey(),
  tradesmanId: integer("tradesman_id").notNull(),
  cardId: integer("card_id"),
  action: text("action").notNull(), // 'issue' | 'rescind'
  cardType: text("card_type"),
  reason: text("reason").notNull(),
  adminId: text("admin_id").notNull().default("admin"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});
export type ModerationLogEntry = typeof moderationLog.$inferSelect;

/* ──────────────────────────────────────────────
   EMAIL LOG — structured audit trail of outbound transactional emails

   Replaces the prior hack of cramming Resend message ids into
   moderation_log.reason as freeform text. Used to:
     - prove deliverability per-recipient (#12 acceptance criterion)
     - power admin debugging when a lead email doesn't arrive
     - feed future bounce/complaint webhook processing from Resend
   ────────────────────────────────────────────── */
export const emailLog = pgTable("email_log", {
  id: serial("id").primaryKey(),
  // What was sent
  template: text("template").notNull(), // 'new_lead' | 'job_confirmation' | 'partner_outcome' | ...
  toAddress: text("to_address").notNull(),
  fromAddress: text("from_address").notNull(),
  subject: text("subject").notNull(),
  // Resend correlation
  resendId: text("resend_id"), // null if request failed before send
  status: text("status").notNull(), // 'sent' | 'failed' | 'bounced' | 'complained' | 'delivered'
  errorMessage: text("error_message"), // populated when status='failed'
  // Optional FK-style links (kept as integer not enforced FK so deletes don't cascade-nuke audit history)
  jobId: integer("job_id"),
  tradesmanId: integer("tradesman_id"),
  partnerId: integer("partner_id"),
  // Privacy: count of PII redactions performed before send (does NOT store the PII itself)
  redactionCount: integer("redaction_count").notNull().default(0),
  // Timing
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  deliveredAt: bigint("delivered_at", { mode: "number" }), // populated by future Resend webhook
});
export const insertEmailLogSchema = createInsertSchema(emailLog).omit({ id: true });
export type InsertEmailLog = z.infer<typeof insertEmailLogSchema>;
export type EmailLogEntry = typeof emailLog.$inferSelect;

/* ──────────────────────────────────────────────
   PAYMENTS LOG — audit trail of every Stripe event we processed

   Append-only. Every webhook delivery + every checkout-session creation
   writes a row. Used for:
     - reconciliation (Stripe dashboard vs our ledger)
     - idempotency (event_id is unique — duplicate webhook deliveries from
       Stripe's retry logic are no-ops)
     - refund-decision context (admin view in PR-E4)
     - dispute / chargeback audit trail
   ───────────────────────────────────────────── */
export const paymentsLog = pgTable("payments_log", {
  id: serial("id").primaryKey(),
  // Stripe identity
  eventId: text("event_id").notNull().unique(), // evt_... — dedupe key, never insert twice
  eventType: text("event_type").notNull(), // 'checkout.session.completed', 'invoice.paid', 'charge.refunded', ...
  // What was paid
  amountPence: integer("amount_pence"), // gross amount in pence; null for non-financial events
  currency: text("currency"), // 'gbp' (lowercased per Stripe convention)
  // Stripe object refs (any may be null depending on event type)
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  stripeInvoiceId: text("stripe_invoice_id"),
  stripeChargeId: text("stripe_charge_id"),
  // Our side
  tradesmanId: integer("tradesman_id"), // resolved via stripeCustomerId; nullable for events we couldn't attribute
  productKind: text("product_kind"), // 'lead_pack_5' | 'lead_pack_10' | 'lead_pack_20' | 'featured_monthly' | null
  // Outcome of our handler
  action: text("action").notNull(), // 'credits_granted' | 'credits_revoked' | 'featured_extended' | 'featured_degraded' | 'featured_swept' | 'flagged_for_review' | 'noop' | 'failed'
  creditsDelta: integer("credits_delta").notNull().default(0), // signed: +10 grant, -5 partial revoke, 0 if non-credit event
  notes: text("notes"), // freeform: error_message, admin_reason, etc.
  // Raw payload for debugging — stored as JSON text to avoid jsonb operator
  // confusion in the rare query against this column.
  rawPayload: text("raw_payload"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});
// createdAt is set by storage.createPaymentsLog (single source of timestamp),
// so callers must not pass it.
export const insertPaymentsLogSchema = createInsertSchema(paymentsLog).omit({ id: true, createdAt: true });
export type InsertPaymentsLog = z.infer<typeof insertPaymentsLogSchema>;
export type PaymentsLogEntry = typeof paymentsLog.$inferSelect;

/* ──────────────────────────────────────────────
   AUTH — magic-link tokens & sessions  (PR-A1a)

   We deliberately do NOT enforce Postgres-level RLS on these tables: the app
   accesses them via a privileged service connection (DATABASE_URL), not via
   the Supabase anon key. All access is gated in `server/auth.ts`.

   `magic_link_tokens` stores a SHA-256 hash of the bearer token; the raw
   token is only ever sent to the user's email and never persisted. One-time
   use: a token's `consumed_at` is set on successful /verify, and a row with
   `consumed_at != null` is rejected on re-presentation.

   `sessions` holds opaque cookie session ids. The cookie value is the
   bcrypt-quality random `id` itself (high-entropy, unguessable); we look it
   up directly. Sliding expiration: every authenticated request bumps
   `expires_at` so an active tradesperson stays signed in for 30 days from
   last use, but inactivity for 30 days logs them out.
   ────────────────────────────────────────────── */
export const magicLinkTokens = pgTable("magic_link_tokens", {
  id: serial("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(), // sha256 hex of the random token
  email: text("email").notNull(), // lowercased; auth target — may not yet have a tradesman row
  tradesmanId: integer("tradesman_id"), // null when this token is for a future sign-up
  purpose: text("purpose").notNull(), // 'sign_in' | 'sign_up'
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(), // unix ms
  consumedAt: bigint("consumed_at", { mode: "number" }), // unix ms; null until first successful verify
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  requestIp: text("request_ip"),
  requestUserAgent: text("request_user_agent"),
});
export const insertMagicLinkTokenSchema = createInsertSchema(magicLinkTokens).omit({ id: true, createdAt: true });
export type InsertMagicLinkToken = z.infer<typeof insertMagicLinkTokenSchema>;
export type MagicLinkToken = typeof magicLinkTokens.$inferSelect;

export const sessions = pgTable("sessions", {
  // 256-bit random hex (cookie value). PRIMARY KEY because it's the lookup key.
  id: text("id").primaryKey(),
  tradesmanId: integer("tradesman_id").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(), // sliding; refreshed on each request
  lastSeenAt: bigint("last_seen_at", { mode: "number" }).notNull(),
  createdIp: text("created_ip"),
  createdUserAgent: text("created_user_agent"),
});
export const insertSessionSchema = createInsertSchema(sessions).omit({ createdAt: true, lastSeenAt: true });
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Session = typeof sessions.$inferSelect;

/* ─────────────────────────────────────────────
   PARTNER PROGRAMME (PR-P1) — #22

   Four tables that together let us monetise placements to commercial
   verticals (builders' merchants, EPC providers, finance/BNPL, etc).

   Key design decision: `commercial_model` and `rate_pence` live on
   `partner_placements`, NOT on `partners`. One partner may have multiple
   placements each with its own pricing model (e.g. £200/mo sponsored on
   the category footer AND £15/lead qualified on the job-confirmation
   page). Putting the model on `partners` would force us to create
   multiple partner rows for one real partner — messy and re-migration
   risk within v1.5.

   No event sampling in v1: `partner_events` records every impression /
   click / lead. Partner-facing stats page would otherwise need a "these
   numbers are 10x estimates" disclaimer that invites pricing disputes.
   At MVP traffic (<100k page views/month) the table grows by tens of
   thousands per month, not millions; revisit if/when it crosses 5M rows.

   RLS posture matches the rest of the codebase: enabled, no policies.
   App uses service-role DATABASE_URL connection; the anon browser key
   is never used for partner tables.
   ────────────────────────────────────────────── */

export const partners = pgTable("partners", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(), // url-safe, used in /p/<slug>/stats
  name: text("name").notNull(),
  vertical: text("vertical").notNull(),  // 'insurance' | 'epc' | 'solicitor' | 'builders_merchant' | 'finance' | 'other'
  status: text("status").notNull().default("inactive"), // 'inactive' | 'pilot' | 'active' | 'paused' | 'terminated'
  billingEmail: text("billing_email"),
  billingContact: text("billing_contact"),
  stripeCustomerId: text("stripe_customer_id"), // null until first invoice raised
  notes: text("notes"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});
export const insertPartnerSchema = createInsertSchema(partners).omit({ id: true, createdAt: true });
export type InsertPartner = z.infer<typeof insertPartnerSchema>;
export type Partner = typeof partners.$inferSelect;

export const partnerPlacements = pgTable("partner_placements", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id").notNull(),
  surface: text("surface").notNull(), // 'category_footer' | 'area_footer' | 'job_confirmation' | 'dashboard_sidebar' | 'lead_email_footer' | 'partners_page'
  commercialModel: text("commercial_model").notNull(), // 'sponsored' | 'lead_qualified' | 'lead_booked' | 'rev_share'
  // Pence; semantics depend on commercialModel:
  //   sponsored        => monthly flat rate
  //   lead_qualified   => per qualified-lead rate
  //   lead_booked      => per booked-lead rate
  //   rev_share        => basis points (e.g. 1000 = 10%); cap held in `rateCapPence`
  ratePence: integer("rate_pence").notNull(),
  rateCapPence: integer("rate_cap_pence"), // optional cap for rev_share
  categoryFilter: text("category_filter").notNull().default("[]"), // JSON array of category ids; [] means all
  areaFilter: text("area_filter").notNull().default("[]"),         // JSON array of area ids; [] means all
  priority: integer("priority").notNull().default(100), // lower number = renders first within a surface
  activeFrom: bigint("active_from", { mode: "number" }).notNull(),
  activeTo: bigint("active_to", { mode: "number" }), // null = open-ended
  creativeHtml: text("creative_html"), // sanitised at render time, not at store time
  creativeUrl: text("creative_url"),   // destination URL for clicks
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});
export const insertPartnerPlacementSchema = createInsertSchema(partnerPlacements).omit({ id: true, createdAt: true });
export type InsertPartnerPlacement = z.infer<typeof insertPartnerPlacementSchema>;
export type PartnerPlacement = typeof partnerPlacements.$inferSelect;

export const partnerEvents = pgTable("partner_events", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id").notNull(),
  placementId: integer("placement_id").notNull(),
  eventType: text("event_type").notNull(), // 'impression' | 'click' | 'lead_passed' | 'lead_outcome'
  jobId: integer("job_id"),                 // nullable; populated for lead_* event types
  tradesmanId: integer("tradesman_id"),     // nullable; populated for lead_outcome
  // Idempotency key prevents double-counting. Examples:
  //   impression:<request_id>:<placement_id>
  //   click:<placement_id>:<request_id>
  //   lead:<job_id>:<partner_id>
  //   outcome:<job_id>:<partner_id>:<outcome>
  idempotencyKey: text("idempotency_key").notNull().unique(),
  occurredAt: bigint("occurred_at", { mode: "number" }).notNull(),
  metadata: text("metadata"), // JSON; for lead_outcome carries outcome enum + notes
});
export const insertPartnerEventSchema = createInsertSchema(partnerEvents).omit({ id: true });
export type InsertPartnerEvent = z.infer<typeof insertPartnerEventSchema>;
export type PartnerEvent = typeof partnerEvents.$inferSelect;

export const partnerInvoices = pgTable("partner_invoices", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id").notNull(),
  periodStart: bigint("period_start", { mode: "number" }).notNull(),
  periodEnd: bigint("period_end", { mode: "number" }).notNull(),
  lineItems: text("line_items").notNull(), // JSON array of {placement_id, event_type, count, rate_pence, subtotal_pence}
  totalPence: integer("total_pence").notNull(),
  status: text("status").notNull().default("draft"), // 'draft' | 'sent' | 'paid' | 'void'
  stripeInvoiceId: text("stripe_invoice_id"), // populated after manual Stripe Invoice raised
  generatedAt: bigint("generated_at", { mode: "number" }).notNull(),
  sentAt: bigint("sent_at", { mode: "number" }),
  paidAt: bigint("paid_at", { mode: "number" }),
});
export const insertPartnerInvoiceSchema = createInsertSchema(partnerInvoices).omit({ id: true, generatedAt: true });
export type InsertPartnerInvoice = z.infer<typeof insertPartnerInvoiceSchema>;
export type PartnerInvoice = typeof partnerInvoices.$inferSelect;

// Enum exports for runtime validation in admin endpoints (landing in PR-P3).
export const PARTNER_VERTICALS = [
  "insurance", "epc", "solicitor", "builders_merchant", "finance", "other",
] as const;
export const PARTNER_STATUSES = [
  "inactive", "pilot", "active", "paused", "terminated",
] as const;
export const PARTNER_SURFACES = [
  "category_footer", "area_footer", "job_confirmation",
  "dashboard_sidebar", "lead_email_footer", "partners_page",
] as const;
export const PARTNER_COMMERCIAL_MODELS = [
  "sponsored", "lead_qualified", "lead_booked", "rev_share",
] as const;
export const PARTNER_EVENT_TYPES = [
  "impression", "click", "lead_passed", "lead_outcome",
] as const;
export const PARTNER_INVOICE_STATUSES = [
  "draft", "sent", "paid", "void",
] as const;

/* ─────────────────────────────────────────────
   PARTNER ENQUIRIES (PR-P2) — #22

   Inbound B2B enquiries from the /partners marketing page. Deliberately
   lives separate from `partners` (PR-P1) because most enquiries never
   become partners; conversion happens via PR-P3 admin tooling.

   PR ordering: PR-P2 must merge AFTER PR-P1 in production because the
   partner_enquiries SQL migration declares a FK on partners.id (added in
   PR-P1's migration). PR-P1 is now on main, so the ordering constraint
   is satisfied. The drizzle schema file does not import `partners` here,
   so this TypeScript file compiles independently — the FK lives only at
   the database layer.
   ───────────────────────────────────────────── */
export const partnerEnquiries = pgTable("partner_enquiries", {
  id: serial("id").primaryKey(),
  companyName: text("company_name").notNull(),
  contactName: text("contact_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  vertical: text("vertical").notNull(),
  monthlyBudget: text("monthly_budget"), // free text: '£500-2k', 'TBC', etc — partners hate brackets
  message: text("message").notNull(),
  status: text("status").notNull().default("new"), // 'new' | 'contacted' | 'qualified' | 'won' | 'lost'
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  requestIp: text("request_ip"),
  requestUserAgent: text("request_user_agent"),
  promotedPartnerId: integer("promoted_partner_id"), // set once admin converts enquiry → partner
});
export const insertPartnerEnquirySchema = createInsertSchema(partnerEnquiries).omit({
  id: true, createdAt: true, status: true, promotedPartnerId: true,
  requestIp: true, requestUserAgent: true,
});
export type InsertPartnerEnquiry = z.infer<typeof insertPartnerEnquirySchema>;
export type PartnerEnquiry = typeof partnerEnquiries.$inferSelect;

export const PARTNER_ENQUIRY_VERTICALS = [
  "insurance", "epc", "solicitor", "builders_merchant", "finance", "other",
] as const;
export const PARTNER_ENQUIRY_STATUSES = [
  "new", "contacted", "qualified", "won", "lost",
] as const;

/* ─────────────────────────────────────────────
   HOMEOWNER ACCESS (PR D)

   Three tables + reuse of magic_link_tokens (purpose='homeowner_verify_access')
   that together implement the consent-gated proof-viewing flow:

   homeowner_sessions        — parallel to `sessions` but no tradesman_id;
                               cookie name tf_homeowner, 30-day sliding
   verification_access_requests — homeowner requests to view a tradesman's
                               verification proofs; tradesman approves/denies
   verification_access_blocks  — permanent block by tradesman of a homeowner
                               email; prevents future requests
   ───────────────────────────────────────────── */

export const homeownerSessions = pgTable("homeowner_sessions", {
  id: text("id").primaryKey(),              // 256-bit hex cookie value
  email: text("email").notNull(),           // lowercased
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),  // sliding 30-day
  lastSeenAt: bigint("last_seen_at", { mode: "number" }).notNull(),
  requestIp: text("request_ip"),
  requestUserAgent: text("request_user_agent"),
});
export const insertHomeownerSessionSchema = createInsertSchema(homeownerSessions).omit({ createdAt: true, lastSeenAt: true });
export type InsertHomeownerSession = z.infer<typeof insertHomeownerSessionSchema>;
export type HomeownerSession = typeof homeownerSessions.$inferSelect;

export const verificationAccessRequests = pgTable("verification_access_requests", {
  id: serial("id").primaryKey(),
  homeownerEmail: text("homeowner_email").notNull(),   // lowercased
  tradesmanId: integer("tradesman_id").notNull(),
  status: text("status").notNull().default("pending"),  // pending | granted | denied | revoked
  requestedAt: bigint("requested_at", { mode: "number" }).notNull(),
  decidedAt: bigint("decided_at", { mode: "number" }),               // when granted/denied
  decidedByTradesmanId: integer("decided_by_tradesman_id"),           // audit
  grantedUntil: bigint("granted_until", { mode: "number" }),         // 7d from grant; null when not granted
  revokedAt: bigint("revoked_at", { mode: "number" }),
  notes: text("notes"),                                               // optional tradesman note
  requestIp: text("request_ip"),
  requestUserAgent: text("request_user_agent"),
});
export const insertVerificationAccessRequestSchema = createInsertSchema(verificationAccessRequests).omit({
  id: true, status: true, decidedAt: true, decidedByTradesmanId: true,
  grantedUntil: true, revokedAt: true, notes: true,
});
export type InsertVerificationAccessRequest = z.infer<typeof insertVerificationAccessRequestSchema>;
export type VerificationAccessRequest = typeof verificationAccessRequests.$inferSelect;

export const verificationAccessBlocks = pgTable("verification_access_blocks", {
  id: serial("id").primaryKey(),
  tradesmanId: integer("tradesman_id").notNull(),
  homeownerEmail: text("homeowner_email").notNull(),  // lowercased
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  reason: text("reason"),
});
export const insertVerificationAccessBlockSchema = createInsertSchema(verificationAccessBlocks).omit({
  id: true, createdAt: true,
});
export type InsertVerificationAccessBlock = z.infer<typeof insertVerificationAccessBlockSchema>;
export type VerificationAccessBlock = typeof verificationAccessBlocks.$inferSelect;

export const ACCESS_REQUEST_STATUSES = [
  "pending", "granted", "denied", "revoked",
] as const;
export type AccessRequestStatus = (typeof ACCESS_REQUEST_STATUSES)[number];

/* ─────────────────────────────────────────────
   FOUNDING PRO INVITES (pilot claim flow)

   One row per pilot recipient we email an invite link to. The `ref` is the
   slug from the outreach payload (e.g. 'wandsworth-plumber-1') and is the
   join key between the email URL (?ref=…) and this table — it is what
   /founding-pro/claim?ref=… looks up to pre-fill the claim form.

   Lifecycle of `status`: invited → viewed (on first GET of the invite) →
   claimed (when the pro submits the claim form and we create their tradesman
   record) | declined (reserved; not yet wired into a route). Claiming is
   idempotent — re-submitting returns the already-linked tradesman.

   This SUPERSEDES the fire-and-forget interest form (PR #106) as the canonical
   path, but that form stays as a no-ref fallback.
   ───────────────────────────────────────────── */
export const foundingProInvites = pgTable("founding_pro_invites", {
  id: serial("id").primaryKey(),
  ref: text("ref").notNull().unique(),               // outreach slug, e.g. 'wandsworth-plumber-1'
  recipientEmail: text("recipient_email").notNull(),
  recipientName: text("recipient_name"),
  companyName: text("company_name"),
  companiesHouseNumber: text("companies_house_number"),
  trade: text("trade").notNull(),                    // 'plumber' | 'electrician' | …
  area: text("area").notNull(),                      // 'Wandsworth' | 'Dulwich' | …
  postcodes: text("postcodes").array().notNull().default([]), // text[]; suggested coverage
  campaign: text("campaign").notNull().default("founding-pro-pilot-01"),
  status: text("status").notNull().default("invited"), // 'invited' | 'viewed' | 'claimed' | 'declined'
  claimedTradesmanId: integer("claimed_tradesman_id"),  // FK→tradesmen.id; null until claimed
  viewedAt: bigint("viewed_at", { mode: "number" }),    // epoch ms; stamped on first view
  claimedAt: bigint("claimed_at", { mode: "number" }),  // epoch ms; stamped on claim
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(0),
});
export const insertFoundingProInviteSchema = createInsertSchema(foundingProInvites).omit({
  id: true, status: true, claimedTradesmanId: true, viewedAt: true, claimedAt: true, createdAt: true,
});
export type InsertFoundingProInvite = z.infer<typeof insertFoundingProInviteSchema>;
export type FoundingProInvite = typeof foundingProInvites.$inferSelect;
// Shape accepted by storage.seedFoundingProInvites — narrower than the table
// row (no server-managed lifecycle columns), wider than the insert schema since
// callers may omit optional fields entirely.
export type NewFoundingProInvite = {
  ref: string;
  recipientEmail: string;
  recipientName?: string | null;
  companyName?: string | null;
  companiesHouseNumber?: string | null;
  trade: string;
  area: string;
  postcodes?: string[];
  campaign?: string;
};

export const FOUNDING_PRO_INVITE_STATUSES = [
  "invited", "viewed", "claimed", "declined",
] as const;
export type FoundingProInviteStatus = (typeof FOUNDING_PRO_INVITE_STATUSES)[number];
