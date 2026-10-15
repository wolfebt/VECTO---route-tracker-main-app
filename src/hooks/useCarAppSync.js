import { useEffect, useRef } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { useAppStore } from '../store/useAppStore';
import { useToastStore } from '../store/useToastStore';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

const VectoCarBridge = registerPlugin('VectoCarBridge');

/**
 * Bi-directional synchronization hook between the Vecto web interface
 * and the native Android Auto CarAppService dashboard.
 */
export function useCarAppSync(jobs = []) {
  const companyId = useAppStore((state) => state.companyId);
  const companyName = useAppStore((state) => state.companyName);
  const currentUser = useAppStore((state) => state.currentUser);
  const selectedJobId = useAppStore((state) => state.selectedJobId);
  const syncTimeoutRef = useRef(null);

  // 1. Sync current jobs, company and driver to Android Auto SharedPreferences
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }

    syncTimeoutRef.current = setTimeout(async () => {
      try {
        const sanitizedJobs = (jobs || []).map((job) => ({
          id: job.id || '',
          title: job.title || job.name || job.destination || 'Delivery',
          destination: job.destination || job.address || '',
          customer: job.customer || job.client || '',
          status: job.status || 'Pending',
          notes: job.notes || job.instructions || '',
          phone: job.phone || job.customerPhone || ''
        }));

        await VectoCarBridge.syncJobs({
          jobs: JSON.stringify(sanitizedJobs),
          activeJobId: selectedJobId || '',
          driverName: currentUser?.name || currentUser?.email || 'Driver',
          companyName: companyName || 'Vecto'
        });
      } catch (err) {
        console.warn('VectoCarBridge syncJobs error:', err);
      }
    }, 500);

    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, [jobs, companyId, companyName, currentUser, selectedJobId]);

  // 2. Poll for actions initiated from the vehicle screen (e.g. "Mark Arrived", "Complete Stop")
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !companyId) return;

    const checkCarActions = async () => {
      try {
        const res = await VectoCarBridge.getPendingCarAction();
        if (res && res.action) {
          const action = typeof res.action === 'string' ? JSON.parse(res.action) : res.action;
          if (action.type === 'update_job_status' && action.jobId && action.status) {
            const jobRef = doc(db, `companies/${companyId}/jobs`, action.jobId);
            await updateDoc(jobRef, { status: action.status });
            useToastStore.getState().addToast(`Android Auto updated job to ${action.status}`, 'success');
          }
        }
      } catch (e) {
        // Silent catch for polling
      }
    };

    const intervalId = setInterval(checkCarActions, 2500);
    return () => clearInterval(intervalId);
  }, [companyId]);
}
