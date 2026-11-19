import { toMillisSafe } from './formatters';
import { haversineMiles } from './stops';

const geocodeCache = new Map();

function dutyRank(status) {
  if (status === 'on_duty' || !status) return 0;
  if (status === 'break') return 1;
  return 2;
}

/**
 * Geocodes an address string once via Google Maps Geocoder and caches the result.
 */
export function geocodeAddressCached(address, timeoutMs = 3000) {
  const clean = String(address || '').trim();
  if (!clean) return Promise.resolve(null);
  if (geocodeCache.has(clean)) return Promise.resolve(geocodeCache.get(clean));

  if (typeof window === 'undefined' || !window.google?.maps?.Geocoder) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, timeoutMs);

    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode({ address: clean }, (results, status) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (status === 'OK' && results?.[0]?.geometry?.location) {
        const loc = results[0].geometry.location;
        const lat = typeof loc.lat === 'function' ? loc.lat() : loc.lat;
        const lng = typeof loc.lng === 'function' ? loc.lng() : loc.lng;
        if (typeof lat === 'number' && typeof lng === 'number') {
          const coords = { lat, lng };
          geocodeCache.set(clean, coords);
          resolve(coords);
          return;
        }
      }
      resolve(null);
    });
  });
}

/**
 * Ranks fleet drivers by duty availability, active trip status, and proximity/ETA to job origin.
 */
export function rankDriversByProximity({
  originCoords = null,
  members = [],
  activeDrivers = [],
  jobs = [],
  matrixOverrides = {},
}) {
  const fifteenMinAgo = Date.now() - 15 * 60 * 1000;
  const hasOrigin =
    originCoords &&
    typeof originCoords.lat === 'number' &&
    typeof originCoords.lng === 'number';

  const candidates = (members || []).map((member) => {
    const duty = member.onDutyStatus || 'on_duty';
    const ad = (activeDrivers || []).find((d) => d.id === member.id) || null;
    const tsMs = toMillisSafe(ad?.timestamp);
    const hasFreshGps = Boolean(
      ad &&
      typeof ad.location?.latitude === 'number' &&
      typeof ad.location?.longitude === 'number' &&
      (!ad.timestamp || tsMs > fifteenMinAgo)
    );
    const driverCoords = hasFreshGps
      ? { lat: ad.location.latitude, lng: ad.location.longitude }
      : null;

    const isBusy = (jobs || []).some(
      (j) =>
        !j.archived &&
        j.status === 'in-progress' &&
        (j.assignedDrivers || []).some((d) => d.id === member.id)
    );

    let estRoadMiles = null;
    let estEtaMinutes = null;
    if (hasOrigin && driverCoords) {
      const straightMiles = haversineMiles(originCoords, driverCoords);
      estRoadMiles = Math.round(straightMiles * 1.28 * 10) / 10;
      estEtaMinutes = Math.max(2, Math.round((estRoadMiles / 30) * 60));
    }

    const matrix = matrixOverrides[member.id] || null;
    const etaMinutes = typeof matrix?.durationMinutes === 'number' ? matrix.durationMinutes : estEtaMinutes;
    const distanceLabel = matrix?.distanceText || (estRoadMiles !== null ? `~${estRoadMiles.toFixed(1)} mi` : null);
    const etaLabel = matrix?.durationText || (etaMinutes !== null ? `~${etaMinutes}m` : null);

    return {
      member,
      duty,
      hasFreshGps,
      driverCoords,
      isBusy,
      estRoadMiles,
      etaMinutes,
      distanceLabel,
      etaLabel,
      isLiveTraffic: Boolean(matrix?.isLiveTraffic),
    };
  });

  return candidates.sort((a, b) => {
    const dutyDiff = dutyRank(a.duty) - dutyRank(b.duty);
    if (dutyDiff !== 0) return dutyDiff;

    if (a.isBusy !== b.isBusy) return a.isBusy ? 1 : -1;

    const aHasEta = typeof a.etaMinutes === 'number';
    const bHasEta = typeof b.etaMinutes === 'number';
    if (aHasEta !== bHasEta) return aHasEta ? -1 : 1;

    if (aHasEta && bHasEta && a.etaMinutes !== b.etaMinutes) {
      return a.etaMinutes - b.etaMinutes;
    }

    const pDiff = Number(Boolean(b.member.isPriorityDriver)) - Number(Boolean(a.member.isPriorityDriver));
    if (pDiff !== 0) return pDiff;

    const aOrder = typeof a.member.rosterOrder === 'number' ? a.member.rosterOrder : Number.MAX_SAFE_INTEGER;
    const bOrder = typeof b.member.rosterOrder === 'number' ? b.member.rosterOrder : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;

    return String(a.member.name || a.member.email || '').localeCompare(
      String(b.member.name || b.member.email || '')
    );
  });
}

/**
 * Fetches real-time driving distance and traffic ETA for top GPS-located drivers.
 */
export function fetchLiveTrafficEtas(originCoords, rankedCandidates = []) {
  if (
    !originCoords ||
    typeof originCoords.lat !== 'number' ||
    typeof originCoords.lng !== 'number' ||
    typeof window === 'undefined' ||
    !window.google?.maps?.DistanceMatrixService
  ) {
    return Promise.resolve({});
  }

  const targets = rankedCandidates
    .filter((c) => c.driverCoords)
    .slice(0, 10);

  if (targets.length === 0) return Promise.resolve({});

  return new Promise((resolve) => {
    const service = new window.google.maps.DistanceMatrixService();
    service.getDistanceMatrix(
      {
        origins: targets.map((c) => c.driverCoords),
        destinations: [originCoords],
        travelMode: 'DRIVING',
        drivingOptions: {
          departureTime: new Date(),
        },
      },
      (response, status) => {
        if (status !== 'OK' || !Array.isArray(response?.rows)) {
          resolve({});
          return;
        }
        const overrides = {};
        response.rows.forEach((row, idx) => {
          const el = row?.elements?.[0];
          const cand = targets[idx];
          if (!cand || !el || el.status !== 'OK') return;
          const secs = el.duration_in_traffic?.value ?? el.duration?.value ?? null;
          const meters = el.distance?.value ?? null;
          if (typeof secs !== 'number') return;
          const mins = Math.max(1, Math.round(secs / 60));
          const milesStr = typeof meters === 'number' ? `${(meters * 0.000621371).toFixed(1)} mi` : null;
          const durStr = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
          overrides[cand.member.id] = {
            distanceText: milesStr,
            durationText: durStr,
            durationMinutes: mins,
            isLiveTraffic: true,
          };
        });
        resolve(overrides);
      }
    );
  });
}
