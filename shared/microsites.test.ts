import { describe, expect, it } from 'vitest';
import {
  MICROSITES,
  MICROSITE_COUNT,
  resolveMicrositeByHost,
  type Microsite,
} from './microsites';

/**
 * Canonical DB taxonomy snapshot. These match what /api/categories and
 * /api/areas return in production at the time PR-M1 ships. The tests fail
 * loudly if a registry entry references a slug that isn't in the DB, which
 * is the fastest way to catch typos before they reach the renderer.
 */
const DB_TRADES = new Set([
  'builder', 'plumber', 'electrician', 'painter-decorator', 'carpenter',
  'roofer', 'plasterer', 'tiler', 'gardener-landscaper', 'handyman',
  'locksmith', 'glazier', 'cleaner', 'pest-control', 'removals',
  'bricklayer', 'flooring-specialist', 'heating-engineer', 'damp-specialist',
  'driveway-paving',
]);

const DB_AREAS = new Set([
  // Original seed
  'abbey-wood', 'plumstead', 'greenwich', 'woolwich', 'bexleyheath', 'eltham',
  'lewisham', 'bromley', 'dartford', 'erith', 'sidcup', 'welling', 'charlton',
  'blackheath', 'catford', 'grimsby', 'manchester', 'birmingham', 'leeds',
  'bristol',
  // PR-M1 mini-site seed (added directly to prod Supabase)
  'abingdon', 'accrington', 'acton', 'barnsbury', 'battersea', 'belsize-park',
  'bermondsey', 'bexley', 'bognor-regis', 'bow', 'brixton', 'burnley',
  'canning-town', 'cricklewood', 'dagenham', 'docklands', 'dulwich', 'enfield',
  'finchley', 'finsbury', 'glastonbury', 'hampstead', 'hampstead-heath',
  'haringey', 'hornchurch', 'kingsbury', 'leighton-buzzard', 'leyton',
  'leytonstone', 'loughton', 'merton', 'mortlake', 'newham', 'pimlico',
  'redbridge', 'sydenham', 'waltham-forest', 'wanstead',
]);

