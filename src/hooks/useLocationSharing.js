import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useToastStore } from '../store/useToastStore';
import { doc, setDoc, deleteDoc, serverTimestamp, GeoPoint } from 'firebase/firestore';
import { db } from '../firebase';
import { Capacitor } from '@capacitor/core';
import { registerPlugin } from '@capacitor/core';
import { encodeGeohash } from '../utils/geohash';
import { saveOfflineFix, flushOfflineQueue } from '../utils/offlineQueue';

// The community background geolocation plugin is registered globally
const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');

export function useLocationSharing() {
  const isSharingLocation = useAppStore(state => state.isSharingLocation);
  const setIsSharingLocation = useAppStore(state => state.setIsSharingLocation);
  const currentUser = useAppStore(state => state.currentUser);
  const companyId = useAppStore(state => state.companyId);
  const selectedJobId = useAppStore(state => state.selectedJobId);
  const watchIdRef = useRef(null);
  const watcherIdRef = useRef(null); // For Capacitor BackgroundGeolocation

  // 1. Listen for network reconnection and flush offline location queue
  useEffect(() => {
    const handleOnline = () => {
      console.log("Network online restored. Flushing offline queue...");
      flushOfflineQueue(db);
    };

    window.addEventListener('online', handleOnline);
    // Initial check on mount
    if (navigator.onLine) {
      flushOfflineQueue(db);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  const setCurrentLocation = useAppStore(state => state.setCurrentLocation);

  // Helper to send or queue driver location
  const updateDriverLocation = useCallback(async (lat, lng) => {
    if (!currentUser || !companyId) return;

    // Update global app state live location for pin and route tracking
    setCurrentLocation({ lat, lng });

    const geohashStr = encodeGeohash(lat, lng, 7);
    const payload = {
      location: new GeoPoint(lat, lng),
      geohash: geohashStr,
      timestamp: serverTimestamp(),
      status: 'Available',
      name: currentUser.name || 'Unnamed',
      phone: currentUser.phone || currentUser.number || '',
      number: currentUser.phone || currentUser.number || '',
      color: currentUser.color || '#22c55e',
      activeJobId: selectedJobId || null
    };

    if (!navigator.onLine) {
      await saveOfflineFix(companyId, currentUser.id, payload);
      return;
    }

    try {
      await setDoc(doc(db, `companies/${companyId}/active_drivers`, currentUser.id), payload);
    } catch (err) {
      console.warn("Location setDoc failed, saving to offline queue:", err);
      await saveOfflineFix(companyId, currentUser.id, payload);
    }
  }, [currentUser, companyId, selectedJobId, setCurrentLocation]);

  const isDispatchView = useAppStore(state => state.isDispatchView);

  useEffect(() => {
    // Dispatchers do not show pins or share location
    if (isSharingLocation && currentUser && companyId && !isDispatchView) {
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
            await updateDriverLocation(location.latitude, location.longitude);
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
            await updateDriverLocation(latitude, longitude);
          },
          (err) => console.warn("Quick location fetch failed:", err),
          { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
        );

        watchIdRef.current = navigator.geolocation.watchPosition(
          async (position) => {
            const { latitude, longitude } = position.coords;
            await updateDriverLocation(latitude, longitude);
          },
          (err) => {
            console.warn("Geolocation signal issue:", err.message || err.code || err);
            if (err.code === 1 /* PERMISSION_DENIED */) {
              useToastStore.getState().addToast("Location permission denied. Please allow location access in browser settings.", "error");
              setIsSharingLocation(false);
            } else if (err.code === 3 /* TIMEOUT */) {
              console.warn("Location request timed out; retrying on next tick...");
            } else {
              useToastStore.getState().addToast("Failed to acquire location signal.", "error");
            }
          },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 3000 }
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
  }, [isSharingLocation, currentUser, companyId, isDispatchView, setIsSharingLocation, updateDriverLocation]);

  const toggleLocationSharing = () => {
    setIsSharingLocation(!isSharingLocation);
  };

  return { isSharingLocation, toggleLocationSharing };
}
