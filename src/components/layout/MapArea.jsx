import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Map, useMap, AdvancedMarker, Pin, InfoWindow } from '@vis.gl/react-google-maps';
import { useAppStore } from '../../store/useAppStore';
import { useToastStore } from '../../store/useToastStore';
import { useJobs, useActiveDrivers, useVehicles } from '../../hooks/useFirebase';
import { useDirections } from '../../hooks/useDirections';
import { toMillisSafe } from '../../utils/formatters';
import { clusterDriverMarkers } from '../../utils/mapCluster';
import { normalizeJobStops } from '../../utils/stops';
import RouteOutlineOverlay from './RouteOutlineOverlay';

function DirectionsComponent() {
  const map = useMap();
  const selectedJobId = useAppStore(state => state.selectedJobId);
  const jobs = useJobs();

  useDirections({ map, selectedJobId, jobs });

  return null;
}

function HeadingArrowBadge({ heading, color = '#38bdf8' }) {
  if (typeof heading !== 'number' || !Number.isFinite(heading)) return null;
  return (
    <div
      className="w-5 h-5 rounded-full bg-slate-950/90 border border-white/40 shadow-md flex items-center justify-center mb-0.5"
      title={`Heading ${Math.round(heading)}°`}
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill={color}
        style={{ transform: `rotate(${heading}deg)` }}
        aria-hidden="true"
      >
        <path d="M12 2L19 20L12 16L5 20L12 2Z" />
      </svg>
    </div>
  );
}

