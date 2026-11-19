import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sortDriverRoster } from '../src/utils/roster';
import {
  fetchLiveTrafficEtas,
  geocodeAddressCached,
  rankDriversByProximity,
} from '../src/utils/proximityDispatch';
import { clusterDriverMarkers } from '../src/utils/mapCluster';
import {
  describeWeatherCode,
  fetchRouteWeatherAndHazards,
  sampleRoutePoints,
} from '../src/utils/weatherHazards';

describe('dispatch ranking, clustering, and weather helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete window.google;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete window.google;
  });

  it('sorts driver roster by priority, duty status, rosterOrder, lastDispatchedAt, and name', () => {
    const members = [
      { id: 'off', name: 'Zed', onDutyStatus: 'off_duty', rosterOrder: 0 },
      { id: 'break1', name: 'Dan', onDutyStatus: 'break' },
      { id: 'norm2', name: 'Bob', onDutyStatus: 'on_duty', rosterOrder: 2 },
      { id: 'norm1', name: 'Alice', onDutyStatus: 'on_duty', rosterOrder: 1 },
      { id: 'disp_later', name: 'Eva', onDutyStatus: 'on_duty', lastDispatchedAt: { toMillis: () => 2000 } },
      { id: 'disp_earlier', name: 'Ben', onDutyStatus: 'on_duty', lastDispatchedAt: { toMillis: () => 1000 } },
      { id: 'prio', name: 'Cara', onDutyStatus: 'on_duty', isPriorityDriver: true, rosterOrder: 5 },
    ];
    expect(sortDriverRoster(members).map((m) => m.id)).toEqual([
      'prio',
      'norm1',
      'norm2',
      'disp_earlier',
      'disp_later',
      'break1',
      'off',
    ]);
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

  it('geocodes addresses with caching, non-OK fallback, and timeout handling', async () => {
    const geocodeFn = vi.fn((req, cb) => {
      if (req.address.includes('Success')) {
        cb([{ geometry: { location: { lat: () => 30.25, lng: () => -97.75 } } }], 'OK');
      } else if (req.address.includes('Zero')) {
        cb([], 'ZERO_RESULTS');
      }
    });
    window.google = {
      maps: {
        Geocoder: function makeGeocoder() {
          return { geocode: geocodeFn };
        },
      },
    };

    const first = await geocodeAddressCached('100 Success St, Austin');
    const cached = await geocodeAddressCached('100 Success St, Austin');
    expect(first).toEqual({ lat: 30.25, lng: -97.75 });
    expect(cached).toEqual({ lat: 30.25, lng: -97.75 });
    expect(geocodeFn).toHaveBeenCalledTimes(1);

    expect(await geocodeAddressCached('404 Zero Rd')).toBeNull();
    expect(await geocodeAddressCached('')).toBeNull();

    vi.useFakeTimers();
    const timeoutPromise = geocodeAddressCached('999 Slow Hanging Ave', 500);
    await vi.advanceTimersByTimeAsync(550);
    expect(await timeoutPromise).toBeNull();
  });

  it('fetches live traffic ETAs from DistanceMatrixService and formats hours/minutes', async () => {
    window.google = {
      maps: {
        DistanceMatrixService: function makeMatrix() {
          return {
            getDistanceMatrix: vi.fn((_req, cb) => {
              cb(
                {
                  rows: [
                    { elements: [{ status: 'OK', duration_in_traffic: { value: 4200 }, distance: { value: 64374 } }] },
                    { elements: [{ status: 'NOT_FOUND' }] },
                  ],
                },
                'OK'
              );
            }),
          };
        },
      },
    };

    const overrides = await fetchLiveTrafficEtas(
      { lat: 30.26, lng: -97.74 },
      [
        { member: { id: 'd1' }, driverCoords: { lat: 30.5, lng: -97.7 } },
        { member: { id: 'd2' }, driverCoords: { lat: 31.0, lng: -97.5 } },
        { member: { id: 'd3' }, driverCoords: null },
      ]
    );

    expect(overrides.d1).toEqual({
      distanceText: '40.0 mi',
      durationText: '1h 10m',
      durationMinutes: 70,
      isLiveTraffic: true,
    });
    expect(overrides.d2).toBeUndefined();
    expect(await fetchLiveTrafficEtas(null, [])).toEqual({});
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
    expect(clusterDriverMarkers([], 10)).toEqual([]);
  });

  it('describes WMO weather codes and samples route points with 8-mile deduplication', () => {
    expect(describeWeatherCode(0)).toBe('Clear');
    expect(describeWeatherCode(2)).toBe('Partly Cloudy');
    expect(describeWeatherCode(45)).toBe('Fog');
    expect(describeWeatherCode(53)).toBe('Drizzle');
    expect(describeWeatherCode(66)).toBe('Freezing Rain');
    expect(describeWeatherCode(63)).toBe('Rain');
    expect(describeWeatherCode(73)).toBe('Snow');
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

  it('fetches Open-Meteo route weather, detects hazards, promotes severities, and caches points', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          current: {
            temperature_2m: 28,
            weather_code: 66,
            wind_speed_10m: 38,
            wind_gusts_10m: 48,
            precipitation: 0.3,
            visibility: 800,
          },
        },
        {
          current: {
            temperature_2m: 40,
            weather_code: 96,
            wind_speed_10m: 28,
            wind_gusts_10m: 35,
            precipitation: 0.1,
            visibility: 5000,
          },
        },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    const pts = [
      { label: 'Origin', lat: 41.1234, lng: -87.1234 },
      { label: 'Destination', lat: 42.5678, lng: -88.5678 },
    ];

    const summary = await fetchRouteWeatherAndHazards(pts);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(summary.highestSeverity).toBe('critical');
    expect(summary.destinationWeather).toMatchObject({ temp: 40, code: 96 });
    expect(summary.hazards.map((h) => h.type)).toEqual(
      expect.arrayContaining(['ice', 'wind', 'thunderstorm', 'fog', 'rain'])
    );
    const windHazard = summary.hazards.find((h) => h.type === 'wind');
    expect(windHazard.severity).toBe('critical');
    expect(windHazard.segments).toEqual(['Origin', 'Destination']);

    // Second call hits 10-minute coordinate cache
    const cachedSummary = await fetchRouteWeatherAndHazards(pts);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cachedSummary.highestSeverity).toBe('critical');

    // Empty input returns null and HTTP failure throws
    expect(await fetchRouteWeatherAndHazards([])).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(
      fetchRouteWeatherAndHazards([{ label: 'Destination', lat: 15.1111, lng: 25.2222 }])
    ).rejects.toThrow('Open-Meteo HTTP 503');
  });
});
