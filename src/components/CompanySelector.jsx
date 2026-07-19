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
    <div className="fixed inset-0 bg-[#0b0f19]/80 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="glass-panel rounded-2xl w-full max-w-lg overflow-hidden animate-modal-enter relative">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-primary-500 to-transparent opacity-50"></div>
        
        <div className="p-6 border-b border-white/10 flex justify-between items-center bg-slate-900/40">
          <h2 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-400 to-accent-400">Company Portal</h2>
          <button onClick={logout} className="text-gray-400 hover:text-red-400 flex items-center transition-colors">
             <LogOut size={18} className="mr-2" /> Logout
          </button>
        </div>
        
        <div className="p-6">
           {selectedCompanyIdToJoin ? (
             <div className="animate-modal-enter">
                <h3 className="text-lg font-bold text-white mb-4">Security Check</h3>
                <p className="text-sm text-gray-400 mb-4">This company requires a password to join.</p>
                <input 
                  type="password" 
                  value={joinPassword} 
                  onChange={e => setJoinPassword(e.target.value)}
                  className="glass-input mb-6"
                  placeholder="Enter Password"
                  autoFocus
                />
                <div className="flex justify-end space-x-3">
                  <button onClick={() => setSelectedCompanyIdToJoin(null)} className="btn-secondary">Cancel</button>
                  <button onClick={() => handleJoin(selectedCompanyIdToJoin, joinPassword)} className="btn-primary">Join Company</button>
                </div>
             </div>
           ) : (
             <>
                <div className="mb-8">
                  <h3 className="text-xs font-bold text-primary-400 uppercase tracking-wider mb-4">Available Companies</h3>
                  <ul className="max-h-48 overflow-y-auto space-y-3 pr-2">
                    {loading ? <p className="text-gray-400 text-sm animate-pulse">Scanning network...</p> : 
                     companies.length === 0 ? <p className="text-gray-400 text-sm">No companies found.</p> :
                     companies.map(comp => (
                       <li key={comp.id} className="flex justify-between items-center p-3 glass-card group">
                         <span className="text-gray-200 font-medium flex items-center">
                           {comp.name} 
                           {comp.requirePassword && <span className="ml-2 text-xs bg-slate-700/50 px-2 py-1 rounded text-gray-400 border border-white/5">Secured</span>}
                         </span>
                         <button onClick={() => handleJoinClick(comp.id)} className="px-4 py-1.5 bg-white/10 hover:bg-primary-500 text-white rounded-lg transition-all duration-300 text-sm border border-white/10 hover:border-transparent">Join</button>
                       </li>
                     ))}
                  </ul>
                </div>
                
                <div className="border-t border-white/10 pt-6">
                  <h3 className="text-xs font-bold text-accent-400 uppercase tracking-wider mb-4">Create New Fleet</h3>
                  <form onSubmit={handleCreate} className="space-y-4">
                    <input 
                      type="text" 
                      placeholder="Company Name" 
                      className="glass-input" 
                      value={newCompanyName}
                      onChange={(e) => setNewCompanyName(e.target.value)}
                      required 
                    />
                    <input 
                      type="password" 
                      placeholder="Access Password (Optional)" 
                      className="glass-input" 
                      value={newCompanyPassword}
                      onChange={(e) => setNewCompanyPassword(e.target.value)}
                    />
                    <button type="submit" className="w-full btn-accent py-3 text-lg mt-2">Initialize Company</button>
                  </form>
                </div>
             </>
           )}
        </div>
      </div>
    </div>
  );
}
