import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  Timestamp,
} from 'firebase/firestore';

const hasEmulator = Boolean(
  process.env.FIRESTORE_EMULATOR_HOST || process.env.RUN_FIRESTORE_EMULATOR_TESTS
);

describe.skipIf(!hasEmulator)('Firestore Security Rules (Emulator)', () => {
  let testEnv;

  beforeAll(async () => {
    const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
    testEnv = await initializeTestEnvironment({
      projectId: 'vecto-rules-test',
      firestore: { rules },
    });
  });

  afterAll(async () => {
    await testEnv?.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const adminDb = ctx.firestore();
      await setDoc(doc(adminDb, 'users', 'driver1'), {
        name: 'Driver One',
        email: 'd1@vecto.app',
      });
      await setDoc(doc(adminDb, 'companies', 'comp1'), {
        name: 'VECTO Alpha',
        requirePassword: true,
        createdBy: 'dispatcher1',
      });
      await setDoc(doc(adminDb, 'companies/comp1/private', 'security'), {
        passwordHash: 'salted_proof_abc123',
        removedMemberIds: ['banned_user'],
      });
      await setDoc(doc(adminDb, 'companies/comp1/private', 'profile'), {
        address: '100 Fleet Ave',
        phone: '555-1200',
      });
      await setDoc(doc(adminDb, 'companies/comp1/members', 'dispatcher1'), {
        name: 'Dispatch Lead',
        role: 'dispatcher',
        permissions: { canCreateJob: true, canDeleteJob: true, canManageDrivers: true },
      });
      await setDoc(doc(adminDb, 'companies/comp1/members', 'driver1'), {
        name: 'Driver One',
        role: 'driver',
        permissions: { canCreateJob: false, canDeleteJob: false, canManageDrivers: false },
      });
      await setDoc(doc(adminDb, 'companies/comp1/vehicles', 'veh1'), {
        unitNumber: 'V-101',
        status: 'active',
        odometerMiles: 12000,
      });
      await setDoc(doc(adminDb, 'companies/comp1/jobs', 'job1'), {
        jobName: 'Morning Delivery',
        origin: '100 Main St',
        status: 'assigned',
        archived: false,
        assignedDrivers: [{ id: 'driver1', name: 'Driver One' }],
        assignedDriverIds: ['driver1'],
      });
      await setDoc(doc(adminDb, 'companies/comp1/jobs', 'job_open'), {
        jobName: 'Open Route',
        origin: '200 Depot Rd',
        status: 'unassigned',
        archived: false,
        assignedDrivers: [],
        assignedDriverIds: [],
      });
    });
  });

  it('denies unauthenticated access to fleet documents', async () => {
    const anonDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anonDb, 'companies/comp1/jobs', 'job1')));
    await assertFails(getDoc(doc(anonDb, 'companies/comp1/vehicles', 'veh1')));
    await assertFails(getDoc(doc(anonDb, 'users', 'driver1')));
  });

  it('enforces owner-only /users isolation and cross-tenant isolation including private/security vs private/profile', async () => {
    const driverDb = testEnv.authenticatedContext('driver1').firestore();
    const dispatcherDb = testEnv.authenticatedContext('dispatcher1').firestore();
    const outsiderDb = testEnv.authenticatedContext('outsider1').firestore();

    await assertSucceeds(getDoc(doc(driverDb, 'users', 'driver1')));
    await assertFails(getDoc(doc(outsiderDb, 'users', 'driver1')));
    await assertFails(getDoc(doc(outsiderDb, 'companies/comp1/jobs', 'job1')));
    await assertFails(getDoc(doc(outsiderDb, 'companies/comp1/private', 'profile')));
    await assertFails(getDoc(doc(driverDb, 'companies/comp1/private', 'security')));
    await assertSucceeds(getDoc(doc(driverDb, 'companies/comp1/private', 'profile')));
    await assertSucceeds(getDoc(doc(dispatcherDb, 'companies/comp1/private', 'security')));
  });

  it('rejects password/passwordHash fields on company create', async () => {
    const userDb = testEnv.authenticatedContext('creator2').firestore();

    await assertFails(
      setDoc(doc(userDb, 'companies', 'comp_bad'), {
        name: 'Bad Co',
        createdBy: 'creator2',
        passwordHash: 'deadbeef',
      })
    );
    await assertSucceeds(
      setDoc(doc(userDb, 'companies', 'comp_good'), {
        name: 'Good Co',
        createdBy: 'creator2',
        requirePassword: true,
      })
    );
  });

  it('enforces salted join proofs, removedMemberIds blocklist, and blocks member self-escalation', async () => {
    const newDriverDb = testEnv.authenticatedContext('driver2').firestore();
    const bannedDb = testEnv.authenticatedContext('banned_user').firestore();
    const existingDriverDb = testEnv.authenticatedContext('driver1').firestore();

    // Missing or wrong proof fails member creation
    await assertSucceeds(
      setDoc(doc(newDriverDb, 'companies/comp1/join_requests', 'driver2'), {
        proofHash: 'wrong_hash',
      })
    );
    await assertFails(
      setDoc(doc(newDriverDb, 'companies/comp1/members', 'driver2'), {
        name: 'Driver Two',
        role: 'driver',
        permissions: { canCreateJob: false, canDeleteJob: false, canManageDrivers: false },
      })
    );

    // Valid proof allows joining as driver, but privilege escalation fails
    await assertSucceeds(
      setDoc(doc(newDriverDb, 'companies/comp1/join_requests', 'driver2'), {
        proofHash: 'salted_proof_abc123',
      })
    );
    await assertFails(
      setDoc(doc(newDriverDb, 'companies/comp1/members', 'driver2'), {
        name: 'Driver Two',
        role: 'driver',
        permissions: { canCreateJob: true, canDeleteJob: false, canManageDrivers: false },
      })
    );
    await assertSucceeds(
      setDoc(doc(newDriverDb, 'companies/comp1/members', 'driver2'), {
        name: 'Driver Two',
        role: 'driver',
        permissions: { canCreateJob: false, canDeleteJob: false, canManageDrivers: false },
      })
    );

    // Removed user cannot re-join even with valid proof
    await assertSucceeds(
      setDoc(doc(bannedDb, 'companies/comp1/join_requests', 'banned_user'), {
        proofHash: 'salted_proof_abc123',
      })
    );
    await assertFails(
      setDoc(doc(bannedDb, 'companies/comp1/members', 'banned_user'), {
        name: 'Banned',
        role: 'driver',
        permissions: { canCreateJob: false, canDeleteJob: false, canManageDrivers: false },
      })
    );

    // Existing driver cannot self-escalate permissions
    await assertFails(
      updateDoc(doc(existingDriverDb, 'companies/comp1/members', 'driver1'), {
        permissions: { canCreateJob: true, canDeleteJob: true, canManageDrivers: true },
      })
    );
  });

  it('restricts driver mutations on jobs vs dispatcher controls including self-assign and cancel', async () => {
    const driverDb = testEnv.authenticatedContext('driver1').firestore();
    const dispatcherDb = testEnv.authenticatedContext('dispatcher1').firestore();

    await assertFails(
      updateDoc(doc(driverDb, 'companies/comp1/jobs', 'job1'), {
        status: 'cancelled',
      })
    );
    await assertFails(deleteDoc(doc(driverDb, 'companies/comp1/jobs', 'job1')));
    await assertSucceeds(
      updateDoc(doc(driverDb, 'companies/comp1/jobs', 'job1'), {
        status: 'in-progress',
        startedAt: Timestamp.now(),
      })
    );
    // Unassigned driver can self-assign to open job
    await assertSucceeds(
      updateDoc(doc(driverDb, 'companies/comp1/jobs', 'job_open'), {
        assignedDrivers: [{ id: 'driver1', name: 'Driver One' }],
        assignedDriverIds: ['driver1'],
        status: 'assigned',
      })
    );
    await assertSucceeds(
      updateDoc(doc(dispatcherDb, 'companies/comp1/jobs', 'job1'), {
        archived: true,
      })
    );
  });

  it('prevents driver expense self-approval, enforces pending-only delete, and allows dispatcher review', async () => {
    const driverDb = testEnv.authenticatedContext('driver1').firestore();
    const dispatcherDb = testEnv.authenticatedContext('dispatcher1').firestore();
    const expRefDriver = doc(driverDb, 'companies/comp1/jobs/job1/expenses', 'exp1');

    // Cannot create already approved expense
    await assertFails(
      setDoc(doc(driverDb, 'companies/comp1/jobs/job1/expenses', 'exp_bad'), {
        type: 'fuel',
        amount: 45,
        driverId: 'driver1',
        companyId: 'comp1',
        jobId: 'job1',
        status: 'approved',
      })
    );

    await assertSucceeds(
      setDoc(expRefDriver, {
        type: 'fuel',
        amount: 45,
        driverId: 'driver1',
        companyId: 'comp1',
        jobId: 'job1',
        status: 'submitted',
      })
    );

    // Driver cannot self-approve
    await assertFails(updateDoc(expRefDriver, { status: 'approved' }));

    // Dispatcher approves expense; after approval driver can no longer delete it
    await assertSucceeds(
      updateDoc(doc(dispatcherDb, 'companies/comp1/jobs/job1/expenses', 'exp1'), {
        status: 'approved',
        reviewedBy: 'dispatcher1',
      })
    );
    await assertFails(deleteDoc(expRefDriver));
  });

  it('enforces breadcrumbs and active_drivers driver-scoping and DVIR out_of_service rules', async () => {
    const driverDb = testEnv.authenticatedContext('driver1').firestore();

    await assertSucceeds(
      setDoc(doc(driverDb, 'companies/comp1/jobs/job1/breadcrumbs', 'chunk1'), {
        companyId: 'comp1',
        jobId: 'job1',
        driverId: 'driver1',
        points: [{ lat: 30.26, lng: -97.74, t: 1700000000 }],
        pointCount: 1,
      })
    );
    await assertFails(
      setDoc(doc(driverDb, 'companies/comp1/jobs/job1/breadcrumbs', 'chunk_spoof'), {
        companyId: 'comp1',
        jobId: 'job1',
        driverId: 'other_driver',
        points: [{ lat: 30.26, lng: -97.74, t: 1700000000 }],
        pointCount: 1,
      })
    );

    await assertSucceeds(
      setDoc(doc(driverDb, 'companies/comp1/active_drivers', 'driver1'), {
        name: 'Driver One',
        status: 'on_duty',
        activeJobId: 'job1',
      })
    );
    await assertFails(
      setDoc(doc(driverDb, 'companies/comp1/active_drivers', 'dispatcher1'), {
        name: 'Spoof',
        status: 'on_duty',
      })
    );

    await assertFails(
      setDoc(doc(driverDb, 'companies/comp1/inspections', 'insp_spoof'), {
        companyId: 'comp1',
        vehicleId: 'veh1',
        driverId: 'other_driver',
        inspectionType: 'pre_trip',
        odometerMiles: 12100,
        checklist: { brakes: true },
        overallStatus: 'safe',
        driverSignedName: 'Spoofed',
      })
    );

    await assertSucceeds(
      setDoc(doc(driverDb, 'companies/comp1/inspections', 'insp_ok'), {
        companyId: 'comp1',
        vehicleId: 'veh1',
        driverId: 'driver1',
        inspectionType: 'pre_trip',
        odometerMiles: 12100,
        checklist: { brakes: false },
        overallStatus: 'unsafe',
        driverSignedName: 'Driver One',
      })
    );

    await assertSucceeds(
      updateDoc(doc(driverDb, 'companies/comp1/vehicles', 'veh1'), {
        odometerMiles: 12100,
        lastInspectionStatus: 'unsafe',
        status: 'out_of_service',
      })
    );

    await assertFails(
      updateDoc(doc(driverDb, 'companies/comp1/vehicles', 'veh1'), {
        unitNumber: 'HACKED-999',
      })
    );
  });

  it('enforces public_tracking token length, list denial, revocation, and TTL expiration', async () => {
    const anonDb = testEnv.unauthenticatedContext().firestore();
    const driverDb = testEnv.authenticatedContext('driver1').firestore();

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const adminDb = ctx.firestore();
      await setDoc(doc(adminDb, 'public_tracking', 'valid_token_12345678901234567890'), {
        companyId: 'comp1',
        jobId: 'job1',
        status: 'in-progress',
        revoked: false,
        expiresAt: Timestamp.fromMillis(Date.now() + 3600000),
      });
      await setDoc(doc(adminDb, 'public_tracking', 'revoked_tok_12345678901234567890'), {
        companyId: 'comp1',
        jobId: 'job1',
        status: 'in-progress',
        revoked: true,
        expiresAt: Timestamp.fromMillis(Date.now() + 3600000),
      });
      await setDoc(doc(adminDb, 'public_tracking', 'expired_tok_12345678901234567890'), {
        companyId: 'comp1',
        jobId: 'job1',
        status: 'completed',
        revoked: false,
        expiresAt: Timestamp.fromMillis(Date.now() - 60000),
      });
    });

    await assertFails(getDocs(collection(anonDb, 'public_tracking')));
    await assertFails(getDoc(doc(anonDb, 'public_tracking', 'too_short')));
    await assertSucceeds(
      getDoc(doc(anonDb, 'public_tracking', 'valid_token_12345678901234567890'))
    );
    await assertFails(
      getDoc(doc(anonDb, 'public_tracking', 'revoked_tok_12345678901234567890'))
    );
    await assertFails(
      getDoc(doc(anonDb, 'public_tracking', 'expired_tok_12345678901234567890'))
    );
    // Company member can still inspect revoked tracking doc
    await assertSucceeds(
      getDoc(doc(driverDb, 'public_tracking', 'revoked_tok_12345678901234567890'))
    );
  });
});
