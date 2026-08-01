import React from 'react';
import { useAppStore } from './store/useAppStore';
import { useAuth, useCompany } from './hooks/useFirebase';
import { useUrlOnboarding } from './hooks/useUrlOnboarding';
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
  const { isAuthReady, mobileView, setMobileView } = useAppStore();
  const currentUser = useAppStore(state => state.currentUser);
  const companyId = useAppStore(state => state.companyId);
  const selectedJobId = useAppStore(state => state.selectedJobId);
  const openModal = useAppStore(state => state.openModal);
  const mapsApiKey = useAppStore(state => state.mapsApiKey);
  
  const touchStartRef = React.useRef(null);

  const handleTouchStart = (e) => {
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      time: Date.now()
    };
  };

  const handleTouchEnd = (e) => {
    if (!touchStartRef.current) return;
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const deltaX = endX - touchStartRef.current.x;
    const deltaY = endY - touchStartRef.current.y;
    const duration = Date.now() - touchStartRef.current.time;

    // Trigger swipe if horizontal displacement is >= 50px, dominant over vertical movement, and under 600ms
    if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2 && duration < 600) {
      if (deltaX > 0) {
        // Swipe Right -> Show Map
        setMobileView('map');
      } else {
        // Swipe Left -> Show Sidebar/List
        setMobileView('sidebar');
      }
    }
    touchStartRef.current = null;
  };
  
  // Initialize auth listener
  useAuth();
  
  // Listen to active company members (updates isDispatchView)
  useCompany();

  // Process QR code & URL parameters for company/job onboarding
  useUrlOnboarding();

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
      <div 
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="flex h-screen bg-[#0b0f19] text-white overflow-hidden font-sans relative"
      >
        {/* Map Area */}
        <div className={`flex-1 relative z-0 h-full ${mobileView === 'sidebar' ? 'hidden md:block' : 'block w-full'}`}>
            <MapArea />
            {selectedJobId && <JobDetails />}
        </div>
        
        {/* Sidebar Area */}
        <div className={`w-full md:w-96 glass-panel z-10 flex-shrink-0 relative h-full flex flex-col border-l border-white/5 shadow-[-10px_0_30px_rgba(0,0,0,0.5)] ${mobileView === 'map' ? 'hidden md:flex' : 'flex'}`}>
           <div className="p-5 border-b border-white/10 flex justify-between items-center bg-slate-900/40 backdrop-blur-md">
             <div>
               <h1 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-400 to-accent-400">Vecto</h1>
               <p className="text-xs text-gray-400 font-medium">Welcome, {currentUser.name}</p>
             </div>
             <div className="flex items-center space-x-2">
               <button 
                 onClick={() => setMobileView('map')} 
                 className="md:hidden flex items-center space-x-1 text-xs bg-primary-600/30 text-primary-400 border border-primary-500/30 px-3 py-1.5 rounded-lg font-semibold hover:bg-primary-600/40 transition-colors"
                 title="View Map"
               >
                 <span>Map 🗺️</span>
               </button>
               <button onClick={() => openModal('settings')} aria-label="Settings" className="text-gray-400 hover:text-primary-400 p-2 transition-colors hover:bg-white/5 rounded-full" title="Settings">
                 <Settings size={20} />
               </button>
             </div>
           </div>
           <div className="flex-1 p-4 overflow-y-auto">
              <Sidebar />
           </div>
        </div>

        {/* Floating View Switcher Pills on Mobile */}
        <div className="md:hidden fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center bg-slate-900/90 backdrop-blur-md border border-white/15 p-1 rounded-full shadow-2xl space-x-1">
          <button 
            onClick={() => setMobileView('sidebar')}
            className={`px-4 py-2 rounded-full text-xs font-bold transition-all flex items-center space-x-1.5 ${mobileView === 'sidebar' ? 'bg-primary-600 text-white shadow-[0_0_12px_rgba(14,165,233,0.5)]' : 'text-gray-400 hover:text-white'}`}
          >
            <span>📋</span>
            <span>List</span>
          </button>
          <button 
            onClick={() => setMobileView('map')}
            className={`px-4 py-2 rounded-full text-xs font-bold transition-all flex items-center space-x-1.5 ${mobileView === 'map' ? 'bg-primary-600 text-white shadow-[0_0_12px_rgba(14,165,233,0.5)]' : 'text-gray-400 hover:text-white'}`}
          >
            <span>🗺️</span>
            <span>Map</span>
          </button>
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
