/* ═══════════════════════════════════════════════════════════
   app.js — TBAforGOAT UI Controller
   ═══════════════════════════════════════════════════════════ */

// ── Toast notification system ──────────────────────────────
function showToast(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    // Trigger entrance animation
    requestAnimationFrame(() => toast.classList.add('toast-visible'));
    setTimeout(() => {
        toast.classList.remove('toast-visible');
        toast.addEventListener('transitionend', () => toast.remove());
    }, duration);
}

/** Render a team number: use number_display (e.g. "11-370") when available,
 *  with dashes rendered as a styled separator. Falls back to raw number. */
function _renderTeamNum(team) {
    const timsEntry = _timsCache[team.team_number];
    // When a TIMS cache entry exists, use its number_display exclusively (even
    // empty string, which means "cleared by editor" — don't fall through to a
    // potentially stale server-applied value sitting in teamsData).
    const nd = timsEntry !== undefined ? timsEntry.number_display : team.number_display;
    // Validate: must contain at least one digit (guards against garbage values
    // like "()" that can sneak in via Supabase if a previous save was buggy).
    if (!nd || !/\d/.test(nd)) return String(team.team_number);
    // Render dashes/hyphens as styled separators
    return nd.replace(/-/g, '<span class="num-sep">-</span>');
}

// ── Back to top button ─────────────────────────────────────

// ── Tag helpers & SVG icons ────────────────────────────────
function _parseTags(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.filter(Boolean);
    return raw.split(',').map(s => s.trim()).filter(Boolean);
}

const _pbpTagIcons = {
    hardware: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
    strategy: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a8 8 0 0 0-8 8c0 3 1.5 5.5 4 7v3h8v-3c2.5-1.5 4-4 4-7a8 8 0 0 0-8-8z"/><line x1="10" y1="22" x2="14" y2="22"/></svg>',
};

const _microTagIcons = {
    hardware: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
    strategy: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a8 8 0 0 0-8 8c0 3 1.5 5.5 4 7v3h8v-3c2.5-1.5 4-4 4-7a8 8 0 0 0-8-8z"/><line x1="10" y1="22" x2="14" y2="22"/></svg>',
};

/** Render an inline pill card for a list of tags (strategy / hardware) */
function _renderPbpTags(tags, title, cls) {
    if (!tags || !tags.length) return '';
    const icon = _pbpTagIcons[title.toLowerCase()] || '';
    return `<div class="pbp-attr-tag ${cls}" title="${title}">${icon}<span class="pbp-attr-text">${tags.map(t => _esc(t)).join(', ')}</span></div>`;
}

/** Render micro breakdown tags (tiny variant for breakdown cards) */
function _renderBdTags(teamNum) {
    const ov = _timsCache[teamNum];
    if (!ov) return '';
    const parts = [];
    const hw = _parseTags(ov.hardware);
    if (hw.length) parts.push(...hw.map(h => `<span class="bd-micro-tag" title="Hardware">${_microTagIcons.hardware}${_esc(h)}</span>`));
    const strat = _parseTags(ov.auto_strategy).concat(_parseTags(ov.teleop_strategy));
    if (strat.length) parts.push(...strat.map(s => `<span class="bd-micro-tag" title="Strategy">${_microTagIcons.strategy}${_esc(s)}</span>`));
    if (!parts.length) return '';
    return `<div class="bd-micro-tags">${parts.join('')}</div>`;
}

// ── Back to top button ─────────────────────────────────────
(function initBackToTop() {
    let ticking = false;
    window.addEventListener('scroll', () => {
        if (!ticking) {
            requestAnimationFrame(() => {
                const btn = document.getElementById('back-to-top');
                if (btn) btn.classList.toggle('hidden', window.scrollY < 400);
                ticking = false;
            });
            ticking = true;
        }
    }, { passive: true });
})();

// ── Presentation (fullscreen) mode ─────────────────────────
let presentationMode = false;
function togglePresentation() {
    presentationMode = !presentationMode;
    document.body.classList.toggle('presentation-mode', presentationMode);
    const exitHint = document.getElementById('presentation-exit');
    if (exitHint) exitHint.classList.toggle('hidden', !presentationMode);
    // Update button icon
    const btn = document.getElementById('fullscreen-btn');
    if (btn) {
        btn.innerHTML = presentationMode
            ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>'
            : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
        btn.title = presentationMode ? 'Exit Presentation Mode' : 'Presentation Mode';
    }
    // Auto-hide exit hint after 3s
    if (presentationMode && exitHint) {
        setTimeout(() => { if (presentationMode) exitHint.classList.add('fade-out'); }, 3000);
    } else if (exitHint) {
        exitHint.classList.remove('fade-out');
    }
}

// ── Switch to tab programmatically (used by empty state buttons) ──
function switchToTab(tabName) {
    const btn = document.querySelector(`.tab[data-tab="${tabName}"]`);
    if (btn) btn.click();
}

// ── Tab data loaded indicator dots ─────────────────────────
function updateTabDots() {
    const map = {
        'rankings': !!document.querySelector('#rankings-container:not(.hidden) #event-teams')?.innerHTML,
        'summary': !!summaryData,
        'playbyplay': !!pbpData?.matches?.length,
        'breakdown': renderedTabs.breakdown,
        'playoff': !!playoffData?.length,
        'alliance': !!allianceData?.length,
        'history': renderedTabs.history,
    };
    for (const [tab, hasData] of Object.entries(map)) {
        const btn = document.querySelector(`.tab[data-tab="${tab}"]`);
        if (btn) btn.classList.toggle('tab-has-data', hasData);
    }
    // Update mobile nav badges when tab dots update
    if (typeof updateMobileNavBadges === 'function') updateMobileNavBadges();
}

// ── Find latest scored match index ─────────────────────────
function findLatestScoredMatch(matches) {
    if (!matches || !matches.length) return 0;
    let latest = 0;
    for (let i = matches.length - 1; i >= 0; i--) {
        const m = matches[i];
        if (m.red?.score >= 0 || m.blue?.score >= 0 || m.winning_alliance) {
            latest = i;
            break;
        }
    }
    return latest;
}

// ── Tooltip positioning (fixed to viewport) ───────────────
document.addEventListener('mouseover', e => {
    // Find the closest .has-tooltip that directly contains the event target
    const badge = e.target.closest('.has-tooltip');
    if (!badge) return;

    // Only act on the innermost .has-tooltip (skip if target is inside a nested one)
    const tip = badge.querySelector(':scope > .custom-tooltip');
    if (!tip) return;

    // Don't reposition if mouse just moved within the same badge
    if (badge._tipActive) return;
    badge._tipActive = true;
    badge.addEventListener('mouseleave', function handler() {
        badge._tipActive = false;
        tip.style.display = '';
        badge.removeEventListener('mouseleave', handler);
    });

    // Force display to measure, but off-screen
    tip.style.display = 'block';
    tip.style.left = '-9999px';
    tip.style.top = '0';
    tip.classList.remove('above', 'below');

    const tipRect = tip.getBoundingClientRect();
    const badgeRect = badge.getBoundingClientRect();

    const spaceAbove = badgeRect.top;
    const gap = 8;
    let top, cls;

    if (spaceAbove >= tipRect.height + gap) {
        top = badgeRect.top - tipRect.height - gap;
        cls = 'above';
    } else {
        top = badgeRect.bottom + gap;
        cls = 'below';
    }

    let left = badgeRect.left + badgeRect.width / 2 - tipRect.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));

    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
    tip.classList.add(cls);
});

