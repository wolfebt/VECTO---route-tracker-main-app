import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useToastStore } from '../../store/useToastStore';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';

export default function SettingsModal() {
  const { modals, closeModal, openModal, mapsApiKey, setMapsApiKey, currentUser, isDispatchView } = useAppStore();
  const addToast = useToastStore((state) => state.addToast);
  const [keyInput, setKeyInput] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (modals.settings) {
      setKeyInput(mapsApiKey || '');
    }
  }, [modals.settings, mapsApiKey]);

  if (!modals.settings) return null;

  const handleSave = async (e) => {
    e.preventDefault();
    setLoading(true);
    const key = keyInput.trim();

    try {
      if (currentUser) {
        await updateDoc(doc(db, 'users', currentUser.id), {
          'preferences.mapsApiKey': key
        });
      }
      localStorage.setItem('mapsApiKey', key);
      setMapsApiKey(key);
      addToast("Settings saved. Map will reload.", "success");
      closeModal('settings');
      // In a real app, you might want to force a reload or just let React handle it.
      // But since we use vis.gl, updating the API key prop should re-render the map if supported,
      // or we might need a full reload if the Google Maps script is already loaded.
      window.location.reload(); 
    } catch (err) {
      console.error(err);
      addToast("Failed to save settings.", "error");
    }
    setLoading(false);
  };

  const handleClose = () => {
    if (keyInput !== (mapsApiKey || '')) {
      if (!window.confirm("You have unsaved changes. Are you sure you want to close without saving?")) {
        return;
      }
    }
    closeModal('settings');
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div 
        className="bg-gray-800 rounded-lg shadow-xl w-full max-w-md border border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-700">
          <h2 className="text-xl font-bold text-white">Settings</h2>
        </div>
        <div className="p-4 space-y-4">
          <button onClick={() => { handleClose(); openModal('profile'); }} className="w-full px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600">Edit Profile</button>
          <button onClick={() => { handleClose(); openModal('userGuide'); }} className="w-full px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600">User Guide</button>
          <button onClick={() => { handleClose(); openModal('invite'); }} className="w-full px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700">Invite Others</button>
          
          {isDispatchView && (
            <div className="pt-4 border-t border-gray-700">
              <button onClick={() => { handleClose(); openModal('adminSettings'); }} className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Admin: User Roles</button>
            </div>
          )}

          <form onSubmit={handleSave} className="space-y-4 border-t border-gray-700 pt-4 mt-4">
            <div>
              <label className="block text-sm font-bold text-gray-400 mb-1">Google Maps API Key</label>
              <input 
                type="text" 
                value={keyInput}
                onChange={e => setKeyInput(e.target.value)}
                className="w-full bg-gray-700 text-white rounded p-2 focus:ring-2 focus:ring-blue-500 outline-none border border-gray-600"
                placeholder="AIzaSy..."
              />
              <p className="text-xs text-gray-500 mt-1">Required to view maps and optimize routes.</p>
            </div>
            
            <div className="flex justify-end space-x-2 pt-4 border-t border-gray-700">
              <button 
                type="button" 
                onClick={handleClose} 
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded font-semibold"
              >
                Cancel
              </button>
              <button 
                type="submit" 
                disabled={loading}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-semibold disabled:opacity-50"
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
