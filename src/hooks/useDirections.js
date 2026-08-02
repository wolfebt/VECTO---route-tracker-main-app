import { useEffect, useState, useRef } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { useAppStore } from '../store/useAppStore';

function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return [59, 130, 246];
  let c = hex.replace('#', '').trim();
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  if (c.length !== 6) return [59, 130, 246];
  const num = parseInt(c, 16);
  if (isNaN(num)) return [59, 130, 246];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex(r, g, b) {
  const toHex = (n) => Math.min(255, Math.max(0, Math.round(n))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function interpolateColor(color1, color2, factor) {
  const rgb1 = hexToRgb(color1);
  const rgb2 = hexToRgb(color2);
  const r = rgb1[0] + factor * (rgb2[0] - rgb1[0]);
  const g = rgb1[1] + factor * (rgb2[1] - rgb1[1]);
  const b = rgb1[2] + factor * (rgb2[2] - rgb1[2]);
  return rgbToHex(r, g, b);
}

/**
 * Custom hook for Google Maps DirectionsService and DirectionsRenderer orchestration.
 * @param {Object} params
 * @param {Object} params.map - Google Map instance
 * @param {string} params.selectedJobId - Currently selected job ID
 * @param {Array} params.jobs - Array of job objects
 */
export function useDirections({ map, selectedJobId, jobs }) {
  const routesLibrary = useMapsLibrary('routes');
  const [directionsService, setDirectionsService] = useState(null);
  const [directionsRenderer, setDirectionsRenderer] = useState(null);

  const setRouteInfo = useAppStore(state => state.setRouteInfo);
  const colors = useAppStore(state => state.colors);

  const lastRouteSignature = useRef(null);
  const accentPolylineRef = useRef(null);
  const mainPolylineRef = useRef(null);
  const animFrameRef = useRef(null);

  const clearRoutePolylines = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (accentPolylineRef.current) {
      accentPolylineRef.current.setMap(null);
      accentPolylineRef.current = null;
    }
    if (mainPolylineRef.current) {
      mainPolylineRef.current.setMap(null);
      mainPolylineRef.current = null;
    }
  };

  // 1. Initialize Directions Service and Renderer
  useEffect(() => {
    if (!routesLibrary || !map) return;

    const ds = new routesLibrary.DirectionsService();
    const dr = new routesLibrary.DirectionsRenderer({ 
      map,
      polylineOptions: { strokeColor: 'transparent', strokeOpacity: 0 } // Suppress default renderer line so custom layered polylines render smoothly
    });
    setDirectionsService(ds);
    setDirectionsRenderer(dr);

    return () => {
      dr.setMap(null);
      clearRoutePolylines();
    };
  }, [routesLibrary, map]);

  // 2. Recalculate route when selected job or jobs list changes
  useEffect(() => {
    if (!directionsService || !directionsRenderer) return;

    if (!selectedJobId) {
      directionsRenderer.setMap(null);
      clearRoutePolylines();
      lastRouteSignature.current = null;
      return;
    }

    const job = jobs.find(j => j.id === selectedJobId);
    if (!job) {
      directionsRenderer.setMap(null);
      clearRoutePolylines();
      lastRouteSignature.current = null;
      return;
    }

    const dests = job.destinations || (job.destination ? [job.destination] : []);
    if (dests.length === 0) {
      directionsRenderer.setMap(null);
      clearRoutePolylines();
      return;
    }

    let waypoints = [];
    let finalDest = dests[0];

    if (dests.length > 1) {
      waypoints = dests.slice(0, -1).map(loc => ({ location: loc, stopover: true }));
      finalDest = dests[dests.length - 1];
    }

    // Determine Polyline Color
    let hash = 0;
    for (let i = 0; i < job.id.length; i++) {
      hash = job.id.charCodeAt(i) + ((hash << 5) - hash);
    }
    const defaultColor = colors[Math.abs(hash) % colors.length];
    const color = job.routeColor || defaultColor;

    const currentSignature = JSON.stringify({ origin: job.origin, dests, optimize: job.optimizeRoute, color });
    if (lastRouteSignature.current === currentSignature) {
      // Already routed this exact job configuration - ensure renderer remains active
      directionsRenderer.setMap(map);
      return;
    }

    directionsRenderer.setMap(map);

    directionsService.route({
      origin: job.origin,
      destination: finalDest,
      waypoints: waypoints,
      optimizeWaypoints: waypoints.length > 0 ? job.optimizeRoute !== false : false,
      travelMode: 'DRIVING',
      drivingOptions: {
        departureTime: new Date(), // Traffic-aware ETA
      }
    }).then(response => {
      directionsRenderer.setDirections(response);
      lastRouteSignature.current = currentSignature;

      if (response.routes && response.routes.length > 0) {
        const route = response.routes[0];
        const path = route.overview_path;

        let totalSeconds = 0;
        let totalNormalSeconds = 0;
        let totalMeters = 0;
        let stepTraffics = [];

        route.legs.forEach(leg => {
          const dur = leg.duration_in_traffic ? leg.duration_in_traffic.value : (leg.duration ? leg.duration.value : 0);
          const normDur = leg.duration ? leg.duration.value : dur;
          totalSeconds += dur;
          totalNormalSeconds += normDur;
          if (leg.distance) totalMeters += leg.distance.value;

          const legRatio = normDur > 0 ? (dur / normDur) : 1;

          if (leg.steps && leg.steps.length > 0) {
            leg.steps.forEach(step => {
              const sDur = step.duration_in_traffic ? step.duration_in_traffic.value : (step.duration ? step.duration.value : 0);
              const sNorm = step.duration ? step.duration.value : sDur;
              const ratio = sNorm > 0 ? (sDur / sNorm) : legRatio;

              let stepColor = '#22c55e'; // Green: clear
              if (ratio >= 1.25 || (sDur - sNorm) > 120) {
                stepColor = '#ef4444'; // Red: heavy congestion
              } else if (ratio >= 1.10 || (sDur - sNorm) > 30) {
                stepColor = '#f97316'; // Orange: moderate delays
              }

              if (step.path && step.path.length > 0) {
                stepTraffics.push({
                  path: step.path,
                  color: stepColor,
                  instructions: step.instructions ? step.instructions.replace(/<[^>]*>?/gm, '') : '',
                });
              }
            });
          }
        });

        // Fallback stepTraffics if step-level paths were missing
        if (stepTraffics.length === 0 && path) {
          stepTraffics.push({ path, color: '#22c55e' });
        }

        const delaySeconds = Math.max(0, totalSeconds - totalNormalSeconds);
        const delayMinutes = Math.round(delaySeconds / 60);

        let trafficStatus = 'green';
        let trafficText = 'Clear Road Conditions (Fastest)';

        if (delayMinutes > 5 || (totalNormalSeconds > 0 && totalSeconds / totalNormalSeconds >= 1.25)) {
          trafficStatus = 'red';
          trafficText = `Heavy Congestion (+${delayMinutes} min delay)`;
        } else if (delayMinutes > 1 || (totalNormalSeconds > 0 && totalSeconds / totalNormalSeconds >= 1.10)) {
          trafficStatus = 'orange';
          trafficText = `Moderate Delays (+${delayMinutes} min delay)`;
        }

        const totalMiles = (totalMeters * 0.000621371).toFixed(1);
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;

        const lastLeg = route.legs[route.legs.length - 1];
        const endLoc = lastLeg ? lastLeg.end_location : null;
        const destCoords = endLoc
          ? (typeof endLoc.lat === 'function' ? { lat: endLoc.lat(), lng: endLoc.lng() } : { lat: endLoc.lat, lng: endLoc.lng })
          : null;

        const allSteps = route.legs.flatMap(leg => leg.steps);
        const plainTextSteps = allSteps.map(step => {
          return step.instructions ? step.instructions.replace(/<[^>]*>?/gm, '') : '';
        }).filter(Boolean);

        setRouteInfo({
          jobId: job.id,
          routeColor: color,
          distance: `${totalMiles} mi`,
          duration: timeStr,
          destinationCoords: destCoords,
          steps: plainTextSteps,
          trafficStatus,
          trafficText,
          delayMinutes,
          overviewPath: path,
          stepTraffics
        });
      }
    }).catch(e => {
      console.error("Directions request failed", e);
      clearRoutePolylines();
      import('../store/useToastStore').then(({ useToastStore }) => {
        useToastStore.getState().addToast(`Could not find a route: ${e.message || "Check addresses"}`, "error");
      });
      directionsRenderer.setMap(null);
    });

  }, [selectedJobId, jobs, directionsService, directionsRenderer, colors, setRouteInfo, map]);

  return { directionsService, directionsRenderer };
}
