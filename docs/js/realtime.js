/* ═══════════════════════════════════════════════════════════
   realtime.js — Supabase Realtime subscription manager

   Replaces all setInterval polling with push-based WebSocket
   updates via Supabase Realtime postgres_changes.

   Subscribes to:
     • event_teams (INSERT / UPDATE) — rankings, OPR, stats
     • matches     (INSERT / UPDATE) — scores, alliances, status

   Filters by event_key so each client only receives payloads
   for its currently-loaded event.

   Reconnection resilience:
     • Detects CHANNEL_ERROR / TIMED_OUT / CLOSED states
     • On reconnect (SUBSCRIBED after a gap), fires all registered
       reconciliation callbacks so the UI can re-fetch any state
       that may have been missed while offline.

   Public API (window.Realtime):
     subscribe(eventKey)   — open channels for the given event
     unsubscribe()         — tear down all channels
     isConnected()         — true when a channel is active and healthy
     onTeamChange(cb)      — register handler for event_teams changes
     onMatchChange(cb)     — register handler for matches changes
     onReconnect(cb)       — register handler for reconnection events
   ═══════════════════════════════════════════════════════════ */

const Realtime = (() => {
    'use strict';

    // ── Supabase project config (same as auth.js) ──────────
    const SUPABASE_URL  = 'https://qytovurlcjrpvlbmkyip.supabase.co';
    const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dG92dXJsY2pycHZsYm1reWlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDUzNDIsImV4cCI6MjA5MDk4MTM0Mn0.-nRiYhXoHtZ4kTZgarq8r-c4HUYj8gmbem5qMxVQ8Ss';

    let _client   = null;   // supabase-js client instance
    let _channel  = null;   // single multiplexed channel
    let _eventKey = null;   // currently subscribed event

    // ── Connection health tracking ─────────────────────────
    let _wasConnected  = false;  // true after first SUBSCRIBED
    let _isHealthy     = false;  // reflects live channel state
    let _reconnectTimer = null;  // backoff timer for resubscribe attempts
    const _RECONNECT_DELAY = 3000; // ms before attempting resubscribe

    const _teamListeners      = [];
    const _matchListeners     = [];
    const _reconnectListeners = [];

    // ── Lazy Supabase client init ──────────────────────────
    function _getClient() {
        if (_client) return _client;
        if (typeof supabase === 'undefined' || !supabase.createClient) {
            console.warn('[Realtime] Supabase SDK not loaded — falling back to polling');
            return null;
        }
        _client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
            realtime: { params: { eventsPerSecond: 10 } },
            // We only need realtime — disable unnecessary REST/auth overhead
            auth: { persistSession: false, autoRefreshToken: false },
        });
        return _client;
    }

    // ── Fire reconciliation callbacks ──────────────────────
    function _fireReconnect() {
        console.info('[Realtime] Reconnected — firing reconciliation for', _eventKey);
        for (const cb of _reconnectListeners) {
            try { cb(_eventKey); } catch (e) { console.warn('[Realtime] reconnect listener error', e); }
        }
    }

    // ── Subscribe to an event ──────────────────────────────
    function subscribe(eventKey) {
        if (!eventKey) return;

        // Tear down previous subscription first
        unsubscribe();

        const client = _getClient();
        if (!client) return;

        _eventKey = eventKey;
        _wasConnected = false;
        _isHealthy = false;

        // Single channel with two listeners, both filtered by event_key
        _channel = client
            .channel(`event:${eventKey}`)
            .on(
                'postgres_changes',
                {
                    event: '*',   // INSERT + UPDATE
                    schema: 'public',
                    table: 'event_teams',
                    filter: `event_key=eq.${eventKey}`,
                },
                (payload) => {
                    console.debug('[Realtime] event_teams change:', payload.eventType, payload.new?.team_key);
                    for (const cb of _teamListeners) {
                        try { cb(payload); } catch (e) { console.warn('[Realtime] team listener error', e); }
                    }
                }
            )
            .on(
                'postgres_changes',
                {
                    event: '*',   // INSERT + UPDATE
                    schema: 'public',
                    table: 'matches',
                    filter: `event_key=eq.${eventKey}`,
                },
                (payload) => {
                    console.debug('[Realtime] matches change:', payload.eventType, payload.new?.match_key);
                    for (const cb of _matchListeners) {
                        try { cb(payload); } catch (e) { console.warn('[Realtime] match listener error', e); }
                    }
                }
            )
            .subscribe((status, err) => {
                if (status === 'SUBSCRIBED') {
                    if (_wasConnected) {
                        // We were connected before → this is a RECONNECT.
                        // We may have missed events while offline.
                        console.warn('[Realtime] Reconnected after drop — reconciling state');
                        _fireReconnect();
                    } else {
                        console.info(`[Realtime] Connected — listening to ${eventKey}`);
                    }
                    _wasConnected = true;
                    _isHealthy = true;
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    console.warn(`[Realtime] Channel ${status}`, err);
                    _isHealthy = false;
                    // Supabase SDK has built-in reconnect, but if it fails
                    // after a delay, force a full resubscribe
                    _scheduleResubscribe(eventKey);
                } else if (status === 'CLOSED') {
                    console.warn('[Realtime] Channel closed unexpectedly');
                    _isHealthy = false;
                    _scheduleResubscribe(eventKey);
                }
            });
    }

    // ── Automatic resubscribe on persistent failure ────────
    function _scheduleResubscribe(eventKey) {
        if (_reconnectTimer) return; // already scheduled
        _reconnectTimer = setTimeout(() => {
            _reconnectTimer = null;
            // Only resubscribe if we're still supposed to be watching this event
            if (_eventKey === eventKey && !_isHealthy) {
                console.info('[Realtime] Attempting resubscribe for', eventKey);
                subscribe(eventKey);
            }
        }, _RECONNECT_DELAY);
    }

    // ── Unsubscribe & cleanup ──────────────────────────────
    function unsubscribe() {
        if (_reconnectTimer) {
            clearTimeout(_reconnectTimer);
            _reconnectTimer = null;
        }
        if (_channel) {
            const client = _getClient();
            if (client) {
                client.removeChannel(_channel);
            }
            _channel = null;
        }
        _eventKey = null;
        _wasConnected = false;
        _isHealthy = false;
    }

    // ── Connection status ──────────────────────────────────
    function isConnected() {
        return _channel !== null && _eventKey !== null && _isHealthy;
    }

    // ── Listener registration ──────────────────────────────
    function onTeamChange(cb)  { _teamListeners.push(cb); }
    function onMatchChange(cb) { _matchListeners.push(cb); }
    function onReconnect(cb)   { _reconnectListeners.push(cb); }

    // ── Public API ─────────────────────────────────────────
    return {
        subscribe,
        unsubscribe,
        isConnected,
        onTeamChange,
        onMatchChange,
        onReconnect,
    };
})();
