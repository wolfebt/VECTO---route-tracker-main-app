import React, { useEffect, useRef, useState, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { useMap } from '@vis.gl/react-google-maps';

function getSqDist(p1, p2) {
  const dx = p1.lat - p2.lat;
  const dy = p1.lng - p2.lng;
  return dx * dx + dy * dy;
}

/**
 * Splits a route path array into travelledPath (solid line) and ongoingPath (dashed line)
 * based on the driver's current position.
 */
export function splitPathAtLocation(path, driverLocation) {
  if (!path || path.length < 2) {
    return { travelledPath: [], ongoingPath: path || [] };
  }

  const normalizedPath = path.map(pt => ({
    lat: typeof pt.lat === 'function' ? pt.lat() : Number(pt.lat),
    lng: typeof pt.lng === 'function' ? pt.lng() : Number(pt.lng)
  })).filter(pt => !isNaN(pt.lat) && !isNaN(pt.lng));

  if (normalizedPath.length < 2) {
    return { travelledPath: [], ongoingPath: normalizedPath };
  }

  if (!driverLocation || typeof driverLocation.lat !== 'number' || typeof driverLocation.lng !== 'number') {
    return { travelledPath: [], ongoingPath: normalizedPath };
  }

  const dLat = Number(driverLocation.lat);
  const dLng = Number(driverLocation.lng);
  if (isNaN(dLat) || isNaN(dLng)) {
    return { travelledPath: [], ongoingPath: normalizedPath };
  }

  let minSqDist = Infinity;
  let bestIndex = 0;
  let closestPoint = null;

  for (let i = 0; i < normalizedPath.length - 1; i++) {
    const p1 = normalizedPath[i];
    const p2 = normalizedPath[i + 1];

    const dx = p2.lat - p1.lat;
    const dy = p2.lng - p1.lng;
    const lenSq = dx * dx + dy * dy;

    let t = 0;
    if (lenSq > 0) {
      t = ((dLat - p1.lat) * dx + (dLng - p1.lng) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
    }

    const proj = { lat: p1.lat + t * dx, lng: p1.lng + t * dy };
    const sqDist = getSqDist({ lat: dLat, lng: dLng }, proj);

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

  const travelledPath = [
    ...normalizedPath.slice(0, bestIndex + 1),
    closestPoint
  ];

  const ongoingPath = [
    closestPoint,
    ...normalizedPath.slice(bestIndex + 1)
  ];

  return { travelledPath, ongoingPath };
}

function convertPathToSvgD(latLngArray, projection) {
  if (!latLngArray || !projection || latLngArray.length < 2) return '';
  const points = latLngArray.map(pt => {
    const latLngObj = (typeof pt.lat === 'function') ? pt : new window.google.maps.LatLng(pt.lat, pt.lng);
    const pix = projection.fromLatLngToDivPixel(latLngObj);
    return pix ? `${pix.x.toFixed(1)},${pix.y.toFixed(1)}` : null;
  }).filter(Boolean);

  if (points.length < 2) return '';
  return `M ${points[0]} L ` + points.slice(1).join(' L ');
}

function PortalToDiv({ targetDiv, children }) {
  if (!targetDiv) return null;
  return ReactDOM.createPortal(children, targetDiv);
}

// Native Google Maps Polylines for guaranteed 100% mobile compatibility
function NativeRoutePolylines({ map, travelledPath, ongoingPath, routeColor }) {
  const travelledPolylineRef = useRef(null);
  const travelledShadowRef = useRef(null);
  const ongoingPolylineRef = useRef(null);
  const ongoingShadowRef = useRef(null);

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    // 1. Travelled Shadow
    travelledShadowRef.current = new window.google.maps.Polyline({
      map,
      strokeColor: '#0f172a',
      strokeOpacity: 0.5,
      strokeWeight: 10,
      zIndex: 2,
      clickable: false
    });

    // 2. Travelled Solid Polyline
    travelledPolylineRef.current = new window.google.maps.Polyline({
      map,
      strokeColor: routeColor || '#3b82f6',
      strokeOpacity: 0.95,
      strokeWeight: 6,
      zIndex: 3,
      clickable: false
    });

    // Dash symbol for ongoing route
    const dashSymbol = {
      path: 'M 0,-1 L 0,1',
      strokeOpacity: 1,
      strokeColor: routeColor || '#3b82f6',
      scale: 4
    };

    // 3. Ongoing Dashed Polyline
    ongoingPolylineRef.current = new window.google.maps.Polyline({
      map,
      strokeColor: routeColor || '#3b82f6',
      strokeOpacity: 0,
      icons: [{
        icon: dashSymbol,
        offset: '0',
        repeat: '18px'
      }],
      strokeWeight: 5,
      zIndex: 3,
      clickable: false
    });

    // Shadow dash symbol
    const shadowDashSymbol = {
      path: 'M 0,-1 L 0,1',
      strokeOpacity: 0.4,
      strokeColor: '#0f172a',
      scale: 6
    };

    // 4. Ongoing Shadow Polyline
    ongoingShadowRef.current = new window.google.maps.Polyline({
      map,
      strokeColor: '#0f172a',
      strokeOpacity: 0,
      icons: [{
        icon: shadowDashSymbol,
        offset: '0',
        repeat: '18px'
      }],
      strokeWeight: 8,
      zIndex: 2,
      clickable: false
    });

    return () => {
      if (travelledShadowRef.current) travelledShadowRef.current.setMap(null);
      if (travelledPolylineRef.current) travelledPolylineRef.current.setMap(null);
      if (ongoingShadowRef.current) ongoingShadowRef.current.setMap(null);
      if (ongoingPolylineRef.current) ongoingPolylineRef.current.setMap(null);
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;

    // Travelled Path -> Solid Line
    if (travelledPath && travelledPath.length >= 2) {
      travelledShadowRef.current?.setPath(travelledPath);
      travelledShadowRef.current?.setVisible(true);

      travelledPolylineRef.current?.setPath(travelledPath);
      travelledPolylineRef.current?.setOptions({ strokeColor: routeColor || '#3b82f6' });
      travelledPolylineRef.current?.setVisible(true);
    } else {
      travelledShadowRef.current?.setVisible(false);
      travelledPolylineRef.current?.setVisible(false);
    }

    // Ongoing Path -> Dashed Line
    if (ongoingPath && ongoingPath.length >= 2) {
      const dashSymbol = {
        path: 'M 0,-1 L 0,1',
        strokeOpacity: 1,
        strokeColor: routeColor || '#3b82f6',
        scale: 4
      };
      const shadowDashSymbol = {
        path: 'M 0,-1 L 0,1',
        strokeOpacity: 0.4,
        strokeColor: '#0f172a',
        scale: 6
      };

      ongoingShadowRef.current?.setPath(ongoingPath);
      ongoingShadowRef.current?.setOptions({
        icons: [{ icon: shadowDashSymbol, offset: '0', repeat: '18px' }]
      });
      ongoingShadowRef.current?.setVisible(true);

      ongoingPolylineRef.current?.setPath(ongoingPath);
      ongoingPolylineRef.current?.setOptions({
        strokeColor: routeColor || '#3b82f6',
        icons: [{ icon: dashSymbol, offset: '0', repeat: '18px' }]
      });
      ongoingPolylineRef.current?.setVisible(true);
    } else {
      ongoingShadowRef.current?.setVisible(false);
      ongoingPolylineRef.current?.setVisible(false);
    }
  }, [map, travelledPath, ongoingPath, routeColor]);

  return null;
}

export default function RouteOutlineOverlay({ path, stepTraffics = [], routeColor = '#3b82f6', routeStyle = 'outlined', jobId = 'default', driverLocation = null }) {
  const map = useMap();
  const overlayRef = useRef(null);
  const containerRef = useRef(null);
  const [, setTick] = useState(0);

  // Split path into travelled (solid) and ongoing (dash)
  const { travelledPath, ongoingPath } = useMemo(() => {
    return splitPathAtLocation(path, driverLocation);
  }, [path, driverLocation]);

  useEffect(() => {
    if (!map || !window.google?.maps?.OverlayView) return;

    class CustomOverlayView extends window.google.maps.OverlayView {
      constructor() {
        super();
        this.div = document.createElement('div');
        this.div.style.position = 'absolute';
        this.div.style.left = '0px';
        this.div.style.top = '0px';
        this.div.style.pointerEvents = 'none';
        this.div.style.overflow = 'visible';
        this.div.style.zIndex = '5';
      }

      onAdd() {
        const panes = this.getPanes();
        if (panes && panes.overlayLayer) {
          panes.overlayLayer.appendChild(this.div);
        }
      }

      draw() {
        const mapDiv = this.getMap()?.getDiv();
        if (mapDiv) {
          this.div.style.width = mapDiv.clientWidth + 'px';
          this.div.style.height = mapDiv.clientHeight + 'px';
        } else {
          this.div.style.width = '100vw';
          this.div.style.height = '100vh';
        }
        setTick(t => t + 1);
      }

      onRemove() {
        if (this.div.parentNode) {
          this.div.parentNode.removeChild(this.div);
        }
      }

      getProjectionObj() {
        return this.getProjection();
      }
    }

    const overlay = new CustomOverlayView();
    overlay.setMap(map);
    overlayRef.current = overlay;
    containerRef.current = overlay.div;

    const listener = map.addListener('bounds_changed', () => {
      setTick(t => t + 1);
    });

    return () => {
      if (listener) window.google.maps.event.removeListener(listener);
      overlay.setMap(null);
      overlayRef.current = null;
      containerRef.current = null;
    };
  }, [map]);

  const projection = overlayRef.current?.getProjectionObj();

  const fullD = projection && path ? convertPathToSvgD(path, projection) : '';
  const travelledD = projection && travelledPath ? convertPathToSvgD(travelledPath, projection) : '';
  const ongoingD = projection && ongoingPath ? convertPathToSvgD(ongoingPath, projection) : '';

  const cleanJobId = (jobId || 'job').replace(/[^a-zA-Z0-9_-]/g, '_');
  const maskId = `route-hollow-mask-${cleanJobId}`;

  const stepSegments = (stepTraffics && stepTraffics.length > 0 && projection)
    ? stepTraffics.map((step, idx) => ({
        key: idx,
        d: convertPathToSvgD(step.path, projection),
        color: step.color || routeColor
      })).filter(s => s.d)
    : [];

  return (
    <>
      {/* 1. Native Google Maps Polylines: Travelled = Solid, Ongoing = Dash */}
      <NativeRoutePolylines
        map={map}
        travelledPath={travelledPath}
        ongoingPath={ongoingPath}
        routeColor={routeColor}
      />

      {/* 2. SVG Overlay for custom style effects (Outline, Alternating, Traffic) */}
      {containerRef.current && projection && fullD && (
        <PortalToDiv targetDiv={containerRef.current}>
          <svg
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              overflow: 'visible',
            }}
          >
            <defs>
              <style>{`
                @keyframes vectoRouteFadePulse {
                  0%, 100% {
                    opacity: 0.95;
                    stroke-opacity: 0.95;
                  }
                  50% {
                    opacity: 0.05;
                    stroke-opacity: 0.05;
                  }
                }
                @keyframes vectoRouteDashFlow {
                  0% {
                    stroke-dashoffset: 0;
                  }
                  100% {
                    stroke-dashoffset: -104;
                  }
                }
                .vecto-alternating-fade {
                  animation: vectoRouteFadePulse 3s ease-in-out infinite, vectoRouteDashFlow 5s linear infinite;
                }
              `}</style>
              <mask id={maskId}>
                <rect x="-20000" y="-20000" width="50000" height="50000" fill="white" />
                <path
                  d={fullD}
                  stroke="black"
                  strokeWidth="7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </mask>
            </defs>

            {/* Alternating Mode */}
            {routeStyle === 'alternating' && (
              <>
                {travelledD && (
                  <path
                    d={travelledD}
                    stroke={routeColor}
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                    strokeOpacity="0.95"
                  />
                )}
                {ongoingD && (
                  <path
                    d={ongoingD}
                    stroke={routeColor}
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                    strokeDasharray="24 16"
                    className="vecto-alternating-fade"
                  />
                )}
              </>
            )}

            {/* Outlined Mode */}
            {routeStyle === 'outlined' && (
              <>
                <path
                  d={fullD}
                  stroke="#000000"
                  strokeWidth="16"
                  strokeOpacity="0.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                  mask={`url(#${maskId})`}
                />
                <path
                  d={fullD}
                  stroke={routeColor}
                  strokeWidth="13"
                  strokeOpacity="0.95"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                  mask={`url(#${maskId})`}
                />
              </>
            )}

            {/* Traffic Mode */}
            {routeStyle === 'traffic' && (
              <>
                <path
                  d={fullD}
                  stroke="#000000"
                  strokeWidth="16"
                  strokeOpacity="0.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                  mask={`url(#${maskId})`}
                />
                {stepSegments.length > 0 ? (
                  stepSegments.map(step => (
                    <path
                      key={step.key}
                      d={step.d}
                      stroke={step.color}
                      strokeWidth="13"
                      strokeOpacity="0.95"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                      mask={`url(#${maskId})`}
                    />
                  ))
                ) : (
                  <path
                    d={fullD}
                    stroke={routeColor}
                    strokeWidth="13"
                    strokeOpacity="0.95"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                    mask={`url(#${maskId})`}
                  />
                )}
              </>
            )}
          </svg>
        </PortalToDiv>
      )}
    </>
  );
}
