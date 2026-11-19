import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useToastStore } from '../store/useToastStore';
import { doc, setDoc, updateDoc, deleteDoc, serverTimestamp, GeoPoint } from 'firebase/firestore';
import { db, storage } from '../firebase';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { encodeGeohash } from '../utils/geohash';
import { saveOfflineFix, flushOfflineQueue, flushBreadcrumbChunk, flushOfflinePodQueue } from '../utils/offlineQueue';
import { haversineMiles, haversineMeters } from '../utils/stops';
import { syncPublicTrackingJobUpdate } from '../utils/publicTracking';

const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');

function normalizeTelemetry(telemetry = {}) {
  const rawHeading = telemetry.heading;
  let heading = null;
  if (typeof rawHeading === 'number' && Number.isFinite(rawHeading) && rawHeading >= 0 && rawHeading <= 360) {
    heading = rawHeading === 360 ? 0 : Math.round(rawHeading * 10) / 10;
  }

  const rawSpeed = telemetry.speed;
  let speed = null;
  if (typeof rawSpeed === 'number' && Number.isFinite(rawSpeed) && rawSpeed >= 0) {
    speed = Math.round(rawSpeed * 2.23694 * 10) / 10;
  }

  const rawAccuracy = telemetry.accuracy;
  let accuracy = null;
  if (typeof rawAccuracy === 'number' && Number.isFinite(rawAccuracy) && rawAccuracy >= 0) {
    accuracy = Math.round(rawAccuracy);
  }

  return { heading, speed, accuracy };
}

