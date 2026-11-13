'use strict';
// Paikallinen tietokanta (IndexedDB). Kaikki data pysyy laitteessa.
//   docs  – dokumentit (itselleluovutus / vika- ja puutelista)
//   items – havainnot (teksti + pikkukuva), indeksi docId
//   media – valokuvat ja äänimuistiot (ArrayBuffer), indeksit itemId ja docId
const DB = (() => {
  let dbp;

  function open() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const r = indexedDB.open('vikapuute', 1);
        r.onupgradeneeded = () => {
          const db = r.result;
          db.createObjectStore('docs', { keyPath: 'id' });
          db.createObjectStore('items', { keyPath: 'id' }).createIndex('docId', 'docId');
          const m = db.createObjectStore('media', { keyPath: 'id' });
          m.createIndex('itemId', 'itemId');
          m.createIndex('docId', 'docId');
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    }
    return dbp;
  }

  // Suorittaa fn:n transaktiossa; fn palauttaa IDBRequestin tai ei mitään.
  async function run(stores, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      const s = Array.isArray(stores) ? stores.map((n) => t.objectStore(n)) : t.objectStore(stores);
      const req = fn(s);
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = t.onabort = () => reject(t.error || new Error('Tietokantavirhe'));
    });
  }

  function deleteByIndex(store, indexName, key) {
    const cur = store.index(indexName).openCursor(IDBKeyRange.only(key));
    cur.onsuccess = () => {
      const c = cur.result;
      if (c) { c.delete(); c.continue(); }
    };
  }

  return {
    getDocs: async () => (await run('docs', 'readonly', (s) => s.getAll()))
      .sort((a, b) => (b.updated || 0) - (a.updated || 0)),
    getDoc: (id) => run('docs', 'readonly', (s) => s.get(id)),
    putDoc: (doc) => run('docs', 'readwrite', (s) => { s.put(doc); }),
    deleteDoc: (id) => run(['docs', 'items', 'media'], 'readwrite', ([d, i, m]) => {
      d.delete(id);
      deleteByIndex(i, 'docId', id);
      deleteByIndex(m, 'docId', id);
    }),

    getItems: async (docId) => (await run('items', 'readonly', (s) => s.index('docId').getAll(docId)))
      .sort((a, b) => a.num - b.num),
    getItem: (id) => run('items', 'readonly', (s) => s.get(id)),
    putItem: (item) => run('items', 'readwrite', (s) => { s.put(item); }),
    deleteItem: (id) => run(['items', 'media'], 'readwrite', ([i, m]) => {
      i.delete(id);
      deleteByIndex(m, 'itemId', id);
    }),

    getMedia: (id) => run('media', 'readonly', (s) => s.get(id)),
    putMedia: (media) => run('media', 'readwrite', (s) => { s.put(media); }),
    deleteMedia: (id) => run('media', 'readwrite', (s) => { s.delete(id); }),
  };
})();
