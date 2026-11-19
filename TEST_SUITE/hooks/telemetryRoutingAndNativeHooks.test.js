import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { flushPromises, renderHookWithAct, resetAppAndToastStores } from '../helpers/renderUtils';
import { installFakeIndexedDB, resetFakeIndexedDB } from '../helpers/fakeIndexedDB';
import { getOfflineFixes } from '../../src/utils/offlineQueue';
import { useAppStore } from '../../src/store/useAppStore';
import { useToastStore } from '../../src/store/useToastStore';

const {
  hoistedState,
  useMapsLibraryMock,
  computeFleetRouteMock,
  fetchRouteWeatherAndHazardsMock,
  sampleRoutePointsMock,
  carBridgeMock,
  appAddListenerMock,
  appExitAppMock,
  statusBarMock,
  pushNotificationsMock,
  getMessagingMock,
  getTokenMock,
  isSupportedMock,
} = vi.hoisted(() => ({
  hoistedState: {
    mockFs: null,
    isNative: false,
    carActionCb: null,
    appBackCb: null,
    pushRegCb: null,
    pushRecvCb: null,
    pushActionCb: null,
    geoWatchCb: null,
    isLocationOnEdgeResult: true,
    routesLibrary: null,
    geometryLibrary: null,
  },
  useMapsLibraryMock: vi.fn((lib) => {
    if (lib === 'routes') return hoistedState.routesLibrary;
    if (lib === 'geometry') return hoistedState.geometryLibrary;
    return null;
  }),
  computeFleetRouteMock: vi.fn(),
  fetchRouteWeatherAndHazardsMock: vi.fn(),
  sampleRoutePointsMock: vi.fn(() => [{ label: 'Destination', lat: 30.26, lng: -97.74 }]),
  carBridgeMock: {
    syncJobs: vi.fn().mockResolvedValue(undefined),
    drainPendingCarActions: vi.fn().mockResolvedValue({ actions: '[]' }),
    addListener: vi.fn((ev, cb) => {
      if (ev === 'carAction') hoistedState.carActionCb = cb;
      return Promise.resolve({ remove: vi.fn() });
    }),
  },
  appAddListenerMock: vi.fn((ev, cb) => {
    if (ev === 'backButton') hoistedState.appBackCb = cb;
    return Promise.resolve({ remove: vi.fn() });
  }),
  appExitAppMock: vi.fn(),
  statusBarMock: {
    setStyle: vi.fn().mockResolvedValue(undefined),
    setBackgroundColor: vi.fn().mockResolvedValue(undefined),
  },
  pushNotificationsMock: {
    checkPermissions: vi.fn().mockResolvedValue({ receive: 'granted' }),
    requestPermissions: vi.fn().mockResolvedValue({ receive: 'granted' }),
    register: vi.fn().mockResolvedValue(undefined),
    addListener: vi.fn((ev, cb) => {
      if (ev === 'registration') hoistedState.pushRegCb = cb;
      if (ev === 'pushNotificationReceived') hoistedState.pushRecvCb = cb;
      if (ev === 'pushNotificationActionPerformed') hoistedState.pushActionCb = cb;
      return Promise.resolve({ remove: vi.fn() });
    }),
  },
  getMessagingMock: vi.fn(() => ({})),
  getTokenMock: vi.fn().mockResolvedValue('web_fcm_tok_1'),
  isSupportedMock: vi.fn().mockResolvedValue(true),
}));

