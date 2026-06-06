import { pgTable, text, integer, real, bigint, boolean, serial, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
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
  /* ── Stripe linkage (PR-E1) ──
     stripeCustomerId is created lazily the first time a tradesperson opens
     checkout, and reused across all subsequent payments + subscriptions.
     subscriptionStatus mirrors Stripe's subscription.status enum verbatim:
       'active' | 'trialing' | 'past_due' | 'unpaid' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'paused' | null
     featuredUntil is the timestamp the Featured Listing is paid through.
     The legacy `featured` boolean above is retained for back-compat with
     existing query paths; new code should derive featured-ness from
     `featuredUntil != null && featuredUntil > Date.now()`. */
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  subscriptionStatus: text("subscription_status"),
  featuredUntil: bigint("featured_until", { mode: "number" }),
  /* ── Magic-link auth (PR-A1) ──
     Set the first time a tradesperson successfully verifies a sign-in link.
     timestamptz (not the epoch-ms bigint convention used elsewhere) because
     the auth tables are new and use native Postgres timestamps. */
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
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
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(0),
});

export const insertJobSchema = createInsertSchema(jobs).omit({
  id: true,
  status: true,
  createdAt: true,
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
  action: text("action").notNull(), // 'credits_granted' | 'credits_revoked' | 'featured_extended' | 'featured_degraded' | 'flagged_for_review' | 'noop' | 'failed'
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
   AUTH TOKENS — single-use magic-link sign-in tokens (PR-A1)

   Replaces the insecure GET /api/tradesmen/login/:email endpoint (which let
   anyone sign in as any tradesperson with just their email — a P0 gap now
   that Stripe payments are live).

   Flow: POST /api/auth/request-link generates a 32-byte random token, stores
   ONLY its sha256 hash here (never plaintext), emails the plaintext to the
   tradesperson. GET /api/auth/verify hashes the supplied token, looks up an
   unconsumed/unexpired row, marks it consumed, and issues a signed session
   cookie. Tokens are 15-min TTL, single-use.
   ────────────────────────────────────────────── */
export const authTokens = pgTable("auth_tokens", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  tradesmanId: bigint("tradesman_id", { mode: "number" }).notNull(),
  tokenHash: text("token_hash").notNull(), // sha256 hex of the random token
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  ip: text("ip"), // stored as text; column type is inet in Postgres
  userAgent: text("user_agent"),
}, (t) => ({
  tokenHashUnique: uniqueIndex("auth_tokens_token_hash_key").on(t.tokenHash),
  tradesmanCreatedIdx: index("auth_tokens_tradesman_created_idx").on(t.tradesmanId, t.createdAt),
}));
export type AuthToken = typeof authTokens.$inferSelect;
export type InsertAuthToken = typeof authTokens.$inferInsert;
