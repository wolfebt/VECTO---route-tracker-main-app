import React, { useEffect, useState, useMemo } from 'react';
import { Map, useMap, AdvancedMarker, Pin, InfoWindow } from '@vis.gl/react-google-maps';
import { useAppStore } from '../../store/useAppStore';
import { useJobs, useActiveDrivers } from '../../hooks/useFirebase';
import { useDirections } from '../../hooks/useDirections';
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
    const active = drivers.filter(d => {
        if (!d.timestamp) return true;
        if (typeof d.timestamp.toMillis !== 'function') return true;
        return d.timestamp.toMillis() > fiveMinAgo;
    });

    if (isDispatchView) {
      return active;
    }

    const myJobs = jobs.filter(j => j.status === 'in-progress' && j.assignedDrivers?.some(d => d.id === currentUser?.id));
    const myTeammates = new Set();
    myJobs.forEach(j => {
        j.assignedDrivers?.forEach(d => myTeammates.add(d.id));
    });

    return active.filter(d => d.id === currentUser?.id || myTeammates.has(d.id));
  }, [drivers, jobs, isDispatchView, currentUser?.id]);

  return (
    <>
      {visibleDrivers.map(driver => {
        let statusText = driver.status || 'Available';
        let pinColor = driver.color || '#22c55e';
        let glyphColor = '#ffffff';
        let borderColor = '#166534';

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

function TrafficOverlay() {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const trafficLayer = new google.maps.TrafficLayer();
    trafficLayer.setMap(map);
    return () => trafficLayer.setMap(null);
  }, [map]);
  return null;
}

export default function MapArea() {
  const apiKey = useAppStore(state => state.mapsApiKey) || import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const setMobileView = useAppStore(state => state.setMobileView);

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
      {/* Mobile Back to List Button */}
      <button 
        onClick={() => setMobileView('sidebar')}
        className="md:hidden absolute top-4 left-4 z-20 bg-slate-900/90 text-white border border-white/15 px-3.5 py-2 rounded-full text-xs font-bold shadow-xl flex items-center space-x-1.5 backdrop-blur-md hover:bg-slate-800 transition-colors"
        title="Back to List"
      >
        <span>← List</span>
      </button>

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
        <DriverMarkers />
      </Map>
      
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
