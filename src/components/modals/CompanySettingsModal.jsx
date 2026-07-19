import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useToastStore } from '../../store/useToastStore';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';

export default function CompanySettingsModal() {
  const { modals, closeModal, companyId, clearCompany } = useAppStore();
  const addToast = useToastStore((state) => state.addToast);
  
  const [formData, setFormData] = useState({
    address: '',
    contactName: '',
    phone: '',
    email: ''
  });
  const [loading, setLoading] = useState(false);

  const [originalData, setOriginalData] = useState(null);

  useEffect(() => {
    if (modals.companySettings && companyId) {
      const fetchCompanyData = async () => {
        try {
          const docRef = doc(db, 'companies', companyId);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const data = docSnap.data();
            const loadedData = {
              address: data.address || '',
              contactName: data.contactName || '',
              phone: data.phone || '',
              email: data.email || ''
            };
            setFormData(loadedData);
            setOriginalData(loadedData);
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
    if (originalData) {
      const isDirty = Object.keys(originalData).some(key => formData[key] !== originalData[key]);
      if (isDirty && !window.confirm("You have unsaved changes. Are you sure you want to close without saving?")) {
        return;
      }
    }
    closeModal('companySettings');
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await updateDoc(doc(db, 'companies', companyId), {
        address: formData.address,
        contactName: formData.contactName,
        phone: formData.phone,
        email: formData.email
      });
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

  const handleDeleteCompany = () => {
    if (window.confirm("Are you sure you want to completely delete this company and all its data? This action cannot be undone.")) {
      // In a production app, this would trigger a cloud function to recursively delete subcollections
      // and remove the companyId from all members' user profiles.
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
                className="w-full bg-gray-700 text-white rounded p-2 focus:ring-2 focus:ring-blue-500 outline-none border border-gray-600"
                placeholder="123 Main St..."
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Primary Contact Name</label>
              <input 
                type="text" 
                name="contactName"
                value={formData.contactName}
                onChange={handleChange}
                className="w-full bg-gray-700 text-white rounded p-2 focus:ring-2 focus:ring-blue-500 outline-none border border-gray-600"
                placeholder="Jane Doe"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Phone Number</label>
              <input 
                type="tel" 
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                className="w-full bg-gray-700 text-white rounded p-2 focus:ring-2 focus:ring-blue-500 outline-none border border-gray-600"
                placeholder="(555) 123-4567"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Contact Email</label>
              <input 
                type="email" 
                name="email"
                value={formData.email}
                onChange={handleChange}
                className="w-full bg-gray-700 text-white rounded p-2 focus:ring-2 focus:ring-blue-500 outline-none border border-gray-600"
                placeholder="contact@company.com"
              />
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
          </form>

          <div className="mt-6 pt-4 border-t border-gray-700 space-y-3">
             <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-2">Actions</h3>
             <button 
                type="button" 
                onClick={handleChangeCompany}
                className="w-full px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg"
              >
                Change Company
              </button>
              <button 
                type="button" 
                onClick={handleDeleteCompany}
                className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg"
              >
                Delete Company
              </button>
          </div>
        </div>
      </div>
    </div>
  );
}
