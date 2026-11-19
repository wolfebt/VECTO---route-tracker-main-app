import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installFakeIndexedDB, resetFakeIndexedDB } from './helpers/fakeIndexedDB';

const { hoistedState, storageUploadBytes, storageGetDownloadURL, storageRef, syncPublicTrackingMock } = vi.hoisted(() => ({
  hoistedState: { mockFs: null },
  storageUploadBytes: vi.fn().mockResolvedValue({}),
  storageGetDownloadURL: vi.fn().mockResolvedValue('https://storage.example/uploaded.jpg'),
  storageRef: vi.fn((_s, path) => ({ fullPath: path })),
  syncPublicTrackingMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('firebase/firestore', async () => {
  const { createFirestoreMock } = await import('./helpers/firebaseMock');
  hoistedState.mockFs = hoistedState.mockFs || createFirestoreMock();
  return hoistedState.mockFs.firestoreModule;
});
vi.mock('firebase/storage', () => ({
  ref: storageRef,
  uploadBytes: storageUploadBytes,
  getDownloadURL: storageGetDownloadURL,
}));
vi.mock('../src/utils/publicTracking', () => ({
  syncPublicTrackingJobUpdate: syncPublicTrackingMock,
}));

import { computeFleetRoute, resetRoutesAdapterState } from '../src/utils/googleRoutesAdapter';
import { blobToDataUrl, compressImageFile, dataUrlToBlob } from '../src/utils/imageCompression';
import {
  flushBreadcrumbChunk,
  flushOfflinePodQueue,
  flushOfflineQueue,
  getOfflineFixes,
  getOfflinePods,
  removeOfflineFixes,
  removeOfflinePod,
  saveOfflineFix,
  saveOfflinePod,
} from '../src/utils/offlineQueue';

describe('googleRoutesAdapter, imageCompression & offlineQueue', () => {
  const mockFs = hoistedState.mockFs;
  beforeEach(() => {
    resetRoutesAdapterState();
    mockFs.reset();
    resetFakeIndexedDB();
    installFakeIndexedDB();
    globalThis.__vectoMockOnline = true;
    storageUploadBytes.mockClear();
    storageGetDownloadURL.mockClear();
    storageRef.mockClear();
    syncPublicTrackingMock.mockClear();
  });

  it('uses modern Route.computeRoutes when available and classifies traffic colors', async () => {
    const computeRoutes = vi.fn().mockResolvedValue({
      routes: [
        {
          path: [{ lat: 30.1, lng: -97.7 }, { lat: 30.3, lng: -97.6 }],
          distanceMeters: 16093,
          durationMillis: 1200000,
          staticDurationMillis: 900000,
          optimizedIntermediateWaypointIndex: [1, 0],
          legs: [
            {
              startLocation: { lat: 30.1, lng: -97.7 },
              endLocation: { lat: 30.3, lng: -97.6 },
              steps: [
                {
                  instructions: '<b>Head north</b> on I-35',
                  durationMillis: 1200000,
                  staticDurationMillis: 900000,
                  path: [{ lat: 30.1, lng: -97.7 }, { lat: 30.2, lng: -97.65 }],
                },
                {
                  instructions: 'Exit toward Round Rock',
                  durationMillis: 115000,
                  staticDurationMillis: 100000,
                  path: [{ lat: 30.2, lng: -97.65 }, { lat: 30.3, lng: -97.6 }],
                },
              ],
            },
          ],
        },
      ],
    });

    const result = await computeFleetRoute({
      routesLibrary: { Route: { computeRoutes } },
      directionsService: { route: vi.fn() },
      origin: 'Austin, TX',
      destination: 'Round Rock, TX',
      waypoints: [{ location: 'Stop 1' }, { location: 'Stop 2' }],
      optimizeWaypoints: true,
    });

    expect(computeRoutes).toHaveBeenCalledTimes(1);
    expect(result.source).toBe('routes_v2');
    expect(result.totalMeters).toBe(16093);
    expect(result.waypointOrder).toEqual([1, 0]);
    expect(result.plainTextSteps).toEqual(['Head north on I-35', 'Exit toward Round Rock']);
    expect(result.stepTraffics.map((s) => s.color)).toEqual(['#ef4444', '#f97316']);
  });

  it('falls back to DirectionsService on permission errors, caches block, and throws when missing', async () => {
    const computeRoutes = vi.fn().mockRejectedValue(new Error('PERMISSION_DENIED: Routes API not enabled'));
    const legacyRoute = vi.fn().mockResolvedValue({
      routes: [
        {
          overview_path: [{ lat: () => 30.1, lng: () => -97.7 }],
          waypoint_order: [],
          legs: [
            {
              distance: { value: 5000 },
              duration: { value: 600 },
              duration_in_traffic: { value: 650 },
              start_location: { lat: () => 30.1, lng: () => -97.7 },
              end_location: { lat: () => 30.2, lng: () => -97.6 },
              steps: [{ instructions: 'Turn right', path: [] }],
            },
          ],
        },
      ],
    });

    const first = await computeFleetRoute({
      routesLibrary: { Route: { computeRoutes } },
      directionsService: { route: legacyRoute },
      origin: 'Origin',
      destination: 'Dest',
    });
    expect(first.source).toBe('directions_legacy');
    expect(legacyRoute).toHaveBeenCalledTimes(1);

    const second = await computeFleetRoute({
      routesLibrary: { Route: { computeRoutes } },
      directionsService: { route: legacyRoute },
      origin: 'Origin 2',
      destination: 'Dest 2',
    });
    expect(second.source).toBe('directions_legacy');
    expect(computeRoutes).toHaveBeenCalledTimes(1);
    expect(legacyRoute).toHaveBeenCalledTimes(2);

    await expect(
      computeFleetRoute({ routesLibrary: null, directionsService: null, origin: 'A', destination: 'B' })
    ).rejects.toThrow('No Google Maps routing service available');
  });

  it('round-trips blobs through base64 data URLs and compresses raster images via canvas', async () => {
    const original = new Blob(['vecto-pod-payload'], { type: 'text/plain' });
    const dataUrl = await blobToDataUrl(original);
    expect(dataUrl).toMatch(/^data:text\/plain;base64,/);

    const restored = dataUrlToBlob(dataUrl);
    expect(restored.type).toBe('text/plain');
    expect(restored.size).toBe(original.size);
    expect(dataUrlToBlob('invalid')).toBeNull();

    const svgFile = new File(['<svg></svg>'], 'icon.svg', { type: 'image/svg+xml' });
    expect(await compressImageFile(svgFile)).toBe(svgFile);
    expect(await compressImageFile(null)).toBeNull();

    const OriginalImage = globalThis.Image;
    let shouldError = false;
    globalThis.Image = class MockImage {
      constructor() {
        this.naturalWidth = 3200;
        this.naturalHeight = 1600;
      }
      set src(_val) {
        queueMicrotask(() => {
          if (shouldError) this.onerror?.();
          else this.onload?.();
        });
      }
    };

    try {
      const largePng = new File([new Uint8Array(2048)], 'delivery-photo.png', { type: 'image/png' });
      const compressed = await compressImageFile(largePng);
      expect(compressed).not.toBe(largePng);
      expect(compressed.name).toBe('delivery-photo.jpg');
      expect(compressed.type).toBe('image/jpeg');

      const tinyPng = new File([new Uint8Array(4)], 'tiny.png', { type: 'image/png' });
      expect(await compressImageFile(tinyPng)).toBe(tinyPng);

      shouldError = true;
      expect(await compressImageFile(largePng)).toBe(largePng);
    } finally {
      globalThis.Image = OriginalImage;
    }
  });

  it('queues offline GPS fixes, deduplicates active_drivers, chunks >150 breadcrumbs, and cleans up', async () => {
    const fix1 = await saveOfflineFix('comp1', 'drv1', {
      lat: 30.0,
      lng: -97.0,
      status: 'Available',
      name: 'Alex',
      geohash: '9v6k',
      activeJobId: 'job1',
    });
    await saveOfflineFix('comp1', 'drv1', {
      lat: 30.00001,
      lng: -97.00001,
      status: 'Available',
      name: 'Alex',
      geohash: '9v6k',
      activeJobId: 'job1',
    });
    const fix3 = await saveOfflineFix('comp1', 'drv1', {
      location: { latitude: 30.25, longitude: -97.25 },
      status: 'Available',
      name: 'Alex',
      geohash: '9v6m',
      activeJobId: 'job1',
    });
    expect(fix1).toBeDefined();
    expect(fix3).toBeDefined();
    expect(await getOfflineFixes()).toHaveLength(3);

    await flushOfflineQueue(mockFs.db);
    expect(mockFs.firestoreModule.setDoc).toHaveBeenCalledTimes(1);
    expect(mockFs.firestoreModule.addDoc).toHaveBeenCalledTimes(1);
    const activeDriver = mockFs.getRawDoc('companies/comp1/active_drivers/drv1');
    expect(activeDriver.location).toEqual({ latitude: 30.25, longitude: -97.25 });
    expect(await getOfflineFixes()).toHaveLength(0);

    mockFs.firestoreModule.addDoc.mockClear();

    // >150 points triggers multi-chunk breadcrumb writes while dropping NaN coordinates
    const points = Array.from({ length: 165 }, (_, i) => ({
      lat: 30 + i * 0.001,
      lng: -97,
      ts: 1000 + i * 1000,
    }));
    points.push({ lat: Number.NaN, lng: -97, ts: 99999 });
    await flushBreadcrumbChunk(mockFs.db, {
      companyId: 'comp1',
      jobId: 'job1',
      driverId: 'drv1',
      driverName: 'Alex',
      points,
    });
    expect(mockFs.firestoreModule.addDoc).toHaveBeenCalledTimes(2);

    const extraId = await saveOfflineFix('comp1', 'drv2', { lat: 31, lng: -98, status: 'Available' });
    await removeOfflineFixes([extraId]);
    expect(await getOfflineFixes()).toHaveLength(0);
  });

  it('queues offline POD records and flushes storage uploads, job updates, notes, and tracking sync', async () => {
    mockFs.seedDoc('companies/comp1/jobs/job1', {
      jobName: 'Downtown Drop',
      origin: 'Depot',
      status: 'in-progress',
      trackingToken: 'token_12345678901234567890',
      stops: [
        { id: 'stop_0', address: '100 Main St', order: 0, status: 'pending' },
      ],
    });

    const podId = await saveOfflinePod({
      companyId: 'comp1',
      companyName: 'VECTO Alpha',
      jobId: 'job1',
      selectedStopId: 'stop_0',
      recipientName: 'Jamie',
      deliveryNotes: 'Left at bay 2',
      capturedAt: 1700000123,
      capturedBy: 'drv1',
      capturedByName: 'Alex',
      capturedLat: 30.26,
      capturedLng: -97.74,
      photoDataUrl: 'data:image/jpeg;base64,ZmFrZVBvZFBob3Rv',
      signatureDataUrl: 'data:image/png;base64,ZmFrZVNpZ25hdHVyZQ==',
      noteWritten: false,
    });
    expect(podId).toBeDefined();
    expect(await getOfflinePods()).toHaveLength(1);

    // Offline guard does not flush while offline
    globalThis.__vectoMockOnline = false;
    expect(await flushOfflinePodQueue(mockFs.db, {})).toBe(0);
    expect(await getOfflinePods()).toHaveLength(1);

    // Coming back online flushes POD photo + signature + job update + note + public tracking
    globalThis.__vectoMockOnline = true;
    const flushed = await flushOfflinePodQueue(mockFs.db, {});
    expect(flushed).toBe(1);
    expect(storageUploadBytes).toHaveBeenCalledTimes(2);
    expect(syncPublicTrackingMock).toHaveBeenCalledTimes(1);
    const updatedJob = mockFs.getRawDoc('companies/comp1/jobs/job1');
    expect(updatedJob.stops[0].status).toBe('completed');
    expect(updatedJob.stops[0].pod.recipientName).toBe('Jamie');
    expect(updatedJob.pod.stopId).toBe('stop_0');
    expect(await getOfflinePods()).toHaveLength(0);

    // Malformed entry is removed gracefully
    const badId = await saveOfflinePod({ companyId: '' });
    expect(await getOfflinePods()).toHaveLength(1);
    await flushOfflinePodQueue(mockFs.db, {});
    expect(await getOfflinePods()).toHaveLength(0);
    await removeOfflinePod(badId);
  });
});
