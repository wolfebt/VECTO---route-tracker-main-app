import { useEffect, useState, useRef } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { useAppStore } from '../store/useAppStore';

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

  // 1. Initialize Directions Service and Renderer
  useEffect(() => {
    if (!routesLibrary || !map) return;

    const ds = new routesLibrary.DirectionsService();
    const dr = new routesLibrary.DirectionsRenderer({ map });
    setDirectionsService(ds);
    setDirectionsRenderer(dr);

    return () => {
      dr.setMap(null);
    };
  }, [routesLibrary, map]);

  // 2. Recalculate route when selected job or jobs list changes
  useEffect(() => {
    if (!directionsService || !directionsRenderer) return;

    if (!selectedJobId) {
      directionsRenderer.setMap(null);
      lastRouteSignature.current = null;
      return;
    }

    const job = jobs.find(j => j.id === selectedJobId);
    if (!job) {
      directionsRenderer.setMap(null);
      lastRouteSignature.current = null;
      return;
    }

    const dests = job.destinations || (job.destination ? [job.destination] : []);
    if (dests.length === 0) {
      directionsRenderer.setMap(null);
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

    directionsRenderer.setOptions({
      polylineOptions: { strokeColor: color, strokeOpacity: 0.8, strokeWeight: 5 }
    });

    const currentSignature = JSON.stringify({ origin: job.origin, dests, optimize: job.optimizeRoute });
    if (lastRouteSignature.current === currentSignature) {
      // Already routed this exact job configuration
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
      import('../store/useToastStore').then(({ useToastStore }) => {
        useToastStore.getState().addToast(`Could not find a route: ${e.message || "Check addresses"}`, "error");
      });
      directionsRenderer.setMap(null);
    });

  }, [selectedJobId, jobs, directionsService, directionsRenderer, colors, setRouteInfo, map]);

  return { directionsService, directionsRenderer };
}
