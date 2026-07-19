import React from 'react';
import { useAppStore } from './store/useAppStore';
import { useAuth, useCompany } from './hooks/useFirebase';
import Auth from './components/Auth';
import CompanySelector from './components/CompanySelector';
import Sidebar from './components/layout/Sidebar';
import MapArea from './components/layout/MapArea';
import JobDetails from './components/jobs/JobDetails';
import SettingsModal from './components/modals/SettingsModal';
import CreateJobModal from './components/modals/CreateJobModal';
import AdminSettingsModal from './components/modals/AdminSettingsModal';
import CompanySettingsModal from './components/modals/CompanySettingsModal';
import ProfileModal from './components/modals/ProfileModal';
import UserGuideModal from './components/modals/UserGuideModal';
import InviteModal from './components/modals/InviteModal';
import ToastContainer from './components/layout/ToastContainer';
import { Settings } from 'lucide-react';
import { APIProvider } from '@vis.gl/react-google-maps';

function App() {
  const { isAuthReady } = useAppStore();
  const currentUser = useAppStore(state => state.currentUser);
  const companyId = useAppStore(state => state.companyId);
  const selectedJobId = useAppStore(state => state.selectedJobId);
  const openModal = useAppStore(state => state.openModal);
  const mapsApiKey = useAppStore(state => state.mapsApiKey);
  
  // Initialize auth listener
  useAuth();
  
  // Listen to active company members (updates isDispatchView)
  useCompany();

  if (!isAuthReady) {
    return <div className="flex items-center justify-center min-h-screen bg-gray-900"><div className="text-white">Loading...</div></div>;
  }

  if (!currentUser) {
    return <Auth />;
  }

  if (!companyId) {
    return <CompanySelector />;
  }

  return (
    <APIProvider apiKey={mapsApiKey || import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''}>
      <div className="flex h-screen bg-[#0b0f19] text-white overflow-hidden font-sans">
        {/* Map Area */}
        <div className="flex-1 relative z-0">
            <MapArea />
            {selectedJobId && <JobDetails />}
        </div>
        
        {/* Sidebar Area */}
        <div className="w-96 glass-panel z-10 flex-shrink-0 relative h-full flex flex-col border-l border-white/5 shadow-[-10px_0_30px_rgba(0,0,0,0.5)]">
           <div className="p-5 border-b border-white/10 flex justify-between items-center bg-slate-900/40 backdrop-blur-md">
             <div>
               <h1 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-400 to-accent-400">Vecto</h1>
               <p className="text-xs text-gray-400 font-medium">Welcome, {currentUser.name}</p>
             </div>
             <button onClick={() => openModal('settings')} aria-label="Settings" className="text-gray-400 hover:text-primary-400 p-2 transition-colors hover:bg-white/5 rounded-full" title="Settings">
               <Settings size={20} />
             </button>
           </div>
           <div className="flex-1 p-4 overflow-y-auto">
              <Sidebar />
           </div>
        </div>
        
        {/* Modals */}
        <SettingsModal />
        <CreateJobModal />
        <AdminSettingsModal />
        <CompanySettingsModal />
        <ProfileModal />
        <UserGuideModal />
        <InviteModal />
        <ToastContainer />
      </div>
    </APIProvider>
  );
}

export default App;
