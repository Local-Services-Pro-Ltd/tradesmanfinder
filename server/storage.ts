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
  moderationLog,
  paymentsLog,
  partnerEnquiries,
  partners,
  partnerPlacements,
  partnerEvents,
  partnerInvoices,
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
  ModerationLogEntry,
  InsertPaymentsLog, PaymentsLogEntry,
  InsertPartnerEnquiry, PartnerEnquiry,
  Partner, InsertPartner,
  PartnerPlacement, InsertPartnerPlacement,
  PartnerEvent,
  PartnerInvoice,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, desc, sql, and, isNull, gte, lte } from "drizzle-orm";

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
  // payments_log (Stripe audit trail)
  createPaymentsLog(entry: InsertPaymentsLog): Promise<PaymentsLogEntry>;
  getPaymentsLogByTradesman(tradesmanId: number, limit?: number): Promise<PaymentsLogEntry[]>;
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
  // invoices (read-only stub)
  getPartnerInvoicesByPartner(partnerId: number): Promise<PartnerInvoice[]>;
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

  async countRows(table: "tradesmen" | "jobs" | "reviews") {
    const map = { tradesmen, jobs, reviews } as const;
    const result = await db.select({ count: sql<number>`count(*)::int` }).from(map[table]);
    return result[0]?.count ?? 0;
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

  // -- invoices (read-only stub) --

  async getPartnerInvoicesByPartner(partnerId: number): Promise<PartnerInvoice[]> {
    return db.select().from(partnerInvoices)
      .where(eq(partnerInvoices.partnerId, partnerId))
      .orderBy(desc(partnerInvoices.generatedAt));
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
}

export const storage = new DatabaseStorage();
