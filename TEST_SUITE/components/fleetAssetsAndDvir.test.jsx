import React, { act } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  changeValue,
  click,
  flushPromises,
  renderWithAct,
  resetAppAndToastStores,
  submitForm,
} from '../helpers/renderUtils';
import { useAppStore } from '../../src/store/useAppStore';

const { hoistedState, storageUploadBytes, storageGetDownloadURL, storageRef, compressImageFileMock } = vi.hoisted(() => ({
  hoistedState: { mockFs: null },
  storageUploadBytes: vi.fn().mockResolvedValue({}),
  storageGetDownloadURL: vi.fn().mockResolvedValue('https://storage.example/dvir-defect.jpg'),
  storageRef: vi.fn((_s, path) => ({ fullPath: path })),
  compressImageFileMock: vi.fn(async (file) => file),
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
vi.mock('../../src/utils/imageCompression', () => ({
  compressImageFile: compressImageFileMock,
}));

import FleetVehiclesModal from '../../src/components/modals/FleetVehiclesModal';
import DvirModal from '../../src/components/modals/DvirModal';

describe('Fleet Vehicles Registry & DVIR Safety Inspection Modals', () => {
  const mockFs = hoistedState.mockFs;

  beforeEach(() => {
    resetAppAndToastStores();
    mockFs.reset();
    storageUploadBytes.mockClear();
    storageGetDownloadURL.mockClear();
    storageRef.mockClear();
    compressImageFileMock.mockClear();
    window.confirm = vi.fn(() => true);
    window.prompt = vi.fn(() => 'Replaced worn brake pads');
  });

  it('FleetVehiclesModal displays KPIs, filters units, and supports dispatcher add/edit/delete CRUD', async () => {
    useAppStore.getState().setCurrentUser({ id: 'disp1', name: 'Dispatch Lead' });
    useAppStore.getState().setCompany('comp1', 'Alpha Fleet', true);
    useAppStore.getState().setMembers([
      { id: 'drv1', name: 'Alex Driver' },
      { id: 'drv2', name: 'Sam Courier' },
    ]);
    useAppStore.getState().setVehicles([
      {
        id: 'veh1',
        unitNumber: 'VAN-101',
        makeModel: '2024 Ford Transit',
        vehicleType: 'van',
        fuelType: 'diesel',
        licensePlate: 'TX-101',
        odometerMiles: 52000,
        serviceDueMiles: 50000,
        status: 'active',
        assignedDriverId: 'drv1',
        assignedDriverName: 'Alex Driver',
        lastInspectionStatus: 'safe',
      },
      {
        id: 'veh2',
        unitNumber: 'BOX-202',
        makeModel: 'Isuzu NPR',
        vehicleType: 'box_truck',
        fuelType: 'diesel',
        licensePlate: 'TX-202',
        odometerMiles: 18000,
        serviceDueMiles: 30000,
        status: 'out_of_service',
      },
    ]);
    useAppStore.getState().setInspections([
      { id: 'insp1', vehicleId: 'veh2', overallStatus: 'unsafe', mechanicResolved: false },
    ]);
    useAppStore.getState().openModal('fleetVehicles');

    const { container, unmount } = await renderWithAct(<FleetVehiclesModal />);

    expect(container.textContent).toContain('2 Units');
    expect(container.textContent).toContain('1 Open Defect');
    expect(container.textContent).toContain('Service Due');

    // Search filter narrows list
    const searchInput = container.querySelector('input[placeholder="Search unit, plate, driver..."]');
    await changeValue(searchInput, 'BOX-202');
    expect(container.textContent).toContain('BOX-202');
    expect(container.textContent).not.toContain('VAN-101');
    await changeValue(searchInput, '');

    // Add Vehicle drawer
    const addBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent.includes('Add Vehicle'));
    await click(addBtn);

    const form = container.querySelector('form');
    await changeValue(form.querySelector('input[placeholder="e.g., VAN-104"]'), 'VAN-303');
    await changeValue(form.querySelector('input[placeholder="e.g., 2024 Ford Transit 250"]'), 'Sprinter 2500');
    await changeValue(form.querySelector('input[placeholder="TX-8492K"]'), 'tx-303k');
    await changeValue(form.querySelector('input[placeholder="1FTBR1Y8..."]'), '1wd303vin');
    await changeValue(form.querySelector('input[placeholder="48500"]'), '10500');
    await changeValue(form.querySelector('input[placeholder="55000"]'), '20000');
    await changeValue(form.querySelector('input[placeholder="3500"]'), '4000');

    await submitForm(form);
    await flushPromises();

    expect(mockFs.firestoreModule.addDoc).toHaveBeenCalledTimes(1);
    const createdVehicle = Array.from(mockFs.store.entries()).find(([p]) =>
      p.startsWith('companies/comp1/vehicles/')
    )?.[1];
    expect(createdVehicle).toMatchObject({
      unitNumber: 'VAN-303',
      vin: '1WD303VIN',
      licensePlate: 'TX-303K',
      odometerMiles: 10500,
      serviceDueMiles: 20000,
      capacityLbs: 4000,
    });

    // Edit & delete existing vehicle
    const editBtn = container.querySelector('button[title="Edit Vehicle"]');
    await click(editBtn);
    const editForm = container.querySelector('form');
    await changeValue(editForm.querySelector('input[placeholder="48500"]'), '53500');
    await submitForm(editForm);
    await flushPromises();
    expect(mockFs.firestoreModule.updateDoc).toHaveBeenCalled();

    const deleteBtn = container.querySelector('button[title="Delete Vehicle"]');
    await click(deleteBtn);
    await flushPromises();
    expect(mockFs.firestoreModule.deleteDoc).toHaveBeenCalledTimes(1);

    // Inspect button launches DVIR modal for that vehicle
    const inspectBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent.includes('Inspect'));
    await click(inspectBtn);
    expect(useAppStore.getState().modals.dvir).toEqual({ vehicleId: 'veh1' });

    await unmount();
  });

  it('FleetVehiclesModal hides dispatcher CRUD actions for standard drivers', async () => {
    useAppStore.getState().setCurrentUser({ id: 'drv1', name: 'Alex Driver' });
    useAppStore.getState().setCompany('comp1', 'Alpha Fleet', false);
    useAppStore.getState().setVehicles([{ id: 'veh1', unitNumber: 'VAN-101', status: 'active' }]);
    useAppStore.getState().openModal('fleetVehicles');

    const { container, unmount } = await renderWithAct(<FleetVehiclesModal />);
    expect(container.textContent).not.toContain('Add Vehicle');
    expect(container.querySelector('button[title="Edit Vehicle"]')).toBeNull();
    expect(container.querySelector('button[title="Delete Vehicle"]')).toBeNull();
    await unmount();
  });

  it('DvirModal handles empty vehicles handoff, safe pass walkaround, unsafe defect photo + OOS hold, and mechanic resolution', async () => {
    useAppStore.getState().setCurrentUser({ id: 'drv1', name: 'Alex Driver' });
    useAppStore.getState().setCompany('comp1', 'Alpha Fleet', false);
    useAppStore.getState().setVehicles([]);
    useAppStore.getState().openModal('dvir');

    const { container, rerender, unmount } = await renderWithAct(<DvirModal />);
    expect(container.textContent).toContain('No DVIR safety inspections logged yet');
    const newInspectionTab = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('New Inspection')
    );
    await click(newInspectionTab);
    expect(container.textContent).toContain('No fleet vehicles registered yet');
    const openVehiclesBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Open Fleet Vehicles')
    );
    await click(openVehiclesBtn);
    expect(useAppStore.getState().modals.fleetVehicles).toBe(true);

    // Seed vehicle & reopen DVIR
    const vehicle = {
      id: 'veh1',
      unitNumber: 'VAN-101',
      makeModel: 'Ford Transit',
      odometerMiles: 45000,
      status: 'active',
      assignedDriverId: 'drv1',
    };
    mockFs.seedDoc('companies/comp1/vehicles/veh1', vehicle);
    await act(async () => {
      useAppStore.getState().setVehicles([vehicle]);
      useAppStore.getState().openModal('dvir', { vehicleId: 'veh1', jobId: 'job9' });
    });
    await rerender(<DvirModal />);

    // Submit all-pass Pre-Trip DVIR
    const safeForm = container.querySelector('form');
    await changeValue(safeForm.querySelector('input[type="number"]'), '45250');
    await submitForm(safeForm);
    await flushPromises();

    expect(mockFs.getRawDoc('companies/comp1/vehicles/veh1')).toMatchObject({
      odometerMiles: 45250,
      lastInspectionStatus: 'safe',
      status: 'active',
    });

    // Switch back to New Inspection, flag brake defect + attach defect photo + mark UNSAFE
    const newTabBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('New Inspection')
    );
    await click(newTabBtn);

    const brakeBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Service Brakes & Parking Brake')
    );
    await click(brakeBtn);

    const unsafeBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('UNSAFE — Put Out of Service')
    );
    await click(unsafeBtn);

    const defectTextarea = container.querySelector('textarea');
    await changeValue(defectTextarea, 'Air brake leak detected on rear axle');

    const fileInput = container.querySelector('input[type="file"]');
    const photoFile = new File(['defect-img'], 'brake.jpg', { type: 'image/jpeg' });
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [photoFile] });
    await changeValue(fileInput, '');
    await flushPromises();
    expect(compressImageFileMock).toHaveBeenCalledWith(photoFile);

    await submitForm(container.querySelector('form'));
    await flushPromises();

    expect(storageUploadBytes).toHaveBeenCalledTimes(1);
    expect(mockFs.getRawDoc('companies/comp1/vehicles/veh1').status).toBe('out_of_service');
    expect(mockFs.getRawDoc('companies/comp1/vehicles/veh1').lastInspectionStatus).toBe('unsafe');

    // Sync seeded inspection into store and resolve as dispatcher
    const savedInsp = Array.from(mockFs.store.entries()).find(
      ([p, v]) => p.startsWith('companies/comp1/inspections/') && v.overallStatus === 'unsafe'
    );
    await act(async () => {
      useAppStore.getState().setCompany('comp1', 'Alpha Fleet', true);
      useAppStore.getState().setInspections([{ id: savedInsp[0].split('/').pop(), ...savedInsp[1] }]);
    });
    await rerender(<DvirModal />);

    const resolveBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Resolve Defect & Return Active')
    );
    await click(resolveBtn);
    await flushPromises();

    expect(mockFs.getRawDoc(savedInsp[0]).mechanicResolved).toBe(true);
    expect(mockFs.getRawDoc(savedInsp[0]).resolvedNote).toBe('Replaced worn brake pads');
    expect(mockFs.getRawDoc('companies/comp1/vehicles/veh1').status).toBe('active');

    await unmount();
  });
});
