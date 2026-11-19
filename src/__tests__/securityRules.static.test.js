import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function readProjectFile(relPath) {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
}

describe('security rules & Firestore indexes static invariants', () => {
  const firestoreRules = readProjectFile('firestore.rules');
  const storageRules = readProjectFile('storage.rules');
  const indexesJson = JSON.parse(readProjectFile('firestore.indexes.json'));

  it('has balanced braces and parentheses in firestore.rules and contains no permissive wildcards', () => {
    let braces = 0;
    let parens = 0;
    for (const ch of firestoreRules) {
      if (ch === '{') braces += 1;
      else if (ch === '}') braces -= 1;
      else if (ch === '(') parens += 1;
      else if (ch === ')') parens -= 1;
      expect(braces).toBeGreaterThanOrEqual(0);
      expect(parens).toBeGreaterThanOrEqual(0);
    }
    expect(braces).toBe(0);
    expect(parens).toBe(0);
    expect(firestoreRules).not.toMatch(/allow\s+(read|write)\s*:\s*if\s+true/);
  });

  it('enforces tenant isolation, salted join proofs, least-privilege jobs, and fleet/DVIR schemas', () => {
    const requiredSymbols = [
      'isCompanyMember',
      'isDispatcher',
      'hasValidJoinProof',
      'isAssignedDriverOnJob',
      'isValidVehicle',
      'isValidInspection',
      'isValidJob',
      'isValidPublicTracking',
      'match /company_directory/{companyId}',
      'match /private/{docId}',
      'match /vehicles/{vehicleId}',
      'match /inspections/{inspectionId}',
      "request.resource.data.driverId == request.auth.uid",
    ];
    for (const sym of requiredSymbols) {
      expect(firestoreRules).toContain(sym);
    }
  });

  it('enforces immutable upload paths in storage.rules for chat_files, receipts, pod, and dvir', () => {
    expect(storageRules).toContain('match /chat_files/{companyId}/{jobId}/{fileName}');
    expect(storageRules).toContain('match /receipts/{companyId}/{jobId}/{fileName}');
    expect(storageRules).toContain('match /pod/{companyId}/{jobId}/{fileName}');
    expect(storageRules).toContain('match /dvir/{companyId}/{vehicleId}/{fileName}');
    expect(storageRules).toContain('resource == null');
    expect(storageRules).toContain('allow update: if false;');
    expect(storageRules).toContain('isUploaderOwned(fileName)');
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
