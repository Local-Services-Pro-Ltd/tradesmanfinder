import type { Express } from "express";
import type { Server } from "node:http";
import { storage } from "./storage";
import {
  insertJobSchema, insertQuoteSchema, insertReviewSchema, insertTradesmanSchema,
} from "@shared/schema";
import { z } from "zod";

const ADMIN_KEY = process.env.ADMIN_KEY || "tradesman-admin-2024";

// Schema is managed by Supabase migrations (apply_migration). No runtime migrate needed.
function migrate() {
  // no-op in Postgres deployment
}

function slugify(s: string) {
  return s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  migrate();

  // ── Categories ──
  app.get("/api/categories", async (_req, res) => {
    res.json(await storage.getCategories());
  });
  app.get("/api/categories/:slug", async (req, res) => {
    const c = await storage.getCategoryBySlug(req.params.slug);
    if (!c) return res.status(404).json({ message: "Category not found" });
    res.json(c);
  });

  // ── Areas ──
  app.get("/api/areas", async (_req, res) => {
    res.json(await storage.getAreas());
  });
  app.get("/api/areas/:slug", async (req, res) => {
    const a = await storage.getAreaBySlug(req.params.slug);
    if (!a) return res.status(404).json({ message: "Area not found" });
    res.json(a);
  });

  // ── Tradesmen ──
  // Optional filters: ?category=<id>&area=<id>
  app.get("/api/tradesmen", async (req, res) => {
    let list = await storage.getTradesmen();
    const category = req.query.category ? Number(req.query.category) : undefined;
    const area = req.query.area ? Number(req.query.area) : undefined;
    if (category !== undefined) {
      list = list.filter((t) => (JSON.parse(t.categories as string) as number[]).includes(category));
    }
    if (area !== undefined) {
      list = list.filter((t) => t.areaId === area);
    }
    res.json(list);
  });
  app.get("/api/tradesmen/by-slug/:slug", async (req, res) => {
    const t = await storage.getTradesmanBySlug(req.params.slug);
    if (!t) return res.status(404).json({ message: "Tradesman not found" });
    res.json(t);
  });
  app.get("/api/tradesmen/:id", async (req, res) => {
    const t = await storage.getTradesmanById(Number(req.params.id));
    if (!t) return res.status(404).json({ message: "Tradesman not found" });
    res.json(t);
  });
  // Pseudo-login by email — MVP shortcut, no real auth
  app.get("/api/tradesmen/login/:email", async (req, res) => {
    const t = await storage.getTradesmanByEmail(req.params.email);
    if (!t) return res.status(404).json({ message: "No tradesman found with that email" });
    res.json(t);
  });

  app.post("/api/tradesmen", async (req, res) => {
    try {
      const parsed = insertTradesmanSchema.parse({
        ...req.body,
        slug: slugify(req.body.businessName || "tradesman-" + Date.now()),
        gallery: JSON.stringify(req.body.gallery || []),
        categories: JSON.stringify(req.body.categories || []),
        heroImageUrl: req.body.heroImageUrl || "/assets/hero-builder.png",
        verified: false,
        licensed: !!req.body.licensed,
        insured: !!req.body.insured,
        featured: false,
      });
      const created = await storage.createTradesman(parsed);
      await storage.setCredits(created.id, 3);
      await storage.createCreditTransaction({ tradesmanId: created.id, amount: 3, reason: "New member welcome credits", relatedJobId: null });
      res.status(201).json(created);
    } catch (e) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: "Validation failed", errors: e.errors });
      throw e;
    }
  });

  app.patch("/api/tradesmen/:id", async (req, res) => {
    const updated = await storage.updateTradesman(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Tradesman not found" });
    res.json(updated);
  });

  // ── Reviews ──
  app.get("/api/reviews", async (req, res) => {
    if (req.query.tradesman) {
      return res.json(await storage.getReviewsByTradesman(Number(req.query.tradesman)));
    }
    res.json(await storage.getReviews());
  });

  // ── Jobs ──
  app.get("/api/jobs", async (_req, res) => {
    res.json(await storage.getJobs());
  });
  app.get("/api/jobs/:id", async (req, res) => {
    const j = await storage.getJobById(Number(req.params.id));
    if (!j) return res.status(404).json({ message: "Job not found" });
    res.json(j);
  });

  // Post a job → auto-match top 3 tradesmen in category (+ area if available), create quote placeholders
  app.post("/api/jobs", async (req, res) => {
    try {
      const parsed = insertJobSchema.parse({
        ...req.body,
        photos: JSON.stringify(req.body.photos || []),
      });
      const job = await storage.createJob(parsed);

      const all = await storage.getTradesmen();
      let candidates = all.filter((t) =>
        (JSON.parse(t.categories as string) as number[]).includes(job.categoryId)
      );
      // prefer same area, then fall back to all in category
      const inArea = candidates.filter((t) => t.areaId === job.areaId);
      const ranked = (inArea.length >= 3 ? inArea : candidates)
        .sort((a, b) => Number(b.featured) - Number(a.featured) || b.ratingAverage - a.ratingAverage)
        .slice(0, 3);

      const matched: number[] = [];
      for (const t of ranked) {
        await storage.createQuote({ jobId: job.id, tradesmanId: t.id, priceEstimate: "", message: "", status: "sent" });
        matched.push(t.id);
      }
      if (matched.length > 0) await storage.updateJob(job.id, { status: "matched" });

      const matchedTradesmen = ranked.map((t) => ({ id: t.id, businessName: t.businessName, slug: t.slug, ratingAverage: t.ratingAverage, responseTimeMinutes: t.responseTimeMinutes }));
      res.status(201).json({ job: await storage.getJobById(job.id), matched: matchedTradesmen });
    } catch (e) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: "Validation failed", errors: e.errors });
      throw e;
    }
  });

  // ── Quotes ──
  app.get("/api/quotes", async (req, res) => {
    if (req.query.tradesman) return res.json(await storage.getQuotesByTradesman(Number(req.query.tradesman)));
    if (req.query.job) return res.json(await storage.getQuotesByJob(Number(req.query.job)));
    res.json(await storage.getQuotes());
  });
  app.post("/api/quotes", async (req, res) => {
    try {
      const parsed = insertQuoteSchema.parse(req.body);
      const created = await storage.createQuote(parsed);
      res.status(201).json(created);
    } catch (e) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: "Validation failed", errors: e.errors });
      throw e;
    }
  });

  // ── Dashboard: leads (jobs matched to a tradesman) ──
  app.get("/api/dashboard/:tradesmanId", async (req, res) => {
    const id = Number(req.params.tradesmanId);
    const tradesman = await storage.getTradesmanById(id);
    if (!tradesman) return res.status(404).json({ message: "Tradesman not found" });
    const myQuotes = await storage.getQuotesByTradesman(id);
    const leads = [];
    for (const q of myQuotes) {
      const job = await storage.getJobById(q.jobId);
      if (job) leads.push({ quote: q, job });
    }
    const credits = await storage.getCredits(id);
    const transactions = await storage.getCreditTransactions(id);
    const myReviews = await storage.getReviewsByTradesman(id);
    res.json({ tradesman, leads, credits: credits?.balance ?? 0, transactions, reviews: myReviews });
  });

  // ── Credits (fake Stripe — adds credits directly). TODO: real Stripe. ──
  app.post("/api/credits/buy", async (req, res) => {
    const { tradesmanId, credits, reason } = req.body as { tradesmanId: number; credits: number; reason?: string };
    const existing = await storage.getCredits(tradesmanId);
    const newBalance = (existing?.balance ?? 0) + credits;
    const updated = await storage.setCredits(tradesmanId, newBalance);
    await storage.createCreditTransaction({ tradesmanId, amount: credits, reason: reason || `Bought ${credits} credits`, relatedJobId: null });
    res.json({ balance: updated.balance });
  });

  // ── Reviews create ──
  app.post("/api/reviews", async (req, res) => {
    try {
      const parsed = insertReviewSchema.parse(req.body);
      const created = await storage.createReview(parsed);
      // recompute rating
      const all = await storage.getReviewsByTradesman(parsed.tradesmanId);
      const avg = all.reduce((s, r) => s + r.rating, 0) / all.length;
      await storage.updateTradesman(parsed.tradesmanId, { ratingAverage: Math.round(avg * 10) / 10, ratingCount: all.length });
      res.status(201).json(created);
    } catch (e) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: "Validation failed", errors: e.errors });
      throw e;
    }
  });

  // ── Stats (homepage trust strip + admin) ──
  app.get("/api/stats", async (_req, res) => {
    const tradesmen = await storage.getTradesmen();
    const jobs = await storage.getJobs();
    const reviews = await storage.getReviews();
    const verified = tradesmen.filter((t) => t.verified).length;
    const avgResponse = Math.round(tradesmen.reduce((s, t) => s + t.responseTimeMinutes, 0) / (tradesmen.length || 1));
    res.json({
      tradesmen: tradesmen.length,
      verified,
      jobs: jobs.length,
      reviews: reviews.length,
      avgResponseMinutes: avgResponse,
    });
  });

  // ── Admin (guarded by ?key=ADMIN_KEY) ──
  const requireAdmin = (req: any, res: any): boolean => {
    if (req.query.key !== ADMIN_KEY && req.headers["x-admin-key"] !== ADMIN_KEY) {
      res.status(401).json({ message: "Unauthorized — admin key required" });
      return false;
    }
    return true;
  };

  app.get("/api/admin/overview", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const tradesmen = await storage.getTradesmen();
    const jobs = await storage.getJobs();
    const quotes = await storage.getQuotes();
    const pending = tradesmen.filter((t) => !t.verified);
    // revenue model: each sent quote = lead at £5 notional credit value
    const leadRevenue = quotes.length * 5;
    res.json({
      tradesmen, jobs, pending,
      stats: {
        totalTradesmen: tradesmen.length,
        verified: tradesmen.filter((t) => t.verified).length,
        pending: pending.length,
        totalJobs: jobs.length,
        openJobs: jobs.filter((j) => j.status === "open").length,
        totalLeads: quotes.length,
        leadRevenue,
      },
    });
  });

  app.post("/api/admin/tradesmen/:id/verify", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const updated = await storage.updateTradesman(Number(req.params.id), { verified: true, licensed: true });
    res.json(updated);
  });
  app.post("/api/admin/tradesmen/:id/feature", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const t = await storage.getTradesmanById(Number(req.params.id));
    const updated = await storage.updateTradesman(Number(req.params.id), { featured: !t?.featured });
    res.json(updated);
  });

  return httpServer;
}
