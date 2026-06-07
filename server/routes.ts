import type { Express } from "express";
import type { Server } from "node:http";
import { storage } from "./storage";
import {
  insertJobSchema, insertQuoteSchema, insertReviewSchema, insertTradesmanSchema,
  insertPartnerEnquirySchema, PARTNER_ENQUIRY_VERTICALS,
  insertPartnerSchema, insertPartnerPlacementSchema,
  PARTNER_ENQUIRY_STATUSES, PARTNER_STATUSES, PARTNER_SURFACES, PARTNER_COMMERCIAL_MODELS, PARTNER_VERTICALS,
} from "@shared/schema";
import { summarizeCards, autoEscalate, computeExpiry, isCardActive } from "@shared/cards";
import { sendCardIssuedEmail, sendCardRescindedEmail, sendNewLeadEmail, sendPartnerEnquiryNotification } from "./mailer";
import type { Tradesman, TradesmanCard } from "@shared/schema";
import { z } from "zod";
import { publicFormGuard } from "./spam-guard";
import { createLeadPackCheckoutSession } from "./stripe-checkout";
import { handleStripeWebhook } from "./stripe-webhook";
import { stripeIsConfigured } from "./stripe";

// Attach a `cardSummary` field to each tradesman so the UI can render badges
// and the API consumers can know who's suspended/banned.
async function attachCardSummary<T extends Tradesman>(t: T): Promise<T & { cardSummary: ReturnType<typeof summarizeCards>; cards: TradesmanCard[] }> {
  const cards = await storage.getCardsByTradesman(t.id);
  return { ...t, cards, cardSummary: summarizeCards(cards) };
}
async function attachCardSummaryMany<T extends Tradesman>(list: T[]): Promise<(T & { cardSummary: ReturnType<typeof summarizeCards>; cards: TradesmanCard[] })[]> {
  // Single batch fetch to avoid N+1
  const all = await storage.getAllCards();
  return list.map((t) => {
    const cards = all.filter((c) => c.tradesmanId === t.id);
    return { ...t, cards, cardSummary: summarizeCards(cards) };
  });
}

const ADMIN_KEY = process.env.ADMIN_KEY; if (!ADMIN_KEY) throw new Error('ADMIN_KEY environment variable is required');

// Schema is managed by Supabase migrations (apply_migration). No runtime migrate needed.
function migrate() {
  // no-op in Postgres deployment
}

