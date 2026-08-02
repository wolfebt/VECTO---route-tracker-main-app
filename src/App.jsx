import React from 'react';
import { useAppStore } from './store/useAppStore';
import { useAuth, useCompany } from './hooks/useFirebase';
import { useUrlOnboarding } from './hooks/useUrlOnboarding';
import { useLocationSharing } from './hooks/useLocationSharing';
import Auth from './components/Auth';
import CompanySelector from './components/CompanySelector';
import Sidebar from './components/layout/Sidebar';
import MapArea from './components/layout/MapArea';
import JobDetails from './components/jobs/JobDetails';
import SettingsModal from './components/modals/SettingsModal';
import MapSettingsModal from './components/modals/MapSettingsModal';
import CreateJobModal from './components/modals/CreateJobModal';
import AdminSettingsModal from './components/modals/AdminSettingsModal';
import CompanySettingsModal from './components/modals/CompanySettingsModal';
import ProfileModal from './components/modals/ProfileModal';
import UserGuideModal from './components/modals/UserGuideModal';
import TechnicalsModal from './components/modals/TechnicalsModal';
import DevelopmentModal from './components/modals/DevelopmentModal';
import InviteModal from './components/modals/InviteModal';
import JobReportModal from './components/modals/JobReportModal';
import LogProgressModal from './components/modals/LogProgressModal';
import ToastContainer from './components/layout/ToastContainer';
import { Settings, Map, List, FileText } from 'lucide-react';
import { APIProvider } from '@vis.gl/react-google-maps';

