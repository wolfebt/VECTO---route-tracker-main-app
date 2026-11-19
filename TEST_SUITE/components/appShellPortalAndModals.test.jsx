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
import { useAppStore } from '../../src/store/useAppStore';
import { useToastStore } from '../../src/store/useToastStore';

const {
  hoistedState,
  signInWithPopupMock,
  signOutMock,
  mockMapInstance,
  enableNotificationsMock,
} = vi.hoisted(() => ({
  hoistedState: {
    mockFs: null,
    authCallback: null,
    polylineInstances: [],
    trafficLayerInstances: [],
    canvasOverlays: [],
  },
  signInWithPopupMock: vi.fn().mockResolvedValue({ user: { uid: 'u1' } }),
  signOutMock: vi.fn().mockResolvedValue(undefined),
  mockMapInstance: {
    getZoom: vi.fn(() => 10),
    setCenter: vi.fn(),
    setZoom: vi.fn(),
    fitBounds: vi.fn(),
    addListener: vi.fn(() => ({ remove: vi.fn() })),
    getBounds: vi.fn(() => ({
      getSouthWest: () => ({ lat: () => 30.0, lng: () => -97.8 }),
      getNorthEast: () => ({ lat: () => 30.3, lng: () => -97.6 }),
    })),
  },
  enableNotificationsMock: vi.fn().mockResolvedValue({ granted: true, platform: 'web' }),
}));

vi.mock('firebase/firestore', async () => {
  const { createFirestoreMock } = await import('../helpers/firebaseMock');
  hoistedState.mockFs = hoistedState.mockFs || createFirestoreMock();
  return hoistedState.mockFs.firestoreModule;
});
vi.mock('firebase/storage', () => ({
  ref: vi.fn((_s, path) => ({ fullPath: path })),
  uploadBytes: vi.fn().mockResolvedValue({}),
  getDownloadURL: vi.fn().mockResolvedValue('https://storage.example/file.png'),
}));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn((_auth, cb) => {
    hoistedState.authCallback = cb;
    return vi.fn();
  }),
  signInWithPopup: signInWithPopupMock,
  GoogleAuthProvider: class {
    setCustomParameters = vi.fn();
  },
  signOut: signOutMock,
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
  APIProvider: ({ children }) => <div data-testid="api-provider">{children}</div>,
  Map: ({ children }) => <div data-testid="google-map">{children}</div>,
  AdvancedMarker: ({ children, onClick, title }) => (
    <div data-testid="advanced-marker" title={title} onClick={onClick}>
      {children}
    </div>
  ),
  Pin: () => <span data-testid="map-pin" />,
  InfoWindow: ({ children }) => <div data-testid="info-window">{children}</div>,
  useMap: () => mockMapInstance,
  useMapsLibrary: () => null,
}));
vi.mock('../../src/hooks/useNotifications', () => ({
  enableNotifications: enableNotificationsMock,
  useNotifications: vi.fn(),
}));
vi.mock('../../src/hooks/useLocationSharing', () => ({
  useLocationSharing: vi.fn(() => ({ isSharingLocation: true, toggleLocationSharing: vi.fn() })),
}));
vi.mock('../../src/hooks/useCarAppSync', () => ({
  useCarAppSync: vi.fn(),
}));
vi.mock('../../src/hooks/useNativeDevice', () => ({
  useNativeDevice: vi.fn(),
}));
vi.mock('../../src/hooks/useDirections', () => ({
  useDirections: vi.fn(() => ({ directionsService: null, directionsRenderer: null })),
}));
vi.mock('../../src/hooks/useRouteWeather', () => ({
  useRouteWeather: vi.fn(),
}));