function slugify(s: string) {
  return s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  migrate();

  // Admin auth: header x-admin-key OR ?key=ADMIN_KEY query param
  const isAdminReq = (req: any): boolean =>
    req.headers["x-admin-key"] === ADMIN_KEY || req.query?.key === ADMIN_KEY;

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
  // Red-carded (banned) tradesmen are hidden from public listings.
  // Pass ?includeBanned=1 (admin only) to override.
  app.get("/api/tradesmen", async (req, res) => {
    let list = await storage.getTradesmen();
    const category = req.query.category ? Number(req.query.category) : undefined;
    const area = req.query.area ? Number(req.query.area) : undefined;
    const includeBanned = req.query.includeBanned === "1" && isAdminReq(req);
    if (category !== undefined) {
      list = list.filter((t) => (JSON.parse(t.categories as string) as number[]).includes(category));
    }
    if (area !== undefined) {
      list = list.filter((t) => t.areaId === area);
    }
    const enriched = await attachCardSummaryMany(list);
    const visible = includeBanned ? enriched : enriched.filter((t) => !t.cardSummary.isPubliclyHidden);
    res.json(visible);
  });
  app.get("/api/tradesmen/by-slug/:slug", async (req, res) => {
    const t = await storage.getTradesmanBySlug(req.params.slug);
    if (!t) return res.status(404).json({ message: "Tradesman not found" });
    const enriched = await attachCardSummary(t);
    if (enriched.cardSummary.isPubliclyHidden) return res.status(404).json({ message: "Tradesman not found" });
    res.json(enriched);
  });
  app.get("/api/tradesmen/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid tradesman id" });
    const t = await storage.getTradesmanById(id);
    if (!t) return res.status(404).json({ message: "Tradesman not found" });
    const enriched = await attachCardSummary(t);
    const isAdmin = isAdminReq(req);
    if (enriched.cardSummary.isPubliclyHidden && !isAdmin) return res.status(404).json({ message: "Tradesman not found" });
    res.json(enriched);
  });
  // Pseudo-login by email — MVP shortcut, no real auth
  // Blocks login for red-carded tradesmen.
  app.get("/api/tradesmen/login/:email", async (req, res) => {
    const t = await storage.getTradesmanByEmail(req.params.email);
    if (!t) return res.status(404).json({ message: "No tradesman found with that email" });
    const enriched = await attachCardSummary(t);
    if (enriched.cardSummary.isLoginBlocked) {
      return res.status(403).json({ message: "This account has been permanently banned and can no longer access the dashboard.", banned: true });
    }
    res.json(enriched);
  });

  app.post("/api/tradesmen", publicFormGuard(), async (req, res) => {
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
      return res.json((await storage.getReviewsByTradesman(Number(req.query.tradesman))).filter((r) => r.status === "approved"));
    }
    res.json((await storage.getReviews()).filter((r) => r.status === "approved"));
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
  // Red-carded (banned) and currently-suspended-yellow tradesmen are excluded from matching.
  // Featured-status sort is suppressed for tradesmen with active yellows (Featured is revoked).
  app.post("/api/jobs", publicFormGuard(), async (req, res) => {
    try {
      const parsed = insertJobSchema.parse({
        ...req.body,
        photos: JSON.stringify(req.body.photos || []),
      });
      const job = await storage.createJob(parsed);

      const allRaw = await storage.getTradesmen();
      const all = await attachCardSummaryMany(allRaw);
      let candidates = all
        .filter((t) => (JSON.parse(t.categories as string) as number[]).includes(job.categoryId))
        .filter((t) => !t.cardSummary.isPubliclyHidden)                            // never match banned
        .filter((t) => !(t.cardSummary.suspendedUntil && t.cardSummary.suspendedUntil > Date.now())); // skip during yellow suspension
      // prefer same area, then fall back to all in category
      const inArea = candidates.filter((t) => t.areaId === job.areaId);
      const effectiveFeatured = (t: typeof all[number]) => t.cardSummary.isFeaturedRevoked ? 0 : Number(t.featured);
      const ranked = (inArea.length >= 3 ? inArea : candidates)
        .sort((a, b) => effectiveFeatured(b) - effectiveFeatured(a) || b.ratingAverage - a.ratingAverage)
        .slice(0, 3);

      const matched: number[] = [];
      for (const t of ranked) {
        await storage.createQuote({ jobId: job.id, tradesmanId: t.id, priceEstimate: "", message: "", status: "sent" });
        matched.push(t.id);
      }
      if (matched.length > 0) await storage.updateJob(job.id, { status: "matched" });

      // Notify matched tradespeople. One-shot lookups for trade name + area name
      // outside the loop avoid N+1 queries. Failures are logged but never block
      // the response — the homeowner's job has already been created.
      if (ranked.length > 0) {
        const [allCategories, allAreas] = await Promise.all([
          storage.getCategories(),
          storage.getAreas(),
        ]);
        const tradeName = allCategories.find((c) => c.id === job.categoryId)?.name ?? "General trade";
        const areaName = job.areaId != null ? allAreas.find((a) => a.id === job.areaId)?.name : undefined;
        const locationLabel = areaName ? `${areaName} (${job.postcode})` : job.postcode;
        await Promise.allSettled(ranked.map(async (t) => {
          if (!t.email) return;
          const result = await sendNewLeadEmail({
            to: t.email,
            businessName: t.businessName,
            ownerName: t.ownerName || t.businessName,
            jobTitle: job.title,
            postcode: locationLabel,
            trade: tradeName,
            urgency: job.urgency,
            budgetRange: job.budgetRange ?? "",
            description: job.description,
            // Correlation ids — persisted to email_log so the audit trail can
            // be filtered per job (admin debug) or per tradesperson
            // (dashboard 'recent leads sent to you' view).
            jobId: job.id,
            tradesmanId: t.id,
          });
          if (!result.ok) {
            console.error(`[mailer] new-lead send failed for tradesman ${t.id} (${t.email}):`, result.error);
          } else {
            console.log(`[mailer] new-lead sent to tradesman ${t.id} (Resend id: ${result.id})`);
          }
        }));
      }

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
  app.post("/api/quotes", publicFormGuard(), async (req, res) => {
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
    const myCards = await storage.getCardsByTradesman(id);
    const cardSummary = summarizeCards(myCards);
    const cardsWithActive = myCards.map((c) => ({ ...c, active: isCardActive(c) }));
    res.json({
      tradesman,
      leads,
      credits: credits?.balance ?? 0,
      transactions,
      reviews: myReviews,
      cards: cardsWithActive,
      cardSummary,
    });
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

  // ── Stripe Checkout for lead packs (PR-E2) ──
  // Client posts a tradesmanId + Stripe priceId, we return a hosted-checkout
  // URL to redirect to. Webhook handles credit grant after payment completes.
  app.post("/api/checkout/lead-pack", async (req, res) => {
    if (!stripeIsConfigured()) {
      res.status(503).json({ message: "Payments are temporarily unavailable. Please try again shortly." });
      return;
    }
    const schema = z.object({
      tradesmanId: z.number().int().positive(),
      priceId: z.string().min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
      return;
    }
    const { tradesmanId, priceId } = parsed.data;

    const tradesman = await storage.getTradesmanById(tradesmanId);
    if (!tradesman) {
      res.status(404).json({ message: "Tradesman not found" });
      return;
    }
    try {
      const result = await createLeadPackCheckoutSession({
        tradesmanId,
        tradesmanEmail: tradesman.email,
        stripeCustomerId: tradesman.stripeCustomerId ?? null,
        priceId,
      });
      res.json({ url: result.url, sessionId: result.sessionId, productKind: result.productKind });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Checkout failed";
      // Caller-error pricing mistakes → 400; everything else → 502 (Stripe).
      const isBadPrice = /not a valid lead pack/i.test(message);
      res.status(isBadPrice ? 400 : 502).json({ message });
    }
  });

  // ── Stripe Checkout return bounce ──
  // Stripe's 303 redirect to a hash-routed URL (/#/dashboard?...) intermittently
  // drops the fragment in some browsers, landing the user on a 404. To work
  // around that, Checkout sends users here first, and we 302 them onto the
  // canonical hash route with the query string preserved.
  app.get("/checkout/return", (req, res) => {
    const id = String(req.query.id ?? "").replace(/[^0-9]/g, "");
    const result = req.query.result === "cancel" ? "cancel" : "success";
    if (!id) {
      res.redirect(302, "/#/");
      return;
    }
    res.redirect(302, `/#/dashboard?id=${id}&purchase=${result}`);
  });

  // ── Stripe webhook (PR-E2) ──
  // POST /api/stripe/webhook — receives signed events from Stripe. The
  // signature is verified against req.rawBody (attached by express.json's
  // verify hook in server/index.ts).
  app.post("/api/stripe/webhook", (req, res) => {
    void handleStripeWebhook(req, res);
  });

  // ── Partner enquiries (inbound from /partners marketing page) ──
  // Tighter rate limit than other public forms (3/10min/IP) because partner
  // enquiries are low-volume by nature — anything more is probably a bot.
  app.post(
    "/api/partner-enquiries",
    publicFormGuard({ windowMs: 10 * 60 * 1000, max: 3 }),
    async (req, res) => {
      try {
        const parsed = insertPartnerEnquirySchema.parse(req.body);
        if (!(PARTNER_ENQUIRY_VERTICALS as readonly string[]).includes(parsed.vertical)) {
          return res.status(400).json({
            message: "Validation failed",
            errors: [{ path: ["vertical"], message: `Must be one of: ${PARTNER_ENQUIRY_VERTICALS.join(", ")}` }],
          });
        }
        const fwd = (req.headers["x-forwarded-for"] as string | undefined) || "";
        const requestIp = fwd.split(",")[0].trim() || req.socket.remoteAddress || null;
        const requestUserAgent = (req.headers["user-agent"] as string | undefined) || null;

        const enquiry = await storage.createPartnerEnquiry({
          ...parsed,
          requestIp,
          requestUserAgent,
        });

        // Fire-and-forget the ops notification. Storage row is the system of
        // record; if Resend fails the enquiry is still safely persisted and
        // visible in the admin enquiries view (PR-P3).
        sendPartnerEnquiryNotification({
          enquiryId: enquiry.id,
          companyName: enquiry.companyName,
          contactName: enquiry.contactName,
          email: enquiry.email,
          phone: enquiry.phone,
          vertical: enquiry.vertical,
          monthlyBudget: enquiry.monthlyBudget,
          message: enquiry.message,
        }).catch((err) => {
          console.error(`[partner-enquiry] notification email failed for #${enquiry.id}:`, err?.message);
        });

        // Return only the id + a confirmation flag — never echo the submission
        // (defends against reflected-XSS scenarios and reduces enumeration risk).
        res.status(201).json({ id: enquiry.id, ok: true });
      } catch (e) {
        if (e instanceof z.ZodError) {
          return res.status(400).json({ message: "Validation failed", errors: e.errors });
        }
        throw e;
      }
    },
  );

  // ── Reviews create ──
  app.post("/api/reviews", publicFormGuard(), async (req, res) => {
    try {
      const parsed = insertReviewSchema.parse(req.body);
      const created = await storage.createReview({ ...parsed, status: "pending" });
      // recompute rating from APPROVED reviews only (pending reviews are not public)
      const all = (await storage.getReviewsByTradesman(parsed.tradesmanId)).filter((r) => r.status === "approved");
      const avg = all.length ? all.reduce((s, r) => s + r.rating, 0) / all.length : 0;
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

  // ── Admin (guarded by x-admin-key header OR ?key=ADMIN_KEY query param) ──
  const requireAdmin = (req: any, res: any): boolean => {
    if (!isAdminReq(req)) {
      res.status(401).json({ message: "Unauthorized — admin key required" });
      return false;
    }
    return true;
  };

  app.get("/api/admin/overview", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const tradesmenRaw = await storage.getTradesmen();
    const tradesmen = await attachCardSummaryMany(tradesmenRaw);
    const jobs = await storage.getJobs();
    const quotes = await storage.getQuotes();
    const pending = tradesmen.filter((t) => !t.verified && !t.cardSummary.isPubliclyHidden);
    const banned = tradesmen.filter((t) => t.cardSummary.isPubliclyHidden).length;
    const carded = tradesmen.filter((t) => t.cardSummary.highestActive !== null).length;
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
        carded,
        banned,
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

  // ════ CARDS / MODERATION ════

  // Public: get cards + summary for a tradesman (used on profile + dashboard).
  // Returns full history (active and expired/rescinded) but never the private reasons unless admin.
  app.get("/api/tradesmen/:id/cards", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    const cards = await storage.getCardsByTradesman(id);
    const isAdmin = isAdminReq(req);
    const isOwner = req.query.email && (await storage.getTradesmanByEmail(String(req.query.email)))?.id === id;
    const showReasons = isAdmin || isOwner;
    const safe = cards.map((c) => ({
      ...c,
      reason: showReasons ? c.reason : null,
      rescindedReason: showReasons ? c.rescindedReason : null,
      rescindedBy: showReasons ? c.rescindedBy : null,
      issuedBy: showReasons ? c.issuedBy : null,
      active: isCardActive(c),
    }));
    res.json({ cards: safe, summary: summarizeCards(cards) });
  });

  // Admin: list moderation log (all actions; optional ?action= filter, e.g. ?action=notify for email-delivery records)
  app.get("/api/admin/moderation/log", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const action = req.query.action ? String(req.query.action) : undefined; const all = await storage.getModerationLog(200); const log = action ? all.filter((e) => e.action === action) : all;
    res.json(log);
  });

  // Admin: list all carded tradesmen with their active cards summary
  app.get("/api/admin/moderation/overview", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const allCards = await storage.getAllCards();
    const tradesmenList = await storage.getTradesmen();
    const byTradesmanId = new Map<number, typeof allCards>();
    for (const c of allCards) {
      const arr = byTradesmanId.get(c.tradesmanId) ?? [];
      arr.push(c);
      byTradesmanId.set(c.tradesmanId, arr);
    }
    const carded = tradesmenList
      .filter((t) => byTradesmanId.has(t.id))
      .map((t) => {
        const cards = byTradesmanId.get(t.id)!;
        return { tradesman: t, cards, summary: summarizeCards(cards) };
      });
    res.json(carded);
  });

  // Admin: issue a card
  // Body: { cardType?: 'warning'|'yellow'|'red'|'auto', reason: string, grossMisconduct?: boolean }
  // - cardType='auto' (or omitted) triggers football auto-escalation based on history.
  // - grossMisconduct=true forces an instant Red regardless of cardType (no expiry).
  app.post("/api/admin/tradesmen/:id/cards", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    const tradesman = await storage.getTradesmanById(id);
    if (!tradesman) return res.status(404).json({ message: "Tradesman not found" });

    const reason = String(req.body?.reason || "").trim();
    if (!reason) return res.status(400).json({ message: "A written reason is required." });
    if (reason.length < 5) return res.status(400).json({ message: "Reason must be at least 5 characters." });

    const grossMisconduct = !!req.body?.grossMisconduct;
    let cardType: "warning" | "yellow" | "red";
    const requested = req.body?.cardType;

    if (grossMisconduct) {
      cardType = "red";
    } else if (!requested || requested === "auto") {
      const existing = await storage.getCardsByTradesman(id);
      cardType = autoEscalate(existing).cardType;
    } else if (["warning", "yellow", "red"].includes(requested)) {
      cardType = requested as "warning" | "yellow" | "red";
    } else {
      return res.status(400).json({ message: "Invalid cardType" });
    }

    const now = Date.now();
    const expiresAt = computeExpiry(cardType, grossMisconduct, now);
    const adminId = String(req.body?.adminId || req.headers["x-admin-id"] || "admin");

    const created = await storage.createCard(
      { tradesmanId: id, cardType, reason, grossMisconduct, issuedBy: adminId },
      now,
      expiresAt,
    );

    await storage.logModeration({
      tradesmanId: id,
      cardId: created.id,
      action: "issue",
      cardType,
      reason: grossMisconduct ? `[GROSS MISCONDUCT] ${reason}` : reason,
      adminId,
    });

    // Side-effect: if card is Red, revoke Featured to prevent stale highlight.
    if (cardType === "red" || cardType === "yellow") {
      if (tradesman.featured) await storage.updateTradesman(id, { featured: false });
    }

    const updatedCards = await storage.getCardsByTradesman(id);
    const summary = summarizeCards(updatedCards);

    // Send notification email and record the Resend result in the moderation log for audit/appeal traceability.
    if (tradesman.email) {
      const issuedNotify = await sendCardIssuedEmail({
        to: tradesman.email,
        businessName: tradesman.businessName,
        ownerName: tradesman.ownerName || tradesman.businessName,
        card: created,
        suspendedUntil: summary.suspendedUntil,
      });       await storage.logModeration({ tradesmanId: id, cardId: created.id, action: "notify", cardType, reason: issuedNotify.ok ? `Card-issued email sent (Resend id: ${issuedNotify.id})` : `Card-issued email FAILED: ${issuedNotify.error}`, adminId });       if (!issuedNotify.ok) console.error("[mailer] card-issued send failed:", issuedNotify.error);
    }

    res.status(201).json({ card: created, summary });
  });

  // Admin: rescind a card
  app.post("/api/admin/cards/:cardId/rescind", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const cardId = Number(req.params.cardId);
    if (!Number.isFinite(cardId)) return res.status(400).json({ message: "Invalid card id" });
    const card = await storage.getCardById(cardId);
    if (!card) return res.status(404).json({ message: "Card not found" });
    if (card.rescindedAt) return res.status(400).json({ message: "Card already rescinded" });
    const reason = String(req.body?.reason || "").trim();
    if (!reason || reason.length < 5) return res.status(400).json({ message: "Rescind reason must be at least 5 characters." });

    const adminId = String(req.body?.adminId || req.headers["x-admin-id"] || "admin");
    const now = Date.now();
    const updated = await storage.rescindCard(cardId, adminId, reason, now);
    await storage.logModeration({
      tradesmanId: card.tradesmanId,
      cardId,
      action: "rescind",
      cardType: card.cardType,
      reason,
      adminId,
    });

    // Notify the tradesman that the card has been rescinded.
    const tm = await storage.getTradesmanById(card.tradesmanId);
    if (tm?.email && updated) {
      const rescindNotify = await sendCardRescindedEmail({
        to: tm.email,
        businessName: tm.businessName,
        ownerName: tm.ownerName || tm.businessName,
        card: updated,
      });       await storage.logModeration({ tradesmanId: card.tradesmanId, cardId, action: "notify", cardType: card.cardType, reason: rescindNotify.ok ? `Card-rescinded email sent (Resend id: ${rescindNotify.id})` : `Card-rescinded email FAILED: ${rescindNotify.error}`, adminId });       if (!rescindNotify.ok) console.error("[mailer] card-rescinded send failed:", rescindNotify.error);
    }

    res.json(updated);
  });

  // — Admin: list reviews for moderation (?status=pending|approved|rejected, default all) —
app.get("/api/admin/reviews", async (req, res) => {
if (!requireAdmin(req, res)) return;
const status = req.query.status ? String(req.query.status) : undefined;
const all = await storage.getReviews();
res.json(status ? all.filter((r) => r.status === status) : all);
});

  // — Admin: approve or reject a review (recomputes tradesman rating from approved reviews) —
app.post("/api/admin/reviews/:id/moderate", async (req, res) => {
if (!requireAdmin(req, res)) return;
const id = Number(req.params.id);
if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid review id" });
const action = String(req.body?.action || "");
if (action !== "approve" && action !== "reject") return res.status(400).json({ message: "action must be 'approve' or 'reject'" });
const review = await storage.getReviewById(id);
if (!review) return res.status(404).json({ message: "Review not found" });
const newStatus = action === "approve" ? "approved" : "rejected";
const updated = await storage.updateReview(id, { status: newStatus, verified: action === "approve" });
// recompute tradesman rating from approved reviews only
const approved = (await storage.getReviewsByTradesman(review.tradesmanId)).filter((r) => r.status === "approved");
const avg = approved.length ? approved.reduce((s, r) => s + r.rating, 0) / approved.length : 0;
await storage.updateTradesman(review.tradesmanId, { ratingAverage: Math.round(avg * 10) / 10, ratingCount: approved.length });
res.json(updated);
});

  // ════ ADMIN PARTNER PROGRAMME (PR-P3) ════

  // ── Enquiries ──

  // GET /api/admin/partner-enquiries?status=new  — list, optional status filter, newest first
  app.get('/api/admin/partner-enquiries', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const status = req.query.status ? String(req.query.status) : undefined;
    const enquiries = await storage.getPartnerEnquiriesByStatus(status, 100);
    res.json(enquiries);
  });

  // GET /api/admin/partner-enquiries/:id  — single enquiry
  app.get('/api/admin/partner-enquiries/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid id' });
    const enquiry = await storage.getPartnerEnquiryById(id);
    if (!enquiry) return res.status(404).json({ message: 'Enquiry not found' });
    res.json(enquiry);
  });

  // POST /api/admin/partner-enquiries/:id/status  { status }
  app.post('/api/admin/partner-enquiries/:id/status', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid id' });
    const statusVal = String(req.body?.status || '');
    if (!(PARTNER_ENQUIRY_STATUSES as readonly string[]).includes(statusVal)) {
      return res.status(400).json({ message: `status must be one of: ${PARTNER_ENQUIRY_STATUSES.join(', ')}` });
    }
    const enquiry = await storage.getPartnerEnquiryById(id);
    if (!enquiry) return res.status(404).json({ message: 'Enquiry not found' });
    const updated = await storage.updatePartnerEnquiryStatus(id, statusVal);
    res.json(updated);
  });

  // POST /api/admin/partner-enquiries/:id/convert  { slug, billingEmail?, billingContact?, notes? }
  app.post('/api/admin/partner-enquiries/:id/convert', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid id' });

    const slugRaw = String(req.body?.slug || '').trim();
    const slugSchema = z.string().min(2).max(60).regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, numbers, and hyphens only');
    const slugParse = slugSchema.safeParse(slugRaw);
    if (!slugParse.success) {
      return res.status(400).json({ message: 'Validation failed', errors: slugParse.error.errors });
    }

    try {
      const result = await storage.promoteEnquiryToPartner(id, {
        slug: slugParse.data,
        billingEmail: req.body?.billingEmail ?? null,
        billingContact: req.body?.billingContact ?? null,
        notes: req.body?.notes ?? null,
      });
      res.status(201).json(result);
    } catch (err: any) {
      if (err?.code === 'SLUG_CONFLICT') return res.status(409).json({ message: 'Slug already in use — choose a different one' });
      if (err?.message === 'Enquiry not found') return res.status(404).json({ message: 'Enquiry not found' });
      throw err;
    }
  });

  // ── Partners CRUD ──

  // GET /api/admin/partners
  app.get('/api/admin/partners', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const all = await storage.getPartners();
    res.json(all);
  });

  // GET /api/admin/partners/:id  — full record with placements + event counts
  app.get('/api/admin/partners/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid id' });
    const partner = await storage.getPartnerById(id);
    if (!partner) return res.status(404).json({ message: 'Partner not found' });
    const placements = await storage.getPartnerPlacementsByPartner(id);
    const recentPlacements = placements.slice(0, 20);
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const eventCounts = await storage.getPartnerEventCountsByPartner(id, thirtyDaysAgo);
    res.json({ ...partner, recentPlacements, eventCounts });
  });

  // POST /api/admin/partners  — create directly
  app.post('/api/admin/partners', async (req, res) => {
    if (!requireAdmin(req, res)) return;

    const slugRaw = String(req.body?.slug || '').trim();
    const slugSchema = z.string().min(2).max(60).regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, numbers, and hyphens only');
    const slugParse = slugSchema.safeParse(slugRaw);
    if (!slugParse.success) {
      return res.status(400).json({ message: 'Validation failed', errors: slugParse.error.errors });
    }

    const verticalVal = String(req.body?.vertical || '');
    if (!(PARTNER_VERTICALS as readonly string[]).includes(verticalVal)) {
      return res.status(400).json({ message: `vertical must be one of: ${PARTNER_VERTICALS.join(', ')}` });
    }

    const nameVal = String(req.body?.name || '').trim();
    if (!nameVal) return res.status(400).json({ message: 'name is required' });

    const existing = await storage.getPartnerBySlug(slugParse.data);
    if (existing) return res.status(409).json({ message: 'Slug already in use' });

    const partner = await storage.createPartner({
      slug: slugParse.data,
      name: nameVal,
      vertical: verticalVal,
      status: req.body?.status && (PARTNER_STATUSES as readonly string[]).includes(String(req.body.status)) ? String(req.body.status) : 'inactive',
      billingEmail: req.body?.billingEmail ?? null,
      billingContact: req.body?.billingContact ?? null,
      notes: req.body?.notes ?? null,
    });
    res.status(201).json(partner);
  });

  // PATCH /api/admin/partners/:id  — partial update
  app.patch('/api/admin/partners/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid id' });
    const partner = await storage.getPartnerById(id);
    if (!partner) return res.status(404).json({ message: 'Partner not found' });

    const patch: Record<string, unknown> = {};
    if (req.body?.name !== undefined) patch.name = String(req.body.name).trim();
    if (req.body?.status !== undefined) {
      if (!(PARTNER_STATUSES as readonly string[]).includes(String(req.body.status))) {
        return res.status(400).json({ message: `status must be one of: ${PARTNER_STATUSES.join(', ')}` });
      }
      patch.status = String(req.body.status);
    }
    if (req.body?.billingEmail !== undefined) patch.billingEmail = req.body.billingEmail;
    if (req.body?.billingContact !== undefined) patch.billingContact = req.body.billingContact;
    if (req.body?.notes !== undefined) patch.notes = req.body.notes;

    const updated = await storage.updatePartner(id, patch);
    res.json(updated);
  });

  // DELETE /api/admin/partners/:id
  app.delete('/api/admin/partners/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid id' });
    const result = await storage.deletePartner(id);
    if (!result.ok) return res.status(409).json({ message: result.reason });
    res.status(204).end();
  });

  // ── Placements CRUD ──

  // GET /api/admin/partners/:partnerId/placements
  app.get('/api/admin/partners/:partnerId/placements', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const partnerId = Number(req.params.partnerId);
    if (!Number.isFinite(partnerId)) return res.status(400).json({ message: 'Invalid partnerId' });
    const placements = await storage.getPartnerPlacementsByPartner(partnerId);
    res.json(placements);
  });

  // POST /api/admin/partners/:partnerId/placements
  app.post('/api/admin/partners/:partnerId/placements', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const partnerId = Number(req.params.partnerId);
    if (!Number.isFinite(partnerId)) return res.status(400).json({ message: 'Invalid partnerId' });
    const partner = await storage.getPartnerById(partnerId);
    if (!partner) return res.status(404).json({ message: 'Partner not found' });

    const surfaceVal = String(req.body?.surface || '');
    if (!(PARTNER_SURFACES as readonly string[]).includes(surfaceVal)) {
      return res.status(400).json({ message: `surface must be one of: ${PARTNER_SURFACES.join(', ')}` });
    }
    const modelVal = String(req.body?.commercialModel || '');
    if (!(PARTNER_COMMERCIAL_MODELS as readonly string[]).includes(modelVal)) {
      return res.status(400).json({ message: `commercialModel must be one of: ${PARTNER_COMMERCIAL_MODELS.join(', ')}` });
    }
    const ratePence = Number(req.body?.ratePence);
    if (!Number.isFinite(ratePence) || ratePence < 0) return res.status(400).json({ message: 'ratePence must be a non-negative integer' });
    const activeFrom = Number(req.body?.activeFrom);
    if (!Number.isFinite(activeFrom)) return res.status(400).json({ message: 'activeFrom is required (unix ms)' });

    const placement = await storage.createPartnerPlacement({
      partnerId,
      surface: surfaceVal,
      commercialModel: modelVal,
      ratePence: Math.floor(ratePence),
      rateCapPence: req.body?.rateCapPence != null ? Math.floor(Number(req.body.rateCapPence)) : null,
      categoryFilter: req.body?.categoryFilter ?? '[]',
      areaFilter: req.body?.areaFilter ?? '[]',
      priority: req.body?.priority != null ? Number(req.body.priority) : 100,
      activeFrom,
      activeTo: req.body?.activeTo != null ? Number(req.body.activeTo) : null,
      creativeHtml: req.body?.creativeHtml ?? null,
      creativeUrl: req.body?.creativeUrl ?? null,
    });
    res.status(201).json(placement);
  });

  // PATCH /api/admin/placements/:id
  app.patch('/api/admin/placements/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid id' });
    const placement = await storage.getPartnerPlacementById(id);
    if (!placement) return res.status(404).json({ message: 'Placement not found' });

    const patch: Record<string, unknown> = {};
    if (req.body?.surface !== undefined) {
      if (!(PARTNER_SURFACES as readonly string[]).includes(String(req.body.surface))) {
        return res.status(400).json({ message: `surface must be one of: ${PARTNER_SURFACES.join(', ')}` });
      }
      patch.surface = String(req.body.surface);
    }
    if (req.body?.commercialModel !== undefined) {
      if (!(PARTNER_COMMERCIAL_MODELS as readonly string[]).includes(String(req.body.commercialModel))) {
        return res.status(400).json({ message: `commercialModel must be one of: ${PARTNER_COMMERCIAL_MODELS.join(', ')}` });
      }
      patch.commercialModel = String(req.body.commercialModel);
    }
    const patchFields = ['ratePence', 'rateCapPence', 'categoryFilter', 'areaFilter', 'priority', 'activeFrom', 'activeTo', 'creativeHtml', 'creativeUrl'] as const;
    for (const field of patchFields) {
      if (req.body?.[field] !== undefined) patch[field] = req.body[field];
    }

    const updated = await storage.updatePartnerPlacement(id, patch);
    res.json(updated);
  });

  // DELETE /api/admin/placements/:id  — hard delete
  app.delete('/api/admin/placements/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid id' });
    const placement = await storage.getPartnerPlacementById(id);
    if (!placement) return res.status(404).json({ message: 'Placement not found' });
    await storage.deletePartnerPlacement(id);
    res.status(204).end();
  });

  // ── Events (read-only) ──

  // GET /api/admin/partners/:partnerId/events?eventType=&from=&to=&limit=200
  app.get('/api/admin/partners/:partnerId/events', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const partnerId = Number(req.params.partnerId);
    if (!Number.isFinite(partnerId)) return res.status(400).json({ message: 'Invalid partnerId' });
    const filters: { eventType?: string; from?: number; to?: number; limit?: number } = {};
    if (req.query.eventType) filters.eventType = String(req.query.eventType);
    if (req.query.from) filters.from = Number(req.query.from);
    if (req.query.to) filters.to = Number(req.query.to);
    filters.limit = req.query.limit ? Math.min(Number(req.query.limit), 500) : 200;
    const events = await storage.getPartnerEventsByPartner(partnerId, filters);
    res.json(events);
  });

  // ── Invoices (read-only stub) ──

  // GET /api/admin/partners/:partnerId/invoices
  app.get('/api/admin/partners/:partnerId/invoices', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const partnerId = Number(req.params.partnerId);
    if (!Number.isFinite(partnerId)) return res.status(400).json({ message: 'Invalid partnerId' });
    const invoices = await storage.getPartnerInvoicesByPartner(partnerId);
    res.json(invoices);
  });

  return httpServer;
}