function App() {
  const { isAuthReady, mobileView, setMobileView, showSplash, fadeSplash, setShowSplash, setFadeSplash } = useAppStore();
  const currentUser = useAppStore(state => state.currentUser);
  const companyId = useAppStore(state => state.companyId);
  const selectedJobId = useAppStore(state => state.selectedJobId);
  const setSelectedJobId = useAppStore(state => state.setSelectedJobId);
  const setActiveJobTab = useAppStore(state => state.setActiveJobTab);
  const openModal = useAppStore(state => state.openModal);
  const mapsApiKey = useAppStore(state => state.mapsApiKey);
  const routeInfo = useAppStore(state => state.routeInfo);
  
  const [weather, setWeather] = React.useState(null);

  // Splash Screen Lifecycle
  React.useEffect(() => {
    let fadeTimer;
    let hideTimer;
    if (showSplash && !fadeSplash && isAuthReady) {
      fadeTimer = setTimeout(() => {
        setFadeSplash(true);
      }, 1500); // Show splash for at least 1.5s
    } else if (showSplash && fadeSplash) {
      hideTimer = setTimeout(() => {
        setShowSplash(false);
      }, 500); // 500ms fade duration
    }
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, [showSplash, fadeSplash, isAuthReady, setFadeSplash, setShowSplash]);

  React.useEffect(() => {
    if (selectedJobId && routeInfo?.destinationCoords) {
      const { lat, lng } = routeInfo.destinationCoords;
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true&temperature_unit=fahrenheit&windspeed_unit=mph`)
        .then(res => res.json())
        .then(data => {
            if (data?.current_weather) {
                const code = data.current_weather.weathercode;
                let desc = "Clear";
                if (code >= 1 && code <= 3) desc = "Partly Cloudy";
                else if (code >= 51 && code <= 67) desc = "Rain";
                else if (code >= 71 && code <= 77) desc = "Snow";
                else if (code >= 95) desc = "Thunderstorm";
                
                setWeather({
                   temp: data.current_weather.temperature,
                   desc
                });
            }
        })
        .catch(console.error);
    } else {
      setWeather(null);
    }
  }, [routeInfo?.destinationCoords, selectedJobId]);

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

  const handleGoHome = () => {
    setSelectedJobId(null);
    setActiveJobTab('current');
    setMobileViewAndResize('sidebar');
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

  // Automatically start location sharing when app is up
  useLocationSharing();

  const splashScreen = showSplash ? (
    <div className={`fixed inset-0 z-[9999] flex items-center justify-center bg-[#0b0f19] transition-opacity duration-500 ease-in-out ${fadeSplash ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
      <h1 className="text-6xl md:text-8xl font-black vecto-brand-title tracking-widest drop-shadow-[0_0_25px_rgba(56,189,248,0.3)]">VECTO</h1>
    </div>
  ) : null;

  if (!isAuthReady) {
    return splashScreen || <div className="flex items-center justify-center min-h-screen bg-[#0b0f19]"><div className="text-white font-semibold">Loading...</div></div>;
  }

  if (!currentUser) {
    return (
      <>
        {splashScreen}
        <Auth />
      </>
    );
  }

  if (!companyId) {
    return (
      <>
        {splashScreen}
        <CompanySelector />
      </>
    );
  }

  return (
    <APIProvider apiKey={mapsApiKey || import.meta.env.VITE_GOOGLE_MAPS_API_KEY || 'AIzaSyAE5hZasEM931EdAJptCOcNAzxZT9JVvIU'}>
      {splashScreen}
      <div 
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="h-screen bg-[#0b0f19] text-white overflow-hidden font-sans relative"
      >
        {/* Thin Mobile Top Navigation Bar */}
        <div className="md:hidden fixed top-0 left-0 right-0 h-12 z-50 bg-slate-950/90 backdrop-blur-2xl border-b border-white/10 px-3 flex items-center justify-between shadow-xl">
          {/* Left: Branding */}
          <div className="flex items-center space-x-2">
            <button 
              onClick={handleGoHome}
              className="px-2 py-0.5 rounded-md border border-cyan-400/60 bg-slate-900/90 shadow-[0_0_12px_rgba(6,182,212,0.35)] hover:border-cyan-300 hover:shadow-[0_0_16px_rgba(6,182,212,0.5)] active:scale-95 transition-all cursor-pointer flex items-center group"
              title="Go to Home"
              aria-label="Go to Home"
            >
              <h1 className="text-sm font-black vecto-brand-title group-hover:brightness-110">VECTO</h1>
            </button>
          </div>

          {/* Center: Thin View Switcher Segment Control */}
          <div className="flex items-center bg-slate-900/90 border border-white/15 p-0.5 rounded-lg shadow-inner">
            <button 
              onClick={() => setMobileViewAndResize('map')}
              className={`px-3 py-1 rounded-md text-xs font-bold transition-all duration-200 flex items-center space-x-1.5 ${
                mobileView === 'map' 
                  ? 'bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-sm' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Map size={13} />
              <span>Map</span>
            </button>
            <button 
              onClick={() => setMobileViewAndResize('sidebar')}
              className={`px-3 py-1 rounded-md text-xs font-bold transition-all duration-200 flex items-center space-x-1.5 ${
                mobileView === 'sidebar' 
                  ? 'bg-gradient-to-r from-teal-500 to-emerald-600 text-white shadow-sm' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {selectedJobId ? <FileText size={13} /> : <List size={13} />}
              <span>{selectedJobId ? 'Job Info' : 'Jobs'}</span>
            </button>
          </div>

          {/* Right: Settings */}
          <div className="flex items-center space-x-2">
            {selectedJobId && weather && (
              <span className="text-yellow-400 text-xs font-medium" title={weather.desc}>
                🌡️ {weather.temp}°F
              </span>
            )}
            <button onClick={() => openModal('settings')} aria-label="Settings" className="text-gray-400 hover:text-primary-400 p-1.5 transition-colors hover:bg-white/5 rounded-full" title="Settings">
              <Settings size={18} />
            </button>
          </div>
        </div>

        {/* Carousel Slider (Mobile: 2-panel slider; Desktop: side-by-side flex) */}
        <div 
          className={`flex h-full w-[200vw] md:w-full transition-transform duration-300 ease-out pt-12 md:pt-0 ${
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
            {/* Desktop Only Sidebar Header */}
            <div className="hidden md:flex p-4 border-b border-white/10 justify-between items-center bg-slate-900/40 backdrop-blur-md shrink-0">
              <div className="flex items-center space-x-3">
                <button 
                  onClick={handleGoHome}
                  className="px-3 py-1 rounded-lg border border-cyan-400/60 bg-slate-900/90 shadow-[0_0_14px_rgba(6,182,212,0.35)] hover:border-cyan-300 hover:shadow-[0_0_20px_rgba(6,182,212,0.5)] active:scale-95 transition-all cursor-pointer flex items-center group"
                  title="Go to Home"
                  aria-label="Go to Home"
                >
                  <h1 className="text-xl font-black vecto-brand-title group-hover:brightness-110">VECTO</h1>
                </button>
                <p className="text-xs text-gray-400 font-medium">Welcome, {currentUser.name}</p>
              </div>
              <div className="flex items-center space-x-2">
                {selectedJobId && weather && (
                  <span className="text-yellow-400 text-xs font-medium mr-2" title={weather.desc}>
                    🌡️ {weather.temp}°F {weather.desc}
                  </span>
                )}
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
        
        {/* Modals */}
        <SettingsModal />
        <MapSettingsModal />
        <CreateJobModal />
        <AdminSettingsModal />
        <CompanySettingsModal />
        <ProfileModal />
        <UserGuideModal />
        <TechnicalsModal />
        <DevelopmentModal />
        <InviteModal />
        <JobReportModal />
        <LogProgressModal />
        <ToastContainer />
      </div>
    </APIProvider>
  );
}

export default App;
