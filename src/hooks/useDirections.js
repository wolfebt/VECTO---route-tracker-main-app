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
    if (lastRouteSignature.current === currentSignature && accentPolylineRef.current && mainPolylineRef.current) {
      // Already routed this exact job configuration - ensure polylines remain visible on map
      directionsRenderer.setMap(map);
      accentPolylineRef.current.setMap(map);
      mainPolylineRef.current.setMap(map);
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

        if (path && window.google?.maps?.Polyline) {
          clearRoutePolylines();

          // Accent polyline (pulsing soft grey and route color glow underneath)
          const accent = new window.google.maps.Polyline({
            path,
            strokeColor: '#64748b',
            strokeOpacity: 0.4,
            strokeWeight: 14,
            zIndex: 1,
            map,
          });
          accentPolylineRef.current = accent;

          // Main polyline (crisp route color on top)
          const main = new window.google.maps.Polyline({
            path,
            strokeColor: color,
            strokeOpacity: 0.95,
            strokeWeight: 6,
            zIndex: 2,
            map,
          });
          mainPolylineRef.current = main;

          // Smooth pulse loop
          const greyColor = '#64748b'; // soft slate grey accent
          const animatePulse = (timestamp) => {
            if (!accentPolylineRef.current) return;

            // Oscillate with sine wave over ~2 seconds
            const factor = (Math.sin(timestamp / 380) + 1) / 2;
            const currentAccentColor = interpolateColor(greyColor, color, factor);
            const currentOpacity = 0.25 + factor * 0.45; // 0.25 -> 0.70
            const currentWeight = 12 + factor * 4;        // 12px -> 16px

            accentPolylineRef.current.setOptions({
              strokeColor: currentAccentColor,
              strokeOpacity: currentOpacity,
              strokeWeight: currentWeight,
            });

            animFrameRef.current = requestAnimationFrame(animatePulse);
          };

          animFrameRef.current = requestAnimationFrame(animatePulse);
        }

        let totalSeconds = 0;
        let totalMeters = 0;
        route.legs.forEach(leg => {
          const dur = leg.duration_in_traffic ? leg.duration_in_traffic.value : (leg.duration ? leg.duration.value : 0);
          totalSeconds += dur;
          if (leg.distance) totalMeters += leg.distance.value;
        });

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
          distance: `${totalMiles} mi`,
          duration: timeStr,
          destinationCoords: destCoords,
          steps: plainTextSteps
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
