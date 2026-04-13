/* ═══════════════════════════════════════════════════════════
   db.js — Offline-first IndexedDB data layer for Caster's Tool
   
   Vanilla Promise wrapper around the raw IndexedDB API.
   No external dependencies.

   Stores mirror the backend Supabase schema:
     events        → keyPath: 'event_key'
     teams         → keyPath: 'team_key'
     event_teams   → keyPath: ['event_key', 'team_key']  (index: 'team_key')
     matches       → keyPath: 'match_key'  (index: 'event_key')
     notes         → keyPath: 'id'  (index: 'target_key')
     tims_overrides→ keyPath: 'id'  (index: 'team_key')

   Event cache (offline snapshots):
     event_cache   → keyPath: ['event_key', 'tab']  (index: 'event_key')
       Stores raw JSON data payloads per tab per event.
       No TTLs — data survives indefinitely for offline use.

   Public API (window.DB):
     initDB()                       — open / upgrade the database
     upsertRows(storeName, rows)    — batch put() into a store
     getMatchesByEvent(eventKey)    — query matches via index
     getNotesByTarget(targetKey)    — query notes via target_key index
     getOverridesByTeam(teamKey)    — query tims_overrides via team_key index
     putOverride(record)            — upsert a single tims_overrides record
     generateLocalId()              — crypto.randomUUID() helper
     cacheTab(eventKey, tab, data)  — store a tab's raw JSON payload
     getCachedTab(eventKey, tab)    — retrieve a single cached tab
     getCachedEvent(eventKey)       — retrieve all cached tabs for an event
     listCachedEvents()             — list all events with cached data
     removeCachedEvent(eventKey)    — delete all cached tabs for an event
   ═══════════════════════════════════════════════════════════ */

