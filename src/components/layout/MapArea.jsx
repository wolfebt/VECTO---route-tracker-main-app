import React, { useEffect, useState } from 'react';
import { Map, useMap, useMapsLibrary, AdvancedMarker, Pin, InfoWindow } from '@vis.gl/react-google-maps';
import { useAppStore } from '../../store/useAppStore';
import { useJobs, useActiveDrivers } from '../../hooks/useFirebase';
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
  const routesLibrary = useMapsLibrary('routes');
  const [directionsService, setDirectionsService] = useState(null);
  const [directionsRenderer, setDirectionsRenderer] = useState(null);
  
  const selectedJobId = useAppStore(state => state.selectedJobId);
  const setRouteInfo = useAppStore(state => state.setRouteInfo);
  const jobs = useJobs();
  const colors = useAppStore(state => state.colors);

  // Initialize Directions Service and Renderer
  useEffect(() => {
    if (!routesLibrary || !map) return;
    const ds = new routesLibrary.DirectionsService();
    const dr = new routesLibrary.DirectionsRenderer({ map });
    setDirectionsService(ds);
    setDirectionsRenderer(dr);
    
    return () => dr.setMap(null);
  }, [routesLibrary, map]);

  // Update Route when selected job changes
  useEffect(() => {
    if (!directionsService || !directionsRenderer) return;

    if (!selectedJobId) {
      directionsRenderer.setMap(null);
      return;
    }

    const job = jobs.find(j => j.id === selectedJobId);
    if (!job) {
      directionsRenderer.setMap(null);
      return;
    }

    directionsRenderer.setMap(map);

    const dests = job.destinations || (job.destination ? [job.destination] : []);
    if (dests.length === 0) return;

    let waypoints = [];
    let finalDest = dests[0];

    if (dests.length > 1) {
         waypoints = dests.slice(0, -1).map(loc => ({ location: loc, stopover: true }));
         finalDest = dests[dests.length - 1];
    }

    // Set line color
    let hash = 0;
    for (let i = 0; i < job.id.length; i++) hash = job.id.charCodeAt(i) + ((hash << 5) - hash);
    const color = colors[Math.abs(hash) % colors.length];

    directionsRenderer.setOptions({
        polylineOptions: { strokeColor: color, strokeOpacity: 0.8, strokeWeight: 5 }
    });

    directionsService.route({
      origin: job.origin,
      destination: finalDest,
      waypoints: waypoints,
      optimizeWaypoints: job.optimizeRoute !== false,
      travelMode: 'DRIVING',
      drivingOptions: {
        departureTime: new Date(), // Request traffic-aware ETA
      }
    }).then(response => {
      directionsRenderer.setDirections(response);
      
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
          
          // Get final destination coordinates for weather API
          const lastLeg = route.legs[route.legs.length - 1];
          const endLoc = lastLeg ? lastLeg.end_location : null;
          const destCoords = endLoc ? { lat: endLoc.lat(), lng: endLoc.lng() } : null;

          // Extract plain-text step instructions for voice directions
          const allSteps = route.legs.flatMap(leg => leg.steps);
          const plainTextSteps = allSteps.map(step => {
             // Strip HTML tags provided by Google Maps
             const stripped = step.instructions ? step.instructions.replace(/<[^>]*>?/gm, '') : '';
             return stripped;
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
      import('../../store/useToastStore').then(({ useToastStore }) => {
        useToastStore.getState().addToast("Could not find a route for this job. Please check the addresses.", "error");
      });
    });

  }, [selectedJobId, jobs, directionsService, directionsRenderer, colors, setRouteInfo]);

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
     if (!companyId) return;
     const unsub = onSnapshot(doc(db, 'companies', companyId), (snap) => {
         if (snap.exists()) {
             setShowNameplates(snap.data().showNameplates !== false);
         }
     });
     return () => unsub();
  }, [companyId]);

  const fiveMinAgo = Date.now() - (5 * 60 * 1000);
  const active = drivers.filter(d => {
      if (!d.timestamp) return true;
      if (typeof d.timestamp.toMillis !== 'function') return true;
      return d.timestamp.toMillis() > fiveMinAgo;
  });

  let visibleDrivers = active;
  if (!isDispatchView) {
      const myJobs = jobs.filter(j => j.status === 'in-progress' && j.assignedDrivers?.some(d => d.id === currentUser.id));
      const myTeammates = new Set();
      myJobs.forEach(j => {
          j.assignedDrivers?.forEach(d => myTeammates.add(d.id));
      });
      visibleDrivers = active.filter(d => d.id === currentUser.id || myTeammates.has(d.id));
  }

  return (
    <>
      {visibleDrivers.map(driver => {
        let statusText = driver.status || 'Available';
        let pinColor = driver.color || '#22c55e'; // custom color or green-500
        let glyphColor = '#ffffff';
        let borderColor = '#166534'; // We'll just leave border default green-ish or they can have no border for custom

        const assignedJob = jobs.find(j => j.status === 'in-progress' && j.assignedDrivers?.some(d => d.id === driver.id));
        if (assignedJob) {
            statusText = `On Trip: ${assignedJob.jobName}`;
            if (!driver.color) {
                pinColor = '#eab308'; // yellow-500
                borderColor = '#854d0e';
            }
        } else if (driver.status === 'Offline') {
            if (!driver.color) {
                pinColor = '#6b7280'; // gray-500
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
        styles={mapStyles}
        gestureHandling={'greedy'}
        disableDefaultUI={false}
        mapId="vecto-main-map"
      >
        <MapController />
        <TrafficOverlay />
        <DirectionsComponent />
        <DriverMarkers />
      </Map>
      
      {/* My Location Button */}
      <button 
        type="button"
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
        className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-full shadow-lg z-10 flex items-center justify-center transition-colors"
        title="My Location"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
        </svg>
      </button>
    </>
  );
}
