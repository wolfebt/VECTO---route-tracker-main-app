import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { onDocumentWritten, onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { GoogleGenAI } from '@google/genai';

initializeApp();

const db = getFirestore();
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

const EXPENSE_CATEGORIES = ['fuel', 'food', 'toll', 'maintenance', 'lodging', 'custom'];
const ALLOWED_OCR_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
]);
const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

const RECEIPT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    merchant: {
      type: 'string',
      description: 'Store, station, vendor, or business name on the receipt.',
    },
    amount: {
      type: 'number',
      description: 'Grand total amount paid in USD (numeric value only).',
    },
    category: {
      type: 'string',
      enum: EXPENSE_CATEGORIES,
      description: 'Best matching fleet expense category.',
    },
    date: {
      type: 'string',
      description: 'Transaction date in YYYY-MM-DD format if clearly visible, otherwise empty string.',
    },
    summary: {
      type: 'string',
      description: 'Concise 1-line description of items or fuel quantity purchased.',
    },
  },
  required: ['merchant', 'amount', 'category', 'summary'],
};

function extractOutputText(interaction) {
  if (interaction?.output_text) return interaction.output_text;
  if (Array.isArray(interaction?.outputs)) {
    const textPart = interaction.outputs.find((o) => o?.type === 'text' && o?.text);
    if (textPart?.text) return textPart.text;
  }
  return '';
}

async function getCompanyDispatcherIds(companyId) {
  const dispatcherIds = new Set();
  const [companySnap, membersSnap] = await Promise.all([
    db.collection('companies').doc(companyId).get(),
    db.collection('companies').doc(companyId).collection('members').get(),
  ]);

  if (companySnap.exists) {
    const createdBy = companySnap.data()?.createdBy;
    if (createdBy) dispatcherIds.add(String(createdBy));
  }

  membersSnap.forEach((docSnap) => {
    const perms = docSnap.data()?.permissions || {};
    if (perms.canCreateJob === true || perms.canManageDrivers === true) {
      dispatcherIds.add(docSnap.id);
    }
  });

  return Array.from(dispatcherIds);
}

async function sendDispatchPush({ userIds = [], excludeUid = null, title, body, jobId = '', companyId = '', eventType = 'dispatch' }) {
  const uniqueIds = Array.from(new Set(userIds.filter((uid) => typeof uid === 'string' && uid && uid !== excludeUid)));
  if (uniqueIds.length === 0) return;

  const userSnaps = await Promise.all(uniqueIds.map((uid) => db.collection('users').doc(uid).get()));

  const tokenToOwners = new Map();
  const primaryTokenOwners = new Map();

  for (const snap of userSnaps) {
    if (!snap.exists) continue;
    const data = snap.data() || {};
    if (data.preferences?.notificationsEnabled === false) continue;

    const candidateTokens = new Set();
    if (Array.isArray(data.fcmTokens)) {
      data.fcmTokens.forEach((t) => {
        if (typeof t === 'string' && t.trim()) candidateTokens.add(t.trim());
      });
    }
    if (typeof data.fcmToken === 'string' && data.fcmToken.trim()) {
      const single = data.fcmToken.trim();
      candidateTokens.add(single);
      if (!primaryTokenOwners.has(single)) primaryTokenOwners.set(single, new Set());
      primaryTokenOwners.get(single).add(snap.id);
    }

    candidateTokens.forEach((tok) => {
      if (!tokenToOwners.has(tok)) tokenToOwners.set(tok, new Set());
      tokenToOwners.get(tok).add(snap.id);
    });
  }

  const allTokens = Array.from(tokenToOwners.keys());
  if (allTokens.length === 0) return;

  const messaging = getMessaging();
  const staleByUid = new Map();

  for (let i = 0; i < allTokens.length; i += 500) {
    const batchTokens = allTokens.slice(i, i + 500);
    const res = await messaging.sendEachForMulticast({
      tokens: batchTokens,
      notification: {
        title: String(title || 'Vecto Dispatch').slice(0, 120),
        body: String(body || '').slice(0, 240),
      },
      data: {
        jobId: String(jobId || ''),
        companyId: String(companyId || ''),
        type: String(eventType || 'dispatch'),
      },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
          },
        },
      },
    });

    res.responses.forEach((resp, idx) => {
      if (resp.success) return;
      const errCode = resp.error?.code;
      if (!INVALID_TOKEN_CODES.has(errCode)) return;

      const badToken = batchTokens[idx];
      const owners = tokenToOwners.get(badToken);
      if (!owners) return;
      owners.forEach((uid) => {
        if (!staleByUid.has(uid)) staleByUid.set(uid, { arrayTokens: [], clearPrimary: false });
        staleByUid.get(uid).arrayTokens.push(badToken);
        if (primaryTokenOwners.get(badToken)?.has(uid)) {
          staleByUid.get(uid).clearPrimary = true;
        }
      });
    });
  }

  if (staleByUid.size > 0) {
    await Promise.all(
      Array.from(staleByUid.entries()).map(([uid, info]) => {
        const updates = {
          fcmTokens: FieldValue.arrayRemove(...info.arrayTokens),
        };
        if (info.clearPrimary) {
          updates.fcmToken = FieldValue.delete();
        }
        return db.collection('users').doc(uid).update(updates).catch(() => {});
      })
    );
  }
}

