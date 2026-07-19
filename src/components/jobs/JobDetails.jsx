import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useToastStore } from '../../store/useToastStore';
import { useJobs, useActiveDrivers } from '../../hooks/useFirebase';
import { db, storage } from '../../firebase';
import { doc, updateDoc, deleteDoc, collection, addDoc, serverTimestamp, query, onSnapshot, arrayUnion } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

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
    if (!selectedJobId || !companyId) {
      setMessages([]);
      return;
    }
    const q = query(collection(db, `companies/${companyId}/jobs/${selectedJobId}/chat`));
    const unsub = onSnapshot(q, (snap) => {
      const msgs = [];
      snap.forEach(d => msgs.push({ id: d.id, ...d.data() }));
      msgs.sort((a,b) => (a.timestamp?.toMillis() || 0) - (b.timestamp?.toMillis() || 0));
      setMessages(msgs);
    });
    return unsub;
  }, [selectedJobId, companyId]);

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
    <div className="absolute right-0 top-0 bottom-0 w-80 lg:w-96 bg-gray-900 border-l border-gray-800 flex flex-col z-20 shadow-2xl transition-transform duration-300">
      
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
        <p className="text-gray-400"><strong className="text-gray-200">From:</strong> {job.origin}</p>
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
        
        {/* Actions */}
        <div className="grid grid-cols-2 gap-3 mt-4">
           {canAssign && !isAssigned && <button onClick={() => updateStatus('in-progress', true)} className="bg-blue-600 hover:bg-blue-700 text-white rounded py-2 text-xs font-semibold shadow focus-visible:ring-2 focus-visible:ring-white">Assign to Me</button>}
           {canAssign && isAssigned && <button onClick={() => updateStatus('unassigned', false, true)} className="bg-red-600 hover:bg-red-700 text-white rounded py-2 text-xs font-semibold shadow focus-visible:ring-2 focus-visible:ring-white">Unassign Me</button>}
           {isAssigned && job.status !== 'pending-completion' && <button onClick={() => updateStatus('pending-completion')} className="bg-green-600 hover:bg-green-700 text-white rounded py-2 text-xs font-semibold shadow focus-visible:ring-2 focus-visible:ring-white">Request Completion</button>}
           
           {isDispatchView && job.status !== 'completed' && job.status !== 'archived' && job.status !== 'cancelled' && (
             <>
               <button onClick={() => updateStatus('completed')} className="bg-green-700 hover:bg-green-600 text-white rounded py-2 text-xs font-semibold shadow focus-visible:ring-2 focus-visible:ring-white">Complete Job</button>
               <button onClick={() => updateStatus('cancelled')} className="bg-orange-700 hover:bg-orange-600 text-white rounded py-2 text-xs font-semibold shadow focus-visible:ring-2 focus-visible:ring-white">Cancel Job</button>
             </>
           )}
           {isDispatchView && job.status !== 'archived' && <button onClick={() => updateStatus('archived')} className="bg-gray-700 hover:bg-gray-600 border border-gray-500 text-white rounded py-2 text-xs font-semibold shadow focus-visible:ring-2 focus-visible:ring-white">Archive</button>}
           {isDispatchView && job.status === 'archived' && <button onClick={() => updateStatus(job.previousStatus || 'completed')} className="bg-gray-600 hover:bg-gray-500 border border-gray-400 text-white rounded py-2 text-xs font-semibold shadow focus-visible:ring-2 focus-visible:ring-white">Unarchive</button>}
           {isDispatchView && <button onClick={() => openModal('createJob', { editMode: true, job })} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded py-2 text-xs font-semibold shadow col-span-2 mt-2 focus-visible:ring-2 focus-visible:ring-white">Edit Job</button>}
           <button onClick={() => openModal('invite')} className="bg-teal-600 hover:bg-teal-700 text-white rounded py-2 text-xs font-semibold shadow col-span-2 focus-visible:ring-2 focus-visible:ring-white">Invite Others to Job</button>
           {isDispatchView && <button onClick={handleDelete} className="bg-red-900 hover:bg-red-800 text-red-200 rounded py-2 text-xs font-semibold shadow col-span-2 focus-visible:ring-2 focus-visible:ring-white">Delete Job</button>}
        </div>
      </div>

      {/* Chat */}
      <div className="h-[30%] min-h-[150px] shrink-0 overflow-y-auto p-4 space-y-2 bg-gray-850">
        {messages.length === 0 ? (
          <div className="text-center text-gray-500 text-xs mt-4">No messages yet.</div>
        ) : (
          messages.map(msg => {
            const isMe = msg.senderId === currentUser.id;
            return (
              <div key={msg.id} className={`max-w-[85%] ${isMe ? 'ml-auto' : 'mr-auto'}`}>
                  <div className={`text-xs text-gray-500 mb-0.5 ${isMe ? 'text-right' : 'text-left'}`}>{isMe ? 'You' : msg.senderName}</div>
                  <div className={`p-2 rounded-lg text-sm shadow ${isMe ? 'bg-blue-600 text-white rounded-br-none' : 'bg-gray-700 text-gray-200 rounded-bl-none'}`}>
                      {msg.text && <div>{msg.text}</div>}
                      {msg.attachmentUrl && <img src={msg.attachmentUrl} className="w-full rounded mt-1 max-h-32 object-cover cursor-pointer hover:opacity-90" onClick={() => window.open(msg.attachmentUrl)} alt="attachment" />}
                  </div>
              </div>
            );
          })
        )}
      </div>

      {/* Chat Input */}
      <div className="p-3 bg-gray-800 border-t border-gray-700 shrink-0">
         <form onSubmit={handleSendChat} className="flex flex-col space-y-2">
            <div className="flex items-center space-x-2">
               <input 
                 type="text" 
                 value={chatInput} 
                 onChange={e => setChatInput(e.target.value)} 
                 placeholder="Type a message..." 
                 className="flex-1 bg-gray-700 text-white rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
               />
               <label 
                  className="cursor-pointer p-2 bg-gray-700 text-gray-300 hover:text-white rounded-full focus-within:ring-2 focus-within:ring-blue-500" 
                  aria-label="Attach File"
               >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"></path></svg>
                  <input type="file" className="sr-only" onChange={e => setChatFile(e.target.files[0])} accept="image/*" />
               </label>
            </div>
            {chatFile && <div className="text-xs text-blue-400 px-2 truncate">File: {chatFile.name} <button type="button" onClick={() => setChatFile(null)} className="text-red-400 ml-2">&times;</button></div>}
            <button type="submit" disabled={sending} className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded py-2 text-sm font-bold shadow disabled:opacity-50">
               {sending ? 'Sending...' : 'Send'}
            </button>
         </form>
      </div>

    </div>
  );
}
