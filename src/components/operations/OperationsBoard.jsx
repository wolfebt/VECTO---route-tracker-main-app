import React, { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useJobs, useActiveDrivers, useCompany, useVehicles } from '../../hooks/useFirebase';
import { db } from '../../firebase';
import { doc, updateDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { useToastStore } from '../../store/useToastStore';
import { toMillisSafe } from '../../utils/formatters';
import { sortDriverRoster } from '../../utils/roster';
import { evaluateJobSlaSummary } from '../../utils/stops';
import { geocodeAddressCached, rankDriversByProximity } from '../../utils/proximityDispatch';
import { syncPublicTrackingJobUpdate } from '../../utils/publicTracking';
import { 
  Clock, 
  Navigation, 
  AlertCircle, 
  ChevronRight, 
  ChevronLeft, 
  Plus, 
  Map, 
  Search, 
  FileText,
  Star,
  Users,
  CheckCircle2,
  Archive,
  Zap,
  Truck,
  BarChart3,
  MapPin
} from 'lucide-react';

export default function OperationsBoard() {
  const { setMainView, setSelectedJobId, openModal, companyId, companyName, routeInfo, isDispatchView } = useAppStore();
  const addToast = useToastStore((state) => state.addToast);
  const jobs = useJobs();
  const activeDrivers = useActiveDrivers();
  const vehicles = useVehicles();
  const { members } = useCompany();

  const [searchQuery, setSearchQuery] = useState('');
  const [completedScope, setCompletedScope] = useState('today'); // 'today' | 'all'
  const [draggedJobId, setDraggedJobId] = useState(null);
  const [dragOverColId, setDragOverColId] = useState(null);
  const [archivingCompleted, setArchivingCompleted] = useState(false);

  const sortedRoster = sortDriverRoster(members);
  const nextRosterDriver = sortedRoster.find(m => (m.onDutyStatus || 'on_duty') === 'on_duty') || null;

  // 4 Stages definition
  const columns = [
    {
      id: 'standby',
      title: 'Standby / Unassigned',
      color: 'border-amber-500/50 bg-amber-950/20 text-amber-300',
      badgeBg: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
      statuses: ['unassigned', 'standby'],
      emptyText: 'No standby jobs.'
    },
    {
      id: 'assigned',
      title: 'Assigned / Scheduled',
      color: 'border-blue-500/50 bg-blue-950/20 text-blue-300',
      badgeBg: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
      statuses: ['assigned'],
      emptyText: 'No jobs awaiting departure.'
    },
    {
      id: 'in-progress',
      title: 'In Process / On Road',
      color: 'border-emerald-500/50 bg-emerald-950/20 text-emerald-300',
      badgeBg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
      statuses: ['in-progress'],
      emptyText: 'No active trips en route.'
    },
    {
      id: 'completed',
      title: 'Completed Today',
      color: 'border-slate-500/50 bg-slate-900/40 text-slate-300',
      badgeBg: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
      statuses: ['completed', 'pending-completion'],
      emptyText: 'No completed jobs today.'
    }
  ];

  // Filter out archived jobs from operations board
  const activeJobs = jobs.filter(j => !j.archived && j.status !== 'cancelled');

  const filteredJobs = activeJobs.filter(job => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const nameMatch = (job.jobName || '').toLowerCase().includes(query);
    const destMatch = (job.destinations || []).some(d => d.toLowerCase().includes(query)) || (job.destination || '').toLowerCase().includes(query);
    const driverMatch = (job.assignedDrivers || []).some(d => (d.name || '').toLowerCase().includes(query));
    return nameMatch || destMatch || driverMatch;
  });

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTodayMs = startOfToday.getTime();

  const allCompletedJobs = filteredJobs.filter(j => j.status === 'completed');
  const olderCompletedCount = allCompletedJobs.filter(j => {
    const tsMs = toMillisSafe(j.completedAt || j.updatedAt || j.createdAt);
    return tsMs > 0 && tsMs < startOfTodayMs;
  }).length;

  const handleUpdateStatus = async (job, newStatus) => {
    if (!job?.id || !companyId) return;
    if (newStatus === 'assigned' && (job.assignedDrivers || []).length === 0) {
      addToast("Assign a driver or click Next in Roster before moving to Assigned.", "warning");
      return;
    }

    try {
      const updates = { 
        status: newStatus,
        updatedAt: serverTimestamp()
      };
      if (newStatus === 'in-progress' && !job.startedAt) {
        updates.startedAt = serverTimestamp();
      }
      if (newStatus === 'completed') {
        updates.completedAt = serverTimestamp();
      }
      await updateDoc(doc(db, `companies/${companyId}/jobs`, job.id), updates);
      await syncPublicTrackingJobUpdate({
        db,
        companyId,
        companyName,
        job: { ...job, status: newStatus },
        routeInfo
      });
      addToast(`Job moved to ${newStatus.replace('-', ' ')}`, "success");
    } catch (err) {
      console.error(err);
      addToast("Failed to update status", "error");
    }
  };

  const handleQuickAssignDriver = async (job, driverId, noteSuffix = '') => {
    if (!job?.id || !driverId || !companyId) return;
    const member = members.find(m => m.id === driverId) || activeDrivers.find(d => d.id === driverId);
    if (!member) return;

    const existing = job.assignedDrivers || [];
    const nextDrivers = existing.some(d => d.id === driverId)
      ? existing
      : [...existing, { id: driverId, name: member.name || member.email || 'Driver' }];
    const nextDriverIds = nextDrivers.map(d => d.id);
    const nextStatus = job.status === 'unassigned' || job.status === 'standby' ? 'assigned' : job.status;

    const vehicleUpdates = {};
    if (!job.vehicleId) {
      const matchedVehicle = vehicles.find(
        (v) => v.assignedDriverId === driverId && v.status !== 'out_of_service'
      );
      if (matchedVehicle) {
        vehicleUpdates.vehicleId = matchedVehicle.id;
        vehicleUpdates.vehicleLabel = `${matchedVehicle.unitNumber}${matchedVehicle.makeModel ? ` • ${matchedVehicle.makeModel}` : ''}`.slice(0, 120);
      }
    }

    try {
      await updateDoc(doc(db, `companies/${companyId}/jobs`, job.id), {
        assignedDrivers: nextDrivers,
        assignedDriverIds: nextDriverIds,
        status: nextStatus,
        ...vehicleUpdates,
        updatedAt: serverTimestamp()
      });

      const maxOrder = members.reduce(
        (maxVal, m) => Math.max(maxVal, typeof m.rosterOrder === 'number' ? m.rosterOrder : 0),
        members.length
      );
      await updateDoc(doc(db, `companies/${companyId}/members/${driverId}`), {
        lastDispatchedAt: serverTimestamp(),
        rosterOrder: maxOrder + 1
      }).catch(() => {});

      await syncPublicTrackingJobUpdate({
        db,
        companyId,
        companyName,
        job: { ...job, ...vehicleUpdates, assignedDrivers: nextDrivers, status: nextStatus },
        routeInfo
      });

      addToast(`Assigned ${member.name || member.email}${noteSuffix} to ${job.jobName || 'Job'}`, "success");
    } catch (err) {
      console.error(err);
      addToast("Failed to assign driver", "error");
    }
  };

  const handleQuickAssignNearest = async (job) => {
    if (!job?.id) return;
    const originCoords = job.origin ? await geocodeAddressCached(job.origin) : null;
    const ranked = rankDriversByProximity({
      originCoords,
      members,
      activeDrivers,
      jobs,
    });
    const best =
      ranked.find((c) => c.duty !== 'off_duty' && !c.isBusy) ||
      ranked.find((c) => c.duty !== 'off_duty') ||
      ranked[0];
    if (!best) {
      addToast("No available drivers to assign", "info");
      return;
    }
    const suffix = best.etaLabel ? ` (${best.distanceLabel || ''} • ${best.etaLabel})` : '';
    await handleQuickAssignDriver(job, best.member.id, suffix);
  };

  const handleArchiveCompleted = async (jobsToArchive) => {
    if (!isDispatchView || !companyId || jobsToArchive.length === 0 || archivingCompleted) return;
    if (!window.confirm(`Archive ${jobsToArchive.length} completed job(s) from the board?`)) return;
    setArchivingCompleted(true);
    try {
      for (let i = 0; i < jobsToArchive.length; i += 450) {
        const chunk = jobsToArchive.slice(i, i + 450);
        const batch = writeBatch(db);
        chunk.forEach((j) => {
          batch.update(doc(db, `companies/${companyId}/jobs`, j.id), {
            archived: true,
            previousStatus: j.status || 'completed',
            updatedAt: serverTimestamp()
          });
        });
        await batch.commit();
      }
      useAppStore.getState().setArchivedJobsState({ archivedJobsLoadedOnce: false });
      addToast(`Archived ${jobsToArchive.length} completed job(s)`, "success");
    } catch (err) {
      console.error(err);
      addToast("Failed to archive completed jobs", "error");
    }
    setArchivingCompleted(false);
  };

  const handleDropOnColumn = async (targetColId) => {
    setDragOverColId(null);
    if (!isDispatchView || !draggedJobId) return;
    const job = activeJobs.find(j => j.id === draggedJobId);
    setDraggedJobId(null);
    if (!job) return;

    const targetStatusMap = {
      standby: 'unassigned',
      assigned: 'assigned',
      'in-progress': 'in-progress',
      completed: 'completed'
    };
    const nextStatus = targetStatusMap[targetColId];
    if (!nextStatus) return;

    const currentCol = columns.find(c => c.statuses.includes(job.status));
    if (currentCol?.id === targetColId) return;

    await handleUpdateStatus(job, nextStatus);
  };

  const handleViewOnMap = (jobId) => {
    setSelectedJobId(jobId);
    setMainView('map');
  };

  const fiveMinAgo = Date.now() - (5 * 60 * 1000);

  return (
    <div className="flex flex-col h-full bg-[#0b0f19] text-white">
      {/* Top Operations Header Bar */}
      <div className="p-4 bg-slate-950/80 border-b border-white/10 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center space-x-3">
          <button 
            onClick={() => setMainView('map')}
            className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-sky-400 hover:text-white transition-all shadow-sm cursor-pointer"
            title="Return to Map View"
          >
            <Map size={15} />
            <span>Map View</span>
          </button>
          <div className="h-4 w-px bg-white/10 hidden sm:block" />
          <div>
            <h1 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
              Operations Board
              <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 font-semibold">
                Live Dispatch
              </span>
            </h1>
            <p className="text-xs text-slate-400 hidden sm:block">
              Track progress from standby to completion across all company fleet operations.
            </p>
          </div>
        </div>

        {/* Toolbar Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Search Input */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter jobs or drivers..."
              className="pl-8 pr-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-xl text-white placeholder:text-slate-500 outline-none focus:border-purple-500 w-44 sm:w-56 transition-all"
            />
          </div>

          {isDispatchView && (
            <>
              <button 
                onClick={() => openModal('fleetVehicles')}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-teal-600/20 hover:bg-teal-600/30 border border-teal-500/40 text-xs font-bold text-teal-300 transition-colors cursor-pointer"
                title="Manage Fleet Vehicles & Maintenance"
              >
                <Truck size={14} />
                <span className="hidden md:inline">Vehicles</span>
              </button>
              <button 
                onClick={() => openModal('fleetAnalytics')}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-xs font-bold text-indigo-300 transition-colors cursor-pointer"
                title="Open Fleet KPIs & Cost-per-Mile Analytics"
              >
                <BarChart3 size={14} />
                <span className="hidden md:inline">Analytics</span>
              </button>
              <button 
                onClick={() => openModal('driverRoster')}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-sky-600/20 hover:bg-sky-600/30 border border-sky-500/40 text-xs font-bold text-sky-300 transition-colors cursor-pointer"
                title="Manage Driver Roster"
              >
                <Users size={14} />
                <span className="hidden md:inline">Roster</span>
              </button>
              <button 
                onClick={() => openModal('createJob')}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl btn-primary text-xs font-bold cursor-pointer"
                title="Create New Job"
              >
                <Plus size={15} />
                <span>New Job</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* 4-Stage Kanban Swimlanes */}
      <div className="flex-1 overflow-x-auto p-4 flex gap-4 min-h-0">
        {columns.map(col => {
          let colJobs = filteredJobs.filter(j => col.statuses.includes(j.status));
          if (col.id === 'completed') {
            if (completedScope === 'today') {
              colJobs = colJobs.filter((j) => {
                if (j.status === 'pending-completion') return true;
                const tsMs = toMillisSafe(j.completedAt || j.updatedAt || j.createdAt);
                return tsMs === 0 || tsMs >= startOfTodayMs;
              });
            }
            colJobs = [...colJobs].sort((a, b) => {
              const aPending = a.status === 'pending-completion' ? 0 : 1;
              const bPending = b.status === 'pending-completion' ? 0 : 1;
              if (aPending !== bPending) return aPending - bPending;
              return toMillisSafe(b.completedAt || b.updatedAt || b.createdAt) - toMillisSafe(a.completedAt || a.updatedAt || a.createdAt);
            });
          }

          const archivableCompleted = col.id === 'completed'
            ? colJobs.filter(j => j.status === 'completed')
            : [];
          const isDropTarget = dragOverColId === col.id && draggedJobId;

          return (
            <div 
              key={col.id}
              onDragOver={(e) => {
                if (!isDispatchView) return;
                e.preventDefault();
                if (dragOverColId !== col.id) setDragOverColId(col.id);
              }}
              onDragLeave={() => {
                if (dragOverColId === col.id) setDragOverColId(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                handleDropOnColumn(col.id);
              }}
              className={`flex-1 min-w-[300px] max-w-[380px] flex flex-col rounded-2xl bg-slate-900/60 border shadow-xl overflow-hidden transition-colors ${
                isDropTarget ? 'border-sky-400 ring-2 ring-sky-400/30' : 'border-slate-800'
              }`}
            >
              {/* Column Header */}
              <div className={`p-3 border-b flex flex-wrap justify-between items-center gap-2 ${col.color}`}>
                <div className="flex items-center space-x-2">
                  <span className="font-bold text-xs uppercase tracking-wider">
                    {col.id === 'completed' && completedScope === 'all' ? 'All Completed' : col.title}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {col.id === 'completed' && (olderCompletedCount > 0 || completedScope === 'all') && (
                    <button
                      type="button"
                      onClick={() => setCompletedScope(completedScope === 'today' ? 'all' : 'today')}
                      className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-600 cursor-pointer"
                      title="Toggle between Today and All unarchived completed jobs"
                    >
                      {completedScope === 'today' ? `All (+${olderCompletedCount})` : 'Today'}
                    </button>
                  )}
                  {isDispatchView && col.id === 'completed' && archivableCompleted.length > 0 && (
                    <button
                      type="button"
                      disabled={archivingCompleted}
                      onClick={() => handleArchiveCompleted(archivableCompleted)}
                      className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800/80 hover:bg-slate-700 text-sky-300 border border-sky-500/40 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      title="Archive completed jobs shown in this column"
                    >
                      <Archive size={10} />
                      <span>Archive</span>
                    </button>
                  )}
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${col.badgeBg}`}>
                    {colJobs.length}
                  </span>
                </div>
              </div>

              {/* Card List */}
              <div className="flex-1 p-3 overflow-y-auto space-y-3">
                {colJobs.length === 0 ? (
                  <div className="text-center py-12 text-slate-500 text-xs italic">
                    {col.emptyText}
                  </div>
                ) : (
                  colJobs.map(job => {
                    const assignedList = job.assignedDrivers || [];
                    const destCount = job.destinations?.length || (job.destination ? 1 : 0);
                    const finalDest = job.destinations?.[job.destinations.length - 1] || job.destination || 'N/A';
                    const isPendingApproval = job.status === 'pending-completion';
                    const slaSummary = evaluateJobSlaSummary(job);

                    return (
                      <div 
                        key={job.id}
                        draggable={isDispatchView}
                        onDragStart={() => setDraggedJobId(job.id)}
                        onDragEnd={() => {
                          setDraggedJobId(null);
                          setDragOverColId(null);
                        }}
                        className={`bg-slate-800/80 hover:bg-slate-800 border rounded-xl p-3.5 shadow-md flex flex-col space-y-2.5 transition-all group ${
                          isPendingApproval ? 'border-amber-500/50 bg-amber-950/15' : 'border-slate-700/80 hover:border-slate-600'
                        } ${draggedJobId === job.id ? 'opacity-50 scale-[0.98]' : ''}`}
                      >
                        {/* Card Header: Job Name & Date */}
                        <div className="flex justify-between items-start gap-2">
                          <h3 
                            onClick={() => handleViewOnMap(job.id)}
                            className="font-bold text-sm text-white group-hover:text-primary-300 transition-colors cursor-pointer truncate max-w-[75%]"
                            title="Click to view details & route on map"
                          >
                            {job.jobName || 'Unnamed Job'}
                          </h3>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {isPendingApproval && (
                              <span className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-bold">
                                Awaiting Approval
                              </span>
                            )}
                            {job.jobDate && (
                              <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                                <Clock size={11} /> {job.jobDate}
                              </span>
                            )}
                          </div>
                        </div>

                        {(job.vehicleLabel || slaSummary.hasSla) && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {job.vehicleLabel && (
                              <span className="px-1.5 py-0.5 rounded bg-sky-900/40 text-sky-300 border border-sky-500/30 text-[10px] font-medium inline-flex items-center gap-1">
                                <Truck size={10} /> {job.vehicleLabel}
                              </span>
                            )}
                            {slaSummary.lateCount > 0 ? (
                              <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40 text-[10px] font-bold">
                                {slaSummary.lateCount} Late SLA
                              </span>
                            ) : slaSummary.atRiskCount > 0 ? (
                              <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-bold">
                                {slaSummary.atRiskCount} At Risk SLA
                              </span>
                            ) : slaSummary.hasSla && slaSummary.onTimeCount > 0 ? (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold">
                                SLA On Time
                              </span>
                            ) : null}
                          </div>
                        )}

                        {/* Origin -> Destination Route summary */}
                        <div className="text-xs space-y-1 text-slate-300 bg-slate-900/50 p-2 rounded-lg border border-slate-700/40">
                          <p className="truncate text-slate-400">
                            <strong className="text-slate-200">From:</strong> {job.origin}
                          </p>
                          <p className="truncate text-slate-400">
                            <strong className="text-slate-200">To:</strong> {finalDest} {destCount > 1 && <span className="text-primary-400 font-medium">({destCount} stops)</span>}
                          </p>
                        </div>

                        {/* Assigned Drivers Chips */}
                        <div className="flex items-center justify-between pt-1 gap-2">
                          <div className="flex items-center flex-wrap gap-1.5 min-w-0">
                            {assignedList.length === 0 ? (
                              <span className="text-[11px] text-amber-400/80 italic flex items-center gap-1">
                                <AlertCircle size={12} /> Unassigned
                              </span>
                            ) : (
                              assignedList.map(driver => {
                                const activeInfo = activeDrivers.find(ad => ad.id === driver.id);
                                const isOnline = toMillisSafe(activeInfo?.timestamp) > fiveMinAgo;
                                const memberInfo = members.find(m => m.id === driver.id);

                                return (
                                  <span 
                                    key={driver.id}
                                    className="px-2 py-0.5 rounded-lg bg-slate-700 border border-slate-600 text-[11px] font-medium text-slate-200 flex items-center space-x-1.5"
                                  >
                                    <span 
                                      className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-slate-400'}`} 
                                      style={memberInfo?.color ? { backgroundColor: memberInfo.color } : {}}
                                    />
                                    <span className="truncate max-w-[80px]">{driver.name}</span>
                                    {memberInfo?.isPriorityDriver && (
                                      <Star size={10} className="fill-amber-400 text-amber-400" />
                                    )}
                                  </span>
                                );
                              })
                            )}
                          </div>

                          {/* Map Jump Button */}
                          <button
                            type="button"
                            onClick={() => handleViewOnMap(job.id)}
                            className="p-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-600 text-sky-400 hover:text-white transition-colors shrink-0"
                            title="Open route on map"
                          >
                            <Navigation size={13} />
                          </button>
                        </div>

                        {/* Quick Assign Bar on Standby Cards with 0 Drivers */}
                        {isDispatchView && col.id === 'standby' && assignedList.length === 0 && (
                          <div className="flex items-center gap-1.5 pt-1">
                            <select
                              value=""
                              onChange={(e) => {
                                if (e.target.value) handleQuickAssignDriver(job, e.target.value);
                              }}
                              className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-sky-500"
                            >
                              <option value="">Quick assign driver...</option>
                              {sortedRoster.map(m => (
                                <option key={m.id} value={m.id}>
                                  {m.name || m.email} {m.onDutyStatus === 'break' ? '(Break)' : m.onDutyStatus === 'off_duty' ? '(Off)' : ''}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => handleQuickAssignNearest(job)}
                              className="px-2 py-1 rounded-lg bg-emerald-600/25 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold flex items-center gap-1 shrink-0 cursor-pointer"
                              title="Assign closest available driver to origin"
                            >
                              <MapPin size={10} />
                              <span>Nearest</span>
                            </button>
                            {nextRosterDriver && (
                              <button
                                type="button"
                                onClick={() => handleQuickAssignDriver(job, nextRosterDriver.id)}
                                className="px-2 py-1 rounded-lg bg-sky-600/25 hover:bg-sky-600/40 text-sky-300 border border-sky-500/40 text-[10px] font-bold flex items-center gap-1 shrink-0 cursor-pointer"
                                title={`Dispatch next in roster: ${nextRosterDriver.name || nextRosterDriver.email}`}
                              >
                                <Zap size={10} className="text-amber-400 fill-amber-400" />
                                <span>Next</span>
                              </button>
                            )}
                          </div>
                        )}

                        {/* Stage Progression Action Bar */}
                        {isDispatchView && (
                          <div className="pt-2 border-t border-slate-700/60 flex items-center justify-between text-xs">
                            {/* Move Backward */}
                            {col.id !== 'standby' && (
                              <button
                                type="button"
                                onClick={() => {
                                  const prevStage = 
                                    col.id === 'completed' ? 'in-progress' :
                                    col.id === 'in-progress' ? 'assigned' : 'unassigned';
                                  handleUpdateStatus(job, prevStage);
                                }}
                                className="text-slate-400 hover:text-white flex items-center space-x-0.5 p-1 rounded hover:bg-slate-700 transition-colors"
                                title="Move to previous stage"
                              >
                                <ChevronLeft size={14} />
                                <span className="text-[10px]">Back</span>
                              </button>
                            )}

                            {/* Center Report/Details Trigger */}
                            <button
                              type="button"
                              onClick={() => openModal('jobReport', { jobId: job.id })}
                              className="text-slate-400 hover:text-sky-300 text-[10px] font-medium transition-colors flex items-center gap-1 mx-auto"
                            >
                              <FileText size={11} /> Report
                            </button>

                            {/* Approve & Complete for pending-completion OR Move Forward */}
                            {isPendingApproval ? (
                              <button
                                type="button"
                                onClick={() => handleUpdateStatus(job, 'completed')}
                                className="text-emerald-300 hover:text-emerald-200 font-bold flex items-center space-x-1 px-2 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/35 border border-emerald-500/40 transition-colors ml-auto cursor-pointer"
                                title="Approve driver completion request"
                              >
                                <CheckCircle2 size={12} />
                                <span className="text-[10px]">Approve & Complete</span>
                              </button>
                            ) : col.id !== 'completed' ? (
                              <button
                                type="button"
                                onClick={() => {
                                  const nextStage = 
                                    col.id === 'standby' ? 'assigned' :
                                    col.id === 'assigned' ? 'in-progress' : 'completed';
                                  handleUpdateStatus(job, nextStage);
                                }}
                                className="text-sky-400 hover:text-sky-200 font-bold flex items-center space-x-0.5 p-1 rounded hover:bg-sky-950/40 transition-colors ml-auto cursor-pointer"
                                title="Advance to next stage"
                              >
                                <span className="text-[10px]">
                                  {col.id === 'standby' ? 'Assign' : col.id === 'assigned' ? 'Start Trip' : 'Complete'}
                                </span>
                                <ChevronRight size={14} />
                              </button>
                            ) : null}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
