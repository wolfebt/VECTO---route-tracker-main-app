import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useToastStore } from '../../store/useToastStore';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';

export default function ProfileModal() {
  const { modals, closeModal, currentUser, setCurrentUser } = useAppStore();
  const addToast = useToastStore((state) => state.addToast);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (modals.profile && currentUser) {
      setName(currentUser.name || '');
      setPhone(currentUser.phone || '');
    }
  }, [modals.profile, currentUser]);

  if (!modals.profile) return null;

  const handleSave = async (e) => {
    e.preventDefault();
    if (!currentUser) return;
    
    setLoading(true);
    try {
      await updateDoc(doc(db, 'users', currentUser.id), {
        name: name.trim(),
        phone: phone.trim()
      });
      setCurrentUser({ ...currentUser, name: name.trim(), phone: phone.trim() });
      closeModal('profile');
      addToast("Profile updated.", "success");
    } catch (err) {
      console.error(err);
      addToast("Failed to update profile.", "error");
    }
    setLoading(false);
  };

  const handleClose = () => {
    if (name !== (currentUser?.name || '') || phone !== (currentUser?.phone || '')) {
      if (!window.confirm("You have unsaved changes. Are you sure you want to close without saving?")) {
        return;
      }
    }
    closeModal('profile');
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div 
        className="bg-gray-800 rounded-lg shadow-xl w-full max-w-sm border border-gray-700 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSave}>
          <h3 className="text-xl font-bold text-white mb-4">Edit Profile</h3>
          <div className="space-y-4">
            <input 
              type="text" 
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Your Name" 
              required 
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input 
              type="tel" 
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="Mobile Number" 
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex justify-end space-x-2 mt-6">
            <button 
              type="button" 
              onClick={handleClose}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
            >
              Cancel
            </button>
            <button 
              type="submit" 
              disabled={loading}
              className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50"
            >
              {loading ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
