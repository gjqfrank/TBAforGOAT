/* ═══════════════════════════════════════════════════════════
   api.js — thin fetch wrapper for the backend
   ═══════════════════════════════════════════════════════════ */

// Backend API base URL — empty for same-origin (local dev),
// set via window.API_BASE in config.js for cross-origin deployment.
const API_BASE = window.API_BASE || '';

// ── In-flight request deduplication (client-side single-flight) ──
const _inflight = new Map();

const API = {
    async get(path) {
        // If an identical GET is already in-flight, piggyback on its promise
        if (_inflight.has(path)) return _inflight.get(path);

        const promise = API._fetch(path);
        _inflight.set(path, promise);
        try { return await promise; }
        finally { _inflight.delete(path); }
    },

    /** Raw fetch — callers should go through get() for dedup */
    async _fetch(path) {
        const resp = await fetch(`${API_BASE}/api${path}`);
        if (!resp.ok) {
            const body = await resp.json().catch(() => ({}));
            const detail = body.detail || '';
            let message;
            switch (resp.status) {
                case 429:
                    message = detail || 'Too many requests — please wait a moment and try again.';
                    break;
                case 502:
                    message = detail || 'Could not reach the data source. It may be temporarily down.';
                    break;
                case 503:
                    message = detail || 'A data source is temporarily unavailable. Please try again shortly.';
                    break;
                case 504:
                    message = detail || 'The request timed out. The data source may be slow — please try again.';
                    break;
                case 404:
                    message = detail || 'The requested resource was not found.';
                    break;
                default:
                    message = detail || `Request failed (HTTP ${resp.status}). Please try again.`;
            }
            const err = new Error(message);
            err.status = resp.status;
            err.retryAfter = body.retry_after || null;
            throw err;
        }
        return resp.json();
    },

    async put(path, body) {
        const resp = await fetch(`${API_BASE}/api${path}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            const err = new Error(data.detail || `Request failed (HTTP ${resp.status})`);
            err.status = resp.status;
            throw err;
        }
        return resp.json();
    },

    // ── Events ──────────────────────────────────────────
    seasonEvents:       (yr, includeOffseason) => API.get(`/events/season/${yr}${includeOffseason ? '?include_offseason=true' : ''}`),
    eventInfo:          (ek) => API.get(`/events/${ek}/info`),
    eventTeams:         (ek) => API.get(`/events/${ek}/teams`),
    eventSummary:       (ek) => API.get(`/events/${ek}/summary`),
    eventSummaryRefresh:(ek) => API.get(`/events/${ek}/summary/refresh-stats`),
    eventSummaryAwards: (ek) => API.get(`/events/${ek}/summary/awards`),
    eventSeasonAwards:  (ek) => API.get(`/events/${ek}/summary/season-awards`),
    eventAdvancement:   (ek) => API.get(`/events/${ek}/summary/advancement`),
    eventConnections:   (ek, allTime, teams) => {
        let url = `/events/${ek}/summary/connections?all_time=${allTime ? 'true' : 'false'}`;
        if (teams && teams.length) url += `&teams=${teams.join(',')}`;
        return API.get(url);
    },
    clearCache:         (ek) => API.get(`/events/${ek}/clear-cache`),
    refreshRankings:    (ek) => API.get(`/events/${ek}/refresh-rankings`),
    fastRankings:       (ek) => API.get(`/events/${ek}/fast-rankings`),

    // ── Matches ─────────────────────────────────────────
    playoffMatches: (ek) => API.get(`/matches/${ek}/playoffs`),
    allMatches:     (ek) => API.get(`/matches/${ek}/all`),
    fastScores:     (ek) => API.get(`/matches/${ek}/scores`),
    matchBreakdown: (mk) => API.get(`/matches/match/${mk}/breakdown`),
    teamPerf:       (ek, num) => API.get(`/matches/team-perf/${ek}/${num}`),
    playoffFirsts:  (ek) => API.get(`/matches/${ek}/playoff-firsts`),

    // ── Alliances ───────────────────────────────────────
    alliances: (ek) => API.get(`/alliances/${ek}`),

    // ── Teams ───────────────────────────────────────────
    teamStats: (num, year) =>
        API.get(`/teams/${num}/stats${year ? `?year=${year}` : ''}`),    teamAwardsSummary: (teamNums) =>
        API.get(`/teams/awards-summary?teams=${teamNums.join(',')}`),    headToHead: (a, b, year, allTime) =>
        API.get(`/teams/head-to-head/${a}/${b}${year ? `?year=${year}&` : '?'}all_time=${allTime ? 'true' : 'false'}`),

    // ── TIMS Overrides ──────────────────────────────────
    timsGet:     (teamKey) => API.get(`/teams/${teamKey}/tims-overrides`),
    timsPut:     (teamKey, body) => API.put(`/teams/${teamKey}/tims-overrides`, body),
    timsHistory: (teamKey) => API.get(`/teams/${teamKey}/tims-overrides/history`),
    timsDelete:  (teamKey) => fetch(`${API_BASE}/api/teams/${teamKey}/tims-overrides`, { method: 'DELETE' })
                     .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))),

    // ── Compare ─────────────────────────────────────────
    compareTeams: (ek, teamKeys) =>
        API.get(`/events/${ek}/compare?teams=${teamKeys.join(',')}`),

    // ── Region / Event History ──────────────────────────
    regionFacts:  (name) => API.get(`/events/region/${encodeURIComponent(name)}/facts`),
    regionsList:  ()     => API.get('/events/regions/list'),
    eventHistory: (ek)   => API.get(`/events/${ek}/history`),
    // ── GATool Community Updates ────────────────────────────
    gatoolUpdates: (ek)  => API.get(`/events/${ek}/gatool-updates`),
    // ── Regional Advancement Pool ───────────────────────
    regionalPool:      (season) => API.get(`/events/regional-pool/${season}`),
    regionalPoolEvent: (season, code) => API.get(`/events/regional-pool/${season}/${code}`),

    // ── Season ──────────────────────────────────────────
    worldRecord:       ()     => API.get('/events/world-record'),
    seasonHighScores:  (year) => API.get(`/events/season-high-scores?year=${year || 2026}`),

    // ── AI Storylines ───────────────────────────────────
    storylineStatus: () => API.get('/storylines/status'),
    generateStoryline: (payload) => fetch(`${API_BASE}/api/storylines/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    }).then(async resp => {
        if (!resp.ok) {
            const body = await resp.json().catch(() => ({}));
            const err = new Error(body.detail || `Storyline request failed (HTTP ${resp.status})`);
            err.status = resp.status;
            throw err;
        }
        return resp.json();
    }),
};
