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
