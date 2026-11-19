import React, { useEffect, useRef, useMemo, useState } from 'react';
import { useMap } from '@vis.gl/react-google-maps';
import { useAppStore } from '../../store/useAppStore';

function getSqDist(p1, p2, cosLat = 1) {
  const dx = p1.lat - p2.lat;
  const dy = (p1.lng - p2.lng) * cosLat;
  return dx * dx + dy * dy;
}

function normalizePath(path) {
  if (!Array.isArray(path)) return [];
  return path
    .map((pt) => ({
      lat: typeof pt.lat === 'function' ? pt.lat() : Number(pt.lat),
      lng: typeof pt.lng === 'function' ? pt.lng() : Number(pt.lng),
    }))
    .filter((pt) => !isNaN(pt.lat) && !isNaN(pt.lng));
}

function splitPathAtLocation(normalizedPath, driverLocation) {
  if (!normalizedPath || normalizedPath.length < 2) {
    return { travelledPath: [], ongoingPath: normalizedPath || [] };
  }

  if (!driverLocation || typeof driverLocation.lat !== 'number' || typeof driverLocation.lng !== 'number') {
    return { travelledPath: [], ongoingPath: normalizedPath };
  }

  const dLat = Number(driverLocation.lat);
  const dLng = Number(driverLocation.lng);
  if (isNaN(dLat) || isNaN(dLng)) {
    return { travelledPath: [], ongoingPath: normalizedPath };
  }

  const cosLat = Math.max(0.2, Math.cos((dLat * Math.PI) / 180));
  let minSqDist = Infinity;
  let bestIndex = 0;
  let closestPoint = null;

  for (let i = 0; i < normalizedPath.length - 1; i++) {
    const p1 = normalizedPath[i];
    const p2 = normalizedPath[i + 1];

    const dx = p2.lat - p1.lat;
    const dy = (p2.lng - p1.lng) * cosLat;
    const lenSq = dx * dx + dy * dy;

    let t = 0;
    if (lenSq > 0) {
      t = ((dLat - p1.lat) * dx + ((dLng - p1.lng) * cosLat) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
    }

    const proj = { lat: p1.lat + t * (p2.lat - p1.lat), lng: p1.lng + t * (p2.lng - p1.lng) };
    const sqDist = getSqDist({ lat: dLat, lng: dLng }, proj, cosLat);

    if (sqDist < minSqDist) {
      minSqDist = sqDist;
      bestIndex = i;
      closestPoint = proj;
    }
  }

  // If driver is unreasonably far from the route (> ~15km), don't split
  if (minSqDist > 0.02) {
    return { travelledPath: [], ongoingPath: normalizedPath };
  }

  const travelledPath = [...normalizedPath.slice(0, bestIndex + 1), closestPoint];
  const ongoingPath = [closestPoint, ...normalizedPath.slice(bestIndex + 1)];

  return { travelledPath, ongoingPath };
}

/**
 * WebGL Google Maps Polyline renderer for 'solid', 'alternating', and 'traffic' modes.
 * Triggers zero React re-renders during pan, zoom, or dash animation.
 */
function PolylineRouteLayer({ map, fullPath, travelledPath, ongoingPath, stepTraffics, routeColor, routeStyle }) {
  const mainView = useAppStore((s) => s.mainView);
  const mobileView = useAppStore((s) => s.mobileView);
  const [isDocVisible, setIsDocVisible] = useState(() =>
    typeof document !== 'undefined' ? document.visibilityState !== 'hidden' : true
  );
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(min-width: 768px)').matches : true
  );

  const casingRef = useRef(null);
  const travelledRef = useRef(null);
  const ongoingRef = useRef(null);
  const trafficLinesRef = useRef([]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisibility = () => setIsDocVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = (e) => setIsDesktop(e.matches);
    setIsDesktop(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const shouldAnimate =
    routeStyle !== 'traffic' &&
    routeStyle !== 'solid' &&
    isDocVisible &&
    mainView === 'map' &&
    (isDesktop || mobileView === 'map');

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    casingRef.current = new window.google.maps.Polyline({
      map,
      strokeColor: '#0f172a',
      strokeOpacity: 0.6,
      strokeWeight: 10,
      zIndex: 2,
      clickable: false,
    });

    travelledRef.current = new window.google.maps.Polyline({
      map,
      strokeColor: '#3b82f6',
      strokeOpacity: 0.9,
      strokeWeight: 6,
      zIndex: 4,
      clickable: false,
    });

    ongoingRef.current = new window.google.maps.Polyline({
      map,
      strokeColor: '#3b82f6',
      strokeOpacity: 1,
      strokeWeight: 6,
      zIndex: 3,
      clickable: false,
    });

    return () => {
      casingRef.current?.setMap(null);
      travelledRef.current?.setMap(null);
      ongoingRef.current?.setMap(null);
      trafficLinesRef.current.forEach((line) => line.setMap(null));
      trafficLinesRef.current = [];
    };
  }, [map]);

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    const color = routeColor || '#3b82f6';
    let animTimer = null;

    // Reset previous traffic lines
    trafficLinesRef.current.forEach((line) => line.setMap(null));
    trafficLinesRef.current = [];

    // Casing line across full path
    if (fullPath.length >= 2) {
      casingRef.current?.setPath(fullPath);
      casingRef.current?.setOptions({ strokeWeight: routeStyle === 'traffic' ? 11 : 10, strokeOpacity: 0.6 });
      casingRef.current?.setVisible(true);
    } else {
      casingRef.current?.setVisible(false);
    }

    if (routeStyle === 'traffic') {
      ongoingRef.current?.setVisible(false);

      if (travelledPath.length >= 2) {
        travelledRef.current?.setPath(travelledPath);
        travelledRef.current?.setOptions({ strokeColor: color, strokeOpacity: 0.4, strokeWeight: 6 });
        travelledRef.current?.setVisible(true);
      } else {
        travelledRef.current?.setVisible(false);
      }

      const segments = stepTraffics && stepTraffics.length > 0 ? stepTraffics : [{ path: fullPath, color }];
      trafficLinesRef.current = segments
        .map((seg) => {
          const pts = normalizePath(seg.path);
          if (pts.length < 2) return null;
          return new window.google.maps.Polyline({
            map,
            path: pts,
            strokeColor: seg.color || color,
            strokeOpacity: 0.95,
            strokeWeight: 6,
            zIndex: 3,
            clickable: false,
          });
        })
        .filter(Boolean);
    } else if (routeStyle === 'solid') {
      if (travelledPath.length >= 2) {
        travelledRef.current?.setPath(travelledPath);
        travelledRef.current?.setOptions({ strokeColor: color, strokeOpacity: 0.45, strokeWeight: 6 });
        travelledRef.current?.setVisible(true);
      } else {
        travelledRef.current?.setVisible(false);
      }

      if (ongoingPath.length >= 2) {
        ongoingRef.current?.setPath(ongoingPath);
        ongoingRef.current?.setOptions({
          strokeColor: color,
          strokeOpacity: 1,
          strokeWeight: 6,
          icons: [],
        });
        ongoingRef.current?.setVisible(true);
      } else {
        ongoingRef.current?.setVisible(false);
      }
    } else {
      // 'alternating' mode: solid travelled + smoothly pulsing animated dash ongoing
      if (travelledPath.length >= 2) {
        travelledRef.current?.setPath(travelledPath);
        travelledRef.current?.setOptions({ strokeColor: color, strokeOpacity: 0.95, strokeWeight: 6 });
        travelledRef.current?.setVisible(true);
      } else {
        travelledRef.current?.setVisible(false);
      }

      if (ongoingPath.length >= 2) {
        let step = 0;
        const applyDashFrame = () => {
          const offsetPx = (step * 1.5) % 24;
          const opacity = 0.25 + 0.7 * (0.5 + 0.5 * Math.sin(step * 0.22));
          ongoingRef.current?.setOptions({
            strokeColor: color,
            strokeOpacity: 0,
            strokeWeight: 5,
            icons: [
              {
                icon: {
                  path: 'M 0,-1 L 0,1',
                  strokeOpacity: opacity,
                  strokeColor: color,
                  scale: 4,
                },
                offset: `${offsetPx.toFixed(1)}px`,
                repeat: '24px',
              },
            ],
          });
          step += 1;
        };

        ongoingRef.current?.setPath(ongoingPath);
        applyDashFrame();
        ongoingRef.current?.setVisible(true);
        if (shouldAnimate) {
          animTimer = window.setInterval(applyDashFrame, 120);
        }
      } else {
        ongoingRef.current?.setVisible(false);
      }
    }

    return () => {
      if (animTimer) window.clearInterval(animTimer);
      trafficLinesRef.current.forEach((line) => line.setMap(null));
      trafficLinesRef.current = [];
    };
  }, [map, fullPath, travelledPath, ongoingPath, stepTraffics, routeColor, routeStyle, shouldAnimate]);

  return null;
}