// ── Global double-click → Team Lookup ─────────────────────
const _TEAM_NUM_SELECTORS = [
    '.team-num', '.adv-team-num', '.pbp-team-number', '.top-team-num',
    '.high-score-team', '.summary-hof-num', '.prestige-entry-num',
    '.conn-team-num', '.rp-team-num'
];
// Selectors for elements that contain numeric data (scores, points, years)
// that should NOT trigger the text-selection team-lookup fallback.
const _NO_TEAM_FALLBACK_ZONES = [
    '.adv-col-total',       // advancement / regional pool total-points cells
    '.rp-event-code',       // regional pool event-score spans
    '.season-controls',     // event selector (year, week numbers)
    '#manual-entry-body',   // manual event code entry (year field)
    '.adv-table-district',  // district ranking tables (points, event counts)
    '.season-selected-bar', // selected-event confirmation bar
    '.event-section-header',// section headers (e.g. "2026 Season Events")
    '.pbp-score-group',     // PBP alliance scores / winner label
    '.pbp-match-label',     // PBP match number label (e.g. "Qual 12")
    '.pbp-alliance-opr',    // PBP alliance OPR sum
];
document.addEventListener('dblclick', e => {
    // Disable on touch devices — use long-press context menu instead
    if ('ontouchstart' in window && window.innerWidth <= 768) return;
    // Skip if inside an input/textarea/select
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    // Skip if inside lookup panels (floating or modal) or the Team tab
    if (e.target.closest('#float-lookup, #lookup-overlay, #tab-team, #team-stats')) return;
    // Skip if inside Breakdown robot cards (single-click is spotlight toggle there)
    if (e.target.closest('.bd-robot-card')) return;

    // 1. Check known team-number elements (explicit team-num classes)
    let el = e.target.closest(_TEAM_NUM_SELECTORS.join(','));
    if (el) {
        const num = parseInt(el.textContent.trim(), 10);
        if (num > 0 && num < 100000) { floatLookupQuick(num); return; }
    }
    // 2. Fallback: check if user selected text that looks like a team number,
    //    but NOT inside zones known to contain non-team numeric data.
    if (e.target.closest(_NO_TEAM_FALLBACK_ZONES.join(','))) return;
    const sel = window.getSelection().toString().trim();
    if (/^\d{1,5}$/.test(sel)) {
        const num = parseInt(sel, 10);
        if (num > 0 && num < 100000) floatLookupQuick(num);
    }
});

// ── Single-click on PbP team number → Team Storyline ──────
let _pbpTeamClickTimer = null;
document.addEventListener('click', e => {
    const el = e.target.closest('.pbp-team-number');
    if (!el) return;
    // Only act inside the PbP panel
    if (!el.closest('#pbp-container')) return;
    if (!_storylineAvailable || competitionMode !== 'frc') return;
    // Parse team number (ignore pick-role badge text)
    const num = parseInt(el.childNodes[0]?.textContent?.trim(), 10);
    if (!num || num <= 0) return;
    // Delay to let dblclick fire first — if dblclick fires, cancel storyline
    clearTimeout(_pbpTeamClickTimer);
    _pbpTeamClickTimer = setTimeout(() => generatePbpTeamStoryline(num), 250);
});
document.addEventListener('dblclick', e => {
    // Cancel pending single-click team storyline if user actually double-clicked
    if (e.target.closest('.pbp-team-number')) clearTimeout(_pbpTeamClickTimer);
}, true);

// ── Cross-file shared state ────────────────────────────────
// IMPORTANT: declared with `var` (not `let`/`const`) so other classic
// scripts (event_select.js, region_history.js, alliances.js, ...) loaded
// BEFORE app.js can safely reference these names without hitting a
// temporal-dead-zone ReferenceError ("Cannot access uninitialized
// variable" in Safari/WebKit). `var` at script top level hoists AND
// initializes the binding to `undefined` at script-instantiation time.
var currentEvent = null;   // event_key once loaded
var currentEventYear = null; // numeric year of the loaded event
var eventInfoData = null;  // cached event info for saving
var playoffData  = null;   // cached playoff matches
var allianceData = null;   // cached alliance data
var summaryData  = null;   // cached event summary
var _summaryRevalidatedAt = 0; // timestamp of last background revalidation
var _SUMMARY_REVALIDATE_COOLDOWN = 5 * 60_000; // 5 minutes
var pbpData      = null;   // cached play-by-play data
var pbpIndex     = 0;      // current match index
var highlightForeign = false; // settings: highlight international teams
var highlightRookie = false;   // settings: highlight rookie teams
var showOffseason = false;     // settings: show offseason events
var rankingsCompact = window.innerWidth <= 768;  // default compact on mobile
var rankingsShowSchool = false;   // toggle: show school/org column

var rankingsCardView = window.innerWidth <= 768;  // card view default on mobile
var allianceShowEpa = false;      // toggle: show EPA breakdown in alliance cards
var allianceShowPlayoff = false;  // toggle: show playoff ribbons/status
var allianceShowAvatars = true;  // toggle: show team avatars
var allianceShowNames = false;    // toggle: show team nicknames
var allianceShowAttrs = false;    // toggle: show team attribute tags in alliances
var pbpShowAwards = false;        // toggle: show blue banners + awards in PBP
var showPredictions = false;       // settings: show Statbotics win predictions in PBP
var showGatoolSponsors = false;    // settings: show GATool cloud sponsors in PBP
var _storylineAvailable = false;   // AI storylines feature flag (checked on load)
var eventCountry = '';         // home country of the currently loaded event
var eventRegion  = '';         // resolved region name for the loaded event
var historyData  = null;       // cached event history data
var regionData   = null;       // cached region facts
var bdData       = null;   // cached breakdown match list (same as pbpData)
var bdIndex      = 0;      // current breakdown match index
var bdCache      = {};     // match_key -> breakdown data
var bdPollTimer  = null;   // auto-poll timer for pending breakdowns
var bdListTimer  = null;   // timer for refreshing match list has_breakdown flags
var lastTeamData = null;   // cached last team lookup data for re-render
var BD_POLL_INTERVAL = 5_000;       // 5s — poll for breakdown availability
var BD_LIST_REFRESH  = 20_000;      // 20s — refresh match list flags

// PBP auto-refresh
var pbpRefreshTimer = null;         // setInterval id for PBP live refresh
var PBP_REFRESH_INTERVAL = 15_000; // 15s — poll for score/match updates

// Playoff auto-refresh
var playoffRefreshTimer = null;
var PLAYOFF_REFRESH_INTERVAL = 30_000; // 30s — poll for bracket updates

// Season events
var seasonEventsRaw = [];          // full list from backend
var seasonEventsFiltered = [];     // after applying region/week/search
var seasonDropdownIdx = -1;        // keyboard-highlighted index in dropdown

// Auto-refresh polling
var rankingsRefreshTimer = null;   // setInterval id for rankings polling
var currentEventStatus = null;     // 'ongoing' | 'completed' | 'upcoming' | null

// Track which tabs have been rendered from preloaded data
var renderedTabs = { playoff: false, alliance: false, playbyplay: false, breakdown: false, history: false };

// ── Realtime event handlers (replace setInterval polling) ──
let _rtRankDebounce = null;   // debounce timer for batched team changes
let _rtMatchDebounce = null;  // debounce timer for batched match changes
let _rtPendingRanks = false;  // deferred while tab hidden
let _rtPendingMatch = null;   // deferred payload while tab hidden

Realtime.onTeamChange((_payload) => {
    // Debounce: many team rows arrive in quick succession after a match completes
    clearTimeout(_rtRankDebounce);
    _rtRankDebounce = setTimeout(() => {
        if (currentEvent && currentEventStatus === 'ongoing') {
            // Skip DOM work when the tab is backgrounded; flush on visibility change.
            if (document.hidden) { _rtPendingRanks = true; return; }
            refreshRankings();
        }
    }, 500);
});