export function useLocationSharing() {
  const isSharingLocation = useAppStore(state => state.isSharingLocation);
  const setIsSharingLocation = useAppStore(state => state.setIsSharingLocation);
  const currentUser = useAppStore(state => state.currentUser);
  const companyId = useAppStore(state => state.companyId);
  const selectedJobId = useAppStore(state => state.selectedJobId);
  const isDispatchView = useAppStore(state => state.isDispatchView);
  const setCurrentLocation = useAppStore(state => state.setCurrentLocation);

  const watchIdRef = useRef(null);
  const watcherIdRef = useRef(null);
  const currentUserRef = useRef(currentUser);
  const companyIdRef = useRef(companyId);
  const selectedJobIdRef = useRef(selectedJobId);
  currentUserRef.current = currentUser;
  companyIdRef.current = companyId;
  selectedJobIdRef.current = selectedJobId;

  const lastPublicTrackSyncRef = useRef({ ts: 0, lat: null, lng: null });
  const lastActiveDriverWriteRef = useRef({ ts: 0, lat: null, lng: null, jobId: null });
  const breadcrumbBufferRef = useRef({
    companyId: null,
    jobId: null,
    driverId: null,
    driverName: '',
    points: [],
    lastFlushMs: Date.now(),
  });

  const flushBufferedBreadcrumbs = useCallback(async () => {
    const buf = breadcrumbBufferRef.current;
    if (!buf.points.length || !buf.companyId || !buf.jobId || !buf.driverId) return;

    const pointsToFlush = [...buf.points];
    const snapshotMeta = {
      companyId: buf.companyId,
      jobId: buf.jobId,
      driverId: buf.driverId,
      driverName: buf.driverName,
    };

    buf.points = [];
    buf.lastFlushMs = Date.now();

    if (!navigator.onLine) {
      for (const pt of pointsToFlush) {
        await saveOfflineFix(snapshotMeta.companyId, snapshotMeta.driverId, {
          lat: pt.lat,
          lng: pt.lng,
          status: 'Available',
          name: snapshotMeta.driverName,
          activeJobId: snapshotMeta.jobId,
        });
      }
      return;
    }

    try {
      await flushBreadcrumbChunk(db, {
        ...snapshotMeta,
        points: pointsToFlush,
        source: 'live',
      });
    } catch (err) {
      console.warn('Breadcrumb chunk flush failed, queuing offline:', err);
      for (const pt of pointsToFlush) {
        await saveOfflineFix(snapshotMeta.companyId, snapshotMeta.driverId, {
          lat: pt.lat,
          lng: pt.lng,
          status: 'Available',
          name: snapshotMeta.driverName,
          activeJobId: snapshotMeta.jobId,
        });
      }
    }
  }, []);

  // 1. Listen for network reconnection and flush offline location queue
  useEffect(() => {
    const handleOnline = () => {
      console.log("Network online restored. Flushing offline queue...");
      flushOfflineQueue(db);
      flushOfflinePodQueue(db, storage);
    };

    window.addEventListener('online', handleOnline);
    if (navigator.onLine) {
      flushOfflineQueue(db);
      flushOfflinePodQueue(db, storage);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  // Flush buffered breadcrumbs if active job changes
  useEffect(() => {
    const buf = breadcrumbBufferRef.current;
    if (buf.points.length > 0 && buf.jobId && buf.jobId !== selectedJobId) {
      flushBufferedBreadcrumbs();
    }
  }, [selectedJobId, flushBufferedBreadcrumbs]);

  // Helper to send or queue driver location & accumulate active-job breadcrumbs
  const updateDriverLocation = useCallback(async (lat, lng, rawTelemetry = {}) => {
    const user = currentUserRef.current;
    const activeCompanyId = companyIdRef.current;
    const activeSelectedJobId = selectedJobIdRef.current || null;
    if (!user?.id || !activeCompanyId) return;

    const { heading, speed, accuracy } = normalizeTelemetry(rawTelemetry);
    setCurrentLocation({ lat, lng, heading, speed, accuracy });

    // Accumulate GPS breadcrumbs when driving an assigned in-progress job
    const jobs = useAppStore.getState().jobs;
    const activeJob = activeSelectedJobId ? jobs.find((j) => j.id === activeSelectedJobId) : null;
    const isDrivingSelectedJob = Boolean(
      activeJob &&
      activeJob.status === 'in-progress' &&
      (activeJob.assignedDrivers || []).some((d) => d.id === user.id)
    );

    if (isDrivingSelectedJob) {
      const buf = breadcrumbBufferRef.current;
      if (buf.jobId && buf.jobId !== activeJob.id && buf.points.length > 0) {
        await flushBufferedBreadcrumbs();
      }
      buf.companyId = activeCompanyId;
      buf.jobId = activeJob.id;
      buf.driverId = user.id;
      buf.driverName = user.name || user.email || 'Driver';

      const lastPt = buf.points[buf.points.length - 1];
      const now = Date.now();
      const shouldAppend =
        !lastPt ||
        haversineMiles(lastPt, { lat, lng }) >= 0.03 ||
        now - lastPt.ts >= 30000;

      if (shouldAppend) {
        buf.points.push({ lat, lng, ts: now });
      }

      if (navigator.onLine && (buf.points.length >= 10 || now - buf.lastFlushMs >= 60000)) {
        await flushBufferedBreadcrumbs();
      }
    }

    const geohashStr = encodeGeohash(lat, lng, 7);
    const payload = {
      location: new GeoPoint(lat, lng),
      geohash: geohashStr,
      timestamp: serverTimestamp(),
      status: 'Available',
      name: user.name || 'Unnamed',
      phone: user.phone || user.number || '',
      number: user.phone || user.number || '',
      color: user.color || '#22c55e',
      activeJobId: activeSelectedJobId,
      heading,
      speed,
      accuracy
    };

    if (!navigator.onLine) {
      await saveOfflineFix(activeCompanyId, user.id, payload);
      return;
    }

    const nowMs = Date.now();
    const lastWrite = lastActiveDriverWriteRef.current;
    const movedMeters =
      lastWrite.lat !== null && lastWrite.lng !== null
        ? haversineMeters({ lat: lastWrite.lat, lng: lastWrite.lng }, { lat, lng })
        : Infinity;

    const shouldSkipWrite =
      lastWrite.jobId === activeSelectedJobId &&
      nowMs - lastWrite.ts < 12000 &&
      movedMeters < 8;

    try {
      if (!shouldSkipWrite) {
        await setDoc(doc(db, `companies/${activeCompanyId}/active_drivers`, user.id), payload);
        lastActiveDriverWriteRef.current = { ts: nowMs, lat, lng, jobId: activeSelectedJobId };
      }

      // Push live driver coordinates to any active job with a customer tracking link
      const trackedJob = activeJob?.trackingToken
        ? activeJob
        : jobs.find(
            (j) =>
              j.trackingToken &&
              j.status === 'in-progress' &&
              (j.assignedDrivers || []).some((d) => d.id === user.id)
          );

      if (trackedJob && trackedJob.status === 'in-progress') {
        const lastSync = lastPublicTrackSyncRef.current;
        const movedMiles =
          lastSync.lat !== null && lastSync.lng !== null
            ? haversineMiles({ lat: lastSync.lat, lng: lastSync.lng }, { lat, lng })
            : Infinity;

        if (nowMs - lastSync.ts >= 10000 || movedMiles >= 0.03) {
          lastPublicTrackSyncRef.current = { ts: nowMs, lat, lng };
          const { companyName, routeInfo } = useAppStore.getState();
          syncPublicTrackingJobUpdate({
            db,
            companyId: activeCompanyId,
            companyName,
            job: trackedJob,
            driverId: user.id,
            driverName: user.name || user.email,
            driverLocation: { lat, lng },
            heading,
            speed,
            routeInfo
          });
        }
      }
    } catch (err) {
      console.warn("Location setDoc failed, saving to offline queue:", err);
      await saveOfflineFix(activeCompanyId, user.id, payload);
    }
  }, [setCurrentLocation, flushBufferedBreadcrumbs]);

  // Keep activeJobId synchronized on job switch without restarting GPS watchers
  useEffect(() => {
    const userId = currentUser?.id;
    if (!isSharingLocation || !userId || !companyId || isDispatchView || !navigator.onLine) return;
    if (lastActiveDriverWriteRef.current.ts === 0) return;

    const nextJobId = selectedJobId || null;
    if (lastActiveDriverWriteRef.current.jobId === nextJobId) return;

    lastActiveDriverWriteRef.current.jobId = nextJobId;
    updateDoc(doc(db, `companies/${companyId}/active_drivers`, userId), {
      activeJobId: nextJobId,
      updatedAt: serverTimestamp()
    }).catch(() => {});
  }, [selectedJobId, isSharingLocation, currentUser?.id, companyId, isDispatchView]);

  useEffect(() => {
    const userId = currentUser?.id;
    let isCancelled = false;

    if (isSharingLocation && userId && companyId && !isDispatchView) {
      if (Capacitor.isNativePlatform()) {
        if (!localStorage.getItem('vecto_battery_tip_shown')) {
          useToastStore.getState().addToast(
            "Tip: Set Vecto battery to 'Unrestricted' in Android settings for reliable tracking when the screen is locked.",
            "info"
          );
          localStorage.setItem('vecto_battery_tip_shown', 'true');
        }

        BackgroundGeolocation.addWatcher(
          {
            backgroundMessage: "Tracking your route to keep dispatch updated.",
            backgroundTitle: "Vecto Tracking Active",
            requestPermissions: true,
            stale: false,
            distanceFilter: 10
          },
          async (location, error) => {
            if (isCancelled) return;
            if (error) {
              if (error.code === "NOT_AUTHORIZED") {
                if (window.confirm("Vecto needs background location to track your route while the app is closed. Open settings?")) {
                  BackgroundGeolocation.openSettings();
                }
              }
              console.error("Background location error:", error);
              return;
            }
            await updateDriverLocation(location.latitude, location.longitude, {
              heading: location.bearing ?? location.heading,
              speed: location.speed,
              accuracy: location.accuracy
            });
          }
        ).then(watcherId => {
          if (isCancelled) {
            BackgroundGeolocation.removeWatcher({ id: watcherId }).catch(() => {});
          } else {
            watcherIdRef.current = watcherId;
          }
        }).catch(err => {
          console.error("Failed to attach BackgroundGeolocation watcher:", err);
        });

      } else {
        if (!navigator.geolocation) {
          useToastStore.getState().addToast("Geolocation is not supported by this browser.", "error");
          setIsSharingLocation(false);
          return;
        }

        navigator.geolocation.getCurrentPosition(
          async (position) => {
            if (isCancelled) return;
            const { latitude, longitude, heading, speed, accuracy } = position.coords;
            await updateDriverLocation(latitude, longitude, { heading, speed, accuracy });
          },
          (err) => console.warn("Quick location fetch failed:", err),
          { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
        );

        watchIdRef.current = navigator.geolocation.watchPosition(
          async (position) => {
            if (isCancelled) return;
            const { latitude, longitude, heading, speed, accuracy } = position.coords;
            await updateDriverLocation(latitude, longitude, { heading, speed, accuracy });
          },
          (err) => {
            console.warn("Geolocation signal issue:", err.message || err.code || err);
            if (err.code === 1) {
              useToastStore.getState().addToast("Location permission denied. Please allow location access in browser settings.", "error");
              setIsSharingLocation(false);
            } else if (err.code === 3) {
              console.warn("Location request timed out; retrying on next tick...");
            } else {
              useToastStore.getState().addToast("Failed to acquire location signal.", "error");
            }
          },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 3000 }
        );
      }

    } else {
      flushBufferedBreadcrumbs();
      setCurrentLocation(null);
      lastActiveDriverWriteRef.current = { ts: 0, lat: null, lng: null, jobId: null };

      if (Capacitor.isNativePlatform()) {
        if (watcherIdRef.current) {
          BackgroundGeolocation.removeWatcher({ id: watcherIdRef.current }).catch(() => {});
          watcherIdRef.current = null;
        }
      } else {
        if (watchIdRef.current !== null) {
          navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }
      }
      
      if (userId && companyId) {
        deleteDoc(doc(db, `companies/${companyId}/active_drivers`, userId)).catch(console.error);
      }
    }

    return () => {
      isCancelled = true;
      flushBufferedBreadcrumbs();
      if (Capacitor.isNativePlatform()) {
        if (watcherIdRef.current) {
          BackgroundGeolocation.removeWatcher({ id: watcherIdRef.current }).catch(() => {});
          watcherIdRef.current = null;
        }
      } else {
        if (watchIdRef.current !== null) {
          navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }
      }
    };
  }, [isSharingLocation, currentUser?.id, companyId, isDispatchView, setIsSharingLocation, setCurrentLocation, updateDriverLocation, flushBufferedBreadcrumbs]);

  const toggleLocationSharing = () => {
    setIsSharingLocation(!isSharingLocation);
  };

  return { isSharingLocation, toggleLocationSharing };
}
