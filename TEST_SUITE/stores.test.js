import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAppStore } from '../src/store/useAppStore';
import { useToastStore } from '../src/store/useToastStore';
import { resetAppAndToastStores } from './helpers/renderUtils';

describe('Zustand stores (useAppStore & useToastStore)', () => {
  beforeEach(() => {
    resetAppAndToastStores();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('manages auth, splash, permissions, and company switching vs clearing', () => {
    useAppStore.getState().setCurrentUser({ id: 'u1', name: 'Alex' });
    expect(useAppStore.getState().isAuthReady).toBe(true);
    expect(useAppStore.getState().currentUser.id).toBe('u1');

    useAppStore.getState().setShowSplash(false);
    useAppStore.getState().setFadeSplash(true);
    useAppStore.getState().triggerSplash();
    expect(useAppStore.getState().showSplash).toBe(true);
    expect(useAppStore.getState().fadeSplash).toBe(false);

    useAppStore.getState().setMemberPermissions({ canCreateJob: true, isCreator: true });
    expect(useAppStore.getState().memberPermissions).toEqual({
      canCreateJob: true,
      canDeleteJob: false,
      canManageDrivers: false,
      isCreator: true,
    });

    useAppStore.getState().setCompany('comp1', 'Alpha Fleet', true);
    useAppStore.getState().setActiveJobs([{ id: 'j1', archived: false }]);
    useAppStore.getState().setArchivedJobsState({
      archivedJobs: [{ id: 'j2', archived: true }],
      hasMoreArchivedJobs: true,
      archivedJobsLoadedOnce: true,
    });

    // Setting same company preserves jobs
    useAppStore.getState().setCompany('comp1', 'Alpha Fleet Updated', true);
    expect(useAppStore.getState().jobs).toHaveLength(2);

    // Switching to another company resets jobs and pagination state
    useAppStore.getState().setCompany('comp2', 'Beta Fleet', false);
    expect(localStorage.getItem('vecto_last_company_id')).toBe('comp2');
    expect(useAppStore.getState().jobs).toEqual([]);
    expect(useAppStore.getState().archivedJobsLoadedOnce).toBe(false);

    useAppStore.getState().clearCompany();
    expect(useAppStore.getState().companyId).toBeNull();
    expect(sessionStorage.getItem('vecto_has_cleared_company')).toBe('true');
    expect(localStorage.getItem('vecto_last_company_id')).toBeNull();
  });

  it('merges active over archived jobs, clears routeInfo on job change, and opens/closes modals', () => {
    useAppStore.getState().setArchivedJobsState({
      archivedJobs: [
        { id: 'j1', jobName: 'Old Archive', archived: true },
        { id: 'j2', jobName: 'Still Archived', archived: true },
      ],
    });
    useAppStore.getState().setActiveJobs([{ id: 'j1', jobName: 'Restored Active', archived: false }]);

    expect(useAppStore.getState().archivedJobs.map((j) => j.id)).toEqual(['j2']);
    expect(useAppStore.getState().jobs.find((j) => j.id === 'j1')?.jobName).toBe('Restored Active');

    useAppStore.getState().setRouteInfo({ jobId: 'j1', distance: '10 mi' });
    useAppStore.getState().setSelectedJobId('j2');
    expect(useAppStore.getState().routeInfo).toBeNull();

    useAppStore.getState().openModal('dvir', { vehicleId: 'veh1' });
    expect(useAppStore.getState().modals.dvir).toEqual({ vehicleId: 'veh1' });
    useAppStore.getState().closeModal('dvir');
    expect(useAppStore.getState().modals.dvir).toBe(false);
  });

  it('adds, manually removes, and auto-dismisses toasts after 4000ms', () => {
    vi.useFakeTimers();
    useToastStore.getState().addToast('Saved', 'success');
    useToastStore.getState().addToast('Warning', 'warning');

    expect(useToastStore.getState().toasts).toHaveLength(2);
    const firstId = useToastStore.getState().toasts[0].id;
    useToastStore.getState().removeToast(firstId);
    expect(useToastStore.getState().toasts).toHaveLength(1);

    vi.advanceTimersByTime(4000);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