Realtime.onMatchChange((payload) => {
    // Debounce: match updates may arrive in a burst
    clearTimeout(_rtMatchDebounce);
    _rtMatchDebounce = setTimeout(() => {
        if (!currentEvent || currentEventStatus !== 'ongoing') return;
        if (document.hidden) { _rtPendingMatch = payload; return; }
        // PBP: refresh match data
        if (pbpData) pbpAutoRefresh();
        // Playoff: refresh bracket
        if (renderedTabs.playoff) playoffAutoRefresh();
        // Breakdown list: check for new has_breakdown flags
        if (renderedTabs.breakdown && bdData) refreshBdList();
        // Breakdown match: if current match just got a breakdown, re-fetch it
        if (bdPollTimer && bdData?.matches?.[bdIndex]) {
            const mk = bdData.matches[bdIndex].key;
            const nm = payload.new;
            if (nm && nm.match_key === mk && nm.score_breakdown) pollBdMatch();
        }
    }, 300);
});

// ── Delegated event handlers for the PBP container ────────
// One listener replaces dozens of inline `onclick`/`onchange` strings
// that were re-bound on every match render. Markup uses data-action
// attributes so the handler stays declarative.
(function _installPbpDelegation() {
    const container = document.getElementById('pbp-container');
    if (!container) return; // index.html may not have loaded yet (script order)

    container.addEventListener('click', (e) => {
        // .pbp-conn-range-toggle wrapper swallows clicks so the header
        // toggle doesn't fire when the user flips the range switch.
        if (e.target.closest('[data-action="stop"]')) {
            e.stopPropagation();
            return;
        }
        const more = e.target.closest('[data-action="toggle-more"]');
        if (more) {
            const extra = more.parentElement?.querySelector('.pbp-conn-extra');
            if (extra) {
                extra.classList.toggle('hidden');
                const expanded = !extra.classList.contains('hidden');
                more.textContent = expanded ? '− collapse' : `+${more.dataset.count} more`;
            }
            return;
        }
        const aw = e.target.closest('[data-action="toggle-awards"]');
        if (aw) { pbpToggleAwardsOverflow(aw); return; }
        if (e.target.closest('[data-action="toggle-conn"]')) {
            const c = document.getElementById('pbp-connections');
            c?.classList.toggle('pbp-conn-expanded');
        }
    });

    container.addEventListener('change', (e) => {
        const rng = e.target.closest('[data-action="toggle-range"]');
        if (rng) togglePbpConnRange(rng.checked);
    });
})();

// Flush deferred renders when the tab becomes visible again.
document.addEventListener('visibilitychange', () => {
    if (document.hidden || !currentEvent || currentEventStatus !== 'ongoing') return;
    if (_rtPendingRanks) {
        _rtPendingRanks = false;
        refreshRankings();
    }
    if (_rtPendingMatch) {
        const payload = _rtPendingMatch;
        _rtPendingMatch = null;
        if (pbpData) pbpAutoRefresh();
        if (renderedTabs.playoff) playoffAutoRefresh();
        if (renderedTabs.breakdown && bdData) refreshBdList();
        if (bdPollTimer && bdData?.matches?.[bdIndex]) {
            const mk = bdData.matches[bdIndex].key;
            const nm = payload.new;
            if (nm && nm.match_key === mk && nm.score_breakdown) pollBdMatch();
        }
    }
});

// ── Reconnection reconciliation (missed events during Wi-Fi drop) ──
Realtime.onReconnect((_eventKey) => {
    if (!currentEvent || currentEventStatus !== 'ongoing') return;
    console.info('[Realtime] Reconciling state after reconnect');
    // Re-fetch ALL live data to cover anything missed while offline
    refreshRankings();
    if (pbpData) pbpAutoRefresh();
    if (renderedTabs.playoff) playoffAutoRefresh();
    if (renderedTabs.breakdown && bdData) refreshBdList();
});

function resetEventData() {
    Realtime.unsubscribe();
    currentEvent = null;
    currentEventYear = null;
    currentEventStatus = null;
    eventInfoData = null;
    teamsData = null;
    playoffData = null;
    allianceData = null;
    summaryData = null;
    _summaryRevalidatedAt = 0;
    pbpData = null;
    pbpIndex = 0;
    bdData = null;
    bdIndex = 0;
    bdCache = {};
    historyData = null;
    regionData = null;
    renderedTabs = { playoff: false, alliance: false, playbyplay: false, breakdown: false, history: false };
    seasonEventsRaw = [];
    seasonEventsFiltered = [];

    // Stop any active polling
    stopRankingsPolling();
    stopPbpRefresh();
    stopPlayoffRefresh();
    if (typeof stopBdPolling === 'function') stopBdPolling();
    if (typeof stopBdListRefresh === 'function') stopBdListRefresh();

    // Clear UI
    hide('active-event-banner');
    const badge = document.getElementById('event-badge');
    if (badge) { badge.textContent = ''; badge.className = 'event-badge hidden'; }
    const search = document.getElementById('season-search');
    if (search) search.value = '';
}

// ── Settings ───────────────────────────────────────────────
function toggleSettings() {
    if (window.innerWidth <= 768) {
        openMobUtilPanel('settings');
        return;
    }
    document.getElementById('settings-menu').classList.toggle('hidden');
}
// Close settings when clicking outside
document.addEventListener('click', e => {
    const wrapper = e.target.closest('.settings-wrapper');
    const menu = e.target.closest('.settings-menu');
    if (!wrapper && !menu) document.getElementById('settings-menu')?.classList.add('hidden');
});

// ── Theme Toggle ───────────────────────────────────────────
function toggleTheme(isLight) {
    document.documentElement.setAttribute('data-theme', isLight ? 'light' : 'dark');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
}

// Restore saved theme on load
(function initTheme() {
    const saved = localStorage.getItem('theme');
    if (saved === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
        // Sync checkbox once DOM is ready
        document.addEventListener('DOMContentLoaded', () => {
            const cb = document.getElementById('toggle-theme');
            if (cb) cb.checked = true;
        });
    }
})();

// ── Competition Mode (FRC only) ────────────────────────────
const competitionMode = 'frc';
function getActiveAPI() { return API; }

function toggleHighlightForeign(on) {
    highlightForeign = on;
    applyForeignHighlight();
    // Re-render tabs that embed highlight logic at render time
    if (teamsData) $('event-teams').innerHTML = rankingsCardView ? renderTeamCards(teamsData) : renderTeamTable(teamsData, teamsSortCol, teamsSortAsc);
    if (allianceData) renderAlliances(allianceData);
    if (pbpData) renderPbpMatch();
}

function toggleHighlightRookie(on) {
    highlightRookie = on;
    applyRookieHighlight();
    if (teamsData) $('event-teams').innerHTML = rankingsCardView ? renderTeamCards(teamsData) : renderTeamTable(teamsData, teamsSortCol, teamsSortAsc);
    if (allianceData) renderAlliances(allianceData);
    if (pbpData) renderPbpMatch();
}

function toggleShowOffseason(on) {
    showOffseason = on;
    localStorage.setItem('showOffseason', on ? 'true' : 'false');
    // If turning on and we have no offseason events in the raw list, re-fetch from API
    if (on && !seasonEventsRaw.some(e => e.event_type === 99)) {
        refreshSeasonEventsFromAPI();
    } else {
        filterSeasonEvents();
        populateSeasonFilters();
    }
    // Re-render team lookup if one is displayed
    if (lastTeamData) {
        $('team-stats').innerHTML = renderTeamStats(lastTeamData);
    }
}

// Restore saved offseason preference on load
(function initOffseason() {
    const saved = localStorage.getItem('showOffseason');
    if (saved === 'true') {
        showOffseason = true;
        document.addEventListener('DOMContentLoaded', () => {
            const cb = document.getElementById('toggle-offseason');
            if (cb) cb.checked = true;
        });
    }
})();

