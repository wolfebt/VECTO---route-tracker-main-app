import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useToastStore } from '../store/useToastStore';
import { fetchRouteWeatherAndHazards, sampleRoutePoints } from '../utils/weatherHazards';

export function useRouteWeather(selectedJobId, routeInfo, jobs = []) {
  const setRouteWeather = useAppStore((s) => s.setRouteWeather);
  const addToast = useToastStore((s) => s.addToast);
  const alertedHazardsRef = useRef(new Set());

  const activeJob = Array.isArray(jobs) ? jobs.find((j) => j.id === selectedJobId) : null;
  const activeJobStatus = activeJob?.status || '';

  useEffect(() => {
    if (!selectedJobId || !routeInfo || (routeInfo.jobId && routeInfo.jobId !== selectedJobId)) {
      setRouteWeather(null);
      return;
    }

    const points = sampleRoutePoints(routeInfo);
    if (points.length === 0) {
      setRouteWeather(null);
      return;
    }

    let cancelled = false;
    fetchRouteWeatherAndHazards(points)
      .then((weatherSummary) => {
        if (cancelled || !weatherSummary) return;
        setRouteWeather(weatherSummary);

        if (activeJobStatus === 'in-progress' && Array.isArray(weatherSummary.hazards)) {
          weatherSummary.hazards
            .filter((h) => h.severity === 'critical')
            .forEach((h) => {
              const key = `${selectedJobId}:${h.type}`;
              if (!alertedHazardsRef.current.has(key)) {
                alertedHazardsRef.current.add(key);
                addToast(`${h.icon} ${h.title} (${h.segment})`, 'warning');
              }
            });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn('Route weather fetch failed:', err);
          setRouteWeather(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedJobId, routeInfo, activeJobStatus, setRouteWeather, addToast]);
}
