import {
  categories,
  areas,
  tradesmen,
  jobs,
  quotes,
  reviews,
  creditTransactions,
  tradesmanCredits,
  tradesmanCards,
  tradesmanVerifications,
  moderationLog,
  paymentsLog,
  magicLinkTokens,
  sessions,
  partnerEnquiries,
  partners,
  partnerPlacements,
  partnerEvents,
  partnerInvoices,
  homeownerSessions,
  verificationAccessRequests,
  verificationAccessBlocks,
} from "@shared/schema";
import type {
  Category, InsertCategory,
  Area, InsertArea,
  Tradesman, InsertTradesman,
  Job, InsertJob,
  Quote, InsertQuote,
  Review, InsertReview,
  CreditTransaction, InsertCreditTransaction,
  TradesmanCredits,
  TradesmanCard, InsertTradesmanCard,
  TradesmanVerification, InsertTradesmanVerification, VerificationKind, VerificationStatus, VerificationSource,
  ModerationLogEntry,
  InsertPaymentsLog, PaymentsLogEntry,
  MagicLinkToken, InsertMagicLinkToken,
  Session, InsertSession,
  InsertPartnerEnquiry, PartnerEnquiry,
  Partner, InsertPartner,
  PartnerPlacement, InsertPartnerPlacement,
  PartnerEvent,
  PartnerInvoice, InsertPartnerInvoice,
  HomeownerSession,
  VerificationAccessRequest,
  VerificationAccessBlock,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, desc, sql, and, isNull, gt, lt, gte, lte } from "drizzle-orm";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL env var is required");
}

// Use a small pool. Supabase pooler caps connections; Vercel functions are short-lived.
const client = postgres(connectionString, {
  max: 5,
  prepare: false, // required for Supabase transaction pooler (port 6543)
});

export const db = drizzle(client);