function DriverMarkers() {
  const drivers = useActiveDrivers();
  const jobs = useJobs();
  const vehicles = useVehicles();
  const currentUser = useAppStore(state => state.currentUser);
  const showNameplates = useAppStore(state => state.showNameplates);
  const [selectedDriverId, setSelectedDriverId] = useState(null);
  const [zoom, setZoom] = useState(12);
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    const initialZoom = map.getZoom();
    if (typeof initialZoom === 'number') setZoom(initialZoom);

    const clickListener = map.addListener('click', () => {
      setSelectedDriverId(null);
    });
    const zoomListener = map.addListener('zoom_changed', () => {
      const z = map.getZoom();
      if (typeof z === 'number') setZoom(z);
    });
    return () => {
      google.maps.event.removeListener(clickListener);
      google.maps.event.removeListener(zoomListener);
    };
  }, [map]);

  const visibleDrivers = useMemo(() => {
    const fiveMinAgo = Date.now() - (5 * 60 * 1000);
    return drivers.filter(d => {
        if (d.id === currentUser?.id) return false;
        if (!d.location || typeof d.location.latitude !== 'number' || typeof d.location.longitude !== 'number') return false;
        if (!d.timestamp) return true;
        const tsMs = toMillisSafe(d.timestamp);
        if (!tsMs) return true;
        return tsMs > fiveMinAgo;
    });
  }, [drivers, currentUser?.id]);

  const clusteredItems = useMemo(() => {
    return clusterDriverMarkers(visibleDrivers, zoom);
  }, [visibleDrivers, zoom]);

  const handleClusterClick = (clusterDrivers) => {
    if (!map || !window.google?.maps || !clusterDrivers?.length) return;
    const bounds = new window.google.maps.LatLngBounds();
    clusterDrivers.forEach((d) => {
      bounds.extend({ lat: d.location.latitude, lng: d.location.longitude });
    });
    map.fitBounds(bounds, 72);
  };

  return (
    <>
      {clusteredItems.map(item => {
        if (item.type === 'cluster') {
          return (
            <AdvancedMarker
              key={item.id}
              position={item.position}
              onClick={() => handleClusterClick(item.drivers)}
              zIndex={950}
              title={`${item.drivers.length} active drivers (click to zoom)`}
              className="cursor-pointer"
            >
              <div className="px-2.5 py-1.5 rounded-full bg-sky-600/95 hover:bg-sky-500 text-white font-extrabold text-xs shadow-xl border-2 border-white/80 flex items-center gap-1.5 transition-transform hover:scale-110">
                <span className="w-2 h-2 rounded-full bg-emerald-300 animate-pulse" />
                <span>{item.drivers.length} Drivers</span>
              </div>
            </AdvancedMarker>
          );
        }

        const driver = item.driver;
        let statusText = driver.status || 'Available';
        let pinColor = driver.color || '#22c55e';
        let glyphColor = '#ffffff';
        let borderColor = driver.color ? '#00000055' : '#166534';

        const assignedJob = jobs.find(j => j.status === 'in-progress' && j.assignedDrivers?.some(d => d.id === driver.id));
        if (assignedJob) {
            statusText = `On Trip: ${assignedJob.jobName}`;
            if (!driver.color) {
                pinColor = '#eab308';
                borderColor = '#854d0e';
            }
        } else if (driver.status === 'Offline') {
            if (!driver.color) {
                pinColor = '#6b7280';
                borderColor = '#374151';
            }
        }

        const isSelected = selectedDriverId === driver.id;
        const speedMph = typeof driver.speed === 'number' && Number.isFinite(driver.speed) ? driver.speed : null;
        const assignedVehicle =
          vehicles.find((v) => v.id === assignedJob?.vehicleId) ||
          vehicles.find((v) => v.assignedDriverId === driver.id && v.status !== 'out_of_service');

        return (
          <React.Fragment key={driver.id}>
             <AdvancedMarker 
                position={{ lat: driver.location.latitude, lng: driver.location.longitude }}
                onClick={() => setSelectedDriverId(driver.id)}
                className="cursor-pointer"
                zIndex={isSelected ? 1000 : 1}
                title={`${driver.name || 'Unnamed'} - ${statusText}`}
             >
                <div className="flex flex-col items-center hover:scale-110 transition-transform origin-bottom relative">
                    <HeadingArrowBadge heading={driver.heading} color={pinColor} />
                    <Pin background={pinColor} borderColor={borderColor} glyphColor={glyphColor} scale={1.2} />
                    {showNameplates && (
                        <div className="absolute top-full mt-0.5 px-1.5 py-0.5 bg-gray-900/90 backdrop-blur-sm rounded text-[10px] text-gray-200 font-bold shadow-lg border border-gray-700/50 whitespace-nowrap z-10 pointer-events-none">
                           {driver.name || 'Unnamed'}{' '}
                           {assignedVehicle?.unitNumber && (
                             <span className="text-sky-300 font-mono">[{assignedVehicle.unitNumber}] </span>
                           )}
                           <span className="text-gray-400 font-normal">
                             ({statusText.startsWith('On Trip') ? 'Driving' : statusText}
                             {speedMph !== null && speedMph > 1 ? ` • ${Math.round(speedMph)} mph` : ''})
                           </span>
                        </div>
                    )}
                </div>
             </AdvancedMarker>
             
             {isSelected && (
                <InfoWindow
                  position={{ lat: driver.location.latitude, lng: driver.location.longitude }}
                  onCloseClick={() => setSelectedDriverId(null)}
                  headerDisabled={true}
                >
                  <div 
                    className="p-2 text-black max-w-xs cursor-pointer"
                    onClick={() => setSelectedDriverId(null)}
                  >
                     <strong className="block mb-1 font-bold">{driver.name || 'Unnamed'}</strong>
                     <p className="text-xs mb-1 text-gray-700">{statusText}</p>
                     {assignedVehicle && (
                       <p className="text-[11px] font-semibold text-sky-700 mb-1">
                         🚚 Unit {assignedVehicle.unitNumber}
                         {assignedVehicle.makeModel ? ` • ${assignedVehicle.makeModel}` : ''}
                       </p>
                     )}
                     {speedMph !== null && (
                       <p className="text-[11px] text-gray-600 font-mono mb-1">
                         Speed: {Math.round(speedMph)} mph
                         {typeof driver.heading === 'number' ? ` • Hdg ${Math.round(driver.heading)}°` : ''}
                       </p>
                     )}
                     {(driver.phone || driver.number) && (
                        <p className="text-xs font-mono text-blue-700 mb-1 font-semibold">📞 {driver.phone || driver.number}</p>
                     )}
                     <p className="text-[9px] text-gray-500 italic mt-1 border-t pt-1 border-gray-200">(Click here or outside to close)</p>
                  </div>
                </InfoWindow>
             )}
          </React.Fragment>
        );
      })}
    </>
  );
}

