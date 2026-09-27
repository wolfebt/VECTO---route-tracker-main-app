import React, { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useToastStore } from '../../store/useToastStore';
import { useCompany, useActiveDrivers, useJobs } from '../../hooks/useFirebase';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { Users, Star, ArrowUp, ArrowDown, X } from 'lucide-react';

export default function DriverRosterModal() {
  const { modals, closeModal, companyId, isDispatchView } = useAppStore();
  const addToast = useToastStore((state) => state.addToast);
  const { members } = useCompany();
  const activeDrivers = useActiveDrivers();
  const jobs = useJobs();

  const [savingId, setSavingId] = useState(null);

  if (!modals.driverRoster) return null;

  const fiveMinAgo = Date.now() - (5 * 60 * 1000);

  // Sort members:
  // 1. Priority drivers first
  // 2. onDutyStatus: on_duty > break > off_duty
  // 3. rosterOrder (ascending)
  const sortedMembers = [...members].sort((a, b) => {
    const aPriority = !!a.isPriorityDriver;
    const bPriority = !!b.isPriorityDriver;
    if (aPriority !== bPriority) return aPriority ? -1 : 1;

    const dutyWeight = { on_duty: 3, break: 2, off_duty: 1 };
    const aDuty = dutyWeight[a.onDutyStatus || 'on_duty'] || 3;
    const bDuty = dutyWeight[b.onDutyStatus || 'on_duty'] || 3;
    if (aDuty !== bDuty) return bDuty - aDuty;

    const aOrder = typeof a.rosterOrder === 'number' ? a.rosterOrder : 999;
    const bOrder = typeof b.rosterOrder === 'number' ? b.rosterOrder : 999;
    return aOrder - bOrder;
  });

  // Determine who is next up in the queue (first on-duty driver)
  const nextUpMember = sortedMembers.find(m => (m.onDutyStatus || 'on_duty') === 'on_duty');

  const handleTogglePriority = async (member) => {
    if (!isDispatchView) return;
    setSavingId(member.id);
    try {
      await updateDoc(doc(db, `companies/${companyId}/members/${member.id}`), {
        isPriorityDriver: !member.isPriorityDriver,
        updatedAt: serverTimestamp()
      });
      addToast(`${member.name || member.email} ${!member.isPriorityDriver ? 'marked as Priority Driver' : 'priority removed'}`, "success");
    } catch (err) {
      console.error(err);
      addToast("Failed to update priority status", "error");
    }
    setSavingId(null);
  };

  const handleDutyChange = async (memberId, status) => {
    if (!isDispatchView) return;
    setSavingId(memberId);
    try {
      await updateDoc(doc(db, `companies/${companyId}/members/${memberId}`), {
        onDutyStatus: status,
        updatedAt: serverTimestamp()
      });
      addToast("Duty status updated", "success");
    } catch (err) {
      console.error(err);
      addToast("Failed to update duty status", "error");
    }
    setSavingId(null);
  };

  const handleMoveOrder = async (index, direction) => {
    if (!isDispatchView) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= sortedMembers.length) return;

    const currentMember = sortedMembers[index];
    const targetMember = sortedMembers[targetIndex];

    try {
      const currentOrder = typeof currentMember.rosterOrder === 'number' ? currentMember.rosterOrder : index;
      const targetOrder = typeof targetMember.rosterOrder === 'number' ? targetMember.rosterOrder : targetIndex;

      // Swap orders
      await updateDoc(doc(db, `companies/${companyId}/members/${currentMember.id}`), {
        rosterOrder: targetOrder,
        updatedAt: serverTimestamp()
      });
      await updateDoc(doc(db, `companies/${companyId}/members/${targetMember.id}`), {
        rosterOrder: currentOrder,
        updatedAt: serverTimestamp()
      });
      addToast("Roster order updated", "success");
    } catch (err) {
      console.error(err);
      addToast("Failed to reorder roster", "error");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => closeModal('driverRoster')}>
      <div 
        className="bg-slate-900 border border-slate-800 text-white rounded-2xl w-full max-w-2xl max-h-[90vh] shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 bg-slate-950/90 border-b border-slate-800 flex justify-between items-center">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-sky-500/20 text-sky-400 rounded-xl border border-sky-500/30">
              <Users size={22} />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-lg font-bold text-white">Driver Roster & Rotation</h2>
                <span className="px-2 py-0.5 bg-sky-500/20 text-sky-300 text-xs font-semibold rounded-full border border-sky-500/30">
                  {members.length} Drivers
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Manage rotation queue, duty availability, and priority drivers.
              </p>
            </div>
          </div>
          <button 
            onClick={() => closeModal('driverRoster')} 
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Next Up Banner */}
        {nextUpMember && (
          <div className="mx-4 mt-4 p-3 bg-gradient-to-r from-sky-950/60 to-blue-950/60 border border-sky-500/30 rounded-xl flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <span className="flex h-3 w-3 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-sky-500"></span>
              </span>
              <div>
                <p className="text-xs text-sky-400 font-bold uppercase tracking-wider">Next in Line for Dispatch</p>
                <p className="text-sm font-bold text-white flex items-center gap-1.5">
                  {nextUpMember.name || nextUpMember.email}
                  {nextUpMember.isPriorityDriver && (
                    <span className="text-amber-400 text-xs flex items-center" title="Priority Driver">
                      <Star size={13} className="fill-amber-400 inline" /> Priority
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="text-right">
              <span className="px-2.5 py-1 bg-emerald-500/20 text-emerald-300 text-xs font-bold rounded-lg border border-emerald-500/30">
                On Duty
              </span>
            </div>
          </div>
        )}

        {/* Member Roster List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {sortedMembers.length === 0 ? (
            <p className="text-center text-slate-500 py-8 text-sm italic">No team members registered yet.</p>
          ) : (
            sortedMembers.map((member, index) => {
              const isPriority = !!member.isPriorityDriver;
              const dutyStatus = member.onDutyStatus || 'on_duty';
              const isNextUp = nextUpMember?.id === member.id;
              
              // Live location & activity
              const activeLoc = activeDrivers.find(d => d.id === member.id);
              const isOnline = activeLoc?.timestamp && activeLoc.timestamp.toMillis() > fiveMinAgo;
              const assignedJob = jobs.find(j => j.status === 'in-progress' && j.assignedDrivers?.some(d => d.id === member.id));

              return (
                <div 
                  key={member.id}
                  className={`p-3 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                    isNextUp 
                      ? 'bg-sky-950/30 border-sky-500/40 shadow-sm' 
                      : 'bg-slate-800/60 border-slate-700/60 hover:border-slate-600'
                  }`}
                >
                  {/* Left: Position Number & Move buttons */}
                  <div className="flex items-center space-x-2 shrink-0">
                    <span className="w-6 text-center text-xs font-mono font-bold text-slate-400">
                      #{index + 1}
                    </span>
                    {isDispatchView && (
                      <div className="flex flex-col space-y-0.5">
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => handleMoveOrder(index, -1)}
                          className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 disabled:opacity-20 transition-colors"
                          title="Move up in rotation"
                        >
                          <ArrowUp size={12} />
                        </button>
                        <button
                          type="button"
                          disabled={index === sortedMembers.length - 1}
                          onClick={() => handleMoveOrder(index, 1)}
                          className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 disabled:opacity-20 transition-colors"
                          title="Move down in rotation"
                        >
                          <ArrowDown size={12} />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Middle: Driver Info & Tags */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2">
                      <span 
                        className="w-2.5 h-2.5 rounded-full shrink-0" 
                        style={{ backgroundColor: member.color || '#22c55e' }}
                      />
                      <p className="font-bold text-sm text-white truncate">
                        {member.name || member.email}
                      </p>
                      {isPriority && (
                        <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded text-[10px] font-bold flex items-center gap-0.5">
                          <Star size={10} className="fill-amber-300" /> PRIORITY
                        </span>
                      )}
                      {isNextUp && (
                        <span className="px-1.5 py-0.5 bg-sky-500/20 text-sky-300 border border-sky-500/40 rounded text-[10px] font-bold">
                          NEXT UP
                        </span>
                      )}
                    </div>

                    <div className="flex items-center space-x-3 mt-1 text-xs text-slate-400">
                      <span className="flex items-center gap-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                        {isOnline ? 'GPS Active' : 'Offline'}
                      </span>
                      {assignedJob && (
                        <span className="text-amber-400 truncate max-w-[150px]">
                          🚛 {assignedJob.jobName}
                        </span>
                      )}
                      {(member.phone || member.number) && (
                        <span className="font-mono hidden sm:inline">
                          📞 {member.phone || member.number}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right: Duty Selector & Priority Star Toggle */}
                  <div className="flex items-center space-x-2 shrink-0">
                    {/* Duty Status Selector */}
                    <select
                      value={dutyStatus}
                      disabled={!isDispatchView || savingId === member.id}
                      onChange={(e) => handleDutyChange(member.id, e.target.value)}
                      className={`text-xs rounded-lg px-2 py-1.5 border font-semibold outline-none cursor-pointer ${
                        dutyStatus === 'on_duty'
                          ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                          : dutyStatus === 'break'
                          ? 'bg-amber-950/60 border-amber-500/40 text-amber-300'
                          : 'bg-slate-800 border-slate-700 text-slate-400'
                      }`}
                    >
                      <option value="on_duty">On Duty</option>
                      <option value="break">On Break</option>
                      <option value="off_duty">Off Duty</option>
                    </select>

                    {/* Priority Toggle */}
                    {isDispatchView && (
                      <button
                        type="button"
                        onClick={() => handleTogglePriority(member)}
                        disabled={savingId === member.id}
                        className={`p-2 rounded-lg border transition-all ${
                          isPriority
                            ? 'bg-amber-500/20 border-amber-500/40 text-amber-300 shadow-sm'
                            : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-white hover:border-slate-600'
                        }`}
                        title={isPriority ? "Remove priority flag" : "Set as Priority Driver (moves to top of queue)"}
                      >
                        <Star size={16} className={isPriority ? "fill-amber-300" : ""} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-950/80 border-t border-slate-800 flex justify-between items-center text-xs text-slate-400">
          <p>
            ⭐ <strong className="text-slate-300">Priority Drivers</strong> take precedence over rotation order.
          </p>
          <button
            type="button"
            onClick={() => closeModal('driverRoster')}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-semibold transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