describe('microsite registry', () => {
  it('contains MICROSITE_COUNT entries matching the array length', () => {
    expect(MICROSITES).toHaveLength(MICROSITE_COUNT);
    expect(MICROSITE_COUNT).toBe(83);
  });

  it('has unique hostnames (no duplicate registrations)', () => {
    const seen = new Set<string>();
    for (const m of MICROSITES) {
      expect(seen.has(m.host)).toBe(false);
      seen.add(m.host);
    }
  });

  it('hostnames are lowercase and have no protocol/port', () => {
    for (const m of MICROSITES) {
      expect(m.host).toBe(m.host.toLowerCase());
      expect(m.host).not.toMatch(/^https?:/);
      expect(m.host).not.toContain(':');
    }
  });

  it('every geo-trade entry has a valid DB trade + area slug', () => {
    const offenders: string[] = [];
    for (const m of MICROSITES) {
      if (m.kind !== 'geo-trade') continue;
      if (!m.trade || !DB_TRADES.has(m.trade)) {
        offenders.push(`${m.host}: bad trade ${m.trade}`);
      }
      if (!m.area || !DB_AREAS.has(m.area)) {
        offenders.push(`${m.host}: bad area ${m.area}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every generic-directory entry has a valid DB trade (no area)', () => {
    for (const m of MICROSITES) {
      if (m.kind !== 'generic-directory') continue;
      if (m.trade) expect(DB_TRADES.has(m.trade)).toBe(true);
      expect(m.area).toBeUndefined();
    }
  });

  it('every vertical entry has a vertical id and title', () => {
    for (const m of MICROSITES) {
      if (m.kind !== 'vertical') continue;
      expect(m.vertical).toBeTruthy();
      expect(m.title).toBeTruthy();
    }
  });

  it('every redirect entry has a redirectTo target (HTTPS URL)', () => {
    for (const m of MICROSITES) {
      if (m.kind !== 'redirect') continue;
      expect(m.redirectTo).toMatch(/^https:\/\//);
    }
  });

  it('canonical references point to a registered host', () => {
    const hosts = new Set(MICROSITES.map((m) => m.host));
    for (const m of MICROSITES) {
      if (!m.canonical) continue;
      expect(hosts.has(m.canonical)).toBe(true);
    }
  });

  it('expected kind counts (sanity check on portfolio shape)', () => {
    const counts: Record<string, number> = {};
    for (const m of MICROSITES) counts[m.kind] = (counts[m.kind] ?? 0) + 1;
    expect(counts['geo-trade']).toBe(57);
    expect(counts['generic-directory']).toBe(20);
    expect(counts['vertical']).toBe(3);
    expect(counts['redirect']).toBe(3);
  });

  // PR-M6 — closes #16. The area 'abbey-wood' already exists in the DB seed,
  // so this entry activates the moment DNS is pointed at Vercel. Note: per
  // Issue #16 the domain is singular 'abbeywoodbuilder.co.uk', not the plural
  // form used elsewhere in the cluster (e.g. blackheathbuilders.co.uk).
  //
  // Note: plumsteadplumbers.co.uk was de-registered (issue #17 reopened) —
  // its nameservers were delegated to Smarthost.pl, making DNS unmanageable
  // through IONOS without an NS transfer that wasn't worth the toil.
  it('includes abbeywoodbuilder.co.uk → builder × abbey-wood (Issue #16)', () => {
    const m = resolveMicrositeByHost('abbeywoodbuilder.co.uk');
    expect(m).not.toBeNull();
    expect(m?.kind).toBe('geo-trade');
    expect(m?.trade).toBe('builder');
    expect(m?.area).toBe('abbey-wood');
  });

  it('does not include plumsteadplumbers.co.uk (de-registered)', () => {
    const m = resolveMicrositeByHost('plumsteadplumbers.co.uk');
    expect(m).toBeNull();
  });
});

describe('resolveMicrositeByHost', () => {
  const knownHost = 'blackheathbuilders.co.uk';

  it('resolves an exact host match', () => {
    const m = resolveMicrositeByHost(knownHost);
    expect(m).not.toBeNull();
    expect(m?.host).toBe(knownHost);
  });

  it('is case-insensitive', () => {
    const m = resolveMicrositeByHost('BlackheathBuilders.co.uk');
    expect(m?.host).toBe(knownHost);
  });

  it('strips www. prefix', () => {
    const m = resolveMicrositeByHost('www.blackheathbuilders.co.uk');
    expect(m?.host).toBe(knownHost);
  });

  it('strips port suffix', () => {
    const m = resolveMicrositeByHost('blackheathbuilders.co.uk:5000');
    expect(m?.host).toBe(knownHost);
  });

  it('returns null for the main domain', () => {
    expect(resolveMicrositeByHost('tradesmanfinder.com')).toBeNull();
    expect(resolveMicrositeByHost('www.tradesmanfinder.com')).toBeNull();
  });

  it('returns null for unknown hosts', () => {
    expect(resolveMicrositeByHost('example.com')).toBeNull();
    expect(resolveMicrositeByHost('localhost')).toBeNull();
  });

  it('returns null for empty / undefined / null input', () => {
    expect(resolveMicrositeByHost('')).toBeNull();
    expect(resolveMicrositeByHost(undefined)).toBeNull();
    expect(resolveMicrositeByHost(null)).toBeNull();
  });

  it('resolves a brand-piggyback redirect entry', () => {
    const m = resolveMicrositeByHost('ikeahandyman.co.uk');
    expect(m?.kind).toBe('redirect');
    expect(m?.redirectTo).toMatch(/^https:\/\//);
  });

  it('resolves a vertical entry', () => {
    const m = resolveMicrositeByHost('basementcontractors.co.uk');
    expect(m?.kind).toBe('vertical');
    expect(m?.vertical).toBe('basement');
  });

  it('resolves the duplicate-canonical pair', () => {
    const dup = resolveMicrositeByHost('blackheathbuilder.co.uk');
    expect(dup?.canonical).toBe('blackheathbuilders.co.uk');
  });
});
