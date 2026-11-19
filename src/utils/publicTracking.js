import { Timestamp, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { getPublicAppBaseUrl } from './formatters';
import { getRemainingStops, normalizeJobStops } from './stops';

const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'archived']);

export function generateTrackingToken() {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function sanitizeLatLng(coords) {
  if (!coords) return null;
  const lat = typeof coords.lat === 'number'
    ? coords.lat
    : (typeof coords.latitude === 'number' ? coords.latitude : null);
  const lng = typeof coords.lng === 'number'
    ? coords.lng
    : (typeof coords.longitude === 'number' ? coords.longitude : null);
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return { lat, lng };
}

function getFirstName(name) {
  const clean = String(name || '').trim();
  if (!clean) return 'Driver';
  return clean.split(/\s+/)[0].slice(0, 80);
}

export function buildCustomerTrackingUrl(token) {
  if (!token) return '';
  return `${getPublicAppBaseUrl()}?track=${encodeURIComponent(token)}`;
}

export function buildPublicTrackingPayload({
  companyId,
  companyName,
  job,
  driverName = null,
  driverId = null,
  driverLocation = undefined,
  heading = null,
  speed = null,
  routeInfo = null
}) {
  const isTerminal = TERMINAL_STATUSES.has(job?.status);
  const stops = normalizeJobStops(job);
  const remaining = getRemainingStops(stops);
  const nextStop = remaining[0] || stops[stops.length - 1] || null;

  const stopsSummary = stops.slice(0, 50).map((s, idx) => ({
    order: idx + 1,
    label: String(s.address || '').slice(0, 200),
    status: s.status || 'pending',
    completedAt: s.completedAt || null,
    hasPod: Boolean(s.pod)
  }));

  const assignedPrimary = Array.isArray(job?.assignedDrivers) && job.assignedDrivers.length > 0
    ? job.assignedDrivers[0]
    : null;

  const resolvedDriverId = driverId || assignedPrimary?.id || null;
  const resolvedDriverName = driverName || assignedPrimary?.name || null;

  const matchingRoute = routeInfo?.jobId === job?.id ? routeInfo : null;
  const destCoords = sanitizeLatLng(
    matchingRoute?.destinationCoords ||
    (typeof nextStop?.lat === 'number' && typeof nextStop?.lng === 'number'
      ? { lat: nextStop.lat, lng: nextStop.lng }
      : null)
  );

  const payload = {
    companyId: String(companyId || ''),
    companyName: String(companyName || 'Vecto Fleet').slice(0, 200),
    jobId: String(job?.id || ''),
    jobName: String(job?.jobName || 'Delivery').slice(0, 200),
    status: String(job?.status || 'assigned').slice(0, 40),
    driverId: resolvedDriverId ? String(resolvedDriverId).slice(0, 128) : null,
    driverFirstName: resolvedDriverName ? getFirstName(resolvedDriverName) : null,
    heading: typeof heading === 'number' && Number.isFinite(heading) ? heading : null,
    speed: typeof speed === 'number' && Number.isFinite(speed) ? speed : null,
    originLabel: job?.origin ? String(job.origin).slice(0, 500) : null,
    destinationAddress: nextStop?.address ? String(nextStop.address).slice(0, 500) : null,
    destinationCoords: destCoords,
    stopsSummary,
    etaText: !isTerminal && matchingRoute?.duration ? String(matchingRoute.duration).slice(0, 80) : null,
    distanceRemainingText: !isTerminal && matchingRoute?.distance ? String(matchingRoute.distance).slice(0, 80) : null,
    etaUpdatedAt: matchingRoute ? Date.now() : null,
    podCompleted: Boolean(job?.pod || stops.some((s) => Boolean(s.pod))),
    revoked: false,
    expiresAt: isTerminal ? Timestamp.fromMillis(Date.now() + 72 * 60 * 60 * 1000) : null
  };

  if (isTerminal) {
    payload.driverLocation = null;
  } else if (driverLocation !== undefined) {
    payload.driverLocation = sanitizeLatLng(driverLocation);
  }

  return payload;
}

export async function ensurePublicTrackingLink({
  db,
  companyId,
  companyName,
  job,
  driverId = null,
  driverName = null,
  driverLocation = undefined,
  routeInfo = null
}) {
  if (!companyId || !job?.id) {
    throw new Error('Company and job context are required to create a tracking link.');
  }

  const hasExistingToken = typeof job.trackingToken === 'string' && job.trackingToken.length >= 20;
  const token = hasExistingToken ? job.trackingToken : generateTrackingToken();

  const payload = buildPublicTrackingPayload({
    companyId,
    companyName,
    job,
    driverId,
    driverName,
    driverLocation,
    routeInfo
  });

  await setDoc(
    doc(db, 'public_tracking', token),
    {
      ...payload,
      updatedAt: serverTimestamp(),
      ...(!hasExistingToken ? { createdAt: serverTimestamp() } : {})
    },
    { merge: true }
  );

  if (!hasExistingToken) {
    await updateDoc(doc(db, `companies/${companyId}/jobs`, job.id), {
      trackingToken: token,
      updatedAt: serverTimestamp()
    });
  }

  return {
    token,
    url: buildCustomerTrackingUrl(token)
  };
}

export async function syncPublicTrackingJobUpdate({
  db,
  companyId,
  companyName,
  job,
  driverId = null,
  driverName = null,
  driverLocation = undefined,
  heading = null,
  speed = null,
  routeInfo = null
}) {
  const token = job?.trackingToken;
  if (!token || token.length < 20 || !companyId || !job?.id) return;

  const payload = buildPublicTrackingPayload({
    companyId,
    companyName,
    job,
    driverId,
    driverName,
    driverLocation,
    heading,
    speed,
    routeInfo
  });

  // Do not un-revoke a link or overwrite missing optional fields unnecessarily
  delete payload.revoked;

  try {
    await updateDoc(doc(db, 'public_tracking', token), {
      ...payload,
      updatedAt: serverTimestamp()
    });
  } catch (err) {
    console.warn('Public tracking sync skipped:', err?.message || err);
  }
}

export async function revokePublicTrackingLink({ db, companyId, job }) {
  const token = job?.trackingToken;
  if (!companyId || !job?.id) return;

  if (token && token.length >= 20) {
    try {
      await updateDoc(doc(db, 'public_tracking', token), {
        revoked: true,
        driverLocation: null,
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      console.warn('Public tracking doc revoke warning:', err?.message || err);
    }
  }

  await updateDoc(doc(db, `companies/${companyId}/jobs`, job.id), {
    trackingToken: null,
    updatedAt: serverTimestamp()
  });
}
