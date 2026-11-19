import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockIsNativePlatform } = vi.hoisted(() => ({
  mockIsNativePlatform: vi.fn(() => false),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: mockIsNativePlatform,
  },
}));

import { getPublicAppBaseUrl, sanitizeCsvCell, toMillisSafe } from '../src/utils/formatters';

describe('formatters', () => {
  beforeEach(() => {
    localStorage.clear();
    mockIsNativePlatform.mockReturnValue(false);
  });

  describe('toMillisSafe', () => {
    it('handles Firestore Timestamps, plain seconds objects, Dates, numbers, ISO strings, and nulls', () => {
      expect(toMillisSafe(null)).toBe(0);
      expect(toMillisSafe(undefined)).toBe(0);
      expect(toMillisSafe({})).toBe(0);
      expect(toMillisSafe({ toMillis: () => 1700000000000 })).toBe(1700000000000);
      expect(toMillisSafe({ toMillis: () => Number.NaN })).toBe(0);
      expect(toMillisSafe({ seconds: 1700, nanoseconds: 500000000 })).toBe(1700500);
      expect(toMillisSafe({ seconds: 10 })).toBe(10000);
      expect(toMillisSafe(new Date('2026-11-18T12:00:00Z'))).toBe(Date.parse('2026-11-18T12:00:00Z'));
      expect(toMillisSafe(new Date('invalid'))).toBe(0);
      expect(toMillisSafe(1234567)).toBe(1234567);
      expect(toMillisSafe(Number.NaN)).toBe(0);
      expect(toMillisSafe(Number.POSITIVE_INFINITY)).toBe(0);
      expect(toMillisSafe('2026-11-18T00:00:00Z')).toBe(Date.parse('2026-11-18T00:00:00Z'));
      expect(toMillisSafe('not-a-date')).toBe(0);
    });
  });

  describe('sanitizeCsvCell', () => {
    it('neutralizes formula-injection prefixes, escapes double quotes, and handles primitives', () => {
      expect(sanitizeCsvCell('=SUM(A1:A5)')).toBe('"\'=SUM(A1:A5)"');
      expect(sanitizeCsvCell('  +cmd|calc')).toBe('"\'  +cmd|calc"');
      expect(sanitizeCsvCell('-100')).toBe('"\'-100"');
      expect(sanitizeCsvCell('@IMPORTXML')).toBe('"\'@IMPORTXML"');
      expect(sanitizeCsvCell('\tHYPERLINK()')).toBe('"\'\tHYPERLINK()"');
      expect(sanitizeCsvCell('\r1+1')).toBe('"\'\r1+1"');
      expect(sanitizeCsvCell('Acme "North" Co')).toBe('"Acme ""North"" Co"');
      expect(sanitizeCsvCell('Normal Stop')).toBe('"Normal Stop"');
      expect(sanitizeCsvCell(42.5)).toBe('"42.5"');
      expect(sanitizeCsvCell(true)).toBe('"true"');
      expect(sanitizeCsvCell(null)).toBe('""');
      expect(sanitizeCsvCell(undefined)).toBe('""');
    });
  });

  describe('getPublicAppBaseUrl', () => {
    it('prefers stored publicAppUrl and strips query strings and hashes', () => {
      localStorage.setItem('publicAppUrl', 'https://fleet.vecto.example/app/?track=old#section');
      expect(getPublicAppBaseUrl()).toBe('https://fleet.vecto.example/app/');
    });

    it('falls back to window.location origin + pathname in browser environments', () => {
      const resolved = getPublicAppBaseUrl();
      expect(resolved).toMatch(/^https?:\/\//);
      expect(resolved).not.toContain('?');
      expect(resolved).not.toContain('#');
    });

    it('resolves canonical https domain on Capacitor native platforms and never leaks capacitor:// or localhost', () => {
      mockIsNativePlatform.mockReturnValue(true);
      const resolved = getPublicAppBaseUrl();
      expect(resolved).toMatch(/^https:\/\/.+\//);
      expect(resolved).not.toContain('localhost');
      expect(resolved).not.toContain('capacitor://');
    });
  });
});
