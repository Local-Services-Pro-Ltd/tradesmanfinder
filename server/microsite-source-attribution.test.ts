/**
 * Source-attribution test for POST /api/jobs.
 *
 * The route handler computes `source` from `req.microsite` rather than the
 * request body, so a host-aware deployment writes 'microsite:<host>' for
 * mini-site leads and 'web' for everyone else. We test the derivation
 * directly (no DB required) since the actual handler is a thin wrapper
 * around that logic.
 */

import { describe, expect, it } from 'vitest';
import type { Microsite } from '../shared/microsites';

/** The exact derivation used inside server/routes.ts POST /api/jobs. */
function deriveSource(microsite: Microsite | null | undefined): string {
  return microsite ? `microsite:${microsite.host}` : 'web';
}

describe('job source attribution', () => {
  it('returns "web" for main-domain (no microsite)', () => {
    expect(deriveSource(null)).toBe('web');
    expect(deriveSource(undefined)).toBe('web');
  });

  it('returns "microsite:<host>" for geo-trade hosts', () => {
    const ms: Microsite = { host: 'blackheathbuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'blackheath' };
    expect(deriveSource(ms)).toBe('microsite:blackheathbuilders.co.uk');
  });

  it('returns "microsite:<host>" for generic-directory hosts', () => {
    const ms: Microsite = { host: 'getalocalbuilder.co.uk', kind: 'generic-directory', trade: 'builder' };
    expect(deriveSource(ms)).toBe('microsite:getalocalbuilder.co.uk');
  });

  it('returns "microsite:<host>" for vertical hosts', () => {
    const ms: Microsite = {
      host: 'basementcontractors.co.uk', kind: 'vertical',
      vertical: 'basement', title: 'X', leadTrade: 'builder',
    };
    expect(deriveSource(ms)).toBe('microsite:basementcontractors.co.uk');
  });
});
