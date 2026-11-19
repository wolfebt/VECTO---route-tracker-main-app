import { doc, getDoc, setDoc, updateDoc, collection, addDoc, GeoPoint, serverTimestamp } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { dataUrlToBlob } from './imageCompression';
import { syncPublicTrackingJobUpdate } from './publicTracking';
import { haversineMiles, normalizeJobStops } from './stops';

const DB_NAME = 'vecto_offline_db';
const DB_VERSION = 2;
const STORE_NAME = 'location_queue';
const POD_STORE_NAME = 'pod_queue';
const MAX_POINTS_PER_CHUNK = 150;

let flushingPods = false;

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not supported in this environment'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(POD_STORE_NAME)) {
        db.createObjectStore(POD_STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Saves an un-sent location fix to IndexedDB when offline or network fails.
 */
export async function saveOfflineFix(companyId, userId, payload) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const record = {
        companyId,
        userId,
        payload: {
          lat: payload.location ? payload.location.latitude : payload.lat,
          lng: payload.location ? payload.location.longitude : payload.lng,
          status: payload.status,
          name: payload.name,
          color: payload.color,
          geohash: payload.geohash,
          activeJobId: payload.activeJobId || null
        },
        timestamp: Date.now()
      };
      const req = store.add(record);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('Failed to store offline location fix:', err);
  }
}

/**
 * Retrieves all stored offline location fixes.
 */
export async function getOfflineFixes() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('Failed to get offline location fixes:', err);
    return [];
  }
}

/**
 * Deletes processed offline location fixes by ID.
 */
export async function removeOfflineFixes(ids) {
  if (!ids || ids.length === 0) return;
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    ids.forEach(id => store.delete(id));
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('Failed to remove offline location fixes:', err);
  }
}

/**
 * Writes a chunked array of GPS breadcrumb points to companies/{companyId}/jobs/{jobId}/breadcrumbs.
 */
export async function flushBreadcrumbChunk(firestoreDb, { companyId, jobId, driverId, driverName, points, source = 'live' }) {
  if (!companyId || !jobId || !driverId || !Array.isArray(points) || points.length === 0) return;

  const cleanPoints = points
    .map((p) => ({
      lat: Number(p.lat),
      lng: Number(p.lng),
      ts: Number(p.ts) || Date.now(),
    }))
    .filter((p) => !isNaN(p.lat) && !isNaN(p.lng));

  if (cleanPoints.length === 0) return;

  const colRef = collection(firestoreDb, `companies/${companyId}/jobs/${jobId}/breadcrumbs`);

  for (let i = 0; i < cleanPoints.length; i += MAX_POINTS_PER_CHUNK) {
    const chunk = cleanPoints.slice(i, i + MAX_POINTS_PER_CHUNK);
    await addDoc(colRef, {
      companyId,
      jobId,
      driverId,
      driverName: driverName || 'Driver',
      points: chunk,
      pointCount: chunk.length,
      startTime: chunk[0].ts,
      endTime: chunk[chunk.length - 1].ts,
      source,
      createdAt: serverTimestamp(),
    });
  }
}

/**
 * Flushes queued offline fixes efficiently:
 * 1. Writes only the single latest active_drivers document per driver.
 * 2. Preserves sequential historical points as job breadcrumb chunks.
 */