vi.mock('firebase/firestore', async () => {
  const { createFirestoreMock } = await import('../helpers/firebaseMock');
  hoistedState.mockFs = hoistedState.mockFs || createFirestoreMock();
  return hoistedState.mockFs.firestoreModule;
});
vi.mock('firebase/app', () => ({
  getApp: vi.fn(() => ({})),
}));
vi.mock('firebase/messaging', () => ({
  getMessaging: getMessagingMock,
  getToken: getTokenMock,
  isSupported: isSupportedMock,
}));
vi.mock('../../src/firebase', async () => {
  const { createFirestoreMock } = await import('../helpers/firebaseMock');
  hoistedState.mockFs = hoistedState.mockFs || createFirestoreMock();
  return {
    db: hoistedState.mockFs.db,
    storage: { __type: 'mockStorage' },
    auth: { __type: 'mockAuth' },
  };
});
vi.mock('@vis.gl/react-google-maps', () => ({
  useMapsLibrary: useMapsLibraryMock,
}));
vi.mock('../../src/utils/googleRoutesAdapter', () => ({
  computeFleetRoute: computeFleetRouteMock,
}));
vi.mock('../../src/utils/weatherHazards', () => ({
  fetchRouteWeatherAndHazards: fetchRouteWeatherAndHazardsMock,
  sampleRoutePoints: sampleRoutePointsMock,
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => hoistedState.isNative,
  },
  registerPlugin: vi.fn((name) => {
    if (name === 'VectoCarBridge') return carBridgeMock;
    return {
      addWatcher: vi.fn().mockResolvedValue('w1'),
      removeWatcher: vi.fn().mockResolvedValue(undefined),
      openSettings: vi.fn(),
    };
  }),
}));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: appAddListenerMock,
    exitApp: appExitAppMock,
  },
}));
vi.mock('@capacitor/status-bar', () => ({
  StatusBar: statusBarMock,
  Style: { Dark: 'DARK' },
}));
vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: pushNotificationsMock,
}));

import { useGeofenceArrival } from '../../src/hooks/useGeofenceArrival';
import { useLocationSharing } from '../../src/hooks/useLocationSharing';
import { useDirections } from '../../src/hooks/useDirections';
import { useRouteWeather } from '../../src/hooks/useRouteWeather';
import { useCarAppSync } from '../../src/hooks/useCarAppSync';
import { enableNotifications, useNotifications } from '../../src/hooks/useNotifications';
import { useNativeDevice } from '../../src/hooks/useNativeDevice';

