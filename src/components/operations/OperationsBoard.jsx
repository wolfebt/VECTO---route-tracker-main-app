import React, { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useJobs, useActiveDrivers, useCompany } from '../../hooks/useFirebase';
import { db } from '../../firebase';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useToastStore } from '../../store/useToastStore';
import { 
  Briefcase, 
  Clock, 
  MapPin, 
  Navigation, 
  CheckCircle2, 
  AlertCircle, 
  UserCheck, 
  ChevronRight, 
  ChevronLeft, 
  Plus, 
  Map, 
  Search, 
  FileText,
  Star,
  Users
} from 'lucide-react';

export default function OperationsBoard() {
  const { setMainView, setSelectedJobId, openModal, companyId, isDispatchView } = useAppStore();
  const addToast = useToastStore((state) => state.addToast);
  const jobs = useJobs();
  const activeDrivers = useActiveDrivers();
  const { members } = useCompany();

  const [searchQuery, setSearchQuery] = useState('');

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
    const driverMatch = (job.assignedDrivers || []).some(d => d.name.toLowerCase().includes(query));
    return nameMatch || destMatch || driverMatch;
  });

  const handleUpdateStatus = async (jobId, newStatus) => {
    try {
      const updates = { 
        status: newStatus,
        updatedAt: serverTimestamp()
      };
      if (newStatus === 'completed') {
        updates.completedAt = serverTimestamp();
      }
      await updateDoc(doc(db, `companies/${companyId}/jobs`, jobId), updates);
      addToast(`Job moved to ${newStatus.replace('-', ' ')}`, "success");
    } catch (err) {
      console.error(err);
      addToast("Failed to update status", "error");
    }
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
        <div className="flex items-center space-x-2">
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
          const colJobs = filteredJobs.filter(j => col.statuses.includes(j.status));

          return (
            <div 
              key={col.id}
              className="flex-1 min-w-[300px] max-w-[380px] flex flex-col rounded-2xl bg-slate-900/60 border border-slate-800 shadow-xl overflow-hidden"
            >
              {/* Column Header */}
              <div className={`p-3 border-b flex justify-between items-center ${col.color}`}>
                <div className="flex items-center space-x-2">
                  <span className="font-bold text-xs uppercase tracking-wider">{col.title}</span>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${col.badgeBg}`}>
                  {colJobs.length}
                </span>
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

                    return (
                      <div 
                        key={job.id}
                        className="bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 hover:border-slate-600 rounded-xl p-3.5 shadow-md flex flex-col space-y-2.5 transition-all group"
                      >
                        {/* Card Header: Job Name & Date */}
                        <div className="flex justify-between items-start">
                          <h3 
                            onClick={() => handleViewOnMap(job.id)}
                            className="font-bold text-sm text-white group-hover:text-primary-300 transition-colors cursor-pointer truncate max-w-[75%]"
                            title="Click to view details & route on map"
                          >
                            {job.jobName || 'Unnamed Job'}
                          </h3>
                          {job.jobDate && (
                            <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                              <Clock size={11} /> {job.jobDate}
                            </span>
                          )}
                        </div>

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
                        <div className="flex items-center justify-between pt-1">
                          <div className="flex items-center flex-wrap gap-1.5">
                            {assignedList.length === 0 ? (
                              <span className="text-[11px] text-amber-400/80 italic flex items-center gap-1">
                                <AlertCircle size={12} /> Unassigned
                              </span>
                            ) : (
                              assignedList.map(driver => {
                                const activeInfo = activeDrivers.find(ad => ad.id === driver.id);
                                const isOnline = activeInfo?.timestamp && activeInfo.timestamp.toMillis() > fiveMinAgo;
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
                            className="p-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-600 text-sky-400 hover:text-white transition-colors"
                            title="Open route on map"
                          >
                            <Navigation size={13} />
                          </button>
                        </div>

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
                                  handleUpdateStatus(job.id, prevStage);
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

                            {/* Move Forward */}
                            {col.id !== 'completed' && (
                              <button
                                type="button"
                                onClick={() => {
                                  const nextStage = 
                                    col.id === 'standby' ? 'assigned' :
                                    col.id === 'assigned' ? 'in-progress' : 'completed';
                                  handleUpdateStatus(job.id, nextStage);
                                }}
                                className="text-sky-400 hover:text-sky-200 font-bold flex items-center space-x-0.5 p-1 rounded hover:bg-sky-950/40 transition-colors ml-auto"
                                title="Advance to next stage"
                              >
                                <span className="text-[10px]">
                                  {col.id === 'standby' ? 'Assign' : col.id === 'assigned' ? 'Start Trip' : 'Complete'}
                                </span>
                                <ChevronRight size={14} />
                              </button>
                            )}
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
