import { describe, it, expect, beforeEach, vi } from 'vitest';

const { hoistedState, httpsCallableMock, mockInteractionsCreate, mockGoogleGenAI } = vi.hoisted(() => {
  const interactionsCreate = vi.fn();
  const GoogleGenAI = vi.fn(function makeGenAI() {
    return { interactions: { create: interactionsCreate } };
  });
  return {
    hoistedState: { mockFs: null },
    httpsCallableMock: vi.fn(),
    mockInteractionsCreate: interactionsCreate,
    mockGoogleGenAI: GoogleGenAI,
  };
});

vi.mock('firebase/firestore', async () => {
  const { createFirestoreMock } = await import('./helpers/firebaseMock');
  hoistedState.mockFs = hoistedState.mockFs || createFirestoreMock();
  return hoistedState.mockFs.firestoreModule;
});
vi.mock('firebase/functions', () => ({
  httpsCallable: httpsCallableMock,
}));
vi.mock('../src/firebase', async () => {
  const { createFirestoreMock } = await import('./helpers/firebaseMock');
  hoistedState.mockFs = hoistedState.mockFs || createFirestoreMock();
  return {
    db: hoistedState.mockFs.db,
    functions: { __type: 'mockFunctions' },
  };
});
vi.mock('@google/genai', () => ({
  GoogleGenAI: mockGoogleGenAI,
}));

import { hashCompanyPassword, hashPassword } from '../src/utils/crypto';
import { decodeGeohashBounds, encodeGeohash } from '../src/utils/geohash';
import {
  buildCustomerTrackingUrl,
  buildPublicTrackingPayload,
  ensurePublicTrackingLink,
  generateTrackingToken,
  revokePublicTrackingLink,
  syncPublicTrackingJobUpdate,
} from '../src/utils/publicTracking';
import { scanReceiptWithGemini } from '../src/utils/receiptOcr';