describe('telemetry, routing, weather, notifications, car bridge, and native hooks', () => {
  const mockFs = hoistedState.mockFs;

  beforeEach(() => {
    resetAppAndToastStores();
    mockFs.reset();
    resetFakeIndexedDB();
    installFakeIndexedDB();
    globalThis.__vectoMockOnline = true;
    hoistedState.isNative = false;
    hoistedState.carActionCb = null;
    hoistedState.appBackCb = null;
    hoistedState.pushRegCb = null;
    hoistedState.pushRecvCb = null;
    hoistedState.pushActionCb = null;
    hoistedState.geoWatchCb = null;
    hoistedState.isLocationOnEdgeResult = true;

    computeFleetRouteMock.mockReset();
    fetchRouteWeatherAndHazardsMock.mockReset();
    carBridgeMock.syncJobs.mockClear();
    carBridgeMock.drainPendingCarActions.mockReset().mockResolvedValue({ actions: '[]' });
    appExitAppMock.mockClear();
    statusBarMock.setStyle.mockClear();
    statusBarMock.setBackgroundColor.mockClear();
    pushNotificationsMock.register.mockClear();
    delete window.google;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete window.google;
  });

  it('useGeofenceArrival prompts within 150m, deduplicates stops, and auto-dismisses on arrival', async () => {
    useAppStore.getState().setCurrentUser({ id: 'drv1', name: 'Alex' });
    useAppStore.getState().setCompany('comp1', 'Alpha', false);

    const job = {
      id: 'job1',
      jobName: 'Austin Drop',
      status: 'in-progress',
      archived: false,
      assignedDrivers: [{ id: 'drv1', name: 'Alex' }],
      stops: [{ id: 's1', address: '100 Main St', lat: 30.2672, lng: -97.7431, status: 'pending' }],
    };

    const { rerender, unmount } = await renderHookWithAct((props) => useGeofenceArrival(props.jobs), {
      jobs: [job],
    });

    // Far away -> no prompt
    await act(async () => {
      useAppStore.getState().setCurrentLocation({ lat: 30.5, lng: -97.5 });
    });
    await flushPromises();
    expect(useAppStore.getState().arrivalPrompt).toBeNull();

    // Within 50m -> sets arrivalPrompt
    await act(async () => {
      useAppStore.getState().setCurrentLocation({ lat: 30.2675, lng: -97.7431 });
    });
    await flushPromises();
    expect(useAppStore.getState().arrivalPrompt).toMatchObject({
      jobId: 'job1',
      stopId: 's1',
      stopOrder: 1,
    });

    // Stop transitions to 'arrived' -> clears arrivalPrompt
    await rerender({
      jobs: [
        {
          ...job,
          stops: [{ ...job.stops[0], status: 'arrived' }],
        },
      ],
    });
    await flushPromises();
    expect(useAppStore.getState().arrivalPrompt).toBeNull();

    await unmount();
  });

  it('useLocationSharing normalizes telemetry, throttles writes, flushes breadcrumbs, queues offline, and toggles off', async () => {
    const clearWatchMock = vi.fn();
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn(),
        watchPosition: vi.fn((cb) => {
          hoistedState.geoWatchCb = cb;
          return 77;
        }),
        clearWatch: clearWatchMock,
      },
    });

    mockFs.seedDoc('companies/comp1/jobs/job1', {
      jobName: 'Live Route',
      status: 'in-progress',
      trackingToken: 'tok_12345678901234567890',
      assignedDrivers: [{ id: 'drv1', name: 'Alex' }],
    });
    useAppStore.getState().setCurrentUser({ id: 'drv1', name: 'Alex', phone: '555-0101', color: '#22c55e' });
    useAppStore.getState().setCompany('comp1', 'Alpha', false);
    useAppStore.getState().setSelectedJobId('job1');
    useAppStore.getState().setActiveJobs([
      {
        id: 'job1',
        jobName: 'Live Route',
        status: 'in-progress',
        trackingToken: 'tok_12345678901234567890',
        assignedDrivers: [{ id: 'drv1', name: 'Alex' }],
      },
    ]);

    const { result, unmount } = await renderHookWithAct(() => useLocationSharing());
    await flushPromises();

    // First fix -> normalizes 360->0 deg and 10 m/s -> 22.4 mph
    await act(async () => {
      await hoistedState.geoWatchCb({
        coords: { latitude: 30.0, longitude: -97.0, heading: 360, speed: 10, accuracy: 8.4 },
      });
    });
    await flushPromises();

    expect(useAppStore.getState().currentLocation).toEqual({
      lat: 30.0,
      lng: -97.0,
      heading: 0,
      speed: 22.4,
      accuracy: 8,
    });
    const activeDoc = mockFs.getRawDoc('companies/comp1/active_drivers/drv1');
    expect(activeDoc.heading).toBe(0);
    expect(activeDoc.speed).toBe(22.4);

    // Immediate identical tick within 12s & 8m is throttled (no extra setDoc)
    const setCallsBefore = mockFs.firestoreModule.setDoc.mock.calls.length;
    await act(async () => {
      await hoistedState.geoWatchCb({
        coords: { latitude: 30.00001, longitude: -97.00001, heading: 90, speed: 5, accuracy: 10 },
      });
    });
    await flushPromises();
    expect(mockFs.firestoreModule.setDoc).toHaveBeenCalledTimes(setCallsBefore);

    // Job switch updates activeJobId without restarting watchPosition
    await act(async () => {
      useAppStore.getState().setSelectedJobId('job2');
    });
    await flushPromises();
    expect(mockFs.getRawDoc('companies/comp1/active_drivers/drv1').activeJobId).toBe('job2');
    expect(clearWatchMock).not.toHaveBeenCalled();

    // 10-point breadcrumb flush when driving job1
    await act(async () => {
      useAppStore.getState().setSelectedJobId('job1');
    });
    await flushPromises();
    await act(async () => {
      for (let i = 1; i <= 10; i++) {
        await hoistedState.geoWatchCb({
          coords: { latitude: 30.0 + i * 0.005, longitude: -97.0, heading: 0, speed: 15, accuracy: 5 },
        });
      }
    });
    await flushPromises();
    expect(mockFs.firestoreModule.addDoc).toHaveBeenCalled();

    // Offline tick queues fix to IndexedDB
    globalThis.__vectoMockOnline = false;
    await act(async () => {
      await hoistedState.geoWatchCb({
        coords: { latitude: 30.5, longitude: -97.5, heading: 180, speed: 12, accuracy: 9 },
      });
    });
    await flushPromises();
    expect((await getOfflineFixes()).length).toBeGreaterThanOrEqual(1);

    // Toggle off removes watch and deletes active_drivers doc
    globalThis.__vectoMockOnline = true;
    await act(async () => {
      result.current.toggleLocationSharing();
    });
    await flushPromises();
    expect(clearWatchMock).toHaveBeenCalledWith(77);
    expect(mockFs.getRawDoc('companies/comp1/active_drivers/drv1')).toBeUndefined();

    await unmount();
  });

  it('useDirections renders Routes v2 markers, persists optimized waypointOrder, and recalculates on 3 off-route ticks', async () => {
    const rendererInstance = {
      setMap: vi.fn(),
      setDirections: vi.fn(),
    };
    const markerInstances = [];
    const bounds = { id: 'b1' };
    window.google = {
      maps: {
        LatLng: function makeLatLng(lat, lng) {
          return { lat: () => lat, lng: () => lng };
        },
        Marker: function makeMarker(opts) {
          const m = { opts, setMap: vi.fn() };
          markerInstances.push(m);
          return m;
        },
        Polyline: function makePolyline(opts) {
          return { opts, setPath: vi.fn(), setMap: vi.fn() };
        },
      },
    };
    hoistedState.routesLibrary = {
      Route: { computeRoutes: vi.fn() },
      DirectionsService: function makeDS() {
        return { route: vi.fn() };
      },
      DirectionsRenderer: function makeDR() {
        return rendererInstance;
      },
    };
    hoistedState.geometryLibrary = {
      poly: {
        isLocationOnEdge: vi.fn(() => hoistedState.isLocationOnEdgeResult),
      },
    };

    computeFleetRouteMock.mockResolvedValue({
      source: 'routes_v2',
      overviewPath: [{ lat: 30.1, lng: -97.7 }, { lat: 30.3, lng: -97.6 }],
      bounds,
      totalMeters: 16093,
      totalSeconds: 1500,
      totalNormalSeconds: 1000,
      waypointOrder: [1, 0],
      plainTextSteps: ['Go straight'],
      stepTraffics: [],
      destinationCoords: { lat: 30.3, lng: -97.6 },
      legs: [
        { startLocation: { lat: 30.1, lng: -97.7 }, end_location: { lat: 30.2, lng: -97.65 } },
        { startLocation: { lat: 30.2, lng: -97.65 }, end_location: { lat: 30.3, lng: -97.6 } },
      ],
    });

    const mapMock = { fitBounds: vi.fn() };
    const job = {
      id: 'job1',
      jobName: 'Multi Stop',
      origin: 'Depot',
      status: 'in-progress',
      assignedDrivers: [{ id: 'disp1', name: 'Dispatch' }],
      stops: [
        { id: 's0', address: 'Stop 1', order: 0, status: 'pending', serviceMinutes: 15 },
        { id: 's1', address: 'Stop 2', order: 1, status: 'pending', serviceMinutes: 20 },
        { id: 's2', address: 'Stop 3', order: 2, status: 'pending', serviceMinutes: 10 },
      ],
    };
    mockFs.seedDoc('companies/comp1/jobs/job1', job);
    useAppStore.getState().setCurrentUser({ id: 'disp1', name: 'Dispatch' });
    useAppStore.getState().setCompany('comp1', 'Alpha', true);

    const { unmount } = await renderHookWithAct(
      (props) => useDirections(props),
      { map: mapMock, selectedJobId: 'job1', jobs: [job] }
    );
    await flushPromises();

    expect(computeFleetRouteMock).toHaveBeenCalledTimes(1);
    expect(mapMock.fitBounds).toHaveBeenCalledWith(bounds, 56);
    expect(markerInstances.map((m) => m.opts.label)).toEqual(['A', 'B', 'C']);
    expect(useAppStore.getState().routeInfo).toMatchObject({
      jobId: 'job1',
      routeSource: 'routes_v2',
      totalDwellMinutes: 45,
      trafficStatus: 'red',
    });
    expect(mockFs.getRawDoc('companies/comp1/jobs/job1').waypointOrder).toEqual([1, 0]);

    // 3 consecutive off-route ticks trigger detour recalculation
    hoistedState.isLocationOnEdgeResult = false;
    await act(async () => {
      useAppStore.getState().setCurrentLocation({ lat: 31.0, lng: -98.0 });
    });
    await flushPromises();
    await act(async () => {
      useAppStore.getState().setCurrentLocation({ lat: 31.01, lng: -98.01 });
    });
    await flushPromises();
    await act(async () => {
      useAppStore.getState().setCurrentLocation({ lat: 31.02, lng: -98.02 });
    });
    await flushPromises();

    expect(computeFleetRouteMock).toHaveBeenCalledTimes(2);
    expect(useToastStore.getState().toasts.some((t) => t.message.includes('Detour detected'))).toBe(true);

    await unmount();
  });

  it('useRouteWeather updates routeWeather store and raises critical hazard toast on active trip', async () => {
    fetchRouteWeatherAndHazardsMock.mockResolvedValue({
      destinationWeather: { temp: 30, desc: 'Freezing Rain' },
      highestSeverity: 'critical',
      hazards: [{ type: 'ice', severity: 'critical', icon: '🧊', title: 'Ice / Freezing Road Risk', segment: 'Destination' }],
    });

    const jobs = [{ id: 'job1', status: 'in-progress' }];
    const { rerender, unmount } = await renderHookWithAct(
      (props) => useRouteWeather(props.selectedJobId, props.routeInfo, props.jobs),
      { selectedJobId: 'job1', routeInfo: { jobId: 'job1', overviewPath: [{ lat: 30, lng: -97 }] }, jobs }
    );
    await flushPromises();

    expect(useAppStore.getState().routeWeather.highestSeverity).toBe('critical');
    expect(useToastStore.getState().toasts.some((t) => t.message.includes('Ice / Freezing Road Risk'))).toBe(true);

    await rerender({ selectedJobId: null, routeInfo: null, jobs });
    expect(useAppStore.getState().routeWeather).toBeNull();

    await unmount();
  });

  it('useCarAppSync pushes active assigned jobs and processes complete_stop & update_status actions', async () => {
    hoistedState.isNative = true;
    const job = {
      id: 'job_car',
      jobName: 'Car Route',
      status: 'in-progress',
      contactName: 'Acme Dock',
      contactNumber: '555-2020',
      assignedDrivers: [{ id: 'drv1', name: 'Alex' }],
      instructions: [{ id: 'i1', text: 'Call on arrival', target: 'all', isPriority: true }],
      stops: [
        { id: 's1', address: 'Stop 1', order: 0, status: 'pending' },
        { id: 's2', address: 'Stop 2', order: 1, status: 'pending' },
      ],
    };
    mockFs.seedDoc('companies/comp1/jobs/job_car', job);

    carBridgeMock.drainPendingCarActions.mockResolvedValue({
      actions: JSON.stringify([
        { type: 'select_job', jobId: 'job_car' },
        { type: 'complete_stop', jobId: 'job_car', stopId: 's1' },
        { type: 'update_status', jobId: 'job_car', status: 'completed' },
      ]),
    });

    useAppStore.getState().setCurrentUser({ id: 'drv1', name: 'Alex' });
    useAppStore.getState().setCompany('comp1', 'Alpha', false);

    const { unmount } = await renderHookWithAct(() => useCarAppSync([job]));
    await flushPromises();

    expect(carBridgeMock.syncJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        companyName: 'Alpha',
        jobs: expect.arrayContaining([
          expect.objectContaining({
            id: 'job_car',
            notes: '[PRIORITY] Call on arrival',
            remainingStopCount: 2,
          }),
        ]),
      })
    );
    expect(useAppStore.getState().selectedJobId).toBe('job_car');
    const saved = mockFs.getRawDoc('companies/comp1/jobs/job_car');
    expect(saved.status).toBe('completed');
    expect(saved.stops.every((s) => s.status === 'completed')).toBe(true);

    await unmount();
  });

  it('useNotifications seeds baseline, detects real-time diffs, and enables web & native notifications', async () => {
    mockFs.seedDoc('users/drv1', { preferences: {} });
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: {
        permission: 'granted',
        requestPermission: vi.fn().mockResolvedValue('granted'),
      },
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        register: vi.fn().mockResolvedValue({}),
        getRegistration: vi.fn().mockResolvedValue(null),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });

    const webRes = await enableNotifications('drv1');
    expect(webRes).toMatchObject({ granted: true, platform: 'web' });
    expect(mockFs.getRawDoc('users/drv1').preferences.notificationsEnabled).toBe(true);

    hoistedState.isNative = true;
    const nativeRes = await enableNotifications('drv1');
    expect(nativeRes).toEqual({ granted: true, status: 'granted', platform: 'native' });
    expect(pushNotificationsMock.register).toHaveBeenCalled();

    hoistedState.isNative = false;
    useAppStore.getState().setCurrentUser({ id: 'drv1', name: 'Alex', lastRead: {} });
    useAppStore.getState().setCompany('comp1', 'Alpha', true);

    const initialJob = {
      id: 'j1',
      jobName: 'Morning Load',
      status: 'assigned',
      assignedDrivers: [],
      instructions: [],
      lastMessageTimestamp: 100,
    };

    const { rerender, unmount } = await renderHookWithAct((props) => useNotifications(props.jobs), {
      jobs: [initialJob],
    });
    await flushPromises();
    expect(useToastStore.getState().toasts).toHaveLength(0);

    // Driver gets newly assigned
    await rerender({
      jobs: [{ ...initialJob, assignedDrivers: [{ id: 'drv1', name: 'Alex' }] }],
    });
    expect(useToastStore.getState().toasts.some((t) => t.message.includes('New Job Assigned'))).toBe(true);

    // Priority instruction + pending completion + new chat
    await rerender({
      jobs: [
        {
          ...initialJob,
          status: 'pending-completion',
          assignedDrivers: [{ id: 'drv1', name: 'Alex' }],
          instructions: [{ id: 'p1', text: 'Gate code 999', isPriority: true, target: 'drv1' }],
          lastMessageTimestamp: 5000,
        },
      ],
    });
    const msgs = useToastStore.getState().toasts.map((t) => t.message);
    expect(msgs.some((m) => m.includes('Job Pending Review'))).toBe(true);
    expect(msgs.some((m) => m.includes('Priority Dispatch Note'))).toBe(true);
    expect(msgs.some((m) => m.includes('New Job Message'))).toBe(true);

    await unmount();
  });

  it('useNativeDevice configures dark StatusBar and walks all 5 hardware backButton levels', async () => {
    hoistedState.isNative = true;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T12:00:00Z'));

    useAppStore.getState().openModal('settings');
    useAppStore.getState().setSelectedJobId('j1');
    useAppStore.getState().setMainView('operations');
    useAppStore.getState().setMobileView('map');

    const { unmount } = await renderHookWithAct(() => useNativeDevice());
    expect(statusBarMock.setStyle).toHaveBeenCalledWith({ style: 'DARK' });
    expect(statusBarMock.setBackgroundColor).toHaveBeenCalledWith({ color: '#0b0f19' });

    // Level 1: close open modal
    await act(async () => {
      hoistedState.appBackCb();
    });
    expect(useAppStore.getState().modals.settings).toBe(false);

    // Level 2: deselect job (also resets mobileView to 'sidebar')
    await act(async () => {
      hoistedState.appBackCb();
    });
    expect(useAppStore.getState().selectedJobId).toBeNull();
    expect(useAppStore.getState().mobileView).toBe('sidebar');

    // Level 3: operations -> map
    await act(async () => {
      useAppStore.getState().setMobileView('map');
      hoistedState.appBackCb();
    });
    expect(useAppStore.getState().mainView).toBe('map');

    // Level 4: mobile map -> sidebar
    await act(async () => {
      hoistedState.appBackCb();
    });
    expect(useAppStore.getState().mobileView).toBe('sidebar');

    // Level 5: double-tap within 2000ms exits app
    await act(async () => {
      hoistedState.appBackCb();
    });
    expect(useToastStore.getState().toasts.some((t) => t.message.includes('Press back again to exit'))).toBe(true);
    expect(appExitAppMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    await act(async () => {
      hoistedState.appBackCb();
    });
    expect(appExitAppMock).toHaveBeenCalledTimes(1);

    await unmount();
  });
});
