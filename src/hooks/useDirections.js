import { useEffect, useState, useRef, useCallback } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAppStore } from '../store/useAppStore';
import { useToastStore } from '../store/useToastStore';
import { normalizeJobStops, getRemainingStops, applyWaypointOrder } from '../utils/stops';
import { computeFleetRoute } from '../utils/googleRoutesAdapter';

/**
 * Custom hook using Google Routes API / DirectionsService routing,
 * waypoint order persistence, and live off-route / detour detection.
 */
export function useDirections({ map, selectedJobId, jobs }) {
  const routesLibrary = useMapsLibrary('routes');
  const geometryLibrary = useMapsLibrary('geometry');
  const [directionsService, setDirectionsService] = useState(null);
  const [directionsRenderer, setDirectionsRenderer] = useState(null);

  const setRouteInfo = useAppStore(state => state.setRouteInfo);
  const colors = useAppStore(state => state.colors);
  const currentLocation = useAppStore(state => state.currentLocation);
  const companyId = useAppStore(state => state.companyId);
  const currentUser = useAppStore(state => state.currentUser);
  const isDispatchView = useAppStore(state => state.isDispatchView);

  const lastRouteSignature = useRef(null);
  const persistedStopSigRef = useRef(null);
  const lastFittedJobIdRef = useRef(null);
  const offRoutePolyRef = useRef(null);
  const consecutiveOffRouteRef = useRef(0);
  const lastRecalcLocationRef = useRef(null);
  const routeMarkersRef = useRef([]);

  const clearCustomMarkers = useCallback(() => {
    routeMarkersRef.current.forEach((m) => m.setMap(null));
    routeMarkersRef.current = [];
  }, []);

  const renderCustomStopMarkers = useCallback((targetMap, normalized, routeOrigin) => {
    clearCustomMarkers();
    if (!targetMap || !window.google?.maps?.Marker || !normalized) return;

    const extractLatLng = (raw) => {
      if (!raw) return null;
      const loc = raw.latLng || raw;
      const lat = typeof loc.lat === 'function' ? loc.lat() : loc.lat;
      const lng = typeof loc.lng === 'function' ? loc.lng() : loc.lng;
      return typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null;
    };

    const markerCoords = [];
    const originPos =
      extractLatLng(normalized.legs?.[0]?.startLocation) ||
      extractLatLng(routeOrigin) ||
      extractLatLng(normalized.overviewPath?.[0]);
    if (originPos) {
      markerCoords.push({ pos: originPos, label: 'A', title: 'Origin' });
    }

    (normalized.legs || []).forEach((leg, idx) => {
      const endPos = extractLatLng(leg?.endLocation || leg?.end_location);
      if (endPos) {
        markerCoords.push({
          pos: endPos,
          label: String.fromCharCode(66 + (idx % 25)),
          title: `Stop ${idx + 1}`,
        });
      }
    });

    routeMarkersRef.current = markerCoords.map(
      (pt) =>
        new window.google.maps.Marker({
          position: pt.pos,
          map: targetMap,
          label: pt.label,
          title: pt.title,
        })
    );
  }, [clearCustomMarkers]);

  const applyNormalizedRoute = useCallback((normalized, job, color, isDetour = false, orderedStops = []) => {
    if (!normalized) return;

    const totalSeconds = normalized.totalSeconds || 0;
    const totalNormalSeconds = normalized.totalNormalSeconds || totalSeconds;
    const totalMeters = normalized.totalMeters || 0;
    const delaySeconds = Math.max(0, totalSeconds - totalNormalSeconds);
    const delayMinutes = Math.round(delaySeconds / 60);

    let trafficStatus = 'green';
    let trafficText = isDetour ? 'Detour Route Active' : 'Clear Road Conditions (Fastest)';

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

    const totalDwellMinutes = (orderedStops || []).reduce(
      (sum, s) => sum + (typeof s?.serviceMinutes === 'number' && s.status !== 'completed' ? s.serviceMinutes : 0),
      0
    );

    setRouteInfo({
      jobId: job.id,
      routeColor: color,
      distance: `${totalMiles} mi`,
      duration: timeStr,
      totalDwellMinutes,
      destinationCoords: normalized.destinationCoords || null,
      steps: normalized.plainTextSteps || [],
      trafficStatus,
      trafficText,
      delayMinutes,
      overviewPath: normalized.overviewPath || [],
      stepTraffics: normalized.stepTraffics || [],
      isDetour,
      orderedStops,
      waypointOrder: normalized.waypointOrder || [],
      routeSource: normalized.source,
    });
  }, [setRouteInfo]);

  // 1. Initialize Directions Service and Renderer
  useEffect(() => {
    if (!routesLibrary || !map) return;

    const ds = routesLibrary.DirectionsService ? new routesLibrary.DirectionsService() : null;
    const dr = new routesLibrary.DirectionsRenderer({ 
      map,
      suppressMarkers: false,
      preserveViewport: true,
      polylineOptions: { strokeColor: 'transparent', strokeOpacity: 0 }
    });
    setDirectionsService(ds);
    setDirectionsRenderer(dr);

    return () => {
      dr.setMap(null);
      clearCustomMarkers();
      if (offRoutePolyRef.current) {
        offRoutePolyRef.current.setMap(null);
        offRoutePolyRef.current = null;
      }
    };
  }, [routesLibrary, map, clearCustomMarkers]);

  // 2. Primary Route Calculation & Waypoint Order Persistence
  useEffect(() => {
    if (!routesLibrary || !directionsRenderer) return;

    if (!selectedJobId) {
      directionsRenderer.setMap(null);
      clearCustomMarkers();
      lastRouteSignature.current = null;
      lastFittedJobIdRef.current = null;
      return;
    }

    const job = jobs.find(j => j.id === selectedJobId);
    if (!job) {
      directionsRenderer.setMap(null);
      clearCustomMarkers();
      lastRouteSignature.current = null;
      lastFittedJobIdRef.current = null;
      return;
    }

    const allStops = normalizeJobStops(job);
    if (allStops.length === 0) {
      directionsRenderer.setMap(null);
      clearCustomMarkers();
      return;
    }

    const remainingStops = getRemainingStops(allStops);
    const completedStops = allStops.filter(s => s.status === 'completed');
    const isPartialRemaining = remainingStops.length > 0 && completedStops.length > 0 && job.status === 'in-progress';
    const activeStops = isPartialRemaining ? remainingStops : allStops;

    const liveLoc = useAppStore.getState().currentLocation;
    let routeOrigin = job.origin;
    if (isPartialRemaining) {
      if (liveLoc?.lat && liveLoc?.lng && window.google?.maps) {
        routeOrigin = new window.google.maps.LatLng(liveLoc.lat, liveLoc.lng);
      } else {
        const lastDone = completedStops[completedStops.length - 1];
        if (lastDone?.address) routeOrigin = lastDone.address;
      }
    }

    const waypoints = activeStops.length > 1
      ? activeStops.slice(0, -1).map(s => ({ location: s.address, stopover: true }))
      : [];
    const finalDest = activeStops[activeStops.length - 1].address;
    const optimizeWaypoints = !isPartialRemaining && waypoints.length > 0 ? job.optimizeRoute !== false : false;

    let hash = 0;
    for (let i = 0; i < job.id.length; i++) {
      hash = job.id.charCodeAt(i) + ((hash << 5) - hash);
    }
    const defaultColor = colors[Math.abs(hash) % colors.length];
    const color = job.routeColor || defaultColor;

    const stopSignature = allStops.map(s => `${s.address}:${s.status}`).join('|');
    const currentSignature = JSON.stringify({
      origin: job.origin,
      stopSignature,
      optimize: job.optimizeRoute,
      color,
      partial: isPartialRemaining,
    });
    if (lastRouteSignature.current === currentSignature) {
      return;
    }

    let cancelled = false;

    computeFleetRoute({
      routesLibrary,
      directionsService,
      origin: routeOrigin,
      destination: finalDest,
      waypoints,
      optimizeWaypoints,
    }).then((normalized) => {
      if (cancelled) return;
      if (normalized.source === 'routes_v2') {
        directionsRenderer.setMap(null);
        renderCustomStopMarkers(map, normalized, routeOrigin);
      } else {
        clearCustomMarkers();
        directionsRenderer.setMap(map);
        directionsRenderer.setDirections(normalized.rawDirectionsResponse);
      }
      lastRouteSignature.current = currentSignature;

      if (lastFittedJobIdRef.current !== job.id && normalized.bounds && map) {
        map.fitBounds(normalized.bounds, 56);
        lastFittedJobIdRef.current = job.id;
      }

      const orderedStops = isPartialRemaining
        ? allStops
        : applyWaypointOrder(allStops, normalized.waypointOrder || [], normalized.legs || []);

      applyNormalizedRoute(normalized, job, color, false, orderedStops);

      if (!isPartialRemaining && companyId && currentUser?.id) {
        const orderChanged = Array.isArray(normalized.waypointOrder) && normalized.waypointOrder.some((val, idx) => val !== idx);
        const needsStopInit = !Array.isArray(job.stops) || job.stops.length === 0 || allStops.some(s => s.lat == null || s.lng == null);
        const persistSig = `${job.id}:${orderedStops.map(s => `${s.address}:${s.lat}:${s.lng}:${s.order}`).join('|')}`;
        const isAssigned = (job.assignedDrivers || []).some(d => d.id === currentUser.id);

        if ((orderChanged || needsStopInit) && persistedStopSigRef.current !== persistSig && (isDispatchView || isAssigned)) {
          persistedStopSigRef.current = persistSig;
          const jobRef = doc(db, `companies/${companyId}/jobs`, job.id);
          const updates = isDispatchView
            ? {
                stops: orderedStops,
                destinations: orderedStops.map(s => s.address),
                waypointOrder: normalized.waypointOrder || [],
                updatedAt: serverTimestamp(),
              }
            : {
                stops: orderedStops,
                updatedAt: serverTimestamp(),
              };
          updateDoc(jobRef, updates).catch(err => console.warn('Could not persist stop sequence:', err));
        }
      }
    }).catch(e => {
      if (cancelled) return;
      console.error("Directions request failed", e);
      const errMsg = e?.message || "";
      let toastMsg = `Could not find a route: ${errMsg || "Check addresses"}`;
      if (errMsg.includes("REQUEST_DENIED") || errMsg.includes("not allowed")) {
        toastMsg = "Directions request denied: Ensure Billing and Routes/Directions APIs are enabled in Google Cloud Console, and check domain restrictions.";
      }
      useToastStore.getState().addToast(toastMsg, "error");
      directionsRenderer.setMap(null);
      clearCustomMarkers();
    });

    return () => {
      cancelled = true;
    };

  }, [selectedJobId, jobs, routesLibrary, directionsService, directionsRenderer, colors, map, companyId, currentUser?.id, isDispatchView, applyNormalizedRoute, clearCustomMarkers, renderCustomStopMarkers]);

  // 3. Live Detour / Off-Route Recalculation Monitor (skips already-completed stops)
  useEffect(() => {
    if (!geometryLibrary || !routesLibrary || !directionsRenderer || !selectedJobId || !currentLocation) return;
    const job = jobs.find(j => j.id === selectedJobId);
    if (!job || job.status !== 'in-progress') return;

    const currentRouteInfo = useAppStore.getState().routeInfo;
    if (!currentRouteInfo?.overviewPath || currentRouteInfo.overviewPath.length === 0) return;
    if (!window.google?.maps) return;

    try {
      const currentPoint = new window.google.maps.LatLng(currentLocation.lat, currentLocation.lng);
      if (!offRoutePolyRef.current) {
        offRoutePolyRef.current = new window.google.maps.Polyline({ path: currentRouteInfo.overviewPath });
      } else {
        offRoutePolyRef.current.setPath(currentRouteInfo.overviewPath);
      }

      const isNearPath = geometryLibrary.poly.isLocationOnEdge(currentPoint, offRoutePolyRef.current, 0.0016);

      if (!isNearPath) {
        consecutiveOffRouteRef.current += 1;

        if (consecutiveOffRouteRef.current === 3) {
          const lastLoc = lastRecalcLocationRef.current;
          const movedSignificantly = !lastLoc || (
            Math.abs(lastLoc.lat - currentLocation.lat) > 0.002 ||
            Math.abs(lastLoc.lng - currentLocation.lng) > 0.002
          );

          if (movedSignificantly) {
            const allStops = normalizeJobStops(job);
            const remaining = getRemainingStops(allStops);
            if (remaining.length === 0) return;

            lastRecalcLocationRef.current = { ...currentLocation };
            useToastStore.getState().addToast("Detour detected: updating route from current position...", "info");

            const waypoints = remaining.length > 1
              ? remaining.slice(0, -1).map(s => ({ location: s.address, stopover: true }))
              : [];
            const finalDest = remaining[remaining.length - 1].address;
            const hasCompletedSome = remaining.length < allStops.length;

            computeFleetRoute({
              routesLibrary,
              directionsService,
              origin: currentPoint,
              destination: finalDest,
              waypoints,
              optimizeWaypoints: !hasCompletedSome && waypoints.length > 0 ? job.optimizeRoute !== false : false,
            }).then((normalized) => {
              if (normalized.source === 'routes_v2') {
                directionsRenderer.setMap(null);
                renderCustomStopMarkers(map, normalized, currentPoint);
              } else {
                clearCustomMarkers();
                directionsRenderer.setMap(map);
                directionsRenderer.setDirections(normalized.rawDirectionsResponse);
              }
              applyNormalizedRoute(normalized, job, job.routeColor || colors[0], true, allStops);
            }).catch(err => {
              console.warn("Detour recalculation failed:", err);
            });
          }
        }
      } else {
        consecutiveOffRouteRef.current = 0;
      }
    } catch (err) {
      console.warn("Off-route calculation error:", err);
    }
  }, [currentLocation, geometryLibrary, routesLibrary, directionsService, directionsRenderer, map, selectedJobId, jobs, colors, applyNormalizedRoute, clearCustomMarkers, renderCustomStopMarkers]);

  return { directionsService, directionsRenderer };
}