/**
 * 1. Closed-app push alerts for job assignments, pending-completion review, and priority instructions.
 */
export const onJobDispatchEvent = onDocumentWritten('companies/{companyId}/jobs/{jobId}', async (event) => {
  if (!event.data?.after?.exists) return;

  const { companyId, jobId } = event.params;
  const before = event.data.before?.exists ? event.data.before.data() : null;
  const after = event.data.after.data() || {};

  if (after.archived === true || after.status === 'cancelled') return;

  const jobName = String(after.jobName || 'Unnamed Job').trim();
  const origin = String(after.origin || '').trim();

  const beforeAssignedIds = new Set(
    (Array.isArray(before?.assignedDrivers) ? before.assignedDrivers : [])
      .map((d) => d?.id)
      .filter(Boolean)
  );
  const afterAssignedIds = (Array.isArray(after.assignedDrivers) ? after.assignedDrivers : [])
    .map((d) => d?.id)
    .filter(Boolean);

  // A. Newly assigned drivers
  const newlyAssignedIds = afterAssignedIds.filter((id) => !beforeAssignedIds.has(id));
  if (newlyAssignedIds.length > 0 && after.status !== 'completed') {
    const body = origin ? `${jobName} — From: ${origin}` : jobName;
    await sendDispatchPush({
      userIds: newlyAssignedIds,
      title: 'New Job Assigned',
      body,
      jobId,
      companyId,
      eventType: 'job_assigned',
    });
  }

  // B. Driver requested completion -> notify dispatchers
  if (before?.status !== 'pending-completion' && after.status === 'pending-completion') {
    const dispatcherIds = await getCompanyDispatcherIds(companyId);
    await sendDispatchPush({
      userIds: dispatcherIds,
      title: 'Job Pending Review',
      body: `${jobName} is awaiting dispatch verification`,
      jobId,
      companyId,
      eventType: 'pending_completion',
    });
  }

  // C. Newly added priority dispatch instruction
  const beforePriorityKeys = new Set();
  if (Array.isArray(before?.instructions)) {
    before.instructions.forEach((inst, idx) => {
      if (inst?.isPriority) {
        beforePriorityKeys.add(inst.id || `${idx}:${inst.text || ''}`);
      }
    });
  }

  const newPriorityInstructions = [];
  if (Array.isArray(after.instructions)) {
    after.instructions.forEach((inst, idx) => {
      if (!inst?.isPriority) return;
      const key = inst.id || `${idx}:${inst.text || ''}`;
      if (!beforePriorityKeys.has(key)) {
        newPriorityInstructions.push(inst);
      }
    });
  }

  if (newPriorityInstructions.length > 0 && afterAssignedIds.length > 0) {
    const targetIds = new Set();
    newPriorityInstructions.forEach((inst) => {
      if (!inst.target || inst.target === 'all') {
        afterAssignedIds.forEach((id) => targetIds.add(id));
      } else {
        targetIds.add(inst.target);
      }
    });

    const firstText = String(newPriorityInstructions[0]?.text || 'Check dispatch instructions').trim();
    await sendDispatchPush({
      userIds: Array.from(targetIds),
      title: `Priority Note: ${jobName}`,
      body: firstText,
      jobId,
      companyId,
      eventType: 'priority_instruction',
    });
  }
});

/**
 * 2. Closed-app push alerts for job team chat messages.
 */
export const onJobChatCreated = onDocumentCreated('companies/{companyId}/jobs/{jobId}/chat/{chatId}', async (event) => {
  const chat = event.data?.data();
  if (!chat) return;

  const { companyId, jobId } = event.params;
  const [jobSnap, dispatcherIds] = await Promise.all([
    db.collection('companies').doc(companyId).collection('jobs').doc(jobId).get(),
    getCompanyDispatcherIds(companyId),
  ]);

  const jobData = jobSnap.exists ? jobSnap.data() || {} : {};
  if (jobData.archived === true || jobData.status === 'cancelled') return;

  const assignedIds = (Array.isArray(jobData.assignedDrivers) ? jobData.assignedDrivers : [])
    .map((d) => d?.id)
    .filter(Boolean);

  const recipients = Array.from(new Set([...assignedIds, ...dispatcherIds]));
  const jobName = String(jobData.jobName || 'Job Chat').trim();
  const senderName = String(chat.senderName || 'Team').trim();
  const preview = chat.text ? String(chat.text).trim() : 'Sent an image attachment';

  await sendDispatchPush({
    userIds: recipients,
    excludeUid: chat.senderId || null,
    title: `New Message: ${jobName}`,
    body: `${senderName}: ${preview}`,
    jobId,
    companyId,
    eventType: 'job_chat',
  });
});

