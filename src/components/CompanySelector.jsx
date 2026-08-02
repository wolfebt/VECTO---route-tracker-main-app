import React, { useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useToastStore } from '../store/useToastStore';
import { useCompany, useAuth } from '../hooks/useFirebase';
import { collection, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { LogOut, Building2, CheckCircle2, ShieldAlert, PlusCircle } from 'lucide-react';

export default function CompanySelector() {
  const currentUser = useAppStore(state => state.currentUser);
  const currentCompanyId = useAppStore(state => state.companyId);
  const addToast = useToastStore((state) => state.addToast);
  const { joinCompany, loadCompany } = useCompany();
  const { logout } = useAuth();
  
  const [allCompanies, setAllCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanyPassword, setNewCompanyPassword] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [selectedCompanyIdToJoin, setSelectedCompanyIdToJoin] = useState(null);

  useEffect(() => {
    fetchAllCompanies();
  }, [currentUser]);

  const fetchAllCompanies = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'companies'));
      const comps = [];
      snap.forEach(d => comps.push({ id: d.id, ...d.data() }));
      setAllCompanies(comps);
    } catch (e) {
      console.error("Error fetching companies:", e);
      addToast("Failed to fetch companies list: " + e.message, "error");
    }
    setLoading(false);
  };

  const joinedCompanies = allCompanies.filter(c => currentUser?.companies?.includes(c.id));
  const availableCompanies = allCompanies.filter(c => !currentUser?.companies?.includes(c.id));

  const handleSelectJoined = async (companyId) => {
    try {
      sessionStorage.removeItem('vecto_has_cleared_company');
      await loadCompany(companyId);
      addToast("Switched company!", "success");
    } catch (e) {
      addToast("Error switching company: " + e.message, "error");
    }
  };

  const handleJoinClick = (companyId) => {
    const comp = allCompanies.find(c => c.id === companyId);
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
         sessionStorage.removeItem('vecto_has_cleared_company');
         setSelectedCompanyIdToJoin(null);
         addToast("Joined company successfully!", "success");
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
      const newCompRef = await addDoc(collection(db, 'companies'), {
        name: newCompanyName.trim(),
        requirePassword: !!newCompanyPassword,
        password: newCompanyPassword || null,
        createdBy: currentUser.id,
        createdAt: serverTimestamp()
      });
      sessionStorage.removeItem('vecto_has_cleared_company');
      await joinCompany(newCompRef.id, newCompanyPassword);
      addToast("Company created successfully!", "success");
    } catch (e) {
      addToast("Failed to create company: " + e.message, "error");
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[#0b0f19]/80 backdrop-blur-md flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="glass-panel rounded-2xl w-full max-w-xl overflow-hidden animate-modal-enter relative my-auto shadow-2xl border border-white/10">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 via-primary-500 to-indigo-500"></div>
        
        {/* Header */}
        <div className="p-6 border-b border-white/10 flex justify-between items-center bg-slate-900/50">
          <div>
            <h2 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-400 to-accent-400">
              Company Portal
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">Select, join, or create a fleet workspace</p>
          </div>
          <button 
            onClick={logout} 
            className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 text-xs font-semibold flex items-center transition-colors cursor-pointer"
          >
             <LogOut size={14} className="mr-1.5" /> Logout
          </button>
        </div>
        
        <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
           {selectedCompanyIdToJoin ? (
             <div className="animate-modal-enter bg-slate-900/60 p-5 rounded-xl border border-white/10">
                <div className="flex items-center space-x-2 text-amber-400 mb-2">
                  <ShieldAlert size={20} />
                  <h3 className="text-base font-bold text-white">Security Check</h3>
                </div>
                <p className="text-sm text-gray-400 mb-4">This company requires an access password to join.</p>
                <input 
                  type="password" 
                  value={joinPassword} 
                  onChange={e => setJoinPassword(e.target.value)}
                  className="glass-input mb-5"
                  placeholder="Enter Access Password"
                  autoFocus
                />
                <div className="flex justify-end space-x-3">
                  <button onClick={() => setSelectedCompanyIdToJoin(null)} className="btn-secondary text-sm px-4 py-2">Cancel</button>
                  <button onClick={() => handleJoin(selectedCompanyIdToJoin, joinPassword)} className="btn-primary text-sm px-4 py-2">Join Company</button>
                </div>
             </div>
           ) : (
             <>
                {/* Section 1: Joined Companies */}
                {joinedCompanies.length > 0 && (
                  <div>
                    <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider mb-3 flex items-center">
                      <Building2 size={14} className="mr-1.5" />
                      Your Fleets ({joinedCompanies.length})
                    </h3>
                    <div className="space-y-2.5">
                      {joinedCompanies.map(comp => {
                        const isCurrent = comp.id === currentCompanyId;
                        return (
                          <div 
                            key={comp.id} 
                            className={`flex justify-between items-center p-3.5 rounded-xl border transition-all ${
                              isCurrent 
                                ? 'bg-sky-500/15 border-sky-400/40 shadow-[0_0_15px_rgba(56,189,248,0.15)]' 
                                : 'bg-slate-800/40 border-white/10 hover:border-white/20 hover:bg-slate-800/70'
                            }`}
                          >
                            <div className="flex items-center space-x-3">
                              <div className={`p-2 rounded-lg ${isCurrent ? 'bg-sky-500/20 text-sky-400' : 'bg-white/5 text-gray-400'}`}>
                                <Building2 size={18} />
                              </div>
                              <div>
                                <span className="text-gray-100 font-semibold block text-sm">{comp.name}</span>
                                {isCurrent && (
                                  <span className="text-[10px] font-bold text-sky-400 flex items-center mt-0.5">
                                    <CheckCircle2 size={10} className="mr-1" /> Currently Active
                                  </span>
                                )}
                              </div>
                            </div>
                            <button 
                              onClick={() => handleSelectJoined(comp.id)} 
                              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                isCurrent 
                                  ? 'bg-sky-500 text-white shadow-md' 
                                  : 'bg-white/10 hover:bg-sky-500 text-white border border-white/10 hover:border-transparent'
                              }`}
                            >
                              {isCurrent ? 'Active' : 'Switch'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Section 2: Available Network Companies */}
                <div className="pt-2">
                  <h3 className="text-xs font-bold text-primary-400 uppercase tracking-wider mb-3">
                    Available Network Fleets
                  </h3>
                  {loading ? (
                    <p className="text-gray-400 text-sm animate-pulse py-2">Scanning network...</p>
                  ) : availableCompanies.length === 0 ? (
                    <p className="text-gray-400 text-sm bg-slate-900/30 p-3 rounded-lg border border-white/5">
                      No additional network companies found.
                    </p>
                  ) : (
                    <ul className="max-h-44 overflow-y-auto space-y-2 pr-1">
                      {availableCompanies.map(comp => (
                        <li key={comp.id} className="flex justify-between items-center p-3 glass-card group hover:border-white/20">
                          <span className="text-gray-200 font-medium text-sm flex items-center">
                            {comp.name} 
                            {comp.requirePassword && (
                              <span className="ml-2 text-[10px] bg-slate-700/60 px-2 py-0.5 rounded text-gray-400 border border-white/5 font-semibold">
                                Password Protected
                              </span>
                            )}
                          </span>
                          <button 
                            onClick={() => handleJoinClick(comp.id)} 
                            className="px-3.5 py-1.5 bg-white/10 hover:bg-primary-500 text-white rounded-lg transition-all duration-200 text-xs font-semibold border border-white/10 hover:border-transparent cursor-pointer"
                          >
                            Join Fleet
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                
                {/* Section 3: Create New Company */}
                <div className="border-t border-white/10 pt-5">
                  <h3 className="text-xs font-bold text-accent-400 uppercase tracking-wider mb-3 flex items-center">
                    <PlusCircle size={14} className="mr-1.5" />
                    Create New Fleet
                  </h3>
                  <form onSubmit={handleCreate} className="space-y-3">
                    <input 
                      type="text" 
                      placeholder="New Company Name" 
                      className="glass-input text-sm py-2.5" 
                      value={newCompanyName}
                      onChange={(e) => setNewCompanyName(e.target.value)}
                      required 
                    />
                    <input 
                      type="password" 
                      placeholder="Access Password (Optional)" 
                      className="glass-input text-sm py-2.5" 
                      value={newCompanyPassword}
                      onChange={(e) => setNewCompanyPassword(e.target.value)}
                    />
                    <button type="submit" className="w-full btn-accent py-2.5 text-sm font-bold mt-1 shadow-lg cursor-pointer">
                      Initialize New Fleet
                    </button>
                  </form>
                </div>
             </>
           )}
        </div>
      </div>
    </div>
  );
}
