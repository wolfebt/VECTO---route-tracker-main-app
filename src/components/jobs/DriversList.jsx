import React from 'react';
import { useActiveDrivers, useJobs } from '../../hooks/useFirebase';
import { useAppStore } from '../../store/useAppStore';
import { useToastStore } from '../../store/useToastStore';
import { doc, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase';

export default function DriversList() {
  const drivers = useActiveDrivers();
  const jobs = useJobs();
  const isDispatchView = useAppStore(state => state.isDispatchView);
  const companyId = useAppStore(state => state.companyId);
  const addToast = useToastStore((state) => state.addToast);

  const handleRemoveDriver = async (driverId) => {
    if (window.confirm("Remove driver from active list?")) {
      try {
        await deleteDoc(doc(db, `companies/${companyId}/active_drivers`, driverId));
      } catch {
        addToast("Failed to remove driver", "error");
      }
    }
  };

  const fiveMinAgo = Date.now() - (5 * 60 * 1000);
  const active = drivers.filter(d => d.timestamp && d.timestamp.toMillis() > fiveMinAgo);

  if (active.length === 0) {
    return <p className="text-gray-400 text-sm italic p-2">No active drivers.</p>;
  }

  return (
    <ul className="space-y-2">
      {active.map(driver => {
        let statusText = driver.status || 'Online';
        let statusColor = 'bg-gray-500';
        let dotStyle = driver.color ? { backgroundColor: driver.color } : {};
        
        const assignedJob = jobs.find(j => j.status === 'in-progress' && j.assignedDrivers?.some(d => d.id === driver.id));
        if (assignedJob) {
            statusText = `On Trip: ${assignedJob.jobName}`;
            if (!driver.color) statusColor = 'bg-yellow-500';
        } else if (driver.status === 'Available') {
            if (!driver.color) statusColor = 'bg-green-500';
        }

        return (
          <li key={driver.id} className="flex justify-between items-center bg-gray-800 p-2 rounded-md border-l-4" style={{ borderLeftColor: driver.color || '#22c55e' }}>
             <div className="overflow-hidden">
                <p className="text-sm font-bold text-gray-200 truncate">{driver.name || 'Unnamed'}</p>
                {/* <p className="text-xs text-gray-400 truncate">ETA: N/A</p> */}
             </div>
             <div className="flex items-center space-x-2 flex-shrink-0 ml-2">
                <span className="text-xs font-semibold text-gray-400 max-w-[80px] truncate">{statusText}</span>
                <span className={`w-3 h-3 rounded-full ${driver.color ? '' : statusColor}`} style={dotStyle}></span>
                {isDispatchView && (
                    <button 
                       onClick={() => handleRemoveDriver(driver.id)} 
                       className="text-red-400 hover:text-red-300 ml-2 px-1 text-xs"
                       title="Remove Driver from Map"
                    >
                       &times;
                    </button>
                )}
             </div>
          </li>
        );
      })}
    </ul>
  );
}
