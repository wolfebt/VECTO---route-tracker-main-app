import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { flushPromises, renderHookWithAct, resetAppAndToastStores } from '../helpers/renderUtils';
import { useAppStore } from '../../src/store/useAppStore';
import { useToastStore } from '../../src/store/useToastStore';

const {
  hoistedState,
  onAuthStateChangedMock,
  signInWithPopupMock,
  signOutMock,
  signInWithCredentialMock,
  nativeSignInMock,
  nativeSignOutMock,
  flushOfflinePodQueueMock,
  GoogleAuthProviderMock,
} = vi.hoisted(() => {
  class MockGoogleAuthProvider {
    setCustomParameters = vi.fn();
    static credential = vi.fn((token) => ({ token }));
  }
  return {
    hoistedState: {
      mockFs: null,
      authCallback: null,
      isNative: false,
    },
    onAuthStateChangedMock: vi.fn((_auth, cb) => {
      hoistedState.authCallback = cb;
      return vi.fn();
    }),
    signInWithPopupMock: vi.fn().mockResolvedValue({ user: { uid: 'u1' } }),
    signOutMock: vi.fn().mockResolvedValue(undefined),
    signInWithCredentialMock: vi.fn().mockResolvedValue({ user: { uid: 'u1' } }),
    nativeSignInMock: vi.fn().mockResolvedValue({ credential: { idToken: 'tok_native' } }),
    nativeSignOutMock: vi.fn().mockResolvedValue(undefined),
    flushOfflinePodQueueMock: vi.fn().mockResolvedValue(0),
    GoogleAuthProviderMock: MockGoogleAuthProvider,
  };
});

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: onAuthStateChangedMock,
  signInWithPopup: signInWithPopupMock,
  GoogleAuthProvider: GoogleAuthProviderMock,
  signOut: signOutMock,
  signInWithCredential: signInWithCredentialMock,
}));
vi.mock('firebase/firestore', async () => {
  const { createFirestoreMock } = await import('../helpers/firebaseMock');
  hoistedState.mockFs = hoistedState.mockFs || createFirestoreMock();
  return hoistedState.mockFs.firestoreModule;
});
vi.mock('../../src/firebase', async () => {
  const { createFirestoreMock } = await import('../helpers/firebaseMock');
  hoistedState.mockFs = hoistedState.mockFs || createFirestoreMock();
  return {
    auth: { __type: 'mockAuth' },
    db: hoistedState.mockFs.db,
    storage: { __type: 'mockStorage' },
  };
});
vi.mock('../../src/utils/offlineQueue', () => ({
  flushOfflinePodQueue: flushOfflinePodQueueMock,
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => hoistedState.isNative,
  },
}));
vi.mock('@capacitor-firebase/authentication', () => ({
  FirebaseAuthentication: {
    signInWithGoogle: nativeSignInMock,
    signOut: nativeSignOutMock,
  },
}));

import {
  ARCHIVE_PAGE_SIZE,
  useArchivedJobs,
  useAuth,
  useCompany,
  useWorkspaceSync,
} from '../../src/hooks/useFirebase';
import { useUrlOnboarding } from '../../src/hooks/useUrlOnboarding';

