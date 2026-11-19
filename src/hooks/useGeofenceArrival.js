import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useToastStore } from '../store/useToastStore';
import { haversineMeters, normalizeJobStops } from '../utils/stops';

const ARRIVAL_RADIUS_METERS = 150;

export function useGeofenceArrival(jobs = []) {
  const currentUser = useAppStore((s) => s.currentUser);
  const companyId = useAppStore((s) => s.companyId);
  const selectedJobId = useAppStore((s) => s.selectedJobId);
  const currentLocation = useAppStore((s) => s.currentLocation);
  const arrivalPrompt = useAppStore((s) => s.arrivalPrompt);
  const setArrivalPrompt = useAppStore((s) => s.setArrivalPrompt);
  const addToast = useToastStore((s) => s.addToast);

  const promptedStopsRef = useRef(new Set());

  useEffect(() => {
    promptedStopsRef.current = new Set();
    setArrivalPrompt(null);
  }, [companyId, currentUser?.id, setArrivalPrompt]);

  // Dismiss stale arrival banner if the stop was already marked arrived or completed
  useEffect(() => {
    if (!arrivalPrompt || !Array.isArray(jobs)) return;
    const job = jobs.find((j) => j.id === arrivalPrompt.jobId);
    if (!job || job.archived || ['completed', 'cancelled', 'archived'].includes(job.status)) {
      setArrivalPrompt(null);
      return;
    }
    const stop = normalizeJobStops(job).find((s) => s.id === arrivalPrompt.stopId);
    if (!stop || stop.status !== 'pending') {
      setArrivalPrompt(null);
    }
  }, [arrivalPrompt, jobs, setArrivalPrompt]);

  useEffect(() => {
    if (!companyId || !currentUser?.id || !currentLocation) return;
    if (typeof currentLocation.lat !== 'number' || typeof currentLocation.lng !== 'number') return;
    if (!Array.isArray(jobs) || jobs.length === 0) return;

    for (const job of jobs) {
      if (job.archived) continue;
      if (job.status !== 'in-progress' && !(job.id === selectedJobId && job.status === 'assigned')) {
        continue;
      }

      const isAssigned = (job.assignedDrivers || []).some((d) => d.id === currentUser.id);
      if (!isAssigned) continue;

      const stops = normalizeJobStops(job);
      for (let i = 0; i < stops.length; i++) {
        const stop = stops[i];
        if (stop.status !== 'pending') continue;
        if (typeof stop.lat !== 'number' || typeof stop.lng !== 'number') continue;

        const key = `${job.id}:${stop.id}`;
        if (promptedStopsRef.current.has(key)) continue;

        const distMeters = haversineMeters(currentLocation, { lat: stop.lat, lng: stop.lng });
        if (distMeters <= ARRIVAL_RADIUS_METERS) {
          const roundedMeters = Math.round(distMeters);
          promptedStopsRef.current.add(key);
          setArrivalPrompt({
            jobId: job.id,
            jobName: job.jobName || 'Active Job',
            stopId: stop.id,
            stopOrder: i + 1,
            address: stop.address,
            distanceMeters: roundedMeters
          });
          addToast(`Arriving at Stop #${i + 1} (${roundedMeters}m)`, 'info');
          return;
        }
      }
    }
  }, [companyId, currentUser?.id, currentLocation, jobs, selectedJobId, setArrivalPrompt, addToast]);
}
