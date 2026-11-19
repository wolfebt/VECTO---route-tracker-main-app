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

const {
  hoistedState,
  storageUploadBytes,
  storageGetDownloadURL,
  storageDeleteObject,
  storageRef,
  scanReceiptWithGeminiMock,
} = vi.hoisted(() => ({
  hoistedState: { mockFs: null },
  storageUploadBytes: vi.fn().mockResolvedValue({}),
  storageGetDownloadURL: vi.fn().mockResolvedValue('https://storage.example/receipt.jpg'),
  storageDeleteObject: vi.fn().mockResolvedValue(undefined),
  storageRef: vi.fn((_s, path) => ({ fullPath: path })),
  scanReceiptWithGeminiMock: vi.fn(),
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
  deleteObject: storageDeleteObject,
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
vi.mock('../../src/utils/receiptOcr', () => ({
  EXPENSE_CATEGORIES: ['fuel', 'food', 'toll', 'maintenance', 'lodging', 'custom'],
  scanReceiptWithGemini: scanReceiptWithGeminiMock,
}));

import FleetAnalyticsModal from '../../src/components/modals/FleetAnalyticsModal';
import JobReportModal from '../../src/components/modals/JobReportModal';
import LogExpenseModal from '../../src/components/modals/LogExpenseModal';
import ExpenseLedgerModal from '../../src/components/modals/ExpenseLedgerModal';

describe('Fleet Analytics, Printable Job Reports, Receipt OCR & Expense Ledger Modals', () => {
  const mockFs = hoistedState.mockFs;

  beforeEach(() => {
    resetAppAndToastStores();
    mockFs.reset();
    storageUploadBytes.mockClear();
    storageGetDownloadURL.mockClear();
    storageDeleteObject.mockClear();
    storageRef.mockClear();
    scanReceiptWithGeminiMock.mockReset();
    window.confirm = vi.fn(() => true);
    window.prompt = vi.fn(() => 'Missing itemized receipt');
    window.print = vi.fn();
  });

  it('FleetAnalyticsModal computes KPIs, mileage, cost-per-mile, period switches, and exports CSV', async () => {
    const now = Date.now();
    const job = {
      id: 'job1',
      jobName: 'Houston Express',
      jobDate: '2026-11-18',
      status: 'completed',
      archived: false,
      assignedDrivers: [{ id: 'drv1', name: 'Alex' }],
      startedAt: now - 3600 * 1000,
      completedAt: now,
      stops: [
        {
          id: 's1',
          address: 'Drop 1',
          lat: 30.0,
          lng: -97.0,
          status: 'completed',
          arriveBy: '23:59',
          arrivedAt: now - 1000,
          pod: { capturedBy: 'drv1' },
        },
      ],
    };

    mockFs.seedDoc('companies/comp1/jobs/job1', job);
    mockFs.seedDoc('companies/comp1/jobs/job1/breadcrumbs/bc1', {
      companyId: 'comp1',
      jobId: 'job1',
      driverId: 'drv1',
      points: [
        { lat: 30.0, lng: -97.0, ts: 1000 },
        { lat: 30.1, lng: -97.0, ts: 2000 },
      ],
    });
    mockFs.seedDoc('companies/comp1/jobs/job1/expenses/exp1', {
      companyId: 'comp1',
      jobId: 'job1',
      driverId: 'drv1',
      type: 'fuel',
      amount: 50,
      status: 'approved',
      timestamp: now,
    });

    useAppStore.getState().setCurrentUser({ id: 'disp1', name: 'Dispatch' });
    useAppStore.getState().setCompany('comp1', 'Alpha Fleet', true);
    useAppStore.getState().setMembers([{ id: 'drv1', name: 'Alex', color: '#22c55e' }]);
    useAppStore.getState().setActiveJobs([job]);
    useAppStore.getState().setArchivedJobsState({ archivedJobsLoadedOnce: true });
    useAppStore.getState().setVehicles([{ id: 'v1', unitNumber: 'VAN-1', status: 'active' }]);
    useAppStore.getState().setInspections([{ id: 'i1', overallStatus: 'unsafe', mechanicResolved: false }]);
    useAppStore.getState().openModal('fleetAnalytics');

    const { container, unmount } = await renderWithAct(<FleetAnalyticsModal />);
    await flushPromises();

    expect(container.textContent).toContain('$50.00');
    expect(container.textContent).toContain('/ mi');
    expect(container.textContent).toContain('1 unresolved safety defect');

    const sevenDayBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '7 Days');
    await click(sevenDayBtn);

    const anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const exportBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent.includes('Export CSV'));
    await click(exportBtn);
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    anchorClickSpy.mockRestore();

    await unmount();
  });

  it('JobReportModal renders all 6 printable sections including SVG telemetry, SLA table, and POD verification', async () => {
    const job = {
      id: 'job1',
      jobName: 'Austin Corridor',
      jobDate: '2026-11-18',
      status: 'completed',
      origin: 'Depot A',
      vehicleLabel: 'VAN-101 • Transit',
      contactName: 'Jane Doe',
      contactNumber: '555-0199',
      assignedDrivers: [{ id: 'drv1', name: 'Alex' }],
      instructions: [{ id: 'inst1', text: 'Use loading dock B', target: 'drv1', isPriority: true }],
      stops: [
        {
          id: 's1',
          address: '100 Congress Ave',
          lat: 30.26,
          lng: -97.74,
          status: 'completed',
          arriveBy: '14:00',
          serviceMinutes: 15,
          arrivedAt: 1700000000000,
          completedAt: 1700000600000,
          pod: {
            recipientName: 'Warehouse Lead',
            capturedAt: 1700000600000,
            capturedByName: 'Alex',
            capturedLat: 30.26123,
            capturedLng: -97.74321,
            photoUrl: 'https://storage.example/pod.jpg',
            signatureUrl: 'https://storage.example/sig.png',
          },
        },
      ],
    };

    mockFs.seedDoc('companies/comp1/jobs/job1/chat/c1', {
      senderName: 'Dispatch',
      text: 'Roll out',
      timestamp: 1700000000000,
    });
    mockFs.seedDoc('companies/comp1/jobs/job1/notes/n1', {
      driverName: 'Alex',
      text: 'Unloaded safely',
      timestamp: 1700000500000,
    });
    mockFs.seedDoc('companies/comp1/jobs/job1/expenses/e1', {
      driverName: 'Alex',
      type: 'toll',
      merchant: 'TxTag',
      amount: 6.5,
      status: 'approved',
      receiptUrl: 'https://storage.example/toll.pdf',
    });
    mockFs.seedDoc('companies/comp1/jobs/job1/breadcrumbs/b1', {
      points: [
        { lat: 30.2, lng: -97.7, ts: 100 },
        { lat: 30.26, lng: -97.74, ts: 200 },
      ],
    });

    useAppStore.getState().setCompany('comp1', 'Alpha', true);
    useAppStore.getState().setActiveJobs([job]);
    useAppStore.getState().setRouteInfo({
      jobId: 'job1',
      distance: '6.2 mi',
      duration: '14m',
      overviewPath: [{ lat: 30.2, lng: -97.7 }, { lat: 30.26, lng: -97.74 }],
      steps: ['Head north on Congress Ave'],
    });
    useAppStore.getState().openModal('jobReport', { jobId: 'job1' });

    const { container, unmount } = await renderWithAct(<JobReportModal />);
    await flushPromises();

    expect(container.textContent).toContain('1. Job Details & Dispatch Instructions');
    expect(container.textContent).toContain('VAN-101 • Transit');
    expect(container.textContent).toContain('2. Team Member Updates & Logs');
    expect(container.textContent).toContain('3. Driver Expenses');
    expect(container.textContent).toContain('4. Route Details & Telemetry');
    expect(container.textContent).toContain('5. Job Chat History');
    expect(container.textContent).toContain('6. Proof of Delivery (POD) Verification');
    expect(container.textContent).toContain('30.26123, -97.74321');
    expect(container.querySelector('svg polyline')).not.toBeNull();

    const printBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Print Report')
    );
    await click(printBtn);
    expect(window.print).toHaveBeenCalledTimes(1);

    await unmount();
  });

  it('LogExpenseModal runs Gemini receipt OCR auto-fill and submits receipt + expense doc', async () => {
    scanReceiptWithGeminiMock.mockResolvedValue({
      merchant: 'Pilot Travel Center',
      amount: 72.45,
      category: 'fuel',
      date: '2026-11-18',
      summary: 'Diesel 20 gal',
      model: 'gemini-3.8-flash',
    });

    useAppStore.getState().setCurrentUser({ id: 'drv1', name: 'Alex' });
    useAppStore.getState().setCompany('comp1', 'Alpha', false);
    useAppStore.getState().setActiveJobs([{ id: 'job1', jobName: 'Austin Run' }]);
    useAppStore.getState().openModal('logExpense', { jobId: 'job1' });

    const { container, unmount } = await renderWithAct(<LogExpenseModal />);

    const fileInput = container.querySelector('input[type="file"]');
    const receiptFile = new File(['receipt-bytes'], 'pilot.jpg', { type: 'image/jpeg' });
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [receiptFile] });
    await changeValue(fileInput, '');
    await flushPromises();

    expect(container.textContent).toContain('AI Auto-Filled');
    expect(container.querySelector('input[placeholder="0.00"]').value).toBe('72.45');
    expect(container.querySelector('input[placeholder*="Pilot"]').value).toBe('Pilot Travel Center');

    await submitForm(container.querySelector('form'));
    await flushPromises();

    expect(storageUploadBytes).toHaveBeenCalledTimes(1);
    const savedExpense = Array.from(mockFs.store.entries()).find(([p]) =>
      p.startsWith('companies/comp1/jobs/job1/expenses/')
    )?.[1];
    expect(savedExpense).toMatchObject({
      companyId: 'comp1',
      jobId: 'job1',
      merchant: 'Pilot Travel Center',
      amount: 72.45,
      status: 'submitted',
    });

    await unmount();
  });

  it('ExpenseLedgerModal supports dispatcher approvals/rejections/CSV and driver pending delete + storage cleanup', async () => {
    mockFs.seedDoc('companies/comp1/jobs/job1/expenses/e1', {
      companyId: 'comp1',
      jobId: 'job1',
      jobName: 'Austin Run',
      driverId: 'drv1',
      driverName: 'Alex',
      type: 'fuel',
      merchant: 'Shell',
      amount: 42.5,
      status: 'submitted',
      receiptUrl: 'https://storage.example/shell.jpg',
      timestamp: 1700000000000,
    });
    mockFs.seedDoc('companies/comp1/jobs/job1/expenses/e2', {
      companyId: 'comp1',
      jobId: 'job1',
      jobName: 'Austin Run',
      driverId: 'drv2',
      driverName: 'Sam',
      type: 'toll',
      merchant: 'TxTag',
      amount: 10,
      status: 'approved',
      timestamp: 1700000005000,
    });

    useAppStore.getState().setCurrentUser({ id: 'disp1', name: 'Dispatch' });
    useAppStore.getState().setCompany('comp1', 'Alpha', true);
    useAppStore.getState().setMembers([
      { id: 'drv1', name: 'Alex' },
      { id: 'drv2', name: 'Sam' },
    ]);
    useAppStore.getState().setActiveJobs([{ id: 'job1', jobName: 'Austin Run' }]);
    useAppStore.getState().openModal('expenseLedger');

    const { container, rerender, unmount } = await renderWithAct(<ExpenseLedgerModal />);
    await flushPromises();

    expect(container.textContent).toContain('2 Records');
    expect(container.textContent).toContain('$52.50');

    // Reject e1 (Shell) specifically with prompt note
    const e1Card = Array.from(container.querySelectorAll('div')).find(
      (d) =>
        d.textContent.includes('Shell') &&
        !d.textContent.includes('TxTag') &&
        d.querySelector('button[title="Reject expense"]')
    );
    const rejectBtn = e1Card.querySelector('button[title="Reject expense"]');
    await click(rejectBtn);
    await flushPromises();
    expect(mockFs.getRawDoc('companies/comp1/jobs/job1/expenses/e1')).toMatchObject({
      status: 'rejected',
      reviewedBy: 'disp1',
      reviewNote: 'Missing itemized receipt',
    });

    // Switch to driver drv1 with pending e3 -> sees only own records and can delete pending
    mockFs.seedDoc('companies/comp1/jobs/job1/expenses/e3', {
      companyId: 'comp1',
      jobId: 'job1',
      driverId: 'drv1',
      driverName: 'Alex',
      type: 'food',
      amount: 15,
      status: 'submitted',
      receiptUrl: 'https://storage.example/meal.jpg',
      timestamp: 1700000010000,
    });
    await act(async () => {
      useAppStore.getState().setCurrentUser({ id: 'drv1', name: 'Alex' });
      useAppStore.getState().setCompany('comp1', 'Alpha', false);
      useAppStore.getState().closeModal('expenseLedger');
    });
    await rerender(<ExpenseLedgerModal />);
    await act(async () => {
      useAppStore.getState().openModal('expenseLedger');
    });
    await rerender(<ExpenseLedgerModal />);
    await flushPromises();

    expect(container.textContent).not.toContain('TxTag');
    const delBtn = container.querySelector('button[title="Delete submitted expense"]');
    await click(delBtn);
    await flushPromises();
    expect(storageDeleteObject).toHaveBeenCalledTimes(1);
    expect(mockFs.getRawDoc('companies/comp1/jobs/job1/expenses/e3')).toBeUndefined();

    await unmount();
  });
});
