import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useToastStore } from '../../store/useToastStore';
import { useActiveDrivers, useCompany, useJobs, useVehicles } from '../../hooks/useFirebase';
import { db } from '../../firebase';
import { collection, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { sortDriverRoster } from '../../utils/roster';
import { normalizeJobStops } from '../../utils/stops';
import {
  fetchLiveTrafficEtas,
  geocodeAddressCached,
  rankDriversByProximity,
} from '../../utils/proximityDispatch';
import PlacesAutocompleteInput from '../common/PlacesAutocompleteInput';
import { Clock, MapPin, Star, Truck, Zap } from 'lucide-react';

const MAX_STOPS = 25;

function geocodeAddressWithTimeout(geocoder, address, timeoutMs = 3000) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, timeoutMs);

    geocoder.geocode({ address }, (results, status) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (status === 'OK' && results?.[0]?.geometry?.location) {
        const loc = results[0].geometry.location;
        const lat = typeof loc.lat === 'function' ? loc.lat() : loc.lat;
        const lng = typeof loc.lng === 'function' ? loc.lng() : loc.lng;
        if (typeof lat === 'number' && typeof lng === 'number') {
          resolve({ lat, lng });
          return;
        }
      }
      resolve(null);
    });
  });
}

async function geocodeMissingStops(stops) {
  const needsGeocode = stops.some((s) => typeof s.lat !== 'number' || typeof s.lng !== 'number');
  if (!needsGeocode || typeof window === 'undefined' || !window.google?.maps?.Geocoder) {
    return stops;
  }
  const geocoder = new window.google.maps.Geocoder();
  return Promise.all(
    stops.map(async (stop) => {
      if (typeof stop.lat === 'number' && typeof stop.lng === 'number') return stop;
      const coords = await geocodeAddressWithTimeout(geocoder, stop.address, 3000);
      if (coords) {
        return { ...stop, lat: coords.lat, lng: coords.lng };
      }
      return stop;
    })
  );
}

