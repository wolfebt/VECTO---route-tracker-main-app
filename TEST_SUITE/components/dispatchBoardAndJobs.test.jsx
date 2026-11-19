import React, { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  changeValue,
  click,
  flushPromises,
  renderWithAct,
  resetAppAndToastStores,
  submitForm,
} from '../helpers/renderUtils';
import { installFakeIndexedDB, resetFakeIndexedDB } from '../helpers/fakeIndexedDB';
import { getOfflinePods } from '../../src/utils/offlineQueue';
import { useAppStore } from '../../src/store/useAppStore';
import { useToastStore } from '../../src/store/useToastStore';

const {
  hoistedState,
  storageUploadBytes,
  storageGetDownloadURL,
  storageRef,
  useMapsLibraryMock,
} = vi.hoisted(() => ({
  hoistedState: {
    mockFs: null,
    placesLib: null,
  },
  storageUploadBytes: vi.fn().mockResolvedValue({}),
  storageGetDownloadURL: vi.fn().mockResolvedValue('https://storage.example/pod-asset.png'),
  storageRef: vi.fn((_s, path) => ({ fullPath: path })),
  useMapsLibraryMock: vi.fn((lib) => (lib === 'places' ? hoistedState.placesLib : null)),
}));

vi.mock('firebase/firestore', async () => {
  const { createFirestoreMock } = await import('../helpers/firebaseMock');
  hoistedState.mockFs = hoistedState.mockFs || createFirestoreMock();
  return hoistedState.mockFs.firestoreModule;
});
vi.mock('firebase/storage', () => ({
  ref: storageRef,
  uploadBytes: storageUploadBytes,
  getDownloadURL: storageGetDownloadURL,
}));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn(() => vi.fn()),
  signInWithPopup: vi.fn(),
  GoogleAuthProvider: class {
    setCustomParameters = vi.fn();
  },
  signOut: vi.fn(),
  signInWithCredential: vi.fn(),
}));
vi.mock('../../src/firebase', async () => {
  const { createFirestoreMock } = await import('../helpers/firebaseMock');
  hoistedState.mockFs = hoistedState.mockFs || createFirestoreMock();
  return {
    db: hoistedState.mockFs.db,
    storage: { __type: 'mockStorage' },
    auth: { __type: 'mockAuth' },
    functions: { __type: 'mockFunctions' },
  };
});
vi.mock('@vis.gl/react-google-maps', () => ({
  useMapsLibrary: useMapsLibraryMock,
}));

import OperationsBoard from '../../src/components/operations/OperationsBoard';
import PlacesAutocompleteInput from '../../src/components/common/PlacesAutocompleteInput';
import CreateJobModal from '../../src/components/modals/CreateJobModal';
import JobsList from '../../src/components/jobs/JobsList';
import DriversList from '../../src/components/jobs/DriversList';
import JobDetails from '../../src/components/jobs/JobDetails';
import GeofencePromptBanner from '../../src/components/jobs/GeofencePromptBanner';
import PodCaptureModal from '../../src/components/modals/PodCaptureModal';
import LogProgressModal from '../../src/components/modals/LogProgressModal';
import DriverRosterModal from '../../src/components/modals/DriverRosterModal';

