import { describe, it, expect } from 'vitest';
import { sortDriverRoster } from '../utils/roster';
import { rankDriversByProximity } from '../utils/proximityDispatch';
import { clusterDriverMarkers } from '../utils/mapCluster';
import { describeWeatherCode, sampleRoutePoints } from '../utils/weatherHazards';

describe('dispatch ranking, clustering, and weather helpers', () => {
  it('sorts driver roster by priority, duty status, rosterOrder, and lastDispatchedAt', () => {
    const members = [
      { id: 'off', name: 'Zed', onDutyStatus: 'off_duty', rosterOrder: 0 },
      { id: 'norm2', name: 'Bob', onDutyStatus: 'on_duty', rosterOrder: 2 },
      { id: 'norm1', name: 'Alice', onDutyStatus: 'on_duty', rosterOrder: 1 },
      { id: 'prio', name: 'Cara', onDutyStatus: 'on_duty', isPriorityDriver: true, rosterOrder: 5 },
    ];
    expect(sortDriverRoster(members).map((m) => m.id)).toEqual(['prio', 'norm1', 'norm2', 'off']);
  });

  it('ranks drivers by duty, busy state, GPS proximity, and traffic matrix overrides', () => {
    const originCoords = { lat: 30.2672, lng: -97.7431 };
    const members = [
      { id: 'far', name: 'Far Driver', onDutyStatus: 'on_duty' },
      { id: 'near', name: 'Near Driver', onDutyStatus: 'on_duty' },
      { id: 'busy', name: 'Busy Nearby', onDutyStatus: 'on_duty' },
      { id: 'off', name: 'Off Duty', onDutyStatus: 'off_duty' },
    ];
    const activeDrivers = [
      { id: 'near', location: { latitude: 30.275, longitude: -97.745 }, timestamp: Date.now() },
      { id: 'far', location: { latitude: 30.55, longitude: -97.75 }, timestamp: Date.now() },
      { id: 'busy', location: { latitude: 30.268, longitude: -97.744 }, timestamp: Date.now() },
    ];
    const jobs = [
      { id: 'j1', archived: false, status: 'in-progress', assignedDrivers: [{ id: 'busy' }] },
    ];

    const ranked = rankDriversByProximity({
      originCoords,
      members,
      activeDrivers,
      jobs,
      matrixOverrides: {
        near: { distanceText: '0.8 mi', durationText: '3m', durationMinutes: 3, isLiveTraffic: true },
      },
    });

    expect(ranked.map((r) => r.member.id)).toEqual(['near', 'far', 'busy', 'off']);
    expect(ranked[0].isLiveTraffic).toBe(true);
    expect(ranked[2].isBusy).toBe(true);
  });

  it('clusters nearby driver markers at low zoom and unclusters at zoom >= 14', () => {
    const drivers = [
      { id: 'd1', location: { latitude: 30.2672, longitude: -97.7431 } },
      { id: 'd2', location: { latitude: 30.2675, longitude: -97.7433 } },
    ];

    const zoomedOut = clusterDriverMarkers(drivers, 10);
    expect(zoomedOut).toHaveLength(1);
    expect(zoomedOut[0].type).toBe('cluster');
    expect(zoomedOut[0].drivers).toHaveLength(2);

    const zoomedIn = clusterDriverMarkers(drivers, 15);
    expect(zoomedIn).toHaveLength(2);
    expect(zoomedIn.every((item) => item.type === 'driver')).toBe(true);
  });

  it('describes WMO weather codes and samples route points with 8-mile deduplication', () => {
    expect(describeWeatherCode(0)).toBe('Clear');
    expect(describeWeatherCode(66)).toBe('Freezing Rain');
    expect(describeWeatherCode(95)).toBe('Thunderstorm');

    const sampled = sampleRoutePoints({
      overviewPath: [
        { lat: 30.0, lng: -97.0 },
        { lat: 30.05, lng: -97.0 },
        { lat: 30.5, lng: -97.0 },
        { lat: 31.2, lng: -97.0 },
      ],
    });
    expect(sampled.length).toBeGreaterThanOrEqual(2);
    expect(sampled.length).toBeLessThanOrEqual(4);
    expect(sampled[0].label).toBe('Origin');
  });
});