const DB = (() => {
    'use strict';

    const DB_NAME    = 'casters_tool_db';
    const DB_VERSION = 2;

    let _db = null;

    // ── Schema definition ──────────────────────────────────
    const STORES = [
        { name: 'events',         keyPath: 'event_key' },
        { name: 'teams',          keyPath: 'team_key' },
        { name: 'event_teams',    keyPath: ['event_key', 'team_key'], indexes: [{ name: 'team_key', keyPath: 'team_key', unique: false }] },
        { name: 'matches',        keyPath: 'match_key',  indexes: [{ name: 'event_key', keyPath: 'event_key', unique: false }] },
        { name: 'notes',          keyPath: 'id', indexes: [{ name: 'target_key', keyPath: 'target_key', unique: false }] },
        { name: 'tims_overrides', keyPath: 'id', indexes: [{ name: 'team_key', keyPath: 'team_key', unique: false }] },
        { name: 'event_cache',    keyPath: ['event_key', 'tab'], indexes: [{ name: 'event_key', keyPath: 'event_key', unique: false }] },
    ];

    // ── initDB ─────────────────────────────────────────────
    function initDB() {
        return new Promise((resolve, reject) => {
            if (_db) { resolve(_db); return; }

            const req = indexedDB.open(DB_NAME, DB_VERSION);

            req.onupgradeneeded = (e) => {
                const db = e.target.result;

                for (const def of STORES) {
                    if (db.objectStoreNames.contains(def.name)) continue;

                    const store = db.createObjectStore(def.name, { keyPath: def.keyPath });

                    if (def.indexes) {
                        for (const idx of def.indexes) {
                            store.createIndex(idx.name, idx.keyPath, { unique: idx.unique });
                        }
                    }
                }
            };

            req.onsuccess = () => {
                _db = req.result;

                _db.onclose = () => { _db = null; };

                resolve(_db);
            };

            req.onerror = () => reject(req.error);
        });
    }

    // ── upsertRows ─────────────────────────────────────────
    async function upsertRows(storeName, rows) {
        if (!rows || rows.length === 0) return;

        const db = await initDB();

        return new Promise((resolve, reject) => {
            const tx    = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);

            for (const row of rows) {
                store.put(row);
            }

            tx.oncomplete = () => resolve(rows.length);
            tx.onerror    = () => reject(tx.error);
            tx.onabort    = () => reject(tx.error);
        });
    }

    // ── getMatchesByEvent ──────────────────────────────────
    async function getMatchesByEvent(eventKey) {
        const db = await initDB();

        return new Promise((resolve, reject) => {
            const tx    = db.transaction('matches', 'readonly');
            const index = tx.objectStore('matches').index('event_key');
            const req   = index.getAll(eventKey);

            req.onsuccess = () => resolve(req.result || []);
            req.onerror   = () => reject(req.error);
        });
    }

    // ── getNotesByTarget ───────────────────────────────────
    async function getNotesByTarget(targetKey) {
        const db = await initDB();

        return new Promise((resolve, reject) => {
            const tx    = db.transaction('notes', 'readonly');
            const index = tx.objectStore('notes').index('target_key');
            const req   = index.getAll(targetKey);

            req.onsuccess = () => resolve(req.result || []);
            req.onerror   = () => reject(req.error);
        });
    }

    // ── getOverridesByTeam ─────────────────────────────────
    async function getOverridesByTeam(teamKey) {
        const db = await initDB();

        return new Promise((resolve, reject) => {
            const tx    = db.transaction('tims_overrides', 'readonly');
            const index = tx.objectStore('tims_overrides').index('team_key');
            const req   = index.getAll(teamKey);

            req.onsuccess = () => resolve(req.result || []);
            req.onerror   = () => reject(req.error);
        });
    }

    // ── getAllOverrides — batch read all overrides in a single transaction ──
    async function getAllOverrides() {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx  = db.transaction('tims_overrides', 'readonly');
            const req = tx.objectStore('tims_overrides').getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror   = () => reject(req.error);
        });
    }

    // ── putOverride ────────────────────────────────────────
    async function putOverride(record) {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx  = db.transaction('tims_overrides', 'readwrite');
            const req = tx.objectStore('tims_overrides').put(record);
            req.onsuccess = () => resolve(req.result);
            req.onerror   = () => reject(req.error);
        });
    }

    // ── generateLocalId ────────────────────────────────────
    function generateLocalId() {
        return crypto.randomUUID();
    }

    // ── Event Cache — offline tab snapshots ────────────────

    /**
     * Store a single tab's raw JSON data for an event.
     * Overwrites any existing entry for (event_key, tab).
     */
    async function cacheTab(eventKey, tab, data) {
        if (!eventKey || !tab || data == null) return;
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('event_cache', 'readwrite');
            tx.objectStore('event_cache').put({
                event_key: eventKey,
                tab: tab,
                data: data,
                saved_at: Date.now(),
            });
            tx.oncomplete = () => resolve(true);
            tx.onerror    = () => reject(tx.error);
        });
    }

    /**
     * Retrieve a single cached tab payload. Returns null on miss.
     */
    async function getCachedTab(eventKey, tab) {
        if (!eventKey || !tab) return null;
        try {
            const db = await initDB();
            return new Promise((resolve, reject) => {
                const tx  = db.transaction('event_cache', 'readonly');
                const req = tx.objectStore('event_cache').get([eventKey, tab]);
                req.onsuccess = () => resolve(req.result ? req.result.data : null);
                req.onerror   = () => reject(req.error);
            });
        } catch { return null; }
    }

    /**
     * Retrieve all cached tabs for an event as { tab: data, ... }.
     */
    async function getCachedEvent(eventKey) {
        if (!eventKey) return null;
        try {
            const db = await initDB();
            return new Promise((resolve, reject) => {
                const tx    = db.transaction('event_cache', 'readonly');
                const index = tx.objectStore('event_cache').index('event_key');
                const req   = index.getAll(eventKey);
                req.onsuccess = () => {
                    const rows = req.result || [];
                    if (!rows.length) { resolve(null); return; }
                    const out = {};
                    let latestSave = 0;
                    for (const r of rows) {
                        out[r.tab] = r.data;
                        if (r.saved_at > latestSave) latestSave = r.saved_at;
                    }
                    out._saved_at = latestSave;
                    resolve(out);
                };
                req.onerror = () => reject(req.error);
            });
        } catch { return null; }
    }

    /**
     * List all events that have cached data.
     * Returns [{ event_key, saved_at, tabs: [...] }, ...].
     */
    async function listCachedEvents() {
        try {
            const db = await initDB();
            return new Promise((resolve, reject) => {
                const tx  = db.transaction('event_cache', 'readonly');
                const req = tx.objectStore('event_cache').getAll();
                req.onsuccess = () => {
                    const rows = req.result || [];
                    // Group by event_key
                    const map = {};
                    for (const r of rows) {
                        if (!map[r.event_key]) map[r.event_key] = { event_key: r.event_key, saved_at: 0, tabs: [] };
                        map[r.event_key].tabs.push(r.tab);
                        if (r.saved_at > map[r.event_key].saved_at) map[r.event_key].saved_at = r.saved_at;
                    }
                    resolve(Object.values(map));
                };
                req.onerror = () => reject(req.error);
            });
        } catch { return []; }
    }

    /**
     * Delete all cached tabs for an event.
     */
    async function removeCachedEvent(eventKey) {
        if (!eventKey) return;
        try {
            const db = await initDB();
            return new Promise((resolve, reject) => {
                const tx    = db.transaction('event_cache', 'readwrite');
                const store = tx.objectStore('event_cache');
                const index = store.index('event_key');
                const req   = index.openCursor(eventKey);
                req.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (cursor) {
                        cursor.delete();
                        cursor.continue();
                    }
                };
                tx.oncomplete = () => resolve(true);
                tx.onerror    = () => reject(tx.error);
            });
        } catch { return false; }
    }

    // ── Public API ─────────────────────────────────────────
    return {
        initDB,
        upsertRows,
        getMatchesByEvent,
        getNotesByTarget,
        getOverridesByTeam,
        getAllOverrides,
        putOverride,
        generateLocalId,
        cacheTab,
        getCachedTab,
        getCachedEvent,
        listCachedEvents,
        removeCachedEvent,
    };
})();
