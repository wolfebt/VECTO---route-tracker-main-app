import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useToastStore } from '../store/useToastStore';
import { doc, setDoc, deleteDoc, serverTimestamp, GeoPoint } from 'firebase/firestore';
import { db } from '../firebase';
import { Capacitor } from '@capacitor/core';
import { registerPlugin } from '@capacitor/core';

// The community background geolocation plugin is registered globally
const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');

export function useLocationSharing() {
  const isSharingLocation = useAppStore(state => state.isSharingLocation);
  const setIsSharingLocation = useAppStore(state => state.setIsSharingLocation);
  const currentUser = useAppStore(state => state.currentUser);
  const companyId = useAppStore(state => state.companyId);
  const watchIdRef = useRef(null);
  const watcherIdRef = useRef(null); // For Capacitor BackgroundGeolocation

  useEffect(() => {
    if (isSharingLocation && currentUser && companyId) {
      if (Capacitor.isNativePlatform()) {
        // --- NATIVE BACKGROUND TRACKING ---
        BackgroundGeolocation.addWatcher(
          {
            backgroundMessage: "Tracking your route to keep dispatch updated.",
            backgroundTitle: "Vecto Tracking Active",
            requestPermissions: true,
            stale: false,
            distanceFilter: 10
          },
          async (location, error) => {
            if (error) {
              if (error.code === "NOT_AUTHORIZED") {
                if (window.confirm("Vecto needs background location to track your route while the app is closed. Open settings?")) {
                  BackgroundGeolocation.openSettings();
                }
              }
              console.error("Background location error:", error);
              return;
            }
            try {
              await setDoc(doc(db, `companies/${companyId}/active_drivers`, currentUser.id), {
                location: new GeoPoint(location.latitude, location.longitude),
                timestamp: serverTimestamp(),
                status: 'Available', // We'll refine this later based on job status
                name: currentUser.name || 'Unnamed',
                color: currentUser.color || '#22c55e'
              });
            } catch (err) {
              console.error("Error updating location:", err);
            }
          }
        ).then(watcherId => {
          watcherIdRef.current = watcherId;
        });

      } else {
        // --- WEB FALLBACK ---
        if (!navigator.geolocation) {
          useToastStore.getState().addToast("Geolocation is not supported by this browser.", "error");
          setIsSharingLocation(false);
          return;
        }
        // Fetch immediate location first so pin appears instantly
        navigator.geolocation.getCurrentPosition(
          async (position) => {
            const { latitude, longitude } = position.coords;
            try {
              await setDoc(doc(db, `companies/${companyId}/active_drivers`, currentUser.id), {
                location: new GeoPoint(latitude, longitude),
                timestamp: serverTimestamp(),
                status: 'Available',
                name: currentUser.name || 'Unnamed',
                color: currentUser.color || '#22c55e'
              });
            } catch (err) {
              console.error("Error updating location:", err);
            }
          },
          (err) => console.warn("Quick location fetch failed:", err),
          { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 }
        );

        watchIdRef.current = navigator.geolocation.watchPosition(
          async (position) => {
            const { latitude, longitude } = position.coords;
            try {
              await setDoc(doc(db, `companies/${companyId}/active_drivers`, currentUser.id), {
                location: new GeoPoint(latitude, longitude),
                timestamp: serverTimestamp(),
                status: 'Available',
                name: currentUser.name || 'Unnamed',
                color: currentUser.color || '#22c55e'
              });
            } catch (err) {
              console.error("Error updating location:", err);
            }
          },
          (err) => {
            console.error("Geolocation error:", err);
            useToastStore.getState().addToast("Failed to get location.", "error");
            setIsSharingLocation(false);
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      }
    } else {
      // --- STOP SHARING ---
      if (Capacitor.isNativePlatform()) {
        if (watcherIdRef.current) {
          BackgroundGeolocation.removeWatcher({ id: watcherIdRef.current });
          watcherIdRef.current = null;
        }
      } else {
        if (watchIdRef.current !== null) {
          navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }
      }
      
      if (currentUser && companyId) {
        deleteDoc(doc(db, `companies/${companyId}/active_drivers`, currentUser.id)).catch(console.error);
      }
    }

    return () => {
      // Cleanup on unmount
      if (Capacitor.isNativePlatform()) {
        if (watcherIdRef.current) {
          BackgroundGeolocation.removeWatcher({ id: watcherIdRef.current });
        }
      } else {
        if (watchIdRef.current !== null) {
          navigator.geolocation.clearWatch(watchIdRef.current);
        }
      }
    };
  }, [isSharingLocation, currentUser, companyId, setIsSharingLocation]);

  const toggleLocationSharing = () => {
    setIsSharingLocation(!isSharingLocation);
  };

  return { isSharingLocation, toggleLocationSharing };
}
