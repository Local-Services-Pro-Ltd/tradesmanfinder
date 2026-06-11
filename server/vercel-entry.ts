// Vercel serverless entry. Exports an Express app handler instead of listening on a port.
import express from "express";
import type { Request, Response, NextFunction } from "express";
import { createServer } from "node:http";
import { registerRoutes } from "./routes";
import { micrositeMiddleware } from "./microsite-middleware";
import { registerMicrositeRoutes } from "./microsite-routes";
import { registerMainSiteRoutes } from "./main-sitemap";
import { registerMicrositeSpa } from "./microsite-spa";

// Mirror the rawBody hook from server/index.ts so the Stripe webhook handler
// can verify signatures. Without `verify`, express.json() consumes the stream
// and req.rawBody is undefined, which makes stripe.webhooks.constructEvent
// throw before we can read the signature.
declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

let appPromise: Promise<express.Express> | null = null;

function getApp(): Promise<express.Express> {
  if (!appPromise) {
    appPromise = (async () => {
      const app = express();
      app.use(
        express.json({
          verify: (req, _res, buf) => {
            (req as any).rawBody = buf;
          },
        }),
      );
      app.use(express.urlencoded({ extended: false }));

      // Mini-site host resolution must run before route handlers so /api/*
      // can read req.microsite for source attribution, and before the per-host
      // SPA SEO injector can intercept HTML responses.
      app.use(micrositeMiddleware);

      const httpServer = createServer(app);
      await registerRoutes(httpServer, app);

      // Main-host /sitemap.xml + /robots.txt. Must be registered BEFORE
      // registerMicrositeRoutes so the main-host (req.microsite == null)
      // check runs first; mini-site hosts fall through via next().
      registerMainSiteRoutes(app);

      // Per-host sitemap.xml + robots.txt for mini-sites. Registered after the
      // main API so /api/* takes precedence on every host.
      registerMicrositeRoutes(app);

      // SEO injector for mini-site hosts. In the Express server (server/index.ts)
      // this runs before serveStatic; in the Vercel serverless handler there is
      // no serveStatic (Vercel serves static assets), so this is the last
      // middleware before the error handler.
      registerMicrositeSpa(app);

      app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
        const status = err.status || err.statusCode || 500;
        const message = err.message || "Internal Server Error";
        console.error("Internal Server Error:", err);
        if (!res.headersSent) res.status(status).json({ message });
      });

      return app;
    })();
  }
  return appPromise;
}

export default async function handler(req: any, res: any) {
  const app = await getApp();
  return (app as any)(req, res);
}
