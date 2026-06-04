// Vercel serverless entry. Exports an Express app handler instead of listening on a port.
import express from "express";
import type { Request, Response, NextFunction } from "express";
import { createServer } from "node:http";
import { registerRoutes } from "./routes";

let appPromise: Promise<express.Express> | null = null;

function getApp(): Promise<express.Express> {
  if (!appPromise) {
    appPromise = (async () => {
      const app = express();
      app.use(express.json());
      app.use(express.urlencoded({ extended: false }));

      const httpServer = createServer(app);
      await registerRoutes(httpServer, app);

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
