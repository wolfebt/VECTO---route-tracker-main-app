import { doc, setDoc, GeoPoint, serverTimestamp } from 'firebase/firestore';

const DB_NAME = 'vecto_offline_db';
const DB_VERSION = 1;
const STORE_NAME = 'location_queue';

function openDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB is not supported in this environment'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
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
 * Flushes all queued location fixes to Firestore upon network recovery.
 */
export async function flushOfflineQueue(firestoreDb) {
  const fixes = await getOfflineFixes();
  if (!fixes || fixes.length === 0) return;

  const processedIds = [];
  for (const fix of fixes) {
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
      processedIds.push(fix.id);
    } catch (err) {
      console.warn(`Could not flush offline fix #${fix.id}:`, err);
      // Stop flushing if network fails again
      break;
    }
  }

  if (processedIds.length > 0) {
    await removeOfflineFixes(processedIds);
    console.log(`Successfully flushed ${processedIds.length} offline location fixes.`);
  }
}