// ── PBP Awards Toggle ──────────────────────────────────────
let _pbpAwardsCache = {};  // team_number -> awards data

function togglePbpAwards(on) {
    pbpShowAwards = on;
    localStorage.setItem('pbpShowAwards', on ? 'true' : 'false');
    if (pbpData && pbpData.matches && pbpData.matches.length) {
        renderPbpMatch();
    }
}

function toggleShowPredictions(on) {
    showPredictions = on;
    localStorage.setItem('showPredictions', on ? 'true' : 'false');
    if (pbpData && pbpData.matches && pbpData.matches.length) {
        renderPbpMatch();
    }
}

// Restore saved PBP awards preference on load
(function initPbpAwards() {
    const saved = localStorage.getItem('pbpShowAwards');
    if (saved === 'true') {
        pbpShowAwards = true;
        document.addEventListener('DOMContentLoaded', () => {
            const cb = document.getElementById('toggle-pbp-awards');
            if (cb) cb.checked = true;
        });
    }
})();

// Restore saved predictions preference on load
(function initPredictions() {
    const saved = localStorage.getItem('showPredictions');
    if (saved === 'true') {
        showPredictions = true;
        document.addEventListener('DOMContentLoaded', () => {
            const cb = document.getElementById('toggle-predictions');
            if (cb) cb.checked = true;
        });
    }
})();

// ── Show Team Attributes Toggle (robot name, strategy, hardware) ──
let showTeamAttrs = false;

function toggleTeamAttrs(on) {
    showTeamAttrs = on;
    localStorage.setItem('showTeamAttrs', on ? 'true' : 'false');
    document.body.classList.toggle('show-team-attrs', on);
    if (pbpData && pbpData.matches && pbpData.matches.length) {
        renderPbpMatch();
    }
}

(function initTeamAttrs() {
    const saved = localStorage.getItem('showTeamAttrs');
    if (saved === 'true') {
        showTeamAttrs = true;
        document.addEventListener('DOMContentLoaded', () => {
            const cb = document.getElementById('toggle-team-attrs');
            if (cb) cb.checked = true;
            document.body.classList.add('show-team-attrs');
        });
    }
})();

// ── Hide Stats Toggle ──────────────────────────────────────
let hideStats = false;

function toggleHideStats(on) {
    hideStats = on;
    localStorage.setItem('hideStats', on ? 'true' : 'false');
    document.body.classList.toggle('hide-stats', on);
}

(function initHideStats() {
    const saved = localStorage.getItem('hideStats');
    if (saved === 'true') {
        hideStats = true;
        document.addEventListener('DOMContentLoaded', () => {
            const cb = document.getElementById('toggle-hide-stats');
            if (cb) cb.checked = true;
            document.body.classList.add('hide-stats');
        });
    }
})();

// ── GATool Sponsors Toggle ─────────────────────────────────
let _gatoolUpdatesCache = {};  // event_key -> {teamNumber: updates}
let sponsorFirstOnly = false;  // hide sponsors after team's first appearance
let _sponsorsShownTeams = new Set();  // tracks teams whose sponsors were already displayed

function toggleGatoolSponsors(on) {
    showGatoolSponsors = on;
    localStorage.setItem('showGatoolSponsors', on ? 'true' : 'false');
    document.body.classList.toggle('show-sponsors', on);
    // Show/hide the sub-toggle
    const row = document.getElementById('sponsor-first-only-row');
    if (row) row.style.display = on ? '' : 'none';
    _sponsorsShownTeams.clear();
    if (pbpData && pbpData.matches && pbpData.matches.length) {
        renderPbpMatch();
    }
}

function toggleSponsorFirstOnly(on) {
    sponsorFirstOnly = on;
    localStorage.setItem('sponsorFirstOnly', on ? 'true' : 'false');
    _sponsorsShownTeams.clear();
    if (pbpData && pbpData.matches && pbpData.matches.length) {
        renderPbpMatch();
    }
}

// Restore saved GATool sponsors preference on load
(function initGatoolSponsors() {
    const saved = localStorage.getItem('showGatoolSponsors');
    if (saved === 'true') {
        showGatoolSponsors = true;
        document.addEventListener('DOMContentLoaded', () => {
            const cb = document.getElementById('toggle-gatool-sponsors');
            if (cb) cb.checked = true;
            const row = document.getElementById('sponsor-first-only-row');
            if (row) row.style.display = '';
            document.body.classList.add('show-sponsors');
        });
    }
    const savedFirst = localStorage.getItem('sponsorFirstOnly');
    if (savedFirst === 'true') {
        sponsorFirstOnly = true;
        document.addEventListener('DOMContentLoaded', () => {
            const cb = document.getElementById('toggle-sponsor-first-only');
            if (cb) cb.checked = true;
        });
    }
})();

async function _fetchGatoolUpdates(eventKey) {
    if (_gatoolUpdatesCache[eventKey]) return _gatoolUpdatesCache[eventKey];
    try {
        const data = await API.gatoolUpdates(eventKey);
        _gatoolUpdatesCache[eventKey] = data || {};
        return _gatoolUpdatesCache[eventKey];
    } catch {
        _gatoolUpdatesCache[eventKey] = {};
        return {};
    }
}

async function _injectGatoolSponsors(teams, matchIdx) {
    if (!currentEvent) return;
    const updates = await _fetchGatoolUpdates(currentEvent);
    // Guard: user may have navigated to a different match during the fetch
    if (pbpIndex !== matchIdx) return;

    // Build set of teams that appeared in earlier matches (for first-appearance mode)
    if (sponsorFirstOnly && pbpData?.matches) {
        _sponsorsShownTeams.clear();
        for (let i = 0; i < matchIdx; i++) {
            const pm = pbpData.matches[i];
            for (const t of [...(pm.red?.teams || []), ...(pm.blue?.teams || [])]) {
                const td = updates[t.team_number];
                if (td && td.topSponsorsLocal) _sponsorsShownTeams.add(t.team_number);
            }
        }
    }

    for (const t of teams) {
        // Skip if TIMS sponsors already injected
        const ov = _timsCache[t.team_number];
        if (ov && ov.top_sponsors) continue;

        // Skip if already shown in an earlier match
        if (sponsorFirstOnly && _sponsorsShownTeams.has(t.team_number)) continue;

        const teamData = updates[t.team_number];
        if (!teamData) continue;
        const sponsors = teamData.topSponsorsLocal || '';
        if (!sponsors) continue;

        const slot = document.querySelector(`.pbp-sponsors-slot[data-sponsors-team="${t.team_number}"]`);
        if (!slot) continue;

        slot.innerHTML = `<div class="pbp-sponsors" title="Sponsors (via GATool)">
            <svg class="pbp-sponsors-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            <span class="pbp-sponsors-text">${sponsors}</span>
        </div>`;
    }
}

function applyForeignHighlight() {
    // Scope to PBP + rankings containers — a full-document query walks
    // every node in the page on every settings toggle / re-render.
    const roots = [
        document.getElementById('pbp-arena'),
        document.getElementById('pbp-container'),
        document.getElementById('event-teams'),
    ].filter(Boolean);
    for (const root of roots) {
        root.querySelectorAll('[data-country]').forEach(el => {
            const c = el.dataset.country;
            const isLocal = !c || (eventCountry && c === eventCountry);
            if (highlightForeign && !isLocal) {
                el.classList.add('foreign-team');
            } else {
                el.classList.remove('foreign-team');
            }
        });
    }
}

function applyRookieHighlight() {
    const roots = [
        document.getElementById('pbp-arena'),
        document.getElementById('pbp-container'),
        document.getElementById('event-teams'),
    ].filter(Boolean);
    for (const root of roots) {
        root.querySelectorAll('[data-rookie-year]').forEach(el => {
            const ry = parseInt(el.dataset.rookieYear, 10);
            if (highlightRookie && ry && currentEventYear && ry >= currentEventYear) {
                el.classList.add('rookie-team');
            } else {
                el.classList.remove('rookie-team');
            }
        });
    }
}

