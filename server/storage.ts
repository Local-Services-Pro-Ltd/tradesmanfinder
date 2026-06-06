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
  authTokens,
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
  AuthToken, InsertAuthToken,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, desc, sql, and, isNull, gte } from "drizzle-orm";

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
  // auth_tokens (magic-link sign-in)
  createAuthToken(entry: InsertAuthToken): Promise<AuthToken>;
  getAuthTokenByHash(tokenHash: string): Promise<AuthToken | undefined>;
  consumeAuthToken(id: number, consumedAt: Date): Promise<AuthToken | undefined>;
  countAuthTokensForTradesmanSince(tradesmanId: number, since: Date): Promise<number>;
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

  // ── auth_tokens ──
  async createAuthToken(entry: InsertAuthToken): Promise<AuthToken> {
    const [row] = await db.insert(authTokens).values(entry).returning();
    return row;
  }
  async getAuthTokenByHash(tokenHash: string): Promise<AuthToken | undefined> {
    return one(db.select().from(authTokens).where(eq(authTokens.tokenHash, tokenHash)));
  }
  async consumeAuthToken(id: number, consumedAt: Date): Promise<AuthToken | undefined> {
    // Only mark a token consumed if it has not already been consumed. The
    // isNull guard makes consumption atomic-ish at the row level so a replayed
    // verify request can't double-spend a token.
    const [row] = await db.update(authTokens)
      .set({ consumedAt })
      .where(and(eq(authTokens.id, id), isNull(authTokens.consumedAt)))
      .returning();
    return row;
  }
  async countAuthTokensForTradesmanSince(tradesmanId: number, since: Date): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)::int` })
      .from(authTokens)
      .where(and(eq(authTokens.tradesmanId, tradesmanId), gte(authTokens.createdAt, since)));
    return result[0]?.count ?? 0;
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
}

export const storage = new DatabaseStorage();
