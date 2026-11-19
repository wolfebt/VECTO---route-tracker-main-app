import React from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useAuth } from '../../hooks/useFirebase';
import { LogOut, User, Map, BookOpen, Cpu, Code2, Shield, Bell } from 'lucide-react';
import { enableNotifications } from '../../hooks/useNotifications';
import { useToastStore } from '../../store/useToastStore';

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

          <button
          type="button"
          onClick={async () => {
            const addToast = useToastStore.getState().addToast;
            const userId = useAppStore.getState().currentUser?.id;
            try {
              const res = await enableNotifications(userId);
              if (res.granted) {
                addToast(
                  res.platform === 'native'
                    ? 'Push notifications enabled for this device!'
                    : 'Browser dispatch notifications enabled!',
                  'success'
                );
              } else if (res.status === 'unsupported') {
                addToast('Notifications are not supported in this browser.', 'warning');
              } else {
                addToast('Notification permission was declined. Enable it in device/browser settings.', 'warning');
              }
            } catch (err) {
              console.error(err);
              addToast('Failed to configure notifications.', 'error');
            }
          }}
          className="w-full py-2.5 px-3 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg font-medium flex items-center gap-3 transition border border-white/5"
        >
          <Bell size={18} className="text-amber-400" />
          <div className="text-left flex-1">
            <div className="text-sm font-semibold">Push & Dispatch Notifications</div>
            <div className="text-[11px] text-gray-400">Enable job assignment, priority & chat alerts</div>
          </div>
        </button>

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
