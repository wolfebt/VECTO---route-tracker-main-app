import React, { useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useToastStore } from '../store/useToastStore';
import { useCompany } from '../hooks/useFirebase';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { LogOut } from 'lucide-react';
import { useAuth } from '../hooks/useFirebase';

export default function CompanySelector() {
  const currentUser = useAppStore(state => state.currentUser);
  const addToast = useToastStore((state) => state.addToast);
  const { joinCompany, loadCompany } = useCompany();
  const { logout } = useAuth();
  
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanyPassword, setNewCompanyPassword] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [selectedCompanyIdToJoin, setSelectedCompanyIdToJoin] = useState(null);

  useEffect(() => {
    // If user has companies, auto-load first one (if not already loaded)
    if (currentUser?.companies?.length > 0) {
       loadCompany(currentUser.companies[0]);
    } else {
       fetchGlobalCompanies();
    }
  }, [currentUser, loadCompany]);

  const fetchGlobalCompanies = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'companies'));
      const comps = [];
      snap.forEach(doc => comps.push({ id: doc.id, ...doc.data() }));
      setCompanies(comps);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const handleJoinClick = (companyId) => {
    const comp = companies.find(c => c.id === companyId);
    if (comp?.requirePassword) {
      setSelectedCompanyIdToJoin(companyId);
    } else {
      handleJoin(companyId);
    }
  };

  const handleJoin = async (companyId, password = null) => {
    try {
      const res = await joinCompany(companyId, password);
      if (res.requiresPassword) {
         addToast("Invalid Password", "error");
      } else {
         setSelectedCompanyIdToJoin(null);
      }
    } catch (e) {
      addToast("Failed to join: " + e.message, "error");
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newCompanyName.trim()) return;
    try {
      setLoading(true);
      const { addDoc, collection, serverTimestamp } = await import('firebase/firestore');
      const newCompRef = await addDoc(collection(db, 'companies'), {
        name: newCompanyName.trim(),
        requirePassword: !!newCompanyPassword,
        password: newCompanyPassword || null,
        createdBy: currentUser.id,
        createdAt: serverTimestamp()
      });
      await joinCompany(newCompRef.id, newCompanyPassword);
    } catch (e) {
      addToast("Failed to create company: " + e.message, "error");
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-lg overflow-hidden border border-gray-700">
        <div className="p-4 border-b border-gray-700 flex justify-between items-center">
          <h2 className="text-xl font-bold text-white">Join or Create a Company</h2>
          <button onClick={logout} className="text-red-400 hover:text-red-300 flex items-center">
             <LogOut size={16} className="mr-1" /> Logout
          </button>
        </div>
        
        <div className="p-4">
           {selectedCompanyIdToJoin ? (
             <div>
                <h3 className="text-lg font-bold text-white mb-2">Enter Password</h3>
                <input 
                  type="password" 
                  value={joinPassword} 
                  onChange={e => setJoinPassword(e.target.value)}
                  className="w-full bg-gray-700 text-white rounded p-2 mb-2"
                  placeholder="Company Password"
                />
                <div className="flex justify-end space-x-2">
                  <button onClick={() => setSelectedCompanyIdToJoin(null)} className="px-4 py-2 bg-gray-600 rounded">Cancel</button>
                  <button onClick={() => handleJoin(selectedCompanyIdToJoin, joinPassword)} className="px-4 py-2 bg-blue-600 rounded">Join</button>
                </div>
             </div>
           ) : (
             <>
                <div className="mb-6">
                  <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-2">Available Companies</h3>
                  <ul className="max-h-48 overflow-y-auto space-y-2">
                    {loading ? <p className="text-gray-400 text-sm">Loading...</p> : 
                     companies.length === 0 ? <p className="text-gray-400 text-sm">No companies found.</p> :
                     companies.map(comp => (
                       <li key={comp.id} className="flex justify-between items-center p-2 bg-gray-700 rounded">
                         <span className="text-gray-200">{comp.name} {comp.requirePassword && '🔒'}</span>
                         <button onClick={() => handleJoinClick(comp.id)} className="px-3 py-1 bg-teal-600 text-white rounded hover:bg-teal-700 text-sm">Join</button>
                       </li>
                     ))}
                  </ul>
                </div>
                
                <div className="border-t border-gray-700 pt-4">
                  <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-2">Create New Company</h3>
                  <form onSubmit={handleCreate} className="space-y-2">
                    <input 
                      type="text" 
                      placeholder="Company Name" 
                      className="w-full bg-gray-700 text-white rounded p-2" 
                      value={newCompanyName}
                      onChange={(e) => setNewCompanyName(e.target.value)}
                      required 
                    />
                    <input 
                      type="password" 
                      placeholder="Password (Optional)" 
                      className="w-full bg-gray-700 text-white rounded p-2" 
                      value={newCompanyPassword}
                      onChange={(e) => setNewCompanyPassword(e.target.value)}
                    />
                    <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white p-2 rounded font-bold">Create Company</button>
                  </form>
                </div>
             </>
           )}
        </div>
      </div>
    </div>
  );
}
