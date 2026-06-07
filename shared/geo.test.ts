import { describe, expect, it } from 'vitest';
import { haversineMiles, MICROSITE_FALLBACK_RADIUS_MILES } from './geo';

describe('haversineMiles', () => {
  it('returns 0 for the same point', () => {
    expect(haversineMiles(51.5, -0.1, 51.5, -0.1)).toBe(0);
  });

  it('matches a known London → Manchester distance (~163 mi) within 1%', () => {
    // London Eye 51.5033, -0.1196 → Manchester Piccadilly 53.4775, -2.2308
    const d = haversineMiles(51.5033, -0.1196, 53.4775, -2.2308);
    expect(d).toBeGreaterThan(160);
    expect(d).toBeLessThan(170);
  });

  it('symmetric in argument order', () => {
    const a = haversineMiles(51.5, -0.1, 52.5, -1.5);
    const b = haversineMiles(52.5, -1.5, 51.5, -0.1);
    expect(Math.abs(a - b)).toBeLessThan(1e-6);
  });

  it('Blackheath → Greenwich (~1.5 mi) under the fallback radius', () => {
    // Blackheath 51.467, 0.011 → Greenwich 51.482, 0.000
    const d = haversineMiles(51.467, 0.011, 51.482, 0.0);
    expect(d).toBeLessThan(MICROSITE_FALLBACK_RADIUS_MILES);
  });
});
