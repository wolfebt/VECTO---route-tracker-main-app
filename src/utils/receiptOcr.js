import { GoogleGenAI } from '@google/genai';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

export const EXPENSE_CATEGORIES = ['fuel', 'food', 'toll', 'maintenance', 'lodging', 'custom'];

const RECEIPT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    merchant: {
      type: 'string',
      description: 'Store, station, vendor, or business name on the receipt.'
    },
    amount: {
      type: 'number',
      description: 'Grand total amount paid in USD (numeric value only).'
    },
    category: {
      type: 'string',
      enum: EXPENSE_CATEGORIES,
      description: 'Best matching fleet expense category.'
    },
    date: {
      type: 'string',
      description: 'Transaction date in YYYY-MM-DD format if clearly visible, otherwise empty string.'
    },
    summary: {
      type: 'string',
      description: 'Concise 1-line description of items or fuel quantity purchased.'
    }
  },
  required: ['merchant', 'amount', 'category', 'summary']
};

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIdx = result.indexOf(',');
      if (commaIdx === -1) {
        reject(new Error('Unable to encode receipt file.'));
        return;
      }
      resolve(result.slice(commaIdx + 1));
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read receipt file.'));
    reader.readAsDataURL(file);
  });
}

function resolveMimeType(file) {
  if (file?.type) return file.type;
  const lower = (file?.name || '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function extractOutputText(interaction) {
  if (interaction?.output_text) return interaction.output_text;
  if (Array.isArray(interaction?.outputs)) {
    const textPart = interaction.outputs.find((o) => o?.type === 'text' && o?.text);
    if (textPart?.text) return textPart.text;
  }
  return '';
}

function normalizeOcrResult(parsed) {
  const normalizedCategory = EXPENSE_CATEGORIES.includes(parsed?.category)
    ? parsed.category
    : 'custom';
  const numericAmount = Number(parsed?.amount);

  return {
    merchant: String(parsed?.merchant || '').trim().slice(0, 200),
    amount: Number.isFinite(numericAmount) && numericAmount >= 0 ? numericAmount : 0,
    category: normalizedCategory,
    date: String(parsed?.date || '').trim().slice(0, 40),
    summary: String(parsed?.summary || '').trim().slice(0, 500),
    model: String(parsed?.model || 'gemini-3.8-flash'),
    extractedAt: Number(parsed?.extractedAt) || Date.now()
  };
}

export async function scanReceiptWithGemini(file, fallbackApiKey = '') {
  if (!file) throw new Error('No receipt file selected.');

  const base64Data = await fileToBase64(file);
  const mimeType = resolveMimeType(file);

  // Primary path: authenticated Firebase Cloud Function proxy (keeps GEMINI_API_KEY server-side)
  try {
    const callOcr = httpsCallable(functions, 'scanReceiptOcr');
    const response = await callOcr({ base64Data, mimeType });
    if (response?.data && typeof response.data === 'object') {
      return normalizeOcrResult(response.data);
    }
  } catch (callableErr) {
    const trimmedFallback = String(fallbackApiKey || '').trim();
    if (!trimmedFallback) {
      if (callableErr?.code === 'functions/invalid-argument' || callableErr?.code === 'functions/unauthenticated') {
        throw new Error(callableErr.message || 'Receipt OCR request rejected.');
      }
      throw new Error(
        'Server OCR unavailable (deploy Cloud Functions or add a local dev Gemini key in Developer Settings).'
      );
    }
    console.warn('Cloud Function receipt OCR unavailable, using local dev fallback key:', callableErr);
  }

  // Optional local dev fallback when Cloud Functions are not yet deployed
  const trimmedFallback = String(fallbackApiKey || '').trim();
  if (!trimmedFallback) {
    throw new Error('Server OCR unavailable (deploy Cloud Functions or add a local dev Gemini key in Developer Settings).');
  }

  const inputPart = mimeType === 'application/pdf'
    ? { type: 'document', data: base64Data, mime_type: 'application/pdf' }
    : { type: 'image', data: base64Data, mime_type: mimeType };

  const ai = new GoogleGenAI({ apiKey: trimmedFallback });
  const interaction = await ai.interactions.create({
    model: 'gemini-3.8-flash',
    store: false,
    input: [
      {
        type: 'text',
        text: 'Extract the receipt merchant name, grand total amount paid, best-matching fleet expense category (fuel, food, toll, maintenance, lodging, or custom), date in YYYY-MM-DD if visible, and a concise 1-line summary of the purchase.'
      },
      inputPart
    ],
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      schema: RECEIPT_JSON_SCHEMA
    }
  });

  const rawText = extractOutputText(interaction).trim();
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  if (!cleaned) {
    throw new Error('Gemini did not return receipt details.');
  }

  return normalizeOcrResult(JSON.parse(cleaned));
}
