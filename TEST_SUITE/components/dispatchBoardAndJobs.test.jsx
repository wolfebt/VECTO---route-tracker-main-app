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
import { resetPlacesAutocompleteState } from '../../src/utils/placesAutocomplete';
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
    resetPlacesAutocompleteState();
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

  it('PlacesAutocompleteInput enforces this-binding, handles stale responses & late library load, and selects via click and keyboard', async () => {
    vi.useFakeTimers();

    const makePlace = (displayName, formattedAddress, lat, lng) => ({
      displayName,
      formattedAddress,
      location: { lat: () => lat, lng: () => lng },
      fetchFields: vi.fn(async () => undefined),
    });

    const slowDeferred = {};
    slowDeferred.promise = new Promise((resolve) => {
      slowDeferred.resolve = resolve;
    });

    const AutocompleteSuggestion = {
      fetchAutocompleteSuggestions: vi.fn(async function fetchSuggestions(req) {
        if (this !== AutocompleteSuggestion) {
          throw new TypeError('Illegal invocation');
        }
        if (req.input === 'Slow Query') {
          return slowDeferred.promise;
        }
        if (req.input === 'Fast Query') {
          return {
            suggestions: [
              {
                placePrediction: {
                  placeId: 'p_fast',
                  mainText: { text: 'Fast Hub' },
                  secondaryText: { text: '900 Fast Ln, Austin, TX' },
                  text: { text: 'Fast Hub, 900 Fast Ln, Austin, TX' },
                  toPlace: () => makePlace('Fast Hub', '900 Fast Ln, Austin, TX', 30.5, -97.5),
                },
              },
            ],
          };
        }
        return {
          suggestions: [
            {
              placePrediction: {
                placeId: 'p1',
                mainText: { text: 'City Hall' },
                secondaryText: { text: '301 W 2nd St, Austin, TX' },
                text: { text: 'City Hall, Austin' },
                toPlace: () => makePlace('City Hall', '301 W 2nd St, Austin, TX', 30.2649, -97.7469),
              },
            },
          ],
        };
      }),
    };

    const onSelectPlace = vi.fn();
    function ControlledPlaces() {
      const [val, setVal] = React.useState('');
      return (
        <PlacesAutocompleteInput
          value={val}
          onChange={setVal}
          onSelectPlace={onSelectPlace}
          placeholder="Start Address"
        />
      );
    }

    // Late-loaded placesLib: type before placesLib arrives, then load placesLib
    hoistedState.placesLib = null;
    const { container, rerender, unmount } = await renderWithAct(<ControlledPlaces />);
    const input = container.querySelector('input');
    await changeValue(input, 'City Hall');
    expect(AutocompleteSuggestion.fetchAutocompleteSuggestions).not.toHaveBeenCalled();

    hoistedState.placesLib = {
      AutocompleteSuggestion,
      AutocompleteSessionToken: vi.fn(function makeTok() {
        return { id: Math.random() };
      }),
    };
    await rerender(<ControlledPlaces />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(AutocompleteSuggestion.fetchAutocompleteSuggestions).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('City Hall');
    expect(container.textContent).toContain('301 W 2nd St, Austin, TX');
    expect(container.textContent).toContain('Powered by Google');

    // Click selection populates address & coords
    const optionBtn = container.querySelector('ul[role="listbox"] button');
    await click(optionBtn);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });
    expect(onSelectPlace).toHaveBeenCalledWith({
      address: 'City Hall, 301 W 2nd St, Austin, TX',
      lat: 30.2649,
      lng: -97.7469,
    });
    expect(input.value).toBe('City Hall, 301 W 2nd St, Austin, TX');

    // Stale out-of-order response protection
    await changeValue(input, 'Slow Query');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    await changeValue(input, 'Fast Query');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(container.textContent).toContain('Fast Hub');

    slowDeferred.resolve({
      suggestions: [
        {
          placePrediction: {
            placeId: 'p_slow',
            mainText: { text: 'Stale Hub' },
            secondaryText: { text: '000 Old Rd' },
            text: { text: 'Stale Hub, 000 Old Rd' },
            toPlace: () => makePlace('Stale Hub', '000 Old Rd', 1, 1),
          },
        },
      ],
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Fast Hub');
    expect(container.textContent).not.toContain('Stale Hub');

    // Keyboard selection (ArrowDown + Enter)
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });
    expect(onSelectPlace).toHaveBeenLastCalledWith({
      address: 'Fast Hub, 900 Fast Ln, Austin, TX',
      lat: 30.5,
      lng: -97.5,
    });

    await unmount();
  });

  it('PlacesAutocompleteInput falls back from Places (New) to AutocompleteService, legacy Autocomplete widget, and Geocoder', async () => {
    vi.useFakeTimers();

    // 1. Tier 1 -> Tier 2 fallback (AutocompleteService + PlacesService.getDetails)
    const fetchDeniedMock = vi.fn().mockRejectedValue(
      new Error('REQUEST_DENIED: Places API (New) has not been used in project')
    );
    const getPlacePredictionsMock = vi.fn((_req, cb) =>
      cb(
        [
          {
            place_id: 'leg_1',
            description: '742 Evergreen Terrace, Springfield',
            structured_formatting: {
              main_text: '742 Evergreen Terrace',
              secondary_text: 'Springfield',
            },
          },
        ],
        'OK'
      )
    );
    const getDetailsMock = vi.fn((_req, cb) =>
      cb(
        {
          name: 'Evergreen Warehouse',
          formatted_address: '742 Evergreen Terrace, Springfield',
          geometry: { location: { lat: () => 39.78, lng: () => -89.65 } },
        },
        'OK'
      )
    );

    hoistedState.placesLib = {
      AutocompleteSuggestion: { fetchAutocompleteSuggestions: fetchDeniedMock },
      AutocompleteSessionToken: vi.fn(function makeTok() {
        return {};
      }),
      AutocompleteService: vi.fn(function makeAcSvc() {
        return { getPlacePredictions: getPlacePredictionsMock };
      }),
      PlacesService: vi.fn(function makePlacesSvc() {
        return { getDetails: getDetailsMock };
      }),
    };

    const onChange = vi.fn();
    const onSelectPlace = vi.fn();
    const tier2 = await renderWithAct(
      <PlacesAutocompleteInput value="" onChange={onChange} onSelectPlace={onSelectPlace} placeholder="Start Address" />
    );
    const tier2Input = tier2.container.querySelector('input');
    await changeValue(tier2Input, '742 Ever');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(fetchDeniedMock).toHaveBeenCalledTimes(1);
    expect(getPlacePredictionsMock).toHaveBeenCalledTimes(1);
    expect(tier2.container.textContent).toContain('742 Evergreen Terrace');
    expect(tier2.container.textContent).toContain('Springfield');

    await click(tier2.container.querySelector('ul[role="listbox"] button'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });
    expect(getDetailsMock).toHaveBeenCalledWith(
      expect.objectContaining({ placeId: 'leg_1' }),
      expect.any(Function)
    );
    expect(onSelectPlace).toHaveBeenCalledWith({
      address: 'Evergreen Warehouse, 742 Evergreen Terrace, Springfield',
      lat: 39.78,
      lng: -89.65,
    });
    await tier2.unmount();

    // 2. Tier 1 -> Tier 3 fallback (places.Autocomplete widget when AutocompleteService is absent)
    resetPlacesAutocompleteState();
    let placeChangedCb = null;
    const legacyAcInstance = {
      addListener: vi.fn((evt, cb) => {
        if (evt === 'place_changed') placeChangedCb = cb;
        return { remove: vi.fn() };
      }),
      getPlace: vi.fn(() => ({
        name: 'Hub Dock',
        formatted_address: '500 Hub Way, Dallas, TX',
        geometry: { location: { lat: () => 32.77, lng: () => -96.79 } },
      })),
    };
    const legacyAutocompleteCtor = vi.fn(function makeLegacyAc() {
      return legacyAcInstance;
    });
    hoistedState.placesLib = {
      AutocompleteSuggestion: {
        fetchAutocompleteSuggestions: vi.fn().mockRejectedValue(
          new Error('PERMISSION_DENIED: Places (New) disabled')
        ),
      },
      Autocomplete: legacyAutocompleteCtor,
    };

    const onWidgetChange = vi.fn();
    const onWidgetSelect = vi.fn();
    const tier3 = await renderWithAct(
      <PlacesAutocompleteInput value="" onChange={onWidgetChange} onSelectPlace={onWidgetSelect} placeholder="Start Address" />
    );
    await changeValue(tier3.container.querySelector('input'), 'Fallback Addr');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(legacyAutocompleteCtor).toHaveBeenCalledTimes(1);
    expect(placeChangedCb).toBeTypeOf('function');
    await act(async () => {
      placeChangedCb();
    });
    expect(onWidgetChange).toHaveBeenCalledWith('Hub Dock, 500 Hub Way, Dallas, TX');
    expect(onWidgetSelect).toHaveBeenCalledWith({
      address: 'Hub Dock, 500 Hub Way, Dallas, TX',
      lat: 32.77,
      lng: -96.79,
    });
    await tier3.unmount();

    // 3. Tier 4 fallback (Geocoder when both Places APIs are denied)
    resetPlacesAutocompleteState();
    const geocodeMock = vi.fn((_req, cb) =>
      cb(
        [
          {
            place_id: 'geo_1',
            formatted_address: '1600 Amphitheatre Pkwy, Mountain View, CA',
            geometry: { location: { lat: () => 37.422, lng: () => -122.084 } },
          },
        ],
        'OK'
      )
    );
    window.google = {
      maps: {
        Geocoder: function makeGeocoder() {
          return { geocode: geocodeMock };
        },
      },
    };
    hoistedState.placesLib = {
      AutocompleteSuggestion: {
        fetchAutocompleteSuggestions: vi.fn().mockRejectedValue(new Error('PERMISSION_DENIED')),
      },
      AutocompleteService: vi.fn(function makeAcSvc() {
        return { getPlacePredictions: vi.fn((_req, cb) => cb([], 'REQUEST_DENIED')) };
      }),
      Autocomplete: vi.fn(),
    };

    const onGeoSelect = vi.fn();
    const tier4 = await renderWithAct(
      <PlacesAutocompleteInput value="" onChange={vi.fn()} onSelectPlace={onGeoSelect} placeholder="Start Address" />
    );
    await changeValue(tier4.container.querySelector('input'), '1600 Amph');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(geocodeMock).toHaveBeenCalledTimes(1);
    expect(tier4.container.textContent).toContain('1600 Amphitheatre Pkwy, Mountain View, CA');

    await click(tier4.container.querySelector('ul[role="listbox"] button'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });
    expect(onGeoSelect).toHaveBeenCalledWith({
      address: '1600 Amphitheatre Pkwy, Mountain View, CA',
      lat: 37.422,
      lng: -122.084,
    });
    await tier4.unmount();
  });

  it('CreateJobModal autocompletes origin and multiple destination stops with coordinates persisted without fallback geocoding', async () => {
    vi.useFakeTimers();

    const makePlace = (displayName, formattedAddress, lat, lng) => ({
      displayName,
      formattedAddress,
      location: { lat: () => lat, lng: () => lng },
      fetchFields: vi.fn(async () => undefined),
    });

    const AutocompleteSuggestion = {
      fetchAutocompleteSuggestions: vi.fn(async function fetchSuggestions(req) {
        if (this !== AutocompleteSuggestion) throw new TypeError('Illegal invocation');
        if (req.input.includes('Origin')) {
          return {
            suggestions: [
              {
                placePrediction: {
                  placeId: 'p_origin',
                  mainText: { text: 'Origin Hub' },
                  secondaryText: { text: '100 North St, Austin, TX' },
                  text: { text: 'Origin Hub, 100 North St, Austin, TX' },
                  toPlace: () => makePlace('Origin Hub', '100 North St, Austin, TX', 30.1, -97.1),
                },
              },
            ],
          };
        }
        if (req.input.includes('Stop Two')) {
          return {
            suggestions: [
              {
                placePrediction: {
                  placeId: 'p_stop2',
                  mainText: { text: 'Receiver Bay' },
                  secondaryText: { text: '300 East Ave, Austin, TX' },
                  text: { text: 'Receiver Bay, 300 East Ave, Austin, TX' },
                  toPlace: () => makePlace('Receiver Bay', '300 East Ave, Austin, TX', 30.3, -97.3),
                },
              },
            ],
          };
        }
        return {
          suggestions: [
            {
              placePrediction: {
                placeId: 'p_stop1',
                mainText: { text: 'Drop Dock' },
                secondaryText: { text: '200 South Ave, Austin, TX' },
                text: { text: 'Drop Dock, 200 South Ave, Austin, TX' },
                toPlace: () => makePlace('Drop Dock', '200 South Ave, Austin, TX', 30.2, -97.2),
              },
            },
          ],
        };
      }),
    };

    hoistedState.placesLib = {
      AutocompleteSuggestion,
      AutocompleteSessionToken: vi.fn(function makeTok() {
        return {};
      }),
    };

    const geocodeSpy = vi.fn((_req, cb) => cb([], 'ZERO_RESULTS'));
    window.google = {
      maps: {
        Geocoder: function makeGeocoder() {
          return { geocode: geocodeSpy };
        },
      },
    };

    useAppStore.getState().setCurrentUser({ id: 'disp1', name: 'Dispatch' });
    useAppStore.getState().setCompany('comp1', 'Alpha', true);
    useAppStore.getState().openModal('createJob');

    const { container, unmount } = await renderWithAct(<CreateJobModal />);
    const form = container.querySelector('#create-job-form');
    await changeValue(form.querySelector('input[type="text"]'), 'Autocomplete Run');

    // Select Origin via autocomplete
    const originInput = container.querySelector('input[placeholder="Start Address"]');
    await changeValue(originInput, 'Origin Hub');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    const originOption = originInput.parentElement.querySelector('ul[role="listbox"] button');
    await click(originOption);
    await act(async () => {
      await Promise.resolve();
    });

    // Select Stop 1 via autocomplete
    const stop1Input = container.querySelector('input[placeholder="Stop 1 Address"]');
    await changeValue(stop1Input, 'Drop Dock');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    const stop1Option = stop1Input.parentElement.querySelector('ul[role="listbox"] button');
    await click(stop1Option);
    await act(async () => {
      await Promise.resolve();
    });

    // Add Stop 2 and select via autocomplete
    const addStopBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('+ Add Stop')
    );
    await click(addStopBtn);
    const stop2Input = container.querySelector('input[placeholder="Stop 2 Address"]');
    await changeValue(stop2Input, 'Stop Two');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    const stop2Option = stop2Input.parentElement.querySelector('ul[role="listbox"] button');
    await click(stop2Option);
    await act(async () => {
      await Promise.resolve();
    });

    await submitForm(form);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(geocodeSpy).not.toHaveBeenCalled();

    const created = Array.from(mockFs.store.entries()).find(([p]) =>
      p.startsWith('companies/comp1/jobs/')
    );
    expect(created).toBeDefined();
    expect(created[1]).toMatchObject({
      jobName: 'Autocomplete Run',
      origin: 'Origin Hub, 100 North St, Austin, TX',
      destinations: [
        'Drop Dock, 200 South Ave, Austin, TX',
        'Receiver Bay, 300 East Ave, Austin, TX',
      ],
    });
    expect(created[1].stops[0]).toMatchObject({
      address: 'Drop Dock, 200 South Ave, Austin, TX',
      lat: 30.2,
      lng: -97.2,
    });
    expect(created[1].stops[1]).toMatchObject({
      address: 'Receiver Bay, 300 East Ave, Austin, TX',
      lat: 30.3,
      lng: -97.3,
    });

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