// ── Tab scroll fade indicators ─────────────────────────────
(() => {
    const wrap = document.querySelector('.tabs-wrap');
    const tabs = document.querySelector('.tabs');
    if (!wrap || !tabs) return;
    function updateFades() {
        const sl = tabs.scrollLeft, sw = tabs.scrollWidth, cw = tabs.clientWidth;
        wrap.classList.toggle('scroll-left', sl > 4);
        wrap.classList.toggle('scroll-right', sl + cw < sw - 4);
    }
    tabs.addEventListener('scroll', updateFades, { passive: true });
    window.addEventListener('resize', updateFades);
    // Run on next frame so layout is ready
    requestAnimationFrame(updateFades);
})();

// ── Tab switching ──────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
        btn.classList.add('active');
        btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');

        // Update URL with current tab
        _syncUrl({ tab: btn.dataset.tab });

        // Stop breakdown polling when leaving the breakdown tab
        if (btn.dataset.tab !== 'breakdown') { stopBdPolling(); stopBdListRefresh(); }

        // Stop PBP live refresh when leaving the PBP tab
        if (btn.dataset.tab !== 'playbyplay') { stopPbpRefresh(); }

        // Unmount Battle Station when leaving its tab
        if (btn.dataset.tab !== 'battlestation' && typeof BattleStation !== 'undefined') {
            BattleStation.unmount();
        }

        // Stop playoff refresh when leaving the playoff tab
        if (btn.dataset.tab !== 'playoff') { stopPlayoffRefresh(); }

        // Clear compare selection when leaving Rankings tab
        if (btn.dataset.tab !== 'rankings') { clearCompareSelection(); }

        // Auto-load data when switching to dependent tabs
        if (btn.dataset.tab === 'summary' && currentEvent) {
            if (summaryData && summaryData.demographics) {
                hide('summary-empty');
                hideSkeleton('summary-loading');
                // Only re-render if not already rendered
                const sc = $('summary-container');
                if (!sc || !sc.querySelector('.summary-card:not(.hidden)')) {
                    renderSummary(summaryData);
                }
                sc && sc.classList.remove('hidden');
                // Stale-while-revalidate: for ongoing events, silently refresh in background (5-min cooldown)
                if (currentEventStatus === 'ongoing' && Date.now() - _summaryRevalidatedAt > _SUMMARY_REVALIDATE_COOLDOWN) {
                    _summaryRevalidatedAt = Date.now();
                    const _code = currentEvent;
                    API.eventSummary(_code).then(freshData => {
                        if (currentEvent !== _code) return;
                        if (freshData.error || !freshData.demographics) return;
                        summaryData = freshData;
                        renderSummary(freshData);
                        autoCacheTab('summary', freshData);
                    }).catch(() => {});
                }
            } else if (summaryData === null) {
                // Optimistic skeleton — data not fetched yet
                hide('summary-empty');
                hideInlineError('summary-error');
                showSkeleton('summary-loading', 'summary-loading-status', 'Fetching event summary\u2026');
                loadSummary();
            } else {
                // summaryData exists but has no demographics — pre-fetch may be in flight
                hide('summary-empty');
                showSkeleton('summary-loading', 'summary-loading-status', 'Loading summary\u2026');
            }
        }

        // Lightweight tabs: render from preloaded cache, or fetch if missing
        if (btn.dataset.tab === 'playoff' && currentEvent) {
            if (!renderedTabs.playoff) {
                if (playoffData?.length) {
                    hide('playoff-empty');
                    hideSkeleton('playoff-loading');
                    renderBracketTree();
                    fadeIn('playoff-bracket');
                    renderedTabs.playoff = true;
                } else {
                    // Optimistic skeleton
                    hide('playoff-empty');
                    hideInlineError('playoff-error');
                    showSkeleton('playoff-loading', 'playoff-loading-status', 'Loading playoff bracket\u2026');
                    loadPlayoffs();
                }
            }
            startPlayoffRefresh();
        }
        if (btn.dataset.tab === 'alliance' && currentEvent && !renderedTabs.alliance) {
            if (allianceData?.alliances?.length) {
                hide('alliance-empty');
                hideSkeleton('alliance-loading');
                renderAlliances(allianceData);
                fadeIn('alliance-grid');
                renderedTabs.alliance = true;
            } else {
                // Optimistic skeleton
                hide('alliance-empty');
                hideInlineError('alliance-error');
                showSkeleton('alliance-loading', 'alliance-loading-status', 'Fetching alliances\u2026');
                loadAlliances();
            }
        }
        if (btn.dataset.tab === 'goatscout' && currentEvent) {
            if (typeof renderGoatScoutTab === 'function') renderGoatScoutTab();
        }
        if (btn.dataset.tab === 'playbyplay' && currentEvent && !renderedTabs.playbyplay) {
            if (pbpData?.matches?.length) {
                pbpIndex = findLatestScoredMatch(pbpData.matches);
                hide('pbp-empty');
                hideSkeleton('pbp-loading');
                show('pbp-container');
                buildPbpSelector();
                renderPbpMatch();
                fadeIn('pbp-container');
                renderedTabs.playbyplay = true;
                startPbpRefresh();
            } else if (currentEventStatus === 'upcoming') {
                hide('pbp-container');
                hideSkeleton('pbp-loading');
                const el = $('pbp-empty');
                if (el) {
                    el.textContent = 'The match schedule for this event has not been published yet.';
                    el.classList.remove('hidden');
                }
            } else {
                // Optimistic skeleton
                hide('pbp-empty');
                hideInlineError('pbp-error');
                showSkeleton('pbp-loading', 'pbp-loading-status', 'Loading match data\u2026');
                loadPlayByPlay();
            }
        }
        if (btn.dataset.tab === 'battlestation' && currentEvent) {
            if (typeof BattleStation !== 'undefined') BattleStation.mount();
        }
        if (btn.dataset.tab === 'breakdown' && currentEventYear && currentEventYear < 2025) {
            // Pre-2025: show unavailable message, skip loading
            hide('bd-container');
            const el = $('bd-empty');
            if (el) {
                el.innerHTML = 'Score breakdown is only available for 2025 events onwards.';
                el.classList.remove('hidden');
            }
        } else if (btn.dataset.tab === 'breakdown' && currentEvent && !renderedTabs.breakdown) {
            if (bdData?.matches?.length) {
                // Check pending match key from URL deep-link
                if (_pendingMatchKey && !_pendingBdIndex) {
                    const mi = bdData.matches.findIndex(m => m.key && m.key.includes(_pendingMatchKey));
                    if (mi >= 0) { _pendingBdIndex = mi; }
                    _pendingMatchKey = null;
                }
                bdIndex = _pendingBdIndex != null ? _pendingBdIndex : 0;
                _pendingBdIndex = null;
                bdCache = {};
                hide('bd-empty');
                hideSkeleton('bd-loading');
                show('bd-container');
                buildBdSelector();
                loadBdMatch();
                startBdListRefresh();
                fadeIn('bd-container');
                renderedTabs.breakdown = true;
            } else if (currentEventStatus === 'upcoming') {
                hide('bd-container');
                hideSkeleton('bd-loading');
                const el = $('bd-empty');
                if (el) {
                    el.textContent = 'The match schedule for this event has not been published yet.';
                    el.classList.remove('hidden');
                }
            } else {
                // Optimistic skeleton
                hide('bd-empty');
                hideInlineError('bd-error');
                showSkeleton('bd-loading', 'bd-loading-status', 'Loading breakdowns\u2026');
                loadBreakdownTab();
            }
        }
        // Re-entering PBP tab after it was already loaded — resume live refresh
        if (btn.dataset.tab === 'playbyplay' && renderedTabs.playbyplay && pbpData) {
            renderPbpMatch();  // re-render with any scores updated while away
            startPbpRefresh();
            // Fetch fresh data immediately instead of waiting for next interval
            if (currentEventStatus === 'ongoing') pbpAutoRefresh();
        }

        // Re-entering breakdown tab after it was already loaded — resume timers
        if (btn.dataset.tab === 'breakdown' && renderedTabs.breakdown && bdData) {
            if (_pendingBdIndex != null) {
                bdIndex = _pendingBdIndex;
                _pendingBdIndex = null;
                if ($('bd-match-select')) $('bd-match-select').value = bdIndex;
                loadBdMatch();
            }
            startBdListRefresh();
            // If current match still has no breakdown, resume polling
            const cm = bdData.matches[bdIndex];
            if (cm && !cm.has_breakdown) startBdPolling();
        }

        // Re-entering Rankings tab — immediate refresh for ongoing events
        if (btn.dataset.tab === 'rankings' && currentEvent && currentEventStatus === 'ongoing') {
            refreshRankings();
        }

        // ── History tab ──
        if (btn.dataset.tab === 'history' && currentEvent && !renderedTabs.history) {
            hide('history-empty');
            hideInlineError('history-error');
            showSkeleton('history-loading', 'history-loading-status', 'Loading region & event history\u2026');
            loadHistory();
        }
    });
});

