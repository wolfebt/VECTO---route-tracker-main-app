import React from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useToastStore } from '../../store/useToastStore';
import { useCompany } from '../../hooks/useFirebase';
import { doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { Trash2, X } from 'lucide-react';

export default function AdminSettingsModal() {
  const { modals, closeModal, companyId, currentUser } = useAppStore();
  const addToast = useToastStore((state) => state.addToast);
  const { members } = useCompany();

  if (!modals.adminSettings) return null;

  const handlePermissionChange = async (memberId, currentPerms, permKey, newValue) => {
    try {
      const newPerms = { ...currentPerms, [permKey]: newValue };
      await updateDoc(doc(db, `companies/${companyId}/members/${memberId}`), {
        permissions: newPerms
      });
      addToast("Permissions updated.", "success");
    } catch (e) {
      addToast("Failed to update permissions: " + e.message, "error");
    }
  };

  const handleRemoveMember = async (memberId) => {
    if (!window.confirm("Are you sure you want to remove this member?")) return;
    try {
      await deleteDoc(doc(db, `companies/${companyId}/members/${memberId}`));
      addToast("Member removed.", "success");
    } catch (e) {
      addToast("Failed to remove member: " + e.message, "error");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => closeModal('adminSettings')}>
      <div 
        className="bg-gray-800 rounded-lg shadow-xl w-full max-w-md border border-gray-700 flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-700 flex justify-between items-center">
          <h2 className="text-xl font-bold text-white">User Role Management</h2>
          <button onClick={() => closeModal('adminSettings')} className="text-gray-400 hover:text-white p-1">
            <X size={20} />
          </button>
        </div>
        <div className="p-4 flex-1 overflow-y-auto space-y-4">
          <ul className="space-y-4">
            {members.map(member => {
              const isMe = member.id === currentUser.id;
              const perms = member.permissions || {};
              return (
                <li key={member.id} className="bg-gray-700 p-3 rounded relative">
                  <div className="flex justify-between items-start mb-2">
                    <p className="font-bold text-sm text-gray-200">
                      {member.name || member.email} {isMe && '(You)'}
                    </p>
                    {!isMe && (
                      <button onClick={() => handleRemoveMember(member.id)} className="text-red-400 hover:text-red-300 p-1" title="Remove Member">
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {['canCreateJob', 'canDeleteJob', 'canManageDrivers'].map(p => (
                      <label key={p} className="flex items-center space-x-2">
                        <input 
                          type="checkbox" 
                          className="bg-gray-600 border-gray-500 rounded"
                          checked={!!perms[p]}
                          disabled={isMe}
                          onChange={(e) => handlePermissionChange(member.id, perms, p, e.target.checked)}
                        />
                        <span className="text-xs text-gray-300">{p}</span>
                      </label>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="p-4 border-t border-gray-700 flex justify-end">
          <button onClick={() => closeModal('adminSettings')} className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded font-semibold w-full">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
