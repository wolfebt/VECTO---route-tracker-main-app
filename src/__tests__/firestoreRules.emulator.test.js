import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, Timestamp } from 'firebase/firestore';

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
      await setDoc(doc(adminDb, 'companies', 'comp1'), {
        name: 'VECTO Alpha',
        requirePassword: false,
        createdBy: 'dispatcher1',
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
    });
  });

  it('denies unauthenticated access to fleet documents', async () => {
    const anonDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anonDb, 'companies/comp1/jobs', 'job1')));
    await assertFails(getDoc(doc(anonDb, 'companies/comp1/vehicles', 'veh1')));
  });

  it('enforces cross-tenant isolation between companies', async () => {
    const outsiderDb = testEnv.authenticatedContext('outsider1').firestore();
    await assertFails(getDoc(doc(outsiderDb, 'companies/comp1/jobs', 'job1')));
    await assertFails(getDoc(doc(outsiderDb, 'companies/comp1/private', 'profile')));
  });

  it('restricts driver mutations on jobs vs dispatcher controls', async () => {
    const driverDb = testEnv.authenticatedContext('driver1').firestore();
    const dispatcherDb = testEnv.authenticatedContext('dispatcher1').firestore();

    await assertFails(
      updateDoc(doc(driverDb, 'companies/comp1/jobs', 'job1'), {
        status: 'cancelled',
      })
    );
    await assertSucceeds(
      updateDoc(doc(driverDb, 'companies/comp1/jobs', 'job1'), {
        status: 'in-progress',
        startedAt: Timestamp.now(),
      })
    );
    await assertSucceeds(
      updateDoc(doc(dispatcherDb, 'companies/comp1/jobs', 'job1'), {
        archived: true,
      })
    );
  });

  it('allows drivers to log own DVIR and mark unsafe units out_of_service without spoofing', async () => {
    const driverDb = testEnv.authenticatedContext('driver1').firestore();

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
});
