/* ═══════════════════════════════════════════════════════════
   api.js — thin fetch wrapper for the backend
   ═══════════════════════════════════════════════════════════ */

const API = {
    async get(path) {
        const resp = await fetch(`/api${path}`);
        if (!resp.ok) {
            const body = await resp.json().catch(() => ({}));
            const detail = body.detail || '';
            // Build a user-friendly message based on status code
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
    worldRecord:  ()     => API.get('/events/world-record'),
};