describe('crypto, geohash, publicTracking, and receiptOcr', () => {
  const mockFs = hoistedState.mockFs;
  beforeEach(() => {
    mockFs.reset();
    httpsCallableMock.mockReset();
    mockInteractionsCreate.mockReset();
    mockGoogleGenAI.mockClear();
  });

  describe('crypto', () => {
    it('computes NIST SHA-256 vectors via Web Crypto and matches pure-JS sha256Fallback', async () => {
      const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

      expect(await hashPassword('')).toBe(EMPTY_SHA256);
      expect(await hashPassword('abc')).toBe(ABC_SHA256);

      const origDescriptor = Object.getOwnPropertyDescriptor(window, 'crypto');
      Object.defineProperty(window, 'crypto', { configurable: true, value: undefined });
      try {
        expect(await hashPassword('')).toBe(EMPTY_SHA256);
        expect(await hashPassword('abc')).toBe(ABC_SHA256);
        const c1 = await hashCompanyPassword('compA', 'secret');
        const c2 = await hashCompanyPassword('compB', 'secret');
        expect(c1).toHaveLength(64);
        expect(c1).not.toBe(c2);
      } finally {
        if (origDescriptor) {
          Object.defineProperty(window, 'crypto', origDescriptor);
        }
      }
    });
  });

  describe('geohash', () => {
    it('encodes and decodes coordinates across all four hemispheres within precision bounds', () => {
      const coords = [
        [30.2672, -97.7431],
        [-33.8688, 151.2093],
        [51.5074, -0.1278],
        [-23.5505, -46.6333],
      ];
      for (const [lat, lng] of coords) {
        for (const precision of [5, 7, 9]) {
          const hash = encodeGeohash(lat, lng, precision);
          expect(hash).toHaveLength(precision);
          const bounds = decodeGeohashBounds(hash);
          expect(lat).toBeGreaterThanOrEqual(bounds.latMin);
          expect(lat).toBeLessThanOrEqual(bounds.latMax);
          expect(lng).toBeGreaterThanOrEqual(bounds.lngMin);
          expect(lng).toBeLessThanOrEqual(bounds.lngMax);
        }
      }
      const fallbackBounds = decodeGeohashBounds('9v!6');
      expect(fallbackBounds.latMax).toBeGreaterThan(fallbackBounds.latMin);
    });
  });

  describe('publicTracking', () => {
    it('generates 32-char hex tokens, builds tracking URLs, and sanitizes payloads', () => {
      const token = generateTrackingToken();
      expect(token).toMatch(/^[0-9a-f]{32}$/);
      expect(buildCustomerTrackingUrl(token)).toContain(`?track=${token}`);
      expect(buildCustomerTrackingUrl('')).toBe('');

      const activePayload = buildPublicTrackingPayload({
        companyId: 'comp1',
        companyName: 'VECTO Alpha',
        job: {
          id: 'job1',
          jobName: 'Austin Run',
          status: 'in-progress',
          origin: 'Warehouse 1',
          contactNumber: '555-SECRET',
          assignedDrivers: [{ id: 'drv1', name: 'Alex Rivera' }],
          stops: [{ id: 's1', address: '100 Congress Ave', lat: 30.26, lng: -97.74, status: 'pending' }],
        },
        driverLocation: { latitude: 30.25, longitude: -97.75 },
        heading: 90,
        speed: 45,
        routeInfo: { jobId: 'job1', duration: '12m', distance: '4.5 mi', destinationCoords: { lat: 30.26, lng: -97.74 } },
      });

      expect(activePayload.driverFirstName).toBe('Alex');
      expect(activePayload.contactNumber).toBeUndefined();
      expect(activePayload.driverLocation).toEqual({ lat: 30.25, lng: -97.75 });
      expect(activePayload.etaText).toBe('12m');
      expect(activePayload.expiresAt).toBeNull();

      const terminalPayload = buildPublicTrackingPayload({
        companyId: 'comp1',
        companyName: 'VECTO Alpha',
        job: { id: 'job1', status: 'completed', origin: 'Warehouse 1', destination: 'Drop' },
        driverLocation: { lat: 30.25, lng: -97.75 },
      });
      expect(terminalPayload.driverLocation).toBeNull();
      expect(terminalPayload.expiresAt).not.toBeNull();
      expect(terminalPayload.etaText).toBeNull();
    });

    it('creates, reuses, syncs, and revokes public tracking links in Firestore', async () => {
      const job = {
        id: 'job1',
        jobName: 'Morning Delivery',
        status: 'assigned',
        origin: 'Origin',
        destination: 'Dest',
      };
      mockFs.seedDoc('companies/comp1/jobs/job1', job);

      const created = await ensurePublicTrackingLink({ db: mockFs.db, companyId: 'comp1', companyName: 'VECTO', job });
      expect(created.token).toHaveLength(32);
      expect(mockFs.getRawDoc(`public_tracking/${created.token}`).jobId).toBe('job1');
      expect(mockFs.getRawDoc('companies/comp1/jobs/job1').trackingToken).toBe(created.token);

      const reused = await ensurePublicTrackingLink({
        db: mockFs.db,
        companyId: 'comp1',
        companyName: 'VECTO',
        job: { ...job, trackingToken: created.token },
      });
      expect(reused.token).toBe(created.token);

      await syncPublicTrackingJobUpdate({
        db: mockFs.db,
        companyId: 'comp1',
        companyName: 'VECTO',
        job: { ...job, trackingToken: created.token, status: 'in-progress' },
        driverLocation: { lat: 30.2, lng: -97.7 },
      });
      expect(mockFs.getRawDoc(`public_tracking/${created.token}`).status).toBe('in-progress');

      await revokePublicTrackingLink({
        db: mockFs.db,
        companyId: 'comp1',
        job: { ...job, trackingToken: created.token },
      });
      expect(mockFs.getRawDoc(`public_tracking/${created.token}`).revoked).toBe(true);
      expect(mockFs.getRawDoc(`public_tracking/${created.token}`).driverLocation).toBeNull();
      expect(mockFs.getRawDoc('companies/comp1/jobs/job1').trackingToken).toBeNull();
    });
  });

  describe('receiptOcr', () => {
    it('rejects missing files and normalizes server-side Cloud Function OCR responses', async () => {
      await expect(scanReceiptWithGemini(null)).rejects.toThrow('No receipt file selected');

      const callable = vi.fn().mockResolvedValue({
        data: {
          merchant: '  Pilot #402  ',
          amount: '64.50',
          category: 'fuel',
          date: '2026-11-18',
          summary: '18 gal diesel',
        },
      });
      httpsCallableMock.mockReturnValue(callable);

      const file = new File(['fake-jpg'], 'receipt.jpg', { type: 'image/jpeg' });
      const result = await scanReceiptWithGemini(file);
      expect(result).toMatchObject({
        merchant: 'Pilot #402',
        amount: 64.5,
        category: 'fuel',
        date: '2026-11-18',
        summary: '18 gal diesel',
      });

      httpsCallableMock.mockReturnValue(
        vi.fn().mockRejectedValue({ code: 'functions/unauthenticated', message: 'Sign in required' })
      );
      await expect(scanReceiptWithGemini(file)).rejects.toThrow('Sign in required');
    });

    it('falls back to local Gemini dev key for PDF and image files when Cloud Function fails', async () => {
      httpsCallableMock.mockReturnValue(vi.fn().mockRejectedValue(new Error('network error')));
      mockInteractionsCreate.mockResolvedValue({
        output_text: '```json\n{"merchant":"Love\'s","amount":120.25,"category":"invalid_cat","date":"2026-11-18","summary":"Diesel fill"}\n```',
      });

      const pdfFile = new File(['%PDF-1.4'], 'toll.pdf', { type: 'application/pdf' });
      const result = await scanReceiptWithGemini(pdfFile, 'dev-gemini-key');
      expect(mockGoogleGenAI).toHaveBeenCalledWith({ apiKey: 'dev-gemini-key' });
      expect(mockInteractionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemini-3.8-flash',
          input: expect.arrayContaining([
            expect.objectContaining({ type: 'document', mime_type: 'application/pdf' }),
          ]),
        })
      );
      expect(result.category).toBe('custom');
      expect(result.amount).toBe(120.25);
    });
  });
});
