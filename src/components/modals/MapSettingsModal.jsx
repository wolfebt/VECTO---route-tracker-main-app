import React from 'react';
import { useAppStore } from '../../store/useAppStore';
import { Map, Activity, Layers, Check } from 'lucide-react';

export default function MapSettingsModal() {
  const { modals, closeModal, routeStyle, setRouteStyle, showTrafficLayer, setShowTrafficLayer } = useAppStore();

  if (!modals.mapSettings) return null;

  const handleClose = () => {
    closeModal('mapSettings');
  };

  const ROUTE_OPTIONS = [
    {
      id: 'alternating',
      title: 'Alternating Fade',
      icon: '🔄',
      badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
      description: 'Smooth fade transition between driver color & map road view for optimal route visibility'
    },
    {
      id: 'outlined',
      title: 'Outline Path',
      icon: '🛣️',
      badgeColor: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
      description: 'Transparent center core with solid colored border edges showing underlying road text'
    },
    {
      id: 'traffic',
      title: 'Traffic Status',
      icon: '🚦',
      badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
      description: 'Dynamic color coding along route segments based on real-time traffic speeds (Green, Orange, Red)'
    },
    {
      id: 'solid',
      title: 'Solid Line',
      icon: '🟦',
      badgeColor: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
      description: 'Classic solid high-visibility route line overlay'
    }
  ];

  return (
    <div className="fixed inset-0 bg-[#0b0f19]/80 backdrop-blur-md flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div 
        className="glass-panel rounded-2xl shadow-2xl w-full max-w-md border border-white/10 p-6 animate-modal-enter relative overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 via-primary-500 to-indigo-500"></div>

        <div className="flex justify-between items-center mb-5 pb-3 border-b border-white/10">
          <div>
            <h3 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-400 to-accent-400 flex items-center gap-2">
              <Map className="text-primary-400" size={22} />
              Map & Route Settings
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">Customize route visualization style and map overlays</p>
          </div>
          <button onClick={handleClose} className="text-gray-400 hover:text-white text-xl font-bold p-1 cursor-pointer">
            &times;
          </button>
        </div>

        <div className="space-y-5">
          {/* Section 1: Route View Overlay Mode */}
          <div>
            <label className="block text-xs font-bold text-primary-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Layers size={14} />
              Route View Overlay Style
            </label>
            <div className="grid grid-cols-1 gap-2.5">
              {ROUTE_OPTIONS.map((option) => {
                const isSelected = routeStyle === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setRouteStyle(option.id)}
                    className={`w-full p-3 rounded-xl border text-left transition-all duration-200 cursor-pointer flex items-start gap-3 ${
                      isSelected
                        ? 'bg-primary-500/15 border-primary-500/50 shadow-md shadow-primary-950/50 ring-1 ring-primary-400/40'
                        : 'bg-slate-900/40 border-white/5 hover:bg-slate-800/60 hover:border-white/15'
                    }`}
                  >
                    <span className="text-xl shrink-0 mt-0.5">{option.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className={`text-sm font-bold ${isSelected ? 'text-white' : 'text-gray-200'}`}>
                          {option.title}
                        </span>
                        {isSelected && (
                          <span className="w-5 h-5 rounded-full bg-primary-500 text-white flex items-center justify-center text-xs shrink-0">
                            <Check size={12} strokeWidth={3} />
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-1 leading-snug">
                        {option.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 2: Live Traffic Overlay */}
          <div className="pt-3 border-t border-white/10">
            <div className="flex items-center justify-between bg-slate-900/50 p-3.5 rounded-xl border border-white/5">
              <div className="flex items-center space-x-3">
                <div className={`p-2 rounded-lg ${showTrafficLayer ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-800 text-gray-400'}`}>
                  <Activity size={18} />
                </div>
                <div>
                  <span className="text-xs font-bold text-gray-200 block">Live Traffic Layer</span>
                  <span className="text-[11px] text-gray-400">Display Google Maps real-time traffic conditions</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowTrafficLayer(!showTrafficLayer)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  showTrafficLayer ? 'bg-emerald-500' : 'bg-gray-700'
                }`}
                role="switch"
                aria-checked={showTrafficLayer}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    showTrafficLayer ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-5 border-t border-white/10 mt-6">
          <button 
            type="button" 
            onClick={handleClose}
            className="btn-primary text-xs px-5 py-2.5 font-bold cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