function FleetActiveRoutesOverlay() {
  const map = useMap();
  const isDispatchView = useAppStore(state => state.isDispatchView);
  const showAllActiveRoutes = useAppStore(state => state.showAllActiveRoutes);
  const selectedJobId = useAppStore(state => state.selectedJobId);
  const setSelectedJobId = useAppStore(state => state.setSelectedJobId);
  const colors = useAppStore(state => state.colors);
  const jobs = useJobs();
  const activeDrivers = useActiveDrivers();
  const polylinesRef = useRef([]);

  useEffect(() => {
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];

    if (!map || !isDispatchView || !showAllActiveRoutes || !window.google?.maps) return;

    const activeJobs = jobs.filter(
      (j) =>
        !j.archived &&
        j.id !== selectedJobId &&
        (j.status === 'in-progress' || j.status === 'assigned')
    );

    const created = [];
    activeJobs.forEach((job) => {
      const stopPts = normalizeJobStops(job)
        .filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number')
        .map((s) => ({ lat: s.lat, lng: s.lng }));

      const pathPts = [...stopPts];
      if (job.status === 'in-progress' && Array.isArray(job.assignedDrivers)) {
        const assignedDrv = job.assignedDrivers
          .map((d) => activeDrivers.find((ad) => ad.id === d.id))
          .find((ad) => typeof ad?.location?.latitude === 'number' && typeof ad?.location?.longitude === 'number');
        if (assignedDrv) {
          pathPts.unshift({ lat: assignedDrv.location.latitude, lng: assignedDrv.location.longitude });
        }
      }

      if (pathPts.length < 2) return;

      let hash = 0;
      for (let i = 0; i < job.id.length; i++) {
        hash = job.id.charCodeAt(i) + ((hash << 5) - hash);
      }
      const color = job.routeColor || colors[Math.abs(hash) % colors.length];

      const line = new window.google.maps.Polyline({
        map,
        path: pathPts,
        strokeColor: color,
        strokeOpacity: 0.72,
        strokeWeight: 4,
        zIndex: 1,
        clickable: true,
      });
      line.addListener('click', () => {
        setSelectedJobId(job.id);
      });
      created.push(line);
    });

    polylinesRef.current = created;

    return () => {
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };
  }, [map, isDispatchView, showAllActiveRoutes, selectedJobId, jobs, activeDrivers, colors, setSelectedJobId]);

  return null;
}

