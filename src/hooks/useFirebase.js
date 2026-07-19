import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot, collection, query, serverTimestamp, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useAppStore } from '../store/useAppStore';

export function useAuth() {
  const setCurrentUser = useAppStore(state => state.setCurrentUser);
  const setMapsApiKey = useAppStore(state => state.setMapsApiKey);
  const setFirebaseApiKey = useAppStore(state => state.setFirebaseApiKey);
  const setGeminiApiKey = useAppStore(state => state.setGeminiApiKey);
  
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        let userData = { id: user.uid, email: user.email, name: user.displayName || user.email, companies: [], preferences: {} };
        
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (!userDoc.exists()) {
          await setDoc(userDocRef, {
            email: user.email,
            name: user.displayName,
            createdAt: serverTimestamp(),
            companies: [],
            preferences: {}
          });
        } else {
          const data = userDoc.data();
          userData.companies = data.companies || [];
          userData.preferences = data.preferences || {};
          userData.lastRead = data.lastRead || {};
          
          if (data.preferences.mapsApiKey) {
            setMapsApiKey(data.preferences.mapsApiKey);
          } else {
            const localKey = localStorage.getItem('mapsApiKey');
            if (localKey) {
              setMapsApiKey(localKey);
              await updateDoc(userDocRef, { 'preferences.mapsApiKey': localKey });
            }
          }
          
          if (data.preferences.firebaseApiKey) {
            setFirebaseApiKey(data.preferences.firebaseApiKey);
          } else {
            const localFirebaseKey = localStorage.getItem('firebaseApiKey');
            if (localFirebaseKey) {
              setFirebaseApiKey(localFirebaseKey);
              await updateDoc(userDocRef, { 'preferences.firebaseApiKey': localFirebaseKey });
            }
          }
          
          if (data.preferences.geminiApiKey) {
            setGeminiApiKey(data.preferences.geminiApiKey);
          } else {
            const localGeminiKey = localStorage.getItem('geminiApiKey');
            if (localGeminiKey) {
              setGeminiApiKey(localGeminiKey);
              await updateDoc(userDocRef, { 'preferences.geminiApiKey': localGeminiKey });
            }
          }
        }
        setCurrentUser(userData);
      } else {
        setCurrentUser(null);
      }
    });
    return unsub;
  }, [setCurrentUser, setMapsApiKey, setFirebaseApiKey, setGeminiApiKey]);

  const login = () => signInWithPopup(auth, new GoogleAuthProvider());
  const logout = () => signOut(auth);
  
  return { login, logout };
}

export function useCompany() {
  const companyId = useAppStore(state => state.companyId);
  const setCompany = useAppStore(state => state.setCompany);
  const currentUser = useAppStore(state => state.currentUser);
  const [members, setMembers] = useState([]);
  
  // Listen to members when companyId changes
  useEffect(() => {
    if (!companyId || !currentUser) return;
    
    const q = query(collection(db, `companies/${companyId}/members`));
    const unsub = onSnapshot(q, (snap) => {
      const allMembers = [];
      snap.forEach(doc => allMembers.push({ id: doc.id, ...doc.data() }));
      setMembers(allMembers);
      
      const myMemberDoc = allMembers.find(m => m.id === currentUser.id);
      if (myMemberDoc) {
        const isSuperAdmin = currentUser.email?.toLowerCase() === 'btw.284@gmail.com';
        const perms = myMemberDoc.permissions || {};
        const isDispatch = perms.canCreateJob || perms.canManageDrivers || isSuperAdmin;
        
        // Only update store if dispatch view changed to avoid infinite loops
        useAppStore.setState(prev => prev.isDispatchView !== isDispatch ? { isDispatchView: isDispatch } : {});
      }
    }, (error) => {
      console.error("Error listening to company members:", error);
    });
    
    return unsub;
  }, [companyId, currentUser]);

  const loadCompany = async (id) => {
    try {
      const d = await getDoc(doc(db, 'companies', id));
      if (d.exists()) {
        setCompany(id, d.data().name, false); // isDispatch will be updated by member listener
        
        // Self-healing from original code
        if (d.data().createdBy === currentUser.id) {
           const memberRef = doc(db, `companies/${id}/members/${currentUser.id}`);
           const memberDoc = await getDoc(memberRef);
           if (!memberDoc.exists()) {
               await setDoc(memberRef, {
                  email: currentUser.email,
                  name: currentUser.name,
                  joinedAt: serverTimestamp(),
                  permissions: { canCreateJob: true, canDeleteJob: true, canManageDrivers: true }
               });
           }
        }
      } else {
        console.warn(`Company ${id} not found, removing from user profile.`);
        await updateDoc(doc(db, 'users', currentUser.id), { companies: arrayRemove(id) });
        useAppStore.setState(state => ({
          currentUser: { 
            ...state.currentUser, 
            companies: state.currentUser.companies.filter(c => c !== id) 
          }
        }));
      }
    } catch (e) {
      console.error("Error loading company:", e);
    }
  };

  const joinCompany = async (id, password = null) => {
    if (currentUser.companies.includes(id)) {
      loadCompany(id);
      return { success: true };
    }
    const compDoc = await getDoc(doc(db, 'companies', id));
    if (!compDoc.exists()) throw new Error("Company not found");

    const compData = compDoc.data();
    if (compData.requirePassword && compData.password !== password) {
       return { success: false, requiresPassword: true };
    }

    await updateDoc(doc(db, 'users', currentUser.id), { companies: arrayUnion(id) });
    await setDoc(doc(db, `companies/${id}/members/${currentUser.id}`), {
        email: currentUser.email,
        name: currentUser.name,
        joinedAt: serverTimestamp(),
        permissions: { canCreateJob: false, canDeleteJob: false, canManageDrivers: false }
    });
    
    useAppStore.setState(state => ({
      currentUser: { ...state.currentUser, companies: [...state.currentUser.companies, id] }
    }));
    loadCompany(id);
    return { success: true };
  };

  return { members, loadCompany, joinCompany };
}

export function useJobs() {
  const companyId = useAppStore(state => state.companyId);
  const currentUser = useAppStore(state => state.currentUser);
  const [jobs, setJobs] = useState([]);
  
  useEffect(() => {
    if (!companyId || !currentUser) {
      setJobs([]);
      return;
    }
    
    const q = query(collection(db, `companies/${companyId}/jobs`));
    const unsub = onSnapshot(q, (snap) => {
      const allJobs = [];
      snap.forEach(doc => allJobs.push({ id: doc.id, ...doc.data() }));
      setJobs(allJobs);
    }, (error) => {
      console.error("Error listening to jobs:", error);
    });
    
    return unsub;
  }, [companyId, currentUser]);
  
  return jobs;
}

export function useActiveDrivers() {
  const companyId = useAppStore(state => state.companyId);
  const currentUser = useAppStore(state => state.currentUser);
  const [drivers, setDrivers] = useState([]);
  
  useEffect(() => {
    if (!companyId || !currentUser) {
      setDrivers([]);
      return;
    }
    
    const q = query(collection(db, `companies/${companyId}/active_drivers`));
    const unsub = onSnapshot(q, (snap) => {
      const allDrivers = [];
      snap.forEach(doc => allDrivers.push({ id: doc.id, ...doc.data() }));
      setDrivers(allDrivers);
    }, (error) => {
      console.error("Error listening to active drivers:", error);
    });
    
    return unsub;
  }, [companyId, currentUser]);
  
  return drivers;
}