export async function flushOfflineQueue(firestoreDb) {
  const fixes = await getOfflineFixes();
  if (!fixes || fixes.length === 0) return;

  const sorted = [...fixes].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  const latestByDriver = {};
  const breadcrumbGroups = {};
  const idsByDriverKey = {};

  for (const fix of sorted) {
    if (!fix.companyId || !fix.userId || !fix.payload) continue;
    const driverKey = `${fix.companyId}::${fix.userId}`;
    latestByDriver[driverKey] = fix;
    if (!idsByDriverKey[driverKey]) idsByDriverKey[driverKey] = [];
    idsByDriverKey[driverKey].push(fix.id);

    if (fix.payload.activeJobId && typeof fix.payload.lat === 'number' && typeof fix.payload.lng === 'number') {
      const bcKey = `${fix.companyId}::${fix.payload.activeJobId}::${fix.userId}`;
      if (!breadcrumbGroups[bcKey]) {
        breadcrumbGroups[bcKey] = {
          companyId: fix.companyId,
          jobId: fix.payload.activeJobId,
          driverId: fix.userId,
          driverName: fix.payload.name || 'Driver',
          points: [],
        };
      }
      breadcrumbGroups[bcKey].points.push({
        lat: fix.payload.lat,
        lng: fix.payload.lng,
        ts: fix.timestamp || Date.now(),
      });
    }
  }

  const succeededDriverKeys = new Set();
  for (const [driverKey, fix] of Object.entries(latestByDriver)) {
    try {
      const docRef = doc(firestoreDb, `companies/${fix.companyId}/active_drivers`, fix.userId);
      await setDoc(docRef, {
        location: new GeoPoint(fix.payload.lat, fix.payload.lng),
        timestamp: serverTimestamp(),
        status: fix.payload.status || 'Available',
        name: fix.payload.name || 'Unnamed',
        color: fix.payload.color || '#22c55e',
        geohash: fix.payload.geohash || '',
        activeJobId: fix.payload.activeJobId || null
      });
      succeededDriverKeys.add(driverKey);
    } catch (err) {
      console.warn(`Could not flush latest offline fix for ${driverKey}:`, err);
      break;
    }
  }

  // Flush offline breadcrumb history for succeeded drivers
  for (const group of Object.values(breadcrumbGroups)) {
    const driverKey = `${group.companyId}::${group.driverId}`;
    if (!succeededDriverKeys.has(driverKey)) continue;

    // Downsample consecutive points < ~15m apart while always preserving first and last point
    const sampled = [];
    for (let i = 0; i < group.points.length; i++) {
      const pt = group.points[i];
      const isLast = i === group.points.length - 1;
      if (sampled.length === 0 || isLast || haversineMiles(sampled[sampled.length - 1], pt) >= 0.01) {
        sampled.push(pt);
      }
    }

    try {
      await flushBreadcrumbChunk(firestoreDb, {
        ...group,
        points: sampled,
        source: 'offline_flush',
      });
    } catch (err) {
      console.warn('Could not flush offline breadcrumb chunk:', err);
    }
  }

  const processedIds = [];
  succeededDriverKeys.forEach((key) => {
    processedIds.push(...(idsByDriverKey[key] || []));
  });

  if (processedIds.length > 0) {
    await removeOfflineFixes(processedIds);
    console.log(`Flushed latest state for ${succeededDriverKeys.size} driver(s) (${processedIds.length} queued records).`);
  }
}

/**
 * Queues a compressed POD capture (photo/signature data URLs + metadata) while offline.
 */
export async function saveOfflinePod(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(POD_STORE_NAME, 'readwrite');
    const store = tx.objectStore(POD_STORE_NAME);
    const req = store.add({
      ...record,
      queuedAt: Date.now(),
    });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getOfflinePods() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(POD_STORE_NAME, 'readonly');
      const store = tx.objectStore(POD_STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('Failed to read offline POD queue:', err);
    return [];
  }
}

export async function removeOfflinePod(id) {
  if (id == null) return;
  try {
    const db = await openDB();
    const tx = db.transaction(POD_STORE_NAME, 'readwrite');
    tx.objectStore(POD_STORE_NAME).delete(id);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('Failed to remove offline POD entry:', err);
  }
}

/**
 * Uploads queued offline POD images/signatures to Firebase Storage and updates the job/stop POD links.
 */
