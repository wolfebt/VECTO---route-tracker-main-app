import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useToastStore } from '../../store/useToastStore';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';

export default function DevelopmentModal() {
  const { modals, closeModal, mapsApiKey, setMapsApiKey, firebaseApiKey, setFirebaseApiKey, geminiApiKey, setGeminiApiKey, currentUser } = useAppStore();
  const addToast = useToastStore((state) => state.addToast);
  const [keyInput, setKeyInput] = useState('');
  const [firebaseInput, setFirebaseInput] = useState('');
  const [geminiInput, setGeminiInput] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (modals.development) {
      setKeyInput(mapsApiKey || '');
      setFirebaseInput(firebaseApiKey || '');
      setGeminiInput(geminiApiKey || '');
    }
  }, [modals.development, mapsApiKey, firebaseApiKey, geminiApiKey]);

  if (!modals.development) return null;

  const handleSave = async (e) => {
    e.preventDefault();
    setLoading(true);
    const key = keyInput.trim();
    const fbKey = firebaseInput.trim();
    const gemKey = geminiInput.trim();

    try {
      if (currentUser) {
        await updateDoc(doc(db, 'users', currentUser.id), {
          'preferences.mapsApiKey': key,
          'preferences.firebaseApiKey': fbKey,
          'preferences.geminiApiKey': gemKey
        });
      }
      localStorage.setItem('mapsApiKey', key);
      setMapsApiKey(key);
      localStorage.setItem('firebaseApiKey', fbKey);
      setFirebaseApiKey(fbKey);
      localStorage.setItem('geminiApiKey', gemKey);
      setGeminiApiKey(gemKey);

      addToast("Development settings saved. App will reload.", "success");
      closeModal('development');
      window.location.reload(); 
    } catch (err) {
      console.error(err);
      addToast("Failed to save development settings.", "error");
    }
    setLoading(false);
  };

  const handleClose = () => {
    if (keyInput !== (mapsApiKey || '') || firebaseInput !== (firebaseApiKey || '') || geminiInput !== (geminiApiKey || '')) {
      if (!window.confirm("You have unsaved changes. Are you sure you want to close without saving?")) {
        return;
      }
    }
    closeModal('development');
  };

  return (
    <div className="fixed inset-0 bg-[#0b0f19]/80 backdrop-blur-md flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div 
        className="glass-panel rounded-2xl w-full max-w-md animate-modal-enter relative overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-primary-500 to-transparent opacity-50"></div>
        <div className="p-5 border-b border-white/10 bg-slate-900/40">
          <h2 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-400 to-accent-400">Development Settings</h2>
        </div>
        <div className="p-6 space-y-4">
          <form onSubmit={handleSave} className="space-y-5">
            <div>
              <label className="block text-[10px] font-bold text-primary-400 uppercase tracking-widest mb-2">Google Maps API Key</label>
              <input 
                type="text" 
                value={keyInput}
                onChange={e => setKeyInput(e.target.value)}
                className="glass-input"
                placeholder="Leave blank to use system default"
              />
              <p className="text-xs text-gray-500 mt-2">Required to view maps and optimize routes.</p>
            </div>
            
            <div>
              <label className="block text-[10px] font-bold text-primary-400 uppercase tracking-widest mb-2">Firebase API Key (Dev)</label>
              <input 
                type="text" 
                value={firebaseInput}
                onChange={e => setFirebaseInput(e.target.value)}
                className="glass-input"
                placeholder="Leave blank to use system default"
              />
            </div>
            
            <div>
              <label className="block text-[10px] font-bold text-primary-400 uppercase tracking-widest mb-2">Gemini API Key (Dev)</label>
              <input 
                type="text" 
                value={geminiInput}
                onChange={e => setGeminiInput(e.target.value)}
                className="glass-input"
                placeholder="Leave blank to use system default"
              />
            </div>
            
            <div className="flex justify-end space-x-3 pt-6 border-t border-white/10">
              <button 
                type="button" 
                onClick={handleClose} 
                className="btn-secondary"
              >
                Cancel
              </button>
              <button 
                type="submit" 
                disabled={loading}
                className="btn-primary disabled:opacity-50 disabled:hover:scale-100"
              >
                {loading ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
