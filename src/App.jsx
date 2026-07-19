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
    <APIProvider apiKey={mapsApiKey || ''}>
      <div className="flex h-screen bg-gray-900 text-white overflow-hidden">
        {/* Map Area */}
        <div className="flex-1 bg-gray-800 relative">
            <MapArea />
            {selectedJobId && <JobDetails />}
        </div>
        
        {/* Sidebar Area */}
        <div className="w-96 border-l border-gray-800 flex flex-col bg-gray-900 z-10 flex-shrink-0 relative h-full">
           <div className="p-4 border-b border-gray-800 flex justify-between items-center">
             <div>
               <h1 className="text-xl font-bold">Vecto</h1>
               <p className="text-sm text-gray-400">Welcome, {currentUser.name}</p>
             </div>
             <button onClick={() => openModal('settings')} className="text-gray-400 hover:text-white p-2" title="Settings">
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