// Allow enter key in inputs
document.getElementById('event-year')?.addEventListener('keydown', e => { if (e.key === 'Enter') loadEvent(); });
document.getElementById('event-code')?.addEventListener('keydown', e => { if (e.key === 'Enter') loadEvent(); });

// ── Restore event from URL params or localStorage ─────────
// Initialize IndexedDB for offline data layer
if (typeof DB !== 'undefined') DB.initDB().catch(() => {});

(function restoreEvent() {
    // URL ?event= takes priority over localStorage (shareable links)
    const urlParams = new URLSearchParams(location.search);
    const urlEvent = urlParams.get('event');
    let year, eventCode;

    if (urlEvent && /^\d{4}[a-z0-9]+$/i.test(urlEvent)) {
        year = urlEvent.substring(0, 4);
        eventCode = urlEvent.substring(4);
    } else {
        const saved = localStorage.getItem('selectedEvent');
        if (!saved) return;
        try {
            ({ year, eventCode } = JSON.parse(saved));
            if (!year || !eventCode) return;
        } catch (_) { return; }
    }

    const apply = () => {
        const yEl = document.getElementById('event-year');
        const cEl = document.getElementById('event-code');
        if (yEl) yEl.value = year;
        if (cEl) cEl.value = eventCode;
        loadEvent();
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', apply);
    } else {
        apply();
    }
})();
document.getElementById('team-number')?.addEventListener('keydown', e => { if (e.key === 'Enter') loadTeam(); });
document.getElementById('h2h-team-b')?.addEventListener('keydown', e => { if (e.key === 'Enter') loadH2H(); });

// ── Check AI Storyline availability ────────────────────────
(async function checkStorylineStatus() {
    try {
        const res = await API.storylineStatus();
        _storylineAvailable = res && res.available === true;
    } catch { _storylineAvailable = false; }
})();

// ── Arrow key navigation for Play by Play & Score Breakdown ──
document.addEventListener('keydown', e => {
    // Skip if user is typing in an input/select/textarea
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const pbpActive = $('tab-playbyplay')?.classList.contains('active');
        const bdActive  = $('tab-breakdown')?.classList.contains('active');
        if (pbpActive && pbpData) {
            e.preventDefault();
            e.key === 'ArrowLeft' ? pbpPrev() : pbpNext();
        } else if (bdActive && bdData) {
            e.preventDefault();
            e.key === 'ArrowLeft' ? bdPrev() : bdNext();
        }
    }

    // C key — Compare Teams on Play by Play (toggle)
    if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!$('compare-overlay')?.classList.contains('hidden')) {
            e.preventDefault();
            closeCompare();
            return;
        }
        const pbpActive = $('tab-playbyplay')?.classList.contains('active');
        if (pbpActive && pbpData && pbpData.matches.length) {
            e.preventDefault();
            compareCurrentMatch();
        }
    }

    // B key — Go to Breakdown from Play by Play
    if ((e.key === 'b' || e.key === 'B') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const pbpActive = $('tab-playbyplay')?.classList.contains('active');
        if (pbpActive && pbpData && pbpData.matches.length) {
            e.preventDefault();
            goToBreakdownFromPbp();
        }
    }

    // S key — Generate AI Storyline on Play by Play
    if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const pbpActive = $('tab-playbyplay')?.classList.contains('active');
        if (pbpActive && pbpData && pbpData.matches.length && _storylineAvailable) {
            e.preventDefault();
            generateMatchStoryline();
        }
    }

    // Number keys 1-9 — quick tab switching
    if (e.key >= '1' && e.key <= '9' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tabs = document.querySelectorAll('.tab');
        const idx = parseInt(e.key) - 1;
        if (idx < tabs.length) {
            e.preventDefault();
            tabs[idx].click();
        }
    }

    // Escape — exit presentation mode
    if (e.key === 'Escape' && presentationMode) {
        togglePresentation();
        return;
    }

    // F key — toggle presentation mode
    if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        togglePresentation();
    }
});

// ── Restore tab from URL on load ──────────────────────────
let _pendingTabHash = null;
let _pendingUrlState = null;
(function captureUrlState() {
    const params = new URLSearchParams(location.search);
    const hash = location.hash.replace('#', '');
    if (hash && hash !== 'event') _pendingTabHash = hash;
    // Also capture tab from ?tab= param (takes priority)
    const tabParam = params.get('tab');
    if (tabParam) _pendingTabHash = tabParam;
    // Capture other state for deferred restoration
    _pendingUrlState = {
        match: params.get('match'),
        compare: params.get('compare'),
        sort: params.get('sort'),
    };
})();

/** Build the current shareable URL from app state */
function _buildShareUrl(overrides = {}) {
    const params = new URLSearchParams();
    const event = overrides.event ?? currentEvent;
    if (event) params.set('event', event);
    // Tab: use hash
    const tab = overrides.tab ?? document.querySelector('.tab.active')?.dataset.tab;
    // Match (PBP or Breakdown)
    const matchKey = overrides.match !== undefined ? overrides.match : null;
    if (matchKey) params.set('match', matchKey);
    // Comparison teams
    const compare = overrides.compare !== undefined ? overrides.compare : null;
    if (compare) params.set('compare', compare);
    // Sort column
    const sort = overrides.sort !== undefined ? overrides.sort : null;
    if (sort) params.set('sort', sort);
    const qs = params.toString();
    return `${location.pathname}${qs ? '?' + qs : ''}${tab ? '#' + tab : ''}`;
}

/** Update the browser URL to reflect current state (replaceState) */
function _syncUrl(overrides = {}) {
    const url = _buildShareUrl(overrides);
    history.replaceState(null, '', url);
}

/** Restore the tab from URL hash after event data is available. */
function restorePendingTab() {
    if (!_pendingTabHash) return;
    const tab = _pendingTabHash;
    _pendingTabHash = null;
    const btn = document.querySelector(`.tab[data-tab="${tab}"]`);
    if (btn) requestAnimationFrame(() => btn.click());
}