function MapController() {
  const map = useMap();
  useEffect(() => {
    if (!map) return;

    const existingLoc = useAppStore.getState().currentLocation;
    if (existingLoc?.lat && existingLoc?.lng) {
      map.setCenter({ lat: existingLoc.lat, lng: existingLoc.lng });
      map.setZoom(15);
    } else if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        map.setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        map.setZoom(15);
      }, (err) => {
        console.warn("Could not get initial location", err);
      }, { enableHighAccuracy: true, maximumAge: 0 });
    }

    const handleRecenter = (e) => {
      map.setCenter({ lat: e.detail.lat, lng: e.detail.lng });
      map.setZoom(15);
    };

    const handleFitFleet = () => {
      if (!window.google?.maps) return;
      const state = useAppStore.getState();
      const bounds = new window.google.maps.LatLngBounds();
      let count = 0;

      const fiveMinAgo = Date.now() - (5 * 60 * 1000);
      (state.activeDrivers || []).forEach((d) => {
        if (typeof d.location?.latitude !== 'number' || typeof d.location?.longitude !== 'number') return;
        const tsMs = toMillisSafe(d.timestamp);
        if (d.timestamp && tsMs && tsMs < fiveMinAgo) return;
        bounds.extend({ lat: d.location.latitude, lng: d.location.longitude });
        count += 1;
      });

      if (typeof state.currentLocation?.lat === 'number' && typeof state.currentLocation?.lng === 'number') {
        bounds.extend({ lat: state.currentLocation.lat, lng: state.currentLocation.lng });
        count += 1;
      }

      if (Array.isArray(state.routeInfo?.overviewPath)) {
        state.routeInfo.overviewPath.forEach((pt) => {
          const lat = typeof pt.lat === 'function' ? pt.lat() : pt.lat;
          const lng = typeof pt.lng === 'function' ? pt.lng() : pt.lng;
          if (typeof lat === 'number' && typeof lng === 'number') {
            bounds.extend({ lat, lng });
            count += 1;
          }
        });
      }

      if (count === 0) {
        useToastStore.getState().addToast("No active fleet locations available to fit.", "info");
        return;
      }
      if (count === 1) {
        map.setCenter(bounds.getCenter());
        map.setZoom(15);
        return;
      }
      map.fitBounds(bounds, 64);
    };

    const handleFitRoute = () => {
      if (!window.google?.maps) return;
      const path = useAppStore.getState().routeInfo?.overviewPath;
      if (!Array.isArray(path) || path.length < 2) return;
      const bounds = new window.google.maps.LatLngBounds();
      path.forEach((pt) => {
        const lat = typeof pt.lat === 'function' ? pt.lat() : pt.lat;
        const lng = typeof pt.lng === 'function' ? pt.lng() : pt.lng;
        if (typeof lat === 'number' && typeof lng === 'number') {
          bounds.extend({ lat, lng });
        }
      });
      map.fitBounds(bounds, 56);
    };

    window.addEventListener('recenter-map', handleRecenter);
    window.addEventListener('fit-fleet-bounds', handleFitFleet);
    window.addEventListener('fit-route-bounds', handleFitRoute);
    
    return () => {
      window.removeEventListener('recenter-map', handleRecenter);
      window.removeEventListener('fit-fleet-bounds', handleFitFleet);
      window.removeEventListener('fit-route-bounds', handleFitRoute);
    };
  }, [map]);
  return null;
}

function MyLocationMarker() {
  const currentUser = useAppStore(state => state.currentUser);
  const isDispatchView = useAppStore(state => state.isDispatchView);
  const isSharingLocation = useAppStore(state => state.isSharingLocation);
  const storeLocation = useAppStore(state => state.currentLocation);
  const drivers = useActiveDrivers();

  if (!currentUser || isDispatchView || !isSharingLocation) return null;

  const myDriverDoc = drivers.find(d => d.id === currentUser.id);
  let location = storeLocation ? { lat: storeLocation.lat, lng: storeLocation.lng } : null;
  let heading = typeof storeLocation?.heading === 'number' ? storeLocation.heading : null;
  let speed = typeof storeLocation?.speed === 'number' ? storeLocation.speed : null;

  if (!location && currentUser) {
    if (typeof myDriverDoc?.location?.latitude === 'number' && typeof myDriverDoc?.location?.longitude === 'number') {
      location = { lat: myDriverDoc.location.latitude, lng: myDriverDoc.location.longitude };
    }
  }
  if (heading === null && typeof myDriverDoc?.heading === 'number') heading = myDriverDoc.heading;
  if (speed === null && typeof myDriverDoc?.speed === 'number') speed = myDriverDoc.speed;

  if (!location) return null;

  const pinColor = currentUser.color || '#22c55e';

  return (
    <AdvancedMarker 
       position={location}
       zIndex={1001}
       title="My Location"
    >
       <div className="flex flex-col items-center hover:scale-110 transition-transform origin-bottom relative">
           <HeadingArrowBadge heading={heading} color={pinColor} />
           <Pin background={pinColor} borderColor="#166534" glyphColor="#ffffff" scale={1.2} />
           <div className="absolute top-full mt-0.5 px-1.5 py-0.5 bg-gray-900/90 backdrop-blur-sm rounded text-[10px] text-gray-200 font-bold shadow-lg border border-gray-700/50 whitespace-nowrap z-10 pointer-events-none">
              Me{speed !== null && speed > 1 ? ` • ${Math.round(speed)} mph` : ''}
           </div>
       </div>
    </AdvancedMarker>
  );
}

