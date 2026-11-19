import { Capacitor } from '@capacitor/core';

/**
 * Safely converts Firestore Timestamps, plain { seconds } objects, Dates,
 * numbers, or ISO date strings into epoch milliseconds.
 * Returns 0 for null, undefined, or unresolved serverTimestamp() sentinels.
 */
export function toMillisSafe(ts) {
  if (ts == null) return 0;
  if (typeof ts.toMillis === 'function') {
    const ms = ts.toMillis();
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof ts.seconds === 'number' && Number.isFinite(ts.seconds)) {
    const nanos = typeof ts.nanoseconds === 'number' && Number.isFinite(ts.nanoseconds) ? ts.nanoseconds : 0;
    return Math.round(ts.seconds * 1000 + nanos / 1e6);
  }
  if (ts instanceof Date) {
    const ms = ts.getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof ts === 'number') {
    return Number.isFinite(ts) ? ts : 0;
  }
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function stripQueryAndHash(rawUrl) {
  const cleaned = String(rawUrl || '').trim();
  if (!cleaned) return '';
  return cleaned.split('#')[0].split('?')[0];
}

/**
 * Resolves the canonical public web URL for share, QR, SMS, and customer tracking links.
 * Avoids emitting broken https://localhost or capacitor://localhost URLs from native builds.
 */
export function getPublicAppBaseUrl() {
  const envUrl = stripQueryAndHash(import.meta.env.VITE_PUBLIC_APP_URL);
  if (envUrl) return envUrl;

  let storedUrl = '';
  try {
    storedUrl = stripQueryAndHash(localStorage.getItem('publicAppUrl'));
  } catch {
    storedUrl = '';
  }
  if (storedUrl) return storedUrl;

  const isNative =
    Capacitor.isNativePlatform() ||
    (typeof window !== 'undefined' &&
      (window.location.protocol === 'capacitor:' || window.location.protocol === 'file:'));

  if (isNative) {
    const authDomain = String(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '').trim();
    return authDomain ? `https://${authDomain}/` : 'https://vecto.app/';
  }

  if (typeof window !== 'undefined' && window.location) {
    return stripQueryAndHash(`${window.location.origin}${window.location.pathname}`);
  }

  return 'https://vecto.app/';
}

/**
 * Escapes and neutralizes CSV cells against Excel/Sheets formula injection.
 */
export function sanitizeCsvCell(value) {
  const raw = String(value ?? '');
  const trimmedStart = raw.replace(/^ +/, '');
  const needsNeutralizing = /^[=+\-@\t\r]/.test(raw) || /^[=+\-@\t\r]/.test(trimmedStart);
  const safeValue = needsNeutralizing ? `'${raw}` : raw;
  return `"${safeValue.replace(/"/g, '""')}"`;
}
