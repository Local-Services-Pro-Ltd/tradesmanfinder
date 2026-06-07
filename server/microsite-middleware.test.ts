/**
 * Tests for the mini-site middleware: host resolution, redirect kinds,
 * duplicate-canonical 301, and req.microsite attachment. Uses a stub
 * express-compatible req/res/next so we don't have to spin up a real server.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  micrositeMiddleware,
  readRequestHost,
} from './microsite-middleware';

type StubReq = {
  hostname?: string;
  headers: Record<string, string | undefined>;
  path: string;
  originalUrl: string;
  protocol?: string;
  microsite?: unknown;
};

type StubRes = {
  locals: Record<string, unknown>;
  redirect: ReturnType<typeof vi.fn>;
};

function makeReq(over: Partial<StubReq> = {}): StubReq {
  return {
    hostname: over.hostname,
    headers: over.headers ?? {},
    path: over.path ?? '/',
    originalUrl: over.originalUrl ?? '/',
    protocol: over.protocol ?? 'https',
  };
}

function makeRes(): StubRes {
  return { locals: {}, redirect: vi.fn() };
}

describe('readRequestHost', () => {
  it('prefers req.hostname when present', () => {
    expect(readRequestHost({ hostname: 'foo.com', headers: {} })).toBe('foo.com');
  });
  it('falls back to host header', () => {
    expect(readRequestHost({ hostname: undefined as unknown as string, headers: { host: 'bar.com' } })).toBe('bar.com');
  });
  it('returns undefined for nothing', () => {
    expect(readRequestHost({ hostname: undefined as unknown as string, headers: {} })).toBeUndefined();
  });
});

describe('micrositeMiddleware', () => {
  it('passes through main domain with microsite=null', () => {
    const req = makeReq({ hostname: 'tradesmanfinder.com' });
    const res = makeRes();
    const next = vi.fn();
    micrositeMiddleware(req as never, res as never, next);
    expect(next).toHaveBeenCalledOnce();
    expect((req as unknown as { microsite: unknown }).microsite).toBeNull();
    expect(res.locals.microsite).toBeNull();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it('attaches microsite for a known geo-trade host', () => {
    const req = makeReq({ hostname: 'blackheathbuilders.co.uk' });
    const res = makeRes();
    const next = vi.fn();
    micrositeMiddleware(req as never, res as never, next);
    expect(next).toHaveBeenCalledOnce();
    expect((req as unknown as { microsite: { host: string } }).microsite.host).toBe('blackheathbuilders.co.uk');
  });

  it('301-redirects brand-piggyback (redirect kind) preserving path', () => {
    const req = makeReq({
      hostname: 'ikeahandyman.co.uk',
      originalUrl: '/some/deep/path?x=1',
      path: '/some/deep/path',
    });
    const res = makeRes();
    const next = vi.fn();
    micrositeMiddleware(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(301, 'https://tradesmanfinder.com/some/deep/path?x=1');
  });

  it('301-redirects duplicate-canonical (blackheathbuilder → blackheathbuilders)', () => {
    const req = makeReq({
      hostname: 'blackheathbuilder.co.uk',
      originalUrl: '/?q=foo',
      path: '/',
      headers: { 'x-forwarded-proto': 'https' },
    });
    const res = makeRes();
    const next = vi.fn();
    micrositeMiddleware(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(301, 'https://blackheathbuilders.co.uk/?q=foo');
  });

  it('does NOT redirect canonical on /api requests (API stays host-stable)', () => {
    const req = makeReq({
      hostname: 'blackheathbuilder.co.uk',
      originalUrl: '/api/categories',
      path: '/api/categories',
    });
    const res = makeRes();
    const next = vi.fn();
    micrositeMiddleware(req as never, res as never, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it('does NOT redirect canonical on /sitemap.xml or /robots.txt', () => {
    for (const p of ['/sitemap.xml', '/robots.txt']) {
      const req = makeReq({ hostname: 'blackheathbuilder.co.uk', originalUrl: p, path: p });
      const res = makeRes();
      const next = vi.fn();
      micrositeMiddleware(req as never, res as never, next);
      expect(next).toHaveBeenCalledOnce();
      expect(res.redirect).not.toHaveBeenCalled();
    }
  });

  it('strips www. prefix when resolving', () => {
    const req = makeReq({ hostname: 'www.blackheathbuilders.co.uk' });
    const res = makeRes();
    const next = vi.fn();
    micrositeMiddleware(req as never, res as never, next);
    expect((req as unknown as { microsite: { host: string } }).microsite.host).toBe('blackheathbuilders.co.uk');
  });
});
