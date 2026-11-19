import { haversineMiles } from './stops';

const WEATHER_CACHE_TTL_MS = 10 * 60 * 1000;
const weatherCache = new Map();

export function describeWeatherCode(code) {
  if (code === 0) return 'Clear';
  if (code >= 1 && code <= 3) return 'Partly Cloudy';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 55) return 'Drizzle';
  if (code === 56 || code === 57 || code === 66 || code === 67) return 'Freezing Rain';
  if ((code >= 61 && code <= 65) || (code >= 80 && code <= 82)) return 'Rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'Snow';
  if (code >= 95 && code <= 99) return 'Thunderstorm';
  return 'Cloudy';
}

function toLatLng(pt) {
  if (!pt) return null;
  const lat = typeof pt.lat === 'function' ? pt.lat() : pt.lat;
  const lng = typeof pt.lng === 'function' ? pt.lng() : pt.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return { lat, lng };
}

export function sampleRoutePoints(routeInfo) {
  const path = Array.isArray(routeInfo?.overviewPath) ? routeInfo.overviewPath : [];
  const dest = toLatLng(routeInfo?.destinationCoords);

  const candidates = [];
  if (path.length >= 2) {
    const p0 = toLatLng(path[0]);
    const p1 = toLatLng(path[Math.floor(path.length / 3)]);
    const p2 = toLatLng(path[Math.floor((path.length * 2) / 3)]);
    const pEnd = toLatLng(path[path.length - 1]) || dest;

    if (p0) candidates.push({ label: 'Origin', ...p0 });
    if (p1) candidates.push({ label: 'En Route (1/3)', ...p1 });
    if (p2) candidates.push({ label: 'En Route (2/3)', ...p2 });
    if (pEnd) candidates.push({ label: 'Destination', ...pEnd });
  } else if (dest) {
    candidates.push({ label: 'Destination', ...dest });
  }

  const sampled = [];
  for (const pt of candidates) {
    const isDest = pt.label === 'Destination';
    const tooClose = sampled.some((existing) => haversineMiles(existing, pt) < 8);
    if (!tooClose) {
      sampled.push(pt);
    } else if (isDest && sampled.length > 0 && sampled[sampled.length - 1].label !== 'Destination') {
      // Keep destination explicitly labeled if origin & dest are within 8 miles
      sampled[sampled.length - 1] = { ...sampled[sampled.length - 1], label: 'Destination' };
    }
  }

  if (sampled.length === 0 && dest) {
    sampled.push({ label: 'Destination', ...dest });
  }

  return sampled.slice(0, 4);
}

function evaluatePointHazards(current, segmentLabel) {
  if (!current) return [];
  const temp = current.temperature_2m;
  const code = current.weather_code;
  const windSpeed = current.wind_speed_10m || 0;
  const windGusts = current.wind_gusts_10m || 0;
  const precip = current.precipitation || 0;
  const visibility = typeof current.visibility === 'number' ? current.visibility : null;

  const detected = [];
  const isPrecipOrFogCode =
    code === 45 || code === 48 || (code >= 51 && code <= 86) || (code >= 95 && code <= 99);

  // Ice / Freezing Rain
  if (
    [56, 57, 66, 67].includes(code) ||
    (typeof temp === 'number' && temp <= 32 && (precip > 0 || isPrecipOrFogCode))
  ) {
    detected.push({
      type: 'ice',
      severity: 'critical',
      icon: '🧊',
      title: 'Ice / Freezing Road Risk',
      detail: `${Math.round(temp ?? 32)}°F • ${describeWeatherCode(code)}`,
      segment: segmentLabel
    });
  }

  // Heavy Snow / Snow
  if ([75, 86].includes(code)) {
    detected.push({
      type: 'snow',
      severity: 'critical',
      icon: '❄️',
      title: 'Heavy Snow / Blizzard Conditions',
      detail: `${Math.round(temp ?? 0)}°F • Reduced traction`,
      segment: segmentLabel
    });
  } else if ([71, 73, 77, 85].includes(code)) {
    detected.push({
      type: 'snow',
      severity: 'warning',
      icon: '🌨️',
      title: 'Snowy Roadway Advisory',
      detail: `${Math.round(temp ?? 0)}°F • Watch braking distance`,
      segment: segmentLabel
    });
  }

  // Thunderstorm / Hail
  if ([95, 96, 99].includes(code)) {
    detected.push({
      type: 'thunderstorm',
      severity: 'critical',
      icon: '⛈️',
      title: code === 95 ? 'Severe Thunderstorm Alert' : 'Thunderstorm & Hail Risk',
      detail: windGusts > 0 ? `Gusts ${Math.round(windGusts)} mph` : 'Lightning & downpours',
      segment: segmentLabel
    });
  }

  // High Winds / Crosswind Gusts
  if (windGusts >= 45 || windSpeed >= 35) {
    detected.push({
      type: 'wind',
      severity: 'critical',
      icon: '💨',
      title: 'Dangerous Crosswind Gusts',
      detail: `Wind ${Math.round(windSpeed)} mph (gusts ${Math.round(windGusts)} mph)`,
      segment: segmentLabel
    });
  } else if (windGusts >= 30 || windSpeed >= 25) {
    detected.push({
      type: 'wind',
      severity: 'warning',
      icon: '🌬️',
      title: 'High Wind Advisory',
      detail: `Wind ${Math.round(windSpeed)} mph (gusts ${Math.round(windGusts)} mph)`,
      segment: segmentLabel
    });
  }

  // Dense Fog / Low Visibility
  if (code === 45 || code === 48 || (visibility !== null && visibility < 1000)) {
    const visMiles = visibility !== null ? `${(visibility * 0.000621371).toFixed(1)} mi` : 'Low';
    detected.push({
      type: 'fog',
      severity: 'warning',
      icon: '🌫️',
      title: 'Dense Fog / Low Visibility',
      detail: `Visibility ${visMiles}`,
      segment: segmentLabel
    });
  }

  // Heavy Rain
  if ([65, 82].includes(code) || precip >= 0.25) {
    detected.push({
      type: 'rain',
      severity: 'warning',
      icon: '🌧️',
      title: 'Heavy Rain / Hydroplaning Risk',
      detail: precip > 0 ? `${precip.toFixed(2)} in/hr` : 'Heavy downpours',
      segment: segmentLabel
    });
  }

  return detected;
}

