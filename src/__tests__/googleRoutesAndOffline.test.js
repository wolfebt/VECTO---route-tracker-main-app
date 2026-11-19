import { describe, it, expect, beforeEach, vi } from 'vitest';
import { computeFleetRoute, resetRoutesAdapterState } from '../utils/googleRoutesAdapter';
import { blobToDataUrl, compressImageFile, dataUrlToBlob } from '../utils/imageCompression';

describe('googleRoutesAdapter & imageCompression', () => {
  beforeEach(() => {
    resetRoutesAdapterState();
  });

  it('uses modern Route.computeRoutes when available', async () => {
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
                  path: [{ lat: 30.1, lng: -97.7 }, { lat: 30.3, lng: -97.6 }],
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
    expect(result.plainTextSteps).toEqual(['Head north on I-35']);
  });

  it('falls back to DirectionsService on permission errors and caches block for session', async () => {
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
  });

  it('round-trips blobs through base64 data URLs and passes non-raster files through compressImageFile', async () => {
    const original = new Blob(['vecto-pod-payload'], { type: 'text/plain' });
    const dataUrl = await blobToDataUrl(original);
    expect(dataUrl).toMatch(/^data:text\/plain;base64,/);

    const restored = dataUrlToBlob(dataUrl);
    expect(restored.type).toBe('text/plain');
    expect(restored.size).toBe(original.size);

    const svgFile = new File(['<svg></svg>'], 'icon.svg', { type: 'image/svg+xml' });
    expect(await compressImageFile(svgFile)).toBe(svgFile);
    expect(await compressImageFile(null)).toBeNull();
  });
});
