import React, { useState, useRef, useEffect, useCallback } from 'react';
import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { Camera, CheckCircle2, ClipboardCheck, Eraser, PenTool, Trash2, X } from 'lucide-react';
import { db, storage } from '../../firebase';
import { useAppStore } from '../../store/useAppStore';
import { useToastStore } from '../../store/useToastStore';
import { useJobs } from '../../hooks/useFirebase';
import { getRemainingStops, normalizeJobStops } from '../../utils/stops';
import { syncPublicTrackingJobUpdate } from '../../utils/publicTracking';
import { compressImageFile, blobToDataUrl } from '../../utils/imageCompression';
import { saveOfflinePod } from '../../utils/offlineQueue';

export default function PodCaptureModal() {
  const {
    modals,
    closeModal,
    companyId,
    companyName,
    currentUser,
    currentLocation,
    routeInfo
  } = useAppStore();
  const addToast = useToastStore((s) => s.addToast);
  const jobs = useJobs();

  const modalData = typeof modals.podCapture === 'object' ? modals.podCapture : null;
  const jobId = modalData?.jobId || null;
  const requestedStopId = modalData?.stopId || null;
  const job = jobs.find((j) => j.id === jobId) || null;
  const stops = normalizeJobStops(job);

  const [selectedStopId, setSelectedStopId] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [hasSignature, setHasSignature] = useState(false);
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef(null);
  const canvasRef = useRef(null);
  const isDrawingRef = useRef(false);
  const jobRef = useRef(job);
  jobRef.current = job;

  const initSignaturePad = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cssWidth = rect.width || 400;
    const cssHeight = rect.height || 160;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  useEffect(() => {
    const activeJob = jobRef.current;
    if (!modals.podCapture || !activeJob) return;
    const jobStops = normalizeJobStops(activeJob);
    const remaining = getRemainingStops(jobStops);
    const defaultStop =
      jobStops.find((s) => s.id === requestedStopId) ||
      remaining[0] ||
      jobStops[jobStops.length - 1] ||
      null;

    setSelectedStopId(defaultStop?.id || 'stop_0');
    setRecipientName(activeJob.contactName || '');
    setDeliveryNotes('');
    setHasSignature(false);

    const rafId = requestAnimationFrame(() => initSignaturePad());
    return () => cancelAnimationFrame(rafId);
  }, [modals.podCapture, jobId, requestedStopId, initSignaturePad]);

  useEffect(() => {
    return () => {
      if (photoPreview) {
        URL.revokeObjectURL(photoPreview);
      }
    };
  }, [photoPreview]);

  if (!modals.podCapture || !job) return null;

  const handleClose = () => {
    if (photoPreview) {
      URL.revokeObjectURL(photoPreview);
      setPhotoPreview(null);
    }
    setPhotoFile(null);
    setDeliveryNotes('');
    setHasSignature(false);
    isDrawingRef.current = false;
    closeModal('podCapture');
  };

  const handlePhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      addToast('POD proof photo must be an image file', 'error');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      addToast('Photo must be under 25MB', 'error');
      return;
    }
    const compressed = await compressImageFile(file);
    if (compressed.size > 10 * 1024 * 1024) {
      addToast('Compressed photo still exceeds 10MB limit', 'error');
      return;
    }
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(compressed);
    setPhotoPreview(URL.createObjectURL(compressed));
  };

  const handleClearPhoto = () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(null);
    setPhotoPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const getPointerCoords = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  const handlePointerDown = (e) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    canvas.setPointerCapture?.(e.pointerId);
    const { x, y } = getPointerCoords(e);
    isDrawingRef.current = true;
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const handlePointerMove = (e) => {
    if (!isDrawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPointerCoords(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasSignature) setHasSignature(true);
  };

  const handlePointerUp = (e) => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    canvasRef.current?.releasePointerCapture?.(e.pointerId);
  };

  const handleClearSignature = () => {
    setHasSignature(false);
    initSignaturePad();
  };

  const canvasToPngBlob = () =>
    new Promise((resolve) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        resolve(null);
        return;
      }
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!companyId || !currentUser?.id) return;
    if (!photoFile && !hasSignature) {
      addToast('Please attach a delivery photo or capture a signature.', 'warning');
      return;
    }

    setSaving(true);
    try {
      const now = Date.now();
      const sigBlob = hasSignature ? await canvasToPngBlob() : null;

      const baseStops =
        stops.length > 0
          ? stops
          : [
              {
                id: 'stop_0',
                address: job.destination || job.origin || 'Delivery Stop',
                lat: null,
                lng: null,
                order: 0,
                status: 'pending',
                arrivedAt: null,
                completedAt: null,
                pod: null
              }
            ];

      let matchedIndex = baseStops.findIndex((s) => s.id === selectedStopId);
      if (matchedIndex === -1) matchedIndex = 0;
      const targetStopId = baseStops[matchedIndex].id;

      const buildPodPayload = (photoUrl = null, signatureUrl = null) => {
        const podRecord = {
          photoUrl: photoUrl || null,
          signatureUrl: signatureUrl || null,
          recipientName: recipientName.trim() || null,
          notes: deliveryNotes.trim() || null,
          capturedAt: now,
          capturedBy: currentUser.id,
          capturedByName: currentUser.name || currentUser.email || 'Driver',
          capturedLat: typeof currentLocation?.lat === 'number' ? currentLocation.lat : null,
          capturedLng: typeof currentLocation?.lng === 'number' ? currentLocation.lng : null
        };

        const updatedStops = baseStops.map((s, idx) =>
          idx === matchedIndex
            ? {
                ...s,
                status: 'completed',
                arrivedAt: s.arrivedAt || now,
                completedAt: now,
                pod: podRecord
              }
            : s
        );

        const podSummary = {
          lastUpdatedAt: now,
          stopId: targetStopId,
          photoUrl: podRecord.photoUrl,
          signatureUrl: podRecord.signatureUrl,
          recipientName: podRecord.recipientName
        };

        return { podRecord, updatedStops, podSummary };
      };

      let photoUrl = null;
      let signatureUrl = null;
      let queueOffline = typeof navigator !== 'undefined' && !navigator.onLine;

      if (!queueOffline) {
        try {
          if (photoFile) {
            const rawExt = photoFile.name.split('.').pop();
            const ext = rawExt && /^[a-zA-Z0-9]{2,5}$/.test(rawExt) ? rawExt : 'jpg';
            const photoPath = `pod/${companyId}/${job.id}/${now}_photo_${currentUser.id}.${ext}`;
            const photoRef = ref(storage, photoPath);
            await uploadBytes(photoRef, photoFile, { contentType: photoFile.type || 'image/jpeg' });
            photoUrl = await getDownloadURL(photoRef);
          }

          if (sigBlob) {
            const sigPath = `pod/${companyId}/${job.id}/${now}_sig_${currentUser.id}.png`;
            const sigRef = ref(storage, sigPath);
            await uploadBytes(sigRef, sigBlob, { contentType: 'image/png' });
            signatureUrl = await getDownloadURL(sigRef);
          }
        } catch (uploadErr) {
          const msg = String(uploadErr?.code || uploadErr?.message || '');
          if (
            (typeof navigator !== 'undefined' && !navigator.onLine) ||
            /network|offline|retry-limit|fetch|unavailable/i.test(msg)
          ) {
            queueOffline = true;
          } else {
            throw uploadErr;
          }
        }
      }

      if (queueOffline) {
        const [photoDataUrl, signatureDataUrl] = await Promise.all([
          blobToDataUrl(photoFile),
          blobToDataUrl(sigBlob),
        ]);

        await saveOfflinePod({
          companyId,
          companyName: companyName || '',
          jobId: job.id,
          selectedStopId: targetStopId,
          recipientName: recipientName.trim() || null,
          deliveryNotes: deliveryNotes.trim() || null,
          capturedAt: now,
          capturedBy: currentUser.id,
          capturedByName: currentUser.name || currentUser.email || 'Driver',
          capturedLat: typeof currentLocation?.lat === 'number' ? currentLocation.lat : null,
          capturedLng: typeof currentLocation?.lng === 'number' ? currentLocation.lng : null,
          photoDataUrl,
          signatureDataUrl,
          noteWritten: false,
        });

        const { updatedStops, podSummary } = buildPodPayload(null, null);
        await Promise.race([
          updateDoc(doc(db, `companies/${companyId}/jobs`, job.id), {
            stops: updatedStops,
            pod: podSummary,
            updatedAt: serverTimestamp()
          }).catch(() => {}),
          new Promise((resolve) => setTimeout(resolve, 350)),
        ]);

        addToast('Offline: POD compressed & queued — will upload automatically when online.', 'info');
        handleClose();
        setSaving(false);
        return;
      }

      const { podRecord, updatedStops, podSummary } = buildPodPayload(photoUrl, signatureUrl);

      await updateDoc(doc(db, `companies/${companyId}/jobs`, job.id), {
        stops: updatedStops,
        pod: podSummary,
        updatedAt: serverTimestamp()
      });

      const stopNumber = matchedIndex + 1;
      const noteText = `Proof of Delivery captured for Stop #${stopNumber}${
        podRecord.recipientName ? ` (Recipient: ${podRecord.recipientName})` : ''
      }${podRecord.notes ? ` — ${podRecord.notes}` : ''}`;

      await addDoc(collection(db, `companies/${companyId}/jobs/${job.id}/notes`), {
        text: noteText.slice(0, 4000),
        driverId: currentUser.id,
        driverName: currentUser.name || currentUser.email || 'Driver',
        timestamp: serverTimestamp()
      });

      await syncPublicTrackingJobUpdate({
        db,
        companyId,
        companyName,
        job: { ...job, stops: updatedStops, pod: podSummary },
        driverId: currentUser.id,
        driverName: currentUser.name || currentUser.email,
        driverLocation: currentLocation,
        routeInfo
      });

      addToast(`Proof of Delivery saved for Stop #${stopNumber}!`, 'success');
      handleClose();
    } catch (err) {
      console.error('POD upload failed:', err);
      addToast('Failed to save Proof of Delivery', 'error');
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div
        className="bg-slate-900 border border-slate-800 text-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 bg-slate-950/80 border-b border-slate-800 flex justify-between items-center">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-xl border border-emerald-500/30">
              <ClipboardCheck size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Proof of Delivery (POD)</h2>
              <p className="text-xs text-slate-400 font-medium truncate max-w-[280px]">
                {job.jobName || 'Active Delivery'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
            aria-label="Close POD modal"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-1">
          {stops.length > 1 && (
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Delivery Stop
              </label>
              <select
                value={selectedStopId}
                onChange={(e) => setSelectedStopId(e.target.value)}
                className="w-full bg-slate-800/80 border border-slate-700 text-white rounded-xl p-2.5 text-xs focus:ring-2 focus:ring-emerald-500 outline-none"
              >
                {stops.map((s, idx) => (
                  <option key={s.id} value={s.id}>
                    Stop #{idx + 1}: {s.address} {s.status === 'completed' ? '(Completed)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              Recipient Name (Optional)
            </label>
            <input
              type="text"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="Received by (name or gate attendant)..."
              className="w-full bg-slate-800/80 border border-slate-700 text-white rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none placeholder:text-slate-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              Delivery Photo Proof
            </label>
            {photoFile ? (
              <div className="p-2.5 bg-slate-800/80 border border-slate-700 rounded-xl flex items-center justify-between gap-3">
                <div className="flex items-center space-x-3 overflow-hidden">
                  {photoPreview && (
                    <img
                      src={photoPreview}
                      alt="POD preview"
                      className="w-14 h-14 rounded-lg object-cover border border-slate-600 shrink-0"
                    />
                  )}
                  <div className="overflow-hidden">
                    <p className="text-xs font-bold text-white truncate">{photoFile.name}</p>
                    <p className="text-[10px] text-slate-400 font-mono">
                      {(photoFile.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleClearPhoto}
                  className="p-2 text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 rounded-lg transition-colors shrink-0"
                  title="Remove photo"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-700 hover:border-emerald-500/50 rounded-xl p-4 flex flex-col items-center justify-center gap-1 cursor-pointer bg-slate-800/30 hover:bg-slate-800/50 transition-all text-center"
              >
                <Camera size={22} className="text-emerald-400" />
                <p className="text-xs font-semibold text-slate-200">Tap to capture or upload delivery photo</p>
                <p className="text-[10px] text-slate-500">PNG, JPG, WebP up to 10MB</p>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhotoChange}
              className="hidden"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <PenTool size={13} className="text-emerald-400" />
                <span>Customer Signature</span>
              </label>
              <button
                type="button"
                onClick={handleClearSignature}
                className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 transition-colors"
              >
                <Eraser size={12} />
                <span>Clear</span>
              </button>
            </div>
            <canvas
              ref={canvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className="w-full h-40 rounded-xl border border-slate-600 bg-white touch-none cursor-crosshair block"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              Sign inside the white box using finger, stylus, or mouse.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              Drop-Off Notes (Optional)
            </label>
            <textarea
              rows={2}
              value={deliveryNotes}
              onChange={(e) => setDeliveryNotes(e.target.value)}
              placeholder="Left at Dock B with warehouse supervisor..."
              className="w-full bg-slate-800/80 border border-slate-700 text-white rounded-xl p-2.5 text-xs focus:ring-2 focus:ring-emerald-500 outline-none placeholder:text-slate-500"
            />
          </div>

          <div className="flex items-center justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || (!photoFile && !hasSignature)}
              className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold shadow-lg transition-all disabled:opacity-50 min-h-[44px] flex items-center space-x-1.5"
            >
              {saving ? (
                <span>Uploading POD...</span>
              ) : (
                <>
                  <CheckCircle2 size={15} />
                  <span>Complete Stop with POD</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
