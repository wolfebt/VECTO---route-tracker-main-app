import React, { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useToastStore } from '../../store/useToastStore';
import { useJobs } from '../../hooks/useFirebase';
import { db } from '../../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { MessageSquarePlus, X } from 'lucide-react';

export default function LogProgressModal() {
  const { modals, closeModal, companyId, currentUser } = useAppStore();
  const addToast = useToastStore((state) => state.addToast);
  const jobs = useJobs();

  const [noteInput, setNoteInput] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const modalData = modals.logProgress;
  const jobId = typeof modalData === 'object' ? modalData?.jobId : null;
  const job = jobs.find(j => j.id === jobId);

  if (!modals.logProgress) return null;

  const handleClose = () => {
    setNoteInput('');
    closeModal('logProgress');
  };

  const handleSaveNote = async (e) => {
    e.preventDefault();
    if (!noteInput.trim() || !jobId || !companyId || !currentUser?.id) return;
    setSavingNote(true);
    try {
      await addDoc(collection(db, `companies/${companyId}/jobs/${jobId}/notes`), {
        text: noteInput.trim(),
        driverId: currentUser.id,
        driverName: currentUser.name || 'Unknown',
        timestamp: serverTimestamp()
      });
      addToast("Update logged successfully", "success");
      handleClose();
    } catch (error) {
      console.error(error);
      addToast("Failed to log update", "error");
    }
    setSavingNote(false);
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div 
        className="bg-slate-900 border border-slate-800 text-white rounded-xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-4 bg-slate-950/80 border-b border-slate-800 flex justify-between items-center">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-cyan-500/20 text-cyan-400 rounded-lg border border-cyan-500/30">
              <MessageSquarePlus size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Log Progress Update</h2>
              <p className="text-xs text-slate-400 font-medium truncate max-w-[280px]">
                {job?.jobName ? `Job: ${job.jobName}` : 'Add a note to this job'}
              </p>
            </div>
          </div>
          <button 
            onClick={handleClose} 
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSaveNote} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Update Note / Status Details
            </label>
            <textarea
              rows={4}
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder="E.g., Arrived at first stop, unloaded cargo, waiting for approval..."
              className="w-full bg-slate-800/80 border border-slate-700 text-white rounded-xl p-3 text-sm focus:ring-2 focus:ring-cyan-500 focus:border-transparent outline-none placeholder:text-slate-500"
              autoFocus
            />
          </div>

          <div className="flex items-center justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2.5 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingNote || !noteInput.trim()}
              className="px-5 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-lg text-xs font-bold shadow-lg transition-all disabled:opacity-50 min-h-[44px]"
            >
              {savingNote ? 'Saving...' : 'Submit Log Update'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