export interface IStorage {
  // categories
  getCategories(): Promise<Category[]>;
  getCategoryBySlug(slug: string): Promise<Category | undefined>;
  createCategory(c: InsertCategory): Promise<Category>;
  // areas
  getAreas(): Promise<Area[]>;
  getAreaBySlug(slug: string): Promise<Area | undefined>;
  createArea(a: InsertArea): Promise<Area>;
  // tradesmen
  getTradesmen(): Promise<Tradesman[]>;
  getTradesmanBySlug(slug: string): Promise<Tradesman | undefined>;
  getTradesmanById(id: number): Promise<Tradesman | undefined>;
  getTradesmanByEmail(email: string): Promise<Tradesman | undefined>;
  getTradesmanByStripeCustomerId(customerId: string): Promise<Tradesman | undefined>;
  getTradesmanByStripeSubscriptionId(subscriptionId: string): Promise<Tradesman | undefined>;
  createTradesman(t: InsertTradesman): Promise<Tradesman>;
  updateTradesman(id: number, patch: Partial<Tradesman>): Promise<Tradesman | undefined>;
  // jobs
  getJobs(): Promise<Job[]>;
  getJobById(id: number): Promise<Job | undefined>;
  createJob(j: InsertJob): Promise<Job>;
  updateJob(id: number, patch: Partial<Job>): Promise<Job | undefined>;
  // quotes
  getQuotes(): Promise<Quote[]>;
  getQuotesByTradesman(tradesmanId: number): Promise<Quote[]>;
  getQuotesByJob(jobId: number): Promise<Quote[]>;
  createQuote(q: InsertQuote): Promise<Quote>;
  // reviews
  getReviews(): Promise<Review[]>;
  getReviewsByTradesman(tradesmanId: number): Promise<Review[]>;
  createReview(r: InsertReview): Promise<Review>;
  getReviewById(id: number): Promise<Review | undefined>;
updateReview(id: number, patch: Partial<Review>): Promise<Review | undefined>;
  // credits
  getCredits(tradesmanId: number): Promise<TradesmanCredits | undefined>;
  setCredits(tradesmanId: number, balance: number): Promise<TradesmanCredits>;
  getCreditTransactions(tradesmanId: number): Promise<CreditTransaction[]>;
  createCreditTransaction(t: InsertCreditTransaction): Promise<CreditTransaction>;
  countRows(table: "tradesmen" | "jobs" | "reviews"): Promise<number>;
  // microsite lead attribution — groups jobs by their `source` column.
  // `sinceMs` is an inclusive lower bound on createdAt; pass 0 for all-time.
  getMicrositeLeadStats(sinceMs: number): Promise<Array<{ source: string; count: number; lastLeadAt: number }>>;
  // payments_log (Stripe audit trail)
  createPaymentsLog(entry: InsertPaymentsLog): Promise<PaymentsLogEntry>;
  getPaymentsLogByTradesman(tradesmanId: number, limit?: number): Promise<PaymentsLogEntry[]>;
  /** Find the original credits_granted row for a Stripe PaymentIntent. Used
   *  by the refund handler to compute the revocation delta from the grant
   *  size (Stripe doesn't tell us how many credits were granted; we have to
   *  look it up in our own ledger). */
  findCreditsGrantByPaymentIntent(paymentIntentId: string): Promise<PaymentsLogEntry | undefined>;
  /** Tradesmen matching a given subscriptionStatus AND still currently
   *  featured (featuredUntil > now). Used by the past-due sweep cron to
   *  find featured listings that have been dunning long enough to revoke. */
  getTradesmenWithSubscriptionStatus(status: string, nowMs: number): Promise<Tradesman[]>;
  /** Most-recent payments_log row for a tradesman with the given action.
   *  Used by the past-due sweep to read the timestamp of when this tradesman
   *  first transitioned into past_due (the most recent featured_degraded
   *  row, since the webhook writes one per transition). */
  getMostRecentPaymentsLogAction(
    tradesmanId: number,
    action: string,
  ): Promise<PaymentsLogEntry | undefined>;
  // auth — magic-link tokens
  createMagicLinkToken(t: InsertMagicLinkToken): Promise<MagicLinkToken>;
  getMagicLinkTokenByHash(tokenHash: string): Promise<MagicLinkToken | undefined>;
  consumeMagicLinkToken(id: number, consumedAt: number): Promise<MagicLinkToken | undefined>;
  getRecentTokenForEmail(email: string, sinceMs: number): Promise<MagicLinkToken | undefined>;
  deleteExpiredMagicLinkTokens(nowMs: number): Promise<number>;
  // auth — sessions
  createSession(s: InsertSession): Promise<Session>;
  getSessionById(id: string): Promise<Session | undefined>;
  touchSession(id: string, patch: { lastSeenAt: number; expiresAt: number }): Promise<Session | undefined>;
  deleteSession(id: string): Promise<void>;
  deleteExpiredSessions(nowMs: number): Promise<number>;
  // partner_enquiries (inbound B2B from /partners)
  createPartnerEnquiry(entry: InsertPartnerEnquiry & { requestIp?: string | null; requestUserAgent?: string | null }): Promise<PartnerEnquiry>;
  getPartnerEnquiries(limit?: number): Promise<PartnerEnquiry[]>;
  getPartnerEnquiryById(id: number): Promise<PartnerEnquiry | undefined>;
  // ── partner admin (PR-P3) ──
  getPartnerEnquiriesByStatus(status?: string, limit?: number): Promise<PartnerEnquiry[]>;
  updatePartnerEnquiryStatus(id: number, status: string): Promise<PartnerEnquiry | undefined>;
  promoteEnquiryToPartner(enquiryId: number, opts: { slug: string; billingEmail?: string | null; billingContact?: string | null; notes?: string | null }): Promise<{ partner: Partner; enquiry: PartnerEnquiry }>;
  // partners CRUD
  createPartner(input: InsertPartner): Promise<Partner>;
  getPartners(): Promise<Partner[]>;
  getPartnerById(id: number): Promise<Partner | undefined>;
  getPartnerBySlug(slug: string): Promise<Partner | undefined>;
  updatePartner(id: number, patch: Partial<Partner>): Promise<Partner | undefined>;
  deletePartner(id: number): Promise<{ ok: true } | { ok: false; reason: string }>;
  // placements CRUD
  createPartnerPlacement(input: InsertPartnerPlacement): Promise<PartnerPlacement>;
  getPartnerPlacementsByPartner(partnerId: number): Promise<PartnerPlacement[]>;
  getPartnerPlacementById(id: number): Promise<PartnerPlacement | undefined>;
  updatePartnerPlacement(id: number, patch: Partial<PartnerPlacement>): Promise<PartnerPlacement | undefined>;
  deletePartnerPlacement(id: number): Promise<void>;
  // events (read-only)
  getPartnerEventsByPartner(partnerId: number, filters?: { eventType?: string; from?: number; to?: number; limit?: number }): Promise<PartnerEvent[]>;
  getPartnerEventCountsByPartner(partnerId: number, sinceMs: number): Promise<Record<string, number>>;
  // invoices
  getPartnerInvoicesByPartner(partnerId: number): Promise<PartnerInvoice[]>;
  getPartnerInvoiceById(id: number): Promise<PartnerInvoice | undefined>;
  findPartnerInvoiceForPeriod(partnerId: number, periodStart: number, periodEnd: number): Promise<PartnerInvoice | undefined>;
  createPartnerInvoice(input: InsertPartnerInvoice): Promise<PartnerInvoice>;
  updatePartnerInvoice(id: number, patch: Partial<PartnerInvoice>): Promise<PartnerInvoice | undefined>;
  /** All events for a partner within [from, to). Used by the invoice generator and the stats endpoint. */
  getPartnerEventsInRange(partnerId: number, from: number, to: number): Promise<PartnerEvent[]>;
  // ── placement engine (PR-P4) ──
  /** Returns all placements for a surface (time-active filtering done client-side). */
  getActivePlacementsBySurface(surface: string): Promise<PartnerPlacement[]>;
  /** Returns impression/click events for a placement since a given timestamp. */
  getEventsByPlacementSince(placementId: number, sinceMs: number): Promise<PartnerEvent[]>;
  /** Log a partner event (impressions, clicks, etc.). */
  createPartnerEvent(input: {
    placement_id: number;
    partner_id: number;
    event_type: string;
    event_id: string;
    surface: string;
    amount_pence: number;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  // ── tradesman verifications (insurance / qualifications) ──
  createTradesmanVerification(input: InsertTradesmanVerification & {
    fileMimeType: string;
    fileSizeBytes: number;
    filePath: string;
  }): Promise<TradesmanVerification>;
  /** All verifications for a tradesman, most recent first. */
  getTradesmanVerificationsByTradesman(tradesmanId: number): Promise<TradesmanVerification[]>;
  getTradesmanVerificationById(id: number): Promise<TradesmanVerification | undefined>;
  /** All pending verifications across all tradesmen, oldest first (FIFO review queue). */
  getPendingTradesmanVerifications(limit?: number): Promise<TradesmanVerification[]>;
  /** Apply an admin decision. status='rejected' requires reviewerNote. */
  decideTradesmanVerification(
    id: number,
    decision: {
      status: Exclude<VerificationStatus, "pending">;
      reviewedBy: string;
      reviewerNote?: string | null;
      reviewedAt: number;
    },
  ): Promise<TradesmanVerification | undefined>;
  /** The most recent approved+unexpired record for a given kind, if any. Used
   *  to drive the `tradesmen.insured` / `tradesmen.licensed` derived flags. */
  getLatestApprovedVerification(
    tradesmanId: number,
    kind: VerificationKind,
    nowYmd: string,
  ): Promise<TradesmanVerification | undefined>;
  /** Insert a Companies House evidence row. Distinct from createTradesmanVerification
   *  because the shape differs: no file fields, requires companyNumber+evidenceData.
   *  The DB CHECK constraint tv_evidence_shape enforces this at the row level. */
  createCompaniesHouseVerification(input: {
    tradesmanId: number;
    companyNumber: string;
    evidenceData: unknown;
    source: VerificationSource;
    /** Only set if the lookup succeeded server-side; null leaves it pending. */
    verifiedAt?: number | null;
    /** If true, the row is created with status='approved' (used by admin backfill
     *  and by the automated pro flow when the CH lookup itself is the evidence). */
    autoApprove?: boolean;
  }): Promise<TradesmanVerification>;
  /** Latest non-rejected CH evidence row for a (tradesman, companyNumber) pair.
   *  Used to dedupe submissions — if the pro already has a pending/approved CH
   *  row for the same company, we don't insert a duplicate. */
  getCompaniesHouseVerificationByTradesmanAndCompany(
    tradesmanId: number,
    companyNumber: string,
  ): Promise<TradesmanVerification | undefined>;
  /** Insert a Gas Safe Register evidence row. Same shape contract as CH but
   *  with gasSafeNumber/gasSafeRegisterUrl instead of companyNumber.
   *  The DB CHECK constraint tv_evidence_shape enforces shape at the row level. */
  createGasSafeVerification(input: {
    tradesmanId: number;
    gasSafeNumber: string;
    gasSafeRegisterUrl?: string | null;
    evidenceData: unknown;
    source: VerificationSource;
    /** Only set if the register lookup succeeded server-side; null leaves it pending. */
    verifiedAt?: number | null;
    /** If true, the row is created with status='approved' (used by admin backfill
     *  and by the automated pro flow when the register lookup itself is the evidence). */
    autoApprove?: boolean;
  }): Promise<TradesmanVerification>;
  /** Latest non-rejected Gas Safe evidence row for a (tradesman, gasSafeNumber) pair. */
  getGasSafeVerificationByTradesmanAndNumber(
    tradesmanId: number,
    gasSafeNumber: string,
  ): Promise<TradesmanVerification | undefined>;

  // ── homeowner sessions (PR D) ──
  createHomeownerSession(email: string, ip: string | null, ua: string | null): Promise<HomeownerSession>;
  getHomeownerSessionById(id: string): Promise<HomeownerSession | undefined>;
  touchHomeownerSession(id: string, patch: { lastSeenAt: number; expiresAt: number }): Promise<HomeownerSession | undefined>;
  deleteHomeownerSession(id: string): Promise<void>;

  // ── homeowner magic-link issuance (reuses magicLinkTokens, purpose='homeowner_verify_access') ──
  issueHomeownerMagicLink(email: string, tradesmanId: number, ip: string | null, ua: string | null): Promise<{ token: string; expiresAt: number }>;
  consumeHomeownerMagicLink(token: string): Promise<{ email: string; tradesmanId: number } | null>;

  // ── verification access requests (PR D) ──
  createOrRefreshAccessRequest(homeownerEmail: string, tradesmanId: number, ip: string | null, ua: string | null): Promise<VerificationAccessRequest>;
  listPendingAccessRequestsForTradesman(tradesmanId: number): Promise<VerificationAccessRequest[]>;
  listAllAccessRequestsForTradesman(tradesmanId: number, limit?: number): Promise<VerificationAccessRequest[]>;
  getAccessRequestById(id: number): Promise<VerificationAccessRequest | undefined>;
  decideAccessRequest(id: number, decision: 'granted' | 'denied' | 'revoked', decidedByTradesmanId: number, notes?: string | null): Promise<VerificationAccessRequest>;
  isAccessGranted(homeownerEmail: string, tradesmanId: number, nowMs: number): Promise<boolean>;
  getActiveAccessRequest(homeownerEmail: string, tradesmanId: number): Promise<VerificationAccessRequest | undefined>;

  // ── verification access blocks (PR D) ──
  isBlocked(tradesmanId: number, homeownerEmail: string): Promise<boolean>;
  createBlock(tradesmanId: number, homeownerEmail: string, reason?: string | null): Promise<VerificationAccessBlock>;
  deleteBlock(blockId: number, tradesmanId: number): Promise<void>;
  listBlocks(tradesmanId: number): Promise<VerificationAccessBlock[]>;
  listVerificationBlocksForTradesman(tradesmanId: number): Promise<VerificationAccessBlock[]>;

  // ── rate limiting (PR D) ──
  countAccessRequestsByEmailSince(email: string, sinceMs: number): Promise<number>;
}

const now = () => Date.now();

// Helper: first row from a promise-resolved array, or undefined
const one = async <T,>(p: Promise<T[]>): Promise<T | undefined> => (await p)[0];

export class DatabaseStorage implements IStorage {
  // ── categories ──
  async getCategories() { return db.select().from(categories); }
  async getCategoryBySlug(slug: string) {
    return one(db.select().from(categories).where(eq(categories.slug, slug)));
  }
  async createCategory(c: InsertCategory) {
    const [row] = await db.insert(categories).values(c).returning();
    return row;
  }

  // ── areas ──
  async getAreas() { return db.select().from(areas); }
  async getAreaBySlug(slug: string) {
    return one(db.select().from(areas).where(eq(areas.slug, slug)));
  }
  async createArea(a: InsertArea) {
    const [row] = await db.insert(areas).values(a).returning();
    return row;
  }

  // ── tradesmen ──
  async getTradesmen() { return db.select().from(tradesmen); }
  async getTradesmanBySlug(slug: string) {
    return one(db.select().from(tradesmen).where(eq(tradesmen.slug, slug)));
  }
  async getTradesmanById(id: number) {
    return one(db.select().from(tradesmen).where(eq(tradesmen.id, id)));
  }
  async getTradesmanByEmail(email: string) {
    return one(db.select().from(tradesmen).where(eq(tradesmen.email, email)));
  }
  async getTradesmanByStripeCustomerId(customerId: string) {
    return one(db.select().from(tradesmen).where(eq(tradesmen.stripeCustomerId, customerId)));
  }
  async getTradesmanByStripeSubscriptionId(subscriptionId: string) {
    return one(db.select().from(tradesmen).where(eq(tradesmen.stripeSubscriptionId, subscriptionId)));
  }
  async createTradesman(t: InsertTradesman) {
    const [row] = await db.insert(tradesmen).values({ ...t, createdAt: now() }).returning();
    return row;
  }
  async updateTradesman(id: number, patch: Partial<Tradesman>) {
    const [row] = await db.update(tradesmen).set(patch).where(eq(tradesmen.id, id)).returning();
    return row;
  }

  // ── jobs ──
  async getJobs() { return db.select().from(jobs).orderBy(desc(jobs.createdAt)); }
  async getJobById(id: number) {
    return one(db.select().from(jobs).where(eq(jobs.id, id)));
  }
  async createJob(j: InsertJob) {
    const [row] = await db.insert(jobs).values({ ...j, createdAt: now() }).returning();
    return row;
  }
  async updateJob(id: number, patch: Partial<Job>) {
    const [row] = await db.update(jobs).set(patch).where(eq(jobs.id, id)).returning();
    return row;
  }

  // ── quotes ──
  async getQuotes() { return db.select().from(quotes); }
  async getQuotesByTradesman(tradesmanId: number) {
    return db.select().from(quotes).where(eq(quotes.tradesmanId, tradesmanId)).orderBy(desc(quotes.createdAt));
  }
  async getQuotesByJob(jobId: number) {
    return db.select().from(quotes).where(eq(quotes.jobId, jobId));
  }
  async createQuote(q: InsertQuote) {
    const [row] = await db.insert(quotes).values({ ...q, createdAt: now() }).returning();
    return row;
  }

  // ── reviews ──
  async getReviews() { return db.select().from(reviews); }
  async getReviewsByTradesman(tradesmanId: number) {
    return db.select().from(reviews).where(eq(reviews.tradesmanId, tradesmanId)).orderBy(desc(reviews.createdAt));
  }
  async createReview(r: InsertReview) {
    const [row] = await db.insert(reviews).values({ ...r, createdAt: now() }).returning();
    return row;
  }
  async getReviewById(id: number) { return one(db.select().from(reviews).where(eq(reviews.id, id))); }
async updateReview(id: number, patch: Partial<Review>) { const [row] = await db.update(reviews).set(patch).where(eq(reviews.id, id)).returning(); return row; }

  // ── credits ──
  async getCredits(tradesmanId: number) {
    return one(db.select().from(tradesmanCredits).where(eq(tradesmanCredits.tradesmanId, tradesmanId)));
  }
  async setCredits(tradesmanId: number, balance: number) {
    const existing = await this.getCredits(tradesmanId);
    if (existing) {
      const [row] = await db.update(tradesmanCredits).set({ balance }).where(eq(tradesmanCredits.tradesmanId, tradesmanId)).returning();
      return row;
    }
    const [row] = await db.insert(tradesmanCredits).values({ tradesmanId, balance }).returning();
    return row;
  }
  async getCreditTransactions(tradesmanId: number) {
    return db.select().from(creditTransactions).where(eq(creditTransactions.tradesmanId, tradesmanId)).orderBy(desc(creditTransactions.createdAt));
  }
  async createCreditTransaction(t: InsertCreditTransaction) {
    const [row] = await db.insert(creditTransactions).values({ ...t, createdAt: now() }).returning();
    return row;
  }

  // ── payments_log ──
  async createPaymentsLog(entry: InsertPaymentsLog): Promise<PaymentsLogEntry> {
    const [row] = await db.insert(paymentsLog).values({ ...entry, createdAt: now() }).returning();
    return row;
  }
  async getPaymentsLogByTradesman(tradesmanId: number, limit = 50): Promise<PaymentsLogEntry[]> {
    return db.select().from(paymentsLog).where(eq(paymentsLog.tradesmanId, tradesmanId)).orderBy(desc(paymentsLog.createdAt)).limit(limit);
  }
  async getTradesmenWithSubscriptionStatus(status: string, nowMs: number): Promise<Tradesman[]> {
    return db
      .select()
      .from(tradesmen)
      .where(
        and(
          eq(tradesmen.subscriptionStatus, status),
          gt(tradesmen.featuredUntil, nowMs),
        ),
      );
  }
  async getMostRecentPaymentsLogAction(
    tradesmanId: number,
    action: string,
  ): Promise<PaymentsLogEntry | undefined> {
    return one(
      db
        .select()
        .from(paymentsLog)
        .where(
          and(
            eq(paymentsLog.tradesmanId, tradesmanId),
            eq(paymentsLog.action, action),
          ),
        )
        .orderBy(desc(paymentsLog.createdAt))
        .limit(1),
    );
  }
  async findCreditsGrantByPaymentIntent(paymentIntentId: string): Promise<PaymentsLogEntry | undefined> {
    // Most recent matching row wins. In practice there's exactly one
    // credits_granted row per payment_intent (event_id is unique), but if
    // an admin ever manually replayed a grant we want the latest.
    return one(
      db
        .select()
        .from(paymentsLog)
        .where(
          and(
            eq(paymentsLog.stripePaymentIntentId, paymentIntentId),
            eq(paymentsLog.action, "credits_granted"),
          ),
        )
        .orderBy(desc(paymentsLog.createdAt))
        .limit(1),
    );
  }

  async countRows(table: "tradesmen" | "jobs" | "reviews") {
    const map = { tradesmen, jobs, reviews } as const;
    const result = await db.select({ count: sql<number>`count(*)::int` }).from(map[table]);
    return result[0]?.count ?? 0;
  }

  /**
   * Per-source lead counts since `sinceMs` (inclusive). One row per distinct
   * `jobs.source` value with an aggregate count and the most recent
   * `createdAt` for that source. Indexed by idx_jobs_source so this stays
   * fast even at 6-figure job counts.
   *
   * The route handler enriches each row with the matching microsite
   * registry entry so the admin UI can show trade/area/kind alongside the
   * raw count without a second query.
   */
  async getMicrositeLeadStats(sinceMs: number): Promise<Array<{ source: string; count: number; lastLeadAt: number }>> {
    const rows = await db
      .select({
        source: jobs.source,
        count: sql<number>`count(*)::int`,
        lastLeadAt: sql<number>`max(${jobs.createdAt})::bigint`,
      })
      .from(jobs)
      .where(gte(jobs.createdAt, sinceMs))
      .groupBy(jobs.source)
      .orderBy(desc(sql`count(*)`));
    // drizzle returns bigint as string for ::bigint casts — coerce to number
    // here so the JSON response is uniformly numeric.
    return rows.map((r) => ({
      source: r.source,
      count: r.count,
      lastLeadAt: Number(r.lastLeadAt ?? 0),
    }));
  }

  // ── cards ──
  async getCardsByTradesman(tradesmanId: number): Promise<TradesmanCard[]> {
    return db.select().from(tradesmanCards).where(eq(tradesmanCards.tradesmanId, tradesmanId)).orderBy(desc(tradesmanCards.issuedAt));
  }
  async getAllCards(): Promise<TradesmanCard[]> {
    return db.select().from(tradesmanCards).orderBy(desc(tradesmanCards.issuedAt));
  }
  async getCardById(id: number): Promise<TradesmanCard | undefined> {
    return one(db.select().from(tradesmanCards).where(eq(tradesmanCards.id, id)));
  }
  async createCard(c: InsertTradesmanCard, issuedAt: number, expiresAt: number | null): Promise<TradesmanCard> {
    const [row] = await db.insert(tradesmanCards).values({ ...c, issuedAt, expiresAt }).returning();
    return row;
  }
  async rescindCard(id: number, rescindedBy: string, rescindedReason: string, rescindedAt: number): Promise<TradesmanCard | undefined> {
    const [row] = await db.update(tradesmanCards)
      .set({ rescindedAt, rescindedBy, rescindedReason })
      .where(eq(tradesmanCards.id, id))
      .returning();
    return row;
  }

  // ── auth: magic-link tokens ──
  // Tokens never store the raw secret — only its sha256 hash. `consumed_at`
  // is set on first successful /verify; subsequent presentations are rejected
  // at the route layer by checking it's still null.
  async createMagicLinkToken(t: InsertMagicLinkToken): Promise<MagicLinkToken> {
    const [row] = await db.insert(magicLinkTokens).values({ ...t, createdAt: now() }).returning();
    return row;
  }
  async getMagicLinkTokenByHash(tokenHash: string): Promise<MagicLinkToken | undefined> {
    return one(db.select().from(magicLinkTokens).where(eq(magicLinkTokens.tokenHash, tokenHash)));
  }
  async consumeMagicLinkToken(id: number, consumedAt: number): Promise<MagicLinkToken | undefined> {
    // Conditional update — only consume if not already consumed. Returning
    // zero rows tells the caller someone else got there first (double-click
    // on the magic link, replay attack, etc).
    const [row] = await db.update(magicLinkTokens)
      .set({ consumedAt })
      .where(and(eq(magicLinkTokens.id, id), isNull(magicLinkTokens.consumedAt)))
      .returning();
    return row;
  }
  async getRecentTokenForEmail(email: string, sinceMs: number): Promise<MagicLinkToken | undefined> {
    return one(
      db.select().from(magicLinkTokens)
        .where(and(eq(magicLinkTokens.email, email), gt(magicLinkTokens.createdAt, sinceMs)))
        .orderBy(desc(magicLinkTokens.createdAt))
        .limit(1),
    );
  }
  async deleteExpiredMagicLinkTokens(nowMs: number): Promise<number> {
    const rows = await db.delete(magicLinkTokens).where(lt(magicLinkTokens.expiresAt, nowMs)).returning({ id: magicLinkTokens.id });
    return rows.length;
  }

  // ── auth: sessions ──
  async createSession(s: InsertSession): Promise<Session> {
    const ts = now();
    const [row] = await db.insert(sessions).values({ ...s, createdAt: ts, lastSeenAt: ts }).returning();
    return row;
  }
  async getSessionById(id: string): Promise<Session | undefined> {
    return one(db.select().from(sessions).where(eq(sessions.id, id)));
  }
  async touchSession(id: string, patch: { lastSeenAt: number; expiresAt: number }): Promise<Session | undefined> {
    const [row] = await db.update(sessions).set(patch).where(eq(sessions.id, id)).returning();
    return row;
  }
  async deleteSession(id: string): Promise<void> {
    await db.delete(sessions).where(eq(sessions.id, id));
  }
  async deleteExpiredSessions(nowMs: number): Promise<number> {
    const rows = await db.delete(sessions).where(lt(sessions.expiresAt, nowMs)).returning({ id: sessions.id });
    return rows.length;
  }

  // ── moderation log ──
  async logModeration(entry: Omit<ModerationLogEntry, "id" | "createdAt"> & { createdAt?: number }): Promise<ModerationLogEntry> {
    const [row] = await db.insert(moderationLog).values({ ...entry, createdAt: entry.createdAt ?? now() }).returning();
    return row;
  }
  async getModerationLog(limit = 100): Promise<ModerationLogEntry[]> {
    return db.select().from(moderationLog).orderBy(desc(moderationLog.createdAt)).limit(limit);
  }
  async getModerationLogByTradesman(tradesmanId: number): Promise<ModerationLogEntry[]> {
    return db.select().from(moderationLog).where(eq(moderationLog.tradesmanId, tradesmanId)).orderBy(desc(moderationLog.createdAt));
  }

  // ── partner_enquiries ──
  async createPartnerEnquiry(
    entry: InsertPartnerEnquiry & { requestIp?: string | null; requestUserAgent?: string | null },
  ): Promise<PartnerEnquiry> {
    const [row] = await db.insert(partnerEnquiries).values({
      companyName: entry.companyName,
      contactName: entry.contactName,
      email: entry.email.toLowerCase().trim(),
      phone: entry.phone ?? null,
      vertical: entry.vertical,
      monthlyBudget: entry.monthlyBudget ?? null,
      message: entry.message,
      requestIp: entry.requestIp ?? null,
      requestUserAgent: entry.requestUserAgent ?? null,
      createdAt: now(),
    }).returning();
    return row;
  }
  async getPartnerEnquiries(limit = 100): Promise<PartnerEnquiry[]> {
    return db.select().from(partnerEnquiries).orderBy(desc(partnerEnquiries.createdAt)).limit(limit);
  }
  async getPartnerEnquiryById(id: number): Promise<PartnerEnquiry | undefined> {
    return one(db.select().from(partnerEnquiries).where(eq(partnerEnquiries.id, id)));
  }

  // -- partner admin (PR-P3) --

  async getPartnerEnquiriesByStatus(status?: string, limit = 100): Promise<PartnerEnquiry[]> {
    const q = db.select().from(partnerEnquiries);
    if (status) {
      return q.where(eq(partnerEnquiries.status, status)).orderBy(desc(partnerEnquiries.createdAt)).limit(limit);
    }
    return q.orderBy(desc(partnerEnquiries.createdAt)).limit(limit);
  }

  async updatePartnerEnquiryStatus(id: number, status: string): Promise<PartnerEnquiry | undefined> {
    const [row] = await db.update(partnerEnquiries).set({ status }).where(eq(partnerEnquiries.id, id)).returning();
    return row;
  }

  async promoteEnquiryToPartner(
    enquiryId: number,
    opts: { slug: string; billingEmail?: string | null; billingContact?: string | null; notes?: string | null },
  ): Promise<{ partner: Partner; enquiry: PartnerEnquiry }> {
    // Check slug uniqueness before writing
    const existing = await this.getPartnerBySlug(opts.slug);
    if (existing) throw Object.assign(new Error('Slug already in use'), { code: 'SLUG_CONFLICT' });

    const enquiry = await this.getPartnerEnquiryById(enquiryId);
    if (!enquiry) throw new Error('Enquiry not found');

    const [newPartner] = await db.insert(partners).values({
      slug: opts.slug,
      name: enquiry.companyName,
      vertical: enquiry.vertical,
      status: 'pilot',
      billingEmail: opts.billingEmail ?? null,
      billingContact: opts.billingContact ?? null,
      notes: opts.notes ?? null,
      createdAt: now(),
    }).returning();

    const [updatedEnquiry] = await db
      .update(partnerEnquiries)
      .set({ status: 'won', promotedPartnerId: newPartner.id })
      .where(eq(partnerEnquiries.id, enquiryId))
      .returning();

    return { partner: newPartner, enquiry: updatedEnquiry };
  }

  // -- partners CRUD --

  async createPartner(input: InsertPartner): Promise<Partner> {
    const [row] = await db.insert(partners).values({ ...input, createdAt: now() }).returning();
    return row;
  }

  async getPartners(): Promise<Partner[]> {
    return db.select().from(partners).orderBy(desc(partners.createdAt));
  }

  async getPartnerById(id: number): Promise<Partner | undefined> {
    return one(db.select().from(partners).where(eq(partners.id, id)));
  }

  async getPartnerBySlug(slug: string): Promise<Partner | undefined> {
    return one(db.select().from(partners).where(eq(partners.slug, slug)));
  }

  async updatePartner(id: number, patch: Partial<Partner>): Promise<Partner | undefined> {
    const [row] = await db.update(partners).set(patch).where(eq(partners.id, id)).returning();
    return row;
  }

  async deletePartner(id: number): Promise<{ ok: true } | { ok: false; reason: string }> {
    const partner = await this.getPartnerById(id);
    if (!partner) return { ok: false, reason: 'Partner not found' };
    if (partner.status !== 'inactive') {
      return { ok: false, reason: 'Only inactive partners can be hard-deleted; use status=terminated to soft-delete' };
    }
    const placements = await this.getPartnerPlacementsByPartner(id);
    if (placements.length > 0) return { ok: false, reason: 'Partner has placements -- remove them first' };
    const events = await this.getPartnerEventsByPartner(id, { limit: 1 });
    if (events.length > 0) return { ok: false, reason: 'Partner has events -- cannot delete' };
    await db.delete(partners).where(eq(partners.id, id));
    return { ok: true };
  }

  // -- placements CRUD --

  async createPartnerPlacement(input: InsertPartnerPlacement): Promise<PartnerPlacement> {
    const [row] = await db.insert(partnerPlacements).values({ ...input, createdAt: now() }).returning();
    return row;
  }

  async getPartnerPlacementsByPartner(partnerId: number): Promise<PartnerPlacement[]> {
    return db.select().from(partnerPlacements)
      .where(eq(partnerPlacements.partnerId, partnerId))
      .orderBy(desc(partnerPlacements.createdAt));
  }

  async getPartnerPlacementById(id: number): Promise<PartnerPlacement | undefined> {
    return one(db.select().from(partnerPlacements).where(eq(partnerPlacements.id, id)));
  }

  async updatePartnerPlacement(id: number, patch: Partial<PartnerPlacement>): Promise<PartnerPlacement | undefined> {
    const [row] = await db.update(partnerPlacements).set(patch).where(eq(partnerPlacements.id, id)).returning();
    return row;
  }

  async deletePartnerPlacement(id: number): Promise<void> {
    await db.delete(partnerPlacements).where(eq(partnerPlacements.id, id));
  }

  // -- events (read-only) --

  async getPartnerEventsByPartner(
    partnerId: number,
    filters: { eventType?: string; from?: number; to?: number; limit?: number } = {},
  ): Promise<PartnerEvent[]> {
    const conditions = [eq(partnerEvents.partnerId, partnerId)] as any[];
    if (filters.eventType) conditions.push(eq(partnerEvents.eventType, filters.eventType));
    if (filters.from) conditions.push(gte(partnerEvents.occurredAt, filters.from));
    if (filters.to) conditions.push(lte(partnerEvents.occurredAt, filters.to));
    return db
      .select()
      .from(partnerEvents)
      .where(and(...conditions))
      .orderBy(desc(partnerEvents.occurredAt))
      .limit(filters.limit ?? 200);
  }

  async getPartnerEventCountsByPartner(partnerId: number, sinceMs: number): Promise<Record<string, number>> {
    const rows = await db
      .select({
        eventType: partnerEvents.eventType,
        count: sql<number>`count(*)::int`,
      })
      .from(partnerEvents)
      .where(and(eq(partnerEvents.partnerId, partnerId), gte(partnerEvents.occurredAt, sinceMs)))
      .groupBy(partnerEvents.eventType);
    return Object.fromEntries(rows.map((r) => [r.eventType, r.count]));
  }

  // -- invoices --

  async getPartnerInvoicesByPartner(partnerId: number): Promise<PartnerInvoice[]> {
    return db.select().from(partnerInvoices)
      .where(eq(partnerInvoices.partnerId, partnerId))
      .orderBy(desc(partnerInvoices.generatedAt));
  }

  async getPartnerInvoiceById(id: number): Promise<PartnerInvoice | undefined> {
    return one(db.select().from(partnerInvoices).where(eq(partnerInvoices.id, id)).limit(1));
  }

  /**
   * Idempotency helper for the generate-invoice endpoint. Two invoices for
   * the same (partner, periodStart, periodEnd) triple would let admins
   * accidentally double-bill, so we look up before insert.
   */
  async findPartnerInvoiceForPeriod(partnerId: number, periodStart: number, periodEnd: number): Promise<PartnerInvoice | undefined> {
    return one(
      db.select().from(partnerInvoices)
        .where(and(
          eq(partnerInvoices.partnerId, partnerId),
          eq(partnerInvoices.periodStart, periodStart),
          eq(partnerInvoices.periodEnd, periodEnd),
        ))
        .limit(1),
    );
  }

  async createPartnerInvoice(input: InsertPartnerInvoice): Promise<PartnerInvoice> {
    const [row] = await db.insert(partnerInvoices).values({
      ...input,
      generatedAt: now(),
    }).returning();
    return row;
  }

  async updatePartnerInvoice(id: number, patch: Partial<PartnerInvoice>): Promise<PartnerInvoice | undefined> {
    // Whitelist updatable fields. We never let callers rewrite the period,
    // line items, or total — those are immutable once generated. To change
    // amounts, void the invoice and generate a new one.
    const safe: Record<string, unknown> = {};
    if (patch.status !== undefined) safe.status = patch.status;
    if (patch.stripeInvoiceId !== undefined) safe.stripeInvoiceId = patch.stripeInvoiceId;
    if (patch.sentAt !== undefined) safe.sentAt = patch.sentAt;
    if (patch.paidAt !== undefined) safe.paidAt = patch.paidAt;
    if (Object.keys(safe).length === 0) {
      return this.getPartnerInvoiceById(id);
    }
    const [row] = await db.update(partnerInvoices).set(safe).where(eq(partnerInvoices.id, id)).returning();
    return row;
  }

  /**
   * All partner_events rows for a partner with occurredAt in [from, to).
   * Used by both the invoice generator (single period) and the admin stats
   * page (rolling window).
   */
  async getPartnerEventsInRange(partnerId: number, from: number, to: number): Promise<PartnerEvent[]> {
    return db.select().from(partnerEvents)
      .where(and(
        eq(partnerEvents.partnerId, partnerId),
        gte(partnerEvents.occurredAt, from),
        lt(partnerEvents.occurredAt, to),
      ))
      .orderBy(desc(partnerEvents.occurredAt));
  }

  // ── placement engine (PR-P4) ──

  /**
   * Returns all placements for a given surface.
   * Time-active filtering (activeFrom/activeTo vs now) is done client-side
   * in the placement engine so we can inject `nowMs` for deterministic tests.
   */
  async getActivePlacementsBySurface(surface: string): Promise<PartnerPlacement[]> {
    return db.select().from(partnerPlacements)
      .where(eq(partnerPlacements.surface, surface))
      .orderBy(partnerPlacements.priority);
  }

  /**
   * Returns all partner events for a specific placement since sinceMs.
   * Used by the budget-check step of the placement engine.
   */
  async getEventsByPlacementSince(placementId: number, sinceMs: number): Promise<PartnerEvent[]> {
    return db.select().from(partnerEvents)
      .where(and(
        eq(partnerEvents.placementId, placementId),
        gte(partnerEvents.occurredAt, sinceMs),
      ))
      .orderBy(desc(partnerEvents.occurredAt));
  }

  /**
   * Log a partner event (impression / click / etc.).
   * The idempotencyKey is `<event_type>:<placement_id>:<event_id>` to satisfy
   * the NOT NULL UNIQUE constraint on partner_events.idempotency_key.
   */
  async createPartnerEvent(input: {
    placement_id: number;
    partner_id: number;
    event_type: string;
    event_id: string;
    surface: string;
    amount_pence: number;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const idempotencyKey = `${input.event_type}:${input.placement_id}:${input.event_id}`;
    await db.insert(partnerEvents).values({
      placementId: input.placement_id,
      partnerId: input.partner_id,
      eventType: input.event_type,
      idempotencyKey,
      occurredAt: now(),
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    });
  }

  /* ── tradesman verifications (insurance / qualifications) ── */
  async createTradesmanVerification(input: InsertTradesmanVerification & {
    fileMimeType: string;
    fileSizeBytes: number;
    filePath: string;
  }): Promise<TradesmanVerification> {
    const [row] = await db.insert(tradesmanVerifications).values({
      tradesmanId: input.tradesmanId,
      kind: input.kind,
      filePath: input.filePath,
      fileMimeType: input.fileMimeType,
      fileSizeBytes: input.fileSizeBytes,
      qualificationType: input.qualificationType ?? null,
      insuranceCoverGbp: input.insuranceCoverGbp ?? null,
      expiryDate: input.expiryDate ?? null,
      status: "pending",
      submittedAt: now(),
    }).returning();
    return row;
  }

  async getTradesmanVerificationsByTradesman(tradesmanId: number): Promise<TradesmanVerification[]> {
    return db.select().from(tradesmanVerifications)
      .where(eq(tradesmanVerifications.tradesmanId, tradesmanId))
      .orderBy(desc(tradesmanVerifications.submittedAt));
  }

  async getTradesmanVerificationById(id: number): Promise<TradesmanVerification | undefined> {
    return one(db.select().from(tradesmanVerifications).where(eq(tradesmanVerifications.id, id)));
  }

  async getPendingTradesmanVerifications(limit = 200): Promise<TradesmanVerification[]> {
    return db.select().from(tradesmanVerifications)
      .where(eq(tradesmanVerifications.status, "pending"))
      .orderBy(tradesmanVerifications.submittedAt)
      .limit(limit);
  }

  async decideTradesmanVerification(
    id: number,
    decision: {
      status: Exclude<VerificationStatus, "pending">;
      reviewedBy: string;
      reviewerNote?: string | null;
      reviewedAt: number;
    },
  ): Promise<TradesmanVerification | undefined> {
    const [row] = await db.update(tradesmanVerifications).set({
      status: decision.status,
      reviewedBy: decision.reviewedBy,
      reviewerNote: decision.reviewerNote ?? null,
      reviewedAt: decision.reviewedAt,
    }).where(eq(tradesmanVerifications.id, id)).returning();
    return row;
  }

  async getLatestApprovedVerification(
    tradesmanId: number,
    kind: VerificationKind,
    nowYmd: string,
  ): Promise<TradesmanVerification | undefined> {
    // "Unexpired" means expiryDate is NULL (unknown — we treat as valid since the
    // reviewer chose to approve without one) OR expiryDate >= today's YYYY-MM-DD.
    // String comparison works because ISO dates are lexicographically ordered.
    return one(
      db.select().from(tradesmanVerifications)
        .where(and(
          eq(tradesmanVerifications.tradesmanId, tradesmanId),
          eq(tradesmanVerifications.kind, kind),
          eq(tradesmanVerifications.status, "approved"),
          sql`(${tradesmanVerifications.expiryDate} IS NULL OR ${tradesmanVerifications.expiryDate} >= ${nowYmd})`,
        ))
        .orderBy(desc(tradesmanVerifications.submittedAt))
        .limit(1),
    );
  }

  async createCompaniesHouseVerification(input: {
    tradesmanId: number;
    companyNumber: string;
    evidenceData: unknown;
    source: VerificationSource;
    verifiedAt?: number | null;
    autoApprove?: boolean;
  }): Promise<TradesmanVerification> {
    // We rely on the DB's tv_evidence_shape CHECK and unique partial index
    // (uq_tv_tradesman_company_number) for the hard guarantees. The route layer
    // pre-checks dedupe to return a friendlier 409 — this insert will still
    // surface a constraint error if two requests race past the pre-check.
    const ts = now();
    const [row] = await db.insert(tradesmanVerifications).values({
      tradesmanId: input.tradesmanId,
      kind: "companies_house",
      // File columns are NULL for CH evidence; the CHECK constraint allows this
      // only when kind='companies_house'.
      filePath: null,
      fileMimeType: null,
      fileSizeBytes: null,
      qualificationType: null,
      insuranceCoverGbp: null,
      expiryDate: null,
      companyNumber: input.companyNumber,
      evidenceData: input.evidenceData,
      source: input.source,
      verifiedAt: input.verifiedAt ?? null,
      status: input.autoApprove ? "approved" : "pending",
      submittedAt: ts,
      reviewedAt: input.autoApprove ? ts : null,
      reviewedBy: input.autoApprove ? "system:companies_house" : null,
    }).returning();
    return row;
  }

  async getCompaniesHouseVerificationByTradesmanAndCompany(
    tradesmanId: number,
    companyNumber: string,
  ): Promise<TradesmanVerification | undefined> {
    // Return most-recent non-rejected row — a previously-rejected submission
    // shouldn't block the pro from resubmitting after fixing the issue.
    return one(
      db.select().from(tradesmanVerifications)
        .where(and(
          eq(tradesmanVerifications.tradesmanId, tradesmanId),
          eq(tradesmanVerifications.kind, "companies_house"),
          eq(tradesmanVerifications.companyNumber, companyNumber),
          sql`${tradesmanVerifications.status} <> 'rejected'`,
        ))
        .orderBy(desc(tradesmanVerifications.submittedAt))
        .limit(1),
    );
  }

  async createGasSafeVerification(input: {
    tradesmanId: number;
    gasSafeNumber: string;
    gasSafeRegisterUrl?: string | null;
    evidenceData: unknown;
    source: VerificationSource;
    verifiedAt?: number | null;
    autoApprove?: boolean;
  }): Promise<TradesmanVerification> {
    // Mirrors createCompaniesHouseVerification — different register, same
    // contract. The DB CHECK constraint tv_evidence_shape and unique partial
    // index uq_tv_tradesman_gas_safe_number provide the hard guarantees.
    const ts = now();
    const [row] = await db.insert(tradesmanVerifications).values({
      tradesmanId: input.tradesmanId,
      kind: "gas_safe",
      filePath: null,
      fileMimeType: null,
      fileSizeBytes: null,
      qualificationType: null,
      insuranceCoverGbp: null,
      expiryDate: null,
      companyNumber: null,
      gasSafeNumber: input.gasSafeNumber,
      gasSafeRegisterUrl: input.gasSafeRegisterUrl ?? null,
      evidenceData: input.evidenceData,
      source: input.source,
      verifiedAt: input.verifiedAt ?? null,
      status: input.autoApprove ? "approved" : "pending",
      submittedAt: ts,
      reviewedAt: input.autoApprove ? ts : null,
      reviewedBy: input.autoApprove ? "system:gas_safe" : null,
    }).returning();
    return row;
  }

  async getGasSafeVerificationByTradesmanAndNumber(
    tradesmanId: number,
    gasSafeNumber: string,
  ): Promise<TradesmanVerification | undefined> {
    return one(
      db.select().from(tradesmanVerifications)
        .where(and(
          eq(tradesmanVerifications.tradesmanId, tradesmanId),
          eq(tradesmanVerifications.kind, "gas_safe"),
          eq(tradesmanVerifications.gasSafeNumber, gasSafeNumber),
          sql`${tradesmanVerifications.status} <> 'rejected'`,
        ))
        .orderBy(desc(tradesmanVerifications.submittedAt))
        .limit(1),
    );
  }

  /* ─────────────────────────────────────────────
     HOMEOWNER ACCESS (PR D)
     ───────────────────────────────────────────── */

  // Homeowner sessions
  async createHomeownerSession(email: string, ip: string | null, ua: string | null): Promise<HomeownerSession> {
    const { generateSessionId } = await import("./auth");
    const { HOMEOWNER_SESSION_TTL_MS } = await import("./homeowner-auth");
    const id = generateSessionId();
    const nowMs = now();
    const [row] = await db.insert(homeownerSessions).values({
      id,
      email,
      createdAt: nowMs,
      expiresAt: nowMs + HOMEOWNER_SESSION_TTL_MS,
      lastSeenAt: nowMs,
      requestIp: ip,
      requestUserAgent: ua,
    }).returning();
    return row;
  }

  async getHomeownerSessionById(id: string): Promise<HomeownerSession | undefined> {
    return one(db.select().from(homeownerSessions).where(eq(homeownerSessions.id, id)));
  }

  async touchHomeownerSession(id: string, patch: { lastSeenAt: number; expiresAt: number }): Promise<HomeownerSession | undefined> {
    const [row] = await db.update(homeownerSessions)
      .set({ lastSeenAt: patch.lastSeenAt, expiresAt: patch.expiresAt })
      .where(eq(homeownerSessions.id, id))
      .returning();
    return row;
  }

  async deleteHomeownerSession(id: string): Promise<void> {
    await db.delete(homeownerSessions).where(eq(homeownerSessions.id, id));
  }

  // Homeowner magic links (reuses magicLinkTokens, purpose='homeowner_verify_access')
  async issueHomeownerMagicLink(
    email: string,
    tradesmanId: number,
    ip: string | null,
    ua: string | null,
  ): Promise<{ token: string; expiresAt: number }> {
    const { generateToken, hashToken } = await import("./auth");
    const { HOMEOWNER_MAGIC_LINK_TTL_MS } = await import("./homeowner-auth");
    const token = generateToken();
    const tokenHash = hashToken(token);
    const nowMs = now();
    const expiresAt = nowMs + HOMEOWNER_MAGIC_LINK_TTL_MS;
    await db.insert(magicLinkTokens).values({
      tokenHash,
      email,
      tradesmanId,
      purpose: "homeowner_verify_access",
      expiresAt,
      createdAt: nowMs,
      requestIp: ip,
      requestUserAgent: ua,
    });
    return { token, expiresAt };
  }

  async consumeHomeownerMagicLink(token: string): Promise<{ email: string; tradesmanId: number } | null> {
    const { hashToken } = await import("./auth");
    const tokenHash = hashToken(token);
    const row = await one(
      db.select().from(magicLinkTokens)
        .where(and(
          eq(magicLinkTokens.tokenHash, tokenHash),
          eq(magicLinkTokens.purpose, "homeowner_verify_access"),
          isNull(magicLinkTokens.consumedAt),
          gt(magicLinkTokens.expiresAt, now()),
        ))
    );
    if (!row) return null;
    await db.update(magicLinkTokens)
      .set({ consumedAt: now() })
      .where(eq(magicLinkTokens.id, row.id));
    if (!row.tradesmanId) return null;
    return { email: row.email, tradesmanId: row.tradesmanId };
  }

  // Verification access requests
  async createOrRefreshAccessRequest(
    homeownerEmail: string,
    tradesmanId: number,
    ip: string | null,
    ua: string | null,
  ): Promise<VerificationAccessRequest> {
    const nowMs = now();

    // Look for the most recent row for this pair
    const existing = await one(
      db.select().from(verificationAccessRequests)
        .where(and(
          eq(verificationAccessRequests.homeownerEmail, homeownerEmail),
          eq(verificationAccessRequests.tradesmanId, tradesmanId),
        ))
        .orderBy(desc(verificationAccessRequests.requestedAt))
        .limit(1)
    );

    if (existing) {
      // Active grant: no-op
      if (existing.status === "granted" && existing.grantedUntil && existing.grantedUntil > nowMs) {
        return existing;
      }
      // Pending: bump requested_at to re-notify tradesman
      if (existing.status === "pending") {
        const [updated] = await db.update(verificationAccessRequests)
          .set({ requestedAt: nowMs, requestIp: ip, requestUserAgent: ua })
          .where(eq(verificationAccessRequests.id, existing.id))
          .returning();
        return updated;
      }
      // denied / revoked / expired grant: fall through to create new row
    }

    const [row] = await db.insert(verificationAccessRequests).values({
      homeownerEmail,
      tradesmanId,
      status: "pending",
      requestedAt: nowMs,
      requestIp: ip,
      requestUserAgent: ua,
    }).returning();
    return row;
  }

  async listPendingAccessRequestsForTradesman(tradesmanId: number): Promise<VerificationAccessRequest[]> {
    return db.select().from(verificationAccessRequests)
      .where(and(
        eq(verificationAccessRequests.tradesmanId, tradesmanId),
        eq(verificationAccessRequests.status, "pending"),
      ))
      .orderBy(desc(verificationAccessRequests.requestedAt));
  }

  async listAllAccessRequestsForTradesman(tradesmanId: number, limit = 50): Promise<VerificationAccessRequest[]> {
    return db.select().from(verificationAccessRequests)
      .where(eq(verificationAccessRequests.tradesmanId, tradesmanId))
      .orderBy(desc(verificationAccessRequests.requestedAt))
      .limit(limit);
  }

  async getAccessRequestById(id: number): Promise<VerificationAccessRequest | undefined> {
    return one(db.select().from(verificationAccessRequests).where(eq(verificationAccessRequests.id, id)));
  }

  async decideAccessRequest(
    id: number,
    decision: "granted" | "denied" | "revoked",
    decidedByTradesmanId: number,
    notes?: string | null,
  ): Promise<VerificationAccessRequest> {
    const nowMs = now();
    const { HOMEOWNER_GRANT_TTL_MS } = await import("./homeowner-auth");
    const patch: Record<string, unknown> = {
      status: decision,
      decidedAt: nowMs,
      decidedByTradesmanId,
      notes: notes ?? null,
    };
    if (decision === "granted") {
      patch.grantedUntil = nowMs + HOMEOWNER_GRANT_TTL_MS;
    }
    if (decision === "revoked") {
      patch.revokedAt = nowMs;
    }
    const [row] = await db.update(verificationAccessRequests)
      .set(patch)
      .where(eq(verificationAccessRequests.id, id))
      .returning();
    return row;
  }

  async isAccessGranted(homeownerEmail: string, tradesmanId: number, nowMs: number): Promise<boolean> {
    const row = await one(
      db.select().from(verificationAccessRequests)
        .where(and(
          eq(verificationAccessRequests.homeownerEmail, homeownerEmail),
          eq(verificationAccessRequests.tradesmanId, tradesmanId),
          eq(verificationAccessRequests.status, "granted"),
          gt(verificationAccessRequests.grantedUntil, nowMs),
        ))
        .limit(1)
    );
    return !!row;
  }

  async getActiveAccessRequest(homeownerEmail: string, tradesmanId: number): Promise<VerificationAccessRequest | undefined> {
    return one(
      db.select().from(verificationAccessRequests)
        .where(and(
          eq(verificationAccessRequests.homeownerEmail, homeownerEmail),
          eq(verificationAccessRequests.tradesmanId, tradesmanId),
        ))
        .orderBy(desc(verificationAccessRequests.requestedAt))
        .limit(1)
    );
  }

  // Verification access blocks
  async isBlocked(tradesmanId: number, homeownerEmail: string): Promise<boolean> {
    const row = await one(
      db.select().from(verificationAccessBlocks)
        .where(and(
          eq(verificationAccessBlocks.tradesmanId, tradesmanId),
          eq(verificationAccessBlocks.homeownerEmail, homeownerEmail),
        ))
    );
    return !!row;
  }

  async createBlock(tradesmanId: number, homeownerEmail: string, reason?: string | null): Promise<VerificationAccessBlock> {
    const nowMs = now();
    const [row] = await db.insert(verificationAccessBlocks)
      .values({ tradesmanId, homeownerEmail, createdAt: nowMs, reason: reason ?? null })
      .onConflictDoNothing()
      .returning();
    if (row) return row;
    // Already blocked — return existing
    const existing = await one(
      db.select().from(verificationAccessBlocks)
        .where(and(
          eq(verificationAccessBlocks.tradesmanId, tradesmanId),
          eq(verificationAccessBlocks.homeownerEmail, homeownerEmail),
        ))
    );
    return existing!;
  }

  async deleteBlock(blockId: number, tradesmanId: number): Promise<void> {
    await db.delete(verificationAccessBlocks)
      .where(and(
        eq(verificationAccessBlocks.id, blockId),
        eq(verificationAccessBlocks.tradesmanId, tradesmanId),
      ));
  }

  async listBlocks(tradesmanId: number): Promise<VerificationAccessBlock[]> {
    return db.select().from(verificationAccessBlocks)
      .where(eq(verificationAccessBlocks.tradesmanId, tradesmanId))
      .orderBy(desc(verificationAccessBlocks.createdAt));
  }

  async listVerificationBlocksForTradesman(tradesmanId: number): Promise<VerificationAccessBlock[]> {
    return db.select().from(verificationAccessBlocks)
      .where(eq(verificationAccessBlocks.tradesmanId, tradesmanId))
      .orderBy(desc(verificationAccessBlocks.createdAt));
  }

  // Rate limiting
  async countAccessRequestsByEmailSince(email: string, sinceMs: number): Promise<number> {
    const rows = await db.select().from(verificationAccessRequests)
      .where(and(
        eq(verificationAccessRequests.homeownerEmail, email),
        gte(verificationAccessRequests.requestedAt, sinceMs),
      ));
    return rows.length;
  }
}

export const storage = new DatabaseStorage();