/** Restore deferred URL state (match, compare, sort) after event + tab are ready */
function _restorePendingUrlState() {
    if (!_pendingUrlState) return;
    const st = _pendingUrlState;
    _pendingUrlState = null;

    // Sort column
    if (st.sort && teamsData) {
        requestAnimationFrame(() => sortTeams(st.sort));
    }

    // Match navigation (deferred until PBP data loads)
    if (st.match) {
        _pendingMatchKey = st.match;
    }

    // Comparison (deferred until rankings data loads)
    if (st.compare) {
        const teamNums = st.compare.split(',').map(s => s.trim()).filter(Boolean);
        const teamKeys = teamNums.map(n => `frc${n}`);
        if (teamKeys.length > 0) {
            requestAnimationFrame(() => showComparison(teamKeys, {}));
        }
    }
}

let _pendingMatchKey = null;
/** Navigate to a match by key (e.g. 'qm42', 'sf1m1') — called after PBP data loads */
function _navigateToMatchByKey(matchKey) {
    if (!pbpData || !pbpData.matches) return false;
    const idx = pbpData.matches.findIndex(m => m.key && m.key.includes(matchKey));
    if (idx >= 0) {
        pbpIndex = idx;
        renderPbpMatch();
        return true;
    }
    return false;
}

// ── Handle browser back/forward navigation ─────────────────
window.addEventListener('popstate', () => {
    const params = new URLSearchParams(location.search);
    const urlEvent = params.get('event');
    if (urlEvent && /^\d{4}[a-z0-9]+$/i.test(urlEvent) && urlEvent !== currentEvent) {
        loadEvent(urlEvent);
    }
    const hash = location.hash.replace('#', '');
    if (hash) {
        const btn = document.querySelector(`.tab[data-tab="${hash}"]`);
        if (btn) btn.click();
    }
    const matchParam = params.get('match');
    if (matchParam) _navigateToMatchByKey(matchParam);
});


// ── Helpers ────────────────────────────────────────────────
// `$` is defined as `window.$` via an inline <script> in index.html so it's
// available to section scripts loaded BEFORE app.js. Re-export to local
// `const` aliases for the rest of this file's call sites.
const $ = window.$ || (id => document.getElementById(id));
const show = (id) => $(id)?.classList.remove('hidden');
const hide = (id) => $(id)?.classList.add('hidden');

// ── Inline error helper (replaces alert() for loading errors) ──
function showInlineError(containerId, message, retryFn) {
    const el = $(containerId);
    if (!el) return;
    const retryId = containerId + '-retry-btn';
    const retryBtn = retryFn
        ? `<button class="inline-error-retry" id="${retryId}">Retry</button>`
        : '';
    el.innerHTML = `
        <div class="inline-error">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            <span class="inline-error-msg">${message}</span>
            ${retryBtn}
        </div>`;
    el.classList.remove('hidden');
    // Bind retry handler directly
    if (retryFn) {
        const btn = document.getElementById(retryId);
        if (btn) btn.addEventListener('click', () => { hideInlineError(containerId); retryFn(); });
    }
}
function hideInlineError(containerId) {
    const el = $(containerId);
    if (el) { el.innerHTML = ''; el.classList.add('hidden'); }
}

// ── Content fade-in helper ──
function fadeIn(elementOrId) {
    const el = typeof elementOrId === 'string' ? $(elementOrId) : elementOrId;
    if (!el) return;
    el.classList.remove('content-fade-in');
    // Force reflow to restart animation
    void el.offsetWidth;
    el.classList.add('content-fade-in');
}

// ── Contextual loading status helper ──
function setLoadingStatus(statusId, text) {
    const el = $(statusId);
    if (el) el.textContent = text;
}

// ── Skeleton show/hide helpers ──
function showSkeleton(loadingId, statusId, statusText) {
    show(loadingId);
    if (statusId && statusText) setLoadingStatus(statusId, statusText);
}
function hideSkeleton(loadingId) {
    hide(loadingId);
}

// Breathing indicator on the banner dot instead of fullscreen overlay
function loading(on) {
    const dot = document.querySelector('.aeb-dot');
    const badge = $('event-badge');
    if (on) {
        if (dot) dot.classList.add('aeb-dot-loading');
        if (badge && !badge.classList.contains('loading')) {
            badge.classList.add('loading');
        }
    } else {
        if (dot) dot.classList.remove('aeb-dot-loading');
        if (badge) badge.classList.remove('loading');
    }
}

// ── World Record in footer ────────────────────────────────
let _worldRecord = null;

async function fetchWorldRecord() {
    try {
        // Smooth transition: fade out, swap, fade in
        const el = $('footer-world-record');
        if (el && !el.classList.contains('hidden')) {
            el.classList.add('wr-transitioning');
            await new Promise(r => setTimeout(r, 400));
        }

        let rec = await API.worldRecord();
        if (rec && rec.score > 0) {
            _worldRecord = rec;
            renderWorldRecord(rec, false);
        }

        if (el) {
            el.classList.remove('wr-transitioning');
        }
    } catch {
        const el = $('footer-world-record');
        if (el) el.classList.remove('wr-transitioning');
    }
}

let _showWorldRecord = localStorage.getItem('showWorldRecord') !== 'false'; // on by default

function toggleWorldRecord(on) {
    _showWorldRecord = on;
    localStorage.setItem('showWorldRecord', on ? 'true' : 'false');
    const el = $('footer-world-record');
    if (!el) return;
    if (on && _worldRecord && _worldRecord.score > 0) {
        el.classList.remove('hidden');
    } else {
        el.classList.add('hidden');
    }
}

// Restore saved preference on load
(function initWorldRecord() {
    const saved = localStorage.getItem('showWorldRecord');
    if (saved === 'false') {
        _showWorldRecord = false;
        const cb = document.getElementById('toggle-world-record');
        if (cb) cb.checked = false;
    }
})();

function renderWorldRecord(rec, isNew) {
    const el = $('footer-world-record');
    if (!el || !rec || rec.score <= 0) return;
    setupHighScoresPanelClick();
    $('footer-wr-score').textContent = rec.score;
    const eventLabel = rec.event_name || rec.event_key || '';
    const matchLabel = rec.match || '';
    // Show only the winning alliance's teams; fall back to all teams if unavailable
    const winningAlliance = rec.winning_alliance;
    const winningTeams = winningAlliance === 'red' ? rec.red_teams
        : winningAlliance === 'blue' ? rec.blue_teams
        : null;
    const teamsStr = winningTeams
        ? winningTeams.map(t => t.number || t.name || t).filter(Boolean).join(', ')
        : (rec.teams || []).join(', ');
    let detail = '';
    if (matchLabel) detail += matchLabel;
    if (eventLabel) detail += (detail ? ' · ' : '') + eventLabel;
    if (teamsStr) detail += ` (${teamsStr})`;
    $('footer-wr-detail').textContent = detail;
    if (_showWorldRecord) {
        const wasHidden = el.classList.contains('hidden');
        el.classList.remove('hidden');
        if (wasHidden) {
            el.classList.add('wr-enter');
            el.addEventListener('animationend', () => el.classList.remove('wr-enter'), { once: true });
        }
    }
    if (isNew) {
        el.classList.add('wr-new');
        setTimeout(() => el.classList.remove('wr-new'), 5000);
    }
}

/** Called after PbP data loads; checks if this event set a new world record. */
function checkWorldRecordFromPbp(data) {
    if (!data) return;
    if (data.is_world_record && data.event_high_score?.score > 0) {
        const eName = (eventInfoData && (eventInfoData.short_name || eventInfoData.name)) || data.event_key;
        const rec = {
            score: data.event_high_score.score,
            event_key: data.event_key,
            event_name: eName,
            match: data.event_high_score.match,
            teams: data.event_high_score.teams,
        };
        _worldRecord = rec;
        renderWorldRecord(rec, true);
    }
}

// ── Season High Scores Panel ──────────────────────────────
let _seasonHighScoresCache = null;  // cached response
let _shsIncludeFoul = false;        // toggle: show total score (with fouls)

