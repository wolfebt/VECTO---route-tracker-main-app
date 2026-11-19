/**
 * Google Maps Route computation adapter supporting the newer Routes API
 * (`routesLibrary.Route.computeRoutes`) with automatic session fallback
 * to `DirectionsService` when Routes API is unavailable or disabled on the key.
 */

let modernRoutesBlocked = false;

export function resetRoutesAdapterState() {
  modernRoutesBlocked = false;
}

function formatWaypointInput(loc) {
  if (!loc) return loc;
  if (typeof loc === 'string') return loc.trim();
  if (typeof loc.lat === 'function' && typeof loc.lng === 'function') {
    return { lat: loc.lat(), lng: loc.lng() };
  }
  if (typeof loc.lat === 'number' && typeof loc.lng === 'number') {
    return { lat: loc.lat, lng: loc.lng };
  }
  return loc;
}

function toLatLngLiteral(loc) {
  if (!loc) return null;
  const lat = typeof loc.lat === 'function' ? loc.lat() : loc.lat;
  const lng = typeof loc.lng === 'function' ? loc.lng() : loc.lng;
  if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng };
  }
  return null;
}

function toSeconds(valMillisOrObj) {
  if (typeof valMillisOrObj === 'number' && Number.isFinite(valMillisOrObj)) {
    return Math.round(valMillisOrObj / 1000);
  }
  if (typeof valMillisOrObj?.value === 'number' && Number.isFinite(valMillisOrObj.value)) {
    return valMillisOrObj.value;
  }
  return 0;
}

function classifyStepColor(durSeconds, normSeconds, legRatio = 1) {
  const ratio = normSeconds > 0 ? durSeconds / normSeconds : legRatio;
  if (ratio >= 1.25 || durSeconds - normSeconds > 120) return '#ef4444';
  if (ratio >= 1.1 || durSeconds - normSeconds > 30) return '#f97316';
  return '#22c55e';
}

function normalizeRoutesV2(route) {
  const overviewPath = Array.isArray(route?.path) ? route.path : [];
  const rawLegs = Array.isArray(route?.legs) ? route.legs : [];

  let totalSeconds = toSeconds(route?.durationMillis);
  let totalNormalSeconds = toSeconds(route?.staticDurationMillis) || totalSeconds;
  let totalMeters = typeof route?.distanceMeters === 'number' ? route.distanceMeters : 0;

  const stepTraffics = [];
  const plainTextSteps = [];
  const legs = [];

  let legDurSum = 0;
  let legNormSum = 0;
  let legDistSum = 0;

  rawLegs.forEach((leg) => {
    const lDur = toSeconds(leg?.durationMillis);
    const lNorm = toSeconds(leg?.staticDurationMillis) || lDur;
    const lDist = typeof leg?.distanceMeters === 'number' ? leg.distanceMeters : 0;
    legDurSum += lDur;
    legNormSum += lNorm;
    legDistSum += lDist;

    legs.push({
      startLocation: leg?.startLocation || leg?.start_location || null,
      endLocation: leg?.endLocation || leg?.end_location || null,
      end_location: leg?.end_location || leg?.endLocation || null,
    });

    const legRatio = lNorm > 0 ? lDur / lNorm : 1;
    const steps = Array.isArray(leg?.steps) ? leg.steps : [];

    steps.forEach((step) => {
      const sDur = toSeconds(step?.durationMillis);
      const sNorm = toSeconds(step?.staticDurationMillis) || sDur;
      const rawInstr =
        step?.instructions ||
        step?.navigationInstruction?.instructions ||
        '';
      const plain = String(rawInstr).replace(/<[^>]*>?/gm, '').trim();
      if (plain) plainTextSteps.push(plain);

      if (Array.isArray(step?.path) && step.path.length > 0) {
        stepTraffics.push({
          path: step.path,
          color: classifyStepColor(sDur, sNorm, legRatio),
          instructions: plain,
        });
      }
    });
  });

  if (totalSeconds === 0) totalSeconds = legDurSum;
  if (totalNormalSeconds === 0) totalNormalSeconds = legNormSum || totalSeconds;
  if (totalMeters === 0) totalMeters = legDistSum;

  if (stepTraffics.length === 0 && overviewPath.length > 0) {
    stepTraffics.push({ path: overviewPath, color: '#22c55e', instructions: '' });
  }

  const lastLeg = legs[legs.length - 1];
  const destinationCoords =
    toLatLngLiteral(lastLeg?.endLocation) ||
    toLatLngLiteral(overviewPath[overviewPath.length - 1]);

  return {
    source: 'routes_v2',
    overviewPath,
    legs,
    totalMeters,
    totalSeconds,
    totalNormalSeconds,
    bounds: route?.viewport || null,
    waypointOrder: Array.isArray(route?.optimizedIntermediateWaypointIndex)
      ? route.optimizedIntermediateWaypointIndex
      : [],
    stepTraffics,
    plainTextSteps,
    destinationCoords,
    rawDirectionsResponse: null,
  };
}

