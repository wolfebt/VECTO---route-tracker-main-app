// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const {
  secretState,
  sendEachForMulticastMock,
  createInteractionMock,
  adminStore,
  FieldValueMock,
  TimestampMock,
  HttpsErrorMock,
} = vi.hoisted(() => {
  const store = new Map();

  function cloneVal(v) {
    if (v === null || v === undefined || typeof v !== 'object') return v;
    if (v instanceof Date) return new Date(v.getTime());
    if (Array.isArray(v)) return v.map(cloneVal);
    if (typeof v.toMillis === 'function') return v;
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = cloneVal(val);
    }
    return out;
  }

  function applyFieldSentinels(target, patch) {
    for (const [k, v] of Object.entries(patch)) {
      if (v && typeof v === 'object' && v.__sentinel === 'delete') {
        delete target[k];
      } else if (v && typeof v === 'object' && v.__sentinel === 'serverTimestamp') {
        target[k] = new Date(1700000000000);
      } else if (v && typeof v === 'object' && v.__sentinel === 'arrayRemove') {
        const cur = Array.isArray(target[k]) ? target[k] : [];
        target[k] = cur.filter((item) => !v.elements.includes(item));
      } else {
        target[k] = cloneVal(v);
      }
    }
  }

  function toComparable(v) {
    if (v && typeof v.toMillis === 'function') return v.toMillis();
    if (v instanceof Date) return v.getTime();
    return v;
  }

  function makeDocRef(docPath) {
    const clean = docPath.replace(/^\/+|\/+$/g, '');
    const parts = clean.split('/');
    const id = parts[parts.length - 1];
    return {
      id,
      path: clean,
      collection(sub) {
        return makeCollectionRef(`${clean}/${sub}`);
      },
      async get() {
        const raw = store.get(clean);
        return {
          exists: raw !== undefined,
          id,
          ref: this,
          data: () => (raw === undefined ? undefined : cloneVal(raw)),
        };
      },
      async set(data, opts) {
        const base = opts?.merge && store.has(clean) ? cloneVal(store.get(clean)) : {};
        applyFieldSentinels(base, data);
        store.set(clean, base);
      },
      async update(patch) {
        const cur = cloneVal(store.get(clean) || {});
        applyFieldSentinels(cur, patch);
        store.set(clean, cur);
      },
      async delete() {
        store.delete(clean);
      },
    };
  }

  function runQuery({ colPath, groupName, filters = [], maxLimit = Infinity }) {
    const matches = [];
    for (const [docPath, raw] of store.entries()) {
      const segs = docPath.split('/');
      if (colPath) {
        const colSegs = colPath.split('/');
        if (segs.length !== colSegs.length + 1) continue;
        if (!docPath.startsWith(`${colPath}/`)) continue;
      }
      if (groupName) {
        if (segs.length < 2 || segs[segs.length - 2] !== groupName) continue;
      }

      const pass = filters.every(({ field, op, value }) => {
        const lhs = toComparable(raw[field]);
        const rhs = toComparable(value);
        if (op === '<') return lhs < rhs;
        if (op === '<=') return lhs <= rhs;
        if (op === '>') return lhs > rhs;
        if (op === '>=') return lhs >= rhs;
        if (op === '==') return lhs === rhs;
        return false;
      });
      if (!pass) continue;

      const ref = makeDocRef(docPath);
      matches.push({
        exists: true,
        id: ref.id,
        ref,
        data: () => cloneVal(raw),
      });
      if (matches.length >= maxLimit) break;
    }

    return {
      empty: matches.length === 0,
      size: matches.length,
      docs: matches,
      forEach(cb) {
        matches.forEach(cb);
      },
    };
  }

  function makeQuery(state) {
    return {
      where(field, op, value) {
        return makeQuery({ ...state, filters: [...(state.filters || []), { field, op, value }] });
      },
      limit(n) {
        return makeQuery({ ...state, maxLimit: n });
      },
      async get() {
        return runQuery(state);
      },
    };
  }

  function makeCollectionRef(colPath) {
    const clean = colPath.replace(/^\/+|\/+$/g, '');
    return {
      path: clean,
      doc(id) {
        return makeDocRef(`${clean}/${id}`);
      },
      where(field, op, value) {
        return makeQuery({ colPath: clean, filters: [{ field, op, value }] });
      },
      limit(n) {
        return makeQuery({ colPath: clean, filters: [], maxLimit: n });
      },
      async get() {
        return runQuery({ colPath: clean });
      },
    };
  }

  const FieldValue = {
    arrayRemove: (...elements) => ({ __sentinel: 'arrayRemove', elements }),
    delete: () => ({ __sentinel: 'delete' }),
    serverTimestamp: () => ({ __sentinel: 'serverTimestamp' }),
  };

  class Timestamp {
    constructor(ms) {
      this._ms = ms;
      this.seconds = Math.floor(ms / 1000);
      this.nanoseconds = (ms % 1000) * 1e6;
    }
    toMillis() {
      return this._ms;
    }
    static now() {
      return new Timestamp(Date.now());
    }
    static fromMillis(ms) {
      return new Timestamp(ms);
    }
  }

  class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  return {
    secretState: { GEMINI_API_KEY: 'secret-gemini-key' },
    sendEachForMulticastMock: vi.fn(),
    createInteractionMock: vi.fn(),
    adminStore: {
      store,
      seed(docPath, data) {
        store.set(docPath, cloneVal(data));
      },
      getRaw(docPath) {
        return store.get(docPath);
      },
      reset() {
        store.clear();
      },
      db: {
        doc: (p) => makeDocRef(p),
        collection: (p) => makeCollectionRef(p),
        collectionGroup: (groupName) => makeQuery({ groupName }),
        batch() {
          const ops = [];
          return {
            delete(ref) {
              ops.push({ type: 'delete', ref });
            },
            set(ref, data, opts) {
              ops.push({ type: 'set', ref, data, opts });
            },
            update(ref, patch) {
              ops.push({ type: 'update', ref, patch });
            },
            async commit() {
              for (const op of ops) {
                if (op.type === 'delete') await op.ref.delete();
                if (op.type === 'set') await op.ref.set(op.data, op.opts);
                if (op.type === 'update') await op.ref.update(op.patch);
              }
            },
          };
        },
      },
    },
    FieldValueMock: FieldValue,
    TimestampMock: Timestamp,
    HttpsErrorMock: HttpsError,
  };
});

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
}));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => adminStore.db,
  FieldValue: FieldValueMock,
  Timestamp: TimestampMock,
}));
vi.mock('firebase-admin/messaging', () => ({
  getMessaging: () => ({
    sendEachForMulticast: sendEachForMulticastMock,
  }),
}));
vi.mock('firebase-functions/params', () => ({
  defineSecret: (name) => ({
    name,
    value: () => secretState[name] ?? '',
  }),
}));
vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentWritten: (_path, handler) => handler,
  onDocumentCreated: (_path, handler) => handler,
}));
vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_opts, handler) => handler,
  HttpsError: HttpsErrorMock,
}));
vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: (_schedule, handler) => handler,
}));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class MockGoogleGenAI {
    constructor(opts) {
      this.apiKey = opts?.apiKey;
      this.interactions = {
        create: (...args) => createInteractionMock(...args),
      };
    }
  },
}));

