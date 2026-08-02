import React from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useAuth } from '../../hooks/useFirebase';
import { LogOut, User, Map, BookOpen, Cpu, Code2, Shield } from 'lucide-react';

export default function SettingsModal() {
  const { modals, closeModal, openModal, isDispatchView } = useAppStore();
  const { logout } = useAuth();

  if (!modals.settings) return null;

  const handleClose = () => {
    closeModal('settings');
  };

  const handleLogout = async () => {
    handleClose();
    await logout();
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
          <button onClick={handleClose} className="text-gray-400 hover:text-white cursor-pointer">&times;</button>
        </div>
        <div className="p-6 space-y-3">
          <button onClick={() => { handleClose(); openModal('profile'); }} className="w-full btn-secondary py-3 px-4 flex justify-between items-center group cursor-pointer">
            <div className="flex items-center space-x-3">
              <User size={18} className="text-gray-400 group-hover:text-primary-400 transition-colors" />
              <span>Edit Profile</span>
            </div>
            <span className="opacity-0 group-hover:opacity-100 transition-opacity">→</span>
          </button>

          <button onClick={() => { handleClose(); openModal('mapSettings'); }} className="w-full btn-secondary py-3 px-4 flex justify-between items-center group cursor-pointer">
            <div className="flex items-center space-x-3">
              <Map size={18} className="text-gray-400 group-hover:text-primary-400 transition-colors" />
              <span>Map & Route Settings</span>
            </div>
            <span className="opacity-0 group-hover:opacity-100 transition-opacity">→</span>
          </button>

          <button onClick={() => { handleClose(); openModal('userGuide'); }} className="w-full btn-secondary py-3 px-4 flex justify-between items-center group cursor-pointer">
            <div className="flex items-center space-x-3">
              <BookOpen size={18} className="text-gray-400 group-hover:text-primary-400 transition-colors" />
              <span>User Guide</span>
            </div>
            <span className="opacity-0 group-hover:opacity-100 transition-opacity">→</span>
          </button>

          <button onClick={() => { handleClose(); openModal('technicals'); }} className="w-full btn-secondary py-3 px-4 flex justify-between items-center group cursor-pointer">
            <div className="flex items-center space-x-3">
              <Cpu size={18} className="text-gray-400 group-hover:text-primary-400 transition-colors" />
              <span>Technicals</span>
            </div>
            <span className="opacity-0 group-hover:opacity-100 transition-opacity">→</span>
          </button>

          <button onClick={() => { handleClose(); openModal('development'); }} className="w-full btn-secondary py-3 px-4 flex justify-between items-center group border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:border-amber-500/50 cursor-pointer">
            <div className="flex items-center space-x-3">
              <Code2 size={18} className="text-amber-400" />
              <span>Development</span>
            </div>
            <span className="opacity-0 group-hover:opacity-100 transition-opacity">→</span>
          </button>
          
          {isDispatchView && (
            <button onClick={() => { handleClose(); openModal('adminSettings'); }} className="w-full bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-600/30 font-semibold py-3 px-4 rounded-lg transition-all duration-300 flex items-center justify-between group cursor-pointer">
              <div className="flex items-center space-x-3">
                <Shield size={18} className="text-indigo-400" />
                <span>Admin: User Roles</span>
              </div>
              <span className="opacity-0 group-hover:opacity-100 transition-opacity">→</span>
            </button>
          )}

          <div className="pt-3 border-t border-white/10">
            <button 
              onClick={handleLogout} 
              className="w-full bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 hover:border-red-500/50 font-semibold py-3 px-4 rounded-lg transition-all duration-300 flex items-center justify-between group cursor-pointer"
            >
              <div className="flex items-center space-x-3">
                <LogOut size={18} className="text-red-400" />
                <span>Log Out</span>
              </div>
              <span className="opacity-0 group-hover:opacity-100 transition-opacity">→</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