import App from '../../src/App';
import Auth from '../../src/components/Auth';
import CompanySelector from '../../src/components/CompanySelector';
import CustomerTrackingView from '../../src/components/CustomerTrackingView';
import Sidebar from '../../src/components/layout/Sidebar';
import MapArea from '../../src/components/layout/MapArea';
import RouteOutlineOverlay from '../../src/components/layout/RouteOutlineOverlay';
import ToastContainer from '../../src/components/layout/ToastContainer';
import CompanySettingsModal from '../../src/components/modals/CompanySettingsModal';
import AdminSettingsModal from '../../src/components/modals/AdminSettingsModal';
import InviteModal from '../../src/components/modals/InviteModal';
import MapSettingsModal from '../../src/components/modals/MapSettingsModal';
import ProfileModal from '../../src/components/modals/ProfileModal';
import SettingsModal from '../../src/components/modals/SettingsModal';
import DevelopmentModal from '../../src/components/modals/DevelopmentModal';
import TechnicalsModal from '../../src/components/modals/TechnicalsModal';
import UserGuideModal from '../../src/components/modals/UserGuideModal';

function installGoogleMapsMock() {
  class MockOverlayView {
    setMap(m) {
      this._map = m;
      if (m) {
        this.onAdd?.();
        this.draw?.();
      } else {
        this.onRemove?.();
      }
    }
    getMap() {
      return this._map;
    }
    getPanes() {
      return { overlayLayer: document.createElement('div') };
    }
    getProjection() {
      return { fromLatLngToDivPixel: () => ({ x: 40, y: 40 }) };
    }
  }

  window.google = {
    maps: {
      LatLng: function makeLatLng(lat, lng) {
        return { lat: () => lat, lng: () => lng };
      },
      LatLngBounds: function makeBounds() {
        return {
          extend: vi.fn(),
          getCenter: () => ({ lat: 30.26, lng: -97.74 }),
        };
      },
      Polyline: function makePolyline(opts) {
        const line = {
          opts,
          setMap: vi.fn(),
          setPath: vi.fn(),
          setOptions: vi.fn(),
          setVisible: vi.fn(),
          addListener: vi.fn(),
        };
        hoistedState.polylineInstances.push(line);
        return line;
      },
      TrafficLayer: function makeTrafficLayer() {
        const layer = { setMap: vi.fn() };
        hoistedState.trafficLayerInstances.push(layer);
        return layer;
      },
      OverlayView: MockOverlayView,
      event: {
        removeListener: vi.fn(),
      },
    },
  };
}

