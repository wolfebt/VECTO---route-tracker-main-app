import { useEffect, useRef, useCallback } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { arrayUnion, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAppStore } from '../store/useAppStore';
import { useToastStore } from '../store/useToastStore';
import { normalizeJobStops, getRemainingStops } from '../utils/stops';
import { syncPublicTrackingJobUpdate } from '../utils/publicTracking';

const VectoCarBridge = registerPlugin('VectoCarBridge');

function normalizeCarStatus(rawStatus) {
  const s = String(rawStatus || '').trim().toLowerCase();
  if (s === 'in progress' || s === 'in-progress') return 'in-progress';
  if (s === 'completed' || s === 'complete' || s === 'done') return 'completed';
  return s || 'assigned';
}

function buildCarInstructions(job, userId) {
  if (Array.isArray(job?.instructions) && job.instructions.length > 0) {
    const visible = job.instructions.filter(
      (inst) => !inst.target || inst.target === 'all' || inst.target === userId
    );
    if (visible.length > 0) {
      const sorted = [...visible].sort((a, b) => Number(!!b.isPriority) - Number(!!a.isPriority));
      return sorted
        .map((inst) => (inst.isPriority ? `[PRIORITY] ${inst.text || ''}` : (inst.text || '')))
        .filter(Boolean)
        .join('\n');
    }
  }
  return job?.notes || '';
}

function statusPriority(status) {
  if (status === 'in-progress') return 0;
  if (status === 'assigned') return 1;
  return 2;
}