function TrafficOverlay() {
  const map = useMap();
  const showTrafficLayer = useAppStore(state => state.showTrafficLayer);

  useEffect(() => {
    if (!map || !showTrafficLayer) return;
    const trafficLayer = new google.maps.TrafficLayer();
    trafficLayer.setMap(map);
    return () => trafficLayer.setMap(null);
  }, [map, showTrafficLayer]);
  return null;
}

export default function MapArea() {
  const apiKey = useAppStore(state => state.mapsApiKey) || import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const openModal = useAppStore(state => state.openModal);

  const routeInfo = useAppStore(state => state.routeInfo);
  const routeStyle = useAppStore(state => state.routeStyle);
  const currentLocation = useAppStore(state => state.currentLocation);

  if (!apiKey) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-gray-800 text-center p-4">
        <div>
          <p className="text-red-400 font-bold mb-2">Map Authentication Failed</p>
          <p className="text-gray-400 text-sm mb-4">Your Google Maps API key is missing or invalid.</p>
          <button
            type="button"
            onClick={() => openModal('development')}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 cursor-pointer"
          >
            Developer Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Map
        defaultCenter={{ lat: 39.8283, lng: -98.5795 }}
        defaultZoom={4}
        gestureHandling={'greedy'}
        disableDefaultUI={false}
        mapId="vecto-main-map"
        colorScheme="DARK"
      >
        <MapController />
        <TrafficOverlay />
        <FleetActiveRoutesOverlay />
        <DirectionsComponent />
        {routeInfo?.overviewPath && (
          <RouteOutlineOverlay
            path={routeInfo.overviewPath}
            stepTraffics={routeInfo.stepTraffics}
            routeColor={routeInfo.routeColor}
            routeStyle={routeStyle}
            driverLocation={currentLocation}
          />
        )}
        <DriverMarkers />
        <MyLocationMarker />
      </Map>
      
      {/* Floating Map Controls Bar */}
      <div className="absolute bottom-20 md:bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2 z-10 bg-slate-950/85 backdrop-blur-md p-1.5 rounded-full border border-white/15 shadow-2xl">
        <button 
          type="button"
          aria-label="My Location"
          onClick={() => {
            if (currentLocation?.lat && currentLocation?.lng) {
              window.dispatchEvent(new CustomEvent('recenter-map', { detail: { lat: currentLocation.lat, lng: currentLocation.lng } }));
            }
            if (navigator.geolocation) {
              navigator.geolocation.getCurrentPosition((pos) => {
                window.dispatchEvent(new CustomEvent('recenter-map', {
                  detail: { lat: pos.coords.latitude, lng: pos.coords.longitude }
                }));
              }, (err) => {
                console.warn(err);
                if (!currentLocation) {
                  useToastStore.getState().addToast("Could not get your location. Please check browser permissions.", "error");
                }
              }, { enableHighAccuracy: true, maximumAge: 0 });
            } else if (!currentLocation) {
              useToastStore.getState().addToast("Geolocation is not supported by your browser.", "error");
            }
          }}
          className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-full shadow flex items-center gap-1.5 text-xs font-bold transition-colors cursor-pointer"
          title="Recenter on My Location"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
          </svg>
          <span className="hidden sm:inline">My Location</span>
        </button>

        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('fit-fleet-bounds'))}
          className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-2 rounded-full border border-white/10 text-xs font-bold transition-colors cursor-pointer"
          title="Zoom map to fit all active drivers"
        >
          Fit Fleet
        </button>

        {routeInfo?.overviewPath?.length >= 2 && (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('fit-route-bounds'))}
            className="bg-teal-600/90 hover:bg-teal-500 text-white px-3 py-2 rounded-full text-xs font-bold transition-colors cursor-pointer"
            title="Zoom map to fit selected route"
          >
            Fit Route
          </button>
        )}
      </div>
    </>
  );
}