describe('useFirebase hooks & useUrlOnboarding', () => {
  const mockFs = hoistedState.mockFs;

  beforeEach(() => {
    resetAppAndToastStores();
    mockFs.reset();
    hoistedState.authCallback = null;
    hoistedState.isNative = false;
    signInWithPopupMock.mockClear();
    signOutMock.mockClear();
    signInWithCredentialMock.mockClear();
    nativeSignInMock.mockClear();
    nativeSignOutMock.mockClear();
    flushOfflinePodQueueMock.mockClear();
    window.history.replaceState(null, '', '/');
  });

  it('useAuth bootstraps new user from localStorage, syncs keys, handles web/native login & logout', async () => {
    localStorage.setItem('vecto_driver_profile', JSON.stringify({ name: 'Alex', phone: '555-1234', color: '#3b82f6' }));
    const { result, unmount } = await renderHookWithAct(() => useAuth());

    await act(async () => {
      await hoistedState.authCallback({ uid: 'u1', email: 'alex@vecto.app', displayName: 'Alex' });
    });
    await flushPromises();

    const userState = useAppStore.getState().currentUser;
    expect(userState.name).toBe('Alex');
    expect(userState.phone).toBe('555-1234');
    expect(mockFs.getRawDoc('users/u1').color).toBe('#3b82f6');

    // Existing user with stored maps/firebase/gemini localStorage keys syncs to preferences
    localStorage.setItem('mapsApiKey', 'maps-k');
    localStorage.setItem('firebaseApiKey', 'fb-k');
    localStorage.setItem('geminiApiKey', 'gem-k');
    await act(async () => {
      await hoistedState.authCallback({ uid: 'u1', email: 'alex@vecto.app' });
    });
    await flushPromises();
    expect(useAppStore.getState().mapsApiKey).toBe('maps-k');
    expect(useAppStore.getState().firebaseApiKey).toBe('fb-k');
    expect(useAppStore.getState().geminiApiKey).toBe('gem-k');

    // Web login & native login
    await result.current.login();
    expect(signInWithPopupMock).toHaveBeenCalledTimes(1);

    hoistedState.isNative = true;
    await result.current.login();
    expect(nativeSignInMock).toHaveBeenCalledTimes(1);
    expect(signInWithCredentialMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.logout();
    });
    expect(nativeSignOutMock).toHaveBeenCalledTimes(1);
    expect(signOutMock).toHaveBeenCalledTimes(1);

    await unmount();
  });

  it('useWorkspaceSync syncs permissions, active jobs, legacy backfill, vehicles, inspections, and ejection', async () => {
    mockFs.seedDoc('companies/comp1', { name: 'Alpha Fleet', createdBy: 'disp1', showNameplates: false });
    mockFs.seedDoc('companies/comp1/members/disp1', {
      name: 'Dispatch Lead',
      permissions: { canCreateJob: true, canDeleteJob: true, canManageDrivers: true },
    });
    mockFs.seedDoc('companies/comp1/members/drv1', {
      name: 'Driver One',
      permissions: { canCreateJob: false, canDeleteJob: false, canManageDrivers: false },
    });
    mockFs.seedDoc('companies/comp1/jobs/job1', { jobName: 'Active Job', archived: false, status: 'in-progress' });
    mockFs.seedDoc('companies/comp1/jobs/job_legacy', { jobName: 'Legacy Active', status: 'assigned' });
    mockFs.seedDoc('companies/comp1/jobs/job_arch', { jobName: 'Archived', archived: true, status: 'completed' });
    mockFs.seedDoc('companies/comp1/vehicles/v2', { unitNumber: 'VAN-200', status: 'active' });
    mockFs.seedDoc('companies/comp1/vehicles/v1', { unitNumber: 'VAN-100', status: 'active' });
    mockFs.seedDoc('companies/comp1/inspections/i1', { vehicleId: 'v1', createdAt: { toMillis: () => 100 } });
    mockFs.seedDoc('companies/comp1/inspections/i2', { vehicleId: 'v2', createdAt: { toMillis: () => 500 } });
    mockFs.seedDoc('companies/comp1/active_drivers/disp1', { activeJobId: 'job1' });
    mockFs.seedDoc('companies/comp1/active_drivers/drv1', { activeJobId: 'job1' });

    useAppStore.getState().setCurrentUser({ id: 'disp1', name: 'Dispatch Lead', companies: ['comp1'] });
    useAppStore.getState().setCompany('comp1', 'Alpha Fleet', true);

    const { unmount } = await renderHookWithAct(() => useWorkspaceSync());
    await flushPromises();

    const state = useAppStore.getState();
    expect(state.isDispatchView).toBe(true);
    expect(state.showNameplates).toBe(false);
    expect(state.activeJobs.map((j) => j.id).sort()).toEqual(['job1', 'job_legacy']);
    expect(mockFs.getRawDoc('companies/comp1/jobs/job_legacy').archived).toBe(false);
    expect(state.vehicles.map((v) => v.unitNumber)).toEqual(['VAN-100', 'VAN-200']);
    expect(state.inspections.map((i) => i.id)).toEqual(['i2', 'i1']);
    expect(state.activeDrivers).toHaveLength(2);
    expect(flushOfflinePodQueueMock).toHaveBeenCalled();

    // Non-creator member removal ejects the user cleanly
    await act(async () => {
      useAppStore.getState().setCurrentUser({ id: 'drv1', name: 'Driver One', companies: ['comp1'] });
      useAppStore.getState().setCompany('comp1', 'Alpha Fleet', false);
    });
    await flushPromises();
    await act(async () => {
      mockFs.seedDoc('companies/comp1', {
        name: 'Alpha Fleet',
        createdBy: 'disp1',
        removedMemberIds: ['drv1'],
      });
    });
    await flushPromises();
    expect(useAppStore.getState().companyId).toBeNull();
    expect(useToastStore.getState().toasts.some((t) => t.message.includes('no longer have access'))).toBe(true);

    await unmount();
  });

  it('useCompany loads and joins open/password-protected fleets and cleans up removed/missing companies', async () => {
    mockFs.seedDoc('users/drv2', { companies: [] });
    mockFs.seedDoc('companies/comp_open', { name: 'Open Fleet', requirePassword: false, createdBy: 'creator1' });
    mockFs.seedDoc('companies/comp_pw', { name: 'Secured Fleet', requirePassword: true, createdBy: 'creator1' });
    mockFs.seedDoc('companies/comp_removed', {
      name: 'Blocked Fleet',
      createdBy: 'creator1',
      removedMemberIds: ['drv2'],
    });

    useAppStore.getState().setCurrentUser({ id: 'drv2', email: 'd2@vecto.app', name: 'Driver Two', companies: [] });
    const { result, unmount } = await renderHookWithAct(() => useCompany());

    await expect(result.current.joinCompany('comp_removed')).rejects.toThrow('no longer have access');

    let pwMissing;
    let pwOk;
    let openOk;
    let missing;
    await act(async () => {
      pwMissing = await result.current.joinCompany('comp_pw', '');
      pwOk = await result.current.joinCompany('comp_pw', 'fleetpass');
      openOk = await result.current.joinCompany('comp_open');
      missing = await result.current.loadCompany('nonexistent_comp');
    });
    expect(pwMissing).toEqual({ success: false, requiresPassword: true });
    expect(pwOk).toEqual({ success: true });
    expect(mockFs.getRawDoc('companies/comp_pw/members/drv2').permissions.canCreateJob).toBe(false);
    expect(mockFs.getRawDoc('companies/comp_pw/join_requests/drv2')).toBeUndefined();
    expect(openOk).toEqual({ success: true });
    expect(useAppStore.getState().companyId).toBe('comp_open');
    expect(missing).toEqual({ notFound: true });

    await unmount();
  });

  it('useArchivedJobs paginates archived jobs and falls back on missing composite index', async () => {
    for (let i = 1; i <= ARCHIVE_PAGE_SIZE + 3; i++) {
      mockFs.seedDoc(`companies/comp_arch/jobs/arch_${String(i).padStart(2, '0')}`, {
        jobName: `Archive ${i}`,
        archived: true,
        createdAt: { toMillis: () => i * 1000 },
      });
    }

    useAppStore.getState().setCompany('comp_arch', 'Archive Fleet', true);
    const { result, unmount } = await renderHookWithAct(() => useArchivedJobs());

    await act(async () => {
      await result.current.loadArchivedPage({ reset: true });
    });
    await flushPromises();
    expect(result.current.archivedJobs).toHaveLength(ARCHIVE_PAGE_SIZE);
    expect(result.current.hasMoreArchivedJobs).toBe(true);

    await act(async () => {
      await result.current.loadArchivedPage({ reset: false });
    });
    await flushPromises();
    expect(result.current.archivedJobs).toHaveLength(ARCHIVE_PAGE_SIZE + 3);
    expect(result.current.hasMoreArchivedJobs).toBe(false);

    // Simulate missing Firestore index on first call -> fallback query loads items
    mockFs.firestoreModule.getDocs.mockRejectedValueOnce({ code: 'failed-precondition' });
    await act(async () => {
      await result.current.loadArchivedPage({ reset: true });
    });
    await flushPromises();
    expect(result.current.archivedJobs).toHaveLength(ARCHIVE_PAGE_SIZE + 3);

    await unmount();
  });

  it('useUrlOnboarding parses ?company=&job= search params, joins fleet, and self-assigns driver', async () => {
    mockFs.seedDoc('users/drv3', { companies: [] });
    mockFs.seedDoc('companies/comp_url', { name: 'URL Fleet', requirePassword: false, createdBy: 'disp1' });
    mockFs.seedDoc('companies/comp_url/jobs/job_url', {
      jobName: 'QR Express',
      origin: 'Depot',
      status: 'unassigned',
      assignedDrivers: [],
    });

    window.history.replaceState(null, '', '/?company=comp_url&job=job_url');
    useAppStore.getState().setCurrentUser({ id: 'drv3', name: 'Alex QR', email: 'qr@vecto.app', companies: [] });

    const { unmount } = await renderHookWithAct(() => useUrlOnboarding());
    await flushPromises();
    await flushPromises();

    expect(useAppStore.getState().companyId).toBe('comp_url');
    expect(useAppStore.getState().selectedJobId).toBe('job_url');
    const updatedJob = mockFs.getRawDoc('companies/comp_url/jobs/job_url');
    expect(updatedJob.status).toBe('in-progress');
    expect(updatedJob.assignedDriverIds).toContain('drv3');

    await unmount();
  });
});
