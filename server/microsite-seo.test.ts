/**
 * Tests for the SEO payload builder and the index.html injection step.
 * Both functions are pure so we just feed them shapes and assert.
 */

import { describe, expect, it } from 'vitest';
import type { Microsite } from '../shared/microsites';
import {
  buildMicrositeSeo,
  injectMicrositeSeo,
} from './microsite-seo';

const geoTrade: Microsite = {
  host: 'blackheathbuilders.co.uk',
  kind: 'geo-trade',
  trade: 'builder',
  area: 'blackheath',
};

const generic: Microsite = {
  host: 'getalocalbuilder.co.uk',
  kind: 'generic-directory',
  trade: 'builder',
};

const vertical: Microsite = {
  host: 'basementcontractors.co.uk',
  kind: 'vertical',
  vertical: 'basement',
  title: 'Specialist basement contractors — UK directory',
  leadTrade: 'builder',
};

const dupCanon: Microsite = {
  host: 'blackheathbuilder.co.uk',
  kind: 'geo-trade',
  trade: 'builder',
  area: 'blackheath',
  canonical: 'blackheathbuilders.co.uk',
};

describe('buildMicrositeSeo', () => {
  it('builds a geo-trade title + LocalBusiness JSON-LD', () => {
    const seo = buildMicrositeSeo({
      microsite: geoTrade,
      area: { name: 'Blackheath', region: 'London' },
      category: { name: 'Builder' },
      origin: 'https://blackheathbuilders.co.uk',
    });
    expect(seo.title).toMatch(/Builders in Blackheath/);
    expect(seo.description).toMatch(/Blackheath/);
    expect(seo.description).toMatch(/London/);
    expect(seo.canonical).toBe('https://blackheathbuilders.co.uk/');
    expect(seo.jsonLd['@type']).toBe('LocalBusiness');
    expect((seo.jsonLd as { areaServed: { name: string } }).areaServed.name).toBe('Blackheath');
  });

  it('uses canonical host for duplicate-canonical entries', () => {
    const seo = buildMicrositeSeo({
      microsite: dupCanon,
      area: { name: 'Blackheath', region: 'London' },
      category: { name: 'Builder' },
      origin: 'https://blackheathbuilder.co.uk',
    });
    expect(seo.canonical).toBe('https://blackheathbuilders.co.uk/');
  });

  it('builds generic-directory copy when no area', () => {
    const seo = buildMicrositeSeo({
      microsite: generic,
      area: null,
      category: { name: 'Builder' },
      origin: 'https://getalocalbuilder.co.uk',
    });
    expect(seo.title).toMatch(/Find a local builder/);
    expect(seo.jsonLd['@type']).toBe('WebSite');
  });

  it('uses registry title for vertical sites', () => {
    const seo = buildMicrositeSeo({
      microsite: vertical,
      area: null,
      category: null,
      origin: 'https://basementcontractors.co.uk',
    });
    expect(seo.title).toBe('Specialist basement contractors — UK directory');
    expect(seo.jsonLd['@type']).toBe('WebSite');
  });

  it('falls back gracefully when DB rows are missing', () => {
    const seo = buildMicrositeSeo({
      microsite: geoTrade,
      area: null,
      category: null,
      origin: 'https://blackheathbuilders.co.uk',
    });
    expect(seo.title).toBeTruthy();
    expect(seo.description).toBeTruthy();
  });
});

describe('injectMicrositeSeo', () => {
  const baseHtml = '<!doctype html><html><head><meta charset="utf-8"><title>Old</title></head><body><div id="root"></div></body></html>';

  const seo = {
    title: 'Builders in Blackheath',
    description: 'Find local builders in Blackheath.',
    canonical: 'https://blackheathbuilders.co.uk/',
    jsonLd: { '@context': 'https://schema.org', '@type': 'LocalBusiness', name: 'Builders in Blackheath' },
  };

  it('replaces the existing <title> with the mini-site title', () => {
    const out = injectMicrositeSeo(baseHtml, geoTrade, seo);
    expect(out).toContain('<title>Builders in Blackheath</title>');
    expect(out).not.toContain('<title>Old</title>');
  });

  it('injects canonical, og tags, and JSON-LD', () => {
    const out = injectMicrositeSeo(baseHtml, geoTrade, seo);
    expect(out).toContain('rel="canonical"');
    expect(out).toContain('blackheathbuilders.co.uk');
    expect(out).toContain('property="og:title"');
    expect(out).toContain('application/ld+json');
    expect(out).toContain('"@type":"LocalBusiness"');
  });

  it('embeds window.__MICROSITE__ bootstrap', () => {
    const out = injectMicrositeSeo(baseHtml, geoTrade, seo);
    expect(out).toContain('window.__MICROSITE__=');
    expect(out).toContain('"host":"blackheathbuilders.co.uk"');
  });

  it('is idempotent: re-injection replaces the block, not duplicates', () => {
    const once = injectMicrositeSeo(baseHtml, geoTrade, seo);
    const twice = injectMicrositeSeo(once, geoTrade, { ...seo, title: 'New title' });
    const titleMatches = twice.match(/<title>/g) ?? [];
    expect(titleMatches).toHaveLength(1);
    expect(twice).toContain('<title>New title</title>');
  });

  it('escapes injected strings to prevent HTML injection from area names', () => {
    const evil = { ...seo, title: '<script>alert(1)</script>', description: 'a"b' };
    const out = injectMicrositeSeo(baseHtml, geoTrade, evil);
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).toContain('&lt;script&gt;');
    // Quote in attribute is escaped too
    expect(out).toContain('content="a&quot;b"');
  });
});