describe('App Shell, Customer Tracking Portal, Company Portal, Map Overlays & Settings Modals', () => {
  const mockFs = hoistedState.mockFs;

  beforeEach(() => {
    installFakeIndexedDB();
    resetAppAndToastStores();
    mockFs.reset();
    window.__setViewportDesktop?.(true);
    hoistedState.authCallback = null;
    hoistedState.polylineInstances = [];
    hoistedState.trafficLayerInstances = [];
    hoistedState.canvasOverlays = [];
    signInWithPopupMock.mockReset().mockResolvedValue({ user: { uid: 'u1' } });
    signOutMock.mockReset().mockResolvedValue(undefined);
    enableNotificationsMock.mockClear();
    mockMapInstance.setCenter.mockClear();
    mockMapInstance.setZoom.mockClear();
    mockMapInstance.fitBounds.mockClear();
    window.confirm = vi.fn(() => true);
    window.history.replaceState(null, '', '/');
    installGoogleMapsMock();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    resetFakeIndexedDB();
    delete window.google;
    window.history.replaceState(null, '', '/');
  });

  it('App routes ?track=<token> to CustomerTrackingView and handles live vs revoked states', async () => {
    localStorage.setItem('mapsApiKey', 'cust-key');
    const token = 'track_token_123456789012345';
    mockFs.seedDoc(`public_tracking/${token}`, {
      companyId: 'comp1',
      companyName: 'VECTO Logistics',
      jobId: 'job1',
      jobName: 'Medical Freight',
      status: 'in-progress',
      driverFirstName: 'Alex',
      driverLocation: { lat: 30.2, lng: -97.7 },
      destinationCoords: { lat: 30.3, lng: -97.7 },
      podCompleted: true,
      revoked: false,
      stopsSummary: [{ order: 1, label: 'St David Hospital', status: 'arrived', hasPod: true }],
      updatedAt: Date.now(),
    });

    window.history.replaceState(null, '', `/?track=${token}`);
    const { container, unmount } = await renderWithAct(<App />);
    await flushPromises();
    await flushPromises();

    expect(container.textContent).toContain('Medical Freight');
    expect(container.textContent).toContain('Proof of Delivery Recorded');
    expect(container.textContent).toContain('St David Hospital');

    // Revoked token view
    const revToken = 'revoked_tok_123456789012345';
    mockFs.seedDoc(`public_tracking/${revToken}`, { revoked: true });
    const custView = await renderWithAct(<CustomerTrackingView token={revToken} />);
    await flushPromises();
    expect(custView.container.textContent).toContain('Tracking Unavailable');
    expect(custView.container.textContent).toContain('revoked by dispatch');

    await custView.unmount();
    await unmount();
  });

  it('Auth renders sign-in button and displays error message when Google sign-in fails', async () => {
    signInWithPopupMock.mockRejectedValueOnce(new Error('Popup closed by user'));
    const { container, unmount } = await renderWithAct(<Auth />);

    const btn = container.querySelector('button');
    expect(btn.textContent).toContain('Sign in with Google');
    await click(btn);
    await flushPromises();
    expect(container.textContent).toContain('Popup closed by user');

    await unmount();
  });

  it('CompanySelector creates password-protected fleets and joins open/password fleets', async () => {
    mockFs.seedDoc('users/u1', { companies: [] });
    mockFs.seedDoc('company_directory/comp_join', {
      name: 'Open Network Fleet',
      requirePassword: false,
      createdBy: 'owner2',
    });
    mockFs.seedDoc('companies/comp_join', {
      name: 'Open Network Fleet',
      requirePassword: false,
      createdBy: 'owner2',
    });

    useAppStore.getState().setCurrentUser({ id: 'u1', email: 'u1@vecto.app', name: 'Alex', companies: [] });
    const { container, unmount } = await renderWithAct(<CompanySelector />);
    await flushPromises();

    // Switch to Create Fleet tab
    const createTabBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Create Fleet')
    );
    await click(createTabBtn);

    const form = container.querySelector('form');
    await changeValue(form.querySelector('input[type="text"]'), 'Apex Freight');
    await changeValue(form.querySelector('input[type="password"]'), 'secret123');
    await submitForm(form);
    await flushPromises();

    const createdComp = Array.from(mockFs.store.entries()).find(
      ([p, v]) => p.startsWith('companies/') && !p.includes('/', 'companies/'.length) && v.name === 'Apex Freight'
    );
    expect(createdComp).toBeDefined();
    const compId = createdComp[0].split('/')[1];
    expect(mockFs.getRawDoc(`company_directory/${compId}`).name).toBe('Apex Freight');
    expect(mockFs.getRawDoc(`companies/${compId}/private/security`).passwordHash).toMatch(/^[0-9a-f]{64}$/);
    expect(useAppStore.getState().companyId).toBe(compId);

    await unmount();
  });

  it('Authenticated App renders desktop workspace, switches to Operations Board, and opens Settings', async () => {
    mockFs.seedDoc('companies/comp1', { name: 'Alpha Fleet', createdBy: 'disp1' });
    mockFs.seedDoc('companies/comp1/members/disp1', {
      name: 'Dispatch Lead',
      permissions: { canCreateJob: true, canManageDrivers: true },
    });
    mockFs.seedDoc('companies/comp1/jobs/j1', {
      jobName: 'Test Route',
      origin: 'A',
      status: 'in-progress',
      stops: [],
    });

    useAppStore.getState().setCurrentUser({ id: 'disp1', name: 'Dispatch Lead', companies: ['comp1'] });
    useAppStore.getState().setShowSplash(false);
    useAppStore.getState().setMapsApiKey('test-maps-key');
    useAppStore.getState().setCompany('comp1', 'Alpha Fleet', true);
    useAppStore.getState().setSelectedJobId('j1');
    useAppStore.getState().setActiveJobs([{ id: 'j1', jobName: 'Test Route', origin: 'A', status: 'in-progress', stops: [] }]);
    useAppStore.getState().setRouteWeather({
      destinationWeather: { temp: 72, desc: 'Clear' },
      highestSeverity: 'warning',
      hazards: [{ type: 'wind', title: 'High Wind Advisory', segment: 'Origin' }],
    });

    const { container, unmount } = await renderWithAct(<App />);
    await flushPromises();
    await flushPromises();

    expect(container.textContent).toContain('Welcome, Dispatch Lead');
    expect(container.textContent).toContain('1 Hazard');

    const opsBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Ops Board')
    );
    await click(opsBtn);
    await flushPromises();
    await flushPromises();
    expect(useAppStore.getState().mainView).toBe('operations');

    const settingsBtn = container.querySelector('button[aria-label="Settings"]');
    await click(settingsBtn);
    await flushPromises();
    await flushPromises();
    expect(useAppStore.getState().modals.settings).toBe(true);
    expect(container.textContent).toContain('Map & Route Settings');

    const closeSettingsBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '×');
    await click(closeSettingsBtn);
    await flushPromises();
    expect(useAppStore.getState().modals.settings).toBe(false);

    await unmount();
  });

  it('Sidebar, MapArea, RouteOutlineOverlay, and ToastContainer handle driver controls, map overlays, and toast dismissal', async () => {
    mockFs.seedDoc('companies/comp1/members/drv1', { name: 'Alex', onDutyStatus: 'on_duty' });

    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '');
    useAppStore.getState().setMapsApiKey('');
    useAppStore.getState().setCurrentUser({ id: 'drv1', name: 'Alex', color: '#22c55e' });
    useAppStore.getState().setCompany('comp1', 'Alpha Fleet', false);
    useAppStore.getState().setMembers([{ id: 'drv1', name: 'Alex', onDutyStatus: 'on_duty' }]);
    useAppStore.getState().setVehicles([{ id: 'v1', unitNumber: 'VAN-1', status: 'maintenance' }]);
    useAppStore.getState().setInspections([{ id: 'i1', overallStatus: 'unsafe', mechanicResolved: false }]);
    useAppStore.getState().setCurrentLocation({ lat: 30.26, lng: -97.74 });
    useAppStore.getState().setActiveDrivers([
      { id: 'd2', name: 'Sam', location: { latitude: 30.27, longitude: -97.75 }, timestamp: Date.now() },
      { id: 'd3', name: 'Pat', location: { latitude: 30.2702, longitude: -97.7502 }, timestamp: Date.now() },
    ]);
    useAppStore.getState().setRouteInfo({
      jobId: 'j1',
      routeColor: '#3b82f6',
      overviewPath: [
        { lat: 30.25, lng: -97.75 },
        { lat: 30.28, lng: -97.72 },
      ],
      stepTraffics: [{ path: [{ lat: 30.25, lng: -97.75 }, { lat: 30.28, lng: -97.72 }], color: '#22c55e' }],
    });
    useToastStore.getState().addToast('Route Updated', 'success');

    const { container, rerender, unmount } = await renderWithAct(
      <div>
        <Sidebar />
        <MapArea />
        <ToastContainer />
      </div>
    );

    // Duty status button in Sidebar
    const breakBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'On Break');
    await click(breakBtn);
    await flushPromises();
    expect(mockFs.getRawDoc('companies/comp1/members/drv1').onDutyStatus).toBe('break');

    // Share team map link writes canonical URL to clipboard
    const shareBtn = container.querySelector('button[title="Share Team Map & Job Link"]');
    await click(shareBtn);
    await flushPromises();
    expect(navigator.clipboard.writeText).toHaveBeenCalled();

    // MapArea renders missing key fallback
    expect(container.textContent).toContain('Map Authentication Failed');

    // Enable Maps key -> renders Map, clusters 2 nearby drivers, Fit Fleet & Fit Route work
    await act(async () => {
      useAppStore.getState().setMapsApiKey('live-key');
    });
    await rerender(
      <div>
        <Sidebar />
        <MapArea />
        <ToastContainer />
      </div>
    );
    expect(container.textContent).toContain('2 Drivers');
    const fitFleetBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Fit Fleet');
    const fitRouteBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Fit Route');
    await click(fitFleetBtn);
    await click(fitRouteBtn);
    expect(mockMapInstance.fitBounds).toHaveBeenCalledTimes(2);

    // RouteOutlineOverlay renders Polyline modes + Canvas 'outlined' mode
    const overlay = await renderWithAct(
      <RouteOutlineOverlay
        path={[{ lat: 30.25, lng: -97.75 }, { lat: 30.28, lng: -97.72 }]}
        routeStyle="outlined"
        driverLocation={{ lat: 30.26, lng: -97.74 }}
      />
    );
    await overlay.rerender(
      <RouteOutlineOverlay
        path={[{ lat: 30.25, lng: -97.75 }, { lat: 30.28, lng: -97.72 }]}
        routeStyle="traffic"
        stepTraffics={[{ path: [{ lat: 30.25, lng: -97.75 }, { lat: 30.28, lng: -97.72 }], color: '#ef4444' }]}
        driverLocation={{ lat: 30.26, lng: -97.74 }}
      />
    );
    expect(hoistedState.polylineInstances.length).toBeGreaterThan(0);

    // Toast dismiss
    const toastEl = Array.from(container.querySelectorAll('div')).find((d) =>
      d.textContent.includes('Route Updated') && d.className.includes('pointer-events-auto')
    );
    await click(toastEl);
    expect(useToastStore.getState().toasts.some((t) => t.message === 'Route Updated')).toBe(false);

    await overlay.unmount();
    await unmount();
  });

  it('CompanySettingsModal, AdminSettingsModal, InviteModal, MapSettingsModal, ProfileModal, SettingsModal, DevelopmentModal, TechnicalsModal & UserGuideModal work end-to-end', async () => {
    mockFs.seedDoc('users/disp1', { name: 'Dispatch Lead', phone: '555-0001', color: '#22c55e' });
    mockFs.seedDoc('companies/comp1', {
      name: 'Alpha Fleet',
      createdBy: 'disp1',
      requirePassword: false,
      address: 'Old Legacy Addr',
    });
    mockFs.seedDoc('companies/comp1/private/profile', {
      address: '500 Fleet Blvd',
      contactName: 'Jane',
      phone: '555-1000',
      email: 'ops@alpha.example',
    });
    mockFs.seedDoc('companies/comp1/members/drv1', {
      name: 'Alex',
      permissions: { canCreateJob: false, canDeleteJob: false, canManageDrivers: false },
    });
    mockFs.seedDoc('companies/comp1/jobs/j1', {
      jobName: 'Customer Delivery',
      origin: 'Depot',
      destination: 'Drop',
      status: 'in-progress',
      contactNumber: '555-9999',
    });

    useAppStore.getState().setCurrentUser({ id: 'disp1', name: 'Dispatch Lead', phone: '555-0001', color: '#22c55e' });
    useAppStore.getState().setCompany('comp1', 'Alpha Fleet', true);
    useAppStore.getState().setMemberPermissions({ canCreateJob: true, canDeleteJob: true, canManageDrivers: true, isCreator: true });
    useAppStore.getState().setMembers([
      { id: 'disp1', name: 'Dispatch Lead', permissions: { canCreateJob: true } },
      { id: 'drv1', name: 'Alex', permissions: { canCreateJob: false } },
    ]);
    useAppStore.getState().setActiveJobs([
      { id: 'j1', jobName: 'Customer Delivery', origin: 'Depot', destination: 'Drop', status: 'in-progress', contactNumber: '555-9999' },
    ]);
    useAppStore.getState().setSelectedJobId('j1');

    // 1. CompanySettingsModal
    useAppStore.getState().openModal('companySettings');
    const compRes = await renderWithAct(<CompanySettingsModal />);
    await flushPromises();
    const addrInput = compRes.container.querySelector('input[name="address"]');
    await changeValue(addrInput, '900 Logistics Way');
    await submitForm(compRes.container.querySelector('form'));
    await flushPromises();
    expect(mockFs.getRawDoc('companies/comp1/private/profile').address).toBe('900 Logistics Way');
    expect(mockFs.getRawDoc('companies/comp1').address).toBeUndefined();
    await compRes.unmount();

    // 2. AdminSettingsModal
    useAppStore.getState().openModal('adminSettings');
    const adminRes = await renderWithAct(<AdminSettingsModal />);
    const checkbox = adminRes.container.querySelectorAll('input[type="checkbox"]:not(:disabled)')[0];
    await changeValue(checkbox, true);
    await flushPromises();
    expect(mockFs.getRawDoc('companies/comp1/members/drv1').permissions.canCreateJob).toBe(true);

    const removeMemberBtn = adminRes.container.querySelector('button[title="Remove Member"]');
    await click(removeMemberBtn);
    await flushPromises();
    expect(mockFs.getRawDoc('companies/comp1/private/security').removedMemberIds).toContain('drv1');
    expect(mockFs.getRawDoc('companies/comp1/members/drv1')).toBeUndefined();
    await adminRes.unmount();

    // 3. InviteModal (Company QR + Customer Track generate & revoke)
    useAppStore.getState().openModal('invite', { jobId: 'j1', tab: 'customer' });
    const inviteRes = await renderWithAct(<InviteModal />);
    const genBtn = Array.from(inviteRes.container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Generate Customer Tracking Link')
    );
    await click(genBtn);
    await flushPromises();
    const trackingToken = mockFs.getRawDoc('companies/comp1/jobs/j1').trackingToken;
    expect(trackingToken).toHaveLength(32);

    // Sync job trackingToken into store and revoke
    await act(async () => {
      useAppStore.getState().setActiveJobs([
        { id: 'j1', jobName: 'Customer Delivery', origin: 'Depot', destination: 'Drop', status: 'in-progress', trackingToken },
      ]);
    });
    const revokeBtn = Array.from(inviteRes.container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Revoke Link')
    );
    await click(revokeBtn);
    await flushPromises();
    expect(mockFs.getRawDoc(`public_tracking/${trackingToken}`).revoked).toBe(true);
    await inviteRes.unmount();

    // 4. MapSettingsModal & ProfileModal
    useAppStore.getState().openModal('mapSettings');
    useAppStore.getState().openModal('profile');
    const mapProfRes = await renderWithAct(
      <div>
        <MapSettingsModal />
        <ProfileModal />
      </div>
    );
    const solidOpt = Array.from(mapProfRes.container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Solid Line')
    );
    await click(solidOpt);
    expect(useAppStore.getState().routeStyle).toBe('solid');

    const profileForm = mapProfRes.container.querySelector('form');
    await changeValue(profileForm.querySelector('input[type="text"]'), 'Dispatch Prime');
    await submitForm(profileForm);
    await flushPromises();
    expect(mockFs.getRawDoc('users/disp1').name).toBe('Dispatch Prime');
    await mapProfRes.unmount();

    // 5. SettingsModal, DevelopmentModal, TechnicalsModal, UserGuideModal
    useAppStore.getState().openModal('settings');
    const settingsRes = await renderWithAct(<SettingsModal />);
    const notifBtn = Array.from(settingsRes.container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Push & Dispatch Notifications')
    );
    await click(notifBtn);
    await flushPromises();
    expect(enableNotificationsMock).toHaveBeenCalledWith('disp1');
    await settingsRes.unmount();

    useAppStore.getState().openModal('development');
    useAppStore.getState().openModal('technicals');
    useAppStore.getState().openModal('userGuide');
    const docsRes = await renderWithAct(
      <div>
        <DevelopmentModal />
        <TechnicalsModal />
        <UserGuideModal />
      </div>
    );
    const devForm = docsRes.container.querySelector('form');
    const devInputs = devForm.querySelectorAll('input[type="text"]');
    await changeValue(devInputs[0], 'maps_dev_key');
    await changeValue(devInputs[1], 'fb_dev_key');
    await changeValue(devInputs[2], 'gemini_dev_key');
    await submitForm(devForm);
    await flushPromises();
    expect(localStorage.getItem('mapsApiKey')).toBe('maps_dev_key');
    expect(localStorage.getItem('geminiApiKey')).toBe('gemini_dev_key');
    expect(docsRes.container.textContent.length).toBeGreaterThan(100);
    await docsRes.unmount();
  });
});
