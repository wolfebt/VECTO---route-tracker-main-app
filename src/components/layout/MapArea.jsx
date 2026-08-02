import React, { useEffect, useState, useMemo } from 'react';
import { Map, useMap, AdvancedMarker, Pin, InfoWindow } from '@vis.gl/react-google-maps';
import { useAppStore } from '../../store/useAppStore';
import { useJobs, useActiveDrivers } from '../../hooks/useFirebase';
import { useDirections } from '../../hooks/useDirections';
import RouteOutlineOverlay from './RouteOutlineOverlay';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';

const mapStyles = [
    { elementType: 'geometry', stylers: [{ color: '#242f3e' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#242f3e' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#746855' }] },
    { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
    { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
    { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#263c3f' }] },
    { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#6b9a76' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#38414e' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#212a37' }] },
    { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9ca5b3' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#746855' }] },
    { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1f2835' }] },
    { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#f3d19c' }] },
    { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#2f3948' }] },
    { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#17263c' }] },
    { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#515c6d' }] },
    { featureType: 'water', elementType: 'labels.text.stroke', stylers: [{ color: '#17263c' }] }
];

function DirectionsComponent() {
  const map = useMap();
  const selectedJobId = useAppStore(state => state.selectedJobId);
  const jobs = useJobs();

  useDirections({ map, selectedJobId, jobs });

  return null;
}

function DriverMarkers() {
  const drivers = useActiveDrivers();
  const jobs = useJobs();
  const isDispatchView = useAppStore(state => state.isDispatchView);
  const currentUser = useAppStore(state => state.currentUser);
  const companyId = useAppStore(state => state.companyId);
  const [selectedDriverId, setSelectedDriverId] = useState(null);
  const [showNameplates, setShowNameplates] = useState(true);
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    const listener = map.addListener('click', () => {
      setSelectedDriverId(null);
    });
    return () => google.maps.event.removeListener(listener);
  }, [map]);

  useEffect(() => {
     if (!companyId || !currentUser) return;
     const unsub = onSnapshot(doc(db, 'companies', companyId), (snap) => {
         if (snap.exists()) {
             setShowNameplates(snap.data().showNameplates !== false);
         }
     }, (error) => {
         console.warn("Company document snapshot error:", error);
     });
     return () => unsub();
  }, [companyId, currentUser]);

  const visibleDrivers = useMemo(() => {
    const fiveMinAgo = Date.now() - (5 * 60 * 1000);
    return drivers.filter(d => {
        if (d.id === currentUser?.id) return false;
        if (!d.timestamp) return true;
        if (typeof d.timestamp.toMillis !== 'function') return true;
        return d.timestamp.toMillis() > fiveMinAgo;
    });
  }, [drivers, currentUser?.id]);

  return (
    <>
      {visibleDrivers.map(driver => {
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
                    <Pin background={pinColor} borderColor={borderColor} glyphColor={glyphColor} scale={1.2} />
                    {showNameplates && (
                        <div className="absolute top-full mt-0.5 px-1.5 py-0.5 bg-gray-900/90 backdrop-blur-sm rounded text-[10px] text-gray-200 font-bold shadow-lg border border-gray-700/50 whitespace-nowrap z-10 pointer-events-none">
                           {driver.name || 'Unnamed'} <span className="text-gray-400 font-normal">({statusText.startsWith('On Trip') ? 'Driving' : statusText})</span>
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
                     <p className="text-xs mb-1">{statusText}</p>
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

function MapController() {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    
    // Initial centering
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        map.setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        map.setZoom(15);
      }, (err) => {
        console.warn("Could not get initial location", err);
      }, { enableHighAccuracy: true, maximumAge: 0 });
    }

    // Listen for manual recenter events from the button
    const handleRecenter = (e) => {
      map.setCenter({ lat: e.detail.lat, lng: e.detail.lng });
      map.setZoom(15);
    };
    window.addEventListener('recenter-map', handleRecenter);
    
    return () => {
      window.removeEventListener('recenter-map', handleRecenter);
    };
  }, [map]);
  return null;
}

function MyLocationMarker() {
  const [location, setLocation] = useState(null);
  const currentUser = useAppStore(state => state.currentUser);
  const isDispatchView = useAppStore(state => state.isDispatchView);
  
  useEffect(() => {
    if (isDispatchView || !navigator.geolocation) return;
    
    // Get initial
    navigator.geolocation.getCurrentPosition(
      pos => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true }
    );
    
    // Watch
    const watchId = navigator.geolocation.watchPosition(
      pos => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 0 }
    );
    
    return () => navigator.geolocation.clearWatch(watchId);
  }, [isDispatchView]);

  if (!location || !currentUser || isDispatchView) return null;

  const pinColor = currentUser.color || '#22c55e';

  return (
    <AdvancedMarker 
       position={location}
       zIndex={1001}
       title="My Location"
    >
       <div className="flex flex-col items-center hover:scale-110 transition-transform origin-bottom relative">
           <Pin background={pinColor} borderColor="#166534" glyphColor="#ffffff" scale={1.2} />
           <div className="absolute top-full mt-0.5 px-1.5 py-0.5 bg-gray-900/90 backdrop-blur-sm rounded text-[10px] text-gray-200 font-bold shadow-lg border border-gray-700/50 whitespace-nowrap z-10 pointer-events-none">
              Me
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
  const setMobileView = useAppStore(state => state.setMobileView);

  const routeInfo = useAppStore(state => state.routeInfo);
  const routeStyle = useAppStore(state => state.routeStyle);
  const setRouteStyle = useAppStore(state => state.setRouteStyle);
  const showTrafficLayer = useAppStore(state => state.showTrafficLayer);
  const setShowTrafficLayer = useAppStore(state => state.setShowTrafficLayer);

  if (!apiKey) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-gray-800 text-center p-4">
        <div>
          <p className="text-red-400 font-bold mb-2">Map Authentication Failed</p>
          <p className="text-gray-400 text-sm mb-4">Your API key is missing or invalid.</p>
          <button className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Settings</button>
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
        <DirectionsComponent />
        {routeInfo?.overviewPath && (
          <RouteOutlineOverlay
            path={routeInfo.overviewPath}
            stepTraffics={routeInfo.stepTraffics}
            routeColor={routeInfo.routeColor}
            routeStyle={routeStyle}
            jobId={routeInfo.jobId}
          />
        )}
        <DriverMarkers />
        <MyLocationMarker />
      </Map>

      {/* Floating Map Controls (Top Right / Above Map Controls) */}
      <div className="absolute top-4 right-14 z-20 flex flex-col gap-2 bg-gray-900/90 backdrop-blur-md p-1.5 rounded-xl border border-gray-700/60 shadow-2xl text-xs">
        <div className="flex items-center justify-between gap-2 px-1 border-b border-gray-800 pb-1">
          <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Route View</span>
          <button
            type="button"
            onClick={() => setShowTrafficLayer(!showTrafficLayer)}
            className={`px-2 py-0.5 rounded text-[11px] font-semibold flex items-center gap-1 transition-all ${
              showTrafficLayer
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
            title="Toggle Live Google Maps Traffic Layer"
          >
            <span className={`w-2 h-2 rounded-full ${showTrafficLayer ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500'}`} />
            Live Traffic
          </button>
        </div>

        {/* Route Style Pills */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setRouteStyle('outlined')}
            className={`flex-1 px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition-all ${
              routeStyle === 'outlined'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-900/40 border border-blue-400/30'
                : 'bg-gray-800/80 text-gray-300 hover:bg-gray-700/80'
            }`}
            title="Outline with transparent center showing map road"
          >
            <span className="text-sm">🛣️</span> Outline Path
          </button>

          <button
            type="button"
            onClick={() => setRouteStyle('traffic')}
            className={`flex-1 px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition-all ${
              routeStyle === 'traffic'
                ? 'bg-amber-600 text-white shadow-md shadow-amber-900/40 border border-amber-400/30'
                : 'bg-gray-800/80 text-gray-300 hover:bg-gray-700/80'
            }`}
            title="Road conditions by traffic speed (Green, Orange, Red)"
          >
            <span className="text-sm">🚦</span> Traffic Status
          </button>

          <button
            type="button"
            onClick={() => setRouteStyle('solid')}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition-all ${
              routeStyle === 'solid'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-900/40 border border-purple-400/30'
                : 'bg-gray-800/80 text-gray-300 hover:bg-gray-700/80'
            }`}
            title="Solid route highlight line"
          >
            <span className="text-sm">🟦</span> Solid
          </button>
        </div>
      </div>
      
      {/* My Location Button */}
      <button 
        type="button"
        aria-label="My Location"
        onClick={() => {
          if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition((pos) => {
              window.dispatchEvent(new CustomEvent('recenter-map', {
                detail: { lat: pos.coords.latitude, lng: pos.coords.longitude }
              }));
            }, (err) => {
              console.warn(err);
              import('../../store/useToastStore').then(({ useToastStore }) => {
                 useToastStore.getState().addToast("Could not get your location. Please check browser permissions.", "error");
              });
            }, { enableHighAccuracy: true, maximumAge: 0 });
          } else {
            import('../../store/useToastStore').then(({ useToastStore }) => {
                 useToastStore.getState().addToast("Geolocation is not supported by your browser.", "error");
            });
          }
        }}
        className="absolute bottom-20 md:bottom-8 left-1/2 -translate-x-1/2 bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-full shadow-lg z-10 flex items-center justify-center transition-colors"
        title="My Location"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
        </svg>
      </button>
    </>
  );
}
