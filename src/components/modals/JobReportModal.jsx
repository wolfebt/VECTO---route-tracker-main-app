import React, { useEffect, useState, useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useJobs, useActiveDrivers, useCompany } from '../../hooks/useFirebase';
import { db } from '../../firebase';
import { collection, query, getDocs } from 'firebase/firestore';
import { normalizeJobStops, computePathMiles, evaluateStopSla } from '../../utils/stops';
import { toMillisSafe } from '../../utils/formatters';
import { Printer, ExternalLink } from 'lucide-react';

const isPdfReceipt = (exp) => /\.pdf(\?|$)/i.test(exp?.receiptUrl || '');

function toPlainLatLng(pt) {
  if (!pt) return null;
  const lat = typeof pt.lat === 'function' ? pt.lat() : Number(pt.lat);
  const lng = typeof pt.lng === 'function' ? pt.lng() : Number(pt.lng);
  if (isNaN(lat) || isNaN(lng)) return null;
  return { lat, lng };
}

function TelemetrySvgMap({ plannedPath = [], breadcrumbPoints = [], stops = [] }) {
  const geometry = useMemo(() => {
    const cleanPlanned = plannedPath.map(toPlainLatLng).filter(Boolean);
    const cleanActual = breadcrumbPoints.map(toPlainLatLng).filter(Boolean);
    const stopPts = stops
      .filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number')
      .map((s, idx) => ({ lat: s.lat, lng: s.lng, label: `${idx + 1}`, status: s.status }));

    const allPts = [...cleanPlanned, ...cleanActual, ...stopPts];
    if (allPts.length < 2) return null;

    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;

    allPts.forEach((p) => {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    });

    const midLatRad = (((minLat + maxLat) / 2) * Math.PI) / 180;
    const cosLat = Math.max(0.2, Math.cos(midLatRad));
    const widthDeg = Math.max(0.002, (maxLng - minLng) * cosLat);
    const heightDeg = Math.max(0.002, maxLat - minLat);

    const svgW = 640;
    const svgH = 240;
    const pad = 24;
    const usableW = svgW - pad * 2;
    const usableH = svgH - pad * 2;
    const scale = Math.min(usableW / widthDeg, usableH / heightDeg);

    const offsetX = (svgW - widthDeg * scale) / 2;
    const offsetY = (svgH - heightDeg * scale) / 2;

    const project = (pt) => {
      const x = offsetX + (pt.lng - minLng) * cosLat * scale;
      const y = offsetY + (maxLat - pt.lat) * scale;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    };

    const projectObj = (pt) => {
      const x = offsetX + (pt.lng - minLng) * cosLat * scale;
      const y = offsetY + (maxLat - pt.lat) * scale;
      return { x, y };
    };

    return {
      plannedSvg: cleanPlanned.map(project).join(' '),
      actualSvg: cleanActual.map(project).join(' '),
      originPt: cleanPlanned[0] ? projectObj(cleanPlanned[0]) : (cleanActual[0] ? projectObj(cleanActual[0]) : null),
      destPt: cleanPlanned.length > 1
        ? projectObj(cleanPlanned[cleanPlanned.length - 1])
        : (cleanActual.length > 1 ? projectObj(cleanActual[cleanActual.length - 1]) : null),
      projectedStops: stopPts.map((s) => ({ ...s, ...projectObj(s) })),
    };
  }, [plannedPath, breadcrumbPoints, stops]);

  if (!geometry) return null;

  return (
    <div className="mb-4 bg-gray-50 border border-gray-200 rounded-lg p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-xs">
        <span className="font-bold text-gray-800 uppercase tracking-wider">Planned vs. Actual Route Comparison</span>
        <div className="flex items-center gap-4 text-[11px] text-gray-700">
          {geometry.plannedSvg && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-5 border-t-2 border-dashed border-indigo-600" />
              Planned Route
            </span>
          )}
          {geometry.actualSvg && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-5 border-t-2 border-emerald-600" />
              Actual Driven GPS
            </span>
          )}
        </div>
      </div>

      <svg viewBox="0 0 640 240" className="w-full h-48 bg-white rounded border border-gray-200">
        {geometry.plannedSvg && (
          <polyline
            fill="none"
            stroke="#4f46e5"
            strokeWidth="3"
            strokeDasharray="6 4"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={geometry.plannedSvg}
          />
        )}
        {geometry.actualSvg && (
          <polyline
            fill="none"
            stroke="#059669"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={geometry.actualSvg}
          />
        )}
        {geometry.originPt && (
          <g>
            <circle cx={geometry.originPt.x} cy={geometry.originPt.y} r="6" fill="#0ea5e9" stroke="#ffffff" strokeWidth="2" />
            <title>Origin</title>
          </g>
        )}
        {geometry.projectedStops.map((s) => (
          <g key={s.label}>
            <circle
              cx={s.x}
              cy={s.y}
              r="7"
              fill={s.status === 'completed' ? '#10b981' : '#f59e0b'}
              stroke="#ffffff"
              strokeWidth="1.5"
            />
            <text x={s.x} y={s.y + 3} textAnchor="middle" fontSize="9" fontWeight="bold" fill="#ffffff">
              {s.label}
            </text>
          </g>
        ))}
        {geometry.destPt && geometry.projectedStops.length === 0 && (
          <circle cx={geometry.destPt.x} cy={geometry.destPt.y} r="6" fill="#ef4444" stroke="#ffffff" strokeWidth="2" />
        )}
      </svg>
    </div>
  );
}

