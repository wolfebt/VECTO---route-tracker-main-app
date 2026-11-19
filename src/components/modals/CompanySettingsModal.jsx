import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useToastStore } from '../../store/useToastStore';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, arrayRemove, deleteField, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { hashCompanyPassword } from '../../utils/crypto';

export default function CompanySettingsModal() {
  const { modals, closeModal, openModal, companyId, clearCompany, isDispatchView, memberPermissions, currentUser } = useAppStore();
  const addToast = useToastStore((state) => state.addToast);
  
  const [formData, setFormData] = useState({
    address: '',
    contactName: '',
    phone: '',
    email: '',
    showNameplates: true
  });
  const [requirePassword, setRequirePassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [removePassword, setRemovePassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const [originalData, setOriginalData] = useState(null);
  const companyInfoRef = useRef({ name: '', createdBy: '', requirePassword: false });

  useEffect(() => {
    if (modals.companySettings && companyId) {
      const fetchCompanyData = async () => {
        try {
          const [docSnap, profileSnap] = await Promise.all([
            getDoc(doc(db, 'companies', companyId)),
            getDoc(doc(db, 'companies', companyId, 'private', 'profile')).catch(() => null)
          ]);
          if (docSnap.exists()) {
            const data = docSnap.data();
            const profileData = profileSnap && profileSnap.exists() ? profileSnap.data() : {};
            companyInfoRef.current = {
              name: data.name || '',
              createdBy: data.createdBy || '',
              requirePassword: !!data.requirePassword
            };
            const loadedData = {
              address: profileData.address ?? data.address ?? '',
              contactName: profileData.contactName ?? data.contactName ?? '',
              phone: profileData.phone ?? data.phone ?? '',
              email: profileData.email ?? data.email ?? '',
              showNameplates: data.showNameplates ?? true
            };
            setFormData(loadedData);
            setOriginalData(loadedData);
            setRequirePassword(!!data.requirePassword);
            setNewPassword('');
            setRemovePassword(false);
          }
        } catch (error) {
          console.error("Error fetching company data:", error);
        }
      };
      fetchCompanyData();
    }
  }, [modals.companySettings, companyId]);

  if (!modals.companySettings) return null;

  const handleClose = () => {
    if (isDispatchView && originalData) {
      const isDirty =
        Object.keys(originalData).some(key => formData[key] !== originalData[key]) ||
        newPassword !== '' ||
        removePassword;
      if (isDirty && !window.confirm("You have unsaved changes. Are you sure you want to close without saving?")) {
        return;
      }
    }
    closeModal('companySettings');
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!isDispatchView) return;
    setLoading(true);
    try {
      await setDoc(
        doc(db, 'companies', companyId, 'private', 'profile'),
        {
          address: formData.address,
          contactName: formData.contactName,
          phone: formData.phone,
          email: formData.email,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );

      const updates = {
        address: deleteField(),
        contactName: deleteField(),
        phone: deleteField(),
        email: deleteField(),
        showNameplates: formData.showNameplates,
        updatedAt: serverTimestamp()
      };

      let nextRequirePassword = companyInfoRef.current.requirePassword;
      const trimmedPw = newPassword.trim();
      if (removePassword) {
        nextRequirePassword = false;
        updates.requirePassword = false;
        updates.passwordHash = deleteField();
        updates.password = deleteField();
        await setDoc(
          doc(db, 'companies', companyId, 'private', 'security'),
          { passwordHash: null, updatedAt: serverTimestamp() },
          { merge: true }
        ).catch(() => {});
      } else if (trimmedPw) {
        nextRequirePassword = true;
        const passwordHash = await hashCompanyPassword(companyId, trimmedPw);
        await setDoc(
          doc(db, 'companies', companyId, 'private', 'security'),
          {
            passwordHash,
            updatedAt: serverTimestamp()
          },
          { merge: true }
        );
        updates.requirePassword = true;
        updates.passwordHash = deleteField();
        updates.password = deleteField();
      }

      await updateDoc(doc(db, 'companies', companyId), updates);

      if (companyInfoRef.current.name && companyInfoRef.current.createdBy) {
        await setDoc(
          doc(db, 'company_directory', companyId),
          {
            name: companyInfoRef.current.name,
            requirePassword: nextRequirePassword,
            createdBy: companyInfoRef.current.createdBy,
            updatedAt: serverTimestamp()
          },
          { merge: true }
        ).catch(() => {});
      }

      addToast("Company settings saved!", "success");
      closeModal('companySettings');
    } catch (error) {
      console.error("Error updating company:", error);
      addToast("Failed to save company settings.", "error");
    }
    setLoading(false);
  };

  const handleChangeCompany = () => {
    if (window.confirm("Are you sure you want to switch to a different company?")) {
      clearCompany();
      closeModal('companySettings');
    }
  };

  const handleLeaveCompany = async () => {
    if (!currentUser?.id || memberPermissions?.isCreator) return;
    if (!window.confirm("Are you sure you want to leave this fleet workspace?")) return;
    try {
      await deleteDoc(doc(db, `companies/${companyId}/active_drivers/${currentUser.id}`)).catch(() => {});
      await deleteDoc(doc(db, `companies/${companyId}/members/${currentUser.id}`)).catch(() => {});
      await updateDoc(doc(db, 'users', currentUser.id), {
        companies: arrayRemove(companyId)
      });
      useAppStore.setState(state => ({
        currentUser: state.currentUser
          ? { ...state.currentUser, companies: (state.currentUser.companies || []).filter(c => c !== companyId) }
          : null
      }));
      clearCompany();
      closeModal('companySettings');
      addToast("Left fleet workspace.", "info");
    } catch (error) {
      console.error("Error leaving company:", error);
      addToast("Failed to leave workspace: " + error.message, "error");
    }
  };

  const handleDeleteCompany = () => {
    if (window.confirm("Are you sure you want to completely delete this company and all its data? This action cannot be undone.")) {
      addToast("Deleting a company is disabled in this environment.", "info");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div 
        className="bg-gray-800 rounded-lg shadow-xl w-full max-w-md border border-gray-700 flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-700 flex justify-between items-center">
          <h2 className="text-xl font-bold text-white">Company Settings</h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-white p-1 text-xl font-bold">
            &times;
          </button>
        </div>
        
        <div className="p-4 flex-1 overflow-y-auto">
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Company Address</label>
              <input 
                type="text" 
                name="address"
                value={formData.address}
                onChange={handleChange}
                disabled={!isDispatchView}
                className="w-full bg-gray-700 text-white rounded p-2 focus:ring-2 focus:ring-blue-500 outline-none border border-gray-600 disabled:opacity-60"
                placeholder={isDispatchView ? "123 Main St..." : "Not provided"}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Primary Contact Name</label>
              <input 
                type="text" 
                name="contactName"
                value={formData.contactName}
                onChange={handleChange}
                disabled={!isDispatchView}
                className="w-full bg-gray-700 text-white rounded p-2 focus:ring-2 focus:ring-blue-500 outline-none border border-gray-600 disabled:opacity-60"
                placeholder={isDispatchView ? "Jane Doe" : "Not provided"}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Phone Number</label>
              <input 
                type="tel" 
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                disabled={!isDispatchView}
                className="w-full bg-gray-700 text-white rounded p-2 focus:ring-2 focus:ring-blue-500 outline-none border border-gray-600 disabled:opacity-60"
                placeholder={isDispatchView ? "(555) 123-4567" : "Not provided"}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Contact Email</label>
              <input 
                type="email" 
                name="email"
                value={formData.email}
                onChange={handleChange}
                disabled={!isDispatchView}
                className="w-full bg-gray-700 text-white rounded p-2 focus:ring-2 focus:ring-blue-500 outline-none border border-gray-600 disabled:opacity-60"
                placeholder={isDispatchView ? "contact@company.com" : "Not provided"}
              />
            </div>

            <div className="flex items-center space-x-3 pt-2">
              <input 
                type="checkbox" 
                id="showNameplates"
                name="showNameplates"
                checked={formData.showNameplates}
                onChange={handleChange}
                disabled={!isDispatchView}
                className="w-5 h-5 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500 disabled:opacity-60"
              />
              <label htmlFor="showNameplates" className="text-sm font-medium text-gray-200 cursor-pointer">
                Show Driver Nameplates on Map
              </label>
            </div>

            {isDispatchView && (
              <>
                <div className="pt-3 border-t border-gray-700 space-y-2">
                  <label className="block text-sm font-medium text-gray-300">
                    Update Access Password
                    <span className="text-xs text-gray-400 font-normal ml-2">
                      ({requirePassword ? 'Currently password protected' : 'Currently open'})
                    </span>
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value);
                      if (e.target.value) setRemovePassword(false);
                    }}
                    disabled={removePassword}
                    className="w-full bg-gray-700 text-white rounded p-2 focus:ring-2 focus:ring-blue-500 outline-none border border-gray-600 disabled:opacity-50"
                    placeholder="Leave blank to keep existing password"
                  />
                  {requirePassword && (
                    <label className="flex items-center space-x-2 text-xs text-amber-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={removePassword}
                        onChange={(e) => {
                          setRemovePassword(e.target.checked);
                          if (e.target.checked) setNewPassword('');
                        }}
                        className="rounded bg-gray-700 border-gray-600 text-amber-500 focus:ring-amber-500"
                      />
                      <span>Remove access password protection</span>
                    </label>
                  )}
                </div>

                <div className="pt-4 border-t border-gray-700 space-y-3">
                  <button 
                    type="submit" 
                    disabled={loading}
                    className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold disabled:opacity-50"
                  >
                    {loading ? 'Saving...' : 'Save Settings'}
                  </button>
                </div>
              </>
            )}
          </form>

          <div className="mt-6 pt-4 border-t border-gray-700 space-y-3">
             <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-2">Actions</h3>
             <button 
                type="button" 
                onClick={() => { closeModal('companySettings'); openModal('invite'); }}
                className="w-full px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg"
              >
                Invite Others
              </button>
             <button 
                type="button" 
                onClick={handleChangeCompany}
                className="w-full px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg"
              >
                Change Company
              </button>
             {!memberPermissions?.isCreator && (
               <button
                 type="button"
                 onClick={handleLeaveCompany}
                 className="w-full px-4 py-2 bg-amber-600/80 hover:bg-amber-600 text-white rounded-lg"
               >
                 Leave Fleet Workspace
               </button>
             )}
             {memberPermissions?.isCreator && (
               <button 
                  type="button" 
                  onClick={handleDeleteCompany}
                  className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg"
                >
                  Delete Company
                </button>
             )}
          </div>
        </div>
      </div>
    </div>
  );
}