export function useCarAppSync(jobs = []) {
  const currentUser = useAppStore((s) => s.currentUser);
  const companyId = useAppStore((s) => s.companyId);
  const companyName = useAppStore((s) => s.companyName);
  const selectedJobId = useAppStore((s) => s.selectedJobId);
  const setSelectedJobId = useAppStore((s) => s.setSelectedJobId);
  const addToast = useToastStore((s) => s.addToast);

  const jobsRef = useRef(jobs);
  const companyIdRef = useRef(companyId);
  const currentUserRef = useRef(currentUser);

  jobsRef.current = jobs;
  companyIdRef.current = companyId;
  currentUserRef.current = currentUser;

  const processCarAction = useCallback(async (action) => {
    if (!action || typeof action !== 'object') return;
    const { type, jobId, status } = action;
    if (!type || !jobId) return;

    if (type === 'select_job') {
      setSelectedJobId(jobId);
      return;
    }

    if (type === 'complete_stop') {
      const activeCompanyId = companyIdRef.current;
      const user = currentUserRef.current;
      if (!activeCompanyId || !user?.id) return;

      const job = (jobsRef.current || []).find((j) => j.id === jobId);
      if (!job) return;

      const stops = normalizeJobStops(job);
      const remaining = getRemainingStops(stops);
      const targetStopId = action.stopId || remaining[0]?.id;
      if (!targetStopId) return;

      const now = Date.now();
      const updatedStops = stops.map((s) =>
        s.id === targetStopId
          ? { ...s, status: 'completed', arrivedAt: s.arrivedAt || now, completedAt: now }
          : s
      );

      try {
        await updateDoc(doc(db, `companies/${activeCompanyId}/jobs`, jobId), {
          stops: updatedStops,
          updatedAt: serverTimestamp()
        });
        const { companyName: activeCompName, currentLocation, routeInfo } = useAppStore.getState();
        await syncPublicTrackingJobUpdate({
          db,
          companyId: activeCompanyId,
          companyName: activeCompName,
          job: { ...job, stops: updatedStops },
          driverId: user.id,
          driverName: user.name || user.email,
          driverLocation: currentLocation,
          routeInfo
        });
        addToast('Stop completed via Android Auto', 'success');
      } catch (err) {
        console.error('Failed to complete stop from Android Auto:', err);
        addToast('Failed to sync stop completion', 'error');
      }
      return;
    }

    if (type === 'update_status' && status) {
      const activeCompanyId = companyIdRef.current;
      const user = currentUserRef.current;
      if (!activeCompanyId || !user?.id) return;

      const nextStatus = normalizeCarStatus(status);
      const job = (jobsRef.current || []).find((j) => j.id === jobId);

      try {
        const jobRef = doc(db, `companies/${activeCompanyId}/jobs`, jobId);

        if (nextStatus === 'completed') {
          const completedDrivers = job?.completedDrivers || [];
          const assignedCount = job?.assignedDrivers?.length || 1;
          const alreadyFinished = completedDrivers.includes(user.id);
          const nextCompletedCount = alreadyFinished
            ? completedDrivers.length
            : completedDrivers.length + 1;

          const updates = {
            completedDrivers: arrayUnion(user.id),
            updatedAt: serverTimestamp()
          };

          let updatedStops = null;
          if (nextCompletedCount >= assignedCount) {
            updates.status = 'completed';
            updates.completedAt = serverTimestamp();
            const now = Date.now();
            const existingStops = normalizeJobStops(job);
            if (existingStops.length > 0) {
              updatedStops = existingStops.map((s) =>
                s.status === 'completed'
                  ? s
                  : { ...s, status: 'completed', arrivedAt: s.arrivedAt || now, completedAt: now }
              );
              updates.stops = updatedStops;
            }
          }

          await updateDoc(jobRef, updates);
          if (job) {
            const { companyName: activeCompName, currentLocation, routeInfo } = useAppStore.getState();
            await syncPublicTrackingJobUpdate({
              db,
              companyId: activeCompanyId,
              companyName: activeCompName,
              job: {
                ...job,
                status: updates.status || job.status,
                ...(updatedStops ? { stops: updatedStops } : {})
              },
              driverId: user.id,
              driverName: user.name || user.email,
              driverLocation: currentLocation,
              routeInfo
            });
          }
          addToast(
            nextCompletedCount >= assignedCount
              ? 'Job marked completed from Android Auto'
              : 'Your segment marked finished from Android Auto',
            'success'
          );
          return;
        }

        if (nextStatus === 'in-progress') {
          const updates = {
            status: 'in-progress',
            updatedAt: serverTimestamp()
          };
          if (!job?.startedAt) {
            updates.startedAt = serverTimestamp();
          }
          await updateDoc(jobRef, updates);
          if (job) {
            const { companyName: activeCompName, currentLocation, routeInfo } = useAppStore.getState();
            await syncPublicTrackingJobUpdate({
              db,
              companyId: activeCompanyId,
              companyName: activeCompName,
              job: { ...job, status: 'in-progress' },
              driverId: user.id,
              driverName: user.name || user.email,
              driverLocation: currentLocation,
              routeInfo
            });
          }
          addToast('Trip started from Android Auto', 'success');
          return;
        }

        await updateDoc(jobRef, {
          status: nextStatus,
          updatedAt: serverTimestamp()
        });
        addToast(`Job updated to ${nextStatus} via Android Auto`, 'success');
      } catch (err) {
        console.error('Failed to process car action:', err);
        addToast('Failed to sync Android Auto action', 'error');
      }
    }
  }, [setSelectedJobId, addToast]);

  const drainActions = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      if (typeof VectoCarBridge.drainPendingCarActions === 'function') {
        const res = await VectoCarBridge.drainPendingCarActions();
        const raw = res?.actions;
        if (raw) {
          const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (Array.isArray(list)) {
            for (const item of list) {
              await processCarAction(item);
            }
          }
        }
        return;
      }

      const res = await VectoCarBridge.getPendingCarAction();
      if (res?.action) {
        const parsed = typeof res.action === 'string' ? JSON.parse(res.action) : res.action;
        await processCarAction(parsed);
      }
    } catch (err) {
      console.warn('Error draining Android Auto actions:', err);
    }
  }, [processCarAction]);

  // 1. Push assigned active jobs to Android Auto SharedPreferences
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (!currentUser?.id) return;

    const assignedActive = (jobs || []).filter((j) => {
      if (j.archived) return false;
      if (j.status === 'completed' || j.status === 'archived') return false;
      return (j.assignedDrivers || []).some((d) => d.id === currentUser.id);
    });

    const sortedJobs = [...assignedActive].sort((a, b) => {
      if (a.id === selectedJobId && b.id !== selectedJobId) return -1;
      if (b.id === selectedJobId && a.id !== selectedJobId) return 1;
      const diff = statusPriority(a.status) - statusPriority(b.status);
      if (diff !== 0) return diff;
      return 0;
    });

    const formatted = sortedJobs.map((j) => {
      const stops = normalizeJobStops(j);
      const remaining = getRemainingStops(stops);
      const nextStop = remaining[0] || stops[stops.length - 1] || null;
      const nextAddress = nextStop?.address || j.destinations?.[0] || j.destination || '';
      const stopSummary = stops.length > 1
        ? `${remaining.length}/${stops.length} stops remaining · Next: ${nextAddress}`
        : nextAddress;
      const currentStopNumber = nextStop
        ? stops.findIndex((s) => s.id === nextStop.id) + 1
        : stops.length;

      return {
        id: j.id,
        title: j.jobName || 'Unnamed Job',
        destination: nextAddress,
        stopSummary,
        totalStopCount: stops.length,
        remainingStopCount: remaining.length,
        currentStopId: nextStop?.id || '',
        currentStopNumber,
        remainingStops: remaining.map((s) => ({
          id: s.id,
          address: s.address,
          stopNumber: stops.findIndex((st) => st.id === s.id) + 1
        })),
        status: j.status || 'assigned',
        customer: j.contactName || '',
        phone: j.contactNumber || '',
        notes: buildCarInstructions(j, currentUser.id)
      };
    });

    VectoCarBridge.syncJobs({
      jobs: formatted,
      activeJobId: selectedJobId || '',
      driverName: currentUser.name || currentUser.email || 'Driver',
      companyName: companyName || 'Vecto Fleet'
    }).catch((err) => {
      console.warn('VectoCarBridge syncJobs error:', err);
    });
  }, [jobs, selectedJobId, currentUser, companyName]);

  // 2. Listen for real-time carAction events + drain backlog on mount/resume
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (!companyId || !currentUser?.id) return;

    let carActionHandle = null;
    let appStateHandle = null;
    let isDisposed = false;

    drainActions();

    VectoCarBridge.addListener('carAction', (data) => {
      if (!isDisposed) {
        processCarAction(data);
      }
    }).then((handle) => {
      if (isDisposed) {
        handle?.remove();
      } else {
        carActionHandle = handle;
      }
    }).catch((err) => {
      console.warn('VectoCarBridge addListener error:', err);
    });

    App.addListener('appStateChange', ({ isActive }) => {
      if (isActive && !isDisposed) {
        drainActions();
      }
    }).then((handle) => {
      if (isDisposed) {
        handle?.remove();
      } else {
        appStateHandle = handle;
      }
    }).catch((err) => {
      console.warn('App listener error for car sync:', err);
    });

    return () => {
      isDisposed = true;
      carActionHandle?.remove();
      appStateHandle?.remove();
    };
  }, [companyId, currentUser?.id, drainActions, processCarAction]);
}
