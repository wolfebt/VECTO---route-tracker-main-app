import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  applyWaypointOrder,
  computePathMiles,
  evaluateJobSlaSummary,
  evaluateStopSla,
  getRemainingStops,
  haversineMeters,
  haversineMiles,
  normalizeJobStops,
} from '../src/utils/stops';
import { isVehicleServiceDue } from '../src/utils/vehicles';
import { mergeActiveAndArchivedJobs } from '../src/utils/jobsMerge';

describe('stops, vehicles, and job merging', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 18, 13, 45, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('normalizes structured stops and legacy single/array destinations while filtering completed stops', () => {
    const structured = normalizeJobStops({
      stops: [
        { id: 'b', address: '200 Second St', order: 1, status: 'pending', arriveBy: '15:00', serviceMinutes: 20 },
        { id: 'a', address: '100 First St', order: 0, status: 'completed', arrivedAt: 1000, completedAt: 2000 },
        { id: 'empty', address: '', order: 2 },
      ],
    });
    expect(structured.map((s) => s.id)).toEqual(['a', 'b']);
    expect(structured[1].arriveBy).toBe('15:00');
    expect(structured[1].serviceMinutes).toBe(20);
    expect(getRemainingStops(structured).map((s) => s.id)).toEqual(['b']);

    const legacy = normalizeJobStops({
      status: 'assigned',
      destinations: ['Origin Drop', 'Final Drop'],
    });
    expect(legacy).toHaveLength(2);
    expect(legacy[0].status).toBe('pending');

    const singleDestCompleted = normalizeJobStops({
      status: 'completed',
      destination: '  742 Evergreen Terrace  ',
    });
    expect(singleDestCompleted).toHaveLength(1);
    expect(singleDestCompleted[0].address).toBe('742 Evergreen Terrace');
    expect(singleDestCompleted[0].status).toBe('completed');
    expect(getRemainingStops(singleDestCompleted)).toEqual([]);
  });

  it('reorders intermediate waypoints while keeping final stop last and preserving existing coords', () => {
    const stops = [
      { id: 's0', address: 'Stop A', order: 0, lat: null, lng: null },
      { id: 's1', address: 'Stop B', order: 1, lat: 30.99, lng: -97.99 },
      { id: 's2', address: 'Final C', order: 2, lat: null, lng: null },
    ];
    const ordered = applyWaypointOrder(stops, [1, 0], [
      { end_location: { lat: () => 30.1, lng: () => -97.1 } },
      { end_location: { lat: 30.2, lng: -97.2 } },
      { end_location: { lat: () => 30.3, lng: () => -97.3 } },
    ]);
    expect(ordered.map((s) => s.id)).toEqual(['s1', 's0', 's2']);
    expect(ordered[0].lat).toBe(30.99);
    expect(ordered[1].lat).toBe(30.2);
    expect(ordered[2].lat).toBe(30.3);
    expect(ordered[2].order).toBe(2);
    expect(applyWaypointOrder([], [], [])).toEqual([]);
  });

  it('computes geodesic path distance in miles and meters cleanly', () => {
    const miles = haversineMiles({ lat: 30.2672, lng: -97.7431 }, { lat: 29.7604, lng: -95.3698 });
    expect(miles).toBeGreaterThan(140);
    expect(miles).toBeLessThan(155);
    expect(haversineMeters({ lat: 30, lng: -97 }, { lat: 30, lng: -97 })).toBe(0);
    expect(haversineMiles(null, { lat: 30, lng: -97 })).toBe(0);
    expect(computePathMiles([{ lat: 0, lng: 0 }])).toBe(0);
    expect(computePathMiles([{ lat: 30.0, lng: -97.0 }, { lat: 30.1, lng: -97.0 }])).toBeGreaterThan(6);
  });

  it('evaluates per-stop and job-level SLA statuses including arrived grace window and invalid times', () => {
    const jobDate = '2026-11-18';
    expect(evaluateStopSla({ status: 'pending', arriveBy: '' }, jobDate)).toEqual({ status: 'none', label: '' });
    expect(evaluateStopSla({ status: 'pending', arriveBy: '25:99' }, jobDate)).toEqual({ status: 'none', label: '25:99' });
    expect(evaluateStopSla({ status: 'pending', arriveBy: '09:05' }, jobDate).label).toBe('9:05 AM');
    expect(evaluateStopSla({ status: 'pending', arriveBy: '14:00' }, jobDate).status).toBe('at_risk');
    expect(evaluateStopSla({ status: 'pending', arriveBy: '13:30' }, jobDate).status).toBe('late');
    expect(evaluateStopSla({ status: 'pending', arriveBy: '16:30' }, jobDate).status).toBe('scheduled');
    expect(
      evaluateStopSla(
        {
          status: 'arrived',
          arriveBy: '14:00',
          arrivedAt: new Date(2026, 10, 18, 14, 0, 45).getTime(),
        },
        jobDate
      ).status
    ).toBe('on_time');
    expect(
      evaluateStopSla(
        {
          status: 'completed',
          arriveBy: '14:00',
          arrivedAt: new Date(2026, 10, 18, 14, 2, 0).getTime(),
        },
        jobDate
      ).status
    ).toBe('late');

    const summary = evaluateJobSlaSummary({
      jobDate,
      stops: [
        { address: 'A', status: 'pending', arriveBy: '13:30', serviceMinutes: 15 },
        { address: 'B', status: 'pending', arriveBy: '14:00', serviceMinutes: 30 },
        { address: 'C', status: 'completed', arriveBy: '12:00', arrivedAt: new Date(2026, 10, 18, 11, 55, 0).getTime() },
      ],
    });
    expect(summary).toEqual({
      hasSla: true,
      lateCount: 1,
      atRiskCount: 1,
      onTimeCount: 1,
      totalDwellMinutes: 45,
    });
  });

  it('flags vehicles requiring preventive maintenance across status, mileage, and date boundaries', () => {
    expect(isVehicleServiceDue(null)).toBe(false);
    expect(isVehicleServiceDue({ status: 'maintenance' })).toBe(true);
    expect(isVehicleServiceDue({ status: 'active', odometerMiles: 50000, serviceDueMiles: 50000 })).toBe(true);
    expect(isVehicleServiceDue({ status: 'active', odometerMiles: 52000, serviceDueMiles: 50000 })).toBe(true);
    expect(isVehicleServiceDue({ status: 'active', odometerMiles: 48000, serviceDueMiles: 50000 })).toBe(false);
    expect(isVehicleServiceDue({ status: 'active', serviceDueDate: '2026-11-18' })).toBe(true);
    expect(isVehicleServiceDue({ status: 'active', serviceDueDate: '2026-11-17' })).toBe(true);
    expect(isVehicleServiceDue({ status: 'active', serviceDueDate: '2026-12-31' })).toBe(false);
  });

  it('merges live active jobs over stale archive entries cleanly', () => {
    const active = [
      { id: 'job1', jobName: 'Restored Job', archived: false },
      { id: 'job2', jobName: 'Live Job', archived: false },
    ];
    const archived = [
      { id: 'job1', jobName: 'Stale Archive Copy', archived: true },
      { id: 'job3', jobName: 'Old Archive', archived: true },
      { id: 'bad', jobName: 'Not Archived Flag', archived: false },
    ];
    const merged = mergeActiveAndArchivedJobs(active, archived);
    expect(merged).toHaveLength(3);
    expect(merged.find((j) => j.id === 'job1')?.jobName).toBe('Restored Job');
    expect(merged.find((j) => j.id === 'job3')?.archived).toBe(true);
  });
});
