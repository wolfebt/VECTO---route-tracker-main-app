import { vi } from 'vitest';

function normalizePath(segments) {
  return segments
    .filter((s) => typeof s === 'string' && s.length > 0)
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/^\/|\/$/g, '');
}

function makeTimestamp(ms = Date.now()) {
  const safeMs = Number.isFinite(ms) ? ms : Date.now();
  return {
    __type: 'timestamp',
    seconds: Math.floor(safeMs / 1000),
    nanoseconds: (safeMs % 1000) * 1e6,
    toMillis: () => safeMs,
  };
}

function cloneValue(val) {
  if (val === null || val === undefined || typeof val !== 'object') return val;
  if (val.__type === 'timestamp') return makeTimestamp(val.toMillis());
  if (val.__type === 'geopoint') return { latitude: val.latitude, longitude: val.longitude };
  if (Array.isArray(val)) return val.map(cloneValue);
  const out = {};
  for (const [k, v] of Object.entries(val)) {
    out[k] = cloneValue(v);
  }
  return out;
}

function resolveFieldPath(obj, dotPath) {
  const parts = String(dotPath).split('.');
  let cur = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

function setNestedField(target, dotPath, value) {
  const parts = String(dotPath).split('.');
  let cur = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!cur[p] || typeof cur[p] !== 'object' || Array.isArray(cur[p])) {
      cur[p] = {};
    } else {
      cur[p] = { ...cur[p] };
    }
    cur = cur[p];
  }
  const last = parts[parts.length - 1];
  if (value && value.__sentinel === 'deleteField') {
    delete cur[last];
  } else {
    cur[last] = resolveSpecialValue(cur[last], value);
  }
}

function resolveSpecialValue(existing, value) {
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (value.__sentinel === 'serverTimestamp') return makeTimestamp(Date.now());
  if (value.__sentinel === 'arrayUnion') {
    const base = Array.isArray(existing) ? [...existing] : [];
    for (const item of value.items) {
      const serialized = JSON.stringify(item);
      if (!base.some((x) => JSON.stringify(x) === serialized)) {
        base.push(cloneValue(item));
      }
    }
    return base;
  }
  if (value.__sentinel === 'arrayRemove') {
    const base = Array.isArray(existing) ? [...existing] : [];
    const removeSet = new Set(value.items.map((x) => JSON.stringify(x)));
    return base.filter((x) => !removeSet.has(JSON.stringify(x)));
  }
  if (value.__type === 'timestamp' || value.__type === 'geopoint') {
    return cloneValue(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveSpecialValue(undefined, item));
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (v && v.__sentinel === 'deleteField') continue;
    out[k] = resolveSpecialValue(existing?.[k], v);
  }
  return out;
}

function compareValues(a, b) {
  const toComparable = (v) => {
    if (v == null) return 0;
    if (typeof v?.toMillis === 'function') return v.toMillis();
    if (typeof v === 'number') return v;
    return String(v);
  };
  const ca = toComparable(a);
  const cb = toComparable(b);
  if (ca < cb) return -1;
  if (ca > cb) return 1;
  return 0;
}

