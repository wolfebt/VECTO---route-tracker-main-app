import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useToastStore } from '../store/useToastStore';
import { useCompany } from './useFirebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

export function useUrlOnboarding() {
  const currentUser = useAppStore(state => state.currentUser);
  const companyId = useAppStore(state => state.companyId);
  const clearCompany = useAppStore(state => state.clearCompany);
  const setSelectedJobId = useAppStore(state => state.setSelectedJobId);
  const addToast = useToastStore(state => state.addToast);
  const { joinCompany, loadCompany } = useCompany();

  const companyProcessedRef = useRef(false);
  const jobProcessedRef = useRef(false);

  // Capture URL search parameters on initial load and store in sessionStorage
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

  // Phase 1: Process company onboarding once user is authenticated
  useEffect(() => {
    if (!currentUser || companyProcessedRef.current) return;

    const pendingCompany = sessionStorage.getItem('vecto_pending_company');
    const pendingJob = sessionStorage.getItem('vecto_pending_job');
    if (!pendingCompany && !pendingJob) return;

    companyProcessedRef.current = true;

    const processCompanyOnboarding = async () => {
      const targetCompanyId = pendingCompany || companyId;
      if (!targetCompanyId) return;

      try {
        const isUserInCompany = currentUser.companies?.includes(targetCompanyId);
        if (!isUserInCompany) {
          const res = await joinCompany(targetCompanyId);
          if (res?.requiresPassword) {
            addToast("Please enter the fleet access password to complete onboarding.", "info");
            if (companyId && companyId !== targetCompanyId) {
              clearCompany();
            }
            if (window.history.replaceState) {
              window.history.replaceState(null, '', window.location.pathname);
            }
            return;
          }
          addToast("Added to company drivers list!", "success");
        } else {
          await loadCompany(targetCompanyId);
        }

        sessionStorage.removeItem('vecto_pending_company');
        if (window.history.replaceState) {
          window.history.replaceState(null, '', window.location.pathname);
        }
      } catch (err) {
        console.error("Error processing company onboarding from URL:", err);
        sessionStorage.removeItem('vecto_pending_company');
        sessionStorage.removeItem('vecto_pending_job');
        addToast("Onboarding setup incomplete: " + err.message, "error");
      }
    };

    processCompanyOnboarding();
  }, [currentUser, companyId, joinCompany, loadCompany, clearCompany, addToast]);

  // Phase 2: Process job onboarding once active company matches target company
  useEffect(() => {
    if (!currentUser || !companyId || jobProcessedRef.current) return;

    const pendingCompany = sessionStorage.getItem('vecto_pending_company');
    const pendingJob = sessionStorage.getItem('vecto_pending_job');
    if (!pendingJob) return;
    if (pendingCompany && pendingCompany !== companyId) return;

    jobProcessedRef.current = true;

    const processJobOnboarding = async () => {
      try {
        const jobRef = doc(db, `companies/${companyId}/jobs/${pendingJob}`);
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

            const updates = {
              assignedDrivers: updatedDrivers,
              assignedDriverIds: updatedDrivers.map(d => d.id)
            };
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
      } catch (err) {
        console.error("Error processing job onboarding from URL:", err);
        addToast("Could not open linked job: " + err.message, "error");
      } finally {
        sessionStorage.removeItem('vecto_pending_company');
        sessionStorage.removeItem('vecto_pending_job');
        if (window.history.replaceState) {
          window.history.replaceState(null, '', window.location.pathname);
        }
      }
    };

    processJobOnboarding();
  }, [currentUser, companyId, setSelectedJobId, addToast]);
}