function setupHighScoresPanelClick() {
    const pill = $('footer-world-record');
    if (!pill || pill._shsBound) return;
    pill.style.cursor = 'pointer';
    pill.addEventListener('click', toggleSeasonHighScoresPanel);
    pill._shsBound = true;
}

async function toggleSeasonHighScoresPanel() {
    const existing = $('season-high-scores-overlay');
    if (existing) {
        existing.remove();
        return;
    }

    

    const year = currentEventYear || 2026;

    // Show loading overlay immediately
    const overlay = document.createElement('div');
    overlay.id = 'season-high-scores-overlay';
    overlay.className = 'shs-overlay';
    overlay.innerHTML = '<div class="shs-panel"><div class="shs-loading">Loading season data…</div></div>';
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);

    try {
        if (!_seasonHighScoresCache || _seasonHighScoresCache._year !== year) {
            const data = await API.seasonHighScores(year);
            data._year = year;
            _seasonHighScoresCache = data;
        }
        renderSeasonHighScoresPanel(_seasonHighScoresCache, overlay);
    } catch (err) {
        const panel = overlay.querySelector('.shs-panel');
        if (panel) panel.innerHTML = `<div class="shs-loading">Could not load data.</div>`;
    }
}

function renderSeasonHighScoresPanel(data, overlay) {
    const matches = (data.matches || []).slice();
    const epaTeams = data.epa_teams || [];
    const teamNames = data.team_names || {};
    const useNoFoul = !_shsIncludeFoul;

    // Re-sort matches based on toggle
    matches.sort((a, b) => {
        const aVal = useNoFoul ? (a.no_foul || a.score) : a.score;
        const bVal = useNoFoul ? (b.no_foul || b.score) : b.score;
        return bVal - aVal;
    });

    // Build set of teams at current event for highlighting
    const eventTeamSet = new Set();
    if (teamsData && Array.isArray(teamsData)) {
        teamsData.forEach(t => {
            const num = String(t.team_number || t.teamNumber || '');
            if (num) eventTeamSet.add(num);
        });
    }

    const foulLabel = useNoFoul ? 'no foul' : 'with foul';
    const toggleLabel = 'Include foul';
    const toggleChecked = _shsIncludeFoul ? ' checked' : '';

    let html = '<div class="shs-panel">';
    html += '<div class="shs-header"><span class="shs-title">Season High Scores</span></div>';

    // Section 1: Top Match Scores
    html += `<div class="shs-section"><div class="shs-section-title-row"><span class="shs-section-title">Top Match Scores (${foulLabel})</span><label class="shs-toggle"><input type="checkbox" id="shs-foul-toggle"${toggleChecked}><span>${toggleLabel}</span></label></div>`;
    if (matches.length) {
        html += '<table class="shs-table"><thead><tr><th>#</th><th>Score</th><th>Match</th><th>Event</th><th>Teams</th></tr></thead><tbody>';
        matches.forEach((m, i) => {
            const isEventMatch = currentEvent && m.event_key === currentEvent;
            const teamStrs = (m.teams || []).map(t => {
                const hl = eventTeamSet.has(String(t)) ? ' shs-highlight' : '';
                const name = teamNames[String(t)] || '';
                const tip = name ? `<span class="custom-tooltip">${name}</span>` : '';
                return `<span class="shs-team-num has-tooltip${hl}">${t}${tip}</span>`;
            });
            const scoreTxt = useNoFoul ? `${m.no_foul || m.score}` : `${m.score}`;
            const rowCls = isEventMatch ? ' class="shs-event-row"' : '';
            html += `<tr${rowCls}><td>${i + 1}</td><td class="shs-score">${scoreTxt}</td><td class="shs-match-label">${m.match_label || m.key}</td><td class="shs-event-name">${m.event_name || m.event_key}</td><td class="shs-teams">${teamStrs.join(', ')}</td></tr>`;
        });
        html += '</tbody></table>';
    } else {
        html += '<div class="shs-empty">No data available</div>';
    }
    html += '</div>';

    // Section 2: Top EPA Teams
    html += '<div class="shs-section"><div class="shs-section-title">Top EPA Teams</div>';
    if (epaTeams.length) {
        html += '<table class="shs-table"><thead><tr><th>#</th><th>Team</th><th>EPA</th></tr></thead><tbody>';
        epaTeams.forEach((t, i) => {
            const isLocal = eventTeamSet.has(String(t.team));
            const rowCls = isLocal ? ' class="shs-event-row"' : '';
            const numCls = isLocal ? ' class="shs-highlight"' : '';
            html += `<tr${rowCls}><td>${i + 1}</td><td><span${numCls}>${t.team}</span> <span class="shs-team-name">${t.name || ''}</span></td><td class="shs-score">${t.epa}</td></tr>`;
        });
        html += '</tbody></table>';
    } else {
        html += '<div class="shs-empty">No data available</div>';
    }
    html += '</div>';

    html += '</div>';

    const panel = overlay.querySelector('.shs-panel');
    if (panel) {
        panel.outerHTML = html;
    } else {
        overlay.innerHTML = html;
    }

    // Wire foul toggle
    const toggle = document.getElementById('shs-foul-toggle');
    if (toggle) {
        toggle.addEventListener('change', () => {
            _shsIncludeFoul = toggle.checked;
            renderSeasonHighScoresPanel(data, overlay);
        });
    }
}

// Close high scores panel on Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const overlay = $('season-high-scores-overlay');
        if (overlay) { overlay.remove(); e.stopPropagation(); }
    }
});

fetchWorldRecord();

// Load team 6907 avatar as brand icon
(async function loadBrandAvatar() {
    try {
        const img = document.getElementById('brand-icon-svg');
        const fallback = document.getElementById('brand-icon-fallback');
        if (!img) return;
        const resp = await fetch(`${API_BASE}/api/teams/6907/avatar`);
        if (!resp.ok) return;
        const blob = await resp.blob();
        img.src = URL.createObjectURL(blob);
        img.style.display = '';
        if (fallback) fallback.style.display = 'none';
    } catch (e) { /* keep SVG fallback */ }
})();


// ═══════════════════════════════════════════════════════════
// 1. EVENT SELECTION (extracted to docs/js/event_select.js)
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// 1b. EVENT SUMMARY (extracted to docs/js/summary.js)
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// 2. PLAYOFFS (extracted to docs/js/playoffs.js)
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// 3. ALLIANCE SELECTION (extracted to docs/js/alliances.js)
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// 4/5/5b. TEAM LOOKUP + HEAD TO HEAD (extracted to docs/js/team_lookup.js)
// ═══════════════════════════════════════════════════════════
// 6. PLAY BY PLAY (extracted to docs/js/pbp.js)
// ═══════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════
// 7. SCORE BREAKDOWN (+ game renderers) (extracted to docs/js/breakdown.js)
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// 8. TEAM COMPARISON (extracted to docs/js/comparison.js)
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// MATCH HISTORY FROM RANKINGS (extracted to docs/js/match_history.js)
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// FLOATING TEAM LOOKUP PANEL (extracted to docs/js/floating_lookup.js)
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// Region & Event History tab (extracted to docs/js/region_history.js)
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// MOBILE UX IMPROVEMENTS (extracted to docs/js/mobile_ux.js)
// ═══════════════════════════════════════════════════════════

// ── Initial event-list bootstrap ───────────────────────────
// Pre-v3.0.0, event_select.js called loadSeasonEvents() and
// loadRegionalPool() at top-level. Those calls were removed because
// they ran before app.js parsed (so getActiveAPI was undefined).
// Bring the boot back here, where every helper is guaranteed defined.
(function bootstrapEventList() {
    const boot = () => {
        if (typeof loadSeasonEvents === 'function') loadSeasonEvents();
        if (typeof loadRegionalPool === 'function') {
            loadRegionalPool();
        }
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