export async function flushOfflinePodQueue(firestoreDb, firebaseStorage) {
  if (!firestoreDb || !firebaseStorage || flushingPods) return 0;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 0;

  flushingPods = true;
  let flushedCount = 0;

  try {
    const queuedPods = await getOfflinePods();
    if (!queuedPods || queuedPods.length === 0) return 0;

    for (const item of queuedPods) {
      if (!item?.companyId || !item?.jobId || !item?.capturedBy) {
        await removeOfflinePod(item?.id);
        continue;
      }

      try {
        let photoUrl = item.photoUrl || null;
        let signatureUrl = item.signatureUrl || null;

        if (!photoUrl && item.photoDataUrl) {
          const photoBlob = dataUrlToBlob(item.photoDataUrl);
          if (photoBlob) {
            const photoPath = `pod/${item.companyId}/${item.jobId}/${item.capturedAt}_photo_${item.capturedBy}.jpg`;
            const photoRef = ref(firebaseStorage, photoPath);
            await uploadBytes(photoRef, photoBlob, { contentType: photoBlob.type || 'image/jpeg' });
            photoUrl = await getDownloadURL(photoRef);
          }
        }

        if (!signatureUrl && item.signatureDataUrl) {
          const sigBlob = dataUrlToBlob(item.signatureDataUrl);
          if (sigBlob) {
            const sigPath = `pod/${item.companyId}/${item.jobId}/${item.capturedAt}_sig_${item.capturedBy}.png`;
            const sigRef = ref(firebaseStorage, sigPath);
            await uploadBytes(sigRef, sigBlob, { contentType: 'image/png' });
            signatureUrl = await getDownloadURL(sigRef);
          }
        }

        const jobRef = doc(firestoreDb, `companies/${item.companyId}/jobs`, item.jobId);
        const jobSnap = await getDoc(jobRef);
        if (jobSnap.exists()) {
          const jobData = { id: jobSnap.id, ...jobSnap.data() };
          const stops = normalizeJobStops(jobData);
          const baseStops =
            stops.length > 0
              ? stops
              : [
                  {
                    id: 'stop_0',
                    address: jobData.destination || jobData.origin || 'Delivery Stop',
                    lat: null,
                    lng: null,
                    order: 0,
                    status: 'pending',
                    arrivedAt: null,
                    completedAt: null,
                    pod: null,
                  },
                ];

          let matchedIndex = baseStops.findIndex((s) => s.id === item.selectedStopId);
          if (matchedIndex === -1) matchedIndex = 0;

          const podRecord = {
            photoUrl: photoUrl || null,
            signatureUrl: signatureUrl || null,
            recipientName: item.recipientName || null,
            notes: item.deliveryNotes || null,
            capturedAt: item.capturedAt,
            capturedBy: item.capturedBy,
            capturedByName: item.capturedByName || 'Driver',
            capturedLat: typeof item.capturedLat === 'number' ? item.capturedLat : null,
            capturedLng: typeof item.capturedLng === 'number' ? item.capturedLng : null,
          };

          const updatedStops = baseStops.map((s, idx) =>
            idx === matchedIndex
              ? {
                  ...s,
                  status: 'completed',
                  arrivedAt: s.arrivedAt || item.capturedAt,
                  completedAt: s.completedAt || item.capturedAt,
                  pod: podRecord,
                }
              : s
          );

          const podSummary = {
            lastUpdatedAt: item.capturedAt,
            stopId: baseStops[matchedIndex].id,
            photoUrl: podRecord.photoUrl,
            signatureUrl: podRecord.signatureUrl,
            recipientName: podRecord.recipientName,
          };

          await updateDoc(jobRef, {
            stops: updatedStops,
            pod: podSummary,
            updatedAt: serverTimestamp(),
          });

          if (!item.noteWritten) {
            const stopNumber = matchedIndex + 1;
            const noteText = `Proof of Delivery captured offline for Stop #${stopNumber}${
              podRecord.recipientName ? ` (Recipient: ${podRecord.recipientName})` : ''
            }${podRecord.notes ? ` — ${podRecord.notes}` : ''}`;

            await addDoc(collection(firestoreDb, `companies/${item.companyId}/jobs/${item.jobId}/notes`), {
              text: noteText.slice(0, 4000),
              driverId: item.capturedBy,
              driverName: item.capturedByName || 'Driver',
              timestamp: serverTimestamp(),
            }).catch(() => {});
          }

          await syncPublicTrackingJobUpdate({
            db: firestoreDb,
            companyId: item.companyId,
            companyName: item.companyName || '',
            job: { ...jobData, stops: updatedStops, pod: podSummary },
            driverId: item.capturedBy,
            driverName: item.capturedByName || 'Driver',
          });
        }

        await removeOfflinePod(item.id);
        flushedCount += 1;
      } catch (err) {
        console.warn('Could not flush offline POD entry, will retry when online:', err);
        break;
      }
    }
  } finally {
    flushingPods = false;
  }

  return flushedCount;
}