function normalizeLegacyDirections(response) {
  const route = response?.routes?.[0];
  if (!route) return null;

  const overviewPath = Array.isArray(route.overview_path) ? route.overview_path : [];
  const rawLegs = Array.isArray(route.legs) ? route.legs : [];

  let totalSeconds = 0;
  let totalNormalSeconds = 0;
  let totalMeters = 0;
  const stepTraffics = [];
  const plainTextSteps = [];
  const legs = [];

  rawLegs.forEach((leg) => {
    const dur = toSeconds(leg?.duration_in_traffic) || toSeconds(leg?.duration);
    const normDur = toSeconds(leg?.duration) || dur;
    totalSeconds += dur;
    totalNormalSeconds += normDur;
    if (typeof leg?.distance?.value === 'number') totalMeters += leg.distance.value;

    legs.push({
      startLocation: leg?.start_location || null,
      endLocation: leg?.end_location || null,
      end_location: leg?.end_location || null,
    });

    const legRatio = normDur > 0 ? dur / normDur : 1;
    const steps = Array.isArray(leg?.steps) ? leg.steps : [];

    steps.forEach((step) => {
      const sDur = toSeconds(step?.duration_in_traffic) || toSeconds(step?.duration);
      const sNorm = toSeconds(step?.duration) || sDur;
      const plain = String(step?.instructions || '').replace(/<[^>]*>?/gm, '').trim();
      if (plain) plainTextSteps.push(plain);

      if (Array.isArray(step?.path) && step.path.length > 0) {
        stepTraffics.push({
          path: step.path,
          color: classifyStepColor(sDur, sNorm, legRatio),
          instructions: plain,
        });
      }
    });
  });

  if (stepTraffics.length === 0 && overviewPath.length > 0) {
    stepTraffics.push({ path: overviewPath, color: '#22c55e', instructions: '' });
  }

  const lastLeg = legs[legs.length - 1];
  const destinationCoords = toLatLngLiteral(lastLeg?.endLocation);

  return {
    source: 'directions_legacy',
    overviewPath,
    legs,
    totalMeters,
    totalSeconds,
    totalNormalSeconds,
    bounds: route.bounds || null,
    waypointOrder: Array.isArray(route.waypoint_order) ? route.waypoint_order : [],
    stepTraffics,
    plainTextSteps,
    destinationCoords,
    rawDirectionsResponse: response,
  };
}

export async function computeFleetRoute({
  routesLibrary,
  directionsService,
  origin,
  destination,
  waypoints = [],
  optimizeWaypoints = false,
}) {
  const canTryModern = Boolean(!modernRoutesBlocked && routesLibrary?.Route?.computeRoutes);

  if (canTryModern) {
    try {
      const intermediates = (waypoints || [])
        .map((w) => formatWaypointInput(w?.location || w))
        .filter(Boolean);

      const request = {
        origin: formatWaypointInput(origin),
        destination: formatWaypointInput(destination),
        travelMode: 'DRIVING',
        routingPreference: 'TRAFFIC_AWARE',
        optimizeWaypointOrder: Boolean(optimizeWaypoints && intermediates.length > 0),
        fields: [
          'path',
          'legs',
          'distanceMeters',
          'durationMillis',
          'staticDurationMillis',
          'viewport',
          'optimizedIntermediateWaypointIndex',
        ],
      };
      if (intermediates.length > 0) {
        request.intermediates = intermediates;
      }

      const result = await routesLibrary.Route.computeRoutes(request);
      if (Array.isArray(result?.routes) && result.routes.length > 0) {
        return normalizeRoutesV2(result.routes[0]);
      }
    } catch (err) {
      const msg = String(err?.message || err || '');
      if (/PERMISSION_DENIED|ApiTargetBlocked|not enabled|API_KEY|has not been used/i.test(msg)) {
        modernRoutesBlocked = true;
      }
      if (!directionsService?.route) {
        throw err;
      }
    }
  }

  if (!directionsService?.route) {
    throw new Error('No Google Maps routing service available.');
  }

  const response = await directionsService.route({
    origin,
    destination,
    waypoints,
    optimizeWaypoints,
    travelMode: 'DRIVING',
    drivingOptions: {
      departureTime: new Date(),
    },
  });

  const normalized = normalizeLegacyDirections(response);
  if (!normalized) {
    throw new Error('No routes returned from DirectionsService.');
  }
  return normalized;
}
