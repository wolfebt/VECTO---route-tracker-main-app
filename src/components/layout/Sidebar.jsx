import React, { useState } from 'react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAppStore } from '../../store/useAppStore';
import { useToastStore } from '../../store/useToastStore';
import { useInspections, useVehicles } from '../../hooks/useFirebase';
import { getPublicAppBaseUrl } from '../../utils/formatters';
import { isVehicleServiceDue } from '../../utils/vehicles';
import JobsList from '../jobs/JobsList';
import DriversList from '../jobs/DriversList';
import { QrCode, Share2, Users, DollarSign, LayoutDashboard, Radio, X, Truck, ClipboardCheck, BarChart3 } from 'lucide-react';

export default function Sidebar() {
  const isDispatchView = useAppStore(state => state.isDispatchView);
  const currentUser = useAppStore(state => state.currentUser);
  const members = useAppStore(state => state.members);
  const mainView = useAppStore(state => state.mainView);
  const setMainView = useAppStore(state => state.setMainView);
  const activeJobTab = useAppStore(state => state.activeJobTab);
  const setActiveJobTab = useAppStore(state => state.setActiveJobTab);
  const jobSearchQuery = useAppStore(state => state.jobSearchQuery);
  const setJobSearchQuery = useAppStore(state => state.setJobSearchQuery);
  const jobFilter = useAppStore(state => state.jobFilter);
  const setJobFilter = useAppStore(state => state.setJobFilter);
  const isSharingLocation = useAppStore(state => state.isSharingLocation);
  const setIsSharingLocation = useAppStore(state => state.setIsSharingLocation);
  const companyName = useAppStore(state => state.companyName);
  const companyId = useAppStore(state => state.companyId);
  const selectedJobId = useAppStore(state => state.selectedJobId);
  const openModal = useAppStore(state => state.openModal);
  const addToast = useToastStore((state) => state.addToast);
  const [updatingDuty, setUpdatingDuty] = useState(false);
  const vehicles = useVehicles();
  const inspections = useInspections();
  const openDefectCount = inspections.filter((i) => i.overallStatus !== 'safe' && !i.mechanicResolved).length;
  const serviceDueCount = vehicles.filter(isVehicleServiceDue).length;

  const myMember = members.find(m => m.id === currentUser?.id);
  const myDutyStatus = myMember?.onDutyStatus || 'on_duty';

  const handleSelfDutyChange = async (nextDuty) => {
    if (!companyId || !currentUser?.id || updatingDuty || nextDuty === myDutyStatus) return;
    setUpdatingDuty(true);
    try {
      await updateDoc(doc(db, `companies/${companyId}/members/${currentUser.id}`), {
        onDutyStatus: nextDuty,
        updatedAt: serverTimestamp()
      });
      const label = nextDuty === 'on_duty' ? 'On Duty' : nextDuty === 'break' ? 'On Break' : 'Off Duty';
      addToast(`Duty status set to ${label}`, 'success');
    } catch (err) {
      console.error('Failed to update duty status:', err);
      addToast('Could not update duty status', 'error');
    }
    setUpdatingDuty(false);
  };

  const handleShareTeamMap = async () => {
    const baseUrl = getPublicAppBaseUrl();
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
      <div className="mb-4 p-4">
        <h2 className="text-xs font-bold text-primary-400 uppercase tracking-widest mb-3">Company Workspace</h2>
        <div className="grid grid-cols-6 gap-2">
          <div 
            onClick={() => openModal('companySettings')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if(e.key === 'Enter' || e.key === ' ') openModal('companySettings'); }}
            aria-label="Company Settings"
            className="col-span-4 flex justify-between items-center bg-white/5 border border-white/5 p-3 rounded-xl cursor-pointer hover:bg-white/10 hover:border-white/10 transition-all duration-300 group shadow-sm focus-visible:ring-2 focus-visible:ring-primary-500"
            title="Company Settings"
          >
            <span className="font-semibold text-gray-200 group-hover:text-white transition-colors truncate">{companyName}</span>
            <span className="text-xs uppercase tracking-wider text-gray-400 group-hover:text-primary-400 transition-colors bg-black/20 px-2 py-1 rounded shrink-0">Settings</span>
          </div>
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

        {/* Driver Live GPS Sharing Toggle & My Expenses */}
        {!isDispatchView && (
          <div className="mt-3 space-y-2">
            <button
              type="button"
              onClick={() => setIsSharingLocation(!isSharingLocation)}
              className={`w-full py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-between transition-all cursor-pointer ${
                isSharingLocation
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/20'
                  : 'bg-slate-800/70 border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600'
              }`}
            >
              <span className="flex items-center space-x-2">
                <span className="relative flex h-2.5 w-2.5">
                  {isSharingLocation && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  )}
                  <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isSharingLocation ? 'bg-emerald-400' : 'bg-slate-500'}`}></span>
                </span>
                <span>{isSharingLocation ? 'Sharing Live GPS — Tap to Pause' : 'GPS Sharing Paused — Tap to Resume'}</span>
              </span>
              <Radio size={14} className={isSharingLocation ? 'text-emerald-400' : 'text-slate-500'} />
            </button>

            <div className="bg-slate-800/60 border border-slate-700/80 rounded-xl p-1.5">
              <div className="flex items-center justify-between px-1.5 mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Duty Status</span>
                <span className={`text-[10px] font-bold ${
                  myDutyStatus === 'on_duty'
                    ? 'text-emerald-400'
                    : myDutyStatus === 'break'
                    ? 'text-amber-400'
                    : 'text-slate-400'
                }`}>
                  {myDutyStatus === 'on_duty' ? 'Active' : myDutyStatus === 'break' ? 'Break' : 'Offline'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {[
                  { id: 'on_duty', label: 'On Duty', activeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
                  { id: 'break', label: 'On Break', activeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
                  { id: 'off_duty', label: 'Off Duty', activeClass: 'bg-slate-700 text-slate-200 border-slate-500' }
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={updatingDuty}
                    onClick={() => handleSelfDutyChange(opt.id)}
                    className={`py-1.5 px-1 rounded-lg text-[11px] font-bold border transition-all cursor-pointer disabled:opacity-60 ${
                      myDutyStatus === opt.id
                        ? opt.activeClass
                        : 'bg-slate-900/50 text-slate-400 border-transparent hover:text-slate-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => openModal('expenseLedger')}
              className="w-full py-2 px-3 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-xs font-bold text-orange-300 flex items-center justify-center space-x-1.5 transition-colors cursor-pointer shadow-sm"
            >
              <DollarSign size={14} className="text-orange-400" />
              <span>My Expenses & Reimbursements</span>
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => openModal('dvir')}
                className="py-2 px-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-[11px] font-bold text-teal-300 flex items-center justify-center space-x-1.5 transition-colors cursor-pointer shadow-sm"
              >
                <ClipboardCheck size={14} className="text-teal-400" />
                <span>Pre/Post DVIR</span>
              </button>
              <button
                type="button"
                onClick={() => openModal('fleetVehicles')}
                className="py-2 px-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-[11px] font-bold text-sky-300 flex items-center justify-center space-x-1.5 transition-colors cursor-pointer shadow-sm"
              >
                <Truck size={14} className="text-sky-400" />
                <span>Fleet Units</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {isDispatchView && (
        <div className="mb-5 px-4 space-y-2">
          <h2 className="text-xs font-bold text-primary-400 uppercase tracking-widest mb-2">Management</h2>
          <button onClick={() => openModal('createJob')} className="w-full btn-primary flex items-center justify-center space-x-2">
            <span className="text-xl leading-none">+</span>
            <span>Create New Job</span>
          </button>
          
          <button 
            onClick={() => setMainView(mainView === 'operations' ? 'map' : 'operations')}
            className={`w-full flex items-center justify-center space-x-2 py-2 px-3 rounded-xl border text-xs font-bold transition-all shadow-sm cursor-pointer ${
              mainView === 'operations'
                ? 'bg-purple-600/30 text-purple-300 border-purple-500/50 shadow-[0_0_12px_rgba(168,85,247,0.3)]'
                : 'bg-slate-800/80 hover:bg-slate-700/80 text-purple-300 border-slate-700 hover:border-purple-500/40'
            }`}
          >
            <LayoutDashboard size={14} className="text-purple-400" />
            <span>{mainView === 'operations' ? 'Switch to Map View' : 'Operations Board'}</span>
          </button>

          <div className="grid grid-cols-2 gap-2 pt-0.5">
            <button 
              onClick={() => openModal('driverRoster')}
              className="flex items-center justify-center space-x-1.5 py-2 px-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-xs font-bold text-sky-300 transition-colors cursor-pointer shadow-sm"
              title="Driver Roster & Rotation"
            >
              <Users size={14} className="text-sky-400" />
              <span>Driver Roster</span>
            </button>
            <button 
              onClick={() => openModal('expenseLedger')}
              className="flex items-center justify-center space-x-1.5 py-2 px-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-xs font-bold text-orange-300 transition-colors cursor-pointer shadow-sm"
              title="Expense Ledger & Approvals"
            >
              <DollarSign size={14} className="text-orange-400" />
              <span>Expense Ledger</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => openModal('fleetVehicles')}
              className="flex items-center justify-center space-x-1.5 py-2 px-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-xs font-bold text-teal-300 transition-colors cursor-pointer shadow-sm"
              title="Manage Fleet Vehicles & Service Schedules"
            >
              <Truck size={14} className="text-teal-400 shrink-0" />
              <span className="truncate">Fleet Vehicles</span>
              {serviceDueCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/40 font-extrabold">
                  {serviceDueCount}
                </span>
              )}
            </button>
            <button
              onClick={() => openModal('dvir')}
              className="flex items-center justify-center space-x-1.5 py-2 px-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-xs font-bold text-emerald-300 transition-colors cursor-pointer shadow-sm"
              title="DVIR Pre/Post-Trip Inspections & Defect Sign-Off"
            >
              <ClipboardCheck size={14} className="text-emerald-400 shrink-0" />
              <span className="truncate">DVIR Logs</span>
              {openDefectCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[9px] bg-red-500/25 text-red-300 border border-red-500/40 font-extrabold">
                  {openDefectCount}
                </span>
              )}
            </button>
          </div>

          <button
            onClick={() => openModal('fleetAnalytics')}
            className="w-full flex items-center justify-center space-x-2 py-2 px-3 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-xs font-bold text-indigo-300 transition-colors cursor-pointer shadow-sm"
            title="Fleet KPIs, SLA Compliance & Cost-per-Mile"
          >
            <BarChart3 size={14} className="text-indigo-400" />
            <span>Fleet Analytics & KPIs</span>
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
      
      {/* Search & Filter Pills */}
      <div className="px-4 mb-4 space-y-2">
        <div className="relative">
          <input 
            type="text" 
            value={jobSearchQuery}
            onChange={(e) => setJobSearchQuery(e.target.value)}
            placeholder="Search jobs, stops, or drivers..." 
            className="glass-input text-sm py-2 rounded-full pl-5 pr-9"
          />
          {jobSearchQuery && (
            <button
              type="button"
              onClick={() => setJobSearchQuery('')}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white p-1"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {activeJobTab === 'current' && (
          <div className="flex items-center gap-1.5">
            {[
              { id: 'all', label: 'All' },
              { id: 'mine', label: 'My Jobs' },
              { id: 'open', label: 'Open' }
            ].map(pill => (
              <button
                key={pill.id}
                type="button"
                onClick={() => setJobFilter(pill.id)}
                className={`flex-1 py-1 px-2.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer border ${
                  jobFilter === pill.id
                    ? 'bg-primary-500/20 text-primary-300 border-primary-500/50'
                    : 'bg-slate-800/60 text-gray-400 border-white/5 hover:text-gray-200'
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>
        )}
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
