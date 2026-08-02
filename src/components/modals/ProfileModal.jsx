import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useToastStore } from '../../store/useToastStore';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { User, Phone, Palette, Check } from 'lucide-react';

const PRESET_COLORS = [
  '#22c55e', // Emerald Green
  '#3b82f6', // Blue
  '#8b5cf6', // Purple
  '#ec4899', // Pink
  '#f59e0b', // Amber
  '#ef4444', // Red
  '#06b6d4', // Cyan
  '#10b981', // Teal
  '#f97316', // Orange
];

export default function ProfileModal() {
  const { modals, closeModal, currentUser, setCurrentUser, companyId } = useAppStore();
  const addToast = useToastStore((state) => state.addToast);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [color, setColor] = useState('#22c55e');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (modals.profile && currentUser) {
      setName(currentUser.name || '');
      setPhone(currentUser.phone || currentUser.number || '');
      setColor(currentUser.color || '#22c55e');
    }
  }, [modals.profile, currentUser]);

  if (!modals.profile) return null;

  const handleSave = async (e) => {
    e.preventDefault();
    if (!currentUser?.id) return;
    
    setLoading(true);
    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    const chosenColor = color || '#22c55e';

    try {
      const profileData = {
        name: trimmedName,
        phone: trimmedPhone,
        number: trimmedPhone,
        color: chosenColor,
        updatedAt: serverTimestamp()
      };

      // 1. Save to main user document in Firestore (merge mode ensures safety)
      await setDoc(doc(db, 'users', currentUser.id), profileData, { merge: true });

      // 2. Save to local storage for offline / quick reload recovery
      try {
        localStorage.setItem('vecto_driver_profile', JSON.stringify({
          name: trimmedName,
          phone: trimmedPhone,
          number: trimmedPhone,
          color: chosenColor
        }));
      } catch (err) {
        console.warn("Failed to update local storage profile:", err);
      }

      // 3. Update Zustand application state
      setCurrentUser({
        ...currentUser,
        name: trimmedName,
        phone: trimmedPhone,
        number: trimmedPhone,
        color: chosenColor
      });

      // 4. Update active driver record and company member record if currently in a company workspace
      if (companyId) {
        await setDoc(doc(db, `companies/${companyId}/active_drivers`, currentUser.id), {
          name: trimmedName,
          phone: trimmedPhone,
          number: trimmedPhone,
          color: chosenColor,
          updatedAt: serverTimestamp()
        }, { merge: true }).catch(() => {
          // Ignore if driver is not actively sharing location
        });

        await setDoc(doc(db, `companies/${companyId}/members`, currentUser.id), {
          name: trimmedName,
          phone: trimmedPhone,
          number: trimmedPhone,
          color: chosenColor
        }, { merge: true }).catch((err) => {
          console.warn("Could not update member profile:", err);
        });
      }

      closeModal('profile');
      addToast("Driver profile saved successfully!", "success");
    } catch (err) {
      console.error("Error saving driver profile:", err);
      addToast("Failed to save profile: " + (err.message || err), "error");
    }
    setLoading(false);
  };

  const handleClose = () => {
    const originalPhone = currentUser?.phone || currentUser?.number || '';
    if (
      name !== (currentUser?.name || '') || 
      phone !== originalPhone || 
      color !== (currentUser?.color || '#22c55e')
    ) {
      if (!window.confirm("You have unsaved profile changes. Close without saving?")) {
        return;
      }
    }
    closeModal('profile');
  };

  return (
    <div className="fixed inset-0 bg-[#0b0f19]/80 backdrop-blur-md flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div 
        className="glass-panel rounded-2xl shadow-2xl w-full max-w-md border border-white/10 p-6 animate-modal-enter relative overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 via-primary-500 to-indigo-500"></div>

        <div className="flex justify-between items-center mb-5 pb-3 border-b border-white/10">
          <div>
            <h3 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-400 to-accent-400 flex items-center gap-2">
              <User className="text-primary-400" size={22} />
              Driver Profile
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">Your profile name, contact number, and map icon color</p>
          </div>
          <button onClick={handleClose} className="text-gray-400 hover:text-white text-xl font-bold p-1 cursor-pointer">
            &times;
          </button>
        </div>

        {/* Live Profile Driver Details */}
        <div className="bg-slate-900/60 p-3.5 rounded-xl border border-white/5 mb-5 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div 
              className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold shadow-md border-2 border-white/20 transition-all duration-300"
              style={{ backgroundColor: color }}
            >
              {name ? name.charAt(0).toUpperCase() : '?'}
            </div>
            <div>
              <span className="text-xs font-bold text-gray-200 block">{name || 'Your Driver Name'}</span>
              <span className="text-[11px] text-gray-400 flex items-center gap-1 mt-0.5">
                <Phone size={10} className="text-gray-400" />
                {phone || 'No phone number added'}
              </span>
            </div>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-300 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <User size={13} className="text-gray-400" />
              Full Name *
            </label>
            <input 
              type="text" 
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Alex Rivera" 
              required 
              className="glass-input text-sm py-2.5"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-300 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <Phone size={13} className="text-gray-400" />
              Mobile Contact Number
            </label>
            <input 
              type="tel" 
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="e.g. (555) 019-2831" 
              className="glass-input text-sm py-2.5"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Palette size={13} className="text-gray-400" />
              Chosen Map Pin Color
            </label>
            
            {/* Palette Swatches */}
            <div className="flex flex-wrap gap-2 mb-3">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  style={{ backgroundColor: c }}
                  className={`w-7 h-7 rounded-full border-2 transition-transform cursor-pointer flex items-center justify-center ${
                    color.toLowerCase() === c.toLowerCase() ? 'scale-115 border-white shadow-lg' : 'border-transparent opacity-80 hover:opacity-100 hover:scale-105'
                  }`}
                  title={`Select color ${c}`}
                >
                  {color.toLowerCase() === c.toLowerCase() && (
                    <Check size={14} className="text-white drop-shadow" />
                  )}
                </button>
              ))}
            </div>

            {/* Custom Color Input */}
            <div className="flex items-center space-x-3 bg-slate-900/40 p-2 rounded-xl border border-white/5">
              <input 
                type="color" 
                value={color}
                onChange={e => setColor(e.target.value)}
                className="w-10 h-8 rounded border-none cursor-pointer bg-transparent"
                title="Choose custom color"
              />
              <span className="text-xs font-mono text-gray-300">{color.toUpperCase()}</span>
              <span className="text-[11px] text-gray-400 ml-auto">Custom Hex Color</span>
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-4 border-t border-white/10 mt-6">
            <button 
              type="button" 
              onClick={handleClose}
              className="btn-secondary text-xs px-4 py-2.5 cursor-pointer"
            >
              Cancel
            </button>
            <button 
              type="submit" 
              disabled={loading}
              className="btn-primary text-xs px-5 py-2.5 font-bold cursor-pointer disabled:opacity-50"
            >
              {loading ? 'Saving Profile...' : 'Save Profile'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

