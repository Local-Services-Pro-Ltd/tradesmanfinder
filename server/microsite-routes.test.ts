/**
 * Tests for the per-host /sitemap.xml and /robots.txt registrations.
 * Boots a minimal express app on an ephemeral port, fires real HTTP
 * requests with a Host header, and asserts per-host responses.
 *
 * We avoid supertest to keep the dependency surface tight — the only
 * extra cost is binding a listener for each describe block, which is
 * cheap because each app shuts down at the end of the suite.
 */

import { afterAll, describe, expect, it } from 'vitest';
import express, { type Express } from 'express';
import http from 'node:http';
import { micrositeMiddleware } from './microsite-middleware';
import { registerMicrositeRoutes } from './microsite-routes';

function buildApp(): Express {
  const app = express();
  app.use(micrositeMiddleware);
  registerMicrositeRoutes(app);
  // Fallback main-site handlers (microsite middleware passes through for the main host).
  app.get('/robots.txt', (_req, res) => res.type('text/plain').send('main-site-robots'));
  app.get('/sitemap.xml', (_req, res) => res.status(404).end());
  return app;
}

type Resp = { status: number; headers: http.IncomingHttpHeaders; body: string };

function startServer(app: Express): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

function req(port: number, path: string, host: string): Promise<Resp> {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { hostname: '127.0.0.1', port, path, method: 'GET', headers: { Host: host } },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    r.on('error', reject);
    r.end();
  });
}

let app: Express;
let server: { port: number; close: () => Promise<void> };

async function ensureServer() {
  if (!server) {
    app = buildApp();
    server = await startServer(app);
  }
  return server;
}

afterAll(async () => {
  if (server) await server.close();
});

describe('microsite /robots.txt', () => {
  it('serves an Allow-all robots with per-host sitemap for a geo-trade host', async () => {
    const { port } = await ensureServer();
    const res = await req(port, '/robots.txt', 'blackheathbuilders.co.uk');
    expect(res.status).toBe(200);
    expect(res.body).toContain('User-agent: *');
    expect(res.body).toContain('Allow: /');
    expect(res.body).toContain('Sitemap:');
    expect(res.body).toContain('blackheathbuilders.co.uk/sitemap.xml');
  });

  it('falls through to the main robots on tradesmanfinder.com', async () => {
    const { port } = await ensureServer();
    const res = await req(port, '/robots.txt', 'tradesmanfinder.com');
    expect(res.status).toBe(200);
    expect(res.body).toBe('main-site-robots');
  });
});

describe('microsite /sitemap.xml', () => {
  it('emits a single-URL sitemap for a geo-trade host', async () => {
    const { port } = await ensureServer();
    const res = await req(port, '/sitemap.xml', 'blackheathbuilders.co.uk');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/xml/);
    expect(res.body).toContain('<?xml version="1.0"');
    expect(res.body).toContain('<urlset');
    expect(res.body).toContain('blackheathbuilders.co.uk/');
  });

  it('emits the canonical URL for duplicate-canonical hosts (no 301 on sitemap)', async () => {
    const { port } = await ensureServer();
    const res = await req(port, '/sitemap.xml', 'blackheathbuilder.co.uk');
    expect(res.status).toBe(200);
    expect(res.body).toContain('https://blackheathbuilders.co.uk/');
  });

  it('falls through (404) on the main domain', async () => {
    const { port } = await ensureServer();
    const res = await req(port, '/sitemap.xml', 'tradesmanfinder.com');
    expect(res.status).toBe(404);
  });
});

describe('redirect-kind middleware vs sitemap/robots', () => {
  it('301-redirects all paths on brand-piggyback hosts (incl. /robots.txt)', async () => {
    // Brand-piggyback domains never serve content — middleware 301s
    // everything to the canonical site so they can't be crawled separately.
    const { port } = await ensureServer();
    const res = await req(port, '/robots.txt', 'ikeahandyman.co.uk');
    expect(res.status).toBe(301);
    expect(res.headers.location).toMatch(/^https:\/\/tradesmanfinder\.com/);
  });
});
