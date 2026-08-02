import React from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useToastStore } from '../../store/useToastStore';
import JobsList from '../jobs/JobsList';
import DriversList from '../jobs/DriversList';
import { QrCode, Share2, Building2 } from 'lucide-react';

export default function Sidebar() {
  const isDispatchView = useAppStore(state => state.isDispatchView);
  const activeJobTab = useAppStore(state => state.activeJobTab);
  const setActiveJobTab = useAppStore(state => state.setActiveJobTab);
  const companyName = useAppStore(state => state.companyName);
  const companyId = useAppStore(state => state.companyId);
  const selectedJobId = useAppStore(state => state.selectedJobId);
  const openModal = useAppStore(state => state.openModal);
  const clearCompany = useAppStore(state => state.clearCompany);
  const addToast = useToastStore((state) => state.addToast);

  const handleShareTeamMap = async () => {
    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    let shareUrl = `${baseUrl}?company=${companyId || ''}`;
    if (selectedJobId) {
      shareUrl += `&job=${selectedJobId}`;
    }

    const shareData = {
      title: 'Vecto Route Tracker - Team Map & Job',
      text: selectedJobId ? 'View live team map & job pins on Vecto' : 'View live team map & driver pins on Vecto',
      url: shareUrl
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        addToast("Team map & job link shared!", "success");
        return;
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.warn("Share error:", err);
        } else return;
      }
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      addToast("Team map & job link copied to clipboard!", "success");
    } catch (err) {
      console.error(err);
      addToast("Failed to copy link.", "error");
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-900/50 backdrop-blur-md">
      <div className="mb-6 p-4">
        <h2 className="text-xs font-bold text-primary-400 uppercase tracking-widest mb-3">Company Workspace</h2>
        <div className="grid grid-cols-6 gap-2">
          <div 
            onClick={() => openModal('companySettings')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if(e.key === 'Enter' || e.key === ' ') openModal('companySettings'); }}
            aria-label="Company Settings"
            className="col-span-3 flex justify-between items-center bg-white/5 border border-white/5 p-2.5 rounded-xl cursor-pointer hover:bg-white/10 hover:border-white/10 transition-all duration-300 group shadow-sm focus-visible:ring-2 focus-visible:ring-primary-500"
            title="Company Settings"
          >
            <span className="font-semibold text-gray-200 group-hover:text-white transition-colors truncate text-xs">{companyName}</span>
            <span className="text-[10px] uppercase tracking-wider text-gray-400 group-hover:text-primary-400 transition-colors bg-black/20 px-1.5 py-0.5 rounded shrink-0">Settings</span>
          </div>
          <button 
            onClick={clearCompany}
            className="col-span-1 bg-amber-600/20 border border-amber-500/30 text-amber-400 hover:bg-amber-600/30 rounded-xl flex items-center justify-center transition-colors cursor-pointer"
            title="Switch Fleet / Change Company"
            aria-label="Switch Fleet / Change Company"
          >
            <Building2 size={18} />
          </button>
          <button 
            onClick={handleShareTeamMap}
            className="col-span-1 bg-sky-600/20 border border-sky-500/30 text-sky-400 hover:bg-sky-600/30 rounded-xl flex items-center justify-center transition-colors cursor-pointer"
            title="Share Team Map & Job Link"
            aria-label="Share Team Map & Job Link"
          >
            <Share2 size={18} />
          </button>
          <button 
            onClick={() => openModal('invite')}
            className="col-span-1 bg-teal-600/20 border border-teal-500/30 text-teal-400 hover:bg-teal-600/30 rounded-xl flex items-center justify-center transition-colors cursor-pointer"
            title="Invite & Onboard Team (QR Code)"
            aria-label="Invite & Onboard Team (QR Code)"
          >
            <QrCode size={18} />
          </button>
        </div>
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
