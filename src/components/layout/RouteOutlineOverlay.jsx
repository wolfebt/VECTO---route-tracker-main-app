import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useMap } from '@vis.gl/react-google-maps';

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

export default function RouteOutlineOverlay({ path, stepTraffics = [], routeColor = '#3b82f6', routeStyle = 'outlined', jobId = 'default' }) {
  const map = useMap();
  const overlayRef = useRef(null);
  const containerRef = useRef(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!map || !window.google?.maps?.OverlayView) return;

    class CustomOverlayView extends window.google.maps.OverlayView {
      constructor() {
        super();
        this.div = document.createElement('div');
        this.div.style.position = 'absolute';
        this.div.style.left = '0px';
        this.div.style.top = '0px';
        this.div.style.width = '100%';
        this.div.style.height = '100%';
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

  if (!map || !overlayRef.current || !path || path.length < 2) {
    return null;
  }

  const projection = overlayRef.current.getProjectionObj();
  if (!projection) return null;

  const fullD = convertPathToSvgD(path, projection);
  if (!fullD) return null;

  const cleanJobId = (jobId || 'job').replace(/[^a-zA-Z0-9_-]/g, '_');
  const maskId = `route-hollow-mask-${cleanJobId}`;

  // Process step segment SVG paths for traffic mode
  const stepSegments = (stepTraffics && stepTraffics.length > 0)
    ? stepTraffics.map((step, idx) => ({
        key: idx,
        d: convertPathToSvgD(step.path, projection),
        color: step.color || routeColor
      })).filter(s => s.d)
    : [];

  return (
    <div style={{ display: 'none' }}>
      {containerRef.current && (
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
              {/* CSS Animation keyframes for alternating color-to-transparent fade & flowing road dashes */}
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
              {/* Hollow mask: white keeps area, black erases center (transparent core showing map road) */}
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

            {/* Alternating Fade Mode: Smooth pulse from chosen color to transparent road & back, with alternating color & road gaps */}
            {routeStyle === 'alternating' && (
              <>
                {/* Contrast shadow backdrop */}
                <path
                  d={fullD}
                  stroke="#0f172a"
                  strokeWidth="14"
                  strokeOpacity="0.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                  strokeDasharray="32 20"
                  className="vecto-alternating-fade"
                />
                {stepSegments.length > 0 ? (
                  stepSegments.map(step => (
                    <path
                      key={step.key}
                      d={step.d}
                      stroke={step.color}
                      strokeWidth="10"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                      strokeDasharray="32 20"
                      className="vecto-alternating-fade"
                    />
                  ))
                ) : (
                  <path
                    d={fullD}
                    stroke={routeColor}
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                    strokeDasharray="32 20"
                    className="vecto-alternating-fade"
                  />
                )}
              </>
            )}

            {/* Outlined Mode: Chosen route color edge borders with transparent center */}
            {routeStyle === 'outlined' && (
              <>
                {/* Subtle outer contrast glow */}
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
                {/* Route Color Highlight Outline */}
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

            {/* Traffic Mode: Green, Orange, Red Road Condition Edge Outlines */}
            {routeStyle === 'traffic' && (
              <>
                {/* Contrast shadow behind traffic borders */}
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

            {/* Solid Mode: Classic solid polyline */}
            {routeStyle === 'solid' && (
              <>
                <path
                  d={fullD}
                  stroke="#0f172a"
                  strokeWidth="10"
                  strokeOpacity="0.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
                <path
                  d={fullD}
                  stroke={routeColor}
                  strokeWidth="6"
                  strokeOpacity="0.95"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </>
            )}
          </svg>
        </PortalToDiv>
      )}
    </div>
  );
}
