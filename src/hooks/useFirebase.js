import { useEffect, useState, useCallback, useRef } from 'react';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, signInWithCredential } from 'firebase/auth';
import { doc, getDoc, getDocs, setDoc, deleteDoc, onSnapshot, collection, query, where, orderBy, limit, startAfter, serverTimestamp, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { auth, db, storage } from '../firebase';
import { useAppStore } from '../store/useAppStore';
import { useToastStore } from '../store/useToastStore';
import { hashPassword, hashCompanyPassword } from '../utils/crypto';
import { toMillisSafe } from '../utils/formatters';
import { flushOfflinePodQueue } from '../utils/offlineQueue';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';

export const ARCHIVE_PAGE_SIZE = 25;
const archiveCursorByCompany = new Map();

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
        
        let localProfile = null;
        try {
          const raw = localStorage.getItem('vecto_driver_profile');
          if (raw) localProfile = JSON.parse(raw);
        } catch (e) {
          console.warn("Could not read local profile cache:", e);
        }

        if (!userDoc.exists()) {
          const initialProfile = {
            email: user.email,
            name: localProfile?.name || user.displayName || user.email,
            phone: localProfile?.phone || localProfile?.number || '',
            number: localProfile?.phone || localProfile?.number || '',
            color: localProfile?.color || '#22c55e',
            createdAt: serverTimestamp(),
            companies: [],
            preferences: {}
          };
          await setDoc(userDocRef, initialProfile, { merge: true });
          userData.name = initialProfile.name;
          userData.phone = initialProfile.phone;
          userData.number = initialProfile.number;
          userData.color = initialProfile.color;
        } else {
          const data = userDoc.data();
          const prefs = data.preferences || {};
          userData.name = data.name || localProfile?.name || user.displayName || user.email;
          userData.phone = data.phone || data.number || localProfile?.phone || localProfile?.number || '';
          userData.number = userData.phone;
          userData.color = data.color || localProfile?.color || '#22c55e';
          userData.companies = data.companies || [];
          userData.preferences = prefs;
          userData.lastRead = data.lastRead || {};

          if ((!data.phone && userData.phone) || (!data.color && userData.color) || (!data.name && userData.name)) {
            setDoc(userDocRef, {
              name: userData.name,
              phone: userData.phone,
              number: userData.phone,
              color: userData.color
            }, { merge: true }).catch(console.warn);
          }
          
          if (prefs.mapsApiKey) {
            setMapsApiKey(prefs.mapsApiKey);
          } else {
            const localKey = localStorage.getItem('mapsApiKey');
            if (localKey) {
              setMapsApiKey(localKey);
              await updateDoc(userDocRef, { 'preferences.mapsApiKey': localKey });
            }
          }
          
          if (prefs.firebaseApiKey) {
            setFirebaseApiKey(prefs.firebaseApiKey);
          } else {
            const localFirebaseKey = localStorage.getItem('firebaseApiKey');
            if (localFirebaseKey) {
              setFirebaseApiKey(localFirebaseKey);
              await updateDoc(userDocRef, { 'preferences.firebaseApiKey': localFirebaseKey });
            }
          }
          
          if (prefs.geminiApiKey) {
            setGeminiApiKey(prefs.geminiApiKey);
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

  const login = async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        const result = await FirebaseAuthentication.signInWithGoogle();
        if (result.credential?.idToken) {
          const credential = GoogleAuthProvider.credential(result.credential.idToken);
          return await signInWithCredential(auth, credential);
        }
        throw new Error("No Google credentials returned from native account picker.");
      } catch (err) {
        console.error("Native Google sign-in failed:", err);
        throw err;
      }
    } else {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      return signInWithPopup(auth, provider);
    }
  };

  const logout = async () => {
    useAppStore.getState().triggerSplash();
    useAppStore.getState().clearCompany();
    if (Capacitor.isNativePlatform()) {
      try {
        await FirebaseAuthentication.signOut();
      } catch (e) {
        console.warn("Native FirebaseAuthentication signOut error:", e);
      }
    }
    await signOut(auth);
  };
  
  return { login, logout };
}

/**
 * Top-level Firestore listener orchestrator.
 * Should be mounted once in App.jsx to keep store state synchronized without duplicate listeners.
 */
