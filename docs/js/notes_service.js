/* ═══════════════════════════════════════════════════════════
   notes_service.js — Caster Notes data service

   Thin CRUD layer over the Supabase caster_notes table using
   the PostgREST API (same pattern as auth.js).

   Public API (window.NotesService):
     fetchNotes(eventKey, matchKey?, teamKey?)  — query notes
     insertNote(payload)                        — insert a row
   ═══════════════════════════════════════════════════════════ */

const NotesService = (() => {
    'use strict';

    const SUPABASE_URL  = 'https://dhbowudmzwzmmfbetmum.supabase.co';
    const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRoYm93dWRtend6bW1mYmV0bXVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4ODMwMjMsImV4cCI6MjA5ODQ1OTAyM30.QgkuH1-KYj9x1ZjPeDjk_Bhp-4XKN9EF4BdptrZb4AM';
    const REST_BASE     = SUPABASE_URL + '/rest/v1';

    // ── Helper: build headers with optional auth ───────────
    function _headers(prefer) {
        const h = {
            'apikey': SUPABASE_ANON,
            'Content-Type': 'application/json',
        };
        if (prefer) h['Prefer'] = prefer;
        // Attach JWT if authenticated (Auth module may not be loaded yet)
        if (typeof Auth !== 'undefined' && Auth.getAccessToken) {
            const token = Auth.getAccessToken();
            if (token) h['Authorization'] = `Bearer ${token}`;
        }
        if (!h['Authorization']) {
            h['Authorization'] = `Bearer ${SUPABASE_ANON}`;
        }
        return h;
    }

    // ── fetchNotes ─────────────────────────────────────────
    // Dynamically builds a PostgREST query:
    //   Always filters by event_key.
    //   If matchKey provided → also filters match_key.
    //   If teamKey provided  → also filters team_key.
    //   Results ordered newest-first.
    async function fetchNotes(eventKey, matchKey, teamKey) {
        if (!eventKey) throw new Error('eventKey is required');

        const params = new URLSearchParams();
        params.set('event_key', `eq.${eventKey}`);
        if (matchKey) params.set('match_key', `eq.${matchKey}`);
        if (teamKey)  params.set('team_key', `eq.${teamKey}`);
        params.set('order', 'created_at.desc');
        params.set('select', '*');

        const url = `${REST_BASE}/caster_notes?${params}`;
        const resp = await fetch(url, { headers: _headers() });

        if (!resp.ok) {
            const body = await resp.text();
            throw new Error(`fetchNotes failed (${resp.status}): ${body}`);
        }
        return resp.json();
    }

    // ── insertNote ─────────────────────────────────────────
    // payload: { event_key, match_key?, team_key?, author, content, type? }
    // Returns the inserted row.
    async function insertNote(payload) {
        if (!payload.event_key) throw new Error('event_key is required');
        if (!payload.author)    throw new Error('author is required');
        if (!payload.content)   throw new Error('content is required');

        const row = {
            event_key: payload.event_key,
            author:    payload.author,
            content:   payload.content,
            type:      payload.type || 'manual',
        };
        if (payload.match_key) row.match_key = payload.match_key;
        if (payload.team_key)  row.team_key  = payload.team_key;

        const url = `${REST_BASE}/caster_notes`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: _headers('return=representation'),
            body: JSON.stringify(row),
        });

        if (!resp.ok) {
            const body = await resp.text();
            throw new Error(`insertNote failed (${resp.status}): ${body}`);
        }
        const rows = await resp.json();
        return rows[0];
    }

    // ── Public API ─────────────────────────────────────────
    return { fetchNotes, insertNote };
})();
