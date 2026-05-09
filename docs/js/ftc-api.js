/* ═══════════════════════════════════════════════════════════
   ftc-api.js — FTC Events API fetch wrapper
   ═══════════════════════════════════════════════════════════ */

// FTC seasons are named by their kickoff year (e.g. DECODE 2025-2026 = 2025).
// New season launches in early September; we roll over in August so things
// don't sit on a stale year for too long once the new game ships.
function currentFtcSeason(now) {
    const d = now || new Date();
    return d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
}

const FTC_API = {
    async get(path) {
        const resp = await fetch(`/api/ftc${path}`);
        if (!resp.ok) {
            const body = await resp.json().catch(() => ({}));
            const detail = body.detail || '';
            let message;
            switch (resp.status) {
                case 429:
                    message = detail || 'Too many requests — please wait a moment and try again.';
                    break;
                case 502:
                    message = detail || 'Could not reach the FTC data source.';
                    break;
                case 503:
                    message = detail || 'FTC data source is temporarily unavailable.';
                    break;
                case 504:
                    message = detail || 'The FTC request timed out — please try again.';
                    break;
                case 404:
                    message = detail || 'The requested FTC resource was not found.';
                    break;
                default:
                    message = detail || `FTC request failed (HTTP ${resp.status}).`;
            }
            const err = new Error(message);
            err.status = resp.status;
            throw err;
        }
        return resp.json();
    },

    // ── Events ──────────────────────────────────────────
    seasonEvents:       (yr, includeOffseason) => FTC_API.get(`/events/season/${yr}${includeOffseason ? '?include_offseason=true' : ''}`),
    seasonSummary:      (yr) => FTC_API.get(`/events/season/${yr}/summary`),
    eventInfo:          (ek) => FTC_API.get(`/events/${ek}/info`),
    eventTeams:         (ek) => FTC_API.get(`/events/${ek}/teams`),
    eventAwards:        (ek) => FTC_API.get(`/events/${ek}/awards`),
    eventPastAwards:    (ek) => FTC_API.get(`/events/${ek}/past-awards`),
    eventSeasonAwards:  (ek) => FTC_API.get(`/events/${ek}/season-awards`),
    clearCache:         (ek) => FTC_API.get(`/events/${ek}/clear-cache`),
    refreshRankings:    (ek) => FTC_API.get(`/events/${ek}/refresh-rankings`),
    fastRankings:       (ek) => FTC_API.get(`/events/${ek}/fast-rankings`),
    worldRecord:        (season) => FTC_API.get(`/events/world-record/${season || currentFtcSeason()}`),
    seasonHighScores:   (season) => FTC_API.get(`/events/season/high-scores?season=${season || currentFtcSeason()}&limit=10`),
    gatoolUpdates:      (ek) => FTC_API.get(`/events/${ek}/gatool-updates`),
    eventConnections:   (ek, allTime, teams) => {
        let url = `/events/${ek}/summary/connections?all_time=${allTime ? 'true' : 'false'}`;
        if (teams && teams.length) url += `&teams=${teams.join(',')}`;
        return FTC_API.get(url);
    },

    // ── Teams ────────────────────────────────────────────
    teamAwardsSummary:  (teamNums) => FTC_API.get(`/events/teams/awards-summary?teams=${teamNums.join(',')}`),
    teamLookup:         (num, season) => FTC_API.get(`/events/team/${num}?season=${season || currentFtcSeason()}`),
    teamOprHistory:     (num, season) => FTC_API.get(`/events/team/${num}/opr-history?season=${season || currentFtcSeason()}`),
    headToHead:         (a, b, _year, allTime) => FTC_API.get(`/events/teams/head-to-head/${a}/${b}?all_time=${allTime ? 'true' : 'false'}`),

    // ── Matches ─────────────────────────────────────────
    allMatches:     (ek) => FTC_API.get(`/matches/${ek}/all`),
    playoffMatches: (ek) => FTC_API.get(`/matches/${ek}/playoffs`),
    fastScores:     (ek) => FTC_API.get(`/matches/${ek}/scores`),
    matchBreakdown: (mk) => {
        // Parse match key: 2025ftcTRTUQ1_qm1 → event_key, level, num
        const [ek, rest] = mk.split('_');
        const levelMap = { qm: 'qual', sf: 'playoff', f: 'playoff' };
        const match = (rest || '').match(/^(qm|sf|f)(\d+)$/);
        if (!match) return Promise.resolve({ available: false });
        const level = levelMap[match[1]] || 'qual';
        const num = match[2];
        return FTC_API.get(`/matches/match/${ek}/${level}/${num}/breakdown`);
    },

    // ── Alliances ───────────────────────────────────────
    alliances: (ek) => FTC_API.get(`/alliances/${ek}`),
};