export function useWorkspaceSync() {
  const companyId = useAppStore(state => state.companyId);
  const currentUser = useAppStore(state => state.currentUser);
  const isDispatchView = useAppStore(state => state.isDispatchView);
  const selectedJobId = useAppStore(state => state.selectedJobId);
  const clearCompany = useAppStore(state => state.clearCompany);
  const setActiveJobs = useAppStore(state => state.setActiveJobs);
  const setMembers = useAppStore(state => state.setMembers);
  const setActiveDrivers = useAppStore(state => state.setActiveDrivers);
  const setVehicles = useAppStore(state => state.setVehicles);
  const setInspections = useAppStore(state => state.setInspections);
  const setShowNameplates = useAppStore(state => state.setShowNameplates);
  const members = useAppStore(state => state.members);

  const [companyMeta, setCompanyMeta] = useState(null);
  const hadOwnMemberDocRef = useRef(false);

  // 1. Company metadata listener
  useEffect(() => {
    if (!companyId || !currentUser) {
      setCompanyMeta(null);
      return;
    }

    const unsub = onSnapshot(doc(db, 'companies', companyId), (snap) => {
      if (!snap.exists()) {
        clearCompany();
        return;
      }
      const compData = snap.data();
      if ((compData.removedMemberIds || []).includes(currentUser.id)) {
        updateDoc(doc(db, 'users', currentUser.id), { companies: arrayRemove(companyId) }).catch(console.warn);
        useAppStore.setState(state => ({
          currentUser: state.currentUser
            ? { ...state.currentUser, companies: (state.currentUser.companies || []).filter(c => c !== companyId) }
            : null
        }));
        useToastStore.getState().addToast("You no longer have access to this fleet workspace.", "error");
        clearCompany();
        return;
      }
      setCompanyMeta({ id: snap.id, ...compData });
      setShowNameplates(compData.showNameplates !== false);
      if (compData.name && useAppStore.getState().companyName !== compData.name) {
        useAppStore.setState({ companyName: compData.name });
      }
    }, (error) => {
      console.error("Error listening to company document:", error);
    });

    return unsub;
  }, [companyId, currentUser, clearCompany, setShowNameplates]);

  // 2. Members subcollection listener
  useEffect(() => {
    hadOwnMemberDocRef.current = false;
    if (!companyId || !currentUser) {
      setMembers([]);
      return;
    }

    const q = query(collection(db, `companies/${companyId}/members`));
    const unsub = onSnapshot(q, (snap) => {
      const allMembers = [];
      snap.forEach(d => allMembers.push({ id: d.id, ...d.data() }));
      setMembers(allMembers);
    }, (error) => {
      console.error("Error listening to company members:", error);
    });

    return unsub;
  }, [companyId, currentUser, setMembers]);

  // 3. Reconcile role permissions & detect member removal via private security
  useEffect(() => {
    if (!companyId || !currentUser || !companyMeta) return;
    const myMemberDoc = members.find(m => m.id === currentUser.id);
    const isCreator = companyMeta.createdBy === currentUser.id;

    if (myMemberDoc) {
      hadOwnMemberDocRef.current = true;
    } else if (hadOwnMemberDocRef.current && !isCreator) {
      hadOwnMemberDocRef.current = false;
      updateDoc(doc(db, 'users', currentUser.id), { companies: arrayRemove(companyId) }).catch(console.warn);
      useAppStore.setState(state => ({
        currentUser: state.currentUser
          ? { ...state.currentUser, companies: (state.currentUser.companies || []).filter(c => c !== companyId) }
          : null
      }));
      useToastStore.getState().addToast("You no longer have access to this fleet workspace.", "error");
      clearCompany();
      return;
    }

    const rawPerms = myMemberDoc?.permissions || {};
    const nextPerms = {
      canCreateJob: !!(isCreator || rawPerms.canCreateJob),
      canDeleteJob: !!(isCreator || rawPerms.canDeleteJob),
      canManageDrivers: !!(isCreator || rawPerms.canManageDrivers),
      isCreator
    };
    const isDispatch = nextPerms.canCreateJob || nextPerms.canManageDrivers;

    useAppStore.setState((prev) => {
      const prevPerms = prev.memberPermissions || {};
      const permsChanged =
        prevPerms.canCreateJob !== nextPerms.canCreateJob ||
        prevPerms.canDeleteJob !== nextPerms.canDeleteJob ||
        prevPerms.canManageDrivers !== nextPerms.canManageDrivers ||
        prevPerms.isCreator !== nextPerms.isCreator;

      if (prev.isDispatchView === isDispatch && !permsChanged) return {};
      return { isDispatchView: isDispatch, memberPermissions: nextPerms };
    });
  }, [companyId, currentUser, companyMeta, members, clearCompany]);

  // 4. Active-only Jobs subcollection listener (archived jobs are fetched paginated on demand)
  useEffect(() => {
    if (!companyId || !currentUser) {
      setActiveJobs([]);
      return;
    }

    let cancelled = false;
    let latestActiveSnapDocs = [];
    let legacyUnarchivedDocs = [];

    const publishMergedActive = () => {
      if (cancelled) return;
      const byId = new Map();
      legacyUnarchivedDocs.forEach((j) => byId.set(j.id, j));
      latestActiveSnapDocs.forEach((j) => byId.set(j.id, j));
      setActiveJobs(Array.from(byId.values()));
    };

    const q = query(collection(db, `companies/${companyId}/jobs`), where('archived', '==', false));
    const unsub = onSnapshot(q, (snap) => {
      const activeList = [];
      snap.forEach((d) => activeList.push({ id: d.id, ...d.data() }));
      latestActiveSnapDocs = activeList;
      publishMergedActive();
    }, (error) => {
      console.error("Error listening to active jobs:", error);
    });

    // One-time legacy check for older job documents missing a boolean `archived` field
    getDocs(query(collection(db, `companies/${companyId}/jobs`), limit(100)))
      .then((snap) => {
        if (cancelled) return;
        const canBackfill = useAppStore.getState().isDispatchView;
        const foundLegacy = [];
        snap.forEach((d) => {
          const data = d.data();
          if (typeof data.archived !== 'boolean') {
            const isArch = data.status === 'archived';
            if (!isArch) {
              foundLegacy.push({ id: d.id, ...data, archived: false });
            }
            if (canBackfill) {
              updateDoc(doc(db, `companies/${companyId}/jobs`, d.id), {
                archived: isArch,
              }).catch(() => {});
            }
          }
        });
        if (foundLegacy.length > 0) {
          legacyUnarchivedDocs = foundLegacy;
          publishMergedActive();
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unsub();
    };
  }, [companyId, currentUser, setActiveJobs]);

  // 4b. Auto-flush queued offline POD uploads when authenticated and online
  useEffect(() => {
    if (!companyId || !currentUser) return;
    if (typeof navigator === 'undefined' || navigator.onLine) {
      flushOfflinePodQueue(db, storage).catch(() => {});
    }
    const handleOnline = () => {
      flushOfflinePodQueue(db, storage).catch(() => {});
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [companyId, currentUser]);

  // 5. Active drivers telemetry listener (scoped for non-dispatchers)
  useEffect(() => {
    if (!companyId || !currentUser) {
      setActiveDrivers([]);
      return;
    }

    if (isDispatchView) {
      const q = query(collection(db, `companies/${companyId}/active_drivers`));
      const unsub = onSnapshot(q, (snap) => {
        const allDrivers = [];
        snap.forEach(d => allDrivers.push({ id: d.id, ...d.data() }));
        setActiveDrivers(allDrivers);
      }, (error) => {
        console.warn("Active drivers subscription notification:", error.message || error);
      });
      return unsub;
    }

    let ownDriver = null;
    let jobTeammates = [];

    const syncMerged = () => {
      const mergedMap = {};
      jobTeammates.forEach(d => { mergedMap[d.id] = d; });
      if (ownDriver) mergedMap[ownDriver.id] = ownDriver;
      setActiveDrivers(Object.values(mergedMap));
    };

    const unsubOwn = onSnapshot(
      doc(db, `companies/${companyId}/active_drivers`, currentUser.id),
      (snap) => {
        ownDriver = snap.exists() ? { id: snap.id, ...snap.data() } : null;
        syncMerged();
      },
      (error) => {
        console.warn("Own driver location subscription warning:", error.message || error);
      }
    );

    let unsubTeammates = null;
    if (selectedJobId) {
      const teammatesQuery = query(
        collection(db, `companies/${companyId}/active_drivers`),
        where('activeJobId', '==', selectedJobId)
      );
      unsubTeammates = onSnapshot(
        teammatesQuery,
        (snap) => {
          const list = [];
          snap.forEach(d => list.push({ id: d.id, ...d.data() }));
          jobTeammates = list;
          syncMerged();
        },
        (error) => {
          console.warn("Teammate location subscription warning:", error.message || error);
        }
      );
    }

    return () => {
      unsubOwn();
      if (unsubTeammates) unsubTeammates();
    };
  }, [companyId, currentUser, isDispatchView, selectedJobId, setActiveDrivers]);

  // 6. Vehicles subcollection listener
  useEffect(() => {
    if (!companyId || !currentUser) {
      setVehicles([]);
      return;
    }

    const q = query(collection(db, `companies/${companyId}/vehicles`));
    const unsub = onSnapshot(q, (snap) => {
      const list = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      list.sort((a, b) => String(a.unitNumber || '').localeCompare(String(b.unitNumber || '')));
      setVehicles(list);
    }, (error) => {
      console.warn("Vehicles listener warning:", error.message || error);
    });

    return unsub;
  }, [companyId, currentUser, setVehicles]);

  // 7. DVIR Inspections subcollection listener
  useEffect(() => {
    if (!companyId || !currentUser) {
      setInspections([]);
      return;
    }

    const q = query(collection(db, `companies/${companyId}/inspections`));
    const unsub = onSnapshot(q, (snap) => {
      const list = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      list.sort((a, b) => toMillisSafe(b.createdAt) - toMillisSafe(a.createdAt));
      setInspections(list);
    }, (error) => {
      console.warn("Inspections listener warning:", error.message || error);
    });

    return unsub;
  }, [companyId, currentUser, setInspections]);
}

export function useCompany() {
  const members = useAppStore(state => state.members);
  const setCompany = useAppStore(state => state.setCompany);
  const currentUser = useAppStore(state => state.currentUser);

  const loadCompany = useCallback(async (id) => {
    const user = useAppStore.getState().currentUser || currentUser;
    try {
      const d = await getDoc(doc(db, 'companies', id));
      if (d.exists()) {
        const compData = d.data();
        if (user?.id && (compData.removedMemberIds || []).includes(user.id)) {
          await updateDoc(doc(db, 'users', user.id), { companies: arrayRemove(id) }).catch(console.warn);
          try { localStorage.removeItem('vecto_last_company_id'); } catch (e) { console.warn(e); }
          useAppStore.setState(state => ({
            currentUser: {
              ...state.currentUser,
              companies: (state.currentUser?.companies || []).filter(c => c !== id)
            }
          }));
          useToastStore.getState().addToast("You no longer have access to this fleet workspace.", "error");
          return { removed: true };
        }

        setCompany(id, compData.name, false);

        if (user?.id) {
          const memberRef = doc(db, `companies/${id}/members/${user.id}`);
          const memberDoc = await getDoc(memberRef);
          const isCreator = compData.createdBy === user.id;
          const memberPayload = {
            email: user.email || '',
            name: user.name || user.email || 'Driver',
            phone: user.phone || user.number || '',
            number: user.phone || user.number || '',
            color: user.color || '#22c55e',
          };

          if (!memberDoc.exists()) {
            try {
              await setDoc(memberRef, {
                ...memberPayload,
                joinedAt: serverTimestamp(),
                permissions: isCreator 
                  ? { canCreateJob: true, canDeleteJob: true, canManageDrivers: true }
                  : { canCreateJob: false, canDeleteJob: false, canManageDrivers: false }
              });
            } catch (memberErr) {
              if (!isCreator && memberErr?.code === 'permission-denied') {
                await updateDoc(doc(db, 'users', user.id), { companies: arrayRemove(id) }).catch(console.warn);
                try { localStorage.removeItem('vecto_last_company_id'); } catch (e) { console.warn(e); }
                useAppStore.setState(state => ({
                  currentUser: {
                    ...state.currentUser,
                    companies: (state.currentUser?.companies || []).filter(c => c !== id)
                  }
                }));
                setCompany(null, null, false);
                useToastStore.getState().addToast("You no longer have access to this fleet workspace.", "error");
                return { removed: true };
              }
              throw memberErr;
            }
          } else {
            await setDoc(memberRef, memberPayload, { merge: true });
          }

          const existingPerms = memberDoc.exists() ? (memberDoc.data()?.permissions || {}) : {};
          if (isCreator || existingPerms.canManageDrivers || existingPerms.canCreateJob) {
            setDoc(
              doc(db, 'company_directory', id),
              {
                name: compData.name || 'Fleet',
                requirePassword: !!compData.requirePassword,
                createdBy: compData.createdBy || '',
                updatedAt: serverTimestamp()
              },
              { merge: true }
            ).catch(() => {});
          }

          const userComps = user.companies || [];
          if (!userComps.includes(id)) {
            await updateDoc(doc(db, 'users', user.id), { companies: arrayUnion(id) }).catch(console.warn);
            useAppStore.setState(state => ({
              currentUser: { ...state.currentUser, companies: [...userComps, id] }
            }));
          }
        }
        return { success: true };
      } else if (user?.id) {
        console.warn(`Company ${id} not found, removing from user profile.`);
        await updateDoc(doc(db, 'users', user.id), { companies: arrayRemove(id) });
        useAppStore.setState(state => ({
          currentUser: { 
            ...state.currentUser, 
            companies: (state.currentUser?.companies || []).filter(c => c !== id) 
          }
        }));
        return { notFound: true };
      }
      return { notFound: true };
    } catch (e) {
      console.error("Error loading company:", e);
      return { error: e };
    }
  }, [currentUser, setCompany]);

  const joinCompany = useCallback(async (id, password = null) => {
    const user = useAppStore.getState().currentUser || currentUser;
    const userComps = user?.companies || [];
    const compDoc = await getDoc(doc(db, 'companies', id));
    if (!compDoc.exists()) throw new Error("Company not found");

    const compData = compDoc.data();
    if ((compData.removedMemberIds || []).includes(user.id)) {
      throw new Error("You no longer have access to this fleet workspace.");
    }

    if (userComps.includes(id)) {
      await loadCompany(id);
      return { success: true };
    }

    const isCreator = compData.createdBy === user.id;
    const needsPasswordProof = Boolean(compData.requirePassword && !isCreator);
    const joinReqRef = doc(db, `companies/${id}/join_requests/${user.id}`);

    if (needsPasswordProof) {
      const trimmedPassword = String(password || '').trim();
      if (!trimmedPassword) {
        return { success: false, requiresPassword: true };
      }

      if (!compData.passwordHash && compData.password && compData.password !== trimmedPassword) {
        return { success: false, requiresPassword: true };
      }

      const proofHash = await hashCompanyPassword(id, trimmedPassword);
      const legacyProofHash = await hashPassword(trimmedPassword);
      await setDoc(joinReqRef, {
        proofHash,
        legacyProofHash,
        updatedAt: serverTimestamp()
      });
    }

    try {
      await setDoc(doc(db, `companies/${id}/members/${user.id}`), {
        email: user.email || '',
        name: user.name || user.email || 'Driver',
        phone: user.phone || user.number || '',
        number: user.phone || user.number || '',
        color: user.color || '#22c55e',
        joinedAt: serverTimestamp(),
        permissions: isCreator
          ? { canCreateJob: true, canDeleteJob: true, canManageDrivers: true }
          : { canCreateJob: false, canDeleteJob: false, canManageDrivers: false }
      }, { merge: true });
    } catch (err) {
      if (needsPasswordProof) {
        await deleteDoc(joinReqRef).catch(() => {});
        if (err?.code === 'permission-denied') {
          return { success: false, requiresPassword: true };
        }
      } else if (err?.code === 'permission-denied') {
        throw new Error("You no longer have access to this fleet workspace.");
      }
      throw err;
    }

    if (needsPasswordProof) {
      await deleteDoc(joinReqRef).catch(() => {});
    }

    await updateDoc(doc(db, 'users', user.id), { companies: arrayUnion(id) });
    
    useAppStore.setState(state => ({
      currentUser: { ...state.currentUser, companies: [...userComps, id] }
    }));
    await loadCompany(id);
    return { success: true };
  }, [currentUser, loadCompany]);

  return { members, loadCompany, joinCompany };
}

export function useJobs() {
  return useAppStore(state => state.jobs);
}

export function useActiveDrivers() {
  return useAppStore(state => state.activeDrivers);
}

export function useVehicles() {
  return useAppStore(state => state.vehicles);
}

export function useInspections() {
  return useAppStore(state => state.inspections);
}

/**
 * Cursor-paginated archived jobs loader (companies/{companyId}/jobs where archived == true).
 */
export function useArchivedJobs() {
  const companyId = useAppStore(state => state.companyId);
  const archivedJobs = useAppStore(state => state.archivedJobs);
  const hasMoreArchivedJobs = useAppStore(state => state.hasMoreArchivedJobs);
  const loadingArchivedJobs = useAppStore(state => state.loadingArchivedJobs);
  const archivedJobsLoadedOnce = useAppStore(state => state.archivedJobsLoadedOnce);
  const setArchivedJobsState = useAppStore(state => state.setArchivedJobsState);

  const loadArchivedPage = useCallback(
    async ({ reset = false } = {}) => {
      if (!companyId || useAppStore.getState().loadingArchivedJobs) return;
      setArchivedJobsState({ loadingArchivedJobs: true });

      if (reset) {
        archiveCursorByCompany.delete(companyId);
      }

      try {
        const cursor = reset ? null : (archiveCursorByCompany.get(companyId) || null);
        const constraints = [
          where('archived', '==', true),
          orderBy('createdAt', 'desc'),
          ...(cursor ? [startAfter(cursor)] : []),
          limit(ARCHIVE_PAGE_SIZE),
        ];
        const snap = await getDocs(query(collection(db, `companies/${companyId}/jobs`), ...constraints));
        const pageItems = [];
        snap.forEach((d) => pageItems.push({ id: d.id, ...d.data() }));

        const lastDoc = snap.docs[snap.docs.length - 1] || null;
        if (lastDoc) {
          archiveCursorByCompany.set(companyId, lastDoc);
        }

        const existing = reset ? [] : (useAppStore.getState().archivedJobs || []);
        const mergedMap = new Map();
        existing.forEach((j) => { if (j?.id) mergedMap.set(j.id, j); });
        pageItems.forEach((j) => { if (j?.id) mergedMap.set(j.id, j); });

        setArchivedJobsState({
          archivedJobs: Array.from(mergedMap.values()),
          hasMoreArchivedJobs: snap.docs.length === ARCHIVE_PAGE_SIZE,
          archivedJobsLoadedOnce: true,
          loadingArchivedJobs: false,
        });
      } catch (err) {
        if (err?.code === 'failed-precondition') {
          try {
            const fallbackSnap = await getDocs(
              query(collection(db, `companies/${companyId}/jobs`), where('archived', '==', true), limit(100))
            );
            const fallbackItems = [];
            fallbackSnap.forEach((d) => fallbackItems.push({ id: d.id, ...d.data() }));
            fallbackItems.sort((a, b) => toMillisSafe(b.createdAt) - toMillisSafe(a.createdAt));
            setArchivedJobsState({
              archivedJobs: fallbackItems,
              hasMoreArchivedJobs: false,
              archivedJobsLoadedOnce: true,
              loadingArchivedJobs: false,
            });
            return;
          } catch (fallbackErr) {
            console.warn('Archived jobs fallback query failed:', fallbackErr);
          }
        } else {
          console.warn('Failed to load archived jobs page:', err);
        }
        setArchivedJobsState({
          archivedJobsLoadedOnce: true,
          loadingArchivedJobs: false,
        });
      }
    },
    [companyId, setArchivedJobsState]
  );

  return {
    archivedJobs,
    hasMoreArchivedJobs,
    loadingArchivedJobs,
    archivedJobsLoadedOnce,
    loadArchivedPage,
  };
}
