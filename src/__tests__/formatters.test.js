import { describe, it, expect, beforeEach } from 'vitest';
import { getPublicAppBaseUrl, sanitizeCsvCell, toMillisSafe } from '../utils/formatters';

describe('formatters', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('toMillisSafe', () => {
    it('handles Firestore Timestamps, plain seconds objects, Dates, numbers, ISO strings, and nulls', () => {
      expect(toMillisSafe(null)).toBe(0);
      expect(toMillisSafe(undefined)).toBe(0);
      expect(toMillisSafe({})).toBe(0);
      expect(toMillisSafe({ toMillis: () => 1700000000000 })).toBe(1700000000000);
      expect(toMillisSafe({ seconds: 1700, nanoseconds: 500000000 })).toBe(1700500);
      expect(toMillisSafe(new Date('2026-11-18T12:00:00Z'))).toBe(Date.parse('2026-11-18T12:00:00Z'));
      expect(toMillisSafe(1234567)).toBe(1234567);
      expect(toMillisSafe(Number.NaN)).toBe(0);
      expect(toMillisSafe('2026-11-18T00:00:00Z')).toBe(Date.parse('2026-11-18T00:00:00Z'));
      expect(toMillisSafe('not-a-date')).toBe(0);
    });
  });

  describe('sanitizeCsvCell', () => {
    it('neutralizes formula-injection prefixes and escapes double quotes', () => {
      expect(sanitizeCsvCell('=SUM(A1:A5)')).toBe('"\'=SUM(A1:A5)"');
      expect(sanitizeCsvCell('  +cmd|calc')).toBe('"\'  +cmd|calc"');
      expect(sanitizeCsvCell('-100')).toBe('"\'-100"');
      expect(sanitizeCsvCell('@IMPORTXML')).toBe('"\'@IMPORTXML"');
      expect(sanitizeCsvCell('Acme "North" Co')).toBe('"Acme ""North"" Co"');
      expect(sanitizeCsvCell('Normal Stop')).toBe('"Normal Stop"');
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
  });
});