/**
 * 3. Server-proxied Gemini 3.8 Flash receipt OCR keeping GEMINI_API_KEY off the browser.
 */
export const scanReceiptOcr = onCall(
  {
    cors: true,
    secrets: [GEMINI_API_KEY],
    timeoutSeconds: 60,
    memory: '512MiB',
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication is required to scan receipts.');
    }

    const base64Data = typeof request.data?.base64Data === 'string' ? request.data.base64Data.trim() : '';
    const mimeType = typeof request.data?.mimeType === 'string' ? request.data.mimeType.trim().toLowerCase() : 'image/jpeg';

    if (!base64Data || base64Data.length > 15_000_000) {
      throw new HttpsError('invalid-argument', 'Receipt payload is missing or exceeds size limit.');
    }
    if (!ALLOWED_OCR_MIME_TYPES.has(mimeType)) {
      throw new HttpsError('invalid-argument', 'Unsupported receipt MIME type.');
    }

    const apiKey = (GEMINI_API_KEY.value() || process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) {
      throw new HttpsError('failed-precondition', 'Server GEMINI_API_KEY secret is not configured.');
    }

    const inputPart =
      mimeType === 'application/pdf'
        ? { type: 'document', data: base64Data, mime_type: 'application/pdf' }
        : { type: 'image', data: base64Data, mime_type: mimeType };

    const ai = new GoogleGenAI({ apiKey });
    const interaction = await ai.interactions.create({
      model: 'gemini-3.8-flash',
      store: false,
      input: [
        {
          type: 'text',
          text: 'Extract the receipt merchant name, grand total amount paid, best-matching fleet expense category (fuel, food, toll, maintenance, lodging, or custom), date in YYYY-MM-DD if visible, and a concise 1-line summary of the purchase.',
        },
        inputPart,
      ],
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: RECEIPT_JSON_SCHEMA,
      },
    });

    const rawText = extractOutputText(interaction).trim();
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    if (!cleaned) {
      throw new HttpsError('internal', 'Gemini did not return receipt details.');
    }

    const parsed = JSON.parse(cleaned);
    const normalizedCategory = EXPENSE_CATEGORIES.includes(parsed.category) ? parsed.category : 'custom';
    const numericAmount = Number(parsed.amount);

    return {
      merchant: String(parsed.merchant || '').trim().slice(0, 200),
      amount: Number.isFinite(numericAmount) && numericAmount >= 0 ? numericAmount : 0,
      category: normalizedCategory,
      date: String(parsed.date || '').trim().slice(0, 40),
      summary: String(parsed.summary || '').trim().slice(0, 500),
      model: 'gemini-3.8-flash',
      extractedAt: Date.now(),
    };
  }
);

/**
 * 4. Hourly TTL cleanup for stale active_drivers (>12h) and expired public_tracking tokens.
 */
export const cleanupStaleFleetData = onSchedule('every 60 minutes', async () => {
  const staleDriverCutoff = Timestamp.fromMillis(Date.now() - 12 * 60 * 60 * 1000);
  const nowTs = Timestamp.now();

  const [staleDriversSnap, expiredTrackingSnap] = await Promise.all([
    db.collectionGroup('active_drivers').where('timestamp', '<', staleDriverCutoff).limit(400).get(),
    db.collection('public_tracking').where('expiresAt', '<=', nowTs).limit(400).get(),
  ]);

  const docsToDelete = [...staleDriversSnap.docs, ...expiredTrackingSnap.docs];
  for (let i = 0; i < docsToDelete.length; i += 400) {
    const batch = db.batch();
    docsToDelete.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
});

/**
 * 5. Mirrors minimal company discovery metadata onto /company_directory/{companyId}.
 */
export const syncCompanyDirectory = onDocumentWritten('companies/{companyId}', async (event) => {
  const { companyId } = event.params;
  const dirRef = db.collection('company_directory').doc(companyId);

  if (!event.data?.after?.exists) {
    await dirRef.delete().catch(() => {});
    return;
  }

  const after = event.data.after.data() || {};
  await dirRef.set(
    {
      name: String(after.name || 'Fleet').slice(0, 120),
      requirePassword: Boolean(after.requirePassword),
      createdBy: String(after.createdBy || ''),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
});
