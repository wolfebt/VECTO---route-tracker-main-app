import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useToastStore } from '../../store/useToastStore';
import { useActiveDrivers } from '../../hooks/useFirebase';
import { db } from '../../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { useMapsLibrary } from '@vis.gl/react-google-maps';

// Helper component for Autocomplete inputs
const AutocompleteInput = ({ value, onChange, placeholder, className, required }) => {
  const inputRef = useRef(null);
  const placesLib = useMapsLibrary('places');

  useEffect(() => {
    if (!placesLib || !inputRef.current) return;
    const ac = new placesLib.Autocomplete(inputRef.current, { fields: ['formatted_address', 'geometry', 'name'] });
    
    const listener = ac.addListener('place_changed', () => {
      const place = ac.getPlace();
      if (place.formatted_address || place.name) {
        onChange(place.formatted_address || place.name);
      }
    });

    return () => {
      if (window.google) google.maps.event.removeListener(listener);
    };
  }, [placesLib, onChange]);

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={className}
      required={required}
    />
  );
};

export default function CreateJobModal() {
  const { modals, closeModal, companyId, currentUser } = useAppStore();
  const addToast = useToastStore((state) => state.addToast);
  const activeDrivers = useActiveDrivers(); // Or fetch all users in the company if needed
  
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [origin, setOrigin] = useState('');
  const [dests, setDests] = useState(['']);
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [optimize, setOptimize] = useState(true);
  const [assignedDriverIds, setAssignedDriverIds] = useState([]);

  if (!modals.createJob) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validDests = dests.map(d => d.trim()).filter(d => d);
    if (!name.trim() || !origin.trim() || validDests.length === 0) {
      addToast("Please fill all required fields", "error");
      return;
    }

    setLoading(true);
    try {
      const assignedDrivers = assignedDriverIds.map(id => {
         const driver = activeDrivers.find(d => d.id === id);
         return { id, name: driver ? driver.name : id };
      });

      await addDoc(collection(db, `companies/${companyId}/jobs`), {
        jobName: name.trim(),
        jobDate: date,
        origin: origin.trim(),
        destinations: validDests,
        optimizeRoute: optimize,
        contactName: contactName.trim(),
        contactNumber: contactNumber.trim(),
        driversNeeded: assignedDrivers.length > 0 ? assignedDrivers.length : 1,
        note: note.trim(),
        status: assignedDrivers.length > 0 ? 'in-progress' : 'unassigned',
        assignedDrivers,
        createdBy: currentUser.id,
        createdAt: serverTimestamp(),
        archived: false
      });
      
      closeModal('createJob');
      addToast("Job created successfully.", "success");
      // Reset form
      setName(''); setOrigin(''); setDests(['']); setDate(''); setNote('');
      setContactName(''); setContactNumber(''); setAssignedDriverIds([]);
    } catch (err) {
      console.error(err);
      addToast("Failed to create job", "error");
    }
    setLoading(false);
  };

  const handleClose = () => {
    const isDirty = name !== '' || origin !== '' || dests.some(d => d !== '') || date !== '' || note !== '' || contactName !== '' || contactNumber !== '' || assignedDriverIds.length > 0 || !optimize;
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
          <h2 className="text-xl font-bold text-white">Create New Job</h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-white">&times;</button>
        </div>
        
        <div className="p-4 overflow-y-auto flex-1">
          <form id="create-job-form" onSubmit={handleSubmit} className="space-y-4">
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Job Name *</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full bg-gray-700 text-white rounded p-2 focus:ring-2 focus:ring-blue-500 outline-none border border-gray-600" required />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Date</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full bg-gray-700 text-white rounded p-2 focus:ring-2 focus:ring-blue-500 outline-none border border-gray-600" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Origin Address *</label>
              <AutocompleteInput 
                 value={origin} 
                 onChange={setOrigin} 
                 placeholder="Start Address" 
                 className="w-full bg-gray-700 text-white rounded p-2 focus:ring-2 focus:ring-blue-500 outline-none border border-gray-600" 
                 required 
              />
            </div>

            <div>
              <div className="flex justify-between items-end mb-1">
                 <label className="block text-xs font-bold text-gray-400 uppercase">Destinations *</label>
                 <button type="button" onClick={() => setDests([...dests, ''])} className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded">+ Add Stop</button>
              </div>
              <div className="space-y-2">
                 {dests.map((dest, i) => (
                    <div key={i} className="flex space-x-2 relative">
                      <AutocompleteInput 
                         value={dest} 
                         onChange={(val) => {
                             const newDests = [...dests];
                             newDests[i] = val;
                             setDests(newDests);
                         }} 
                         placeholder="Stop Address" 
                         className="w-full bg-gray-700 text-white rounded p-2 text-sm border border-gray-600 focus:border-blue-500" 
                         required 
                      />
                      {dests.length > 1 && (
                         <button type="button" onClick={() => setDests(dests.filter((_, idx) => idx !== i))} className="px-2 text-red-500 hover:text-red-400 font-bold bg-gray-700 rounded border border-gray-600">&times;</button>
                      )}
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
                 <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Contact Name</label>
                 <input type="text" value={contactName} onChange={e => setContactName(e.target.value)} className="w-full bg-gray-700 text-white rounded p-2 focus:ring-2 focus:ring-blue-500 outline-none border border-gray-600" />
               </div>
               <div>
                 <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Contact Number</label>
                 <input type="tel" value={contactNumber} onChange={e => setContactNumber(e.target.value)} className="w-full bg-gray-700 text-white rounded p-2 focus:ring-2 focus:ring-blue-500 outline-none border border-gray-600" />
               </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Assign Team</label>
              <div className="w-full bg-gray-700 rounded p-2 border border-gray-600 max-h-32 overflow-y-auto space-y-1">
                 {activeDrivers.length === 0 && <span className="text-gray-400 text-sm">No active drivers available.</span>}
                 {activeDrivers.map(d => (
                    <label key={d.id} className="flex items-center space-x-2 cursor-pointer">
                       <input 
                          type="checkbox" 
                          checked={assignedDriverIds.includes(d.id)}
                          onChange={e => {
                             if (e.target.checked) setAssignedDriverIds([...assignedDriverIds, d.id]);
                             else setAssignedDriverIds(assignedDriverIds.filter(id => id !== d.id));
                          }}
                          className="rounded bg-gray-600 border-gray-500 text-blue-500 focus:ring-blue-500" 
                       />
                       <span className="text-sm text-gray-200">{d.name || d.id}</span>
                    </label>
                 ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Internal Notes</label>
              <textarea value={note} onChange={e => setNote(e.target.value)} rows="3" className="w-full bg-gray-700 text-white rounded p-2 focus:ring-2 focus:ring-blue-500 outline-none border border-gray-600"></textarea>
            </div>

          </form>
        </div>
        
        <div className="p-4 border-t border-gray-700 flex justify-end space-x-2 shrink-0">
           <button type="button" onClick={handleClose} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded font-semibold">Cancel</button>
           <button type="submit" form="create-job-form" disabled={loading} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-semibold disabled:opacity-50">
              {loading ? 'Creating...' : 'Create Job'}
           </button>
        </div>

      </div>
    </div>
  );
}
