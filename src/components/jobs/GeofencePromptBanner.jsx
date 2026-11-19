import React, { useState } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { Camera, Check, MapPin, X } from 'lucide-react';
import { db } from '../../firebase';
import { useAppStore } from '../../store/useAppStore';
import { useToastStore } from '../../store/useToastStore';
import { useJobs } from '../../hooks/useFirebase';
import { normalizeJobStops } from '../../utils/stops';
import { syncPublicTrackingJobUpdate } from '../../utils/publicTracking';

export default function GeofencePromptBanner() {
  const arrivalPrompt = useAppStore((s) => s.arrivalPrompt);
  const setArrivalPrompt = useAppStore((s) => s.setArrivalPrompt);
  const companyId = useAppStore((s) => s.companyId);
  const companyName = useAppStore((s) => s.companyName);
  const currentUser = useAppStore((s) => s.currentUser);
  const currentLocation = useAppStore((s) => s.currentLocation);
  const routeInfo = useAppStore((s) => s.routeInfo);
  const openModal = useAppStore((s) => s.openModal);
  const addToast = useToastStore((s) => s.addToast);
  const jobs = useJobs();
  const [updating, setUpdating] = useState(false);

  if (!arrivalPrompt) return null;

  const handleMarkArrived = async () => {
    const job = jobs.find((j) => j.id === arrivalPrompt.jobId);
    if (!job || !companyId) {
      setArrivalPrompt(null);
      return;
    }

    setUpdating(true);
    try {
      const now = Date.now();
      const updatedStops = normalizeJobStops(job).map((s) =>
        s.id === arrivalPrompt.stopId
          ? { ...s, status: 'arrived', arrivedAt: s.arrivedAt || now }
          : s
      );

      await updateDoc(doc(db, `companies/${companyId}/jobs`, job.id), {
        stops: updatedStops,
        updatedAt: serverTimestamp()
      });

      await syncPublicTrackingJobUpdate({
        db,
        companyId,
        companyName,
        job: { ...job, stops: updatedStops },
        driverId: currentUser?.id,
        driverName: currentUser?.name || currentUser?.email,
        driverLocation: currentLocation,
        routeInfo
      });

      addToast(`Marked arrived at Stop #${arrivalPrompt.stopOrder}`, 'success');
      setArrivalPrompt(null);
    } catch (err) {
      console.error('Failed to mark stop arrived:', err);
      addToast('Could not mark stop arrival', 'error');
    }
    setUpdating(false);
  };

  const handleCapturePod = () => {
    const { jobId, stopId } = arrivalPrompt;
    setArrivalPrompt(null);
    openModal('podCapture', { jobId, stopId });
  };

  return (
    <div className="fixed bottom-16 md:bottom-6 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-1.5rem)] max-w-md bg-slate-900/95 backdrop-blur-xl border border-amber-500/50 rounded-2xl shadow-2xl p-3.5 text-white animate-modal-enter">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 shrink-0">
            <MapPin size={18} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-extrabold uppercase tracking-wider text-amber-300">
                Arriving at Stop #{arrivalPrompt.stopOrder}
              </span>
              <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200 font-mono text-[10px] font-bold">
                {arrivalPrompt.distanceMeters}m away
              </span>
            </div>
            <p className="text-xs font-semibold text-white truncate mt-0.5">{arrivalPrompt.jobName}</p>
            <p className="text-[11px] text-slate-300 line-clamp-2">{arrivalPrompt.address}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setArrivalPrompt(null)}
          className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 shrink-0"
          aria-label="Dismiss arrival prompt"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex items-center gap-2 mt-3">
        <button
          type="button"
          onClick={handleMarkArrived}
          disabled={updating}
          className="flex-1 py-2 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
        >
          <Check size={14} />
          <span>{updating ? 'Saving...' : 'Mark Arrived'}</span>
        </button>
        <button
          type="button"
          onClick={handleCapturePod}
          className="flex-1 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
        >
          <Camera size={14} />
          <span>Capture POD</span>
        </button>
      </div>
    </div>
  );
}
