import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function readProjectFile(relPath) {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
}

function assertBalancedDelimiters(source) {
  let braces = 0;
  let parens = 0;
  for (const ch of source) {
    if (ch === '{') braces += 1;
    else if (ch === '}') braces -= 1;
    else if (ch === '(') parens += 1;
    else if (ch === ')') parens -= 1;
    expect(braces).toBeGreaterThanOrEqual(0);
    expect(parens).toBeGreaterThanOrEqual(0);
  }
  expect(braces).toBe(0);
  expect(parens).toBe(0);
}

describe('security rules & Firestore indexes static invariants', () => {
  const firestoreRules = readProjectFile('firestore.rules');
  const storageRules = readProjectFile('storage.rules');
  const indexesJson = JSON.parse(readProjectFile('firestore.indexes.json'));

  it('has balanced braces and parentheses in firestore.rules and storage.rules and contains no permissive wildcards', () => {
    assertBalancedDelimiters(firestoreRules);
    assertBalancedDelimiters(storageRules);
    expect(firestoreRules).not.toMatch(/allow\s+(read|write)\s*:\s*if\s+true/);
    expect(storageRules).not.toMatch(/allow\s+(read|write)\s*:\s*if\s+true/);
  });

  it('defines all 16 schema validators and all expected collection/subcollection match blocks in firestore.rules', () => {
    const validators = [
      'function isValidUser(',
      'function isValidCompany(',
      'function isValidCompanyDirectory(',
      'function isValidCompanySecurity(',
      'function isValidCompanyProfile(',
      'function isValidJoinRequest(',
      'function isValidMember(',
      'function isValidJob(',
      'function isValidChatMessage(',
      'function isValidNote(',
      'function isValidExpense(',
      'function isValidBreadcrumbChunk(',
      'function isValidActiveDriver(',
      'function isValidVehicle(',
      'function isValidInspection(',
      'function isValidPublicTracking(',
    ];
    for (const fn of validators) {
      expect(firestoreRules).toContain(fn);
    }

    const matches = [
      'match /users/{userId}',
      'match /company_directory/{companyId}',
      'match /companies/{companyId}',
      'match /private/{docId}',
      'match /join_requests/{userId}',
      'match /members/{memberId}',
      'match /jobs/{jobId}',
      'match /chat/{chatId}',
      'match /notes/{noteId}',
      'match /expenses/{expenseId}',
      'match /breadcrumbs/{chunkId}',
      'match /active_drivers/{driverId}',
      'match /vehicles/{vehicleId}',
      'match /inspections/{inspectionId}',
      'match /public_tracking/{token}',
      'match /{path=**}/expenses/{expenseId}',
    ];
    for (const block of matches) {
      expect(firestoreRules).toContain(block);
    }
  });

  it('enforces tenant isolation, password separation, salted join proofs, least-privilege jobs/expenses, and tracking TTL', () => {
    const requiredInvariants = [
      'isCompanyMember',
      'isDispatcher',
      'isRemovedMember',
      'hasValidJoinProof',
      'isAssignedDriverOnJob',
      "!('password' in request.resource.data)",
      "!('passwordHash' in request.resource.data)",
      "request.resource.data.get('status', 'submitted') == 'submitted'",
      'allow list: if false;',
      'request.time <= resource.data.expiresAt',
      'request.resource.data.driverId == request.auth.uid',
    ];
    for (const sym of requiredInvariants) {
      expect(firestoreRules).toContain(sym);
    }
  });

  it('enforces immutable 10MB upload paths and MIME caps in storage.rules for chat_files, receipts, pod, and dvir', () => {
    expect(storageRules).toContain('match /chat_files/{companyId}/{jobId}/{fileName}');
    expect(storageRules).toContain('match /receipts/{companyId}/{jobId}/{fileName}');
    expect(storageRules).toContain('match /pod/{companyId}/{jobId}/{fileName}');
    expect(storageRules).toContain('match /dvir/{companyId}/{vehicleId}/{fileName}');
    expect(storageRules).toContain('resource == null');
    expect(storageRules).toContain('allow update: if false;');
    expect(storageRules).toContain('10 * 1024 * 1024');
    expect(storageRules).toContain('image/.*|application/pdf');
    expect(storageRules).toContain('isUploaderOwned(fileName)');
    expect(storageRules).toContain("'.*_' + request.auth.uid + '([._].*)?$'");
  });

  it('defines paginated archived jobs composite index and required fieldOverrides', () => {
    const hasArchiveIndex = indexesJson.indexes.some(
      (idx) =>
        idx.collectionGroup === 'jobs' &&
        idx.fields?.some((f) => f.fieldPath === 'archived' && f.order === 'ASCENDING') &&
        idx.fields?.some((f) => f.fieldPath === 'createdAt' && f.order === 'DESCENDING')
    );
    expect(hasArchiveIndex).toBe(true);
    expect(indexesJson.fieldOverrides.some((f) => f.collectionGroup === 'expenses')).toBe(true);
    expect(indexesJson.fieldOverrides.some((f) => f.collectionGroup === 'active_drivers')).toBe(true);
  });
});
