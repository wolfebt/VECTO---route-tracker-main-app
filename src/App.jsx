import React from 'react';
import { useAppStore } from './store/useAppStore';
import { useAuth, useWorkspaceSync, useJobs } from './hooks/useFirebase';
import { useUrlOnboarding } from './hooks/useUrlOnboarding';
import { useLocationSharing } from './hooks/useLocationSharing';
import { useNativeDevice } from './hooks/useNativeDevice';
import { useCarAppSync } from './hooks/useCarAppSync';
import { useNotifications } from './hooks/useNotifications';
import { useGeofenceArrival } from './hooks/useGeofenceArrival';
import { useRouteWeather } from './hooks/useRouteWeather';
import Auth from './components/Auth';
import CompanySelector from './components/CompanySelector';
import Sidebar from './components/layout/Sidebar';
import MapArea from './components/layout/MapArea';
import JobDetails from './components/jobs/JobDetails';
import GeofencePromptBanner from './components/jobs/GeofencePromptBanner';
const CustomerTrackingView = React.lazy(() => import('./components/CustomerTrackingView'));
const OperationsBoard = React.lazy(() => import('./components/operations/OperationsBoard'));
const SettingsModal = React.lazy(() => import('./components/modals/SettingsModal'));
const MapSettingsModal = React.lazy(() => import('./components/modals/MapSettingsModal'));
const CreateJobModal = React.lazy(() => import('./components/modals/CreateJobModal'));
const AdminSettingsModal = React.lazy(() => import('./components/modals/AdminSettingsModal'));
const CompanySettingsModal = React.lazy(() => import('./components/modals/CompanySettingsModal'));
const ProfileModal = React.lazy(() => import('./components/modals/ProfileModal'));
const UserGuideModal = React.lazy(() => import('./components/modals/UserGuideModal'));
const TechnicalsModal = React.lazy(() => import('./components/modals/TechnicalsModal'));
const DevelopmentModal = React.lazy(() => import('./components/modals/DevelopmentModal'));
const InviteModal = React.lazy(() => import('./components/modals/InviteModal'));
const JobReportModal = React.lazy(() => import('./components/modals/JobReportModal'));
const LogProgressModal = React.lazy(() => import('./components/modals/LogProgressModal'));
const LogExpenseModal = React.lazy(() => import('./components/modals/LogExpenseModal'));
const PodCaptureModal = React.lazy(() => import('./components/modals/PodCaptureModal'));
const DriverRosterModal = React.lazy(() => import('./components/modals/DriverRosterModal'));
const ExpenseLedgerModal = React.lazy(() => import('./components/modals/ExpenseLedgerModal'));
const FleetVehiclesModal = React.lazy(() => import('./components/modals/FleetVehiclesModal'));
const DvirModal = React.lazy(() => import('./components/modals/DvirModal'));
const FleetAnalyticsModal = React.lazy(() => import('./components/modals/FleetAnalyticsModal'));
import { Settings, Map, List, FileText, LayoutDashboard } from 'lucide-react';
import { APIProvider } from '@vis.gl/react-google-maps';

const GOOGLE_MAPS_LIBRARIES = ['places'];

