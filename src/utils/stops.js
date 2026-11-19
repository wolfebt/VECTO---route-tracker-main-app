import { toMillisSafe } from './formatters';

/**
 * Structured multi-stop helpers, SLA time window evaluators, and geodesic mileage utilities.
 */

export function normalizeJobStops(job) {
  if (Array.isArray(job?.stops) && job.stops.length > 0) {
    return [...job.stops]
      .map((s, idx) => ({
        id: s.id || `stop_${idx}`,
        address: s.address || '',
        lat: typeof s.lat === 'number' ? s.lat : null,
        lng: typeof s.lng === 'number' ? s.lng : null,
        order: typeof s.order === 'number' ? s.order : idx,
        status: s.status || (job?.status === 'completed' ? 'completed' : 'pending'),
        arrivedAt: s.arrivedAt || null,
        completedAt: s.completedAt || null,
        arriveBy: s.arriveBy ? String(s.arriveBy).trim() : null,
        serviceMinutes: typeof s.serviceMinutes === 'number' && s.serviceMinutes > 0 ? Math.round(s.serviceMinutes) : null,
        pod: s.pod || null,
      }))
      .filter((s) => s.address)
      .sort((a, b) => a.order - b.order);
  }

  const rawDests = job?.destinations || (job?.destination ? [job.destination] : []);
  return rawDests
    .filter((d) => typeof d === 'string' && d.trim())
    .map((address, idx) => ({
      id: `stop_${idx}`,
      address: address.trim(),
      lat: null,
      lng: null,
      order: idx,
      status: job?.status === 'completed' ? 'completed' : 'pending',
      arrivedAt: null,
      completedAt: null,
      arriveBy: null,
      serviceMinutes: null,
    }));
}

export function getRemainingStops(stops = []) {
  return stops.filter((s) => s.status !== 'completed');
}

export function applyWaypointOrder(stops = [], waypointOrder = [], legs = []) {
  if (!stops || stops.length === 0) return [];

  let ordered = [...stops];
  if (stops.length > 1) {
    const intermediate = stops.slice(0, -1);
    const finalStop = stops[stops.length - 1];
    if (Array.isArray(waypointOrder) && waypointOrder.length === intermediate.length) {
      const reordered = waypointOrder.map((idx) => intermediate[idx]).filter(Boolean);
      if (reordered.length === intermediate.length) {
        ordered = [...reordered, finalStop];
      }
    }
  }

  return ordered.map((stop, idx) => {
    const leg = legs[idx];
    const endLoc = leg?.end_location;
    const endLat = typeof endLoc?.lat === 'function' ? endLoc.lat() : endLoc?.lat;
    const endLng = typeof endLoc?.lng === 'function' ? endLoc.lng() : endLoc?.lng;

    return {
      ...stop,
      order: idx,
      lat: typeof stop.lat === 'number' ? stop.lat : (typeof endLat === 'number' ? endLat : null),
      lng: typeof stop.lng === 'number' ? stop.lng : (typeof endLng === 'number' ? endLng : null),
    };
  });
}

const EARTH_RADIUS_MILES = 3958.7613;

export function haversineMiles(p1, p2) {
  if (
    !p1 ||
    !p2 ||
    typeof p1.lat !== 'number' ||
    typeof p1.lng !== 'number' ||
    typeof p2.lat !== 'number' ||
    typeof p2.lng !== 'number'
  ) {
    return 0;
  }

  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(p2.lat - p1.lat);
  const dLng = toRad(p2.lng - p1.lng);
  const lat1 = toRad(p1.lat);
  const lat2 = toRad(p2.lat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_MILES * c;
}

export function haversineMeters(p1, p2) {
  return haversineMiles(p1, p2) * 1609.344;
}

export function computePathMiles(points = []) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineMiles(points[i - 1], points[i]);
  }
  return total;
}

/**
 * Evaluates a stop's SLA window status against its target arriveBy ("HH:MM") time.
 * @returns {{ status: 'none'|'scheduled'|'at_risk'|'on_time'|'late', label: string }}
 */
export function evaluateStopSla(stop, jobDate = '') {
  const rawTime = String(stop?.arriveBy || '').trim();
  if (!rawTime) return { status: 'none', label: '' };

  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(rawTime);
  if (!timeMatch) return { status: 'none', label: rawTime };

  const hh = Number(timeMatch[1]);
  const mm = Number(timeMatch[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    return { status: 'none', label: rawTime };
  }

  const period = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 || 12;
  const displayTime = `${h12}:${String(mm).padStart(2, '0')} ${period}`;

  let baseDate = new Date();
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(jobDate || '').trim());
  if (dateMatch) {
    baseDate = new Date(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]));
  }

  const deadlineMs = new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    hh,
    mm,
    0,
    0
  ).getTime();

  if (!Number.isFinite(deadlineMs)) {
    return { status: 'none', label: displayTime };
  }

  if (stop.status === 'completed' || stop.status === 'arrived') {
    const actualMs = toMillisSafe(stop.arrivedAt || stop.completedAt);
    if (actualMs > 0 && actualMs > deadlineMs + 60 * 1000) {
      return { status: 'late', label: displayTime };
    }
    return { status: 'on_time', label: displayTime };
  }

  const now = Date.now();
  if (now > deadlineMs) {
    return { status: 'late', label: displayTime };
  }
  if (deadlineMs - now <= 20 * 60 * 1000) {
    return { status: 'at_risk', label: displayTime };
  }
  return { status: 'scheduled', label: displayTime };
}

export function evaluateJobSlaSummary(job) {
  const stops = normalizeJobStops(job);
  let hasSla = false;
  let lateCount = 0;
  let atRiskCount = 0;
  let onTimeCount = 0;
  let totalDwellMinutes = 0;

  stops.forEach((s) => {
    if (typeof s.serviceMinutes === 'number' && s.serviceMinutes > 0) {
      totalDwellMinutes += s.serviceMinutes;
    }
    const sla = evaluateStopSla(s, job?.jobDate || '');
    if (sla.status !== 'none') {
      hasSla = true;
      if (sla.status === 'late') lateCount += 1;
      else if (sla.status === 'at_risk') atRiskCount += 1;
      else if (sla.status === 'on_time') onTimeCount += 1;
    }
  });

  return { hasSla, lateCount, atRiskCount, onTimeCount, totalDwellMinutes };
}