import {
  onJobDispatchEvent,
  onJobChatCreated,
  scanReceiptOcr,
  cleanupStaleFleetData,
  syncCompanyDirectory,
} from '../../functions/index.js';

function makeEventSnap(data) {
  return {
    exists: data !== null && data !== undefined,
    data: () => data,
  };
}

describe('Cloud Functions v2 (functions/index.js)', () => {
  const originalEnvKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    adminStore.reset();
    secretState.GEMINI_API_KEY = 'secret-gemini-key';
    delete process.env.GEMINI_API_KEY;
    sendEachForMulticastMock.mockReset().mockImplementation(async (msg) => ({
      successCount: msg.tokens.length,
      failureCount: 0,
      responses: msg.tokens.map(() => ({ success: true })),
    }));
    createInteractionMock.mockReset();
  });

  afterEach(() => {
    if (originalEnvKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalEnvKey;
    }
  });

  describe('onJobDispatchEvent', () => {
    it('ignores deleted, archived, or cancelled jobs', async () => {
      adminStore.seed('users/drv1', { fcmTokens: ['tok-1'] });

      await onJobDispatchEvent({
        params: { companyId: 'comp1', jobId: 'job1' },
        data: { before: makeEventSnap({ assignedDrivers: [] }), after: makeEventSnap(null) },
      });
      await onJobDispatchEvent({
        params: { companyId: 'comp1', jobId: 'job2' },
        data: {
          before: makeEventSnap(null),
          after: makeEventSnap({ assignedDrivers: [{ id: 'drv1', name: 'Alex' }], archived: true }),
        },
      });
      await onJobDispatchEvent({
        params: { companyId: 'comp1', jobId: 'job3' },
        data: {
          before: makeEventSnap(null),
          after: makeEventSnap({ assignedDrivers: [{ id: 'drv1', name: 'Alex' }], status: 'cancelled' }),
        },
      });

      expect(sendEachForMulticastMock).not.toHaveBeenCalled();
    });

    it('notifies newly assigned drivers, respects disabled prefs, chunks >500 tokens, and prunes dead tokens', async () => {
      const bulkTokens = Array.from({ length: 502 }, (_, idx) => `bulk-${idx}`);
      adminStore.seed('users/drv1', {
        fcmToken: 'tok-primary-dead',
        fcmTokens: ['tok-primary-dead', 'tok-valid', 'tok-invalid'],
      });
      adminStore.seed('users/drv2', {
        fcmTokens: ['tok-muted'],
        preferences: { notificationsEnabled: false },
      });
      adminStore.seed('users/drv3', {
        fcmTokens: bulkTokens,
      });

      sendEachForMulticastMock.mockImplementation(async (msg) => ({
        responses: msg.tokens.map((tok) => {
          if (tok === 'tok-primary-dead') {
            return { success: false, error: { code: 'messaging/registration-token-not-registered' } };
          }
          if (tok === 'tok-invalid') {
            return { success: false, error: { code: 'messaging/invalid-registration-token' } };
          }
          return { success: true };
        }),
      }));

      await onJobDispatchEvent({
        params: { companyId: 'comp1', jobId: 'job10' },
        data: {
          before: makeEventSnap({ assignedDrivers: [], status: 'unassigned' }),
          after: makeEventSnap({
            jobName: 'Hospital Oxygen Run',
            origin: 'Depot A',
            status: 'assigned',
            assignedDrivers: [
              { id: 'drv1', name: 'Alex' },
              { id: 'drv2', name: 'Sam' },
              { id: 'drv3', name: 'Pat' },
            ],
          }),
        },
      });

      // drv1 has 3 unique tokens + drv3 has 502 unique tokens = 505 tokens -> 2 multicast chunks (500 + 5)
      expect(sendEachForMulticastMock).toHaveBeenCalledTimes(2);
      const firstCall = sendEachForMulticastMock.mock.calls[0][0];
      const secondCall = sendEachForMulticastMock.mock.calls[1][0];
      expect(firstCall.tokens).toHaveLength(500);
      expect(secondCall.tokens).toHaveLength(5);
      expect(firstCall.notification).toEqual({
        title: 'New Job Assigned',
        body: 'Hospital Oxygen Run — From: Depot A',
      });
      expect(firstCall.data).toMatchObject({
        companyId: 'comp1',
        jobId: 'job10',
        type: 'job_assigned',
      });

      const updatedDrv1 = adminStore.getRaw('users/drv1');
      expect(updatedDrv1.fcmToken).toBeUndefined();
      expect(updatedDrv1.fcmTokens).toEqual(['tok-valid']);
    });

    it('notifies dispatchers on pending-completion and notifies targeted drivers on new priority instructions', async () => {
      adminStore.seed('companies/comp1', { name: 'Alpha Fleet', createdBy: 'owner1' });
      adminStore.seed('companies/comp1/members/disp1', { permissions: { canCreateJob: true } });
      adminStore.seed('companies/comp1/members/mgr1', { permissions: { canManageDrivers: true } });
      adminStore.seed('companies/comp1/members/drv1', { permissions: { canCreateJob: false } });
      adminStore.seed('users/owner1', { fcmTokens: ['tok-owner'] });
      adminStore.seed('users/disp1', { fcmTokens: ['tok-disp'] });
      adminStore.seed('users/mgr1', { fcmTokens: ['tok-mgr'] });
      adminStore.seed('users/drv1', { fcmTokens: ['tok-drv1'] });
      adminStore.seed('users/drv2', { fcmTokens: ['tok-drv2'] });

      await onJobDispatchEvent({
        params: { companyId: 'comp1', jobId: 'job22' },
        data: {
          before: makeEventSnap({
            jobName: 'North Route',
            status: 'in-progress',
            assignedDrivers: [
              { id: 'drv1', name: 'Alex' },
              { id: 'drv2', name: 'Sam' },
            ],
            instructions: [{ id: 'i1', text: 'Existing note', isPriority: true, target: 'all' }],
          }),
          after: makeEventSnap({
            jobName: 'North Route',
            status: 'pending-completion',
            assignedDrivers: [
              { id: 'drv1', name: 'Alex' },
              { id: 'drv2', name: 'Sam' },
            ],
            instructions: [
              { id: 'i1', text: 'Existing note', isPriority: true, target: 'all' },
              { id: 'i2', text: 'Gate code 4499', isPriority: true, target: 'drv2' },
            ],
          }),
        },
      });

      expect(sendEachForMulticastMock).toHaveBeenCalledTimes(2);
      const pendingCall = sendEachForMulticastMock.mock.calls.find(
        ([m]) => m.data.type === 'pending_completion'
      )[0];
      expect(pendingCall.notification.title).toBe('Job Pending Review');
      expect(pendingCall.tokens.sort()).toEqual(['tok-disp', 'tok-mgr', 'tok-owner']);

      const priorityCall = sendEachForMulticastMock.mock.calls.find(
        ([m]) => m.data.type === 'priority_instruction'
      )[0];
      expect(priorityCall.notification).toEqual({
        title: 'Priority Note: North Route',
        body: 'Gate code 4499',
      });
      expect(priorityCall.tokens).toEqual(['tok-drv2']);
    });
  });

  describe('onJobChatCreated', () => {
    it('notifies job drivers and dispatchers except sender and uses attachment fallback', async () => {
      adminStore.seed('companies/comp1', { name: 'Alpha Fleet', createdBy: 'owner1' });
      adminStore.seed('companies/comp1/jobs/job1', {
        jobName: 'Port Transfer',
        assignedDrivers: [
          { id: 'drv1', name: 'Alex' },
          { id: 'drv2', name: 'Sam' },
        ],
      });
      adminStore.seed('users/owner1', { fcmTokens: ['tok-owner'] });
      adminStore.seed('users/drv1', { fcmTokens: ['tok-drv1'] });
      adminStore.seed('users/drv2', { fcmTokens: ['tok-drv2'] });

      await onJobChatCreated({
        params: { companyId: 'comp1', jobId: 'job1', chatId: 'c1' },
        data: makeEventSnap({ senderId: 'drv1', senderName: 'Alex', text: '' }),
      });

      expect(sendEachForMulticastMock).toHaveBeenCalledTimes(1);
      const msg = sendEachForMulticastMock.mock.calls[0][0];
      expect(msg.tokens.sort()).toEqual(['tok-drv2', 'tok-owner']);
      expect(msg.notification).toEqual({
        title: 'New Message: Port Transfer',
        body: 'Alex: Sent an image attachment',
      });
      expect(msg.data.type).toBe('job_chat');
    });

    it('skips notifications for archived jobs', async () => {
      adminStore.seed('companies/comp1/jobs/jobArch', {
        jobName: 'Old Job',
        assignedDrivers: [{ id: 'drv1', name: 'Alex' }],
        archived: true,
      });
      adminStore.seed('users/drv1', { fcmTokens: ['tok-drv1'] });

      await onJobChatCreated({
        params: { companyId: 'comp1', jobId: 'jobArch', chatId: 'c2' },
        data: makeEventSnap({ senderId: 'owner1', senderName: 'Dispatch', text: 'Ping' }),
      });

      expect(sendEachForMulticastMock).not.toHaveBeenCalled();
    });
  });

  describe('scanReceiptOcr', () => {
    it('enforces auth, payload bounds, MIME whitelist, and GEMINI_API_KEY configuration', async () => {
      await expect(scanReceiptOcr({ auth: null, data: { base64Data: 'abc' } })).rejects.toMatchObject({
        code: 'unauthenticated',
      });

      await expect(scanReceiptOcr({ auth: { uid: 'u1' }, data: { base64Data: '' } })).rejects.toMatchObject({
        code: 'invalid-argument',
      });

      await expect(
        scanReceiptOcr({
          auth: { uid: 'u1' },
          data: { base64Data: 'abc', mimeType: 'application/x-msdownload' },
        })
      ).rejects.toMatchObject({ code: 'invalid-argument' });

      secretState.GEMINI_API_KEY = '';
      await expect(
        scanReceiptOcr({
          auth: { uid: 'u1' },
          data: { base64Data: 'abc', mimeType: 'image/png' },
        })
      ).rejects.toMatchObject({ code: 'failed-precondition' });
    });

    it('calls Gemini 3.8 Flash Interactions API for images and PDFs, normalizes fences, and clamps invalid fields', async () => {
      createInteractionMock.mockResolvedValueOnce({
        output_text:
          '```json\n{"merchant":"Pilot Travel","amount":84.5,"category":"fuel","date":"2026-11-18","summary":"24 gal diesel"}\n```',
      });

      const imgRes = await scanReceiptOcr({
        auth: { uid: 'u1' },
        data: { base64Data: 'RkFLRV9QTkc=', mimeType: 'image/jpeg' },
      });

      expect(createInteractionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemini-3.8-flash',
          store: false,
          input: expect.arrayContaining([
            expect.objectContaining({ type: 'image', mime_type: 'image/jpeg', data: 'RkFLRV9QTkc=' }),
          ]),
        })
      );
      expect(imgRes).toMatchObject({
        merchant: 'Pilot Travel',
        amount: 84.5,
        category: 'fuel',
        date: '2026-11-18',
        summary: '24 gal diesel',
        model: 'gemini-3.8-flash',
      });
      expect(typeof imgRes.extractedAt).toBe('number');

      createInteractionMock.mockResolvedValueOnce({
        outputs: [
          {
            type: 'text',
            text: JSON.stringify({
              merchant: 'Toll plaza',
              amount: -12,
              category: 'unknown-cat',
              date: '2026-11-19',
              summary: 'Bridge toll',
            }),
          },
        ],
      });

      const pdfRes = await scanReceiptOcr({
        auth: { uid: 'u1' },
        data: { base64Data: 'JVBERi0=', mimeType: 'application/pdf' },
      });
      expect(createInteractionMock.mock.calls[1][0].input[1]).toEqual({
        type: 'document',
        data: 'JVBERi0=',
        mime_type: 'application/pdf',
      });
      expect(pdfRes).toMatchObject({
        merchant: 'Toll plaza',
        amount: 0,
        category: 'custom',
        date: '2026-11-19',
        summary: 'Bridge toll',
        model: 'gemini-3.8-flash',
      });
    });
  });

  describe('cleanupStaleFleetData & syncCompanyDirectory', () => {
    it('deletes active_drivers older than 12 hours and expired public_tracking tokens while preserving active records', async () => {
      const now = Date.now();
      const thirteenHoursAgo = now - 13 * 60 * 60 * 1000;
      const oneHourAgo = now - 60 * 60 * 1000;

      adminStore.seed('companies/c1/active_drivers/oldDrv', { timestamp: thirteenHoursAgo });
      adminStore.seed('companies/c1/active_drivers/freshDrv', { timestamp: oneHourAgo });
      adminStore.seed('public_tracking/expiredTok', {
        expiresAt: TimestampMock.fromMillis(now - 5000),
      });
      adminStore.seed('public_tracking/liveTok', {
        expiresAt: TimestampMock.fromMillis(now + 600000),
      });

      await cleanupStaleFleetData({});

      expect(adminStore.getRaw('companies/c1/active_drivers/oldDrv')).toBeUndefined();
      expect(adminStore.getRaw('companies/c1/active_drivers/freshDrv')).toBeDefined();
      expect(adminStore.getRaw('public_tracking/expiredTok')).toBeUndefined();
      expect(adminStore.getRaw('public_tracking/liveTok')).toBeDefined();
    });

    it('mirrors company metadata into company_directory and deletes entry when company is deleted', async () => {
      const longName = 'A'.repeat(150);
      await syncCompanyDirectory({
        params: { companyId: 'comp99' },
        data: {
          before: makeEventSnap(null),
          after: makeEventSnap({ name: longName, requirePassword: true, createdBy: 'u9' }),
        },
      });

      const mirrored = adminStore.getRaw('company_directory/comp99');
      expect(mirrored.name).toHaveLength(120);
      expect(mirrored.requirePassword).toBe(true);
      expect(mirrored.createdBy).toBe('u9');

      await syncCompanyDirectory({
        params: { companyId: 'comp99' },
        data: {
          before: makeEventSnap({ name: longName }),
          after: makeEventSnap(null),
        },
      });
      expect(adminStore.getRaw('company_directory/comp99')).toBeUndefined();
    });
  });
});
