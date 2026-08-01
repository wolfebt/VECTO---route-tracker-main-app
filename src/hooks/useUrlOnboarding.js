import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useToastStore } from '../store/useToastStore';
import { useCompany } from './useFirebase';
import { doc, getDoc, updateDoc, arrayUnion, arrayRemove, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

export function useUrlOnboarding() {
  const currentUser = useAppStore(state => state.currentUser);
  const companyId = useAppStore(state => state.companyId);
  const setSelectedJobId = useAppStore(state => state.setSelectedJobId);
  const addToast = useToastStore(state => state.addToast);
  const { joinCompany, loadCompany } = useCompany();

  const processedRef = useRef(false);

  // Capture URL search parameters on initial load and store in sessionStorage if needed
  useEffect(() => {
    try {
      const searchParams = new URLSearchParams(window.location.search);
      const urlCompany = searchParams.get('company');
      const urlJob = searchParams.get('job');

      if (urlCompany) {
        sessionStorage.setItem('vecto_pending_company', urlCompany);
      }
      if (urlJob) {
        sessionStorage.setItem('vecto_pending_job', urlJob);
      }
    } catch (e) {
      console.warn("Failed to parse URL search params:", e);
    }
  }, []);

  // Process onboarding once user is logged in
  useEffect(() => {
    if (!currentUser || processedRef.current) return;

    const processOnboarding = async () => {
      const pendingCompany = sessionStorage.getItem('vecto_pending_company');
      const pendingJob = sessionStorage.getItem('vecto_pending_job');

      if (!pendingCompany && !pendingJob) return;

      processedRef.current = true;
      const targetCompanyId = pendingCompany || companyId;

      try {
        if (targetCompanyId) {
          // Ensure driver is added to the company and user profile
          const isUserInCompany = currentUser.companies?.includes(targetCompanyId);
          
          if (!isUserInCompany) {
            // Join company automatically
            const compDoc = await getDoc(doc(db, 'companies', targetCompanyId));
            if (compDoc.exists()) {
              await updateDoc(doc(db, 'users', currentUser.id), { companies: arrayUnion(targetCompanyId) });
              await setDoc(doc(db, `companies/${targetCompanyId}/members/${currentUser.id}`), {
                email: currentUser.email || '',
                name: currentUser.name || currentUser.email || 'New Driver',
                joinedAt: serverTimestamp(),
                permissions: { canCreateJob: false, canDeleteJob: false, canManageDrivers: false }
              });

              // Add driver to active company drivers list
              await setDoc(doc(db, `companies/${targetCompanyId}/active_drivers/${currentUser.id}`), {
                name: currentUser.name || currentUser.email || 'Driver',
                email: currentUser.email || '',
                status: 'Available',
                timestamp: serverTimestamp()
              });

              useAppStore.setState(state => ({
                currentUser: {
                  ...state.currentUser,
                  companies: [...(state.currentUser.companies || []), targetCompanyId]
                }
              }));

              addToast(`Added to company drivers list!`, "success");
            }
          }

          // Load active company into store
          await loadCompany(targetCompanyId);
        }

        // Process Job Onboarding if job ID is provided
        if (pendingJob && targetCompanyId) {
          const jobRef = doc(db, `companies/${targetCompanyId}/jobs/${pendingJob}`);
          const jobDoc = await getDoc(jobRef);

          if (jobDoc.exists()) {
            const jobData = jobDoc.data();
            const currentAssigned = jobData.assignedDrivers || [];
            const isAlreadyAssigned = currentAssigned.some(d => d.id === currentUser.id);

            if (!isAlreadyAssigned) {
              const updatedDrivers = [
                ...currentAssigned,
                { id: currentUser.id, name: currentUser.name || currentUser.email || 'Driver' }
              ];

              let updates = { assignedDrivers: updatedDrivers };
              if (jobData.status === 'unassigned') {
                updates.status = 'in-progress';
              }

              await updateDoc(jobRef, updates);
              addToast(`Assigned to job: ${jobData.jobName || 'Selected Job'}`, "success");
            }

            setSelectedJobId(pendingJob);
          } else {
            addToast("Job link expired or not found.", "warning");
          }
        }

        // Clean up URL parameters and session storage
        sessionStorage.removeItem('vecto_pending_company');
        sessionStorage.removeItem('vecto_pending_job');
        if (window.history.replaceState) {
          window.history.replaceState(null, '', window.location.pathname);
        }
      } catch (err) {
        console.error("Error processing onboarding from URL:", err);
        addToast("Onboarding setup incomplete: " + err.message, "error");
      }
    };

    processOnboarding();
  }, [currentUser, companyId, loadCompany, setSelectedJobId, addToast]);
}
