import React from 'react';
import { useJobs } from '../../hooks/useFirebase';
import { useAppStore } from '../../store/useAppStore';

export default function JobsList() {
  const jobs = useJobs();
  const activeJobTab = useAppStore(state => state.activeJobTab);
  const selectedJobId = useAppStore(state => state.selectedJobId);
  const setSelectedJobId = useAppStore(state => state.setSelectedJobId);
  const colors = useAppStore(state => state.colors);

  const isArchived = activeJobTab === 'archive';
  const filteredJobs = jobs
    .filter(job => !!job.archived === isArchived)
    .sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));

  if (filteredJobs.length === 0) {
    return <p className="text-gray-400 text-sm italic p-2">No jobs found.</p>;
  }

  const getJobColor = (id) => {
    // Simple hash to consistently assign color based on ID
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  return (
    <ul className="space-y-2">
      {filteredJobs.map(job => {
        const isSelected = selectedJobId === job.id;
        const color = getJobColor(job.id);
        const destCount = job.destinations?.length || 0;
        const destLabel = destCount > 1 ? `${destCount} stops` : (job.destinations?.[0] || job.destination || 'N/A');
        
        let statusClass = 'bg-gray-800 hover:bg-gray-700';
        let statusTag = '';

        if (isArchived) {
            statusTag = <span className="px-2 py-1 bg-gray-600 text-xs rounded-full">Archived</span>;
        } else if (job.status === 'pending-completion') {
            statusClass = 'bg-green-900 hover:bg-green-800';
            statusTag = <span className="px-2 py-1 bg-green-600 text-xs rounded-full">Pending</span>;
        } else if (job.status === 'in-progress') {
            statusTag = <span className="px-2 py-1 bg-blue-600 text-xs rounded-full">In Progress</span>;
        } else if (job.status === 'completed') {
            statusTag = <span className="px-2 py-1 bg-gray-600 text-xs rounded-full">Completed</span>;
        } else if (job.status === 'unassigned') {
            statusTag = <span className="px-2 py-1 bg-yellow-600 text-xs rounded-full text-white">Available</span>;
        }

        return (
          <li 
            key={job.id} 
            onClick={() => setSelectedJobId(job.id)}
            className={`p-3 rounded-md text-sm cursor-pointer border-l-4 transition-all ${statusClass} ${isSelected ? 'selected-job-card' : 'border-transparent'}`}
            style={{ borderLeftColor: (job.status === 'in-progress' && !isSelected) ? color : undefined }}
          >
            <div className="flex justify-between items-start mb-1">
                <p className="font-bold text-white truncate max-w-[65%]">{job.jobName || 'Unnamed'}</p>
                {statusTag}
            </div>
            <p className="text-gray-400 text-xs truncate"><strong className="text-gray-200">From:</strong> {job.origin}</p>
            <p className="text-gray-400 text-xs truncate"><strong className="text-gray-200">To:</strong> {destLabel}</p>
          </li>
        );
      })}
    </ul>
  );
}
