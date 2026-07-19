import React from 'react';
import { useAppStore } from '../../store/useAppStore';
import JobsList from '../jobs/JobsList';
import DriversList from '../jobs/DriversList';
import { useLocationSharing } from '../../hooks/useLocationSharing';
import { useVoiceCommands } from '../../hooks/useVoiceCommands';
import { MapPin, Mic, MicOff } from 'lucide-react';

export default function Sidebar() {
  const isDispatchView = useAppStore(state => state.isDispatchView);
  const activeJobTab = useAppStore(state => state.activeJobTab);
  const setActiveJobTab = useAppStore(state => state.setActiveJobTab);
  const companyName = useAppStore(state => state.companyName);
  const openModal = useAppStore(state => state.openModal);
  
  const { isSharingLocation, toggleLocationSharing } = useLocationSharing();
  const { isListening, toggleListening, supported } = useVoiceCommands();

  return (
    <div className="flex flex-col h-full">
      <div className="mb-4">
        <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-2">Company</h2>
        <div 
          onClick={() => openModal('companySettings')}
          className="flex justify-between items-center bg-gray-800 p-2 rounded cursor-pointer hover:bg-gray-700 transition-colors"
          title="Company Settings"
        >
          <span className="font-semibold">{companyName}</span>
          <span className="text-xs text-gray-400">Settings</span>
        </div>
      </div>
      
      {/* Driver Controls */}
      <div className="mb-4 space-y-2">
         <button 
           onClick={toggleLocationSharing} 
           className={`w-full flex items-center justify-center font-bold py-2 px-4 rounded shadow transition-colors ${isSharingLocation ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
         >
           <MapPin size={16} className="mr-2" />
           {isSharingLocation ? 'Location Sharing ON' : 'Share Location'}
         </button>
         
         {supported && (
           <button 
             onClick={toggleListening} 
             className={`w-full flex items-center justify-center font-bold py-2 px-4 rounded shadow transition-colors ${isListening ? 'bg-red-600 hover:bg-red-700 text-white animate-pulse' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
             title="Voice Commands: Say 'Create Job', 'Settings', or 'Close'"
           >
             {isListening ? <Mic size={16} className="mr-2" /> : <MicOff size={16} className="mr-2" />}
             {isListening ? 'Listening...' : 'Voice Assistant'}
           </button>
         )}
      </div>

      {isDispatchView && (
        <div className="mb-4">
          <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-2">Management</h2>
          <button onClick={() => openModal('createJob')} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded shadow mb-2">
            + Create New Job
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-700 mb-4">
        <button 
          className={`flex-1 py-2 text-sm text-center border-b-2 transition-colors ${activeJobTab === 'current' ? 'border-blue-500 text-blue-500 font-bold' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
          onClick={() => setActiveJobTab('current')}
        >
          Active Jobs
        </button>
        <button 
          className={`flex-1 py-2 text-sm text-center border-b-2 transition-colors ${activeJobTab === 'archive' ? 'border-blue-500 text-blue-500 font-bold' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
          onClick={() => setActiveJobTab('archive')}
        >
          Archived
        </button>
      </div>
      
      {/* Search */}
      <input 
        type="text" 
        placeholder="Search jobs..." 
        className="w-full bg-gray-800 text-white rounded-full py-2 px-4 mb-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      {/* Lists Container */}
      <div className="flex-1 overflow-y-auto min-h-0 space-y-6">
        <div>
          <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-2 sticky top-0 bg-gray-900 py-1 z-10">Jobs</h2>
          <JobsList />
        </div>
        
        {isDispatchView && (
          <div>
            <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-2 sticky top-0 bg-gray-900 py-1 z-10">Active Drivers</h2>
            <DriversList />
          </div>
        )}
      </div>
    </div>
  );
}