function AuthenticatedApp() {
  const { isAuthReady, mobileView, setMobileView, showSplash, fadeSplash, setShowSplash, setFadeSplash, mainView, setMainView } = useAppStore();
  const currentUser = useAppStore(state => state.currentUser);
  const companyId = useAppStore(state => state.companyId);
  const selectedJobId = useAppStore(state => state.selectedJobId);
  const setSelectedJobId = useAppStore(state => state.setSelectedJobId);
  const setActiveJobTab = useAppStore(state => state.setActiveJobTab);
  const openModal = useAppStore(state => state.openModal);
  const mapsApiKey = useAppStore(state => state.mapsApiKey);
  const routeInfo = useAppStore(state => state.routeInfo);
  const routeWeather = useAppStore(state => state.routeWeather);

  const [isDesktop, setIsDesktop] = React.useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 768px)').matches : true
  );

  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = (e) => setIsDesktop(e.matches);
    setIsDesktop(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Splash Screen Lifecycle
  React.useEffect(() => {
    let fadeTimer;
    let hideTimer;
    if (showSplash && !fadeSplash && isAuthReady) {
      fadeTimer = setTimeout(() => {
        setFadeSplash(true);
      }, 1500);
    } else if (showSplash && fadeSplash) {
      hideTimer = setTimeout(() => {
        setShowSplash(false);
      }, 500);
    }
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, [showSplash, fadeSplash, isAuthReady, setFadeSplash, setShowSplash]);

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

    if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2 && duration < 600) {
      if (deltaX < 0) {
        setMobileViewAndResize('sidebar');
      } else {
        setMobileViewAndResize('map');
      }
    }
    touchStartRef.current = null;
  };
  
  useAuth();
  useWorkspaceSync();
  useUrlOnboarding();
  useLocationSharing();
  useNativeDevice();

  const jobs = useJobs();
  useCarAppSync(jobs);
  useNotifications(jobs);
  useGeofenceArrival(jobs);
  useRouteWeather(selectedJobId, routeInfo, jobs);

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
    <APIProvider
      apiKey={mapsApiKey || import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''}
      libraries={GOOGLE_MAPS_LIBRARIES}
    >
      {splashScreen}
      <div 
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="h-screen bg-[#0b0f19] text-white overflow-hidden font-sans relative"
      >
        {/* Thin Mobile Top Navigation Bar */}
        <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-slate-950/90 backdrop-blur-2xl border-b border-white/10 px-3 pt-[env(safe-area-inset-top,0px)] h-[calc(3rem+env(safe-area-inset-top,0px))] flex items-center justify-between shadow-xl">
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

          <div className="flex items-center bg-slate-900/90 border border-white/15 p-0.5 rounded-lg shadow-inner">
            <button 
              onClick={() => {
                setMainView('map');
                setMobileViewAndResize('map');
              }}
              className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all duration-200 flex items-center space-x-1 ${
                mainView === 'map' && mobileView === 'map' 
                  ? 'bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-sm' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Map size={13} />
              <span>Map</span>
            </button>
            <button 
              onClick={() => {
                setMainView('map');
                setMobileViewAndResize('sidebar');
              }}
              className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all duration-200 flex items-center space-x-1 ${
                mainView === 'map' && mobileView === 'sidebar' 
                  ? 'bg-gradient-to-r from-teal-500 to-emerald-600 text-white shadow-sm' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {selectedJobId ? <FileText size={13} /> : <List size={13} />}
              <span>{selectedJobId ? 'Info' : 'Jobs'}</span>
            </button>
            <button 
              onClick={() => setMainView(mainView === 'operations' ? 'map' : 'operations')}
              className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all duration-200 flex items-center space-x-1 ${
                mainView === 'operations'
                  ? 'bg-gradient-to-r from-purple-500 to-indigo-600 text-white shadow-sm' 
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Toggle Operations Board"
            >
              <LayoutDashboard size={13} />
              <span>Ops</span>
            </button>
          </div>

          <div className="flex items-center space-x-2">
            {selectedJobId && routeWeather?.hazards?.length > 0 && (
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                  routeWeather.highestSeverity === 'critical'
                    ? 'bg-rose-500/20 border-rose-500/50 text-rose-300'
                    : 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                }`}
                title={routeWeather.hazards.map((h) => `${h.title} (${h.segment})`).join(' • ')}
              >
                ⚠️ {routeWeather.hazards.length}
              </span>
            )}
            {selectedJobId && routeWeather?.destinationWeather && (
              <span className="text-yellow-400 text-xs font-medium" title={routeWeather.destinationWeather.desc}>
                🌡️ {Math.round(routeWeather.destinationWeather.temp)}°F
              </span>
            )}
            <button onClick={() => openModal('settings')} aria-label="Settings" className="text-gray-400 hover:text-primary-400 p-1.5 transition-colors hover:bg-white/5 rounded-full" title="Settings">
              <Settings size={18} />
            </button>
          </div>
        </div>

        {/* Main Content Area */}
        {mainView === 'operations' ? (
          <div className="h-full pt-[calc(3rem+env(safe-area-inset-top,0px))] md:pt-0">
            <React.Suspense
              fallback={
                <div className="flex h-full items-center justify-center bg-[#0b0f19] text-slate-400 text-xs">
                  Loading Operations Board...
                </div>
              }
            >
              <OperationsBoard />
            </React.Suspense>
          </div>
        ) : (
          <div 
            className={`flex h-full w-[200vw] md:w-full transition-transform duration-300 ease-out pt-[calc(3rem+env(safe-area-inset-top,0px))] md:pt-0 ${
              mobileView === 'sidebar' ? '-translate-x-[100vw] md:translate-x-0' : 'translate-x-0'
            }`}
          >
            {/* Panel 1: Map Area */}
            <div className="w-[100vw] md:w-auto md:flex-1 relative z-0 h-full shrink-0 md:shrink">
              <MapArea />
              {selectedJobId && isDesktop && <JobDetails />}
            </div>
            
            {/* Panel 2: Job Info & Sidebar */}
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
                  <button 
                    onClick={() => setMainView('operations')}
                    className="px-2.5 py-1 rounded-lg border text-xs font-bold transition-all flex items-center space-x-1 cursor-pointer shadow-sm bg-slate-800/80 hover:bg-slate-700 text-purple-300 border-purple-500/30 hover:border-purple-500/60"
                    title="Open Operations Board"
                  >
                    <LayoutDashboard size={13} className="text-purple-400" />
                    <span>Ops Board</span>
                  </button>
                  {selectedJobId && routeWeather?.hazards?.length > 0 && (
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-bold border ${
                        routeWeather.highestSeverity === 'critical'
                          ? 'bg-rose-500/20 border-rose-500/50 text-rose-300'
                          : 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                      }`}
                      title={routeWeather.hazards.map((h) => `${h.title} (${h.segment})`).join(' • ')}
                    >
                      ⚠️ {routeWeather.hazards.length} Hazard{routeWeather.hazards.length > 1 ? 's' : ''}
                    </span>
                  )}
                  {selectedJobId && routeWeather?.destinationWeather && (
                    <span className="text-yellow-400 text-xs font-medium mr-2" title={routeWeather.destinationWeather.desc}>
                      🌡️ {Math.round(routeWeather.destinationWeather.temp)}°F {routeWeather.destinationWeather.desc}
                    </span>
                  )}
                  <button onClick={() => openModal('settings')} aria-label="Settings" className="text-gray-400 hover:text-primary-400 p-2 transition-colors hover:bg-white/5 rounded-full" title="Settings">
                    <Settings size={20} />
                  </button>
                </div>
              </div>

              {/* Single-mount responsive Content Container */}
              <div className="flex-1 overflow-y-auto relative flex flex-col min-h-0">
                {!isDesktop && selectedJobId ? (
                  <div className="h-full flex flex-col flex-1">
                    <JobDetails />
                  </div>
                ) : (
                  <div className="h-full md:p-4 overflow-y-auto flex flex-col flex-1">
                    <Sidebar />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        
        {/* Modals */}
        <React.Suspense fallback={null}>
          <SettingsModal />
          <MapSettingsModal />
          <CreateJobModal />
          <AdminSettingsModal />
          <CompanySettingsModal />
          <DriverRosterModal />
          <ExpenseLedgerModal />
          <FleetVehiclesModal />
          <DvirModal />
          <FleetAnalyticsModal />
          <ProfileModal />
          <UserGuideModal />
          <TechnicalsModal />
          <DevelopmentModal />
          <InviteModal />
          <JobReportModal />
          <LogProgressModal />
          <LogExpenseModal />
          <PodCaptureModal />
        </React.Suspense>
        <GeofencePromptBanner />
      </div>
    </APIProvider>
  );
}

function App() {
  const trackToken = React.useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get('track') || '';
    } catch {
      return '';
    }
  }, []);

  if (trackToken) {
    return (
      <React.Suspense
        fallback={
          <div className="flex h-screen items-center justify-center bg-[#0b0f19] text-slate-400 text-xs">
            Loading Live Tracking...
          </div>
        }
      >
        <CustomerTrackingView token={trackToken} />
      </React.Suspense>
    );
  }

  return <AuthenticatedApp />;
}

export default App;