function makeEmptyStop(idx = 0) {
  return {
    id: `stop_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
    address: '',
    lat: null,
    lng: null,
    status: 'pending',
    arrivedAt: null,
    completedAt: null,
    arriveBy: '',
    serviceMinutes: '',
  };
}

export default function CreateJobModal() {
  const { modals, closeModal, companyId, currentUser } = useAppStore();
  const addToast = useToastStore((state) => state.addToast);
  const activeDrivers = useActiveDrivers();
  const { members } = useCompany();
  const jobs = useJobs();
  const vehicles = useVehicles();
  
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [origin, setOrigin] = useState('');
  const [originCoords, setOriginCoords] = useState(null);
  const [stopsState, setStopsState] = useState([makeEmptyStop(0)]);
  const [date, setDate] = useState('');
  const [instructions, setInstructions] = useState([]);
  const [contactName, setContactName] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [optimize, setOptimize] = useState(true);
  const [assignedDriverIds, setAssignedDriverIds] = useState([]);
  const [vehicleId, setVehicleId] = useState('');
  const [jobStatus, setJobStatus] = useState('unassigned');
  const [matrixOverrides, setMatrixOverrides] = useState({});
  const [fetchingEtas, setFetchingEtas] = useState(false);

  const modalData = modals.createJob;
  const isEditing = typeof modalData === 'object' && modalData.editMode === true;
  const editingJob = isEditing ? modalData.job : null;

  const sortedRoster = sortDriverRoster(members);
  const nextRosterDriver = sortedRoster.find(m => (m.onDutyStatus || 'on_duty') === 'on_duty');

  const rankedDrivers = rankDriversByProximity({
    originCoords,
    members,
    activeDrivers,
    jobs,
    matrixOverrides,
  });

  const autoAttachVehicleForDriver = (driverId) => {
    if (vehicleId) return;
    const matched = vehicles.find(
      (v) => v.assignedDriverId === driverId && v.status !== 'out_of_service'
    );
    if (matched) {
      setVehicleId(matched.id);
    }
  };

  const handleSelectNextInRoster = () => {
    if (!nextRosterDriver) {
      addToast("No on-duty drivers available in the roster", "info");
      return;
    }
    if (!assignedDriverIds.includes(nextRosterDriver.id)) {
      setAssignedDriverIds([...assignedDriverIds, nextRosterDriver.id]);
      autoAttachVehicleForDriver(nextRosterDriver.id);
      addToast(`Assigned ${nextRosterDriver.name || nextRosterDriver.email} from Roster`, "success");
    } else {
      addToast(`${nextRosterDriver.name || nextRosterDriver.email} is already selected`, "info");
    }
  };

  const handleSelectNearestDriver = async () => {
    let coords = originCoords;
    if (!coords && origin.trim()) {
      coords = await geocodeAddressCached(origin.trim());
      if (coords) setOriginCoords(coords);
    }
    const ranked = rankDriversByProximity({
      originCoords: coords,
      members,
      activeDrivers,
      jobs,
      matrixOverrides,
    });
    const best =
      ranked.find((c) => c.duty !== 'off_duty' && !c.isBusy) ||
      ranked.find((c) => c.duty !== 'off_duty') ||
      ranked[0];
    if (!best) {
      addToast("No drivers available to assign", "info");
      return;
    }
    const bestName = best.member.name || best.member.email;
    if (!assignedDriverIds.includes(best.member.id)) {
      setAssignedDriverIds([...assignedDriverIds, best.member.id]);
      autoAttachVehicleForDriver(best.member.id);
    }
    if (best.etaLabel) {
      addToast(`Selected nearest driver: ${bestName} (${best.distanceLabel || ''} • ${best.etaLabel})`, "success");
    } else {
      addToast(`Selected ${bestName} (no live GPS/origin coordinates)`, "info");
    }
  };

  const handleFetchLiveEtas = async () => {
    if (!origin.trim()) {
      addToast("Enter an origin address first", "error");
      return;
    }
    setFetchingEtas(true);
    try {
      let coords = originCoords;
      if (!coords) {
        coords = await geocodeAddressCached(origin.trim());
        if (coords) setOriginCoords(coords);
      }
      if (!coords) {
        addToast("Could not locate origin address for live traffic ETAs", "error");
        return;
      }
      const ranked = rankDriversByProximity({
        originCoords: coords,
        members,
        activeDrivers,
        jobs,
        matrixOverrides: {},
      });
      const overrides = await fetchLiveTrafficEtas(coords, ranked);
      setMatrixOverrides(overrides);
      if (Object.keys(overrides).length === 0) {
        addToast("No drivers with fresh GPS coordinates to score live traffic", "info");
      } else {
        addToast(`Updated live traffic ETAs for ${Object.keys(overrides).length} driver(s)`, "success");
      }
    } finally {
      setFetchingEtas(false);
    }
  };

  useEffect(() => {
     let cancelled = false;
     if (modals.createJob) {
        setMatrixOverrides({});
        if (isEditing && editingJob) {
           setName(editingJob.jobName || '');
           setOrigin(editingJob.origin || '');
           setOriginCoords(null);
           if (editingJob.origin) {
             geocodeAddressCached(editingJob.origin).then((coords) => {
               if (!cancelled && coords) setOriginCoords(coords);
             });
           }
           const existingStops = normalizeJobStops(editingJob).map((s) => ({
             ...s,
             arriveBy: s.arriveBy || '',
             serviceMinutes: typeof s.serviceMinutes === 'number' ? String(s.serviceMinutes) : '',
           }));
           setStopsState(existingStops.length > 0 ? existingStops : [makeEmptyStop(0)]);
           setDate(editingJob.jobDate || '');
           if (editingJob.instructions) {
              setInstructions(editingJob.instructions);
           } else if (editingJob.note) {
              setInstructions([{ id: Date.now().toString(), text: editingJob.note, target: 'all', isPriority: false }]);
           } else {
              setInstructions([]);
           }
           setContactName(editingJob.contactName || '');
           setContactNumber(editingJob.contactNumber || '');
           setOptimize(editingJob.optimizeRoute !== false);
           setAssignedDriverIds((editingJob.assignedDrivers || []).map(d => d.id));
           setVehicleId(editingJob.vehicleId || '');
           setJobStatus(editingJob.status || 'unassigned');
        } else {
           setName(''); setOrigin(''); setOriginCoords(null); setStopsState([makeEmptyStop(0)]); setDate(''); setInstructions([]);
           setContactName(''); setContactNumber(''); setAssignedDriverIds([]); setVehicleId('');
           setOptimize(true);
           setJobStatus('unassigned');
        }
     }
     return () => {
       cancelled = true;
     };
  }, [modals.createJob, isEditing, editingJob]);

  if (!modals.createJob) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validStops = stopsState
      .map((s, idx) => {
        const parsedService =
          s.serviceMinutes !== '' && s.serviceMinutes != null && !Number.isNaN(Number(s.serviceMinutes))
            ? Math.max(0, Math.min(480, Math.round(Number(s.serviceMinutes))))
            : null;
        return {
          id: s.id || `stop_${idx}`,
          address: (s.address || '').trim(),
          lat: typeof s.lat === 'number' ? s.lat : null,
          lng: typeof s.lng === 'number' ? s.lng : null,
          order: idx,
          status: s.status || 'pending',
          arrivedAt: s.arrivedAt || null,
          completedAt: s.completedAt || null,
          arriveBy: s.arriveBy ? String(s.arriveBy).trim() : null,
          serviceMinutes: parsedService,
        };
      })
      .filter(s => s.address);

    if (!name.trim() || !origin.trim() || validStops.length === 0) {
      addToast("Please fill all required fields", "error");
      return;
    }

    setLoading(true);
    try {
      const geocodedStops = await geocodeMissingStops(validStops);
      const assignedDrivers = assignedDriverIds.map(id => {
         const driver = members.find(m => m.id === id) || activeDrivers.find(d => d.id === id);
         return { id, name: driver ? (driver.name || driver.email) : id };
      });
      const selectedVehicle = vehicles.find((v) => v.id === vehicleId) || null;
      const vehicleLabel = selectedVehicle
        ? `${selectedVehicle.unitNumber}${selectedVehicle.makeModel ? ` • ${selectedVehicle.makeModel}` : ''}`.slice(0, 120)
        : null;

      const initialStatus = isEditing 
        ? jobStatus 
        : (assignedDrivers.length > 0 ? 'assigned' : 'unassigned');

      const jobData = {
        jobName: name.trim(),
        jobDate: date,
        origin: origin.trim(),
        destinations: geocodedStops.map(s => s.address),
        stops: geocodedStops,
        optimizeRoute: optimize,
        contactName: contactName.trim(),
        contactNumber: contactNumber.trim(),
        driversNeeded: assignedDrivers.length > 0 ? assignedDrivers.length : 1,
        instructions: instructions.map(i => ({ ...i, text: i.text.trim() })).filter(i => i.text),
        note: '',
        assignedDrivers,
        assignedDriverIds: assignedDrivers.map(d => d.id),
        vehicleId: selectedVehicle ? selectedVehicle.id : null,
        vehicleLabel,
      };

      if (isEditing) {
        await updateDoc(doc(db, `companies/${companyId}/jobs`, editingJob.id), {
           ...jobData,
           status: initialStatus,
           archived: initialStatus === 'archived',
           updatedAt: serverTimestamp()
        });
        addToast("Job updated successfully.", "success");
      } else {
        await addDoc(collection(db, `companies/${companyId}/jobs`), {
          ...jobData,
          status: initialStatus,
          createdBy: currentUser.id,
          createdAt: serverTimestamp(),
          archived: false
        });
        addToast("Job created successfully.", "success");
      }

      const maxOrder = members.reduce(
        (maxVal, m) => Math.max(maxVal, typeof m.rosterOrder === 'number' ? m.rosterOrder : 0),
        members.length
      );
      for (let idx = 0; idx < assignedDriverIds.length; idx++) {
        const dId = assignedDriverIds[idx];
        try {
          const memberUpdates = { lastDispatchedAt: serverTimestamp() };
          if (!isEditing) {
            memberUpdates.rosterOrder = maxOrder + 1 + idx;
          }
          await updateDoc(doc(db, `companies/${companyId}/members/${dId}`), memberUpdates);
        } catch (e) {
          console.warn("Could not update rotation for driver:", dId, e);
        }
      }
      
      closeModal('createJob');
    } catch (err) {
      console.error(err);
      addToast("Failed to save job", "error");
    }
    setLoading(false);
  };

  const handleClose = () => {
    const isDirty = name !== '' || origin !== '' || stopsState.some(s => s.address !== '') || date !== '' || instructions.length > 0 || contactName !== '' || contactNumber !== '' || assignedDriverIds.length > 0 || (!isEditing && vehicleId !== '') || !optimize;
    if (isDirty) {
      if (!window.confirm("You have unsaved changes. Are you sure you want to close without saving?")) {
        return;
      }
    }
    closeModal('createJob');
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div 
        className="bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl border border-gray-700 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-700 flex justify-between items-center shrink-0">
          <h2 className="text-xl font-bold text-white">{isEditing ? 'Edit Job' : 'Create New Job'}</h2>
          <button onClick={handleClose} aria-label="Close" className="text-gray-400 hover:text-white p-2 rounded focus-visible:ring-2 focus-visible:ring-primary-500">&times;</button>
        </div>
        
        <div className="p-4 overflow-y-auto flex-1">
          <form id="create-job-form" onSubmit={handleSubmit} className="space-y-4">
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-300 uppercase mb-1">Job Name *</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full bg-gray-700 text-white rounded p-2 focus:ring-2 focus:ring-blue-500 outline-none border border-gray-600" required />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-300 uppercase mb-1">Date</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full bg-gray-700 text-white rounded p-2 focus:ring-2 focus:ring-blue-500 outline-none border border-gray-600" />
              </div>
            </div>

            <div>
              <label htmlFor="job-origin-input" className="block text-sm font-bold text-gray-300 uppercase mb-1">Origin Address *</label>
              <PlacesAutocompleteInput 
                 id="job-origin-input"
                 aria-label="Origin Address"
                 value={origin} 
                 onChange={(val) => {
                   setOrigin(val);
                   setOriginCoords(null);
                   setMatrixOverrides({});
                 }} 
                 onSelectPlace={({ address, lat, lng }) => {
                   setOrigin(address);
                   setOriginCoords(typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null);
                   setMatrixOverrides({});
                 }}
                 placeholder="Start Address" 
                 className="w-full bg-gray-700 text-white rounded p-2 focus:ring-2 focus:ring-blue-500 outline-none border border-gray-600" 
                 required 
              />
            </div>

            <div>
              <div className="flex justify-between items-end mb-1">
                 <label className="block text-sm font-bold text-gray-300 uppercase">Destinations *</label>
                 <div className="flex items-center gap-2">
                   {stopsState.length >= MAX_STOPS && (
                     <span className="text-[11px] text-amber-400 font-semibold">Max {MAX_STOPS} stops</span>
                   )}
                   <button
                     type="button"
                     disabled={stopsState.length >= MAX_STOPS}
                     onClick={() => {
                       if (stopsState.length < MAX_STOPS) {
                         setStopsState([...stopsState, makeEmptyStop(stopsState.length)]);
                       }
                     }}
                     className="text-sm bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded focus-visible:ring-2 focus-visible:ring-primary-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                   >
                     + Add Stop
                   </button>
                 </div>
              </div>
              <div className="space-y-2">
                 {stopsState.map((stop, i) => (
                    <div key={stop.id || i} className="bg-gray-700/35 p-2 rounded-lg border border-gray-700/80 space-y-1.5">
                      <div className="flex space-x-2 relative">
                        <PlacesAutocompleteInput 
                           aria-label={`Stop ${i + 1} Address`}
                           value={stop.address} 
                           onChange={(val) => {
                               const stopKey = stop.id;
                               setStopsState((prev) =>
                                 prev.map((item, idx) =>
                                   (stopKey ? item.id === stopKey : idx === i)
                                     ? { ...item, address: val, lat: null, lng: null }
                                     : item
                                 )
                               );
                           }}
                           onSelectPlace={({ address, lat, lng }) => {
                               const stopKey = stop.id;
                               setStopsState((prev) =>
                                 prev.map((item, idx) =>
                                   (stopKey ? item.id === stopKey : idx === i)
                                     ? {
                                         ...item,
                                         address,
                                         lat: typeof lat === 'number' ? lat : null,
                                         lng: typeof lng === 'number' ? lng : null,
                                       }
                                     : item
                                 )
                               );
                           }}
                           placeholder={`Stop ${i + 1} Address`} 
                           className="w-full bg-gray-700 text-white rounded p-2 text-sm border border-gray-600 focus:border-blue-500" 
                           required 
                        />
                        {stopsState.length > 1 && (
                           <button type="button" aria-label="Remove Stop" onClick={() => setStopsState(stopsState.filter((_, idx) => idx !== i))} className="px-3 py-2 text-red-500 hover:text-red-400 font-bold bg-gray-700 rounded border border-gray-600 focus-visible:ring-2 focus-visible:ring-red-500 transition-colors">&times;</button>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-300">
                        <label className="flex items-center gap-1.5">
                          <Clock size={12} className="text-sky-400" />
                          <span className="text-[11px] text-gray-400 font-semibold">Arrive By</span>
                          <input
                            type="time"
                            value={stop.arriveBy || ''}
                            onChange={(e) => {
                              const next = [...stopsState];
                              next[i] = { ...next[i], arriveBy: e.target.value };
                              setStopsState(next);
                            }}
                            className="bg-gray-700 text-white rounded px-2 py-1 text-xs border border-gray-600 focus:border-blue-500 outline-none"
                          />
                        </label>
                        <label className="flex items-center gap-1.5">
                          <span className="text-[11px] text-gray-400 font-semibold">Dwell (min)</span>
                          <input
                            type="number"
                            min="0"
                            max="480"
                            placeholder="e.g. 15"
                            value={stop.serviceMinutes ?? ''}
                            onChange={(e) => {
                              const next = [...stopsState];
                              next[i] = { ...next[i], serviceMinutes: e.target.value };
                              setStopsState(next);
                            }}
                            className="w-20 bg-gray-700 text-white rounded px-2 py-1 text-xs border border-gray-600 focus:border-blue-500 outline-none"
                          />
                        </label>
                      </div>
                    </div>
                 ))}
              </div>
              <label className="flex items-center mt-2 space-x-2 cursor-pointer">
                <input type="checkbox" checked={optimize} onChange={e => setOptimize(e.target.checked)} className="rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-500" />
                <span className="text-sm text-gray-300">Automatically Optimize Route Order (TSP)</span>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-gray-700">
               <div>
                 <label className="block text-sm font-bold text-gray-300 uppercase mb-1">Contact Name</label>
                 <input type="text" value={contactName} onChange={e => setContactName(e.target.value)} className="w-full bg-gray-700 text-white rounded p-2 focus:ring-2 focus:ring-blue-500 outline-none border border-gray-600" />
               </div>
               <div>
                 <label className="block text-sm font-bold text-gray-300 uppercase mb-1">Contact Number</label>
                 <input type="tel" value={contactNumber} onChange={e => setContactNumber(e.target.value)} className="w-full bg-gray-700 text-white rounded p-2 focus:ring-2 focus:ring-blue-500 outline-none border border-gray-600" />
               </div>
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-sm font-bold text-gray-300 uppercase mb-1">
                <Truck size={14} className="text-sky-400" />
                <span>Assign Vehicle</span>
              </label>
              <select
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
                className="w-full bg-gray-700 text-white rounded p-2 text-sm border border-gray-600 focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="">-- No vehicle assigned --</option>
                {vehicles.map((v) => {
                  const isOos = v.status === 'out_of_service';
                  const statusNote =
                    v.status === 'out_of_service'
                      ? 'OUT OF SERVICE'
                      : v.status === 'maintenance'
                        ? 'Maintenance'
                        : 'Active';
                  return (
                    <option key={v.id} value={v.id} disabled={isOos}>
                      {v.unitNumber}
                      {v.makeModel ? ` • ${v.makeModel}` : ''} ({statusNote})
                    </option>
                  );
                })}
              </select>
            </div>

            <div>
              <div className="flex flex-wrap justify-between items-center gap-1.5 mb-1.5">
                <label className="block text-sm font-bold text-gray-300 uppercase">Assign Team</label>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleSelectNearestDriver}
                    className="flex items-center space-x-1 text-xs bg-emerald-600/25 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/40 px-2.5 py-1 rounded-lg transition-colors font-medium cursor-pointer"
                    title="Select closest available driver to origin"
                  >
                    <MapPin size={12} />
                    <span>Nearest Driver</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleFetchLiveEtas}
                    disabled={fetchingEtas}
                    className="flex items-center space-x-1 text-xs bg-indigo-600/25 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-500/40 px-2.5 py-1 rounded-lg transition-colors font-medium cursor-pointer disabled:opacity-50"
                    title="Score drivers using Google Distance Matrix live traffic"
                  >
                    <Clock size={12} />
                    <span>{fetchingEtas ? 'Scoring...' : 'Live ETA'}</span>
                  </button>
                  {nextRosterDriver && (
                    <button
                      type="button"
                      onClick={handleSelectNextInRoster}
                      className="flex items-center space-x-1.5 text-xs bg-sky-600/30 hover:bg-sky-600/50 text-sky-300 border border-sky-500/40 px-2.5 py-1 rounded-lg transition-colors font-medium cursor-pointer"
                      title={`Next up in rotation: ${nextRosterDriver.name || nextRosterDriver.email}`}
                    >
                      <Zap size={12} className="text-amber-400 fill-amber-400" />
                      <span>Next in Roster ({nextRosterDriver.name || nextRosterDriver.email})</span>
                    </button>
                  )}
                </div>
              </div>
              <div className="w-full bg-gray-700/80 rounded-xl p-2 border border-gray-600 max-h-40 overflow-y-auto space-y-1">
                 {rankedDrivers.length === 0 && <span className="text-gray-400 text-xs italic">No team members registered.</span>}
                 {rankedDrivers.map((cand) => {
                    const d = cand.member;
                    const isPriority = !!d.isPriorityDriver;
                    const duty = cand.duty;
                    const isAssigned = assignedDriverIds.includes(d.id);
                    return (
                      <label key={d.id} className="flex items-center justify-between gap-2 p-1.5 hover:bg-gray-600/40 rounded-lg cursor-pointer transition-colors">
                         <div className="flex items-center space-x-2 min-w-0">
                           <input 
                              type="checkbox" 
                              checked={isAssigned}
                              onChange={e => {
                                 if (e.target.checked) {
                                   setAssignedDriverIds([...assignedDriverIds, d.id]);
                                   autoAttachVehicleForDriver(d.id);
                                 } else {
                                   setAssignedDriverIds(assignedDriverIds.filter(id => id !== d.id));
                                 }
                              }}
                              className="rounded bg-gray-600 border-gray-500 text-blue-500 focus:ring-blue-500 shrink-0" 
                           />
                           <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color || '#22c55e' }} />
                           <span className="text-xs text-gray-200 font-semibold truncate">{d.name || d.email}</span>
                           {isPriority && (
                             <span className="text-amber-400 text-xs flex items-center shrink-0" title="Priority Driver">
                               <Star size={11} className="fill-amber-400" />
                             </span>
                           )}
                           {cand.isBusy && (
                             <span className="text-[10px] bg-orange-900/60 text-orange-300 border border-orange-500/30 px-1 py-0.5 rounded font-semibold shrink-0">
                               Busy
                             </span>
                           )}
                         </div>
                         <div className="flex items-center space-x-1.5 shrink-0">
                           {(cand.distanceLabel || cand.etaLabel) && (
                             <span
                               className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                                 cand.isLiveTraffic
                                   ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-500/40'
                                   : 'bg-gray-800 text-sky-300 border border-gray-600'
                               }`}
                               title={cand.isLiveTraffic ? 'Google live traffic ETA' : 'Estimated road distance & ETA'}
                             >
                               {cand.distanceLabel || ''}
                               {cand.distanceLabel && cand.etaLabel ? ' • ' : ''}
                               {cand.etaLabel || ''}
                             </span>
                           )}
                           <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                             duty === 'on_duty' ? 'bg-emerald-900/60 text-emerald-300' :
                             duty === 'break' ? 'bg-amber-900/60 text-amber-300' : 'bg-gray-800 text-gray-400'
                           }`}>
                             {duty === 'on_duty' ? 'On Duty' : duty === 'break' ? 'Break' : 'Off Duty'}
                           </span>
                           {cand.hasFreshGps && (
                             <span className="text-[10px] bg-sky-900/60 text-sky-300 px-1 py-0.5 rounded font-mono">GPS</span>
                           )}
                         </div>
                      </label>
                    );
                 })}
              </div>
            </div>

            <div>
              <div className="flex justify-between items-end mb-1">
                 <label className="block text-sm font-bold text-gray-300 uppercase">Instructions & Notes</label>
                 <button type="button" onClick={() => setInstructions([...instructions, { id: Date.now().toString() + Math.random(), text: '', target: 'all', isPriority: false }])} className="text-sm bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded focus-visible:ring-2 focus-visible:ring-primary-500 transition-colors">+ Add Instruction</button>
              </div>
              <div className="space-y-2">
                 {instructions.length === 0 && <span className="text-gray-400 text-sm">No specific instructions.</span>}
                 {instructions.map((inst, i) => (
                    <div key={inst.id} className="flex flex-col space-y-2 bg-gray-800 p-2 rounded border border-gray-600 relative">
                       <textarea 
                          value={inst.text} 
                          onChange={(e) => {
                              const newInst = [...instructions];
                              newInst[i].text = e.target.value;
                              setInstructions(newInst);
                          }} 
                          rows="2" 
                          placeholder="Instruction or note details..."
                          className="w-full bg-gray-700 text-white rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none border border-gray-600" 
                       />
                       <div className="flex justify-between items-center">
                          <div className="flex space-x-3 items-center">
                              <select 
                                  value={inst.target}
                                  onChange={(e) => {
                                      const newInst = [...instructions];
                                      newInst[i].target = e.target.value;
                                      setInstructions(newInst);
                                  }}
                                  className="bg-gray-700 text-white rounded p-1 text-xs border border-gray-600 outline-none focus:ring-1 focus:ring-blue-500 max-w-[150px] truncate"
                              >
                                  <option value="all">All Team Members</option>
                                  {assignedDriverIds.map(id => {
                                      const d = members.find(m => m.id === id) || activeDrivers.find(drv => drv.id === id);
                                      return <option key={id} value={id}>{d ? (d.name || d.email) : id}</option>;
                                  })}
                              </select>
                              <label className="flex items-center space-x-1 cursor-pointer">
                                  <input 
                                     type="checkbox" 
                                     checked={inst.isPriority} 
                                     onChange={(e) => {
                                         const newInst = [...instructions];
                                         newInst[i].isPriority = e.target.checked;
                                         setInstructions(newInst);
                                     }} 
                                     className="rounded bg-gray-600 border-gray-500 text-red-500 focus:ring-red-500" 
                                  />
                                  <span className={`text-xs ${inst.isPriority ? 'text-red-400 font-bold' : 'text-gray-400'}`}>Priority</span>
                              </label>
                          </div>
                          <button type="button" aria-label="Remove Instruction" onClick={() => setInstructions(instructions.filter((_, idx) => idx !== i))} className="text-red-500 hover:text-red-400 text-xs font-bold bg-gray-700 px-2 py-1 rounded border border-gray-600 focus-visible:ring-2 focus-visible:ring-red-500 transition-colors">Remove</button>
                       </div>
                    </div>
                 ))}
              </div>
            </div>

            {isEditing && (
              <div>
                <label className="block text-sm font-bold text-gray-300 uppercase mb-1">Job Status</label>
                <select value={jobStatus} onChange={e => setJobStatus(e.target.value)} className="w-full bg-gray-700 text-white rounded p-2 focus:ring-2 focus:ring-blue-500 outline-none border border-gray-600">
                   <option value="unassigned">Unassigned</option>
                   <option value="assigned">Assigned / Scheduled</option>
                   <option value="in-progress">In Progress</option>
                   <option value="pending-completion">Pending Completion</option>
                   <option value="completed">Completed</option>
                   <option value="cancelled">Cancelled</option>
                   <option value="archived">Archived</option>
                </select>
              </div>
            )}

          </form>
        </div>
        
        <div className="p-4 border-t border-gray-700 flex justify-end space-x-2 shrink-0">
           <button type="button" onClick={handleClose} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded font-semibold">Cancel</button>
           <button type="submit" form="create-job-form" disabled={loading} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-semibold disabled:opacity-50">
              {loading ? 'Saving...' : (isEditing ? 'Save Changes' : 'Create Job')}
           </button>
        </div>

      </div>
    </div>
  );
}
