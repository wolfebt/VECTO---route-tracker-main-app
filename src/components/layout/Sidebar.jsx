import React from 'react';
import { useAppStore } from '../../store/useAppStore';
import JobsList from '../jobs/JobsList';
import DriversList from '../jobs/DriversList';
import { useLocationSharing } from '../../hooks/useLocationSharing';
import { useToastStore } from '../../store/useToastStore';
import { MapPin, Cloud } from 'lucide-react';

export default function Sidebar() {
  const isDispatchView = useAppStore(state => state.isDispatchView);
  const activeJobTab = useAppStore(state => state.activeJobTab);
  const setActiveJobTab = useAppStore(state => state.setActiveJobTab);
  const companyName = useAppStore(state => state.companyName);
  const openModal = useAppStore(state => state.openModal);
  const addToast = useToastStore(state => state.addToast);
  
  const { isSharingLocation, toggleLocationSharing } = useLocationSharing();
  const [isCheckingWeather, setIsCheckingWeather] = React.useState(false);

  const handleCheckWeather = () => {
    if (!navigator.geolocation) {
      addToast("Geolocation is not supported by your browser.", "error");
      return;
    }
    setIsCheckingWeather(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const weatherPromise = fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&temperature_unit=fahrenheit&windspeed_unit=mph`)
          .then(res => res.json());
          
        const alertsPromise = Promise.race([
          fetch(`https://api.weather.gov/alerts/active?point=${latitude},${longitude}`).then(res => res.ok ? res.json() : { features: [] }),
          new Promise(resolve => setTimeout(() => resolve({ features: [] }), 3000))
        ]).catch(() => ({ features: [] }));

        Promise.all([weatherPromise, alertsPromise])
          .then(([weatherData, alertsData]) => {
            if (weatherData?.current_weather) {
              const code = weatherData.current_weather.weathercode;
              let desc = "Clear";
              if (code >= 1 && code <= 3) desc = "Partly Cloudy";
              else if (code >= 51 && code <= 67) desc = "Rain";
              else if (code >= 71 && code <= 77) desc = "Snow";
              else if (code >= 95) desc = "Thunderstorm";
              
              let toastMsg = `Current Weather: ${weatherData.current_weather.temperature}°F, ${desc}`;
              let toastType = "info";
              
              // Process alerts
              const alerts = alertsData?.features || [];
              if (alerts.length > 0) {
                 const alertTitles = alerts.map(a => a.properties.event).join(", ");
                 toastMsg += ` | ⚠️ Alerts: ${alertTitles}`;
                 toastType = "warning";
              }
              
              addToast(toastMsg, toastType);
            } else {
              addToast("Could not fetch weather data.", "error");
            }
          })
          .catch(err => {
            console.error(err);
            addToast("Failed to fetch weather.", "error");
          })
          .finally(() => setIsCheckingWeather(false));
      },
      (err) => {
        console.warn(err);
        addToast("Could not get your location for weather.", "error");
        setIsCheckingWeather(false);
      },
      { enableHighAccuracy: false, maximumAge: 300000, timeout: 5000 }
    );
  };

  return (
    <div className="flex flex-col h-full bg-slate-900/50 backdrop-blur-md">
      <div className="mb-6 p-4">
        <h2 className="text-xs font-bold text-primary-400 uppercase tracking-widest mb-3">Company Workspace</h2>
        <div 
          onClick={() => openModal('companySettings')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if(e.key === 'Enter' || e.key === ' ') openModal('companySettings'); }}
          aria-label="Company Settings"
          className="flex justify-between items-center bg-white/5 border border-white/5 p-3 rounded-xl cursor-pointer hover:bg-white/10 hover:border-white/10 transition-all duration-300 group shadow-sm focus-visible:ring-2 focus-visible:ring-primary-500"
          title="Company Settings"
        >
          <span className="font-semibold text-gray-200 group-hover:text-white transition-colors">{companyName}</span>
          <span className="text-xs uppercase tracking-wider text-gray-400 group-hover:text-primary-400 transition-colors bg-black/20 px-2 py-1 rounded">Settings</span>
        </div>
      </div>
      
      {/* Driver Controls */}
      <div className="mb-6 px-4 space-y-3">
         <button 
           onClick={toggleLocationSharing} 
           className={`w-full flex items-center justify-center font-bold py-2.5 px-4 rounded-xl shadow-sm transition-all duration-300 border ${isSharingLocation ? 'bg-accent-600/20 text-accent-400 border-accent-500/30 hover:bg-accent-600/30' : 'bg-white/5 text-gray-300 border-white/10 hover:bg-white/10'}`}
         >
           <MapPin size={16} className={`mr-2 ${isSharingLocation ? 'animate-bounce' : ''}`} />
           {isSharingLocation ? 'Location Sharing ON' : 'Share Location'}
         </button>

         <button 
           onClick={handleCheckWeather} 
           disabled={isCheckingWeather}
           className="w-full flex items-center justify-center font-bold py-2.5 px-4 rounded-xl shadow-sm transition-all duration-300 border bg-white/5 text-gray-300 border-white/10 hover:bg-white/10 disabled:opacity-50"
         >
           <Cloud size={16} className={`mr-2 ${isCheckingWeather ? 'animate-pulse' : ''}`} />
           {isCheckingWeather ? 'Checking...' : 'Check Weather'}
         </button>
      </div>

      {isDispatchView && (
        <div className="mb-6 px-4">
          <h2 className="text-xs font-bold text-primary-400 uppercase tracking-widest mb-3">Management</h2>
          <button onClick={() => openModal('createJob')} className="w-full btn-primary flex items-center justify-center space-x-2">
            <span className="text-xl leading-none">+</span>
            <span>Create New Job</span>
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-white/10 mb-4 mx-4 relative">
        <button 
          className={`flex-1 py-3 text-sm text-center transition-colors duration-300 ${activeJobTab === 'current' ? 'text-primary-400 font-bold' : 'text-gray-500 hover:text-gray-300 font-medium'}`}
          onClick={() => setActiveJobTab('current')}
        >
          Active Jobs
        </button>
        <button 
          className={`flex-1 py-3 text-sm text-center transition-colors duration-300 ${activeJobTab === 'archive' ? 'text-primary-400 font-bold' : 'text-gray-500 hover:text-gray-300 font-medium'}`}
          onClick={() => setActiveJobTab('archive')}
        >
          Archived
        </button>
        {/* Animated Pill Indicator */}
        <div 
          className="absolute bottom-0 left-0 h-0.5 bg-primary-500 transition-transform duration-300 ease-out shadow-[0_0_8px_rgba(14,165,233,0.8)]"
          style={{ width: '50%', transform: `translateX(${activeJobTab === 'current' ? '0%' : '100%'})` }}
        ></div>
      </div>
      
      {/* Search */}
      <div className="px-4 mb-4">
        <input 
          type="text" 
          placeholder="Search jobs..." 
          className="glass-input text-sm py-2 rounded-full px-5"
        />
      </div>

      {/* Lists Container */}
      <div className="flex-1 overflow-y-auto min-h-0 space-y-8 px-4 pb-4">
        <div>
          <h2 className="text-xs font-bold text-primary-400 uppercase tracking-widest mb-3 sticky top-0 bg-slate-900/90 backdrop-blur-sm py-2 z-10 border-b border-white/5">Jobs</h2>
          <JobsList />
        </div>
        
        {isDispatchView && (
          <div>
            <h2 className="text-xs font-bold text-accent-400 uppercase tracking-widest mb-3 sticky top-0 bg-slate-900/90 backdrop-blur-sm py-2 z-10 border-b border-white/5">Active Drivers</h2>
            <DriversList />
          </div>
        )}
      </div>
    </div>
  );
}
