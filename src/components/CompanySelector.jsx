import React, { useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useToastStore } from '../store/useToastStore';
import { useCompany, useAuth } from '../hooks/useFirebase';
import { collection, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { LogOut, Building2, CheckCircle2, ShieldAlert, PlusCircle, Users, Radio, RefreshCw } from 'lucide-react';

export default function CompanySelector() {
  const currentUser = useAppStore(state => state.currentUser);
  const currentCompanyId = useAppStore(state => state.companyId);
  const addToast = useToastStore((state) => state.addToast);
  const { joinCompany, loadCompany } = useCompany();
  const { logout } = useAuth();
  
  const [activeTab, setActiveTab] = useState('myFleets'); // 'myFleets' | 'join' | 'create'
  const [allCompanies, setAllCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanyPassword, setNewCompanyPassword] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [selectedCompanyIdToJoin, setSelectedCompanyIdToJoin] = useState(null);

  useEffect(() => {
    // Auto-load last used company on initial load if user hasn't explicitly clicked "Change Company"
    const hasCleared = sessionStorage.getItem('vecto_has_cleared_company');
    const userComps = currentUser?.companies || [];
    if (!currentCompanyId && userComps.length > 0 && !hasCleared) {
      const lastCompanyId = localStorage.getItem('vecto_last_company_id');
      const targetId = (lastCompanyId && userComps.includes(lastCompanyId)) 
        ? lastCompanyId 
        : userComps[0];
      loadCompany(targetId);
    }
    // Always fetch companies list to ensure portal displays current options
    fetchAllCompanies();
  }, [currentUser?.id, currentCompanyId]);

  const fetchAllCompanies = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'companies'));
      const comps = [];
      snap.forEach(d => comps.push({ id: d.id, ...d.data() }));
      setAllCompanies(comps);

      if (currentUser?.id) {
        const userComps = currentUser.companies || [];
        const createdComps = comps.filter(c => c.createdBy === currentUser.id && !userComps.includes(c.id));
        if (createdComps.length > 0) {
          const newIds = createdComps.map(c => c.id);
          const updatedComps = [...userComps, ...newIds];
          updateDoc(doc(db, 'users', currentUser.id), { companies: arrayUnion(...newIds) }).catch(console.warn);
          useAppStore.setState(state => ({
            currentUser: { ...state.currentUser, companies: updatedComps }
          }));
        }

        const joined = comps.filter(c => userComps.includes(c.id) || c.createdBy === currentUser.id || c.createdBy === currentUser.email);
        if (joined.length === 0 && comps.length > 0) {
          setActiveTab('join');
        }
      }
    } catch (e) {
      console.error("Error fetching companies:", e);
      addToast("Failed to fetch companies list: " + e.message, "error");
    }
    setLoading(false);
  };

  const isCompanyJoined = (c) => {
    if (!currentUser) return false;
    const userComps = currentUser.companies || [];
    return userComps.includes(c.id) || c.createdBy === currentUser.id || c.createdBy === currentUser.email;
  };

  const joinedCompanies = allCompanies.filter(isCompanyJoined);
  const availableCompanies = allCompanies.filter(c => !isCompanyJoined(c));

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
      <div className="glass-panel rounded-2xl w-full max-w-xl overflow-hidden animate-modal-enter relative my-auto shadow-2xl border border-white/10 flex flex-col max-h-[90vh]">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 via-primary-500 to-indigo-500"></div>
        
        {/* Header */}
        <div className="p-5 border-b border-white/10 flex justify-between items-center bg-slate-900/50 shrink-0">
          <div>
            <h2 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-400 to-accent-400">
              Company Portal
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">Manage and switch your fleet workspaces</p>
          </div>
          <div className="flex items-center space-x-2">
            <button 
              onClick={fetchAllCompanies} 
              disabled={loading}
              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10 text-xs font-semibold flex items-center transition-colors cursor-pointer disabled:opacity-50"
              title="Refresh Fleets List"
            >
               <RefreshCw size={14} className={`mr-1.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button 
              onClick={logout} 
              className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 text-xs font-semibold flex items-center transition-colors cursor-pointer"
            >
               <LogOut size={14} className="mr-1.5" /> Logout
            </button>
          </div>
        </div>

        {/* Tab Navigation Header */}
        <div className="flex border-b border-white/10 bg-slate-900/30 shrink-0">
          <button 
            onClick={() => { setSelectedCompanyIdToJoin(null); setActiveTab('myFleets'); }}
            className={`flex-1 py-3 px-4 text-xs font-bold transition-all duration-200 border-b-2 flex items-center justify-center space-x-2 cursor-pointer ${
              activeTab === 'myFleets' 
                ? 'border-cyan-400 text-cyan-400 bg-cyan-500/10' 
                : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-white/5'
            }`}
          >
            <Building2 size={14} />
            <span>My Fleets {joinedCompanies.length > 0 && `(${joinedCompanies.length})`}</span>
          </button>
          
          <button 
            onClick={() => { setSelectedCompanyIdToJoin(null); setActiveTab('join'); }}
            className={`flex-1 py-3 px-4 text-xs font-bold transition-all duration-200 border-b-2 flex items-center justify-center space-x-2 cursor-pointer ${
              activeTab === 'join' 
                ? 'border-primary-400 text-primary-400 bg-primary-500/10' 
                : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-white/5'
            }`}
          >
            <Radio size={14} />
            <span>Join Network Fleet</span>
          </button>

          <button 
            onClick={() => { setSelectedCompanyIdToJoin(null); setActiveTab('create'); }}
            className={`flex-1 py-3 px-4 text-xs font-bold transition-all duration-200 border-b-2 flex items-center justify-center space-x-2 cursor-pointer ${
              activeTab === 'create' 
                ? 'border-accent-400 text-accent-400 bg-accent-500/10' 
                : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-white/5'
            }`}
          >
            <PlusCircle size={14} />
            <span>Create Fleet</span>
          </button>
        </div>
        
        {/* Tab Body */}
        <div className="p-6 overflow-y-auto flex-1">
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
                  <button onClick={() => setSelectedCompanyIdToJoin(null)} className="btn-secondary text-sm px-4 py-2 cursor-pointer">Cancel</button>
                  <button onClick={() => handleJoin(selectedCompanyIdToJoin, joinPassword)} className="btn-primary text-sm px-4 py-2 cursor-pointer">Join Company</button>
                </div>
             </div>
           ) : (
             <>
                {/* TAB 1: My Fleets */}
                {activeTab === 'myFleets' && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
                        Joined Workspace Fleets
                      </h3>
                      <span className="text-[11px] text-gray-400">Select a fleet to set active workspace</span>
                    </div>

                    {loading ? (
                      <p className="text-gray-400 text-sm animate-pulse py-4">Loading your fleets...</p>
                    ) : joinedCompanies.length === 0 ? (
                      <div className="bg-slate-900/40 p-6 rounded-xl border border-white/5 text-center">
                        <Building2 size={32} className="mx-auto text-gray-500 mb-2" />
                        <p className="text-gray-300 font-semibold text-sm">No Joined Fleets Yet</p>
                        <p className="text-xs text-gray-400 mt-1 mb-4">Join an existing network fleet or initialize your own.</p>
                        <div className="flex justify-center space-x-3">
                          <button onClick={() => setActiveTab('join')} className="btn-secondary text-xs px-3 py-1.5 cursor-pointer">Join Fleet</button>
                          <button onClick={() => setActiveTab('create')} className="btn-primary text-xs px-3 py-1.5 cursor-pointer">Create Fleet</button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {joinedCompanies.map(comp => {
                          const isCurrent = comp.id === currentCompanyId;
                          return (
                            <div 
                              key={comp.id} 
                              className={`flex justify-between items-center p-4 rounded-xl border transition-all ${
                                isCurrent 
                                  ? 'bg-sky-500/15 border-sky-400/40 shadow-[0_0_15px_rgba(56,189,248,0.15)]' 
                                  : 'bg-slate-800/40 border-white/10 hover:border-white/20 hover:bg-slate-800/70'
                              }`}
                            >
                              <div className="flex items-center space-x-3.5">
                                <div className={`p-2.5 rounded-lg ${isCurrent ? 'bg-sky-500/20 text-sky-400' : 'bg-white/5 text-gray-400'}`}>
                                  <Building2 size={20} />
                                </div>
                                <div>
                                  <span className="text-gray-100 font-bold block text-sm">{comp.name}</span>
                                  {isCurrent ? (
                                    <span className="text-[10px] font-bold text-sky-400 flex items-center mt-0.5">
                                      <CheckCircle2 size={11} className="mr-1" /> Currently Active Workspace
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-gray-400 block mt-0.5">Click switch to switch workspace</span>
                                  )}
                                </div>
                              </div>
                              <button 
                                onClick={() => handleSelectJoined(comp.id)} 
                                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                  isCurrent 
                                    ? 'bg-sky-500 text-white shadow-md' 
                                    : 'bg-white/10 hover:bg-sky-500 text-white border border-white/10 hover:border-transparent'
                                }`}
                              >
                                {isCurrent ? 'Active' : 'Switch Fleet'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 2: Join Network Fleet */}
                {activeTab === 'join' && (
                  <div className="space-y-4">
                    <h3 className="text-xs font-bold text-primary-400 uppercase tracking-wider">
                      Available Network Fleets
                    </h3>
                    {loading ? (
                      <p className="text-gray-400 text-sm animate-pulse py-4">Scanning network fleets...</p>
                    ) : availableCompanies.length === 0 ? (
                      <p className="text-gray-400 text-sm bg-slate-900/30 p-4 rounded-xl border border-white/5">
                        No additional public network fleets available to join.
                      </p>
                    ) : (
                      <ul className="space-y-2.5">
                        {availableCompanies.map(comp => (
                          <li key={comp.id} className="flex justify-between items-center p-3.5 glass-card group hover:border-white/20">
                            <div className="flex items-center space-x-3">
                              <div className="p-2 rounded-lg bg-white/5 text-gray-400">
                                <Users size={16} />
                              </div>
                              <div>
                                <span className="text-gray-200 font-semibold text-sm block">
                                  {comp.name} 
                                </span>
                                {comp.requirePassword && (
                                  <span className="text-[10px] bg-slate-700/60 px-2 py-0.5 rounded text-gray-400 border border-white/5 font-semibold inline-block mt-0.5">
                                    Password Protected
                                  </span>
                                )}
                              </div>
                            </div>
                            <button 
                              onClick={() => handleJoinClick(comp.id)} 
                              className="px-4 py-2 bg-white/10 hover:bg-primary-500 text-white rounded-lg transition-all duration-200 text-xs font-semibold border border-white/10 hover:border-transparent cursor-pointer"
                            >
                              Join Fleet
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {/* TAB 3: Create New Fleet */}
                {activeTab === 'create' && (
                  <div className="space-y-4">
                    <h3 className="text-xs font-bold text-accent-400 uppercase tracking-wider flex items-center">
                      <PlusCircle size={14} className="mr-1.5" />
                      Initialize New Fleet Workspace
                    </h3>
                    <form onSubmit={handleCreate} className="space-y-4 bg-slate-900/40 p-5 rounded-xl border border-white/5">
                      <div>
                        <label className="block text-xs font-semibold text-gray-300 mb-1.5">Fleet / Company Name</label>
                        <input 
                          type="text" 
                          placeholder="e.g. Apex Logistics Solutions" 
                          className="glass-input text-sm py-2.5" 
                          value={newCompanyName}
                          onChange={(e) => setNewCompanyName(e.target.value)}
                          required 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-300 mb-1.5">Access Password (Optional)</label>
                        <input 
                          type="password" 
                          placeholder="Set password for team members to join" 
                          className="glass-input text-sm py-2.5" 
                          value={newCompanyPassword}
                          onChange={(e) => setNewCompanyPassword(e.target.value)}
                        />
                      </div>
                      <button type="submit" className="w-full btn-accent py-3 text-sm font-bold mt-2 shadow-lg cursor-pointer">
                        Initialize Fleet & Set Active
                      </button>
                    </form>
                  </div>
                )}
             </>
           )}
        </div>
      </div>
    </div>
  );
}