/**
 * Imperative HTML5 <canvas> OverlayView for hollow-core 'outlined' route rendering.
 * Draws directly in draw() / bounds_changed without triggering React re-renders.
 */
function CanvasOutlinedOverlay({ map, travelledPath, ongoingPath, routeColor }) {
  const dataRef = useRef({ travelledPath, ongoingPath, routeColor });
  const overlayRef = useRef(null);

  useEffect(() => {
    dataRef.current = { travelledPath, ongoingPath, routeColor };
    overlayRef.current?.draw();
  }, [travelledPath, ongoingPath, routeColor]);

  useEffect(() => {
    if (!map || !window.google?.maps?.OverlayView) return;

    class HollowRouteCanvasOverlay extends window.google.maps.OverlayView {
      constructor() {
        super();
        this.canvas = document.createElement('canvas');
        this.canvas.style.position = 'absolute';
        this.canvas.style.pointerEvents = 'none';
        this.canvas.style.zIndex = '5';
      }

      onAdd() {
        const panes = this.getPanes();
        if (panes?.overlayLayer) {
          panes.overlayLayer.appendChild(this.canvas);
        }
      }

      onRemove() {
        if (this.canvas.parentNode) {
          this.canvas.parentNode.removeChild(this.canvas);
        }
      }

      draw() {
        const projection = this.getProjection();
        const currentMap = this.getMap();
        const bounds = currentMap?.getBounds();
        if (!projection || !bounds) return;

        const sw = projection.fromLatLngToDivPixel(bounds.getSouthWest());
        const ne = projection.fromLatLngToDivPixel(bounds.getNorthEast());
        if (!sw || !ne) return;

        const pad = 40;
        const left = Math.min(sw.x, ne.x) - pad;
        const top = Math.min(sw.y, ne.y) - pad;
        const width = Math.max(1, Math.abs(ne.x - sw.x) + pad * 2);
        const height = Math.max(1, Math.abs(sw.y - ne.y) + pad * 2);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        this.canvas.style.left = `${left}px`;
        this.canvas.style.top = `${top}px`;
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;

        const targetW = Math.round(width * dpr);
        const targetH = Math.round(height * dpr);
        if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
          this.canvas.width = targetW;
          this.canvas.height = targetH;
        }

        const ctx = this.canvas.getContext('2d');
        if (!ctx) return;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const { travelledPath: tPath, ongoingPath: oPath, routeColor: color } = dataRef.current;

        const tracePoints = (pts) => {
          if (!pts || pts.length < 2) return false;
          ctx.beginPath();
          let started = false;
          for (let i = 0; i < pts.length; i++) {
            const pix = projection.fromLatLngToDivPixel(new window.google.maps.LatLng(pts[i].lat, pts[i].lng));
            if (!pix) continue;
            const x = pix.x - left;
            const y = pix.y - top;
            if (!started) {
              ctx.moveTo(x, y);
              started = true;
            } else {
              ctx.lineTo(x, y);
            }
          }
          return started;
        };

        // 1. Hollow-core ongoing route
        if (tracePoints(oPath)) {
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
          ctx.lineWidth = 16;
          ctx.stroke();

          ctx.strokeStyle = color || '#3b82f6';
          ctx.lineWidth = 13;
          ctx.stroke();

          ctx.save();
          ctx.globalCompositeOperation = 'destination-out';
          ctx.strokeStyle = 'rgba(0, 0, 0, 1)';
          ctx.lineWidth = 6;
          ctx.stroke();
          ctx.restore();
        }

        // 2. Solid travelled route
        if (tracePoints(tPath)) {
          ctx.save();
          ctx.globalAlpha = 0.85;
          ctx.strokeStyle = color || '#3b82f6';
          ctx.lineWidth = 6;
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    const overlay = new HollowRouteCanvasOverlay();
    overlay.setMap(map);
    overlayRef.current = overlay;

    const boundsListener = map.addListener('bounds_changed', () => {
      overlay.draw();
    });

    return () => {
      window.google.maps.event.removeListener(boundsListener);
      overlay.setMap(null);
      overlayRef.current = null;
    };
  }, [map]);

  return null;
}

export default function RouteOutlineOverlay({
  path,
  stepTraffics = [],
  routeColor = '#3b82f6',
  routeStyle = 'alternating',
  driverLocation = null,
}) {
  const map = useMap();

  const normalizedFullPath = useMemo(() => normalizePath(path), [path]);

  const { travelledPath, ongoingPath } = useMemo(() => {
    return splitPathAtLocation(normalizedFullPath, driverLocation);
  }, [normalizedFullPath, driverLocation]);

  if (!map || normalizedFullPath.length < 2) return null;

  if (routeStyle === 'outlined') {
    return (
      <CanvasOutlinedOverlay
        map={map}
        travelledPath={travelledPath}
        ongoingPath={ongoingPath}
        routeColor={routeColor}
      />
    );
  }

  return (
    <PolylineRouteLayer
      map={map}
      fullPath={normalizedFullPath}
      travelledPath={travelledPath}
      ongoingPath={ongoingPath}
      stepTraffics={stepTraffics}
      routeColor={routeColor}
      routeStyle={routeStyle}
    />
  );
}