export function createFirestoreMock() {
  const store = new Map();
  const listeners = new Set();
  let autoIdCounter = 1;
  const db = { __type: 'firestoreDb' };

  const makeDocRef = (path) => {
    const parts = path.split('/').filter(Boolean);
    const id = parts[parts.length - 1] || '';
    const colName = parts.length >= 2 ? parts[parts.length - 2] : '';
    const parentDocId = parts.length >= 3 ? parts[parts.length - 3] : null;
    return {
      __type: 'docRef',
      path,
      id,
      parent: {
        id: colName,
        parent: parentDocId ? { id: parentDocId } : null,
      },
    };
  };

  const makeDocSnapshot = (path, data) => {
    const ref = makeDocRef(path);
    const exists = data !== undefined;
    const storedCopy = exists ? cloneValue(data) : undefined;
    return {
      id: ref.id,
      ref,
      exists: () => exists,
      data: () => (exists ? cloneValue(storedCopy) : undefined),
    };
  };

  const buildQuerySnapshot = (target) => {
    let entries = [];
    const targetObj = target?.__type === 'query' ? target.target : target;
    const constraints = target?.__type === 'query' ? target.constraints : [];

    if (targetObj?.__type === 'colRef') {
      const prefix = targetObj.path ? `${targetObj.path}/` : '';
      for (const [p, val] of store.entries()) {
        if (!p.startsWith(prefix)) continue;
        const remainder = p.slice(prefix.length);
        if (!remainder || remainder.includes('/')) continue;
        entries.push({ path: p, data: val });
      }
    } else if (targetObj?.__type === 'colGroupRef') {
      for (const [p, val] of store.entries()) {
        const parts = p.split('/');
        if (parts.length >= 2 && parts[parts.length - 2] === targetObj.groupName) {
          entries.push({ path: p, data: val });
        }
      }
    }

    for (const c of constraints) {
      if (c.type === 'where') {
        entries = entries.filter(({ data }) => {
          const fv = resolveFieldPath(data, c.field);
          if (c.op === '==') return fv === c.value;
          if (c.op === '!=') return fv !== c.value;
          if (c.op === '<') return compareValues(fv, c.value) < 0;
          if (c.op === '<=') return compareValues(fv, c.value) <= 0;
          if (c.op === '>') return compareValues(fv, c.value) > 0;
          if (c.op === '>=') return compareValues(fv, c.value) >= 0;
          if (c.op === 'in') return Array.isArray(c.value) && c.value.includes(fv);
          if (c.op === 'array-contains') return Array.isArray(fv) && fv.includes(c.value);
          return true;
        });
      }
    }

    for (const c of constraints) {
      if (c.type === 'orderBy') {
        entries.sort((a, b) => {
          const cmp = compareValues(resolveFieldPath(a.data, c.field), resolveFieldPath(b.data, c.field));
          return c.dir === 'desc' ? -cmp : cmp;
        });
      }
    }

    for (const c of constraints) {
      if (c.type === 'startAfter' && c.cursor) {
        const cursorPath = c.cursor.ref?.path || c.cursor.path;
        const idx = entries.findIndex((e) => e.path === cursorPath);
        if (idx >= 0) {
          entries = entries.slice(idx + 1);
        }
      }
    }

    for (const c of constraints) {
      if (c.type === 'limit') {
        entries = entries.slice(0, c.n);
      }
    }

    const docSnaps = entries.map((e) => makeDocSnapshot(e.path, e.data));
    return {
      empty: docSnaps.length === 0,
      size: docSnaps.length,
      docs: docSnaps,
      forEach: (cb) => docSnaps.forEach(cb),
    };
  };

  const targetMatchesPath = (target, docPath) => {
    if (!target || !docPath) return false;
    const t = target.__type === 'query' ? target.target : target;
    if (t?.__type === 'docRef') return t.path === docPath;
    if (t?.__type === 'colRef') {
      const prefix = t.path ? `${t.path}/` : '';
      if (!docPath.startsWith(prefix)) return false;
      const remainder = docPath.slice(prefix.length);
      return Boolean(remainder) && !remainder.includes('/');
    }
    if (t?.__type === 'colGroupRef') {
      const parts = docPath.split('/');
      return parts.length >= 2 && parts[parts.length - 2] === t.groupName;
    }
    return true;
  };

  const notifyListeners = (changedPaths = null) => {
    for (const listener of Array.from(listeners)) {
      if (!listener.active) continue;
      if (Array.isArray(changedPaths) && !changedPaths.some((p) => targetMatchesPath(listener.target, p))) {
        continue;
      }
      if (listener.target?.__type === 'docRef') {
        const data = store.get(listener.target.path);
        listener.onNext(makeDocSnapshot(listener.target.path, data));
      } else {
        listener.onNext(buildQuerySnapshot(listener.target));
      }
    }
  };

  const applySet = (path, data, options = {}) => {
    const prev = store.get(path);
    if (options.merge && prev) {
      const merged = { ...prev };
      for (const [k, v] of Object.entries(data || {})) {
        if (v && v.__sentinel === 'deleteField') {
          delete merged[k];
        } else {
          merged[k] = resolveSpecialValue(merged[k], v);
        }
      }
      store.set(path, merged);
    } else {
      store.set(path, resolveSpecialValue({}, data || {}));
    }
  };

  const applyUpdate = (path, updates) => {
    const prev = store.get(path) ? cloneValue(store.get(path)) : {};
    for (const [k, v] of Object.entries(updates || {})) {
      if (k.includes('.')) {
        setNestedField(prev, k, v);
      } else if (v && v.__sentinel === 'deleteField') {
        delete prev[k];
      } else {
        prev[k] = resolveSpecialValue(prev[k], v);
      }
    }
    store.set(path, prev);
  };

  const doc = vi.fn((dbOrCol, ...segments) => {
    if (dbOrCol?.__type === 'colRef') {
      const id = segments[0] || `auto_${autoIdCounter++}`;
      return makeDocRef(normalizePath([dbOrCol.path, id]));
    }
    return makeDocRef(normalizePath(segments));
  });

  const collection = vi.fn((_db, ...segments) => ({
    __type: 'colRef',
    path: normalizePath(segments),
  }));

  const collectionGroup = vi.fn((_db, groupName) => ({
    __type: 'colGroupRef',
    groupName,
  }));

  const query = vi.fn((target, ...constraints) => ({
    __type: 'query',
    target,
    constraints,
  }));

  const where = vi.fn((field, op, value) => ({ type: 'where', field, op, value }));
  const orderBy = vi.fn((field, dir = 'asc') => ({ type: 'orderBy', field, dir }));
  const limit = vi.fn((n) => ({ type: 'limit', n }));
  const startAfter = vi.fn((cursor) => ({ type: 'startAfter', cursor }));

  const getDoc = vi.fn(async (ref) => makeDocSnapshot(ref.path, store.get(ref.path)));
  const getDocs = vi.fn(async (qOrCol) => buildQuerySnapshot(qOrCol));

  const setDoc = vi.fn(async (ref, data, options) => {
    applySet(ref.path, data, options);
    notifyListeners([ref.path]);
  });

  const addDoc = vi.fn(async (colRef, data) => {
    const id = `doc_${autoIdCounter++}`;
    const path = normalizePath([colRef.path, id]);
    applySet(path, data, {});
    notifyListeners([path]);
    return makeDocRef(path);
  });

  const updateDoc = vi.fn(async (ref, updates) => {
    applyUpdate(ref.path, updates);
    notifyListeners([ref.path]);
  });

  const deleteDoc = vi.fn(async (ref) => {
    store.delete(ref.path);
    notifyListeners([ref.path]);
  });

  const onSnapshot = vi.fn((target, onNext) => {
    const listener = { target, onNext, active: true };
    listeners.add(listener);
    queueMicrotask(() => {
      if (!listener.active) return;
      if (target?.__type === 'docRef') {
        onNext(makeDocSnapshot(target.path, store.get(target.path)));
      } else {
        onNext(buildQuerySnapshot(target));
      }
    });
    return () => {
      listener.active = false;
      listeners.delete(listener);
    };
  });

  const writeBatch = vi.fn(() => {
    const ops = [];
    const paths = [];
    return {
      set: vi.fn((ref, data, opts) => {
        paths.push(ref.path);
        ops.push(() => applySet(ref.path, data, opts));
      }),
      update: vi.fn((ref, data) => {
        paths.push(ref.path);
        ops.push(() => applyUpdate(ref.path, data));
      }),
      delete: vi.fn((ref) => {
        paths.push(ref.path);
        ops.push(() => store.delete(ref.path));
      }),
      commit: vi.fn(async () => {
        ops.forEach((op) => op());
        notifyListeners(paths);
      }),
    };
  });

  const arrayUnion = vi.fn((...items) => ({ __sentinel: 'arrayUnion', items }));
  const arrayRemove = vi.fn((...items) => ({ __sentinel: 'arrayRemove', items }));
  const deleteField = vi.fn(() => ({ __sentinel: 'deleteField' }));
  const serverTimestamp = vi.fn(() => ({ __sentinel: 'serverTimestamp' }));

  class GeoPoint {
    constructor(latitude, longitude) {
      this.__type = 'geopoint';
      this.latitude = latitude;
      this.longitude = longitude;
    }
  }

  const Timestamp = {
    now: () => makeTimestamp(Date.now()),
    fromMillis: (ms) => makeTimestamp(ms),
  };

  return {
    db,
    store,
    listeners,
    seedDoc(path, data) {
      const normalized = normalizePath([path]);
      store.set(normalized, cloneValue(data));
      notifyListeners([normalized]);
    },
    getRawDoc(path) {
      return store.get(normalizePath([path]));
    },
    emitSnapshot() {
      notifyListeners();
    },
    reset() {
      store.clear();
      listeners.clear();
      autoIdCounter = 1;
      vi.clearAllMocks();
    },
    firestoreModule: {
      doc,
      collection,
      collectionGroup,
      query,
      where,
      orderBy,
      limit,
      startAfter,
      getDoc,
      getDocs,
      setDoc,
      addDoc,
      updateDoc,
      deleteDoc,
      onSnapshot,
      writeBatch,
      arrayUnion,
      arrayRemove,
      deleteField,
      serverTimestamp,
      GeoPoint,
      Timestamp,
    },
  };
}
