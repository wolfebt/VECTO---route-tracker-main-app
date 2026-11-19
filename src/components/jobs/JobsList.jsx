import React, { useEffect } from 'react';
import { useJobs, useArchivedJobs } from '../../hooks/useFirebase';
import { useAppStore } from '../../store/useAppStore';
import { toMillisSafe } from '../../utils/formatters';

export default function JobsList() {
  const jobs = useJobs();
  const {
    hasMoreArchivedJobs,
    loadingArchivedJobs,
    archivedJobsLoadedOnce,
    loadArchivedPage,
  } = useArchivedJobs();
  const activeJobTab = useAppStore(state => state.activeJobTab);
  const jobSearchQuery = useAppStore(state => state.jobSearchQuery);
  const jobFilter = useAppStore(state => state.jobFilter);
  const currentUser = useAppStore(state => state.currentUser);
  const selectedJobId = useAppStore(state => state.selectedJobId);
  const setSelectedJobId = useAppStore(state => state.setSelectedJobId);
  const setMobileView = useAppStore(state => state.setMobileView);
  const colors = useAppStore(state => state.colors);

  const handleSelectJob = (id) => {
    setSelectedJobId(id);
    setMobileView('sidebar');
  };

  const isArchived = activeJobTab === 'archive';
  const searchLower = (jobSearchQuery || '').trim().toLowerCase();

  useEffect(() => {
    if (isArchived && !archivedJobsLoadedOnce && !loadingArchivedJobs) {
      loadArchivedPage({ reset: true });
    }
  }, [isArchived, archivedJobsLoadedOnce, loadingArchivedJobs, loadArchivedPage]);

  const filteredJobs = jobs
    .filter(job => {
      if (!!job.archived !== isArchived) return false;

      if (!isArchived) {
        if (jobFilter === 'mine') {
          const assigned = job.assignedDrivers || [];
          if (!assigned.some(d => d.id === currentUser?.id)) return false;
        } else if (jobFilter === 'open') {
          const assigned = job.assignedDrivers || [];
          if (job.status !== 'unassigned' && assigned.length > 0) return false;
        }
      }

      if (searchLower) {
        const nameMatch = (job.jobName || '').toLowerCase().includes(searchLower);
        const originMatch = (job.origin || '').toLowerCase().includes(searchLower);
        const destMatch = (job.destinations || []).some(d => d.toLowerCase().includes(searchLower)) || (job.destination || '').toLowerCase().includes(searchLower);
        const contactMatch = (job.contactName || '').toLowerCase().includes(searchLower);
        const driverMatch = (job.assignedDrivers || []).some(d => (d.name || '').toLowerCase().includes(searchLower));
        if (!nameMatch && !originMatch && !destMatch && !contactMatch && !driverMatch) return false;
      }

      return true;
    })
    .sort((a, b) => toMillisSafe(b.createdAt) - toMillisSafe(a.createdAt));

  if (filteredJobs.length === 0) {
    if (isArchived && loadingArchivedJobs) {
      return <p className="text-gray-400 text-sm italic p-2">Loading archived jobs...</p>;
    }
    return <p className="text-gray-400 text-sm italic p-2">No jobs found.</p>;
  }

  const getJobColor = (id) => {
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  return (
    <div className="space-y-2">
      {isArchived && (
        <div className="flex items-center justify-between px-1 text-[11px] text-slate-400">
          <span>Showing {filteredJobs.length} archived job{filteredJobs.length === 1 ? '' : 's'}</span>
          <button
            type="button"
            disabled={loadingArchivedJobs}
            onClick={() => loadArchivedPage({ reset: true })}
            className="text-sky-400 hover:text-sky-300 font-semibold disabled:opacity-50 cursor-pointer"
          >
            {loadingArchivedJobs ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      )}
      <ul className="space-y-2">
      {filteredJobs.map(job => {
        const isSelected = selectedJobId === job.id;
        const color = job.routeColor || getJobColor(job.id);
        const destCount = job.destinations?.length || 0;
        const destLabel = destCount > 1 ? `${destCount} stops` : (job.destinations?.[0] || job.destination || 'N/A');

        const lastMsgMs = toMillisSafe(job.lastMessageTimestamp);
        const lastReadMs = toMillisSafe(currentUser?.lastRead?.[job.id]);
        const hasUnread = lastMsgMs > lastReadMs;
        
        let statusClass = 'bg-gray-800 hover:bg-gray-700';
        let statusTag = '';

        if (isArchived) {
            statusTag = <span className="px-2 py-1 bg-gray-600 text-xs rounded-full">Archived</span>;
        } else if (job.status === 'pending-completion') {
            statusClass = 'bg-green-900 hover:bg-green-800';
            statusTag = <span className="px-2 py-1 bg-green-600 text-xs rounded-full">Pending</span>;
        } else if (job.status === 'in-progress') {
            statusTag = <span className="px-2 py-1 bg-blue-600 text-xs rounded-full">In Progress</span>;
        } else if (job.status === 'assigned') {
            statusTag = <span className="px-2 py-1 bg-indigo-600 text-xs rounded-full text-white">Assigned</span>;
        } else if (job.status === 'completed') {
            statusTag = <span className="px-2 py-1 bg-gray-600 text-xs rounded-full">Completed</span>;
        } else if (job.status === 'cancelled') {
            statusTag = <span className="px-2 py-1 bg-rose-700 text-xs rounded-full text-white">Cancelled</span>;
        } else if (job.status === 'unassigned') {
            statusTag = <span className="px-2 py-1 bg-yellow-600 text-xs rounded-full text-white">Available</span>;
        }

        const showAccentBorder = (job.status === 'in-progress' || job.status === 'assigned') && !isSelected;

        return (
          <li 
            key={job.id} 
            onClick={() => handleSelectJob(job.id)}
            className={`p-3 rounded-md text-sm cursor-pointer border-l-4 transition-all ${statusClass} ${isSelected ? 'selected-job-card' : 'border-transparent'}`}
            style={{ borderLeftColor: showAccentBorder ? color : undefined }}
          >
            <div className="flex justify-between items-start mb-1">
                <div className="flex items-center space-x-1.5 min-w-0 max-w-[68%]">
                  {hasUnread && (
                    <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" title="Unread chat messages" />
                  )}
                  <p className="font-bold text-white truncate">{job.jobName || 'Unnamed'}</p>
                </div>
                {statusTag}
            </div>
            <p className="text-gray-400 text-xs truncate"><strong className="text-gray-200">From:</strong> {job.origin}</p>
            <p className="text-gray-400 text-xs truncate"><strong className="text-gray-200">To:</strong> {destLabel}</p>
          </li>
        );
      })}
      </ul>
      {isArchived && hasMoreArchivedJobs && (
        <button
          type="button"
          disabled={loadingArchivedJobs}
          onClick={() => loadArchivedPage({ reset: false })}
          className="w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-sky-300 transition-colors cursor-pointer disabled:opacity-50"
        >
          {loadingArchivedJobs ? 'Loading more...' : 'Load More Archived Jobs'}
        </button>
      )}
    </div>
  );
}
