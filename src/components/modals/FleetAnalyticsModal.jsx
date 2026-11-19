import React, { useState, useEffect, useMemo } from 'react';
import { collection, collectionGroup, getDocs, query, where } from 'firebase/firestore';
import {
  Activity,
  BarChart3,
  Clock,
  DollarSign,
  Download,
  Navigation,
  ShieldAlert,
  X,
} from 'lucide-react';
import { db } from '../../firebase';
import { useArchivedJobs, useCompany, useInspections, useJobs, useVehicles } from '../../hooks/useFirebase';
import { useAppStore } from '../../store/useAppStore';
import { useToastStore } from '../../store/useToastStore';
import { sanitizeCsvCell, toMillisSafe } from '../../utils/formatters';
import { computePathMiles, evaluateJobSlaSummary, normalizeJobStops } from '../../utils/stops';
import { isVehicleServiceDue } from '../../utils/vehicles';

const CATEGORY_COLORS = {
  fuel: 'bg-amber-500',
  maintenance: 'bg-rose-500',
  toll: 'bg-sky-500',
  lodging: 'bg-purple-500',
  food: 'bg-emerald-500',
  custom: 'bg-slate-400',
};

export default function FleetAnalyticsModal() {
  const { modals, closeModal, companyId } = useAppStore();
  const addToast = useToastStore((s) => s.addToast);
  const jobs = useJobs();
  const { archivedJobsLoadedOnce, loadingArchivedJobs, loadArchivedPage } = useArchivedJobs();
  const vehicles = useVehicles();
  const inspections = useInspections();
  const { members } = useCompany();

  useEffect(() => {
    if (modals.fleetAnalytics && !archivedJobsLoadedOnce && !loadingArchivedJobs) {
      loadArchivedPage({ reset: true });
    }
  }, [modals.fleetAnalytics, archivedJobsLoadedOnce, loadingArchivedJobs, loadArchivedPage]);

  const [period, setPeriod] = useState('30d'); // '7d' | '30d' | 'all'
  const [expenses, setExpenses] = useState([]);
  const [milesByJobId, setMilesByJobId] = useState({});
  const [loading, setLoading] = useState(false);

  const cutoffMs = useMemo(() => {
    if (period === '7d') return Date.now() - 7 * 24 * 60 * 60 * 1000;
    if (period === '30d') return Date.now() - 30 * 24 * 60 * 60 * 1000;
    return 0;
  }, [period]);

  const scopedJobs = useMemo(() => {
    return jobs.filter((j) => {
      if (j.status === 'cancelled') return false;
      if (!cutoffMs) return true;
      const tsMs = toMillisSafe(j.completedAt || j.startedAt || j.createdAt || j.updatedAt);
      return tsMs === 0 || tsMs >= cutoffMs;
    });
  }, [jobs, cutoffMs]);

  useEffect(() => {
    if (!modals.fleetAnalytics || !companyId) return;
    let isMounted = true;

    const loadTelemetryAndSpend = async () => {
      setLoading(true);
      try {
        const expMap = new Map();
        try {
          const cgSnap = await getDocs(
            query(collectionGroup(db, 'expenses'), where('companyId', '==', companyId))
          );
          cgSnap.forEach((d) => {
            const data = d.data();
            const jobId = data.jobId || d.ref.parent?.parent?.id || '';
            expMap.set(`${jobId}:${d.id}`, { id: d.id, jobId, ...data });
          });
        } catch {
          // fallback handled below
        }

        const currentJobs = useAppStore.getState().jobs || [];
        if ((expMap.size === 0 || currentJobs.length <= 25) && currentJobs.length > 0) {
          await Promise.all(
            currentJobs.map(async (job) => {
              try {
                const snap = await getDocs(collection(db, `companies/${companyId}/jobs/${job.id}/expenses`));
                snap.forEach((d) => {
                  const key = `${job.id}:${d.id}`;
                  if (!expMap.has(key)) {
                    expMap.set(key, { id: d.id, jobId: job.id, ...d.data() });
                  }
                });
              } catch {
                // skip inaccessible job expense subcollections
              }
            })
          );
        }

        const relevantJobs = currentJobs.slice(0, 60);
        const computedMiles = {};
        await Promise.all(
          relevantJobs.map(async (job) => {
            try {
              const bcSnap = await getDocs(
                collection(db, `companies/${companyId}/jobs/${job.id}/breadcrumbs`)
              );
              const pts = [];
              bcSnap.forEach((d) => {
                const data = d.data();
                if (Array.isArray(data.points)) {
                  data.points.forEach((p) => {
                    if (typeof p?.lat === 'number' && typeof p?.lng === 'number') {
                      pts.push({ lat: p.lat, lng: p.lng, ts: Number(p.ts) || 0 });
                    }
                  });
                }
              });
              if (pts.length >= 2) {
                pts.sort((a, b) => a.ts - b.ts);
                computedMiles[job.id] = computePathMiles(pts);
                return;
              }
            } catch {
              // ignore breadcrumb query errors
            }

            const stopPts = normalizeJobStops(job)
              .filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number')
              .map((s) => ({ lat: s.lat, lng: s.lng }));
            if (stopPts.length >= 2) {
              computedMiles[job.id] = computePathMiles(stopPts) * 1.25;
            }
          })
        );

        if (isMounted) {
          setExpenses(Array.from(expMap.values()));
          setMilesByJobId(computedMiles);
        }
      } catch (err) {
        console.warn('Analytics load error:', err);
      }
      if (isMounted) setLoading(false);
    };

    loadTelemetryAndSpend();
    return () => {
      isMounted = false;
    };
  }, [modals.fleetAnalytics, companyId]);

  const scopedExpenses = useMemo(() => {
    return expenses.filter((e) => {
      if (e.status === 'rejected') return false;
      if (!cutoffMs) return true;
      const tsMs = toMillisSafe(e.timestamp);
      return tsMs === 0 || tsMs >= cutoffMs;
    });
  }, [expenses, cutoffMs]);

  const metrics = useMemo(() => {
    const completedJobs = scopedJobs.filter((j) => j.status === 'completed');
    let totalDurationMs = 0;
    let durationCount = 0;
    let totalStopsDelivered = 0;
    let totalPodsCaptured = 0;
    let slaOnTime = 0;
    let slaLate = 0;
    let totalMiles = 0;

    scopedJobs.forEach((job) => {
      totalMiles += Number(milesByJobId[job.id] || 0);
      const stops = normalizeJobStops(job);
      stops.forEach((s) => {
        if (s.status === 'completed') totalStopsDelivered += 1;
        if (s.pod) totalPodsCaptured += 1;
      });
      const sla = evaluateJobSlaSummary(job);
      slaOnTime += sla.onTimeCount;
      slaLate += sla.lateCount;

      if (job.status === 'completed') {
        const startMs = toMillisSafe(job.startedAt || job.createdAt);
        const endMs = toMillisSafe(job.completedAt || job.updatedAt);
        if (startMs > 0 && endMs > startMs) {
          totalDurationMs += endMs - startMs;
          durationCount += 1;
        }
      }
    });

    const slaTotal = slaOnTime + slaLate;
    const onTimePct = slaTotal > 0 ? Math.round((slaOnTime / slaTotal) * 100) : null;
    const avgMinutes = durationCount > 0 ? Math.round(totalDurationMs / durationCount / 60000) : 0;

    let totalSpend = 0;
    const categoryTotals = { fuel: 0, maintenance: 0, toll: 0, lodging: 0, food: 0, custom: 0 };
    scopedExpenses.forEach((e) => {
      const amt = parseFloat(e.amount) || 0;
      totalSpend += amt;
      const cat = categoryTotals[e.type] !== undefined ? e.type : 'custom';
      categoryTotals[cat] += amt;
    });

    const costPerMile = totalMiles > 0 ? totalSpend / totalMiles : 0;
    const activeVehicles = vehicles.filter((v) => v.status === 'active').length;
    const maintenanceDue = vehicles.filter(isVehicleServiceDue).length;
    const openDefects = inspections.filter((i) => i.overallStatus !== 'safe' && !i.mechanicResolved).length;

    const driverRows = members.map((m) => {
      const driverCompleted = completedJobs.filter((j) =>
        (j.assignedDrivers || []).some((d) => d.id === m.id)
      ).length;
      const driverStops = scopedJobs.reduce((sum, j) => {
        if (!(j.assignedDrivers || []).some((d) => d.id === m.id)) return sum;
        return sum + normalizeJobStops(j).filter((s) => s.status === 'completed').length;
      }, 0);
      const driverPods = scopedJobs.reduce((sum, j) => {
        return sum + normalizeJobStops(j).filter((s) => s.pod?.capturedBy === m.id).length;
      }, 0);
      const driverSpend = scopedExpenses
        .filter((e) => e.driverId === m.id)
        .reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);

      return {
        id: m.id,
        name: m.name || m.email || 'Driver',
        color: m.color || '#22c55e',
        completedJobs: driverCompleted,
        stopsDelivered: driverStops,
        podsCaptured: driverPods,
        spend: driverSpend,
      };
    }).sort((a, b) => b.completedJobs - a.completedJobs || b.stopsDelivered - a.stopsDelivered);

    return {
      completedCount: completedJobs.length,
      totalJobs: scopedJobs.length,
      onTimePct,
      avgMinutes,
      totalStopsDelivered,
      totalPodsCaptured,
      totalMiles,
      totalSpend,
      costPerMile,
      categoryTotals,
      activeVehicles,
      totalVehicles: vehicles.length,
      maintenanceDue,
      openDefects,
      driverRows,
    };
  }, [scopedJobs, scopedExpenses, milesByJobId, vehicles, inspections, members]);

  if (!modals.fleetAnalytics) return null;

  const handleExportCsv = () => {
    const headers = ['Driver', 'Completed Jobs', 'Stops Delivered', 'PODs Captured', 'Total Expenses ($)'];
    const rows = metrics.driverRows.map((r) => [
      sanitizeCsvCell(r.name),
      String(r.completedJobs),
      String(r.stopsDelivered),
      String(r.podsCaptured),
      r.spend.toFixed(2),
    ]);
    const csv = [headers.map(sanitizeCsvCell).join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `vecto_fleet_kpis_${period}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    addToast('Fleet KPI summary CSV exported!', 'success');
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-3 sm:p-4"
      onClick={() => closeModal('fleetAnalytics')}
    >
      <div
        className="bg-slate-900 border border-slate-800 text-white rounded-2xl w-full max-w-5xl max-h-[92vh] shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 bg-slate-950/90 border-b border-slate-800 flex flex-wrap justify-between items-center gap-3 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-indigo-500/20 text-indigo-400 rounded-xl border border-indigo-500/30">
              <BarChart3 size={22} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Fleet Analytics & KPIs</h2>
              <p className="text-xs text-slate-400">
                On-time SLA performance, GPS mileage, operating cost per mile, and fleet safety readiness.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <div className="flex bg-slate-800 rounded-xl p-0.5 border border-slate-700">
              {[
                { id: '7d', label: '7 Days' },
                { id: '30d', label: '30 Days' },
                { id: 'all', label: 'All Time' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setPeriod(opt.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                    period === opt.id ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleExportCsv}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold cursor-pointer"
            >
              <Download size={14} />
              <span className="hidden sm:inline">Export CSV</span>
            </button>
            <button
              type="button"
              onClick={() => closeModal('fleetAnalytics')}
              className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800"
              aria-label="Close fleet analytics"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
          {/* Top 4 Executive KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-slate-800/60 border border-slate-700/70 rounded-xl p-3.5 space-y-1">
              <div className="flex items-center justify-between text-[11px] font-bold uppercase text-emerald-400">
                <span>Completed & SLA</span>
                <Clock size={14} />
              </div>
              <p className="text-2xl font-black font-mono text-white">
                {metrics.completedCount} <span className="text-xs font-normal text-slate-400">/ {metrics.totalJobs} jobs</span>
              </p>
              <p className="text-[11px] text-slate-400">
                {metrics.onTimePct !== null ? `${metrics.onTimePct}% On-Time SLA` : 'No SLA windows'} • Avg {metrics.avgMinutes}m/trip
              </p>
            </div>

            <div className="bg-slate-800/60 border border-slate-700/70 rounded-xl p-3.5 space-y-1">
              <div className="flex items-center justify-between text-[11px] font-bold uppercase text-sky-400">
                <span>Distance Tracked</span>
                <Navigation size={14} />
              </div>
              <p className="text-2xl font-black font-mono text-white">
                {metrics.totalMiles.toFixed(1)} <span className="text-xs font-normal text-slate-400">mi</span>
              </p>
              <p className="text-[11px] text-slate-400">
                {metrics.totalStopsDelivered} stops • {metrics.totalPodsCaptured} PODs verified
              </p>
            </div>

            <div className="bg-slate-800/60 border border-slate-700/70 rounded-xl p-3.5 space-y-1">
              <div className="flex items-center justify-between text-[11px] font-bold uppercase text-amber-400">
                <span>Spend & Cost / Mile</span>
                <DollarSign size={14} />
              </div>
              <p className="text-2xl font-black font-mono text-white">
                ${metrics.totalSpend.toFixed(2)}
              </p>
              <p className="text-[11px] text-amber-300 font-mono font-semibold">
                {metrics.totalMiles > 0 ? `$${metrics.costPerMile.toFixed(2)} / mi` : 'N/A per mile'}
              </p>
            </div>

            <div className="bg-slate-800/60 border border-slate-700/70 rounded-xl p-3.5 space-y-1">
              <div className="flex items-center justify-between text-[11px] font-bold uppercase text-cyan-400">
                <span>Fleet Readiness</span>
                <Activity size={14} />
              </div>
              <p className="text-2xl font-black font-mono text-white">
                {metrics.activeVehicles} <span className="text-xs font-normal text-slate-400">/ {metrics.totalVehicles} ready</span>
              </p>
              <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <span>{metrics.maintenanceDue} PM due</span> •{' '}
                <span className={metrics.openDefects > 0 ? 'text-rose-400 font-bold' : ''}>
                  {metrics.openDefects} open DVIR
                </span>
              </p>
            </div>
          </div>

          {loading && (
            <div className="text-xs text-sky-400 animate-pulse">
              Calculating route breadcrumb mileage and expenses...
            </div>
          )}

          {/* Category Spend Breakdown */}
          <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-4 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Operating Expense Breakdown
            </h3>
            <div className="space-y-2">
              {Object.entries(metrics.categoryTotals).map(([cat, amt]) => {
                const pct = metrics.totalSpend > 0 ? Math.round((amt / metrics.totalSpend) * 100) : 0;
                return (
                  <div key={cat} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="uppercase font-bold text-slate-300">{cat}</span>
                      <span className="font-mono text-slate-200">
                        ${amt.toFixed(2)} ({pct}%)
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${CATEGORY_COLORS[cat] || 'bg-slate-500'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Driver Performance Table */}
          <div className="bg-slate-800/40 border border-slate-800 rounded-xl overflow-hidden">
            <div className="p-3.5 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Driver Performance & Utilization
              </h3>
              {metrics.openDefects > 0 && (
                <span className="text-[11px] text-rose-300 flex items-center gap-1 font-semibold">
                  <ShieldAlert size={13} /> {metrics.openDefects} unresolved safety defect(s)
                </span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/60 text-slate-400 uppercase text-[10px]">
                  <tr>
                    <th className="px-4 py-2.5">Driver</th>
                    <th className="px-4 py-2.5 text-right">Completed Jobs</th>
                    <th className="px-4 py-2.5 text-right">Stops Done</th>
                    <th className="px-4 py-2.5 text-right">PODs</th>
                    <th className="px-4 py-2.5 text-right">Expenses</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {metrics.driverRows.length === 0 ? (
                    <tr>
                      <td colSpan="5" className="px-4 py-6 text-center text-slate-500 italic">
                        No drivers found in this fleet.
                      </td>
                    </tr>
                  ) : (
                    metrics.driverRows.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-800/50">
                        <td className="px-4 py-2.5 font-semibold text-white flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: row.color }} />
                          <span className="truncate max-w-[180px]">{row.name}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-emerald-300 font-bold">
                          {row.completedJobs}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-slate-200">{row.stopsDelivered}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-sky-300">{row.podsCaptured}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-amber-300">${row.spend.toFixed(2)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
