/* ═══════════════════════════════════════════════════════════
   sync.js — Network Sync Manager for TBAforGOAT

   Pulls delta payloads from POST /api/sync and pushes them
   into IndexedDB via DB.upsertRows().  Pushes local edits
   (notes, tims_overrides) upstream via the same endpoint.

   Assumes db.js and auth.js are loaded first
   (provides window.DB and window.Auth).

   Public API (window.Sync):
     pull(eventKey)        — fetch delta from server → IDB
     pushLocalEdits()      — upload pending offline edits
     getLastSync(eventKey) — last server_time for this event
     clearLastSync(eventKey)
   ═══════════════════════════════════════════════════════════ */

const Sync = (() => {
    'use strict';

    const SYNC_URL       = '/api/sync';
    const LS_PREFIX      = 'sync_ts_';   // localStorage key prefix for last_sync timestamps
    const SYNCABLE_STORES = ['events', 'teams', 'event_teams', 'matches', 'notes', 'tims_overrides'];

    // ── Last-sync timestamp helpers ────────────────────────
    function getLastSync(eventKey) {
        try { return localStorage.getItem(LS_PREFIX + eventKey) || null; }
        catch { return null; }
    }

    function _setLastSync(eventKey, serverTime) {
        try { localStorage.setItem(LS_PREFIX + eventKey, serverTime); }
        catch { /* quota exceeded — non-fatal */ }
    }

    function clearLastSync(eventKey) {
        try { localStorage.removeItem(LS_PREFIX + eventKey); }
        catch { /* ignore */ }
    }

    // ── Pull: server → IndexedDB ───────────────────────────
    async function pull(eventKey) {
        const lastSync = getLastSync(eventKey);

        const body = {
            event_key: eventKey,
            last_sync: lastSync,
            pending_edits: [],
        };

        let data;
        try {
            const headers = {
                'Content-Type': 'application/json',
                ...(typeof Auth !== 'undefined' ? Auth.getAuthHeader() : {}),
            };

            const resp = await fetch(SYNC_URL, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
            });

            if (!resp.ok) {
                const detail = await resp.text().catch(() => '');
                console.warn(`[Sync] pull failed (HTTP ${resp.status}): ${detail}`);
                return { ok: false, offline: false };
            }

            data = await resp.json();
        } catch (err) {
            // Network error — device is offline or server unreachable
            console.info('[Sync] Offline: relying on local IDB cache');
            return { ok: false, offline: true };
        }

        // Write each table's changed rows into IndexedDB
        const changes = data.changes || {};
        let totalRows = 0;

        for (const store of SYNCABLE_STORES) {
            const rows = changes[store];
            if (rows && rows.length > 0) {
                await DB.upsertRows(store, rows);
                totalRows += rows.length;
            }
        }

        // Persist the server timestamp for next delta
        if (data.server_time) {
            _setLastSync(eventKey, data.server_time);
        }

        console.log(`[Sync] pull ${eventKey}: ${totalRows} rows across ${Object.keys(changes).length} tables`);
        return { ok: true, offline: false, totalRows, serverTime: data.server_time };
    }

    // ── Push: local edits → server ─────────────────────────
    // Scaffold — will be fleshed out when TIMS/Notes editing lands
    async function pushLocalEdits() {
        console.log('[Sync] Checking for pending local edits to upload...');
        // TODO: read dirty rows from notes / tims_overrides,
        //       package as pending_edits, POST to /api/sync,
        //       mark rows as synced on success.
    }

    // ── Public API ─────────────────────────────────────────
    return {
        pull,
        pushLocalEdits,
        getLastSync,
        clearLastSync,
    };
})();
