/**
 * Unit tests for server/gas-safe.ts
 *
 * The helper has no HTTP calls (the Gas Safe Register has no public API).
 * These tests lock in the normalisation and format rules so that:
 *   - leading zeros are stripped (registers issue without them)
 *   - obviously-junk inputs are rejected before we burn a database row
 *   - the deep-link URL is stable across digit-only input variants
 */
import { describe, it, expect } from 'vitest';
import {
  normaliseGasSafeNumber,
  isPlausibleGasSafeNumber,
  buildGasSafeRegisterUrl,
  normalisePostcode,
} from './gas-safe';

describe('normaliseGasSafeNumber', () => {
  it('trims surrounding whitespace', () => {
    expect(normaliseGasSafeNumber('  967295  ')).toBe('967295');
  });
  it('strips inner whitespace', () => {
    expect(normaliseGasSafeNumber('967 295')).toBe('967295');
  });
  it('strips leading zeros but keeps trailing', () => {
    expect(normaliseGasSafeNumber('00967295')).toBe('967295');
    expect(normaliseGasSafeNumber('967200')).toBe('967200');
  });
  it('leaves all-digit inputs unchanged when no zero-prefix', () => {
    expect(normaliseGasSafeNumber('123456')).toBe('123456');
  });
});

describe('isPlausibleGasSafeNumber', () => {
  it('accepts 4 to 8 digit numeric strings', () => {
    expect(isPlausibleGasSafeNumber('1234')).toBe(true);
    expect(isPlausibleGasSafeNumber('967295')).toBe(true);
    expect(isPlausibleGasSafeNumber('12345678')).toBe(true);
  });
  it('rejects strings with letters', () => {
    expect(isPlausibleGasSafeNumber('ABC1234')).toBe(false);
    expect(isPlausibleGasSafeNumber('967295X')).toBe(false);
  });
  it('rejects strings that are too short or too long', () => {
    expect(isPlausibleGasSafeNumber('123')).toBe(false);
    expect(isPlausibleGasSafeNumber('123456789')).toBe(false);
  });
  it('rejects empty input', () => {
    expect(isPlausibleGasSafeNumber('')).toBe(false);
  });
  it('normalises before checking — accepts spaced input', () => {
    expect(isPlausibleGasSafeNumber('967 295')).toBe(true);
    expect(isPlausibleGasSafeNumber('  00967295  ')).toBe(true);
  });
});

describe('buildGasSafeRegisterUrl', () => {
  it('produces a stable canonical URL', () => {
    expect(buildGasSafeRegisterUrl('967295')).toBe(
      'https://www.gassaferegister.co.uk/find-an-engineer-or-check-the-register/?registrationNumber=967295',
    );
  });
  it('normalises the number into the URL (no leading zeros, no spaces)', () => {
    expect(buildGasSafeRegisterUrl('  00967 295 ')).toBe(
      'https://www.gassaferegister.co.uk/find-an-engineer-or-check-the-register/?registrationNumber=967295',
    );
  });
});

describe('normalisePostcode', () => {
  it('uppercases and inserts the canonical inward-code space', () => {
    expect(normalisePostcode('sw3 2dy')).toBe('SW3 2DY');
    expect(normalisePostcode('sw32dy')).toBe('SW3 2DY');
    expect(normalisePostcode('  SW3   2DY  ')).toBe('SW3 2DY');
  });
  it('handles short and long postcode variants', () => {
    expect(normalisePostcode('m11ae')).toBe('M1 1AE');
    expect(normalisePostcode('cr2 6xh')).toBe('CR2 6XH');
    expect(normalisePostcode('gir 0aa')).toBe('GIR 0AA');
  });
  it('returns the compact form unchanged when too short / too long to canonicalise', () => {
    // Out-of-range inputs are not canonicalised — the route layer rejects them.
    expect(normalisePostcode('abc')).toBe('ABC');
    expect(normalisePostcode('toolongpostcode')).toBe('TOOLONGPOSTCODE');
  });
});
