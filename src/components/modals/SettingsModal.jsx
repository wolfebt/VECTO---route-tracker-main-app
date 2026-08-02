import React from 'react';
import { useAppStore } from '../../store/useAppStore';

export default function SettingsModal() {
  const { modals, closeModal, openModal, isDispatchView } = useAppStore();

  if (!modals.settings) return null;

  const handleClose = () => {
    closeModal('settings');
  };

  return (
    <div className="fixed inset-0 bg-[#0b0f19]/80 backdrop-blur-md flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div 
        className="glass-panel rounded-2xl w-full max-w-md animate-modal-enter relative overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-primary-500 to-transparent opacity-50"></div>
        <div className="p-5 border-b border-white/10 bg-slate-900/40 flex justify-between items-center">
          <h2 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-400 to-accent-400">Settings</h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-white">&times;</button>
        </div>
        <div className="p-6 space-y-4">
          <button onClick={() => { handleClose(); openModal('profile'); }} className="w-full btn-secondary py-3 flex justify-between items-center group">
            <span>Edit Profile</span>
            <span className="opacity-0 group-hover:opacity-100 transition-opacity">→</span>
          </button>
          <button onClick={() => { handleClose(); openModal('userGuide'); }} className="w-full btn-secondary py-3 flex justify-between items-center group">
            <span>User Guide</span>
            <span className="opacity-0 group-hover:opacity-100 transition-opacity">→</span>
          </button>
          <button onClick={() => { handleClose(); openModal('technicals'); }} className="w-full btn-secondary py-3 flex justify-between items-center group">
            <span>Technicals</span>
            <span className="opacity-0 group-hover:opacity-100 transition-opacity">→</span>
          </button>
          <button onClick={() => { handleClose(); openModal('development'); }} className="w-full btn-secondary py-3 flex justify-between items-center group border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:border-amber-500/50">
            <span>Development</span>
            <span className="opacity-0 group-hover:opacity-100 transition-opacity">→</span>
          </button>
          
          {isDispatchView && (
            <div className="pt-4 border-t border-white/10">
              <button onClick={() => { handleClose(); openModal('adminSettings'); }} className="w-full bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-600/30 font-semibold py-3 px-4 rounded-lg transition-all duration-300">Admin: User Roles</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