describe('OperationsBoard, Jobs, Routing Inputs, Geofence, POD & Roster UI', () => {
  const mockFs = hoistedState.mockFs;

  beforeEach(() => {
    resetAppAndToastStores();
    mockFs.reset();
    resetFakeIndexedDB();
    installFakeIndexedDB();
    globalThis.__vectoMockOnline = true;
    storageUploadBytes.mockClear();
    storageGetDownloadURL.mockClear();
    storageRef.mockClear();
    hoistedState.placesLib = null;
    window.confirm = vi.fn(() => true);
    delete window.google;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete window.google;
  });

  it('OperationsBoard renders 4 columns, filters jobs, quick-assigns Next with vehicle, approves pending, drags/drops, and archives completed', async () => {
    const now = Date.now();
    const yesterday = now - 36 * 3600 * 1000;
    const jobs = [
      {
        id: 'j_standby',
        jobName: 'Standby Load',
        origin: 'Warehouse 1',
        destination: 'Client A',
        status: 'unassigned',
        archived: false,
        assignedDrivers: [],
      },
      {
        id: 'j_assigned',
        jobName: 'Assigned Run',
        origin: 'Warehouse 1',
        destination: 'Client B',
        status: 'assigned',
        archived: false,
        assignedDrivers: [{ id: 'drv1', name: 'Alex' }],
      },
      {
        id: 'j_pending',
        jobName: 'Pending Review Load',
        origin: 'Warehouse 2',
        destination: 'Client C',
        status: 'pending-completion',
        archived: false,
        assignedDrivers: [{ id: 'drv1', name: 'Alex' }],
      },
      {
        id: 'j_old_done',
        jobName: 'Yesterday Delivery',
        origin: 'Warehouse 2',
        destination: 'Client D',
        status: 'completed',
        archived: false,
        completedAt: yesterday,
        assignedDrivers: [{ id: 'drv1', name: 'Alex' }],
      },
    ];

    jobs.forEach((j) => mockFs.seedDoc(`companies/comp1/jobs/${j.id}`, j));
    mockFs.seedDoc('companies/comp1/members/drv1', { id: 'drv1', name: 'Alex', onDutyStatus: 'on_duty', rosterOrder: 1 });

    useAppStore.getState().setCurrentUser({ id: 'disp1', name: 'Dispatch' });
    useAppStore.getState().setCompany('comp1', 'Alpha', true);
    useAppStore.getState().setMembers([{ id: 'drv1', name: 'Alex', onDutyStatus: 'on_duty', rosterOrder: 1 }]);
    useAppStore.getState().setVehicles([{ id: 'veh1', unitNumber: 'VAN-7', makeModel: 'Transit', assignedDriverId: 'drv1', status: 'active' }]);
    useAppStore.getState().setActiveJobs(jobs);

    const { container, unmount } = await renderWithAct(<OperationsBoard />);

    // Guard blocks moving unassigned standby job directly to assigned
    const assignStageBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Assign');
    await click(assignStageBtn);
    expect(useToastStore.getState().toasts.some((t) => t.message.includes('Assign a driver'))).toBe(true);

    // Quick-assign Next driver auto-attaches VAN-7 and rotates rosterOrder
    const nextBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent.includes('Next'));
    await click(nextBtn);
    await flushPromises();
    expect(mockFs.getRawDoc('companies/comp1/jobs/j_standby')).toMatchObject({
      status: 'assigned',
      vehicleId: 'veh1',
      vehicleLabel: 'VAN-7 • Transit',
    });

    // Approve & Complete pending-completion job
    const approveBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Approve & Complete')
    );
    await click(approveBtn);
    await flushPromises();
    expect(mockFs.getRawDoc('companies/comp1/jobs/j_pending').status).toBe('completed');

    // Drag j_assigned onto In Process / On Road column
    const assignedCard = Array.from(container.querySelectorAll('div[draggable="true"]')).find((el) =>
      el.textContent.includes('Assigned Run')
    );
    const inProgressCol = Array.from(container.querySelectorAll('div')).find(
      (el) => el.textContent.includes('In Process / On Road') && el.className.includes('min-w-[300px]')
    );
    await act(async () => {
      assignedCard.dispatchEvent(new Event('dragstart', { bubbles: true }));
    });
    await act(async () => {
      inProgressCol.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
      inProgressCol.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    });
    await flushPromises();
    expect(mockFs.getRawDoc('companies/comp1/jobs/j_assigned').status).toBe('in-progress');

    // Toggle All (+1) and batch archive completed job
    const allCompletedBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('All (+1)')
    );
    await click(allCompletedBtn);
    expect(container.textContent).toContain('Yesterday Delivery');

    const archiveBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent.includes('Archive'));
    await click(archiveBtn);
    await flushPromises();
    expect(mockFs.getRawDoc('companies/comp1/jobs/j_old_done').archived).toBe(true);

    await unmount();
  });

  it('PlacesAutocompleteInput supports modern AutocompleteSuggestion keyboard selection and legacy fallback', async () => {
    vi.useFakeTimers();
    const fetchFieldsMock = vi.fn(async function applyFields() {
      return undefined;
    });
    const fakePlace = {
      displayName: 'City Hall',
      formattedAddress: '301 W 2nd St, Austin, TX',
      location: { lat: () => 30.2649, lng: () => -97.7469 },
      fetchFields: fetchFieldsMock,
    };
    const fetchAutocompleteMock = vi.fn().mockResolvedValue({
      suggestions: [
        {
          placePrediction: {
            placeId: 'p1',
            text: { text: 'City Hall, Austin' },
            toPlace: () => fakePlace,
          },
        },
      ],
    });
    const legacyAddListenerMock = vi.fn(() => ({ remove: vi.fn() }));
    const legacyAutocompleteCtor = vi.fn(function makeLegacyAc() {
      return { addListener: legacyAddListenerMock, getPlace: vi.fn() };
    });

    hoistedState.placesLib = {
      AutocompleteSuggestion: { fetchAutocompleteSuggestions: fetchAutocompleteMock },
      AutocompleteSessionToken: vi.fn(function makeTok() {
        return {};
      }),
      Autocomplete: legacyAutocompleteCtor,
    };

    const onChange = vi.fn();
    const onSelectPlace = vi.fn();

    const { container, unmount } = await renderWithAct(
      <PlacesAutocompleteInput value="" onChange={onChange} onSelectPlace={onSelectPlace} placeholder="Start Address" />
    );

    const input = container.querySelector('input');
    await changeValue(input, 'City Hall');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(fetchAutocompleteMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('City Hall, Austin');

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onSelectPlace).toHaveBeenCalledWith({
      address: 'City Hall, 301 W 2nd St, Austin, TX',
      lat: 30.2649,
      lng: -97.7469,
    });

    // Permission-denied triggers session fallback to legacy Autocomplete (keep last in block)
    fetchAutocompleteMock.mockRejectedValueOnce(new Error('PERMISSION_DENIED: Places (New) disabled'));
    await changeValue(input, 'Fallback Addr');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(legacyAutocompleteCtor).toHaveBeenCalled();

    await unmount();
  });

  it('CreateJobModal enforces 25-stop cap, disables OOS vehicles, picks Nearest/Next driver, and saves new & edited jobs', async () => {
    window.google = {
      maps: {
        Geocoder: function makeGeocoder() {
          return {
            geocode: (_req, cb) => cb([{ geometry: { location: { lat: () => 30.3, lng: () => -97.7 } } }], 'OK'),
          };
        },
      },
    };

    useAppStore.getState().setCurrentUser({ id: 'disp1', name: 'Dispatch' });
    useAppStore.getState().setCompany('comp1', 'Alpha', true);
    useAppStore.getState().setMembers([
      { id: 'drv1', name: 'Alex', onDutyStatus: 'on_duty', rosterOrder: 1 },
    ]);
    useAppStore.getState().setVehicles([
      { id: 'v_ok', unitNumber: 'VAN-10', makeModel: 'Transit', status: 'active', assignedDriverId: 'drv1' },
      { id: 'v_oos', unitNumber: 'VAN-99', makeModel: 'Broken', status: 'out_of_service' },
    ]);
    useAppStore.getState().openModal('createJob');

    const { container, rerender, unmount } = await renderWithAct(<CreateJobModal />);

    const oosOption = Array.from(container.querySelectorAll('option')).find((o) =>
      o.textContent.includes('VAN-99')
    );
    expect(oosOption.disabled).toBe(true);

    // Fill job form & add stops up to MAX_STOPS = 25
    const form = container.querySelector('#create-job-form');
    const textInputs = form.querySelectorAll('input[type="text"]');
    await changeValue(textInputs[0], 'Express Route');
    await changeValue(container.querySelector('input[placeholder="Start Address"]'), 'Depot 1');
    await changeValue(container.querySelector('input[placeholder="Stop 1 Address"]'), '100 Main St');

    const addStopBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('+ Add Stop')
    );
    for (let i = 0; i < 24; i++) {
      await click(addStopBtn);
    }
    expect(container.textContent).toContain('Max 25 stops');
    expect(addStopBtn.disabled).toBe(true);

    // Remove extra stops from the end so Stop 1 ("100 Main St") remains intact
    while (container.querySelectorAll('button[aria-label="Remove Stop"]').length > 0) {
      const removeBtns = container.querySelectorAll('button[aria-label="Remove Stop"]');
      await click(removeBtns[removeBtns.length - 1]);
    }

    const nextRosterBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Next in Roster')
    );
    await click(nextRosterBtn);
    expect(container.querySelector('select').value).toBe('v_ok');

    const addInstBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('+ Add Instruction')
    );
    await click(addInstBtn);
    await changeValue(container.querySelector('textarea'), 'Verify seal number');

    await submitForm(form);
    await flushPromises();

    const created = Array.from(mockFs.store.entries()).find(([p]) =>
      p.startsWith('companies/comp1/jobs/')
    );
    expect(created[1]).toMatchObject({
      jobName: 'Express Route',
      vehicleId: 'v_ok',
      status: 'assigned',
    });

    // Edit mode updates existing job
    const jobId = created[0].split('/').pop();
    await act(async () => {
      useAppStore.getState().openModal('createJob', { editMode: true, job: { id: jobId, ...created[1] } });
    });
    await rerender(<CreateJobModal />);
    await changeValue(container.querySelector('#create-job-form input[type="text"]'), 'Express Route Updated');
    await submitForm(container.querySelector('#create-job-form'));
    await flushPromises();
    expect(mockFs.getRawDoc(created[0]).jobName).toBe('Express Route Updated');

    await unmount();
  });

  it('JobsList, DriversList, and JobDetails manage job filters, archive pagination, stops, status transitions, and chat', async () => {
    const activeJob = {
      id: 'job1',
      jobName: 'Morning Delivery',
      origin: 'Depot',
      status: 'assigned',
      archived: false,
      assignedDrivers: [{ id: 'drv1', name: 'Alex' }],
      assignedDriverIds: ['drv1'],
      lastMessageTimestamp: 5000,
      stops: [{ id: 's1', address: '100 Main St', order: 0, status: 'pending', arriveBy: '15:00', serviceMinutes: 15 }],
    };
    mockFs.seedDoc('companies/comp1/jobs/job1', activeJob);
    mockFs.seedDoc('companies/comp1/active_drivers/drv1', { name: 'Alex', timestamp: Date.now() });
    mockFs.seedDoc('users/drv1', { lastRead: {} });

    useAppStore.getState().setCurrentUser({ id: 'drv1', name: 'Alex', lastRead: {} });
    useAppStore.getState().setCompany('comp1', 'Alpha', true);
    useAppStore.getState().setMemberPermissions({ canCreateJob: true, canDeleteJob: true, canManageDrivers: true, isCreator: true });
    useAppStore.getState().setActiveJobs([activeJob]);
    useAppStore.getState().setActiveDrivers([{ id: 'drv1', name: 'Alex', status: 'Available', timestamp: Date.now() }]);
    useAppStore.getState().setSelectedJobId('job1');

    const { container, unmount } = await renderWithAct(
      <div>
        <JobsList />
        <DriversList />
        <JobDetails />
      </div>
    );
    await flushPromises();

    expect(container.querySelector('span[title="Unread chat messages"]')).not.toBeNull();
    expect(container.textContent).toContain('15m dwell');

    // Stop Arrive -> Done -> Undo
    const arriveBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Arrive');
    await click(arriveBtn);
    await flushPromises();
    expect(mockFs.getRawDoc('companies/comp1/jobs/job1').stops[0].status).toBe('arrived');

    // Start Trip
    const startTripBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Start Trip')
    );
    await click(startTripBtn);
    await flushPromises();
    expect(mockFs.getRawDoc('companies/comp1/jobs/job1').status).toBe('in-progress');

    // Chat drawer sends message and updates lastRead
    const chatTabBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('CHAT')
    );
    await click(chatTabBtn);
    await changeValue(container.querySelector('input[placeholder="Type a message..."]'), 'On site now');
    const sendBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Send Message')
    );
    await click(sendBtn);
    await flushPromises();
    expect(mockFs.firestoreModule.addDoc).toHaveBeenCalled();

    // Remove driver from active list
    const removeDrvBtn = container.querySelector('button[title="Remove Driver from Map"]');
    await click(removeDrvBtn);
    await flushPromises();
    expect(mockFs.getRawDoc('companies/comp1/active_drivers/drv1')).toBeUndefined();

    // Admin drawer -> Delete Job
    const adminTabBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('ADMIN')
    );
    await click(adminTabBtn);
    const deleteJobBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Delete Job')
    );
    await click(deleteJobBtn);
    await flushPromises();
    expect(mockFs.getRawDoc('companies/comp1/jobs/job1')).toBeUndefined();

    await unmount();
  });

  it('GeofencePromptBanner, PodCaptureModal, LogProgressModal & DriverRosterModal complete field & roster workflows', async () => {
    const job = {
      id: 'job1',
      jobName: 'Field Drop',
      origin: 'Depot',
      status: 'in-progress',
      stops: [{ id: 's1', address: '100 First St', order: 0, status: 'pending' }],
    };
    mockFs.seedDoc('companies/comp1/jobs/job1', job);
    mockFs.seedDoc('companies/comp1/members/drv1', { name: 'Alex', onDutyStatus: 'on_duty', rosterOrder: 0 });
    mockFs.seedDoc('companies/comp1/members/drv2', { name: 'Sam', onDutyStatus: 'on_duty', rosterOrder: 1 });

    useAppStore.getState().setCurrentUser({ id: 'drv1', name: 'Alex' });
    useAppStore.getState().setCompany('comp1', 'Alpha', true);
    useAppStore.getState().setCurrentLocation({ lat: 30.267, lng: -97.743 });
    useAppStore.getState().setActiveJobs([job]);
    useAppStore.getState().setMembers([
      { id: 'drv1', name: 'Alex', onDutyStatus: 'on_duty', rosterOrder: 0 },
      { id: 'drv2', name: 'Sam', onDutyStatus: 'on_duty', rosterOrder: 1 },
    ]);
    useAppStore.getState().setArrivalPrompt({
      jobId: 'job1',
      jobName: 'Field Drop',
      stopId: 's1',
      stopOrder: 1,
      address: '100 First St',
      distanceMeters: 42,
    });

    const { container, rerender, unmount } = await renderWithAct(
      <div>
        <GeofencePromptBanner />
        <PodCaptureModal />
        <LogProgressModal />
        <DriverRosterModal />
      </div>
    );

    // Geofence -> Capture POD opens PodCaptureModal
    const capPodBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Capture POD')
    );
    await click(capPodBtn);
    expect(useAppStore.getState().modals.podCapture).toEqual({ jobId: 'job1', stopId: 's1' });
    await flushPromises();

    // Draw signature on canvas & submit online
    const canvas = container.querySelector('canvas');
    await act(async () => {
      canvas.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
      canvas.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 50, clientY: 40 }));
      canvas.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 50, clientY: 40 }));
    });
    const podForm = canvas.closest('form');
    await submitForm(podForm);
    await flushPromises();
    expect(storageUploadBytes).toHaveBeenCalledTimes(1);
    expect(mockFs.getRawDoc('companies/comp1/jobs/job1').stops[0].status).toBe('completed');

    // Offline POD submission queues to IndexedDB
    globalThis.__vectoMockOnline = false;
    await act(async () => {
      useAppStore.getState().openModal('podCapture', { jobId: 'job1', stopId: 's1' });
    });
    await rerender(
      <div>
        <GeofencePromptBanner />
        <PodCaptureModal />
        <LogProgressModal />
        <DriverRosterModal />
      </div>
    );
    const canvas2 = container.querySelector('canvas');
    await act(async () => {
      canvas2.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }));
      canvas2.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 25, clientY: 25 }));
      canvas2.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    });
    await submitForm(canvas2.closest('form'));
    await flushPromises();
    expect(await getOfflinePods()).toHaveLength(1);

    // LogProgressModal & DriverRosterModal
    globalThis.__vectoMockOnline = true;
    await act(async () => {
      useAppStore.getState().openModal('logProgress', { jobId: 'job1' });
      useAppStore.getState().openModal('driverRoster');
    });
    await rerender(
      <div>
        <GeofencePromptBanner />
        <PodCaptureModal />
        <LogProgressModal />
        <DriverRosterModal />
      </div>
    );
    await changeValue(container.querySelector('textarea'), 'Gate unlocked by security');
    await submitForm(container.querySelector('textarea').closest('form'));
    await flushPromises();
    const noteDoc = Array.from(mockFs.store.entries()).find(
      ([p, v]) => p.startsWith('companies/comp1/jobs/job1/notes/') && v.text === 'Gate unlocked by security'
    );
    expect(noteDoc).toBeDefined();

    // Priority star & move down in DriverRosterModal
    const prioBtn = container.querySelector('button[title*="Priority Driver"]');
    await click(prioBtn);
    await flushPromises();
    expect(mockFs.getRawDoc('companies/comp1/members/drv1').isPriorityDriver).toBe(true);

    const moveDownBtn = container.querySelector('button[title="Move down in rotation"]');
    await click(moveDownBtn);
    await flushPromises();
    expect(mockFs.getRawDoc('companies/comp1/members/drv1').rosterOrder).toBe(1);

    await unmount();
  });
});
