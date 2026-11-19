import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useToastStore } from '../../store/useToastStore';
import { useJobs, useActiveDrivers, useCompany } from '../../hooks/useFirebase';
import { db, storage } from '../../firebase';
import { doc, updateDoc, deleteDoc, collection, addDoc, serverTimestamp, query, onSnapshot, arrayUnion } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { normalizeJobStops, getRemainingStops, evaluateStopSla } from '../../utils/stops';
import { getPublicAppBaseUrl, toMillisSafe } from '../../utils/formatters';
import { syncPublicTrackingJobUpdate } from '../../utils/publicTracking';
import { 
  Briefcase, 
  ShieldAlert, 
  FileText, 
  ChevronDown, 
  UserPlus, 
  UserMinus, 
  QrCode, 
  CheckCircle2, 
  Pencil, 
  Slash, 
  Archive, 
  Trash2, 
  MessageSquare,
  MessageSquarePlus,
  Share2,
  Phone,
  Play,
  Flag,
  Calendar,
  AlertTriangle,
  DollarSign,
  ClipboardCheck,
  Radio,
  ExternalLink,
  Truck
} from 'lucide-react';

export default function JobDetails() {
  const {
    selectedJobId,
    setSelectedJobId,
    isDispatchView,
    memberPermissions,
    currentUser,
    companyId,
    companyName,
    currentLocation,
    routeInfo,
    routeWeather,
    routeStyle,
    setRouteStyle,
    openModal
  } = useAppStore();
  const addToast = useToastStore((state) => state.addToast);
  const jobs = useJobs();
  const activeDrivers = useActiveDrivers();
  const { members } = useCompany();
  const job = jobs.find(j => j.id === selectedJobId);
  
  const [messages, setMessages] = useState([]);
  const [notes, setNotes] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatFile, setChatFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [activeDrawer, setActiveDrawer] = useState('JOB');
  
  useEffect(() => {
    if (!isDispatchView && activeDrawer === 'ADMIN') {
      setActiveDrawer('JOB');
    }
  }, [isDispatchView, activeDrawer]);
  
  // Chat listener
  useEffect(() => {
    if (!selectedJobId || !companyId || !currentUser?.id) {
      setMessages([]);
      return;
    }
    const q = query(collection(db, `companies/${companyId}/jobs/${selectedJobId}/chat`));
    const unsub = onSnapshot(q, (snap) => {
      const msgs = [];
      snap.forEach(d => msgs.push({ id: d.id, ...d.data() }));
      msgs.sort((a,b) => toMillisSafe(a.timestamp) - toMillisSafe(b.timestamp));
      setMessages(msgs);
    }, (error) => {
      if (error.code !== 'permission-denied') {
        console.warn("Job chat snapshot listener error:", error);
      }
    });
    return unsub;
  }, [selectedJobId, companyId, currentUser?.id]);

  // Progress notes listener
  useEffect(() => {
    if (!selectedJobId || !companyId || !currentUser?.id) {
      setNotes([]);
      return;
    }
    const q = query(collection(db, `companies/${companyId}/jobs/${selectedJobId}/notes`));
    const unsub = onSnapshot(q, (snap) => {
      const list = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      list.sort((a, b) => toMillisSafe(b.timestamp) - toMillisSafe(a.timestamp));
      setNotes(list);
    }, (error) => {
      if (error.code !== 'permission-denied') {
        console.warn("Job notes snapshot listener error:", error);
      }
    });
    return unsub;
  }, [selectedJobId, companyId, currentUser?.id]);

  // Mark chat messages read when CHAT drawer is active
  useEffect(() => {
    if (activeDrawer !== 'CHAT' || !selectedJobId || !currentUser?.id || messages.length === 0) return;
    const latestMsgMs = toMillisSafe(messages[messages.length - 1]?.timestamp);
    const lastReadMs = toMillisSafe(currentUser?.lastRead?.[selectedJobId]);
    if (latestMsgMs > 0 && latestMsgMs <= lastReadMs) return;

    const nowMs = Date.now();
    useAppStore.setState((state) => ({
      currentUser: state.currentUser
        ? {
            ...state.currentUser,
            lastRead: { ...(state.currentUser.lastRead || {}), [selectedJobId]: nowMs }
          }
        : null
    }));

    updateDoc(doc(db, 'users', currentUser.id), {
      [`lastRead.${selectedJobId}`]: serverTimestamp()
    }).catch(() => {});
  }, [activeDrawer, selectedJobId, currentUser?.id, currentUser?.lastRead, messages]);

  if (!selectedJobId) return null;
  if (!job) {
    return (
      <div className="relative md:absolute right-0 top-0 bottom-0 w-full h-full md:w-80 lg:w-96 bg-gray-900 border-l border-gray-800 p-4 flex flex-col z-30 shadow-2xl">
        <button onClick={() => setSelectedJobId(null)} className="text-gray-400 hover:text-white self-end mb-4">&times;</button>
        <p className="text-gray-400 italic">Job not found.</p>
      </div>
    );
  }

  const isAssigned = (job.assignedDrivers || []).some(d => d.id === currentUser.id);
  const canAssign = job.status !== 'completed' && job.status !== 'archived' && job.status !== 'cancelled';
  const hasDriverFinished = (job.completedDrivers || []).includes(currentUser.id);
  const canDeleteJob = Boolean(memberPermissions?.isCreator || memberPermissions?.canDeleteJob);

  const stops = normalizeJobStops(job);
  const remainingStops = getRemainingStops(stops);

  const instructions = job.instructions?.length
    ? job.instructions
    : (job.note ? [{ id: 'legacy', text: job.note, target: 'all', isPriority: false }] : []);

  const visibleInstructions = isDispatchView
    ? instructions
    : instructions.filter(inst => !inst.target || inst.target === 'all' || inst.target === currentUser.id);

  const handleStopStatusChange = async (stopId, nextStatus) => {
    try {
      const now = Date.now();
      const updatedStops = stops.map((s) => {
        if (s.id !== stopId) return s;
        if (nextStatus === 'arrived') {
          return { ...s, status: 'arrived', arrivedAt: s.arrivedAt || now };
        }
        if (nextStatus === 'completed') {
          return { ...s, status: 'completed', arrivedAt: s.arrivedAt || now, completedAt: now };
        }
        return { ...s, status: 'pending', arrivedAt: null, completedAt: null };
      });
      await updateDoc(doc(db, `companies/${companyId}/jobs`, job.id), {
        stops: updatedStops,
        updatedAt: serverTimestamp(),
      });
      await syncPublicTrackingJobUpdate({
        db,
        companyId,
        companyName,
        job: { ...job, stops: updatedStops },
        driverLocation: currentLocation,
        routeInfo
      });
    } catch (err) {
      console.error(err);
      addToast("Failed to update stop status", "error");
    }
  };

  const updateStatus = async (status, isAssigning = false, isUnassigning = false) => {
    const updates = { status, updatedAt: serverTimestamp() };
    if (isAssigning) {
      updates.assignedDrivers = arrayUnion({ id: currentUser.id, name: currentUser.name });
      updates.assignedDriverIds = arrayUnion(currentUser.id);
      updates.status = job.status === 'unassigned' ? 'in-progress' : job.status;
    } else if (isUnassigning) {
      const currentDrivers = job.assignedDrivers || [];
      updates.assignedDrivers = currentDrivers.filter(d => d.id !== currentUser.id);
      updates.assignedDriverIds = updates.assignedDrivers.map(d => d.id);

      const currentCompleted = job.completedDrivers || [];
      if (currentCompleted.includes(currentUser.id)) {
        updates.completedDrivers = currentCompleted.filter(id => id !== currentUser.id);
      }

      if (updates.assignedDrivers.length === 0 && job.status !== 'completed') {
        updates.status = 'unassigned';
      } else {
        updates.status = job.status;
      }
    }

    if (updates.status === 'in-progress' && !job.startedAt) {
      updates.startedAt = serverTimestamp();
    }
    if (status === 'archived') {
      updates.archived = true;
      updates.previousStatus = job.status;
    } else if (isDispatchView && job.archived) {
      updates.archived = false;
    }
    if (updates.status === 'completed') updates.completedAt = serverTimestamp();

    await updateDoc(doc(db, `companies/${companyId}/jobs`, job.id), updates);

    if (status === 'archived' || job.archived) {
      useAppStore.getState().setArchivedJobsState({ archivedJobsLoadedOnce: false });
    }

    const syncedDrivers = isAssigning
      ? [...(job.assignedDrivers || []), { id: currentUser.id, name: currentUser.name }]
      : (isUnassigning ? updates.assignedDrivers : job.assignedDrivers);

    await syncPublicTrackingJobUpdate({
      db,
      companyId,
      companyName,
      job: { ...job, status: updates.status, assignedDrivers: syncedDrivers },
      driverLocation: currentLocation,
      routeInfo
    });
  };

  const handleDriverFinish = async () => {
    const completedDrivers = job.completedDrivers || [];
    if (completedDrivers.includes(currentUser.id)) return;
    
    const newCompleted = [...completedDrivers, currentUser.id];
    const assignedCount = job.assignedDrivers?.length || 1;
    
    const updates = {
      completedDrivers: arrayUnion(currentUser.id),
      updatedAt: serverTimestamp()
    };
    
    if (newCompleted.length >= assignedCount) {
      updates.status = 'completed';
      updates.completedAt = serverTimestamp();
    }
    
    await updateDoc(doc(db, `companies/${companyId}/jobs`, job.id), updates);
    await syncPublicTrackingJobUpdate({
      db,
      companyId,
      companyName,
      job: { ...job, status: updates.status || job.status, completedDrivers: newCompleted },
      driverLocation: currentLocation,
      routeInfo
    });
  };

  const handleToggleDriver = async (driverId, isAdding) => {
    const member = members.find(m => m.id === driverId) || activeDrivers.find(d => d.id === driverId);
    if (!member) return;
    const updates = { updatedAt: serverTimestamp() };
    if (isAdding) {
      updates.assignedDrivers = arrayUnion({ id: member.id, name: member.name || member.email || 'Driver' });
      updates.assignedDriverIds = arrayUnion(member.id);
      if (job.status === 'unassigned') updates.status = 'assigned';
    } else {
      const currentDrivers = job.assignedDrivers || [];
      updates.assignedDrivers = currentDrivers.filter(d => d.id !== driverId);
      updates.assignedDriverIds = updates.assignedDrivers.map(d => d.id);

      const currentCompleted = job.completedDrivers || [];
      if (currentCompleted.includes(driverId)) {
        updates.completedDrivers = currentCompleted.filter(id => id !== driverId);
      }

      if (updates.assignedDrivers.length === 0 && job.status !== 'completed') {
        updates.status = 'unassigned';
      }
    }
    await updateDoc(doc(db, `companies/${companyId}/jobs`, job.id), updates);
  };

  const handleDelete = async () => {
    if (!canDeleteJob) return;
    if (confirm("Permanently delete this job?")) {
      await deleteDoc(doc(db, `companies/${companyId}/jobs`, job.id));
      setSelectedJobId(null);
    }
  };

  const handleUpdateColor = async (color) => {
    await updateDoc(doc(db, `companies/${companyId}/jobs`, job.id), {
      routeColor: color
    });
  };

  const handleSendChat = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() && !chatFile) return;
    setSending(true);
    
    try {
      let attachmentUrl = null;
      if (chatFile) {
        const storageRef = ref(storage, `chat_files/${companyId}/${job.id}/${Date.now()}_${currentUser.id}_${chatFile.name}`);
        await uploadBytes(storageRef, chatFile);
        attachmentUrl = await getDownloadURL(storageRef);
      }

      await addDoc(collection(db, `companies/${companyId}/jobs/${job.id}/chat`), {
        text: chatInput.trim(),
        attachmentUrl,
        senderId: currentUser.id,
        senderName: currentUser.name,
        timestamp: serverTimestamp()
      });
      
      await updateDoc(doc(db, `companies/${companyId}/jobs`, job.id), {
        lastMessageTimestamp: serverTimestamp()
      });

      setChatInput('');
      setChatFile(null);
    } catch (err) {
      console.error(err);
      addToast("Failed to send message", "error");
    }
    setSending(false);
  };

  const getNavigateLink = () => {
    const activeTargetStops = remainingStops.length > 0 ? remainingStops : stops;
    if (activeTargetStops.length === 0) return '#';
    
    const finalDest = activeTargetStops[activeTargetStops.length - 1].address;
    let link = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(finalDest)}`;
    
    if (activeTargetStops.length > 1) {
      const waypoints = activeTargetStops.slice(0, -1).map(s => encodeURIComponent(s.address)).join('|');
      link += `&waypoints=${waypoints}`;
    }
    return link;
  };

  const getStreetViewLink = () => {
    if (!routeInfo?.destinationCoords) return '#';
    return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${routeInfo.destinationCoords.lat},${routeInfo.destinationCoords.lng}`;
  };

  const handleShareJob = async () => {
    const baseUrl = getPublicAppBaseUrl();
    const shareUrl = `${baseUrl}?company=${companyId || ''}&job=${selectedJobId}`;

    const shareData = {
      title: `Vecto Job: ${job.jobName || 'Selected Job'}`,
      text: `View live team map and pins for job "${job.jobName || 'Selected Job'}" on Vecto`,
      url: shareUrl
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        addToast("Job & live map link shared!", "success");
        return;
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.warn("Share error:", err);
        } else return;
      }
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      addToast("Job & live map link copied to clipboard!", "success");
    } catch (err) {
      console.error(err);
      addToast("Failed to copy link.", "error");
    }
  };

  const fiveMinAgo = Date.now() - (5 * 60 * 1000);
  const completedStopCount = stops.filter(s => s.status === 'completed').length;

  return (
    <div className="relative md:absolute right-0 top-0 bottom-0 w-full h-full max-w-full md:max-w-md md:w-80 lg:w-96 bg-gray-900 border-l border-gray-800 flex flex-col z-30 shadow-2xl transition-transform duration-300">
      
      {/* Header */}
      <div className="p-4 border-b border-gray-800 flex justify-between items-start shrink-0">
        <div className="flex flex-col flex-1 mr-2">
           <div className="flex items-center flex-wrap gap-x-2.5 gap-y-1.5">
               <h2 className="text-lg font-bold text-white leading-none">{job.jobName || 'Unnamed'}</h2>
               <span className="px-2 py-0.5 bg-gray-700 text-xs rounded-full inline-block leading-none">{job.status}</span>
               {job.vehicleLabel && (
                 <span className="px-2 py-0.5 bg-sky-900/50 text-sky-300 border border-sky-500/30 text-[11px] rounded-full inline-flex items-center gap-1 leading-none font-medium">
                   <Truck size={11} /> {job.vehicleLabel}
                 </span>
               )}
               {job.jobDate && (
                 <span className="text-gray-400 text-[11px] font-mono flex items-center gap-1 leading-none">
                   <Calendar size={11} /> {job.jobDate}
                 </span>
               )}
               {routeInfo && (
                   <span className="text-teal-400 text-xs font-medium leading-none">
                     Est: {routeInfo.duration} ({routeInfo.distance})
                     {routeInfo.totalDwellMinutes > 0 && ` (+${routeInfo.totalDwellMinutes}m dwell)`}
                   </span>
               )}
           </div>
        </div>
        <button onClick={() => setSelectedJobId(null)} aria-label="Close Job Details" className="text-gray-400 hover:text-white p-1 -mt-1 rounded focus-visible:ring-2 focus-visible:ring-primary-500 shrink-0">&times;</button>
      </div>

      {/* Details */}
      <div className="flex-1 p-4 border-b border-gray-800 overflow-y-auto text-sm space-y-2.5">
        <div className="flex justify-between items-start">
            <p className="text-gray-400"><strong className="text-gray-200">From:</strong> {job.origin}</p>
            {isDispatchView && (
                <div className="flex items-center space-x-2 shrink-0 ml-2" title="Route Path Color">
                    <label className="text-xs text-gray-400">Color:</label>
                    <input 
                        type="color" 
                        defaultValue={job.routeColor || '#3b82f6'} 
                        onBlur={(e) => handleUpdateColor(e.target.value)}
                        className="w-6 h-6 cursor-pointer bg-transparent border-0 p-0 rounded-full"
                    />
                </div>
            )}
        </div>

        {/* Structured Multi-Stop Progress */}
        <div className="text-gray-400">
          <div className="flex items-center justify-between mb-1">
            <strong className="text-gray-200">Stops ({completedStopCount}/{stops.length}):</strong>
            {stops.length > 1 && job.optimizeRoute !== false && (
              <span className="text-[10px] text-teal-400 font-semibold">TSP Optimized</span>
            )}
          </div>
          <ul className="space-y-1.5 text-xs">
            {stops.map((stop, idx) => {
              const isDone = stop.status === 'completed';
              const isArrived = stop.status === 'arrived';
              const canEditStops = (isAssigned || isDispatchView) && canAssign;

              return (
                <li
                  key={stop.id || idx}
                  className={`p-2 rounded-lg border flex items-start justify-between gap-2 ${
                    isDone
                      ? 'bg-emerald-950/25 border-emerald-500/30 text-gray-400'
                      : isArrived
                      ? 'bg-amber-950/25 border-amber-500/40 text-gray-200'
                      : 'bg-gray-800/70 border-gray-700/70 text-gray-200'
                  }`}
                >
                  <div className="flex items-start gap-2 min-w-0">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5 ${
                      isDone
                        ? 'bg-emerald-500/30 text-emerald-300'
                        : isArrived
                        ? 'bg-amber-500/30 text-amber-300'
                        : 'bg-slate-700 text-slate-300'
                    }`}>
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <p className={`leading-snug break-words ${isDone ? 'line-through text-gray-400' : 'text-gray-200'}`}>
                        {stop.address}
                      </p>
                      {(stop.arriveBy || typeof stop.serviceMinutes === 'number') && (() => {
                        const sla = evaluateStopSla(stop, job.jobDate || '');
                        const slaBadgeClass =
                          sla.status === 'on_time'
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                            : sla.status === 'late'
                              ? 'bg-red-500/20 text-red-300 border-red-500/40'
                              : sla.status === 'at_risk'
                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                : 'bg-sky-500/15 text-sky-300 border-sky-500/35';
                        return (
                          <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[10px]">
                            {sla.status !== 'none' && (
                              <span className={`px-1.5 py-0.5 rounded border font-semibold ${slaBadgeClass}`}>
                                {sla.label}
                              </span>
                            )}
                            {typeof stop.serviceMinutes === 'number' && stop.serviceMinutes > 0 && (
                              <span className="px-1.5 py-0.5 rounded bg-slate-700/80 text-slate-300 border border-slate-600/70 font-mono">
                                {stop.serviceMinutes}m dwell
                              </span>
                            )}
                          </div>
                        );
                      })()}
                      {(isArrived || isDone) && (
                        <span className={`text-[10px] font-semibold inline-block mt-0.5 ${isDone ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {isDone
                            ? `Done${stop.completedAt ? ` • ${new Date(stop.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}`
                            : `Arrived${stop.arrivedAt ? ` • ${new Date(stop.arrivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}`}
                        </span>
                      )}
                      {stop.pod && (
                        <div className="flex flex-wrap items-center gap-2 mt-1 text-[10px]">
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-bold">
                            ✓ POD Verified{stop.pod.recipientName ? ` • ${stop.pod.recipientName}` : ''}
                          </span>
                          {stop.pod.photoUrl && (
                            <a
                              href={stop.pod.photoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sky-400 hover:underline inline-flex items-center gap-0.5"
                            >
                              Photo <ExternalLink size={9} />
                            </a>
                          )}
                          {stop.pod.signatureUrl && (
                            <a
                              href={stop.pod.signatureUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sky-400 hover:underline inline-flex items-center gap-0.5"
                            >
                              Signature <ExternalLink size={9} />
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {canEditStops && (
                    <div className="flex items-center gap-1 shrink-0">
                      {!isArrived && !isDone && (
                        <button
                          type="button"
                          onClick={() => handleStopStatusChange(stop.id, 'arrived')}
                          className="px-2 py-1 rounded bg-amber-600/20 hover:bg-amber-600/40 text-amber-300 border border-amber-500/30 text-[10px] font-bold cursor-pointer"
                        >
                          Arrive
                        </button>
                      )}
                      {!isDone ? (
                        <>
                          <button
                            type="button"
                            onClick={() => openModal('podCapture', { jobId: job.id, stopId: stop.id })}
                            className="px-2 py-1 rounded bg-cyan-600/20 hover:bg-cyan-600/40 text-cyan-300 border border-cyan-500/30 text-[10px] font-bold cursor-pointer"
                            title="Capture Proof of Delivery photo & signature"
                          >
                            POD
                          </button>
                          <button
                            type="button"
                            onClick={() => handleStopStatusChange(stop.id, 'completed')}
                            className="px-2 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold cursor-pointer"
                          >
                            Done
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleStopStatusChange(stop.id, 'pending')}
                          className="px-2 py-1 rounded bg-slate-700/60 hover:bg-slate-600 text-slate-300 border border-slate-600 text-[10px] font-semibold cursor-pointer"
                        >
                          Undo
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Customer / Site Contact Card */}
        {(job.contactName || job.contactNumber) && (
          <div className="p-2.5 rounded-lg bg-slate-800/70 border border-slate-700/70 flex items-center justify-between gap-2 text-xs">
            <div className="min-w-0">
              <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold block">Site Contact</span>
              <span className="text-gray-100 font-semibold truncate block">{job.contactName || 'Contact'}</span>
              {job.contactNumber && (
                <span className="text-sky-300 font-mono text-[11px]">{job.contactNumber}</span>
              )}
            </div>
            {job.contactNumber && (
              <div className="flex items-center gap-1.5 shrink-0">
                <a
                  href={`tel:${job.contactNumber}`}
                  className="px-2.5 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/40 font-bold flex items-center gap-1 transition-colors"
                >
                  <Phone size={12} /> Call
                </a>
                <a
                  href={`sms:${job.contactNumber}`}
                  className="px-2.5 py-1.5 rounded-lg bg-sky-600/20 hover:bg-sky-600/40 text-sky-300 border border-sky-500/40 font-bold flex items-center gap-1 transition-colors"
                >
                  <MessageSquare size={12} /> Text
                </a>
              </div>
            )}
          </div>
        )}

        {/* Live Road Conditions & Traffic Status */}
        {routeInfo && (
          <div className={`p-2.5 rounded-lg border text-xs flex items-center justify-between gap-2 mt-2 ${
            routeInfo.trafficStatus === 'red'
              ? 'bg-red-950/40 border-red-500/40 text-red-300'
              : routeInfo.trafficStatus === 'orange'
              ? 'bg-amber-950/40 border-amber-500/40 text-amber-300'
              : 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
          }`}>
            <div className="flex items-center gap-2">
              <span className="text-base">
                {routeInfo.trafficStatus === 'red' ? '🔴' : routeInfo.trafficStatus === 'orange' ? '🟠' : '🟢'}
              </span>
              <div>
                <p className="font-bold">{routeInfo.trafficText || 'Road Conditions'}</p>
                <p className="text-[11px] opacity-80">{routeInfo.duration} • {routeInfo.distance}</p>
              </div>
            </div>
            <div className="flex gap-1 shrink-0 flex-wrap">
              <button
                type="button"
                onClick={() => setRouteStyle('alternating')}
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${routeStyle === 'alternating' ? 'bg-emerald-600 text-white shadow-sm ring-1 ring-emerald-400/50' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                title="Alternating Fade"
              >
                Fade Road
              </button>
              <button
                type="button"
                onClick={() => setRouteStyle('outlined')}
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${routeStyle === 'outlined' ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                title="Outline Path"
              >
                Outline
              </button>
              <button
                type="button"
                onClick={() => setRouteStyle('traffic')}
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${routeStyle === 'traffic' ? 'bg-amber-600 text-white shadow-sm' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                title="Traffic Colors"
              >
                Traffic
              </button>
              <button
                type="button"
                onClick={() => setRouteStyle('solid')}
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${routeStyle === 'solid' ? 'bg-purple-600 text-white shadow-sm' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                title="Solid Line"
              >
                Solid
              </button>
            </div>
          </div>
        )}

        {/* Route Weather & Road Hazard Alerts */}
        {routeWeather?.hazards?.length > 0 && (
          <div
            className={`p-2.5 rounded-lg border text-xs space-y-1.5 mt-2 ${
              routeWeather.highestSeverity === 'critical'
                ? 'bg-rose-950/50 border-rose-500/50 text-rose-200'
                : 'bg-amber-950/40 border-amber-500/45 text-amber-200'
            }`}
          >
            <div className="flex items-center justify-between gap-2 font-bold uppercase tracking-wider text-[10px]">
              <span className="flex items-center gap-1">
                <AlertTriangle size={12} />
                Route Road Hazards ({routeWeather.hazards.length})
              </span>
              {routeWeather.destinationWeather?.temp !== undefined && (
                <span className="font-mono">
                  Dest: {Math.round(routeWeather.destinationWeather.temp)}°F
                </span>
              )}
            </div>
            <ul className="space-y-1">
              {routeWeather.hazards.map((hazard) => (
                <li key={hazard.type} className="flex items-start justify-between gap-2 text-[11px] leading-snug">
                  <span>
                    <strong className="mr-1">{hazard.icon} {hazard.title}</strong>
                    <span className="opacity-80">({hazard.segment})</span>
                  </span>
                  <span className="font-mono text-[10px] opacity-90 shrink-0">{hazard.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5 mt-2">
            {getNavigateLink() !== '#' && (
              <a 
                href={getNavigateLink()} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="flex-1 min-w-[80px] bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600/40 text-center py-1.5 px-2 rounded text-xs font-semibold flex items-center justify-center transition-colors"
                title={remainingStops.length < stops.length ? "Navigate remaining stops" : "Launch turn-by-turn navigation"}
              >
                 <span className="mr-1">🧭</span> Navigate{remainingStops.length > 0 && remainingStops.length < stops.length ? ` (${remainingStops.length})` : ''}
              </a>
            )}
            {getStreetViewLink() !== '#' && (
              <a href={getStreetViewLink()} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-[80px] bg-green-600/20 text-green-400 border border-green-500/30 hover:bg-green-600/40 text-center py-1.5 px-2 rounded text-xs font-semibold flex items-center justify-center transition-colors">
                 <span className="mr-1">📸</span> Street
              </a>
            )}
            <button 
              type="button"
              onClick={handleShareJob}
              className="flex-1 min-w-[70px] bg-sky-600/20 text-sky-400 border border-sky-500/30 hover:bg-sky-600/40 text-center py-1.5 px-2 rounded text-xs font-semibold flex items-center justify-center transition-colors"
              title="Share Team Job & Live Pins Link"
            >
              <Share2 size={13} className="mr-1" /> Share
            </button>
            <button 
              type="button"
              onClick={() => openModal('invite', { jobId: job.id, jobName: job.jobName, tab: 'customer' })}
              className={`flex-1 min-w-[78px] text-center py-1.5 px-2 rounded text-xs font-semibold flex items-center justify-center transition-colors border ${
                job.trackingToken
                  ? 'bg-emerald-600/25 text-emerald-300 border-emerald-500/50 hover:bg-emerald-600/40'
                  : 'bg-teal-600/20 text-teal-300 border-teal-500/30 hover:bg-teal-600/40'
              }`}
              title="Customer Live Tracking Link"
            >
              <Radio size={13} className={`mr-1 ${job.trackingToken ? 'animate-pulse text-emerald-400' : ''}`} />
              Track
            </button>
        </div>

        {/* Dispatch Instructions */}
        {visibleInstructions.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-300 block">Dispatch Instructions</span>
            {visibleInstructions.map((inst, idx) => {
              const targetMember = inst.target && inst.target !== 'all'
                ? members.find(m => m.id === inst.target) || activeDrivers.find(d => d.id === inst.target)
                : null;
              const targetLabel = inst.target === currentUser.id
                ? 'For You'
                : (targetMember?.name || targetMember?.email || inst.target);

              return (
                <div
                  key={inst.id || idx}
                  className={`p-2.5 rounded-lg border text-xs ${
                    inst.isPriority
                      ? 'bg-red-950/40 border-red-500/50 text-red-100'
                      : 'bg-gray-800/80 border-gray-700 text-gray-200'
                  }`}
                >
                  <div className="flex items-center flex-wrap gap-1.5 mb-1">
                    {inst.isPriority && (
                      <span className="px-1.5 py-0.5 rounded bg-red-600/40 border border-red-500/60 text-red-200 text-[10px] font-extrabold uppercase flex items-center gap-1">
                        <AlertTriangle size={10} /> Priority
                      </span>
                    )}
                    {inst.target && inst.target !== 'all' && (
                      <span className="px-1.5 py-0.5 rounded bg-sky-600/30 border border-sky-500/40 text-sky-200 text-[10px] font-bold">
                        {isDispatchView ? `To: ${targetLabel}` : targetLabel}
                      </span>
                    )}
                  </div>
                  <p className="leading-snug">{inst.text}</p>
                </div>
              );
            })}
          </div>
        )}

        <div className="text-gray-400 mt-2">
            <strong className="text-gray-200">Team ({job.assignedDrivers?.length || 0}/{job.driversNeeded || 1}):</strong> 
            {job.assignedDrivers?.length > 0 ? (
                <div className="flex flex-wrap gap-2 mt-1">
                   {job.assignedDrivers.map(d => {
                      const activeInfo = activeDrivers.find(ad => ad.id === d.id);
                      const isStale = activeInfo && activeInfo.timestamp && toMillisSafe(activeInfo.timestamp) < fiveMinAgo;
                      const isDriverFinished = (job.completedDrivers || []).includes(d.id);

                      let statusColor = 'bg-gray-500';
                      let statusText = 'Offline';
                      let dotStyle = activeInfo?.color ? { backgroundColor: activeInfo.color } : {};
                      
                      if (isDriverFinished) {
                          statusText = 'Finished';
                          statusColor = 'bg-emerald-500';
                          dotStyle = {};
                      } else if (activeInfo && !isStale) {
                          statusText = 'Available';
                          const isDriving = jobs.some(j => j.status === 'in-progress' && j.assignedDrivers?.some(ad => ad.id === d.id));
                          if (isDriving) statusText = 'Driving';

                          if (!activeInfo.color) {
                              statusColor = statusText === 'Available' ? 'bg-green-500' : 'bg-yellow-500';
                          } else {
                              statusColor = '';
                          }
                      }
                      return (
                          <div key={d.id} className={`flex items-center space-x-2 ${isDriverFinished ? 'bg-emerald-900/40 border-emerald-700/50' : 'bg-gray-800 border-gray-700'} px-2 py-1 rounded border`}>
                             <span className={`w-2 h-2 rounded-full shrink-0 ${statusColor}`} style={dotStyle}></span>
                             <span className="text-xs text-gray-200 font-medium truncate max-w-[80px]">{d.name}</span>
                             <span className={`text-xs ${isDriverFinished ? 'text-emerald-400' : 'text-gray-400'}`}>({statusText})</span>
                          </div>
                      );
                   })}
                </div>
            ) : (
                <span className="text-gray-500 text-xs ml-1">None</span>
            )}
        </div>
        
        {/* Manage Team (Dispatcher) */}
        {isDispatchView && canAssign && (
            <div className="mt-2 bg-gray-800 p-2 rounded">
               <strong className="text-gray-300 text-xs uppercase block mb-1">Manage Team</strong>
               <div className="max-h-28 overflow-y-auto space-y-1">
                 {members.length === 0 ? (
                   <span className="text-xs text-gray-500 italic">No team members found.</span>
                 ) : (
                   members.map(m => {
                      const isDriverAssigned = (job.assignedDrivers || []).some(ad => ad.id === m.id);
                      const activeLoc = activeDrivers.find(ad => ad.id === m.id);
                      const isOnline = activeLoc?.timestamp && toMillisSafe(activeLoc.timestamp) > fiveMinAgo;
                      return (
                          <label key={m.id} className="flex items-center justify-between space-x-2 cursor-pointer py-0.5">
                             <div className="flex items-center space-x-2 truncate">
                               <input 
                                  type="checkbox" 
                                  checked={isDriverAssigned}
                                  onChange={e => handleToggleDriver(m.id, e.target.checked)}
                                  className="rounded bg-gray-600 border-gray-500 text-blue-500 focus:ring-blue-500" 
                               />
                               <span className="text-xs text-gray-300 truncate">{m.name || m.email || m.id}</span>
                             </div>
                             {isOnline && (
                               <span className="text-[10px] text-emerald-400 font-semibold shrink-0">GPS</span>
                             )}
                          </label>
                      );
                   })
                 )}
               </div>
            </div>
        )}
        
        {/* Action Drawers: JOB, ADMIN (dispatch only), REPORT, CHAT */}
        <div className="mt-4 border border-gray-800 rounded-xl bg-slate-900/90 overflow-hidden shadow-lg">
          <div className={`grid ${isDispatchView ? 'grid-cols-4' : 'grid-cols-3'} bg-slate-950 p-1 gap-1 border-b border-gray-800`}>
            <button
              onClick={() => setActiveDrawer(activeDrawer === 'JOB' ? null : 'JOB')}
              className={`py-2.5 px-1 rounded-lg text-[11px] sm:text-xs font-bold transition-all flex items-center justify-center space-x-1 min-h-[44px] ${
                activeDrawer === 'JOB'
                  ? 'bg-blue-600/30 text-blue-400 border border-blue-500/50 shadow-[0_0_10px_rgba(59,130,246,0.3)]'
                  : 'text-gray-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Briefcase size={14} />
              <span>JOB</span>
              <ChevronDown size={12} className={`transition-transform duration-200 ${activeDrawer === 'JOB' ? 'rotate-180 text-blue-400' : 'opacity-60'}`} />
            </button>

            {isDispatchView && (
              <button
                onClick={() => setActiveDrawer(activeDrawer === 'ADMIN' ? null : 'ADMIN')}
                className={`py-2.5 px-1 rounded-lg text-[11px] sm:text-xs font-bold transition-all flex items-center justify-center space-x-1 min-h-[44px] ${
                  activeDrawer === 'ADMIN'
                    ? 'bg-purple-600/30 text-purple-400 border border-purple-500/50 shadow-[0_0_10px_rgba(168,85,247,0.3)]'
                    : 'text-gray-400 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <ShieldAlert size={14} />
                <span>ADMIN</span>
                <ChevronDown size={12} className={`transition-transform duration-200 ${activeDrawer === 'ADMIN' ? 'rotate-180 text-purple-400' : 'opacity-60'}`} />
              </button>
            )}

            <button
              onClick={() => setActiveDrawer(activeDrawer === 'REPORT' ? null : 'REPORT')}
              className={`py-2.5 px-1 rounded-lg text-[11px] sm:text-xs font-bold transition-all flex items-center justify-center space-x-1 min-h-[44px] ${
                activeDrawer === 'REPORT'
                  ? 'bg-teal-600/30 text-teal-400 border border-teal-500/50 shadow-[0_0_10px_rgba(20,184,166,0.3)]'
                  : 'text-gray-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <FileText size={14} />
              <span>REPORT</span>
              {notes.length > 0 && (
                <span className="px-1.5 py-0.2 bg-teal-500/20 text-teal-300 text-[10px] rounded-full font-bold border border-teal-500/30">
                  {notes.length}
                </span>
              )}
              <ChevronDown size={12} className={`transition-transform duration-200 ${activeDrawer === 'REPORT' ? 'rotate-180 text-teal-400' : 'opacity-60'}`} />
            </button>

            <button
              onClick={() => setActiveDrawer(activeDrawer === 'CHAT' ? null : 'CHAT')}
              className={`py-2.5 px-1 rounded-lg text-[11px] sm:text-xs font-bold transition-all flex items-center justify-center space-x-1 min-h-[44px] ${
                activeDrawer === 'CHAT'
                  ? 'bg-emerald-600/30 text-emerald-400 border border-emerald-500/50 shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                  : 'text-gray-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <MessageSquare size={14} />
              <span>CHAT</span>
              {messages.length > 0 && (
                <span className="px-1.5 py-0.2 bg-emerald-500/20 text-emerald-300 text-[10px] rounded-full font-bold border border-emerald-500/30">
                  {messages.length}
                </span>
              )}
              <ChevronDown size={12} className={`transition-transform duration-200 ${activeDrawer === 'CHAT' ? 'rotate-180 text-emerald-400' : 'opacity-60'}`} />
            </button>
          </div>

          {activeDrawer && (
            <div className="p-3 bg-slate-900/80">
              {activeDrawer === 'JOB' && (
                <div className="space-y-3">
                  {canAssign && !isAssigned && (
                    <button
                      onClick={() => updateStatus('in-progress', true)}
                      className="w-full bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/40 rounded-xl py-3.5 px-4 text-xs font-bold shadow-md flex items-center justify-center space-x-2 transition-all min-h-[46px] active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-blue-400"
                    >
                      <UserPlus size={16} />
                      <span>Assign to Me</span>
                    </button>
                  )}

                  {isAssigned && job.status === 'assigned' && (
                    <button
                      onClick={() => updateStatus('in-progress')}
                      className="w-full bg-emerald-600/25 hover:bg-emerald-600/40 text-emerald-200 border border-emerald-500/50 rounded-xl py-3.5 px-4 text-xs font-bold shadow-md flex items-center justify-center space-x-2 transition-all min-h-[46px] active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-emerald-400"
                    >
                      <Play size={16} />
                      <span>Start Trip (En Route)</span>
                    </button>
                  )}

                  {canAssign && isAssigned && (
                    <button
                      onClick={() => updateStatus('unassigned', false, true)}
                      className="w-full bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 rounded-xl py-3.5 px-4 text-xs font-bold shadow-md flex items-center justify-center space-x-2 transition-all min-h-[46px] active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-rose-400"
                    >
                      <UserMinus size={16} />
                      <span>Unassign Me</span>
                    </button>
                  )}

                  {isAssigned && !hasDriverFinished && job.status === 'in-progress' && !isDispatchView && (
                    <button
                      onClick={() => updateStatus('pending-completion')}
                      className="w-full bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 rounded-xl py-3.5 px-4 text-xs font-bold shadow-md flex items-center justify-center space-x-2 transition-all min-h-[46px] active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-amber-400"
                    >
                      <Flag size={16} />
                      <span>Request Completion</span>
                    </button>
                  )}

                  {isAssigned && !hasDriverFinished && job.status !== 'completed' && job.status !== 'archived' && job.status !== 'cancelled' && (
                    <button
                      onClick={handleDriverFinish}
                      className="w-full bg-green-600/20 hover:bg-green-600/30 text-green-300 border border-green-500/40 rounded-xl py-3.5 px-4 text-xs font-bold shadow-md flex items-center justify-center space-x-2 transition-all min-h-[46px] active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-green-400"
                    >
                      <CheckCircle2 size={16} />
                      <span>{job.assignedDrivers?.length > 1 ? "Mark My Part Complete" : "Complete Job"}</span>
                    </button>
                  )}

                  <button
                    onClick={() => openModal('invite', { jobId: job.id, jobName: job.jobName })}
                    className="w-full bg-teal-600/20 hover:bg-teal-600/30 text-teal-300 border border-teal-500/40 rounded-xl py-3.5 px-4 text-xs font-bold shadow-md flex items-center justify-center space-x-2 transition-all min-h-[46px] active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-teal-400"
                  >
                    <QrCode size={16} />
                    <span>Invite / Onboard Driver (QR Code)</span>
                  </button>

                  {isDispatchView && job.status !== 'completed' && job.status !== 'archived' && job.status !== 'cancelled' && (
                    <button
                      onClick={() => updateStatus('completed')}
                      className="w-full bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 rounded-xl py-3.5 px-4 text-xs font-bold shadow-md flex items-center justify-center space-x-2 transition-all min-h-[46px] active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-emerald-400"
                    >
                      <CheckCircle2 size={16} />
                      <span>{job.status === 'pending-completion' ? 'Approve & Complete Job' : 'Complete Job'}</span>
                    </button>
                  )}
                </div>
              )}

              {isDispatchView && activeDrawer === 'ADMIN' && (
                <div className="space-y-3">
                  <button
                    onClick={() => openModal('createJob', { editMode: true, job })}
                    className="w-full bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 rounded-xl py-3.5 px-4 text-xs font-bold shadow-md flex items-center justify-center space-x-2 transition-all min-h-[46px] active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-indigo-400"
                  >
                    <Pencil size={16} />
                    <span>Edit Job</span>
                  </button>

                  {job.status !== 'completed' && job.status !== 'archived' && job.status !== 'cancelled' && (
                    <button
                      onClick={() => updateStatus('cancelled')}
                      className="w-full bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 rounded-xl py-3.5 px-4 text-xs font-bold shadow-md flex items-center justify-center space-x-2 transition-all min-h-[46px] active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-amber-400"
                    >
                      <Slash size={16} />
                      <span>Cancel Job</span>
                    </button>
                  )}

                  {job.status !== 'archived' && (
                    <button
                      onClick={() => updateStatus('archived')}
                      className="w-full bg-slate-700/40 hover:bg-slate-700/60 text-slate-300 border border-slate-600/50 rounded-xl py-3.5 px-4 text-xs font-bold shadow-md flex items-center justify-center space-x-2 transition-all min-h-[46px] active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-slate-400"
                    >
                      <Archive size={16} />
                      <span>Archive Job</span>
                    </button>
                  )}

                  {job.status === 'archived' && (
                    <button
                      onClick={() => updateStatus(job.previousStatus || 'completed')}
                      className="w-full bg-slate-700/40 hover:bg-slate-700/60 text-slate-300 border border-slate-600/50 rounded-xl py-3.5 px-4 text-xs font-bold shadow-md flex items-center justify-center space-x-2 transition-all min-h-[46px] active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-slate-400"
                    >
                      <Archive size={16} />
                      <span>Unarchive Job</span>
                    </button>
                  )}

                  {canDeleteJob && (
                    <button
                      onClick={handleDelete}
                      className="w-full bg-red-950/40 hover:bg-red-900/50 text-red-300 border border-red-700/50 rounded-xl py-3.5 px-4 text-xs font-bold shadow-md flex items-center justify-center space-x-2 transition-all min-h-[46px] active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-red-400"
                    >
                      <Trash2 size={16} />
                      <span>Delete Job</span>
                    </button>
                  )}
                </div>
              )}

              {activeDrawer === 'REPORT' && (
                <div className="space-y-3">
                  <div className="bg-gray-950/60 rounded-xl border border-gray-800/80 p-2.5 max-h-48 overflow-y-auto space-y-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-teal-400 block">
                      Live Progress Updates
                    </span>
                    {notes.length === 0 ? (
                      <p className="text-xs text-gray-500 italic py-2 text-center">No progress updates logged yet.</p>
                    ) : (
                      notes.map(note => (
                        <div key={note.id} className="bg-slate-900/90 border border-slate-800 rounded-lg p-2 text-xs">
                          <div className="flex justify-between items-center text-[10px] text-gray-400 mb-0.5">
                            <span className="font-bold text-teal-300">{note.driverName || 'Driver'}</span>
                            <span>{note.timestamp ? new Date(toMillisSafe(note.timestamp)).toLocaleString() : 'Just now'}</span>
                          </div>
                          <p className="text-gray-200 leading-snug">{note.text}</p>
                        </div>
                      ))
                    )}
                  </div>

                  <button
                    onClick={() => openModal('logProgress', { jobId: job.id, jobName: job.jobName })}
                    className="w-full bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 rounded-xl py-3.5 px-4 text-xs font-bold shadow-md flex items-center justify-center space-x-2 transition-all min-h-[46px] active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-cyan-400"
                  >
                    <MessageSquarePlus size={16} />
                    <span>Log Progress Update</span>
                  </button>

                  <button
                    onClick={() => openModal('podCapture', { jobId: job.id })}
                    className="w-full bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 rounded-xl py-3.5 px-4 text-xs font-bold shadow-md flex items-center justify-center space-x-2 transition-all min-h-[46px] active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-emerald-400"
                  >
                    <ClipboardCheck size={16} />
                    <span>Capture Proof of Delivery (POD)</span>
                  </button>

                  <button
                    onClick={() => openModal('logExpense', { jobId: job.id, jobName: job.jobName })}
                    className="w-full bg-orange-600/20 hover:bg-orange-600/30 text-orange-300 border border-orange-500/40 rounded-xl py-3.5 px-4 text-xs font-bold shadow-md flex items-center justify-center space-x-2 transition-all min-h-[46px] active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-orange-400"
                  >
                    <FileText size={16} />
                    <span>Log Expense</span>
                  </button>

                  <button
                    onClick={() => openModal('expenseLedger')}
                    className="w-full bg-amber-600/15 hover:bg-amber-600/25 text-amber-300 border border-amber-500/35 rounded-xl py-3.5 px-4 text-xs font-bold shadow-md flex items-center justify-center space-x-2 transition-all min-h-[46px] active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-amber-400"
                  >
                    <DollarSign size={16} />
                    <span>{isDispatchView ? 'Company Expense Ledger' : 'My Expenses & Reimbursements'}</span>
                  </button>

                  <button
                    onClick={() => openModal('dvir', { vehicleId: job.vehicleId || '', jobId: job.id })}
                    className="w-full bg-teal-600/20 hover:bg-teal-600/30 text-teal-300 border border-teal-500/40 rounded-xl py-3.5 px-4 text-xs font-bold shadow-md flex items-center justify-center space-x-2 transition-all min-h-[46px] active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-teal-400"
                  >
                    <ClipboardCheck size={16} />
                    <span>Log Vehicle DVIR</span>
                  </button>

                  <button
                    onClick={() => openModal('jobReport', { jobId: job.id })}
                    className="w-full bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-500/40 rounded-xl py-3.5 px-4 text-xs font-bold shadow-md flex items-center justify-center space-x-2 transition-all min-h-[46px] active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-sky-400"
                  >
                    <FileText size={16} />
                    <span>View Job Report</span>
                  </button>
                </div>
              )}

              {activeDrawer === 'CHAT' && (
                <div className="space-y-3">
                  <div className="max-h-60 overflow-y-auto p-2 space-y-2 bg-gray-950/60 rounded-xl border border-gray-800/80">
                    {messages.length === 0 ? (
                      <div className="text-center text-gray-500 text-xs py-4">No messages yet.</div>
                    ) : (
                      messages.map(msg => {
                        const isMe = msg.senderId === currentUser.id;
                        return (
                          <div key={msg.id} className={`max-w-[88%] ${isMe ? 'ml-auto' : 'mr-auto'}`}>
                              <div className={`text-[10px] text-gray-500 mb-0.5 ${isMe ? 'text-right' : 'text-left'}`}>{isMe ? 'You' : msg.senderName}</div>
                              <div className={`p-2 rounded-lg text-xs shadow ${isMe ? 'bg-blue-600 text-white rounded-br-none' : 'bg-gray-800 text-gray-200 rounded-bl-none border border-gray-700/60'}`}>
                                  {msg.text && <div>{msg.text}</div>}
                                  {msg.attachmentUrl && <img src={msg.attachmentUrl} className="w-full rounded mt-1 max-h-32 object-cover cursor-pointer hover:opacity-90" onClick={() => window.open(msg.attachmentUrl)} alt="attachment" />}
                              </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  <form onSubmit={handleSendChat} className="flex flex-col space-y-2">
                     <div className="flex items-center space-x-2">
                        <input 
                          type="text" 
                          value={chatInput} 
                          onChange={e => setChatInput(e.target.value)} 
                          placeholder="Type a message..." 
                          className="flex-1 bg-gray-800/90 text-white rounded-full px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 border border-gray-700"
                        />
                        <label 
                           className="cursor-pointer p-2 bg-gray-800 text-gray-300 hover:text-white rounded-full focus-within:ring-2 focus-within:ring-emerald-500 border border-gray-700 shrink-0" 
                           aria-label="Attach File"
                        >
                           <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"></path></svg>
                           <input type="file" className="sr-only" onChange={e => setChatFile(e.target.files[0])} accept="image/*" />
                        </label>
                     </div>
                     {chatFile && (
                       <div className="text-[11px] text-emerald-400 px-2 truncate flex items-center justify-between">
                         <span>File: {chatFile.name}</span>
                         <button type="button" onClick={() => setChatFile(null)} className="text-red-400 font-bold ml-2">&times;</button>
                       </div>
                     )}
                     <button type="submit" disabled={sending} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl py-2.5 text-xs font-bold shadow disabled:opacity-50 transition-colors">
                        {sending ? 'Sending...' : 'Send Message'}
                     </button>
                  </form>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
