import React, { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { APIProvider, AdvancedMarker, Map, Pin, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { CheckCircle2, Clock, MapPin, Navigation, PackageCheck, ShieldCheck, Truck, AlertTriangle } from 'lucide-react';
import { db } from '../firebase';
import { haversineMiles } from '../utils/stops';

function formatElapsed(updatedAt) {
  if (!updatedAt) return 'Awaiting telemetry';
  const ms = typeof updatedAt.toMillis === 'function'
    ? updatedAt.toMillis()
    : (typeof updatedAt.seconds === 'number' ? updatedAt.seconds * 1000 : Number(updatedAt) || 0);
  if (!ms) return 'Live';
  const diffSec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (diffSec < 60) return `Updated ${diffSec}s ago`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `Updated ${mins}m ago`;
  return `Updated ${Math.floor(mins / 60)}h ago`;
}

function getStatusStepIndex(status, stopsSummary = []) {
  if (status === 'completed' || status === 'pending-completion') return 3;
  const hasArrived = Array.isArray(stopsSummary) && stopsSummary.some((s) => s.status === 'arrived');
  if (hasArrived) return 2;
  if (status === 'in-progress') return 1;
  return 0;
}

function CustomerTrackingMap({ trackingData, onLiveEstimate }) {
  const map = useMap();
  const routesLibrary = useMapsLibrary('routes');
  const [renderer, setRenderer] = useState(null);
  const [resolvedDestCoords, setResolvedDestCoords] = useState(null);
  const serviceRef = useRef(null);
  const lastCalcRef = useRef({ ts: 0, lat: null, lng: null, dest: '' });
  const hasFitBoundsRef = useRef(false);

  const driverLoc = trackingData?.driverLocation;
  const hasProvidedDestCoords = Boolean(trackingData?.destinationCoords);
  const destCoords = trackingData?.destinationCoords || resolvedDestCoords;
  const destAddr = trackingData?.destinationAddress;
  const isTerminal = ['completed', 'cancelled', 'archived'].includes(trackingData?.status);

  useEffect(() => {
    if (!routesLibrary || !map) return;
    serviceRef.current = new routesLibrary.DirectionsService();
    const dr = new routesLibrary.DirectionsRenderer({
      map,
      suppressMarkers: true,
      polylineOptions: {
        strokeColor: '#38bdf8',
        strokeWeight: 5,
        strokeOpacity: 0.9
      }
    });
    setRenderer(dr);
    return () => {
      dr.setMap(null);
      setRenderer(null);
    };
  }, [routesLibrary, map]);

  // Fit bounds once when initial coordinates load
  useEffect(() => {
    if (!map || !window.google?.maps) return;
    if (hasFitBoundsRef.current) return;

    if (driverLoc && destCoords) {
      const bounds = new window.google.maps.LatLngBounds();
      bounds.extend(driverLoc);
      bounds.extend(destCoords);
      map.fitBounds(bounds, 64);
      hasFitBoundsRef.current = true;
    } else if (driverLoc) {
      map.setCenter(driverLoc);
      map.setZoom(13);
      hasFitBoundsRef.current = true;
    } else if (destCoords) {
      map.setCenter(destCoords);
      map.setZoom(13);
      hasFitBoundsRef.current = true;
    }
  }, [map, driverLoc, destCoords]);

  // Throttled live route + traffic ETA calculation (<= once per 60s or >=0.25 mi moved)
  useEffect(() => {
    if (!renderer || !serviceRef.current || isTerminal || !driverLoc) return;
    const destinationTarget = destCoords || destAddr;
    if (!destinationTarget) return;

    const now = Date.now();
    const last = lastCalcRef.current;
    const movedMiles = last.lat !== null && last.lng !== null
      ? haversineMiles({ lat: last.lat, lng: last.lng }, driverLoc)
      : Infinity;
    const destKey = typeof destinationTarget === 'string'
      ? destinationTarget
      : `${destinationTarget.lat},${destinationTarget.lng}`;

    if (last.dest === destKey && now - last.ts < 60000 && movedMiles < 0.25) {
      return;
    }

    lastCalcRef.current = { ts: now, lat: driverLoc.lat, lng: driverLoc.lng, dest: destKey };
    let cancelled = false;

    serviceRef.current.route({
      origin: driverLoc,
      destination: destinationTarget,
      travelMode: 'DRIVING',
      drivingOptions: {
        departureTime: new Date(),
        trafficModel: 'bestguess'
      }
    }).then((response) => {
      if (cancelled || !response?.routes?.length) return;
      renderer.setDirections(response);
      const leg = response.routes[0]?.legs?.[0];
      if (!leg) return;
      if (!hasProvidedDestCoords && leg.end_location) {
        const endLat = typeof leg.end_location.lat === 'function' ? leg.end_location.lat() : leg.end_location.lat;
        const endLng = typeof leg.end_location.lng === 'function' ? leg.end_location.lng() : leg.end_location.lng;
        if (typeof endLat === 'number' && typeof endLng === 'number') {
          setResolvedDestCoords({ lat: endLat, lng: endLng });
        }
      }
      const secs = leg.duration_in_traffic?.value || leg.duration?.value || 0;
      const meters = leg.distance?.value || 0;
      const h = Math.floor(secs / 3600);
      const m = Math.max(1, Math.round((secs % 3600) / 60));
      const eta = h > 0 ? `${h}h ${m}m` : `${m}m`;
      const dist = `${(meters * 0.000621371).toFixed(1)} mi`;
      onLiveEstimate({ eta, dist, isApprox: false });
    }).catch(() => {
      // Fallback handled by parent geodesic estimate
    });

    return () => {
      cancelled = true;
    };
  }, [renderer, isTerminal, driverLoc, destCoords, destAddr, hasProvidedDestCoords, onLiveEstimate]);

  const fallbackCenter = driverLoc || destCoords || { lat: 39.8283, lng: -98.5795 };

  return (
    <Map
      defaultCenter={fallbackCenter}
      defaultZoom={driverLoc || destCoords ? 12 : 4}
      gestureHandling="greedy"
      disableDefaultUI={false}
      mapId="vecto-customer-track"
      colorScheme="DARK"
      className="w-full h-full"
    >
      {!isTerminal && driverLoc && (
        <AdvancedMarker position={driverLoc} zIndex={1000} title="Driver Live Location">
          <div className="flex flex-col items-center">
            <div className="px-2 py-0.5 mb-1 rounded-full bg-sky-500 text-slate-950 font-extrabold text-[10px] shadow-lg border border-white/40 whitespace-nowrap">
              {trackingData.driverFirstName || 'Driver'}
            </div>
            <Pin background="#0ea5e9" borderColor="#ffffff" glyphColor="#ffffff" scale={1.15} />
          </div>
        </AdvancedMarker>
      )}
      {destCoords && (
        <AdvancedMarker position={destCoords} zIndex={900} title="Delivery Destination">
          <div className="flex flex-col items-center">
            <div className="px-2 py-0.5 mb-1 rounded-full bg-emerald-500 text-slate-950 font-extrabold text-[10px] shadow-lg border border-white/40 whitespace-nowrap">
              Drop-Off
            </div>
            <Pin background="#10b981" borderColor="#ffffff" glyphColor="#ffffff" scale={1.05} />
          </div>
        </AdvancedMarker>
      )}
    </Map>
  );
}

export default function CustomerTrackingView({ token }) {
  const [trackingData, setTrackingData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [liveEstimate, setLiveEstimate] = useState(null);
  const [, setTick] = useState(0);

  const mapsKey =
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY ||
    (() => {
      try {
        return localStorage.getItem('mapsApiKey') || '';
      } catch {
        return '';
      }
    })();

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 15000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!token) {
      setErrorMsg('Invalid tracking link.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorMsg('');

    const unsub = onSnapshot(
      doc(db, 'public_tracking', token),
      (snap) => {
        if (!snap.exists()) {
          setTrackingData(null);
          setErrorMsg('This live tracking link is invalid or has expired.');
          setLoading(false);
          return;
        }
        const data = snap.data();
        if (data?.revoked) {
          setTrackingData(null);
          setErrorMsg('This live tracking link was revoked by dispatch.');
          setLoading(false);
          return;
        }
        setTrackingData(data);
        setErrorMsg('');
        setLoading(false);
      },
      (err) => {
        console.warn('Customer tracking error:', err);
        setTrackingData(null);
        setErrorMsg('This live tracking link is unavailable or has been revoked.');
        setLoading(false);
      }
    );

    return () => unsub();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0b0f19] text-white flex flex-col items-center justify-center p-6">
        <h1 className="text-4xl font-black vecto-brand-title tracking-widest mb-4">VECTO</h1>
        <p className="text-sm text-slate-400">Connecting to live delivery feed...</p>
      </div>
    );
  }

  if (errorMsg || !trackingData) {
    return (
      <div className="min-h-screen bg-[#0b0f19] text-white flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto">
            <AlertTriangle size={24} />
          </div>
          <h1 className="text-xl font-bold text-white">Tracking Unavailable</h1>
          <p className="text-sm text-slate-400">{errorMsg}</p>
        </div>
      </div>
    );
  }

  const isTerminal = ['completed', 'cancelled', 'archived'].includes(trackingData.status);
  const stepIdx = getStatusStepIndex(trackingData.status, trackingData.stopsSummary);
  const steps = ['Assigned', 'En Route', 'At Stop', 'Delivered'];

  let displayEta = liveEstimate?.eta || trackingData.etaText || null;
  let displayDist = liveEstimate?.dist || trackingData.distanceRemainingText || null;
  let isApproxEta = liveEstimate?.isApprox || false;

  if (!isTerminal && !displayEta && trackingData.driverLocation && trackingData.destinationCoords) {
    const straightMiles = haversineMiles(trackingData.driverLocation, trackingData.destinationCoords);
    if (straightMiles > 0) {
      const estRoadMiles = straightMiles * 1.3;
      const estMinutes = Math.max(2, Math.round((estRoadMiles / 35) * 60));
      displayEta = estMinutes >= 60
        ? `~${Math.floor(estMinutes / 60)}h ${estMinutes % 60}m`
        : `~${estMinutes}m`;
      displayDist = `~${estRoadMiles.toFixed(1)} mi`;
      isApproxEta = true;
    }
  }

  const stopsSummary = Array.isArray(trackingData.stopsSummary) ? trackingData.stopsSummary : [];

  return (
    <div className="min-h-screen bg-[#0b0f19] text-white flex flex-col md:flex-row overflow-hidden">
      {/* Left/Top Info Column */}
      <div className="w-full md:w-[400px] lg:w-[430px] bg-slate-950 border-b md:border-b-0 md:border-r border-white/10 p-5 flex flex-col gap-4 overflow-y-auto max-h-[52vh] md:max-h-screen shrink-0 z-10">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-black vecto-brand-title tracking-wider">VECTO</span>
              <span className="text-xs text-slate-400 font-semibold truncate max-w-[190px]">
                • {trackingData.companyName || 'Live Delivery'}
              </span>
            </div>
            <h1 className="text-xl font-bold text-white mt-1 leading-tight">
              {trackingData.jobName || 'Delivery Tracking'}
            </h1>
          </div>

          {!isTerminal ? (
            <span className="px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center gap-1.5 shrink-0">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </span>
          ) : (
            <span className="px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-300 text-xs font-bold uppercase shrink-0">
              {trackingData.status}
            </span>
          )}
        </div>

        {/* 4-Stage Delivery Stepper */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5">
          <div className="grid grid-cols-4 gap-1.5">
            {steps.map((label, idx) => {
              const reached = idx <= stepIdx;
              return (
                <div key={label} className="flex flex-col items-center text-center gap-1.5">
                  <div
                    className={`w-full h-1.5 rounded-full ${
                      reached ? 'bg-gradient-to-r from-sky-400 to-emerald-400' : 'bg-slate-800'
                    }`}
                  />
                  <span className={`text-[11px] font-bold ${reached ? 'text-white' : 'text-slate-500'}`}>
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ETA & Driver Summary */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-sky-400 mb-1">
              <Clock size={13} />
              <span>Estimated ETA</span>
            </div>
            <p className="text-lg font-extrabold text-white">
              {trackingData.status === 'completed'
                ? 'Delivered'
                : (displayEta || 'En Route')}
            </p>
            {!isTerminal && displayDist && (
              <p className="text-[11px] text-slate-400">
                {displayDist} remaining{isApproxEta ? ' (est.)' : ''}
              </p>
            )}
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-400 mb-1">
              <Truck size={13} />
              <span>Courier / Driver</span>
            </div>
            <p className="text-lg font-extrabold text-white truncate">
              {trackingData.driverFirstName || 'Assigned Driver'}
            </p>
            <p className="text-[11px] text-slate-400 truncate">
              {formatElapsed(trackingData.updatedAt)}
            </p>
          </div>
        </div>

        {/* Proof of Delivery Badge */}
        {trackingData.podCompleted && (
          <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40 flex items-center gap-2.5 text-emerald-300">
            <PackageCheck size={18} className="shrink-0" />
            <div className="text-xs">
              <p className="font-bold">Proof of Delivery Recorded</p>
              <p className="text-[11px] text-emerald-300/80">
                Delivery confirmation has been logged by the driver.
              </p>
            </div>
          </div>
        )}

        {/* Sanitized Stop Progress */}
        {stopsSummary.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Navigation size={13} />
              <span>Delivery Stops ({stopsSummary.filter((s) => s.status === 'completed').length}/{stopsSummary.length})</span>
            </h2>
            <ul className="space-y-2">
              {stopsSummary.map((stop, idx) => {
                const done = stop.status === 'completed';
                const arrived = stop.status === 'arrived';
                return (
                  <li
                    key={idx}
                    className={`p-2.5 rounded-xl border text-xs flex items-start justify-between gap-2 ${
                      done
                        ? 'bg-emerald-950/25 border-emerald-500/30 text-slate-300'
                        : arrived
                        ? 'bg-amber-950/25 border-amber-500/35 text-white'
                        : 'bg-slate-900/70 border-slate-800 text-slate-200'
                    }`}
                  >
                    <div className="flex items-start gap-2 min-w-0">
                      <span
                        className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5 ${
                          done
                            ? 'bg-emerald-500/25 text-emerald-300'
                            : arrived
                            ? 'bg-amber-500/25 text-amber-300'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {stop.order || idx + 1}
                      </span>
                      <div className="min-w-0">
                        <p className={`break-words leading-snug ${done ? 'line-through text-slate-400' : ''}`}>
                          {stop.label}
                        </p>
                        {stop.hasPod && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-semibold mt-0.5">
                            <CheckCircle2 size={10} /> POD Verified
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 shrink-0">
                      {done ? 'Done' : arrived ? 'Arrived' : 'En Route'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="mt-auto pt-3 border-t border-white/10 flex items-center gap-2 text-[11px] text-slate-500">
          <ShieldCheck size={14} className="text-sky-400 shrink-0" />
          <span>Read-only customer tracking view powered by VECTO.</span>
        </div>
      </div>

      {/* Map Canvas */}
      <div className="flex-1 min-h-[48vh] md:min-h-screen relative bg-slate-900">
        {mapsKey ? (
          <APIProvider apiKey={mapsKey}>
            <CustomerTrackingMap trackingData={trackingData} onLiveEstimate={setLiveEstimate} />
          </APIProvider>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center text-slate-400 gap-2">
            <MapPin size={28} className="text-sky-400" />
            <p className="text-sm font-semibold text-white">Live Map Preview Unavailable</p>
            <p className="text-xs max-w-sm">
              Delivery milestones and ETA updates remain active in real time above.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