export default function JobReportModal() {
  const { modals, closeModal, companyId, routeInfo } = useAppStore();
  const jobs = useJobs();
  const activeDrivers = useActiveDrivers();
  const { members } = useCompany();
  
  const [messages, setMessages] = useState([]);
  const [driverNotes, setDriverNotes] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [breadcrumbPoints, setBreadcrumbPoints] = useState([]);
  const [localRouteInfo, setLocalRouteInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  const modalData = modals.jobReport;
  const jobId = typeof modalData === 'object' ? modalData.jobId : null;
  const job = jobs.find(j => j.id === jobId);

  useEffect(() => {
    if (!jobId || !companyId || !modals.jobReport) return;

    const fetchData = async () => {
        setLoading(true);
        try {
            // Fetch Chat
            const chatQ = query(collection(db, `companies/${companyId}/jobs/${jobId}/chat`));
            const chatSnap = await getDocs(chatQ);
            const msgs = [];
            chatSnap.forEach(d => msgs.push({ id: d.id, ...d.data() }));
            msgs.sort((a,b) => toMillisSafe(a.timestamp) - toMillisSafe(b.timestamp));
            setMessages(msgs);

            // Fetch Notes
            const notesQ = query(collection(db, `companies/${companyId}/jobs/${jobId}/notes`));
            const notesSnap = await getDocs(notesQ);
            const nts = [];
            notesSnap.forEach(d => nts.push({ id: d.id, ...d.data() }));
            nts.sort((a,b) => toMillisSafe(b.timestamp) - toMillisSafe(a.timestamp));
            setDriverNotes(nts);

            // Fetch Expenses
            const expQ = query(collection(db, `companies/${companyId}/jobs/${jobId}/expenses`));
            const expSnap = await getDocs(expQ);
            const exps = [];
            expSnap.forEach(d => exps.push({ id: d.id, ...d.data() }));
            exps.sort((a,b) => toMillisSafe(a.timestamp) - toMillisSafe(b.timestamp));
            setExpenses(exps);

            // Fetch Breadcrumbs
            const bcQ = query(collection(db, `companies/${companyId}/jobs/${jobId}/breadcrumbs`));
            const bcSnap = await getDocs(bcQ);
            const pts = [];
            bcSnap.forEach((d) => {
              const chunk = d.data();
              if (Array.isArray(chunk.points)) {
                chunk.points.forEach((p) => {
                  if (typeof p?.lat === 'number' && typeof p?.lng === 'number') {
                    pts.push({ lat: p.lat, lng: p.lng, ts: Number(p.ts) || 0 });
                  }
                });
              }
            });
            pts.sort((a, b) => a.ts - b.ts);
            setBreadcrumbPoints(pts);
        } catch (error) {
            console.error("Error fetching report data", error);
        }
        setLoading(false);
    };
    fetchData();
  }, [jobId, companyId, modals.jobReport]);

  useEffect(() => {
    if (!modals.jobReport || !job) {
      setLocalRouteInfo(null);
      return;
    }
    if (routeInfo?.jobId === job.id) {
      setLocalRouteInfo(null);
      return;
    }

    const dests = job.destinations || (job.destination ? [job.destination] : []);
    if (!job.origin || dests.length === 0 || !window.google?.maps?.DirectionsService) {
      setLocalRouteInfo(null);
      return;
    }

    let cancelled = false;
    const ds = new window.google.maps.DirectionsService();
    const waypoints = dests.length > 1 ? dests.slice(0, -1).map(loc => ({ location: loc, stopover: true })) : [];
    const finalDest = dests[dests.length - 1];

    ds.route({
      origin: job.origin,
      destination: finalDest,
      waypoints,
      optimizeWaypoints: waypoints.length > 0 ? job.optimizeRoute !== false : false,
      travelMode: 'DRIVING',
    }).then((response) => {
      if (cancelled || !response.routes?.length) return;
      const route = response.routes[0];
      let totalSeconds = 0;
      let totalMeters = 0;
      route.legs.forEach((leg) => {
        totalSeconds += leg.duration?.value || 0;
        totalMeters += leg.distance?.value || 0;
      });
      const totalMiles = (totalMeters * 0.000621371).toFixed(1);
      const h = Math.floor(totalSeconds / 3600);
      const m = Math.floor((totalSeconds % 3600) / 60);
      const steps = route.legs
        .flatMap((leg) => leg.steps || [])
        .map((step) => (step.instructions ? step.instructions.replace(/<[^>]*>?/gm, '') : ''))
        .filter(Boolean);

      setLocalRouteInfo({
        jobId: job.id,
        distance: `${totalMiles} mi`,
        duration: h > 0 ? `${h}h ${m}m` : `${m}m`,
        overviewPath: route.overview_path || [],
        steps,
      });
    }).catch(() => {
      if (!cancelled) setLocalRouteInfo(null);
    });

    return () => {
      cancelled = true;
    };
  }, [modals.jobReport, job, routeInfo?.jobId]);

  if (!modals.jobReport || !job) return null;

  const handleClose = () => closeModal('jobReport');
  const matchingRoute = routeInfo?.jobId === job.id ? routeInfo : localRouteInfo;
  const stops = normalizeJobStops(job);
  const completedStopsCount = stops.filter(s => s.status === 'completed').length;
  const actualDrivenMiles = computePathMiles(breadcrumbPoints);

  const groupedNotes = driverNotes.reduce((acc, note) => {
      const name = note.driverName || note.driverId || 'Unknown';
      if (!acc[name]) acc[name] = [];
      acc[name].push(note);
      return acc;
  }, {});

  const groupedExpenses = expenses.reduce((acc, exp) => {
      const name = exp.driverName || exp.driverId || 'Unknown';
      if (!acc[name]) acc[name] = [];
      acc[name].push(exp);
      return acc;
  }, {});

  const instructions = job.instructions?.length
    ? job.instructions
    : (job.note ? [{ id: 'legacy', text: job.note, target: 'all', isPriority: false }] : []);

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div 
        className="bg-white text-black rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl relative"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-300 flex justify-between items-center shrink-0 bg-gray-100 rounded-t-lg print:hidden">
          <h2 className="text-xl font-bold text-gray-800">Job Report Preview</h2>
          <div className="flex space-x-2">
              <button onClick={() => window.print()} className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded font-semibold transition-colors">
                  <Printer size={18} />
                  <span>Print Report</span>
              </button>
              <button onClick={handleClose} aria-label="Close" className="text-gray-500 hover:text-gray-800 p-2 rounded focus-visible:ring-2 focus-visible:ring-blue-500 font-bold">&times;</button>
          </div>
        </div>
        
        <div className="p-8 overflow-y-auto flex-1 print:p-0 print:overflow-visible">
            
            <div className="text-center border-b-2 border-gray-800 pb-4 mb-6">
                <h1 className="text-4xl font-extrabold uppercase tracking-wider text-gray-900 mb-1">VECTO</h1>
                <p className="text-xs text-gray-500 font-medium mb-3">Author: Wolfe.BT@TangentLLC.net</p>
                <h2 className="text-2xl font-bold uppercase tracking-wide text-gray-800">{job.jobName || 'Unnamed Job'}</h2>
                <p className="text-gray-500 font-medium text-sm">Job Report - {job.jobDate || new Date().toLocaleDateString()}</p>
            </div>

            {/* Section 1: General Info */}
            <section className="mb-8">
                <h2 className="text-xl font-bold bg-gray-200 p-2 border-l-4 border-gray-800 mb-4">1. Job Details & Dispatch Instructions</h2>
                <div className="grid grid-cols-2 gap-4 mb-6">
                    <div>
                        <p><strong>Status:</strong> {job.status}</p>
                        <p><strong>Assigned Vehicle:</strong> {job.vehicleLabel || 'Unassigned'}</p>
                        <p><strong>Origin:</strong> {job.origin}</p>
                        <p><strong>Destination(s):</strong> {stops.map((s) => `${s.address}${s.arriveBy ? ` [SLA ${s.arriveBy}]` : ''}${s.status === 'completed' ? ' (Done)' : ''}`).join(' -> ')}</p>
                    </div>
                    <div>
                        <p><strong>Contact Name:</strong> {job.contactName || 'N/A'}</p>
                        <p><strong>Contact Number:</strong> {job.contactNumber || 'N/A'}</p>
                        <p>
                            <strong>Team Assigned:</strong>{' '}
                            {job.assignedDrivers?.map(d => d.name).join(', ') || 'None'}
                        </p>
                    </div>
                </div>

                {instructions.length > 0 && (
                    <div className="bg-gray-50 p-4 rounded border border-gray-200">
                        <h3 className="font-bold mb-2">Instructions:</h3>
                        <ul className="space-y-2">
                            {instructions.map((inst, idx) => {
                                const targetMember = inst.target && inst.target !== 'all'
                                  ? members.find(m => m.id === inst.target) || activeDrivers.find(d => d.id === inst.target)
                                  : null;
                                return (
                                  <li key={inst.id || idx} className="flex items-start">
                                      <span className="mr-2 mt-1">-</span>
                                      <div>
                                          {inst.isPriority && <span className="bg-red-100 text-red-800 text-xs font-bold px-2 py-0.5 rounded uppercase mr-2 border border-red-200">Priority</span>}
                                          {inst.target && inst.target !== 'all' && (
                                              <span className="bg-blue-100 text-blue-800 text-xs font-bold px-2 py-0.5 rounded uppercase mr-2 border border-blue-200">
                                                  For: {targetMember?.name || targetMember?.email || inst.target}
                                              </span>
                                          )}
                                          <span className="text-gray-800 font-medium">{inst.text}</span>
                                      </div>
                                  </li>
                                );
                            })}
                        </ul>
                    </div>
                )}
            </section>

            {/* Section 2: Driver Details & Notes */}
            <section className="mb-8">
                <h2 className="text-xl font-bold bg-gray-200 p-2 border-l-4 border-gray-800 mb-4">2. Team Member Updates & Logs</h2>
                {loading ? (
                    <p className="text-gray-500 italic">Loading notes...</p>
                ) : driverNotes.length === 0 ? (
                    <p className="text-gray-500 italic">No progress notes logged by the team.</p>
                ) : (
                    <div className="space-y-6">
                        {Object.entries(groupedNotes).map(([driverName, notes]) => (
                            <div key={driverName}>
                                <h3 className="font-bold text-lg mb-2 text-blue-900 border-b border-gray-300 pb-1">{driverName}</h3>
                                <ul className="space-y-3">
                                    {notes.map(note => (
                                        <li key={note.id} className="bg-gray-50 p-3 rounded border border-gray-200 flex flex-col">
                                            <span className="text-xs text-gray-500 font-medium mb-1">
                                                {toMillisSafe(note.timestamp) ? new Date(toMillisSafe(note.timestamp)).toLocaleString() : 'Unknown time'}
                                            </span>
                                            <span className="text-gray-800">{note.text}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* Section 3: Driver Expenses */}
            <section className="mb-8">
                <h2 className="text-xl font-bold bg-gray-200 p-2 border-l-4 border-gray-800 mb-4">3. Driver Expenses</h2>
                {loading ? (
                    <p className="text-gray-500 italic">Loading expenses...</p>
                ) : expenses.length === 0 ? (
                    <p className="text-gray-500 italic">No expenses logged for this job.</p>
                ) : (
                    <div className="space-y-6">
                        {Object.entries(groupedExpenses).map(([driverName, drvExpenses]) => {
                            const totalAmount = drvExpenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
                            return (
                                <div key={driverName}>
                                    <h3 className="font-bold text-lg mb-2 text-orange-900 border-b border-gray-300 pb-1 flex justify-between">
                                        <span>{driverName}</span>
                                        <span>Total: ${totalAmount.toFixed(2)}</span>
                                    </h3>
                                    <ul className="space-y-2">
                                        {drvExpenses.map(exp => {
                                            const isPdf = isPdfReceipt(exp);
                                            return (
                                              <li key={exp.id} className="bg-gray-50 p-2.5 rounded border border-gray-200 flex justify-between items-center text-sm">
                                                  <div className="flex items-center space-x-2.5">
                                                      {exp.receiptUrl && (
                                                        isPdf ? (
                                                          <button
                                                            type="button"
                                                            onClick={() => window.open(exp.receiptUrl, '_blank')}
                                                            className="w-10 h-10 rounded bg-red-100 text-red-700 border border-red-300 font-bold text-[10px] flex flex-col items-center justify-center shrink-0 hover:bg-red-200 cursor-pointer"
                                                            title="Open PDF receipt"
                                                          >
                                                            <span>PDF</span>
                                                            <ExternalLink size={10} />
                                                          </button>
                                                        ) : (
                                                          <img 
                                                            src={exp.receiptUrl} 
                                                            alt="Receipt" 
                                                            onClick={() => window.open(exp.receiptUrl, '_blank')}
                                                            className="w-10 h-10 rounded object-cover border border-gray-300 hover:opacity-80 cursor-pointer shrink-0" 
                                                            title="Click to view full receipt"
                                                          />
                                                        )
                                                      )}
                                                      <div>
                                                        <div className="flex items-center space-x-1.5">
                                                          <span className="font-bold uppercase text-[10px] text-gray-700 bg-gray-200 px-1.5 py-0.5 rounded">{exp.type}</span>
                                                          {exp.merchant && (
                                                            <span className="text-xs font-semibold text-gray-900">{exp.merchant}</span>
                                                          )}
                                                          {exp.status && (
                                                            <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded uppercase ${
                                                              exp.status === 'approved' || exp.status === 'reimbursed' ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' :
                                                              exp.status === 'rejected' ? 'bg-red-100 text-red-800 border border-red-300' : 'bg-amber-100 text-amber-800 border border-amber-300'
                                                            }`}>
                                                              {exp.status}
                                                            </span>
                                                          )}
                                                        </div>
                                                        <span className="text-gray-800 text-xs mt-0.5 block">{exp.description || 'No description'}</span>
                                                      </div>
                                                  </div>
                                                  <span className="font-bold text-gray-900 font-mono">${parseFloat(exp.amount || 0).toFixed(2)}</span>
                                              </li>
                                            );
                                        })}
                                    </ul>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            {/* Section 4: Route Details & Telemetry */}
            <section className="mb-8" style={{ pageBreakInside: 'avoid' }}>
                <h2 className="text-xl font-bold bg-gray-200 p-2 border-l-4 border-gray-800 mb-4">4. Route Details & Telemetry</h2>
                <div className="flex flex-wrap gap-x-8 gap-y-2 mb-4 text-sm">
                    {matchingRoute && (
                      <>
                        <p><strong>Planned Distance:</strong> {matchingRoute.distance}</p>
                        <p><strong>Est. Duration:</strong> {matchingRoute.duration}</p>
                      </>
                    )}
                    <p><strong>Stops Completed:</strong> {completedStopsCount} / {stops.length}</p>
                    {breadcrumbPoints.length > 1 && (
                      <p className="text-emerald-800">
                        <strong>Actual GPS Distance:</strong> {actualDrivenMiles.toFixed(1)} mi ({breadcrumbPoints.length} points)
                      </p>
                    )}
                </div>

                <TelemetrySvgMap
                  plannedPath={matchingRoute?.overviewPath || []}
                  breadcrumbPoints={breadcrumbPoints}
                  stops={stops}
                />

                {stops.length > 0 && (
                  <div className="mb-4 overflow-x-auto">
                    <h3 className="font-bold mb-2 text-sm">Stops &amp; SLA Performance:</h3>
                    <table className="w-full text-xs border-collapse border border-gray-300">
                      <thead>
                        <tr className="bg-gray-100 text-left">
                          <th className="p-1.5 border border-gray-300">#</th>
                          <th className="p-1.5 border border-gray-300">Address</th>
                          <th className="p-1.5 border border-gray-300">Arrive By</th>
                          <th className="p-1.5 border border-gray-300">Dwell</th>
                          <th className="p-1.5 border border-gray-300">Arrived</th>
                          <th className="p-1.5 border border-gray-300">Completed</th>
                          <th className="p-1.5 border border-gray-300">SLA Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stops.map((s, idx) => {
                          const sla = evaluateStopSla(s, job.jobDate || '');
                          const arrivedStr = s.arrivedAt ? new Date(s.arrivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
                          const doneStr = s.completedAt ? new Date(s.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
                          return (
                            <tr key={s.id || idx}>
                              <td className="p-1.5 border border-gray-300 font-semibold">{idx + 1}</td>
                              <td className="p-1.5 border border-gray-300">{s.address}</td>
                              <td className="p-1.5 border border-gray-300 font-mono">{s.arriveBy || '—'}</td>
                              <td className="p-1.5 border border-gray-300 font-mono">{typeof s.serviceMinutes === 'number' && s.serviceMinutes > 0 ? `${s.serviceMinutes}m` : '—'}</td>
                              <td className="p-1.5 border border-gray-300 font-mono">{arrivedStr}</td>
                              <td className="p-1.5 border border-gray-300 font-mono">{doneStr}</td>
                              <td className="p-1.5 border border-gray-300 font-semibold">
                                {sla.status === 'none' ? (s.status || 'pending') : sla.label}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {matchingRoute ? (
                    matchingRoute.steps && matchingRoute.steps.length > 0 && (
                      <div>
                          <h3 className="font-bold mb-2">Directions Summary:</h3>
                          <ul className="list-decimal pl-5 space-y-1 text-sm text-gray-700">
                              {matchingRoute.steps.map((step, idx) => (
                                  <li key={idx}>{step}</li>
                              ))}
                          </ul>
                      </div>
                    )
                ) : (
                    <p className="text-gray-500 italic">Planned directions unavailable for this job.</p>
                )}
            </section>

            {/* Section 5: Messages */}
            <section style={{ pageBreakInside: 'auto' }}>
                <h2 className="text-xl font-bold bg-gray-200 p-2 border-l-4 border-gray-800 mb-4">5. Job Chat History</h2>
                {loading ? (
                    <p className="text-gray-500 italic">Loading messages...</p>
                ) : messages.length === 0 ? (
                    <p className="text-gray-500 italic">No chat messages for this job.</p>
                ) : (
                    <div className="space-y-3">
                        {messages.map(msg => (
                            <div key={msg.id} className="flex flex-col border-b border-gray-100 pb-2">
                                <div className="flex justify-between items-baseline mb-1">
                                    <span className="font-bold text-gray-900">{msg.senderName}</span>
                                    <span className="text-xs text-gray-500">{toMillisSafe(msg.timestamp) ? new Date(toMillisSafe(msg.timestamp)).toLocaleString() : ''}</span>
                                </div>
                                {msg.text && <p className="text-gray-800 text-sm">{msg.text}</p>}
                                {msg.attachmentUrl && <span className="text-blue-600 text-xs italic mt-1">[Attachment Included]</span>}
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* Section 6: Proof of Delivery (POD) Verification */}
            <section className="mt-8" style={{ pageBreakInside: 'avoid' }}>
                <h2 className="text-xl font-bold bg-gray-200 p-2 border-l-4 border-gray-800 mb-4">6. Proof of Delivery (POD) Verification</h2>
                {stops.some((s) => Boolean(s.pod)) ? (
                  <div className="space-y-4">
                    {stops.map((s, idx) => {
                      if (!s.pod) return null;
                      return (
                        <div key={s.id || idx} className="bg-gray-50 p-4 rounded border border-gray-200 space-y-2 text-sm">
                          <div className="flex flex-wrap justify-between items-center gap-2 border-b border-gray-200 pb-1.5">
                            <span className="font-bold text-gray-900">
                              Stop #{idx + 1}: {s.address}
                            </span>
                            <span className="text-xs text-emerald-800 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded font-bold uppercase">
                              Verified
                            </span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-700">
                            <p><strong>Recipient:</strong> {s.pod.recipientName || 'N/A'}</p>
                            <p><strong>Captured At:</strong> {s.pod.capturedAt ? new Date(s.pod.capturedAt).toLocaleString() : 'Recorded'}</p>
                            {s.pod.capturedByName && <p><strong>Driver:</strong> {s.pod.capturedByName}</p>}
                            {typeof s.pod.capturedLat === 'number' && typeof s.pod.capturedLng === 'number' && (
                              <p>
                                <strong>GPS Tag:</strong>{' '}
                                <span className="font-mono text-emerald-700 font-semibold">
                                  {s.pod.capturedLat.toFixed(5)}, {s.pod.capturedLng.toFixed(5)}
                                </span>
                              </p>
                            )}
                            {s.pod.notes && <p><strong>Notes:</strong> {s.pod.notes}</p>}
                          </div>
                          <div className="flex flex-wrap gap-4 pt-1">
                            {s.pod.photoUrl && (
                              <div>
                                <p className="text-[11px] font-bold text-gray-600 mb-1">Delivery Photo</p>
                                <img
                                  src={s.pod.photoUrl}
                                  alt={`POD Stop ${idx + 1}`}
                                  className="h-24 rounded border border-gray-300 object-cover cursor-pointer"
                                  onClick={() => window.open(s.pod.photoUrl, '_blank')}
                                />
                              </div>
                            )}
                            {s.pod.signatureUrl && (
                              <div>
                                <p className="text-[11px] font-bold text-gray-600 mb-1">Customer Signature</p>
                                <img
                                  src={s.pod.signatureUrl}
                                  alt={`Signature Stop ${idx + 1}`}
                                  className="h-24 bg-white rounded border border-gray-300 object-contain p-1 cursor-pointer"
                                  onClick={() => window.open(s.pod.signatureUrl, '_blank')}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-gray-500 italic">No Proof of Delivery records captured for this job.</p>
                )}
            </section>
        </div>
      </div>
      
      {/* Print Styles */}
      <style>{`
        @media print {
            body * {
                visibility: hidden;
            }
            .fixed.inset-0 {
                position: absolute;
                background: white;
            }
            .fixed > div, .fixed > div * {
                visibility: visible;
            }
            .fixed > div {
                position: absolute;
                left: 0;
                top: 0;
                width: 100%;
                box-shadow: none;
                max-width: 100%;
                margin: 0;
                padding: 0;
            }
            .print\\:hidden {
                display: none !important;
            }
            .print\\:p-0 {
                padding: 0 !important;
            }
            .print\\:overflow-visible {
                overflow: visible !important;
            }
        }
      `}</style>
    </div>
  );
}
