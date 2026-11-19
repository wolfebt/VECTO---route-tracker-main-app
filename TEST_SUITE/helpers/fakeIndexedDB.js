let databases = new Map();

function cloneRecord(val) {
  if (val === null || val === undefined || typeof val !== 'object') return val;
  if (Array.isArray(val)) return val.map(cloneRecord);
  const copy = {};
  for (const [k, v] of Object.entries(val)) {
    copy[k] = cloneRecord(v);
  }
  return copy;
}

export function resetFakeIndexedDB() {
  databases = new Map();
}

export function installFakeIndexedDB() {
  resetFakeIndexedDB();

  const fakeIndexedDB = {
    open(name, version = 1) {
      const request = {
        result: null,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
      };

      queueMicrotask(() => {
        let dbRec = databases.get(name);
        const isUpgrade = !dbRec || dbRec.version < version;
        if (!dbRec) {
          dbRec = {
            name,
            version,
            stores: new Map(),
          };
          databases.set(name, dbRec);
        } else if (isUpgrade) {
          dbRec.version = version;
        }

        const dbHandle = {
          name: dbRec.name,
          version: dbRec.version,
          objectStoreNames: {
            contains: (storeName) => dbRec.stores.has(storeName),
          },
          createObjectStore: (storeName, opts = {}) => {
            if (!dbRec.stores.has(storeName)) {
              dbRec.stores.set(storeName, {
                keyPath: opts.keyPath || 'id',
                autoIncrement: Boolean(opts.autoIncrement),
                nextKey: 1,
                records: new Map(),
              });
            }
            return dbRec.stores.get(storeName);
          },
          transaction: (storeName) => {
            let pendingOps = 0;
            let completeScheduled = false;

            const tx = {
              oncomplete: null,
              onerror: null,
              error: null,
              objectStore: (requestedStore) => {
                const store = dbRec.stores.get(requestedStore || storeName);
                const scheduleOp = (fn) => {
                  const req = { result: undefined, error: null, onsuccess: null, onerror: null };
                  pendingOps += 1;
                  queueMicrotask(() => {
                    try {
                      req.result = fn();
                      req.onsuccess?.({ target: req });
                    } catch (err) {
                      req.error = err;
                      tx.error = err;
                      req.onerror?.({ target: req });
                      tx.onerror?.({ target: tx });
                    } finally {
                      pendingOps -= 1;
                      if (pendingOps === 0 && !completeScheduled) {
                        completeScheduled = true;
                        queueMicrotask(() => {
                          tx.oncomplete?.({ target: tx });
                        });
                      }
                    }
                  });
                  return req;
                };

                return {
                  add(record) {
                    return scheduleOp(() => {
                      const entry = cloneRecord(record);
                      const keyPath = store.keyPath || 'id';
                      let key = entry[keyPath];
                      if (key === undefined || key === null) {
                        key = store.nextKey++;
                        entry[keyPath] = key;
                      }
                      store.records.set(key, entry);
                      return key;
                    });
                  },
                  getAll() {
                    return scheduleOp(() =>
                      Array.from(store.records.values()).map((r) => cloneRecord(r))
                    );
                  },
                  delete(id) {
                    return scheduleOp(() => {
                      store.records.delete(id);
                      return undefined;
                    });
                  },
                };
              },
            };
            return tx;
          },
        };

        request.result = dbHandle;
        if (isUpgrade) {
          request.onupgradeneeded?.({ target: { result: dbHandle } });
        }
        request.onsuccess?.({ target: request });
      });

      return request;
    },
  };

  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    writable: true,
    value: fakeIndexedDB,
  });

  return fakeIndexedDB;
}