export async function fetchRouteWeatherAndHazards(points = []) {
  if (!Array.isArray(points) || points.length === 0) {
    return null;
  }

  const now = Date.now();
  const results = new Array(points.length).fill(null);
  const uncachedIndices = [];

  points.forEach((pt, idx) => {
    const cacheKey = `${pt.lat.toFixed(2)},${pt.lng.toFixed(2)}`;
    const cached = weatherCache.get(cacheKey);
    if (cached && now - cached.ts < WEATHER_CACHE_TTL_MS) {
      results[idx] = cached.current;
    } else {
      uncachedIndices.push(idx);
    }
  });

  if (uncachedIndices.length > 0) {
    const lats = uncachedIndices.map((idx) => points[idx].lat.toFixed(4)).join(',');
    const lngs = uncachedIndices.map((idx) => points[idx].lng.toFixed(4)).join(',');
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}` +
      `&current=temperature_2m,weather_code,wind_speed_10m,wind_gusts_10m,precipitation,visibility` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Open-Meteo HTTP ${res.status}`);
    }
    const rawData = await res.json();
    const entries = Array.isArray(rawData) ? rawData : [rawData];

    uncachedIndices.forEach((origIdx, fetchIdx) => {
      const current = entries[fetchIdx]?.current || null;
      if (current) {
        results[origIdx] = current;
        const pt = points[origIdx];
        const cacheKey = `${pt.lat.toFixed(2)},${pt.lng.toFixed(2)}`;
        weatherCache.set(cacheKey, { ts: now, current });
      }
    });
  }

  const hazardMap = new Map();
  points.forEach((pt, idx) => {
    const current = results[idx];
    const pointHazards = evaluatePointHazards(current, pt.label);
    pointHazards.forEach((h) => {
      const existing = hazardMap.get(h.type);
      if (!existing) {
        hazardMap.set(h.type, { ...h, segments: [h.segment] });
        return;
      }
      const nextSegments = existing.segments.includes(h.segment)
        ? existing.segments
        : [...existing.segments, h.segment];

      const promote = existing.severity !== 'critical' && h.severity === 'critical';
      hazardMap.set(h.type, {
        ...(promote ? h : existing),
        segments: nextSegments,
        segment: nextSegments.join(', ')
      });
    });
  });

  const hazards = Array.from(hazardMap.values()).sort((a, b) => {
    if (a.severity === b.severity) return 0;
    return a.severity === 'critical' ? -1 : 1;
  });

  const destIdx = points.findIndex((p) => p.label === 'Destination');
  const destCurrent = (destIdx >= 0 ? results[destIdx] : results[results.length - 1]) || null;

  const destinationWeather = destCurrent
    ? {
        temp: destCurrent.temperature_2m,
        desc: describeWeatherCode(destCurrent.weather_code),
        code: destCurrent.weather_code,
        windSpeed: destCurrent.wind_speed_10m,
        windGusts: destCurrent.wind_gusts_10m
      }
    : null;

  const highestSeverity = hazards.some((h) => h.severity === 'critical')
    ? 'critical'
    : (hazards.length > 0 ? 'warning' : 'none');

  return {
    destinationWeather,
    hazards,
    highestSeverity
  };
}
