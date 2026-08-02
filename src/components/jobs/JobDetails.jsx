import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useToastStore } from '../../store/useToastStore';
import { useJobs, useActiveDrivers } from '../../hooks/useFirebase';
import { db, storage } from '../../firebase';
import { doc, updateDoc, deleteDoc, collection, addDoc, serverTimestamp, query, onSnapshot, arrayUnion } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
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
  Clock, 
  Slash, 
  Archive, 
  Trash2, 
  MessageSquare,
  MessageSquarePlus 
} from 'lucide-react';

export default function JobDetails({ onClose }) {
  const { selectedJobId, setSelectedJobId, isDispatchView, currentUser, companyId, routeInfo, openModal } = useAppStore();
  const addToast = useToastStore((state) => state.addToast);
  const jobs = useJobs();
  const activeDrivers = useActiveDrivers();
  const job = jobs.find(j => j.id === selectedJobId);
  
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatFile, setChatFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [activeDrawer, setActiveDrawer] = useState('JOB');
  
  const [weather, setWeather] = useState(null);

  // Fetch weather when route destination is available
  useEffect(() => {
    if (routeInfo?.destinationCoords) {
      const { lat, lng } = routeInfo.destinationCoords;
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true&temperature_unit=fahrenheit&windspeed_unit=mph`)
        .then(res => res.json())
        .then(data => {
            if (data?.current_weather) {
                // simple WMO code mapping
                const code = data.current_weather.weathercode;
                let desc = "Clear";
                if (code >= 1 && code <= 3) desc = "Partly Cloudy";
                else if (code >= 51 && code <= 67) desc = "Rain";
                else if (code >= 71 && code <= 77) desc = "Snow";
                else if (code >= 95) desc = "Thunderstorm";
                
                setWeather({
                   temp: data.current_weather.temperature,
                   desc
                });
            }
        })
        .catch(console.error);
    } else {
      setWeather(null);
    }
  }, [routeInfo?.destinationCoords]);

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
      msgs.sort((a,b) => (a.timestamp?.toMillis() || 0) - (b.timestamp?.toMillis() || 0));
      setMessages(msgs);
    }, (error) => {
      if (error.code !== 'permission-denied') {
        console.warn("Job chat snapshot listener error:", error);
      }
    });
    return unsub;
  }, [selectedJobId, companyId, currentUser?.id]);

  if (!selectedJobId) return null;
  if (!job) {
    // Job deleted or not found
    return (
      <div className="absolute right-0 top-0 bottom-0 w-80 bg-gray-900 border-l border-gray-800 p-4 flex flex-col z-20 shadow-2xl">
        <button onClick={() => setSelectedJobId(null)} className="text-gray-400 hover:text-white self-end mb-4">&times;</button>
        <p className="text-gray-400 italic">Job not found.</p>
      </div>
    );
  }

  const isAssigned = (job.assignedDrivers || []).some(d => d.id === currentUser.id);
  const canAssign = job.status !== 'completed' && job.status !== 'archived';

  const updateStatus = async (status, isAssigning = false, isUnassigning = false) => {
    let updates = { status };
    if (isAssigning) {
        updates.assignedDrivers = arrayUnion({ id: currentUser.id, name: currentUser.name });
        if (job.status === 'unassigned') updates.status = 'in-progress';
        else updates.status = job.status;
    } else if (isUnassigning) {
        const currentDrivers = job.assignedDrivers || [];
        updates.assignedDrivers = currentDrivers.filter(d => d.id !== currentUser.id);
        if (updates.assignedDrivers.length === 0 && job.status !== 'completed') {
            updates.status = 'unassigned';
        } else {
            updates.status = job.status;
        }
    }
    
    if (status === 'archived') {
        updates.archived = true;
        updates.previousStatus = job.status;
    } else {
        updates.archived = false;
    }
    if (status === 'completed') updates.completedAt = serverTimestamp();

    await updateDoc(doc(db, `companies/${companyId}/jobs`, job.id), updates);
  };

  const handleToggleDriver = async (driverId, isAdding) => {
    const driver = activeDrivers.find(d => d.id === driverId);
    let updates = {};
    if (isAdding) {
        updates.assignedDrivers = arrayUnion({ id: driver.id, name: driver.name });
        if (job.status === 'unassigned') updates.status = 'in-progress';
    } else {
        const currentDrivers = job.assignedDrivers || [];
        updates.assignedDrivers = currentDrivers.filter(d => d.id !== driverId);
        if (updates.assignedDrivers.length === 0 && job.status !== 'completed') {
            updates.status = 'unassigned';
        }
    }
    await updateDoc(doc(db, `companies/${companyId}/jobs`, job.id), updates);
  };

  const handleDelete = async () => {
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
        const storageRef = ref(storage, `chat_files/${companyId}/${job.id}/${Date.now()}_${chatFile.name}`);
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
    const dests = job.destinations || (job.destination ? [job.destination] : []);
    if (dests.length === 0) return '#';
    
    const finalDest = dests[dests.length - 1];
    let link = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(finalDest)}`;
    
    if (dests.length > 1) {
      const waypoints = dests.slice(0, -1).map(d => encodeURIComponent(d)).join('|');
      link += `&waypoints=${waypoints}`;
    }
    return link;
  };

  const getStreetViewLink = () => {
    if (!routeInfo?.destinationCoords) return '#';
    return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${routeInfo.destinationCoords.lat},${routeInfo.destinationCoords.lng}`;
  };

  return (
    <div className="relative md:absolute right-0 top-0 bottom-0 w-full h-full max-w-full md:max-w-md md:w-80 lg:w-96 bg-gray-900 border-l border-gray-800 flex flex-col z-30 shadow-2xl transition-transform duration-300">
      
      {/* Header */}
      <div className="p-4 border-b border-gray-800 flex justify-between items-start shrink-0">
        <div>
           <h2 className="text-lg font-bold text-white">{job.jobName || 'Unnamed'}</h2>
           <div className="flex flex-wrap items-center gap-2 mt-1">
               <span className="px-2 py-0.5 bg-gray-700 text-xs rounded-full inline-block">{job.status}</span>
               {routeInfo && (
                   <span className="text-teal-400 text-xs font-medium">Est: {routeInfo.duration} ({routeInfo.distance})</span>
               )}
               {weather && (
                   <span className="text-yellow-400 text-xs font-medium" title={weather.desc}>
                      🌡️ {weather.temp}°F {weather.desc}
                   </span>
               )}
           </div>
        </div>
        <button onClick={() => setSelectedJobId(null)} aria-label="Close Job Details" className="text-gray-400 hover:text-white p-2 rounded focus-visible:ring-2 focus-visible:ring-primary-500">&times;</button>
      </div>

      {/* Details */}
      <div className="flex-1 p-4 border-b border-gray-800 overflow-y-auto text-sm space-y-2">
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
        <div className="text-gray-400"><strong className="text-gray-200">Destinations:</strong>
            <ul className="list-decimal ml-5 mt-1 text-xs">
                {(job.destinations || [job.destination]).map((d, i) => <li key={i}>{d}</li>)}
            </ul>
        </div>
        <div className="flex space-x-2 mt-2">
            {getNavigateLink() !== '#' && (
              <a href={getNavigateLink()} target="_blank" rel="noopener noreferrer" className="flex-1 bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600/40 text-center py-1.5 rounded text-xs font-semibold flex items-center justify-center transition-colors">
                 <span className="mr-1">🧭</span> Navigate
              </a>
            )}
            {getStreetViewLink() !== '#' && (
              <a href={getStreetViewLink()} target="_blank" rel="noopener noreferrer" className="flex-1 bg-green-600/20 text-green-400 border border-green-500/30 hover:bg-green-600/40 text-center py-1.5 rounded text-xs font-semibold flex items-center justify-center transition-colors">
                 <span className="mr-1">📸</span> Street View
              </a>
            )}
        </div>
        {job.note && <p className="text-gray-400 p-2 bg-gray-800 rounded italic text-xs mt-2">{job.note}</p>}
        <div className="text-gray-400 mt-2">
            <strong className="text-gray-200">Team ({job.assignedDrivers?.length || 0}/{job.driversNeeded}):</strong> 
            {job.assignedDrivers?.length > 0 ? (
                <div className="flex flex-wrap gap-2 mt-1">
                   {job.assignedDrivers.map(d => {
                      const activeInfo = activeDrivers.find(ad => ad.id === d.id);
                      const isStale = activeInfo && activeInfo.timestamp && activeInfo.timestamp.toMillis() < Date.now() - (5 * 60 * 1000);
                      let statusColor = 'bg-gray-500'; // Offline
                      let statusText = 'Offline';
                      let dotStyle = activeInfo?.color ? { backgroundColor: activeInfo.color } : {};
                      
                      if (activeInfo && !isStale) {
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
                          <div key={d.id} className="flex items-center space-x-2 bg-gray-800 px-2 py-1 rounded border border-gray-700">
                             <span className={`w-2 h-2 rounded-full shrink-0 ${statusColor}`} style={dotStyle}></span>
                             <span className="text-xs text-gray-200 font-medium truncate max-w-[80px]">{d.name}</span>
                             <span className="text-xs text-gray-400">({statusText})</span>
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
               <div className="max-h-24 overflow-y-auto space-y-1">
                 {activeDrivers.map(d => {
                    const isDriverAssigned = (job.assignedDrivers || []).some(ad => ad.id === d.id);
                    return (
                        <label key={d.id} className="flex items-center space-x-2 cursor-pointer">
                           <input 
                              type="checkbox" 
                              checked={isDriverAssigned}
                              onChange={e => handleToggleDriver(d.id, e.target.checked)}
                              className="rounded bg-gray-600 border-gray-500 text-blue-500 focus:ring-blue-500" 
                           />
                           <span className="text-xs text-gray-300">{d.name || d.id}</span>
                        </label>
                    )
                 })}
               </div>
            </div>
        )}
        
        {/* Action Drawers: JOB, ADMIN, REPORT, CHAT */}
        <div className="mt-4 border border-gray-800 rounded-xl bg-slate-900/90 overflow-hidden shadow-lg">
          {/* Header Buttons Bar */}
          <div className="grid grid-cols-4 bg-slate-950 p-1 gap-1 border-b border-gray-800">
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

          {/* Drawer Content Panel */}
          {activeDrawer && (
            <div className="p-3 bg-slate-900/80">
              {/* JOB Drawer */}
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

                  {canAssign && isAssigned && (
                    <button
                      onClick={() => updateStatus('unassigned', false, true)}
                      className="w-full bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 rounded-xl py-3.5 px-4 text-xs font-bold shadow-md flex items-center justify-center space-x-2 transition-all min-h-[46px] active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-rose-400"
                    >
                      <UserMinus size={16} />
                      <span>Unassign Me</span>
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
                      <span>Complete Job</span>
                    </button>
                  )}
                </div>
              )}

              {/* ADMIN Drawer */}
              {activeDrawer === 'ADMIN' && (
                <div className="space-y-3">
                  {isDispatchView && (
                    <button
                      onClick={() => openModal('createJob', { editMode: true, job })}
                      className="w-full bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 rounded-xl py-3.5 px-4 text-xs font-bold shadow-md flex items-center justify-center space-x-2 transition-all min-h-[46px] active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-indigo-400"
                    >
                      <Pencil size={16} />
                      <span>Edit Job</span>
                    </button>
                  )}

                  {isAssigned && job.status !== 'pending-completion' && (
                    <button
                      onClick={() => updateStatus('pending-completion')}
                      className="w-full bg-green-600/20 hover:bg-green-600/30 text-green-300 border border-green-500/40 rounded-xl py-3.5 px-4 text-xs font-bold shadow-md flex items-center justify-center space-x-2 transition-all min-h-[46px] active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-green-400"
                    >
                      <Clock size={16} />
                      <span>Request Completion</span>
                    </button>
                  )}

                  {isDispatchView && job.status !== 'completed' && job.status !== 'archived' && job.status !== 'cancelled' && (
                    <button
                      onClick={() => updateStatus('cancelled')}
                      className="w-full bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 rounded-xl py-3.5 px-4 text-xs font-bold shadow-md flex items-center justify-center space-x-2 transition-all min-h-[46px] active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-amber-400"
                    >
                      <Slash size={16} />
                      <span>Cancel Job</span>
                    </button>
                  )}

                  {isDispatchView && job.status !== 'archived' && (
                    <button
                      onClick={() => updateStatus('archived')}
                      className="w-full bg-slate-700/40 hover:bg-slate-700/60 text-slate-300 border border-slate-600/50 rounded-xl py-3.5 px-4 text-xs font-bold shadow-md flex items-center justify-center space-x-2 transition-all min-h-[46px] active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-slate-400"
                    >
                      <Archive size={16} />
                      <span>Archive Job</span>
                    </button>
                  )}

                  {isDispatchView && job.status === 'archived' && (
                    <button
                      onClick={() => updateStatus(job.previousStatus || 'completed')}
                      className="w-full bg-slate-700/40 hover:bg-slate-700/60 text-slate-300 border border-slate-600/50 rounded-xl py-3.5 px-4 text-xs font-bold shadow-md flex items-center justify-center space-x-2 transition-all min-h-[46px] active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-slate-400"
                    >
                      <Archive size={16} />
                      <span>Unarchive Job</span>
                    </button>
                  )}

                  {isDispatchView && (
                    <button
                      onClick={handleDelete}
                      className="w-full bg-red-950/40 hover:bg-red-900/50 text-red-300 border border-red-700/50 rounded-xl py-3.5 px-4 text-xs font-bold shadow-md flex items-center justify-center space-x-2 transition-all min-h-[46px] active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-red-400"
                    >
                      <Trash2 size={16} />
                      <span>Delete Job</span>
                    </button>
                  )}

                  {!isDispatchView && (!isAssigned || job.status === 'pending-completion') && (
                    <p className="text-gray-500 text-xs italic text-center py-2">No admin actions available.</p>
                  )}
                </div>
              )}

              {/* REPORT Drawer */}
              {activeDrawer === 'REPORT' && (
                <div className="space-y-3">
                  <button
                    onClick={() => openModal('logProgress', { jobId: job.id, jobName: job.jobName })}
                    className="w-full bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 rounded-xl py-3.5 px-4 text-xs font-bold shadow-md flex items-center justify-center space-x-2 transition-all min-h-[46px] active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-cyan-400"
                  >
                    <MessageSquarePlus size={16} />
                    <span>Log Progress Update</span>
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

              {/* CHAT Drawer */}
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
