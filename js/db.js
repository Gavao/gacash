// Wrapper minimale su IndexedDB. Tutto resta nel telefono: niente server, niente account, niente banca collegata.
// Store "moves": spese ed entrate. Store "photos": foto degli scontrini (a parte, così l'elenco resta leggero).
// Store "settings": categorie, spese fisse, preferenze (un record per chiave).
const DB_NAME = 'gacash';
const DB_VERSION = 1;

let opening;

function open() {
  return opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const conn = req.result;
      if (!conn.objectStoreNames.contains('moves')) conn.createObjectStore('moves', { keyPath: 'id' });
      if (!conn.objectStoreNames.contains('photos')) conn.createObjectStore('photos', { keyPath: 'id' });
      if (!conn.objectStoreNames.contains('settings')) conn.createObjectStore('settings', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(store, mode, fn) {
  const conn = await open();
  return new Promise((resolve, reject) => {
    const tx = conn.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export const db = {
  get: (store, key) => run(store, 'readonly', s => s.get(key)),
  all: store => run(store, 'readonly', s => s.getAll()),
  put: (store, value) => run(store, 'readwrite', s => s.put(value)),
  del: (store, key) => run(store, 'readwrite', s => s.delete(key)),
  clear: store => run(store, 'readwrite', s => s.clear()),
};

export const getSetting = async (key, fallback) => (await db.get('settings', key))?.value ?? fallback;
export const setSetting = (key, value) => db.put('settings', { key, value });
