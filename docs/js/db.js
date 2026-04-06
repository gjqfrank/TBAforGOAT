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

   Public API (window.DB):
     initDB()                       — open / upgrade the database
     upsertRows(storeName, rows)    — batch put() into a store
     getMatchesByEvent(eventKey)    — query matches via index
     getNotesByTarget(targetKey)    — query notes via target_key index
     getOverridesByTeam(teamKey)    — query tims_overrides via team_key index
     generateLocalId()              — crypto.randomUUID() helper
   ═══════════════════════════════════════════════════════════ */

const DB = (() => {
    'use strict';

    const DB_NAME    = 'casters_tool_db';
    const DB_VERSION = 1;

    let _db = null;

    // ── Schema definition ──────────────────────────────────
    const STORES = [
        { name: 'events',         keyPath: 'event_key' },
        { name: 'teams',          keyPath: 'team_key' },
        { name: 'event_teams',    keyPath: ['event_key', 'team_key'], indexes: [{ name: 'team_key', keyPath: 'team_key', unique: false }] },
        { name: 'matches',        keyPath: 'match_key',  indexes: [{ name: 'event_key', keyPath: 'event_key', unique: false }] },
        { name: 'notes',          keyPath: 'id', indexes: [{ name: 'target_key', keyPath: 'target_key', unique: false }] },
        { name: 'tims_overrides', keyPath: 'id', indexes: [{ name: 'team_key', keyPath: 'team_key', unique: false }] },
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

    // ── generateLocalId ────────────────────────────────────
    function generateLocalId() {
        return crypto.randomUUID();
    }

    // ── Public API ─────────────────────────────────────────
    return {
        initDB,
        upsertRows,
        getMatchesByEvent,
        getNotesByTarget,
        getOverridesByTeam,
        generateLocalId,
    };
})();
