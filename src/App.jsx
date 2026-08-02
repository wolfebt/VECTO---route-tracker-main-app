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
import { Settings, Map, List, FileText } from 'lucide-react';
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

  const setMobileViewAndResize = (view) => {
    setMobileView(view);
    if (view === 'map') {
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 300);
    }
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
      if (deltaX < 0) {
        // Swipe Left (finger drags right to left) -> Slide to Right Panel (Job Info / Sidebar)
        setMobileViewAndResize('sidebar');
      } else {
        // Swipe Right (finger drags left to right) -> Slide to Left Panel (Map)
        setMobileViewAndResize('map');
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
    <APIProvider apiKey={mapsApiKey || import.meta.env.VITE_GOOGLE_MAPS_API_KEY || 'AIzaSyAE5hZasEM931EdAJptCOcNAzxZT9JVvIU'}>
      <div 
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="h-screen bg-[#0b0f19] text-white overflow-hidden font-sans relative"
      >
        {/* Carousel Slider (Mobile: 2-panel slider; Desktop: side-by-side flex) */}
        <div 
          className={`flex h-full w-[200vw] md:w-full transition-transform duration-300 ease-out ${
            mobileView === 'sidebar' ? '-translate-x-[100vw] md:translate-x-0' : 'translate-x-0'
          }`}
        >
          {/* Panel 1 (Left Side on Mobile / Main Map on Desktop): Map Area */}
          <div className="w-[100vw] md:w-auto md:flex-1 relative z-0 h-full shrink-0 md:shrink">
            <MapArea />
            {selectedJobId && (
              <div className="hidden md:block">
                <JobDetails />
              </div>
            )}
          </div>
          
          {/* Panel 2 (Right Side on Mobile / Right Sidebar on Desktop): Job Info & Sidebar */}
          <div className="w-[100vw] md:w-96 glass-panel z-10 shrink-0 relative h-full flex flex-col border-l border-white/5 shadow-[-10px_0_30px_rgba(0,0,0,0.5)]">
            <div className="p-5 border-b border-white/10 flex justify-between items-center bg-slate-900/40 backdrop-blur-md shrink-0">
              <div>
                <h1 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-400 to-accent-400">Vecto</h1>
                <p className="text-xs text-gray-400 font-medium">Welcome, {currentUser.name}</p>
              </div>
              <div className="flex items-center space-x-2">
                <button onClick={() => openModal('settings')} aria-label="Settings" className="text-gray-400 hover:text-primary-400 p-2 transition-colors hover:bg-white/5 rounded-full" title="Settings">
                  <Settings size={20} />
                </button>
              </div>
            </div>

            {/* Content Container */}
            <div className="flex-1 overflow-y-auto relative flex flex-col min-h-0">
              {/* Mobile View: JobDetails if selected, else Sidebar */}
              <div className="md:hidden h-full flex flex-col flex-1">
                {selectedJobId ? <JobDetails /> : <Sidebar />}
              </div>
              {/* Desktop View: Always Sidebar */}
              <div className="hidden md:block h-full p-4 overflow-y-auto">
                <Sidebar />
              </div>
            </div>
          </div>
        </div>

        {/* Floating View Switcher Pills in Header on Mobile */}
        <div className="md:hidden fixed top-3 left-1/2 -translate-x-1/2 z-50 flex items-center bg-slate-950/85 backdrop-blur-xl border border-white/10 p-0.5 rounded-full shadow-lg space-x-0.5">
          <button 
            onClick={() => setMobileViewAndResize('map')}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all flex items-center space-x-1 ${
              mobileView === 'map' 
                ? 'bg-primary-600 text-white shadow-[0_0_8px_rgba(14,165,233,0.5)]' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Map size={13} />
            <span>Map</span>
          </button>
          <button 
            onClick={() => setMobileViewAndResize('sidebar')}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all flex items-center space-x-1 ${
              mobileView === 'sidebar' 
                ? 'bg-primary-600 text-white shadow-[0_0_8px_rgba(14,165,233,0.5)]' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {selectedJobId ? <FileText size={13} /> : <List size={13} />}
            <span>{selectedJobId ? 'Job Info' : 'List'}</span>
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
