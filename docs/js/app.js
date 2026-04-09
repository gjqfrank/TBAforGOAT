/* ═══════════════════════════════════════════════════════════
   app.js — FRC Caster's Tool UI Controller
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
    const nd = team.number_display;
    if (!nd) return String(team.team_number);
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

let currentEvent = null;   // event_key once loaded
let currentEventYear = null; // numeric year of the loaded event
let eventInfoData = null;  // cached event info for saving
let playoffData  = null;   // cached playoff matches
let allianceData = null;   // cached alliance data
let summaryData  = null;   // cached event summary
let _summaryRevalidatedAt = 0; // timestamp of last background revalidation
const _SUMMARY_REVALIDATE_COOLDOWN = 5 * 60_000; // 5 minutes
let pbpData      = null;   // cached play-by-play data
let pbpIndex     = 0;      // current match index
let highlightForeign = false; // settings: highlight international teams
let highlightRookie = false;   // settings: highlight rookie teams
let showOffseason = false;     // settings: show offseason events
let rankingsCompact = window.innerWidth <= 768;  // default compact on mobile
let rankingsShowSchool = false;   // toggle: show school/org column
let rankingsShowAutoTele = false; // toggle: show Auto/TeleOp columns (FTC)
let rankingsCardView = window.innerWidth <= 768;  // card view default on mobile
let allianceShowEpa = false;      // toggle: show EPA breakdown in alliance cards
let allianceShowPlayoff = false;  // toggle: show playoff ribbons/status
let allianceShowAvatars = true;  // toggle: show team avatars
let allianceShowNames = false;    // toggle: show team nicknames
let allianceShowAttrs = false;    // toggle: show team attribute tags in alliances
let pbpShowAwards = false;        // toggle: show blue banners + awards in PBP
let showPredictions = false;       // settings: show Statbotics win predictions in PBP
let showGatoolSponsors = false;    // settings: show GATool cloud sponsors in PBP
let _storylineAvailable = false;   // AI storylines feature flag (checked on load)
let eventCountry = '';         // home country of the currently loaded event
let eventRegion  = '';         // resolved region name for the loaded event
let historyData  = null;       // cached event history data
let regionData   = null;       // cached region facts
let bdData       = null;   // cached breakdown match list (same as pbpData)
let bdIndex      = 0;      // current breakdown match index
let bdCache      = {};     // match_key -> breakdown data
let bdPollTimer  = null;   // auto-poll timer for pending breakdowns
let bdListTimer  = null;   // timer for refreshing match list has_breakdown flags
let lastTeamData = null;   // cached last team lookup data for re-render
const BD_POLL_INTERVAL = 5_000;       // 5s — poll for breakdown availability
const BD_LIST_REFRESH  = 20_000;      // 20s — refresh match list flags

// PBP auto-refresh
let pbpRefreshTimer = null;         // setInterval id for PBP live refresh
const PBP_REFRESH_INTERVAL = 15_000; // 15s — poll for score/match updates

// Playoff auto-refresh
let playoffRefreshTimer = null;
const PLAYOFF_REFRESH_INTERVAL = 30_000; // 30s — poll for bracket updates

// Season events
let seasonEventsRaw = [];          // full list from backend
let seasonEventsFiltered = [];     // after applying region/week/search
let seasonDropdownIdx = -1;        // keyboard-highlighted index in dropdown

// Auto-refresh polling
let rankingsRefreshTimer = null;   // setInterval id for rankings polling
let currentEventStatus = null;     // 'ongoing' | 'completed' | 'upcoming' | null

// Track which tabs have been rendered from preloaded data
let renderedTabs = { playoff: false, alliance: false, playbyplay: false, breakdown: false, history: false };

// ── Realtime event handlers (replace setInterval polling) ──
let _rtRankDebounce = null;   // debounce timer for batched team changes
let _rtMatchDebounce = null;  // debounce timer for batched match changes

Realtime.onTeamChange((_payload) => {
    // Debounce: many team rows arrive in quick succession after a match completes
    clearTimeout(_rtRankDebounce);
    _rtRankDebounce = setTimeout(() => {
        if (currentEvent && currentEventStatus === 'ongoing') refreshRankings();
    }, 500);
});

Realtime.onMatchChange((payload) => {
    // Debounce: match updates may arrive in a burst
    clearTimeout(_rtMatchDebounce);
    _rtMatchDebounce = setTimeout(() => {
        if (!currentEvent || currentEventStatus !== 'ongoing') return;
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

// ── Reset event data (used when switching FRC/FTC mode) ────
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

// ── Competition Mode Toggle (FRC / FTC) ────────────────────
let competitionMode = 'frc';  // 'frc' or 'ftc'
let _lastModeSwitch = 0;     // timestamp of last mode switch (cooldown)
let _modeSwitchGeneration = 0; // increments on each switch; guards delayed loadEvent

function getActiveAPI() {
    return competitionMode === 'ftc' ? FTC_API : API;
}

function isFTCMode() {
    return competitionMode === 'ftc';
}

function updateFavicon(mode) {
    const color = mode === 'ftc' ? '#f97316' : '#6366f1';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/><line x1="12" y1="22" x2="12" y2="15.5"/><polyline points="22 8.5 12 15.5 2 8.5"/><polyline points="2 15.5 12 8.5 22 15.5"/><line x1="12" y1="2" x2="12" y2="8.5"/></svg>`;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    let link = document.querySelector('link[rel="icon"]');
    if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        link.type = 'image/svg+xml';
        document.head.appendChild(link);
    }
    const old = link.href;
    link.href = url;
    if (old && old.startsWith('blob:')) URL.revokeObjectURL(old);
}

function toggleCompetitionMode() {
    // 5-second cooldown between mode switches
    const now = Date.now();
    if (now - _lastModeSwitch < 5000) {
        showToast('Please wait a few seconds before switching again', 'info', 2000);
        return;
    }
    _lastModeSwitch = now;

    const icon = document.getElementById('brand-icon-svg');
    if (icon) {
        icon.classList.add('switching');
        icon.addEventListener('animationend', () => icon.classList.remove('switching'), { once: true });
    }

    // ── Cache current event for this mode before switching ──
    const prevMode = competitionMode;
    if (currentEvent) {
        localStorage.setItem(`lastEvent_${prevMode}`, currentEvent);
    }

    competitionMode = competitionMode === 'frc' ? 'ftc' : 'frc';
    document.documentElement.setAttribute('data-mode', competitionMode);
    localStorage.setItem('competitionMode', competitionMode);

    // Update UI text
    const sub = document.getElementById('brand-sub');
    if (sub) sub.textContent = competitionMode === 'ftc' ? 'Public Beta' : 'Events at a glance!';

    const toggleBtn = document.getElementById('mode-toggle-btn');
    if (toggleBtn) toggleBtn.title = competitionMode === 'ftc' ? 'Switch to FRC Mode' : 'Switch to FTC Mode';

    // Update page title
    document.title = competitionMode === 'ftc'
        ? "Caster's Tool: FTC DECODE"
        : "Caster's Tool: Events at a glance!";

    // Update favicon color
    updateFavicon(competitionMode);

    // Hide/show FRC-only settings
    const frcOnlySettings = ['toggle-highlight-foreign', 'toggle-predictions',
                             'toggle-world-record', 'toggle-offseason'];
    frcOnlySettings.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            const row = el.closest('.settings-toggle');
            if (row) row.style.display = competitionMode === 'ftc' ? 'none' : '';
        }
    });

    // Show FTC toast
    showToast(competitionMode === 'ftc' ? 'Switched to FTC Mode — DECODE 2025-2026' : 'Switched to FRC Mode', 'info', 2500);

    // Hide Regional Pool in FTC mode, show in FRC
    const rpCard = $('regional-pool-card');
    if (rpCard) rpCard.classList.toggle('hidden', competitionMode === 'ftc');

    // Re-load regional pool on FRC return (may not have been loaded yet)
    if (competitionMode === 'frc') {
        if (typeof loadRegionalPool === 'function') loadRegionalPool();
    }

    // ── Update event code placeholder for mode ──
    const ecInput = $('event-code');
    if (ecInput) ecInput.placeholder = competitionMode === 'ftc' ? 'Event code (e.g. TRTUQ1)' : 'Event code (e.g. txda)';

    // ── Update footer credits for mode ──
    const statusFrc = $('status-frc');   // TBA
    const statusTba = $('status-tba');   // FIRST FRC Events
    const statusStat = $('status-statbotics'); // Statbotics + GATool
    if (competitionMode === 'ftc') {
        if (statusFrc) statusFrc.style.display = 'none';
        // Hide TBA separator
        if (statusFrc) { const sep = statusFrc.nextElementSibling; if (sep && sep.classList.contains('footer-sep')) sep.style.display = 'none'; }
        if (statusTba) statusTba.innerHTML = 'Event Data provided by <a href="https://ftc-events.firstinspires.org/services/API" target="_blank" rel="noopener"><em>FIRST</em></a>';
        if (statusStat) statusStat.innerHTML = 'Additional data provided by <a href="https://gatool.org" target="_blank" rel="noopener">GATool</a> and <a href="https://ftcscout.org" target="_blank" rel="noopener">FTC Scout</a>';
    } else {
        if (statusFrc) statusFrc.style.display = '';
        if (statusFrc) { const sep = statusFrc.nextElementSibling; if (sep && sep.classList.contains('footer-sep')) sep.style.display = ''; }
        if (statusTba) statusTba.innerHTML = 'Event Data provided by <a href="https://frc-events.firstinspires.org/services/API" target="_blank" rel="noopener"><em>FIRST</em></a>';
        if (statusStat) statusStat.innerHTML = 'Additional data provided by <a href="https://gatool.org" target="_blank" rel="noopener">GATool</a> and <a href="https://www.statbotics.io" target="_blank" rel="noopener">Statbotics</a>';
    }

    // ── Hide EPA / Playoff Status toggles on alliances tab in FTC ──
    const epaToggle = document.getElementById('alliance-toggle-epa');
    if (epaToggle) {
        const row = epaToggle.closest('label');
        if (row) row.style.display = competitionMode === 'ftc' ? 'none' : '';
    }
    const playoffToggle = document.getElementById('alliance-toggle-playoff');
    if (playoffToggle) {
        const row = playoffToggle.closest('label');
        if (row) row.style.display = competitionMode === 'ftc' ? 'none' : '';
    }

    // ── Clear pending season selection ──
    if (typeof clearSeasonSelection === 'function') clearSeasonSelection();

    // ── Update season events title for mode ──
    const seasonTitle = document.querySelector('.event-section-card .event-section-title');
    if (seasonTitle) seasonTitle.textContent = competitionMode === 'ftc' ? '2025-2026 Season Events' : '2026 Season Events';
    const seasonRefresh = document.getElementById('season-refresh-btn');
    if (seasonRefresh) seasonRefresh.title = competitionMode === 'ftc' ? 'Refresh event list from FIRST' : 'Refresh event list from TBA';

    // ── Close any open lookups so FRC data doesn't leak into FTC ──
    if (typeof closeFloatingLookup === 'function') closeFloatingLookup();
    if (typeof closeLookup === 'function') closeLookup();

    // ── Clear current event + all tab data fully ──
    if (typeof clearActiveEvent === 'function') clearActiveEvent();
    resetEventData();
    // Also hide all tab content/skeletons so stale data doesn't show
    ['pbp-container','bd-container','summary-container','history-container'].forEach(id => {
        const el = $(id); if (el) el.classList.add('hidden');
    });
    ['pbp-empty','bd-empty','summary-empty','history-empty','rankings-empty',
     'playoff-empty','alliance-empty'].forEach(id => {
        const el = $(id); if (el) el.classList.remove('hidden');
    });

    // ── Nuke ALL inner rendered content so no stale data survives ──
    ['event-teams', 'playoff-bracket', 'alliance-grid',
     'pbp-arena', 'pbp-footer', 'pbp-match-select', 'pbp-match-label',
     'bd-content', 'bd-status', 'bd-match-select', 'bd-spotlight',
     'summary-title', 'summary-demographics',
     'summary-advancement-content', 'summary-past-champs-list',
     'summary-past-awards-list', 'summary-history-list',
     'summary-hof-list', 'summary-impact-list',
     'summary-top-list', 'summary-high-list',
     'summary-prequalified-content',
     'history-region-body', 'history-event-body'
    ].forEach(id => {
        const el = $(id);
        if (el) {
            if (el.tagName === 'SELECT') { el.innerHTML = ''; el.value = ''; }
            else el.innerHTML = '';
        }
    });
    // Hide summary sub-cards
    ['summary-advancement', 'summary-prestige-row', 'summary-hof', 'summary-impact',
     'summary-past-champs', 'summary-past-awards', 'summary-history',
     'summary-top-scorers', 'summary-high-scores', 'summary-prequalified'
    ].forEach(id => {
        const el = $(id); if (el) el.classList.add('hidden');
    });

    // Reset tab data dots
    if (typeof updateTabDots === 'function') updateTabDots();

    // Refresh world record for the new mode
    fetchWorldRecord();
    _seasonHighScoresCache = null;  // clear stale high-scores panel data

    // Pre-load FTC avatar map when switching to FTC mode
    if (competitionMode === 'ftc') loadFtcAvatarMap();
    else _ftcAvatarMap = null;  // clear on FRC switch to free memory

    // Load season events for the new mode (prefers cached/static data to avoid rate limits)
    if (typeof loadSeasonEvents === 'function') loadSeasonEvents();

    // ── Update range toggle labels for FTC ("Since 2019") vs FRC ("All time") ──
    const _allLabel = competitionMode === 'ftc' ? 'Since 2019' : 'All time';
    const _allShort = competitionMode === 'ftc' ? 'Since 2019' : 'All';
    const h2hSides = document.querySelectorAll('.h2h-range-side');
    if (h2hSides.length === 2) h2hSides[1].textContent = _allLabel;
    const summConnCard = $('summary-history');
    if (summConnCard) {
        const cSides = summConnCard.querySelectorAll('.conn-range-side');
        if (cSides.length === 2) cSides[1].textContent = _allShort;
    }

    // ── Restore cached event for the new mode (if any) ──
    const cachedKey = localStorage.getItem(`lastEvent_${competitionMode}`);

    // Always switch to Events tab first so user sees the event list
    if (typeof switchToTab === 'function') switchToTab('event');

    if (cachedKey) {
        const gen = ++_modeSwitchGeneration;
        setTimeout(() => {
            // Only load if no further mode switch happened in the meantime
            if (gen !== _modeSwitchGeneration) return;
            if (typeof loadEvent === 'function') loadEvent(cachedKey);
        }, 600);
    } else {
        ++_modeSwitchGeneration;
    }
}

// Restore saved competition mode
(function initCompetitionMode() {
    const saved = localStorage.getItem('competitionMode');
    if (saved === 'ftc') {
        competitionMode = 'ftc';
        document.documentElement.setAttribute('data-mode', 'ftc');
        document.addEventListener('DOMContentLoaded', () => {
            const sub = document.getElementById('brand-sub');
            if (sub) sub.textContent = 'Public Beta';
            const toggleBtn = document.getElementById('mode-toggle-btn');
            if (toggleBtn) toggleBtn.title = 'Switch to FRC Mode';
            document.title = "Caster's Tool: FTC DECODE";
            updateFavicon('ftc');
            // Hide Regional Pool in FTC mode
            const rpCard = document.getElementById('regional-pool-card');
            if (rpCard) rpCard.classList.add('hidden');
            // Hide FRC-only settings
            ['toggle-highlight-foreign', 'toggle-predictions',
             'toggle-world-record', 'toggle-offseason'].forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    const row = el.closest('.settings-toggle');
                    if (row) row.style.display = 'none';
                }
            });
            // Update event code placeholder
            const ecInput = document.getElementById('event-code');
            if (ecInput) ecInput.placeholder = 'Event code (e.g. TRTUQ1)';
            // Update credits for FTC
            const statusFrc = document.getElementById('status-frc');
            const statusTba = document.getElementById('status-tba');
            const statusStat = document.getElementById('status-statbotics');
            if (statusFrc) { statusFrc.style.display = 'none'; const sep = statusFrc.nextElementSibling; if (sep && sep.classList.contains('footer-sep')) sep.style.display = 'none'; }
            if (statusTba) statusTba.innerHTML = 'Event Data provided by <a href="https://ftc-events.firstinspires.org/services/API" target="_blank" rel="noopener"><em>FIRST</em></a>';
            if (statusStat) statusStat.innerHTML = 'Additional data provided by <a href="https://gatool.org" target="_blank" rel="noopener">GATool</a> and <a href="https://ftcscout.org" target="_blank" rel="noopener">FTC Scout</a>';
            // Hide EPA / Playoff Status toggles on alliances tab
            const epaToggle = document.getElementById('alliance-toggle-epa');
            if (epaToggle) { const row = epaToggle.closest('label'); if (row) row.style.display = 'none'; }
            const playoffToggle = document.getElementById('alliance-toggle-playoff');
            if (playoffToggle) { const row = playoffToggle.closest('label'); if (row) row.style.display = 'none'; }
            // Update season events title for FTC
            const seasonTitle = document.querySelector('.event-section-card .event-section-title');
            if (seasonTitle) seasonTitle.textContent = '2025-2026 Season Events';
            const seasonRefresh = document.getElementById('season-refresh-btn');
            if (seasonRefresh) seasonRefresh.title = 'Refresh event list from FIRST';
            // Update range toggle labels for FTC
            const h2hSides = document.querySelectorAll('.h2h-range-side');
            if (h2hSides.length === 2) h2hSides[1].textContent = 'Since 2019';
            const summConnCard = document.getElementById('summary-history');
            if (summConnCard) {
                const cSides = summConnCard.querySelectorAll('.conn-range-side');
                if (cSides.length === 2) cSides[1].textContent = 'Since 2019';
            }
        });
    }
})();

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
        const data = isFTCMode()
            ? await FTC_API.gatoolUpdates(eventKey)
            : await API.gatoolUpdates(eventKey);
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
    document.querySelectorAll('[data-country]').forEach(el => {
        const c = el.dataset.country;
        const isLocal = !c || (eventCountry && c === eventCountry);
        if (highlightForeign && !isLocal) {
            el.classList.add('foreign-team');
        } else {
            el.classList.remove('foreign-team');
        }
    });
}

function applyRookieHighlight() {
    document.querySelectorAll('[data-rookie-year]').forEach(el => {
        const ry = parseInt(el.dataset.rookieYear, 10);
        if (highlightRookie && ry && currentEventYear && ry >= currentEventYear) {
            el.classList.add('rookie-team');
        } else {
            el.classList.remove('rookie-team');
        }
    });
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
                if (currentEventStatus === 'ongoing' && !isFTCMode() && Date.now() - _summaryRevalidatedAt > _SUMMARY_REVALIDATE_COOLDOWN) {
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
                    if (isFTCMode()) renderFtcBracket(); else renderBracketTree();
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
        if (btn.dataset.tab === 'breakdown' && currentEventYear && currentEventYear < 2025) {
            // Pre-2025: show unavailable message, skip loading
            hide('bd-container');
            const el = $('bd-empty');
            if (el) {
                el.innerHTML = isFTCMode()
                    ? 'Score breakdown is only available for the 2025-2026 DECODE\u2122 season and later.'
                    : 'Score breakdown is only available for 2025 events onwards.';
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
const $ = id => document.getElementById(id);
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

// ── FTC Avatar Map (from FIRST FTC Scoring Server CSS, proxied via backend) ──
const _FTC_AVATAR_CSS_URL = '/api/ftc/events/avatar-css/2026';
const _FTC_AVATAR_BASE = 'https://ftc-scoring.firstinspires.org';
let _ftcAvatarMap = null;  // Map<teamNumber, fullUrl> — null = not loaded yet

async function loadFtcAvatarMap() {
    if (_ftcAvatarMap) return _ftcAvatarMap;
    try {
        const resp = await fetch(_FTC_AVATAR_CSS_URL);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const css = await resp.text();
        const map = new Map();
        // Parse: .team-{num} { background-image: url("/avatars/composed/2026/..."); }
        const re = /\.team-(\d+)\s*\{\s*background-image:\s*url\("([^"]+)"\)/g;
        let m;
        while ((m = re.exec(css)) !== null) {
            map.set(parseInt(m[1], 10), _FTC_AVATAR_BASE + m[2]);
        }
        _ftcAvatarMap = map;
        console.log(`[FTC Avatars] Loaded ${map.size} avatars from FIRST scoring server`);
        // If teams are already rendered, re-patch and re-render
        if (teamsData && teamsData.length && isFTCMode()) {
            patchFtcAvatars(teamsData);
            const el = $('event-teams');
            if (el && el.innerHTML) el.innerHTML = rankingsCardView ? renderTeamCards(teamsData) : renderTeamTable(teamsData, teamsSortCol, teamsSortAsc);
        }
        return map;
    } catch (err) {
        console.warn('[FTC Avatars] Failed to load avatar CSS:', err.message);
        _ftcAvatarMap = new Map();  // empty map — don't retry
        return _ftcAvatarMap;
    }
}

/** Patch avatar URLs into an array of team objects using the FTC avatar map. */
function patchFtcAvatars(teams) {
    if (!isFTCMode() || !_ftcAvatarMap || _ftcAvatarMap.size === 0) return;
    for (const t of teams) {
        if (!t.avatar && t.team_number) {
            const url = _ftcAvatarMap.get(t.team_number);
            if (url) t.avatar = url;
        }
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

        let rec;
        if (isFTCMode()) {
            rec = await FTC_API.worldRecord(2025);
        } else {
            rec = await API.worldRecord();
        }
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
    const teamsStr = (rec.teams || []).join(', ');
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

    // FTC mode — no Statbotics high-scores panel
    if (isFTCMode()) return;

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
    html += '<div class="shs-header"><span class="shs-title">Season High Scores</span><button class="shs-close" onclick="document.getElementById(\'season-high-scores-overlay\')?.remove()">&times;</button></div>';

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
if (isFTCMode()) loadFtcAvatarMap();


// ═══════════════════════════════════════════════════════════
// 1. EVENT SELECTION
// ═══════════════════════════════════════════════════════════

// ── Season events loader ──────────────────────────────────
async function loadSeasonEvents() {
    const status = $('season-status');
    const seasonYear = isFTCMode() ? 2025 : 2026;
    const label = isFTCMode() ? 'FTC' : '';
    const staticFile = isFTCMode() ? 'data/season_2025_ftc.json' : 'data/season_2026.json';
    status.textContent = `Loading ${seasonYear} ${label} events…`;
    try {
        // Both FRC and FTC: try static JSON first, then API fallback
        const resp = await fetch(staticFile);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        seasonEventsRaw = await resp.json();
        populateSeasonFilters();
        filterSeasonEvents();
        status.textContent = '';
        const badge = $('season-count-badge');
        if (badge) badge.textContent = `${seasonEventsRaw.length} events`;
    } catch (err) {
        // Fallback: fetch live from API
        try {
            const api = getActiveAPI();
            seasonEventsRaw = await api.seasonEvents(seasonYear);
            populateSeasonFilters();
            filterSeasonEvents();
            status.textContent = '';
            const badge = $('season-count-badge');
            if (badge) badge.textContent = `${seasonEventsRaw.length} events`;
        } catch (err2) {
            status.textContent = `Failed to load events: ${err2.message}`;
        }
    }
}

async function refreshSeasonEventsFromAPI() {
    const status = $('season-status');
    const btn = $('season-refresh-btn');
    btn.classList.add('spinning');
    const label = isFTCMode() ? 'FTC Events API' : 'TBA';
    const seasonYear = isFTCMode() ? 2025 : 2026;
    status.textContent = `Refreshing from ${label}…`;
    try {
        const api = getActiveAPI();
        seasonEventsRaw = await api.seasonEvents(seasonYear, true);
        populateSeasonFilters();
        filterSeasonEvents();
        status.textContent = `Updated from ${label} ✓`;
        setTimeout(() => { if (status.textContent === `Updated from ${label} ✓`) status.textContent = ''; }, 3000);
        const badge = $('season-count-badge');
        if (badge) badge.textContent = `${seasonEventsFiltered.length} events`;
    } catch (err) {
        status.textContent = `Refresh failed: ${err.message}`;
    } finally {
        btn.classList.remove('spinning');
    }
}

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

const _FTC_REGION_SPECIAL = {
    CMPZ2: 'FIRST Championship', CMP: 'Championship', CMPHOU: 'Champs Houston',
    FPE: 'FPE', ONADOD: 'Ontario ADOD',
};
const _FTC_REGION_NAMES = {
    // US States
    USAL:'Alabama', USAK:'Alaska', USAR:'Arkansas', USAZ:'Arizona',
    USCALA:'California – LA', USCALS:'California – LA South', USCANO:'California – NorCal', USCASD:'California – San Diego',
    USCO:'Colorado', USCHS:'Chesapeake', USCT:'Connecticut', USFCT:'Connecticut',
    USDE:'Delaware', USFL:'Florida', USGA:'Georgia', USHI:'Hawaii',
    USIA:'Iowa', USID:'Idaho', USIL:'Illinois', USIN:'Indiana',
    USKS:'Kansas', USKY:'Kentucky', USLA:'Louisiana',
    USMA:'Massachusetts', USMD:'Maryland', USME:'Maine', USMI:'Michigan',
    USMN:'Minnesota', USMO:'Missouri', USMOKS:'Missouri–Kansas', USMS:'Mississippi', USMT:'Montana',
    USNC:'North Carolina', USND:'North Dakota', USNE:'Nebraska', USNH:'New Hampshire',
    USNJ:'New Jersey', USNM:'New Mexico', USNV:'Nevada',
    USNY:'New York', USNYEX:'New York – Excelsior', USNYLI:'New York – Long Island', USNYNY:'New York – NYC',
    USOH:'Ohio', USOK:'Oklahoma', USOR:'Oregon',
    USPA:'Pennsylvania', USPR:'Puerto Rico', USRI:'Rhode Island',
    USSC:'South Carolina', USSD:'South Dakota', USTN:'Tennessee',
    USTX:'Texas', USTXCE:'Texas – Central', USTXHO:'Texas – Houston', USTXNO:'Texas – North', USTXSO:'Texas – South',
    USUT:'Utah', USVA:'Virginia', USVT:'Vermont', USWA:'Washington', USWI:'Wisconsin', USWV:'West Virginia', USWY:'Wyoming',
    // Canada
    CAAB:'Alberta', CABC:'British Columbia', CAMB:'Manitoba', CANB:'New Brunswick',
    CANL:'Newfoundland & Labrador', CANS:'Nova Scotia', CAON:'Ontario', CAQC:'Quebec', CASK:'Saskatchewan',
    // International (ISO 3166-1 alpha-2)
    AE:'UAE', AR:'Argentina', AU:'Australia', BR:'Brazil', CN:'China', CY:'Cyprus',
    DE:'Germany', EG:'Egypt', FR:'France', GB:'United Kingdom', GR:'Greece', HKG:'Hong Kong',
    HU:'Hungary', ID:'Indonesia', IL:'Israel', IN:'India', IT:'Italy', JM:'Jamaica',
    JP:'Japan', KR:'South Korea', KZ:'Kazakhstan', LT:'Lithuania', LY:'Libya',
    MA:'Morocco', MD:'Moldova', MX:'Mexico', MY:'Malaysia', NG:'Nigeria', NL:'Netherlands',
    NZ:'New Zealand', PL:'Poland', PY:'Paraguay', QA:'Qatar', RO:'Romania',
    TH:'Thailand', TR:'Turkey', TW:'Taiwan', UA:'Ukraine', VN:'Vietnam', ZA:'South Africa',
};
function _ftcRegionLabel(code) {
    if (!code) return code;
    if (_FTC_REGION_NAMES[code]) return _FTC_REGION_NAMES[code];
    if (_FTC_REGION_SPECIAL[code]) return _FTC_REGION_SPECIAL[code];
    // Fallback: strip US/CA prefix as abbreviation
    if (code.startsWith('US') && code.length > 2) return code.slice(2);
    if (code.startsWith('CA') && code.length > 2) return code.slice(2);
    return code;
}

function populateSeasonFilters() {
    // Region filter — exclude championship pseudo-regions in FTC mode
    const _CHAMP_REGION_CODES = new Set(['CMPZ2', 'CMP', 'CMPHOU']);
    const regions = [...new Set(seasonEventsRaw.map(e => e.region))].filter(r => {
        if (isFTCMode() && _CHAMP_REGION_CODES.has(r)) return false;
        return true;
    }).sort((a, b) => {
        if (isFTCMode()) return (_ftcRegionLabel(a) || a).localeCompare(_ftcRegionLabel(b) || b);
        return a.localeCompare(b);
    });
    const regionSel = $('season-filter-region');
    regionSel.innerHTML = '<option value="">All Regions</option>'
        + regions.map(r => `<option value="${r}">${isFTCMode() ? _ftcRegionLabel(r) : r}</option>`).join('');

    // Week / Month filter
    const weekSel = $('season-filter-week');
    if (isFTCMode()) {
        // FTC: use month-based filtering
        const months = [...new Set(seasonEventsRaw.map(e => e.month).filter(m => m != null))].sort((a, b) => a - b);
        weekSel.innerHTML = '<option value="">All Months</option>'
            + months.map(m => `<option value="month_${m}">${MONTH_NAMES[m] || 'Month ' + m}</option>`).join('');
    } else {
        const weeks = [...new Set(seasonEventsRaw.map(e => e.week).filter(w => w !== null && w !== undefined))].sort((a, b) => a - b);
        weekSel.innerHTML = '<option value="">All Weeks</option>'
            + weeks.map(w => `<option value="${w}">Week ${w + 1}</option>`).join('');
    }

    // Event type filter (FTC only)
    const typeSel = $('season-filter-type');
    if (typeSel) {
        if (isFTCMode()) {
            const types = [...new Set(seasonEventsRaw.map(e => e.event_type_string).filter(Boolean))].sort();
            typeSel.innerHTML = '<option value="">All Types</option>'
                + types.map(t => `<option value="${t}">${t}</option>`).join('');
            typeSel.classList.remove('hidden');
        } else {
            typeSel.classList.add('hidden');
        }
    }
}

function filterSeasonEvents() {
    const region = $('season-filter-region').value;
    const week = $('season-filter-week').value;
    const typeSel = $('season-filter-type');
    const eventType = typeSel ? typeSel.value : '';
    const search = ($('season-search').value || '').toLowerCase().trim();

    seasonEventsFiltered = seasonEventsRaw.filter(e => {
        // Hide offseason events unless the setting is on
        if (!showOffseason && e.event_type === 99) return false;
        if (region && e.region !== region) return false;
        if (eventType && e.event_type_string !== eventType) return false;
        if (week !== '') {
            if (week.startsWith('month_')) {
                // FTC month filter
                if (String(e.month) !== week.replace('month_', '')) return false;
            } else {
                if (String(e.week) !== week) return false;
            }
        }
        if (search && !e.name.toLowerCase().includes(search) && !e.key.toLowerCase().includes(search)) return false;
        return true;
    });

    // Only show dropdown when the search input is focused
    if (document.activeElement === $('season-search')) {
        renderSeasonDropdown();
    }

    const totalVisible = showOffseason ? seasonEventsRaw.length : seasonEventsRaw.filter(e => e.event_type !== 99).length;
    $('season-status').textContent = `${seasonEventsFiltered.length} of ${totalVisible} events`;
}

function renderSeasonDropdown() {
    const list = $('season-dropdown-list');
    const dropdown = $('season-dropdown');
    seasonDropdownIdx = -1;

    if (seasonEventsFiltered.length === 0) {
        list.innerHTML = '<div class="season-dropdown-item" style="color:var(--text-muted);justify-content:center">No events match your filters</div>';
        dropdown.classList.remove('hidden');
        return;
    }

    list.innerHTML = seasonEventsFiltered.map((e, i) => {
        let weekLabel;
        if (isFTCMode()) {
            weekLabel = e.month ? (MONTH_NAMES[e.month] || '').substring(0, 3) : (e.event_type_string || '');
        } else {
            weekLabel = e.week !== null && e.week !== undefined ? `Wk ${e.week + 1}` : 'CMP';
        }
        const typeLabel = isFTCMode() && e.event_type_string ? `<span class="sdi-type">${e.event_type_string}</span>` : '';
        const loc = [e.city, e.country].filter(Boolean).join(', ');
        return `<div class="season-dropdown-item" data-idx="${i}" onclick="selectSeasonEvent(${i})">
            <span class="sdi-name">${e.name}</span>
            ${typeLabel}
            <span class="sdi-week">${weekLabel}</span>
            <span class="sdi-loc">${loc}</span>
        </div>`;
    }).join('');

    dropdown.classList.remove('hidden');
}

let pendingSeasonEvent = null; // staged event awaiting user confirmation

function selectSeasonEvent(idx) {
    const ev = seasonEventsFiltered[idx];
    if (!ev) return;
    $('season-dropdown').classList.add('hidden');
    $('season-search').value = '';
    $('season-search').blur();

    // Stage the event for confirmation instead of loading immediately
    pendingSeasonEvent = ev;
    const bar = $('season-selected-bar');
    if (bar) {
        $('ssb-name').textContent = ev.name;
        let weekLabel;
        if (isFTCMode()) {
            weekLabel = ev.month ? MONTH_NAMES[ev.month] : (ev.event_type_string || 'Event');
        } else {
            weekLabel = ev.week !== null && ev.week !== undefined ? `Week ${ev.week + 1}` : 'Championship';
        }
        const loc = [ev.city, ev.country].filter(Boolean).join(', ');
        $('ssb-meta').textContent = `${weekLabel} · ${loc}`;
        bar.classList.remove('hidden');
        // Scroll the bar into view so the Load button is immediately visible
        requestAnimationFrame(() => {
            bar.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            // Auto-focus the Load button so Enter key loads immediately
            const loadBtn = $('ssb-load-btn');
            if (loadBtn) loadBtn.focus();
        });
    }
}

function confirmSeasonLoad() {
    if (!pendingSeasonEvent) return;
    const ev = pendingSeasonEvent;
    const bar = $('season-selected-bar');
    const btn = $('ssb-load-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; btn.classList.add('btn-loading'); }
    loadEvent(ev.key).finally(() => {
        if (btn) { btn.disabled = false; btn.textContent = 'Load Event'; btn.classList.remove('btn-loading'); }
        if (bar) bar.classList.add('hidden');
        pendingSeasonEvent = null;
    });
}

function clearSeasonSelection() {
    pendingSeasonEvent = null;
    const bar = $('season-selected-bar');
    if (bar) bar.classList.add('hidden');
    $('season-search').value = '';
    $('season-search').focus();
}

// Keyboard navigation in season dropdown
$('season-search')?.addEventListener('keydown', e => {
    const dropdown = $('season-dropdown');

    // If dropdown is closed but we have a pending event, Enter loads it
    if (e.key === 'Enter' && (dropdown.classList.contains('hidden') || !dropdown.querySelectorAll('.season-dropdown-item[data-idx]').length)) {
        if (pendingSeasonEvent) {
            e.preventDefault();
            confirmSeasonLoad();
            return;
        }
    }

    if (dropdown.classList.contains('hidden')) return;
    const items = dropdown.querySelectorAll('.season-dropdown-item[data-idx]');
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        seasonDropdownIdx = Math.min(seasonDropdownIdx + 1, items.length - 1);
        highlightDropdownItem(items);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        seasonDropdownIdx = Math.max(seasonDropdownIdx - 1, 0);
        highlightDropdownItem(items);
    } else if (e.key === 'Enter' && seasonDropdownIdx >= 0) {
        e.preventDefault();
        selectSeasonEvent(seasonDropdownIdx);
    } else if (e.key === 'Escape') {
        dropdown.classList.add('hidden');
    }
});

function highlightDropdownItem(items) {
    items.forEach(el => el.classList.remove('highlighted'));
    if (items[seasonDropdownIdx]) {
        items[seasonDropdownIdx].classList.add('highlighted');
        items[seasonDropdownIdx].scrollIntoView({ block: 'nearest' });
    }
}

// Show dropdown on focus, hide on outside click
$('season-search')?.addEventListener('focus', () => {
    if (seasonEventsFiltered.length) {
        renderSeasonDropdown();
    }
});
document.addEventListener('click', e => {
    if (!e.target.closest('.season-search-wrap')) {
        $('season-dropdown')?.classList.add('hidden');
    }
});

// Load season events on page init
loadSeasonEvents();
// loadRegionalPool() is called after its variable declarations below

/** Unified collapse toggle helper. Updates body, header class, and pill label/arrow. */
function _toggleCollapse(bodyId, toggleId, headerEl) {
    const body = $(bodyId);
    const toggle = $(toggleId);
    if (!body) return;
    body.classList.toggle('collapsed');
    const collapsed = body.classList.contains('collapsed');
    if (toggle) {
        const label = toggle.querySelector('.collapse-toggle-label');
        const arrow = toggle.querySelector('.collapse-toggle-arrow');
        if (label) label.textContent = collapsed ? 'Show' : 'Hide';
        if (arrow) arrow.style.transform = collapsed ? 'rotate(0deg)' : 'rotate(180deg)';
    }
    // Add/remove class on closest card header for styling hooks
    const header = headerEl
        ? (typeof headerEl === 'string' ? $(headerEl) : headerEl)
        : body.previousElementSibling;
    if (header) header.classList.toggle('collapsed-header', collapsed);
}

function toggleManualEntry() {
    _toggleCollapse('manual-entry-body', 'manual-toggle-icon');
}

// ═══════════════════════════════════════════════════════════
//  Regional Advancement Pool
// ═══════════════════════════════════════════════════════════
let _regionalPoolData = null;      // pool-qualified teams only (for pool display)
let _regionalPoolAllTeams = null;  // ALL teams from pool endpoint (for pre-qual box)
let _regionalPoolFiltered = null;  // filtered view
let _loadingRegionalPool = false;

// Kick off regional pool load now that variables are declared
loadRegionalPool();

async function loadRegionalPool() {
    if (isFTCMode() || _loadingRegionalPool) return;  // FRC-only feature, deduplicate
    _loadingRegionalPool = true;
    try {
        const year = currentEventYear || 2026;
        const resp = await API.regionalPool(year);
        if (!resp || !resp.teams || !resp.teams.length) return;
        _regionalPoolAllTeams = resp.teams;  // all teams for cross-referencing
        _regionalPoolData = resp.teams;
        _regionalPoolFiltered = _regionalPoolData;
        const card = $('regional-pool-card');
        card.classList.remove('hidden');
        const badge = $('regional-pool-badge');
        const poolCount = _regionalPoolData.filter(t => _isPoolQualified(t)).length;
        badge.textContent = `${_regionalPoolData.length} qualified · ${poolCount} via pool`;
        renderRegionalPool();
        // Re-render pre-qualified box in case summary was already rendered before pool loaded
        renderPrequalifiedTeams();
    } catch (err) {
        console.warn('[Regional Pool]', err);
    } finally {
        _loadingRegionalPool = false;
    }
}

function toggleRegionalPool() {
    _toggleCollapse('regional-pool-body', 'regional-pool-toggle');
}

function filterRegionalPool() {
    if (!_regionalPoolData) return;
    const q = ($('regional-pool-search').value || '').trim().toLowerCase();

    _regionalPoolFiltered = _regionalPoolData.filter(t => {
        if (q) {
            const numStr = String(t.teamNumber);
            const name = (t.nameShort || '').toLowerCase();
            if (!numStr.includes(q) && !name.includes(q)) return false;
        }
        return true;
    });
    renderRegionalPool();
}

function renderRegionalPool() {
    const el = $('regional-pool-content');
    const teams = _regionalPoolFiltered || [];
    if (!teams.length) {
        el.innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">No teams match your filters.</p>';
        return;
    }

    let html = '<div class="adv-table-wrap rp-table-wrap"><table class="adv-table rp-table">';
    html += '<thead><tr>';
    html += '<th>Rank</th><th>Team</th>';
    html += '<th title="Best event points"><span class="rp-hdr-full">Event 1</span><span class="rp-hdr-short">E1</span></th>';
    html += '<th title="Second event / projection"><span class="rp-hdr-full">Event 2</span><span class="rp-hdr-short">E2</span></th>';
    html += '<th class="adv-col-total">Total</th>';
    html += '<th><span class="rp-hdr-full">Method</span><span class="rp-hdr-short">Meth</span></th>';
    html += '</tr></thead><tbody>';

    teams.forEach(t => {
        const isPool = _isPoolQualified(t);
        const rowCls = isPool ? 'rp-row-pool' : 'rp-row-qualified';

        // Event 1 details
        const e1 = t.regional1Details;
        const e1Code = e1 ? e1.tournamentCode : '';
        const e1Pts = t.regional1Points != null ? t.regional1Points : '–';

        // Event 2: actual or projected
        const e2 = t.regional2Details;
        const e2Pts = t.regional2Points != null ? t.regional2Points
                    : (t.regional2PointsProjection != null ? `~${t.regional2PointsProjection}` : '–');
        const e2Code = e2 ? e2.tournamentCode : '';

        // Method
        const method = _rpQualMethod(t);
        const methodShort = _rpQualMethodShort(t);
        let statusCls = isPool ? 'rp-status-pool' : 'rp-status-qualified';
        if (t.declinedFirstCmp) statusCls = 'rp-status-declined';
        const decSuffix = t.declinedFirstCmp ? ' (Declined)' : '';
        const decSuffixShort = t.declinedFirstCmp ? ' (DCL)' : '';
        const statusHtml = `<span class="rp-status ${statusCls}"><span class="rp-hdr-full">${method}${decSuffix}</span><span class="rp-hdr-short">${methodShort}${decSuffixShort}</span></span>`;

        html += `<tr class="${rowCls}">`;
        html += `<td>${t.rank}</td>`;
        html += `<td><span class="adv-team-num">${t.teamNumber}</span> <span class="adv-team-name">${t.nameShort || ''}</span></td>`;
        html += `<td>${e1Code ? `<span class="rp-event-code" title="${e1Code}">${e1Pts}</span>` : '–'}</td>`;
        html += `<td>${e2Code ? `<span class="rp-event-code" title="${e2Code}">${e2Pts}</span>` : e2Pts}</td>`;
        html += `<td class="adv-col-total">${t.totalPoints != null ? t.totalPoints : '–'}</td>`;
        html += `<td>${statusHtml}</td>`;
        html += '</tr>';
    });

    html += '</tbody></table></div>';
    el.innerHTML = html;
}

function _isPoolQualified(t) {
    const s = (t.championshipStatus || '').toLowerCase();
    if (s.includes('pool')) return true;
    if (t.qualifiedFirstCmpEventWeek != null && !s.includes('ranking') && !t.qualifiedFirstCmpAwardName) return true;
    return false;
}

function _rpQualMethod(t) {
    if (t.qualifiedFirstCmpAwardName) return t.qualifiedFirstCmpAwardName;
    const status = (t.championshipStatus || '').toLowerCase();
    if (status.includes('ranking')) return 'Directly Qualified';
    if (status.includes('award')) return 'By Award';
    if (status.includes('waitlist')) return 'Waitlist';
    if (status.includes('pool') && t.qualifiedFirstCmpEventWeek != null) {
        return `Pool W${t.qualifiedFirstCmpEventWeek}`;
    }
    if (t.qualifiedFirstCmpEventWeek != null) {
        return `Pool W${t.qualifiedFirstCmpEventWeek}`;
    }
    return 'Qualified';
}

function _rpQualMethodShort(t) {
    if (t.qualifiedFirstCmpAwardName) return t.qualifiedFirstCmpAwardName;
    const status = (t.championshipStatus || '').toLowerCase();
    if (status.includes('ranking')) return 'DQ';
    if (status.includes('award')) return 'Awd';
    if (status.includes('waitlist')) return 'WL';
    if (status.includes('pool') && t.qualifiedFirstCmpEventWeek != null) {
        return `PW${t.qualifiedFirstCmpEventWeek}`;
    }
    if (t.qualifiedFirstCmpEventWeek != null) {
        return `PW${t.qualifiedFirstCmpEventWeek}`;
    }
    return 'Qual';
}

function clearActiveEvent() {
    currentEvent = null;
    currentEventYear = null;
    currentEventStatus = null;
    localStorage.removeItem('selectedEvent');
    // Clear URL params
    history.replaceState(null, '', location.pathname);
    Realtime.unsubscribe();
    stopRankingsPolling();
    stopPbpRefresh();
    stopPlayoffRefresh();
    hide('active-event-banner');
    const badge = $('event-badge');
    badge.classList.remove('status-ongoing', 'status-upcoming', 'status-completed');
    hide('event-badge');
    $('season-search').value = '';
    $('event-year').value = '';
    $('event-code').value = '';
    // Reset Rankings tab
    show('rankings-empty');
    hide('rankings-container');
    $('event-teams').innerHTML = '';
}

// ── Auto-refresh rankings polling ─────────────────────────
const RANKINGS_POLL_INTERVAL = 10_000; // 10 seconds — uses FRC API for near-instant updates

function startRankingsPolling() {
    stopRankingsPolling();
    if (currentEventStatus !== 'ongoing') return;
    // Realtime handles live updates — no setInterval needed.
    // Subscribe once when event loads (see loadEvent).
}

function stopRankingsPolling() {
    if (rankingsRefreshTimer) {
        clearInterval(rankingsRefreshTimer);
        rankingsRefreshTimer = null;
    }
}

async function refreshRankings() {
    if (!currentEvent) { stopRankingsPolling(); return; }
    try {
        const rApi = getActiveAPI();
        const oldMap = snapshotRankings();
        // Use fast rankings (lightweight: rank, W-L-T, RP only)
        const fastData = await rApi.fastRankings(currentEvent);
        if (fastData && fastData.length) {
            applyFastRankings(fastData, oldMap);
            return;
        }
        // Fallback: full refresh
        const teams = await rApi.refreshRankings(currentEvent);
        $('event-teams').innerHTML = await buildTeamTable(teams);
        applyRankChangeIndicators(oldMap);
    } catch (err) {
        console.warn('[Rankings refresh]', err);
    }
}

/** Merge lightweight FRC-API ranking data into the existing table in-place. */
function applyFastRankings(fastData, oldMap) {
    const table = $('event-teams');
    if (!table) return;
    const fastMap = new Map();
    for (const t of fastData) fastMap.set(t.team_key, t);

    // ── 1. Patch the in-memory PbP/BD data so re-renders show fresh stats ──
    if (pbpData && pbpData.matches) {
        for (const m of pbpData.matches) {
            for (const side of [m.red, m.blue]) {
                if (!side || !side.teams) continue;
                for (const t of side.teams) {
                    const f = fastMap.get(t.team_key);
                    if (!f) continue;
                    t.rank = f.rank;
                    t.wins = f.wins;
                    t.losses = f.losses;
                    t.ties = f.ties;
                    if (f.ranking_points != null) {
                        const mp = f.wins + f.losses + f.ties;
                        t.avg_rp = mp > 0 ? +(f.ranking_points / mp).toFixed(2) : 0;
                    }
                }
            }
        }
        // Re-render the current PbP match if the PbP tab is visible
        const pbpTab = document.querySelector('.tab-btn[data-tab="playbyplay"].active');
        if (pbpTab) renderPbpMatch();
    }

    // ── 2. Update rankings table rows in-place ──
    const rows = table.querySelectorAll('tr[data-team-key]');
    for (const row of rows) {
        const tk = row.dataset.teamKey;
        const f = fastMap.get(tk);
        if (!f) continue;
        const rankCell = row.querySelector('.rank');
        if (rankCell) {
            rankCell.textContent = f.rank;
            rankCell.classList.toggle('rank-top8', f.rank >= 1 && f.rank <= 8);
        }
        const recordCell = row.querySelector('.record');
        if (recordCell) recordCell.textContent = `${f.wins}-${f.losses}-${f.ties}`;
        const rpCell = row.querySelector('.rp');
        if (rpCell) rpCell.textContent = f.ranking_points != null ? f.ranking_points : '-';
    }

    // Re-order rows by rank
    const sortedRows = [...rows].sort((a, b) => {
        const ra = fastMap.get(a.dataset.teamKey)?.rank ?? 999;
        const rb = fastMap.get(b.dataset.teamKey)?.rank ?? 999;
        return ra - rb;
    });
    const tbody = rows[0]?.parentElement;
    if (tbody) {
        for (const row of sortedRows) tbody.appendChild(row);
    }

    // Update the in-memory teamsData so the next snapshot reflects current values
    if (teamsData) {
        for (const t of teamsData) {
            const f = fastMap.get(t.team_key);
            if (!f) continue;
            t.rank = f.rank;
            t.wins = f.wins;
            t.losses = f.losses;
            t.ties = f.ties;
            if (f.ranking_points != null) t.ranking_points = f.ranking_points;
        }
    }

    // Apply rank-change indicators using the snapshot
    if (!oldMap) return;
    let anyChange = false;
    for (const row of rows) {
        const tk = row.dataset.teamKey;
        const f = fastMap.get(tk);
        const old = oldMap.get(tk);
        if (!f || !old) continue;
        const rankDelta = old.rank - f.rank;
        const recordChanged = old.wins !== f.wins || old.losses !== f.losses || old.ties !== f.ties;
        if (rankDelta > 0) {
            row.classList.add('rank-up');
            const rc = row.querySelector('.rank');
            if (rc) { const b = document.createElement('span'); b.className = 'rank-delta rank-delta-up'; b.textContent = `\u2191${rankDelta}`; rc.appendChild(b); }
            anyChange = true;
        } else if (rankDelta < 0) {
            row.classList.add('rank-down');
            const rc = row.querySelector('.rank');
            if (rc) { const b = document.createElement('span'); b.className = 'rank-delta rank-delta-down'; b.textContent = `\u2193${Math.abs(rankDelta)}`; rc.appendChild(b); }
            anyChange = true;
        } else if (recordChanged) {
            row.classList.add('rank-updated');
            anyChange = true;
        }
    }
    if (anyChange) {
        setTimeout(() => {
            table.querySelectorAll('.rank-up, .rank-down, .rank-updated').forEach(el => el.classList.remove('rank-up', 'rank-down', 'rank-updated'));
            table.querySelectorAll('.rank-delta').forEach(el => el.remove());
        }, 8000);
    }
}

// ── Manual event load ─────────────────────────────────────
async function loadEvent(eventKey) {
    let code, year, eventCode;
    const fromSeason = !!eventKey; // true when called from season dropdown
    if (eventKey) {
        code = eventKey;
        year = eventKey.substring(0, 4);
        eventCode = eventKey.substring(4);
    } else {
        year = $('event-year').value.trim();
        eventCode = $('event-code').value.trim().toLowerCase();
        if (!year || !eventCode) return;
        code = `${year}${eventCode}`;
    }

    // Show inline loading indicator on the manual button (only for manual entry)
    const btn = fromSeason ? null : $('btn-load-event');
    if (btn) { btn.disabled = true; btn.dataset.origText = btn.textContent; btn.textContent = 'Loading…'; btn.classList.add('btn-loading'); }

    // Show breathing "Please wait..." pill in header
    const badge = $('event-badge');
    badge.textContent = 'Please wait\u2026';
    badge.className = 'loading';   // clear status classes, add loading
    show('event-badge');

    // Reset state
    // Refresh world-record pill so it always shows the true season high
    fetchWorldRecord();

    playoffData = null;
    allianceData = null;
    summaryData = null;
    eventInfoData = null;
    pbpData = null;
    pbpIndex = 0;
    bdData = null;
    bdIndex = 0;
    bdCache = {};
    historyData = null;
    regionData = null;
    stopBdPolling();
    stopBdListRefresh();
    stopPbpRefresh();
    Realtime.unsubscribe();
    _pbpConnCache = {};
    _pbpConnAllTime = false;
    _pbpAwardsCache = {};
    _gatoolUpdatesCache = {};
    _sponsorsShownTeams.clear();
    _playoffFirstsCache = null;
    _h2hAllTime = false;
    _loadingAwards = false;
    _loadingConnections = false;
    currentAwardFilter = 'all';
    renderedTabs = { playoff: false, alliance: false, playbyplay: false, breakdown: false, history: false };

    // Reset the connections "All Time" toggle to "Past 3 Seasons"
    const connToggle = $('conn-alltime-toggle');
    if (connToggle) connToggle.checked = false;
    const connCard = $('summary-history');
    if (connCard) {
        const connSides = connCard.querySelectorAll('.conn-range-side');
        if (connSides.length === 2) { connSides[0].classList.add('active'); connSides[1].classList.remove('active'); }
    }
    // Reset the H2H "All Time" toggle to "Past 3 Seasons"
    const h2hToggle = $('h2h-all-time-toggle');
    if (h2hToggle) h2hToggle.checked = false;
    const h2hSides = document.querySelectorAll('.h2h-range-side');
    if (h2hSides.length === 2) { h2hSides[0].classList.add('active'); h2hSides[1].classList.remove('active'); }

    try {
        // ── Phase 1: Fetch essentials, show UI immediately ──
        const api = getActiveAPI();

        // Try server snapshot first (single cached request)
        let _snap = null;
        if (!isFTCMode()) {
            try {
                const _ac = new AbortController();
                const _tm = setTimeout(() => _ac.abort(), 5000);
                const _r = await fetch(`/api/events/${code}/snapshot`, { signal: _ac.signal });
                clearTimeout(_tm);
                if (_r.ok) _snap = await _r.json();
            } catch (_) { /* snapshot unavailable — fall back */ }
        }

        const [info, teams] = _snap
            ? [_snap.info, _snap.teams]
            : await Promise.all([
                  api.eventInfo(code),
                  api.eventTeams(code),
              ]).catch(async (netErr) => {
                  // Offline fallback — try IndexedDB cache
                  const cachedInfo  = await DB.getCachedTab(code, 'info');
                  const cachedTeams = await DB.getCachedTab(code, 'teams');
                  if (cachedInfo && cachedTeams) {
                      console.info('[Offline] Using cached info+teams for', code);
                      return [cachedInfo, cachedTeams];
                  }
                  throw netErr;
              });

        // Restore the load button and season search
        if (btn) { btn.disabled = false; btn.textContent = btn.dataset.origText || 'Load Event'; btn.classList.remove('btn-loading'); }
        $('season-search')?.classList.remove('input-loading');

        currentEvent = code;
        currentEventYear = parseInt(year, 10);
        eventInfoData = info;
        localStorage.setItem('selectedEvent', JSON.stringify({ year, eventCode }));
        // Also cache as last event for this mode (for mode-switch restore)
        localStorage.setItem(`lastEvent_${competitionMode}`, code);

        // Update URL with event key for shareable links
        if (new URLSearchParams(location.search).get('event') !== code) {
            history.pushState(null, '', _buildShareUrl({ event: code }));
        } else {
            _syncUrl({ event: code });
        }

        // Disable breakdown tab for pre-2025 events
        updateBreakdownTabState();

        // Sync season search box if this is a 2026 event
        const matchedSeason = seasonEventsRaw.find(e => e.key === code);
        if (matchedSeason) {
            $('season-search').value = matchedSeason.name;
        }

        // Badge — show event name in status color, keep breathing until Phase 2 finishes
        badge.textContent = `${info.name} (${info.year})`;
        badge.classList.remove('status-ongoing', 'status-upcoming', 'status-completed');
        if (info.status) badge.classList.add(`status-${info.status}`);
        // Keep 'loading' class for breathing — Phase 2 will clear it via loading(false)
        currentEventStatus = info.status || null;
        eventCountry = info.country || '';
        eventRegion = info.region || '';
        show('event-badge');

        // Auto-cache info + teams into IndexedDB
        autoCacheTab('info', info);
        autoCacheTab('teams', teams);

        // Start auto-refresh for ongoing events
        startRankingsPolling();

        // Open Realtime WebSocket channel for live push updates
        if (currentEventStatus === 'ongoing') {
            Realtime.subscribe(code);
        }

        // Active event banner
        const statusBadge = info.status
            ? `<span class="aeb-status-badge status-${info.status}">${info.status.toUpperCase()}</span>`
            : '';
        $('aeb-name').textContent = info.name;
        $('aeb-meta').innerHTML = `<span>${info.event_type_string} · ${info.city}, ${info.state_prov} · ${_fmtDate(info.start_date)} → ${_fmtDate(info.end_date)} · ${teams.length} teams</span>${statusBadge}`;

        // Match dot color to event status
        const dot = document.querySelector('.aeb-dot');
        if (dot) {
            dot.classList.remove('dot-ongoing', 'dot-upcoming', 'dot-completed');
            if (info.status) dot.classList.add(`dot-${info.status}`);
        }
        show('active-event-banner');

        // Rankings & Teams tab — sort by team number when no rankings exist
        const hasRankings = teams.some(t => typeof t.rank === 'number');
        if (!hasRankings || currentEventStatus === 'upcoming') {
            teamsSortCol = 'team_number';
            teamsSortAsc = true;
        } else {
            teamsSortCol = 'rank';
            teamsSortAsc = true;
        }
        hide('rankings-empty');
        show('rankings-container');
        $('event-teams').innerHTML = await buildTeamTable(teams);
        fadeIn('rankings-container');

        // Reset dependent tabs — clear both visibility and inner content
        $('summary-empty')?.classList.remove('hidden');
        $('summary-container')?.classList.add('hidden');
        hideSkeleton('summary-loading');
        // Clear summary sub-elements so stale content can't survive an event switch
        ['summary-demographics', 'summary-advancement-content', 'summary-past-champs-list',
         'summary-past-awards-list', 'summary-history-list', 'summary-hof-list',
         'summary-impact-list', 'summary-top-list', 'summary-high-list',
         'summary-prequalified-content'
        ].forEach(id => { const el = $(id); if (el) el.innerHTML = ''; });
        ['summary-advancement', 'summary-prestige-row', 'summary-hof', 'summary-impact',
         'summary-past-champs', 'summary-past-awards', 'summary-history',
         'summary-top-scorers', 'summary-high-scores', 'summary-prequalified'
        ].forEach(id => { const el = $(id); if (el) el.classList.add('hidden'); });
        $('playoff-empty')?.classList.remove('hidden');
        $('playoff-bracket').innerHTML = '';
        hideSkeleton('playoff-loading');
        $('alliance-empty')?.classList.remove('hidden');
        $('alliance-grid').innerHTML = '';
        hideSkeleton('alliance-loading');
        $('bd-empty')?.classList.remove('hidden');
        $('bd-container')?.classList.add('hidden');
        hideSkeleton('bd-loading');
        if ($('bd-content')) $('bd-content').innerHTML = '';
        if ($('bd-status')) $('bd-status').innerHTML = '';
        if ($('bd-match-select')) $('bd-match-select').innerHTML = '';
        $('pbp-empty')?.classList.remove('hidden');
        $('pbp-container')?.classList.add('hidden');
        hideSkeleton('pbp-loading');
        if ($('pbp-arena')) $('pbp-arena').innerHTML = '';
        if ($('pbp-footer')) $('pbp-footer').innerHTML = '';
        if ($('pbp-match-select')) $('pbp-match-select').innerHTML = '';
        if ($('pbp-match-label')) $('pbp-match-label').textContent = '';
        const _oldConn = $('pbp-connections');
        if (_oldConn) _oldConn.innerHTML = '';
        $('history-empty')?.classList.remove('hidden');
        $('history-container')?.classList.add('hidden');
        hideSkeleton('history-loading');
        hideSkeleton('team-loading');
        hideSkeleton('h2h-loading');

        // Also hide any leftover inline error containers
        hideInlineError('summary-error');
        hideInlineError('alliance-error');
        hideInlineError('playoff-error');
        hideInlineError('pbp-error');
        hideInlineError('bd-error');
        hideInlineError('history-error');

        // ── Phase 2: Preload secondary data in background (progressive) ──
        // Each promise renders its section independently as soon as it resolves,
        // instead of waiting for all to finish together.
        loading(true);
        let phase2Done = 0;
        const phase2Total = 3;
        const phase2Check = () => { if (++phase2Done >= phase2Total) { loading(false); updateTabDots(); } };

        // Restore tab from URL hash now that the event is loaded
        restorePendingTab();
        _restorePendingUrlState();

        if (_snap) {
            // Snapshot included all secondary data — hydrate immediately
            if (_snap.matches) { pbpData = _snap.matches; bdData = _snap.matches; }
            if (_snap.playoffs && _snap.playoffs.matches) playoffData = _snap.playoffs.matches;
            if (_snap.alliances) allianceData = _snap.alliances;
            loading(false);
            updateTabDots();
        } else {

        // Matches (feeds PBP + Breakdown)
        const p2api = getActiveAPI();
        p2api.allMatches(code).then(matchData => {
            if (currentEvent !== code) return;
            if (matchData) {
                pbpData = matchData;
                bdData  = matchData;
                autoCacheTab('matches', matchData);
            }
        }).catch(async (err) => {
            // Offline fallback for matches
            const cached = await DB.getCachedTab(code, 'matches');
            if (cached && currentEvent === code) {
                pbpData = cached; bdData = cached;
                console.info('[Offline] Using cached matches for', code);
            } else if (currentEvent === code && err && err.status === 429) {
                setTimeout(() => {
                    p2api.allMatches(code).then(md => { if (currentEvent === code && md) { pbpData = md; bdData = md; autoCacheTab('matches', md); } }).catch(() => {});
                }, 5000);
            }
        }).finally(phase2Check);

        // Playoffs
        p2api.playoffMatches(code).then(playoffResult => {
            if (currentEvent !== code) return;
            if (playoffResult && playoffResult.matches) {
                playoffData = playoffResult.matches;
            }
        }).catch(err => {
            if (currentEvent === code && err && err.status === 429) setTimeout(() => {
                p2api.playoffMatches(code).then(pr => { if (currentEvent === code && pr && pr.matches) playoffData = pr.matches; }).catch(() => {});
            }, 5000);
        }).finally(phase2Check);

        // Alliances
        p2api.alliances(code).then(allianceResult => {
            if (currentEvent !== code) return;
            if (allianceResult) {
                // FTC returns a flat array; wrap it to match FRC format
                if (isFTCMode() && Array.isArray(allianceResult)) {
                    const wrapped = _wrapFtcAlliances(allianceResult);
                    allianceData = wrapped;
                    autoCacheTab('alliances', wrapped);
                } else {
                    allianceData = allianceResult;
                    autoCacheTab('alliances', allianceResult);
                }
            }
        }).catch(async (err) => {
            // Offline fallback for alliances
            const cached = await DB.getCachedTab(code, 'alliances');
            if (cached && currentEvent === code) {
                allianceData = cached;
                console.info('[Offline] Using cached alliances for', code);
            } else if (currentEvent === code && err && err.status === 429) {
                setTimeout(() => {
                    p2api.alliances(code).then(ar => {
                        if (currentEvent !== code || !ar) return;
                        if (isFTCMode() && Array.isArray(ar)) { allianceData = _wrapFtcAlliances(ar); } else { allianceData = ar; }
                        autoCacheTab('alliances', allianceData);
                    }).catch(() => {});
                }, 5000);
            }
        }).finally(phase2Check);

        // Summary — pre-fetch so tab switch is instant (FRC only; FTC builds client-side)
        if (!isFTCMode()) {
            API.eventSummary(code).then(data => {
                if (currentEvent !== code) return;
                if (data && data.demographics) {
                    summaryData = data;
                    autoCacheTab('summary', data);
                    updateTabDots();
                    // If user is already on the summary tab, render immediately
                    const activeTab = document.querySelector('.tab.active');
                    if (activeTab && activeTab.dataset.tab === 'summary') {
                        hideSkeleton('summary-loading');
                        hide('summary-empty');
                        renderSummary(data);
                        const sc = $('summary-container');
                        if (sc) sc.classList.remove('hidden');
                    }
                }
            }).catch(async () => {
                // Offline fallback for summary pre-fetch
                const cached = await DB.getCachedTab(code, 'summary');
                if (cached && cached.demographics && currentEvent === code) {
                    summaryData = cached;
                    updateTabDots();
                    console.info('[Offline] Using cached summary for', code);
                    const activeTab = document.querySelector('.tab.active');
                    if (activeTab && activeTab.dataset.tab === 'summary') {
                        hideSkeleton('summary-loading');
                        hide('summary-empty');
                        renderSummary(cached);
                        const sc = $('summary-container');
                        if (sc) sc.classList.remove('hidden');
                    }
                }
            });
        } else {
            // FTC: pre-fetch the slow API calls in background so summary tab is faster
            _ftcPrefetchSummary(code);
        }

        } // end !_snap fallback

    } catch (err) {
        if (btn) { btn.disabled = false; btn.textContent = btn.dataset.origText || 'Load Event'; btn.classList.remove('btn-loading'); }
        $('season-search')?.classList.remove('input-loading');
        // On error, hide the loading badge
        badge.classList.remove('loading');
        hide('event-badge');
        showInlineError('summary-error', `Error loading event: ${err.message}`, () => loadEvent(code));
        loading(false);
    }
}

// Cache a tab's raw JSON data into IndexedDB for offline use
async function autoCacheTab(tabName, data) {
    if (!currentEvent || !tabName || data == null) return;
    try { await DB.cacheTab(currentEvent, tabName, data); }
    catch (e) { console.warn('[Cache] Failed to cache tab', tabName, e); }
}

/**
 * Try a network fetch; on failure, fall back to IndexedDB cache.
 * Returns { data, offline } where offline=true means data came from cache.
 */
async function _fetchWithCache(fetchFn, eventKey, tabName) {
    try {
        const data = await fetchFn();
        return { data, offline: false };
    } catch (err) {
        const cached = await DB.getCachedTab(eventKey, tabName);
        if (cached != null) {
            console.info(`[Offline] Using cached ${tabName} for ${eventKey}`);
            return { data: cached, offline: true };
        }
        throw err;
    }
}

let teamsData = null;      // cached teams list for sorting
let teamsSortCol = 'rank';  // current sort column
let teamsSortAsc = true;    // sort direction

// ── TIMS overrides in-memory cache ──────────────────────
let _timsCache = {};  // { teamNumber: { nickname, organization, location, top_sponsors, ... } }

async function _loadTimsOverrides() {
    if (!teamsData) return;
    _timsCache = {};
    // Load local overrides from IndexedDB (for instant display after editing)
    for (const t of teamsData) {
        try {
            const rows = await DB.getOverridesByTeam(t.team_key);
            if (rows.length) _timsCache[t.team_number] = rows[0];
        } catch { /* ignore */ }
    }
    // Also seed cache from server-applied overrides already in teamsData
    for (const t of teamsData) {
        if (t.has_tims_overrides && !_timsCache[t.team_number]) {
            _timsCache[t.team_number] = {
                nickname: t.nickname,
                organization: t.school_name,
                top_sponsors: t.top_sponsors || '',
                robot_name: t.robot_name || '',
                number_display: t.number_display || '',
                location: [t.city, t.state_prov].filter(Boolean).join(', '),
                pronunciation: t.name_pronounce || '',
                motto: t.motto || '',
                hardware: t.hardware || '',
                auto_strategy: t.auto_strategy || '',
                teleop_strategy: t.teleop_strategy || '',
            };
        }
    }
}

function _applyTimsOverrides(t) {
    const ov = _timsCache[t.team_number];
    if (!ov) return t;
    const copy = Object.assign({}, t);
    if (ov.nickname) copy.nickname = ov.nickname;
    if (ov.organization) copy.school_name = ov.organization;
    if (ov.location) {
        const parts = ov.location.split(',').map(s => s.trim());
        if (parts.length >= 2) { copy.city = parts[0]; copy.state_prov = parts.slice(1).join(', '); }
        else { copy.city = ov.location; }
    }
    if (ov.top_sponsors) copy._tims_sponsors = ov.top_sponsors;
    if (ov.robot_name) copy.robot_name = ov.robot_name;
    if (ov.number_display) copy.number_display = ov.number_display;
    if (ov.pronunciation) copy.name_pronounce = ov.pronunciation;
    if (ov.motto) copy.motto = ov.motto;
    if (ov.hardware) copy.hardware = ov.hardware;
    if (ov.auto_strategy) copy.auto_strategy = ov.auto_strategy;
    if (ov.teleop_strategy) copy.teleop_strategy = ov.teleop_strategy;
    return copy;
}

function snapshotRankings() {
    if (!teamsData) return null;
    const map = new Map();
    for (const t of teamsData) {
        map.set(t.team_key, { rank: t.rank, wins: t.wins, losses: t.losses, ties: t.ties, ranking_points: t.ranking_points });
    }
    return map;
}

function applyRankChangeIndicators(oldMap) {
    if (!oldMap || !teamsData) return;
    let anyChange = false;
    for (const t of teamsData) {
        const old = oldMap.get(t.team_key);
        if (!old) continue;
        const tr = document.querySelector(`#event-teams tr[data-team-key="${t.team_key}"]`);
        if (!tr) continue;

        const rankDelta = old.rank - t.rank; // positive = moved up
        const recordChanged = old.wins !== t.wins || old.losses !== t.losses || old.ties !== t.ties;

        if (rankDelta > 0) {
            tr.classList.add('rank-up');
            const rankCell = tr.querySelector('.rank');
            if (rankCell) {
                const badge = document.createElement('span');
                badge.className = 'rank-delta rank-delta-up';
                badge.textContent = `\u2191${rankDelta}`;
                rankCell.appendChild(badge);
            }
            anyChange = true;
        } else if (rankDelta < 0) {
            tr.classList.add('rank-down');
            const rankCell = tr.querySelector('.rank');
            if (rankCell) {
                const badge = document.createElement('span');
                badge.className = 'rank-delta rank-delta-down';
                badge.textContent = `\u2193${Math.abs(rankDelta)}`;
                rankCell.appendChild(badge);
            }
            anyChange = true;
        } else if (recordChanged) {
            tr.classList.add('rank-updated');
            anyChange = true;
        }
    }
    if (!anyChange) return;
    // Remove indicators after animation completes
    setTimeout(() => {
        document.querySelectorAll('#event-teams .rank-up, #event-teams .rank-down, #event-teams .rank-updated').forEach(el => {
            el.classList.remove('rank-up', 'rank-down', 'rank-updated');
        });
        document.querySelectorAll('#event-teams .rank-delta').forEach(el => el.remove());
    }, 8000);
}

async function buildTeamTable(teams) {
    teamsData = teams;
    patchFtcAvatars(teamsData);
    await _loadTimsOverrides();
    // Apply the current sort so upcoming events (sorted by team_number) render correctly
    sortTeamsData();
    return rankingsCardView
        ? renderTeamCards(teamsData)
        : renderTeamTable(teamsData, teamsSortCol, teamsSortAsc);
}

function sortTeamsData() {
    if (!teamsData) return;
    const col = teamsSortCol;
    const asc = teamsSortAsc;
    teamsData.sort((a, b) => {
        let va, vb;
        switch (col) {
            case 'rank':
                va = typeof a.rank === 'number' ? a.rank : 999;
                vb = typeof b.rank === 'number' ? b.rank : 999;
                if (va !== vb) return asc ? va - vb : vb - va;
                return a.team_number - b.team_number;  // tiebreak: lowest number first
            case 'team_number':
                return asc ? a.team_number - b.team_number : b.team_number - a.team_number;
            case 'nickname':
                va = (a.nickname || '').toLowerCase();
                vb = (b.nickname || '').toLowerCase();
                return asc ? va.localeCompare(vb) : vb.localeCompare(va);
            case 'location':
                va = [a.city, a.state_prov, a.country].filter(Boolean).join(', ').toLowerCase();
                vb = [b.city, b.state_prov, b.country].filter(Boolean).join(', ').toLowerCase();
                return asc ? va.localeCompare(vb) : vb.localeCompare(va);
            case 'school_name':
                va = (a.school_name || '').toLowerCase();
                vb = (b.school_name || '').toLowerCase();
                return asc ? va.localeCompare(vb) : vb.localeCompare(va);
            case 'record':
                va = a.wins - a.losses;
                vb = b.wins - b.losses;
                if (va !== vb) return asc ? vb - va : va - vb;
                return asc ? b.wins - a.wins : a.wins - b.wins;
            case 'ranking_points':
                va = a.ranking_points ?? -Infinity;
                vb = b.ranking_points ?? -Infinity;
                return asc ? vb - va : va - vb;
            case 'opr':
                return asc ? b.opr - a.opr : a.opr - b.opr;
            case 'epa':
                return asc ? (b.epa ?? -Infinity) - (a.epa ?? -Infinity) : (a.epa ?? -Infinity) - (b.epa ?? -Infinity);
            default:
                return 0;
        }
    });
}

function toggleRankingsCompact(on) {
    rankingsCompact = on;
    if (teamsData) {
        $('event-teams').innerHTML = rankingsCardView
            ? renderTeamCards(teamsData)
            : renderTeamTable(teamsData, teamsSortCol, teamsSortAsc);
    }
}

function toggleRankingsSchool(on) {
    rankingsShowSchool = on;
    if (teamsData) {
        $('event-teams').innerHTML = rankingsCardView
            ? renderTeamCards(teamsData)
            : renderTeamTable(teamsData, teamsSortCol, teamsSortAsc);
    }
}

function toggleRankingsAutoTele(on) {
    rankingsShowAutoTele = on;
    if (teamsData) {
        $('event-teams').innerHTML = rankingsCardView
            ? renderTeamCards(teamsData)
            : renderTeamTable(teamsData, teamsSortCol, teamsSortAsc);
    }
}

function renderTeamTable(teams, sortCol, asc) {
    const arrow = asc ? ' ▲' : ' ▼';
    const th = (key, label) =>
        `<th class="sortable-th col-${key}${sortCol === key ? ' sorted' : ''}" onclick="sortTeams('${key}')">${label}${sortCol === key ? arrow : ''}</th>`;
    const compact = rankingsCompact;

    const school = rankingsShowSchool;
    const ftcMode = isFTCMode();
    const autoTele = ftcMode && rankingsShowAutoTele;
    const viewToggle = `<button class="rankings-view-toggle" onclick="toggleRankingsView()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        ${rankingsCardView ? 'Table View' : 'Card View'}
    </button>`;
    const toolbar = `<div class="rankings-toolbar">
        <label class="toggle-label"><input type="checkbox" ${compact ? 'checked' : ''} onchange="toggleRankingsCompact(this.checked)"> Compact</label>
        <label class="toggle-label school-toggle"><input type="checkbox" ${school ? 'checked' : ''} onchange="toggleRankingsSchool(this.checked)"> School / Org</label>
        ${ftcMode ? `<label class="toggle-label"><input type="checkbox" ${autoTele ? 'checked' : ''} onchange="toggleRankingsAutoTele(this.checked)"> Auto / TeleOp</label>` : ''}
        ${viewToggle}
    </div>`;

    return toolbar + `
    <table class="data-table${compact ? ' compact' : ''}">
        <thead>
            <tr>
                <th class="compare-th"></th>
                ${th('rank', 'Rank')}
                <th class="team-avatar-cell"></th>
                ${th('team_number', 'Team')}
                ${th('nickname', 'Name')}
                ${compact ? '' : th('location', 'Location')}
                ${school ? th('school_name', 'School / Org') : ''}
                ${th('record', 'Record')}
                ${th('opr', 'OPR')}
                ${autoTele ? th('opr_auto', 'Auto') : ''}
                ${autoTele ? th('opr_dc', 'TeleOp') : ''}
                ${compact || ftcMode ? '' : th('epa', 'EPA')}
                ${ftcMode ? '' : `<th class="sortable-th col-ranking_points${teamsSortCol === 'ranking_points' ? ' sorted' : ''}" onclick="sortTeams('ranking_points')"><span class="rp-header-note" title="Unofficial, calculated by TBA">RP*</span>${teamsSortCol === 'ranking_points' ? arrow : ''}</th>`}
            </tr>
        </thead>
        <tbody>
            ${(() => {
                const oprVals = teams.map(t => parseFloat(t.opr)).filter(v => !isNaN(v)).sort((a, b) => a - b);
                const avgOPR = oprVals.length > 0 ? oprVals.reduce((a, b) => a + b, 0) / oprVals.length : 0;
                const p75OPR = oprVals.length > 0 ? oprVals[Math.floor(oprVals.length * 0.75)] : 0;
                const epaVals = teams.map(t => parseFloat(t.epa)).filter(v => !isNaN(v)).sort((a, b) => a - b);
                const avgEPA = epaVals.length > 0 ? epaVals.reduce((a, b) => a + b, 0) / epaVals.length : 0;
                const p75EPA = epaVals.length > 0 ? epaVals[Math.floor(epaVals.length * 0.75)] : 0;
                return teams.map(t => {
                const loc = [t.city, t.state_prov, t.country].filter(Boolean).join(', ');
                const name = formatTeamName(t.nickname);
                const avatarImg = t.avatar
                    ? `<img src="${t.avatar}" class="team-avatar" alt="" loading="lazy">`
                    : `<span class="team-avatar team-avatar-placeholder">${t.team_number}</span>`;
                const checked = compareSelection.has(t.team_key) ? 'checked' : '';
                const isIntl = highlightForeign && t.country && eventCountry && t.country !== eventCountry;
                const isRookie = highlightRookie && t.rookie_year && currentEventYear && t.rookie_year >= currentEventYear;
                const oprVal = parseFloat(t.opr);
                const oprAboveCls = !isNaN(oprVal) && oprVal >= p75OPR ? ' opr-top25-rank' : (!isNaN(oprVal) && oprVal > avgOPR ? ' opr-above-avg-rank' : '');
                const epaVal = parseFloat(t.epa);
                const epaAboveCls = !isNaN(epaVal) && epaVal >= p75EPA ? ' epa-top25-rank' : (!isNaN(epaVal) && epaVal > avgEPA ? ' epa-above-avg-rank' : '');
                return `
            <tr class="${isIntl ? 'foreign-team-row' : ''}${isRookie ? ' rookie-team-row' : ''}" data-team-key="${t.team_key}" data-country="${t.country || ''}" data-rookie-year="${t.rookie_year || ''}">
                <td class="compare-td"><input type="checkbox" class="compare-cb" data-team="${t.team_key}" ${checked} onclick="toggleCompareTeam('${t.team_key}')"></td>
                <td class="rank${Number(t.rank) >= 1 && Number(t.rank) <= 8 ? ' rank-top8' : ''}">${t.rank != null ? t.rank : '\u2013'}</td>
                <td class="team-avatar-cell">${avatarImg}</td>
                <td class="team-num">${t.team_number}</td>
                <td class="team-name">${name}</td>
                ${compact ? '' : `<td class="location">${loc}</td>`}
                ${school ? `<td class="location">${t.school_name || ''}</td>` : ''}
                <td class="stat">${t.wins}-${t.losses}-${t.ties}</td>
                <td class="stat stat-opr${oprAboveCls}">${t.opr}</td>
                ${autoTele ? `<td class="stat">${t.opr_auto != null ? Number(t.opr_auto).toFixed(1) : '\u2013'}</td>` : ''}
                ${autoTele ? `<td class="stat">${t.opr_dc != null ? Number(t.opr_dc).toFixed(1) : '\u2013'}</td>` : ''}
                ${compact || ftcMode ? '' : `<td class="stat stat-epa${epaAboveCls}">${t.epa != null ? t.epa : '\u2013'}</td>`}
                ${ftcMode ? '' : `<td class="stat">${t.ranking_points != null ? t.ranking_points : '\u2013'}</td>`}
            </tr>`;
            }).join('');
            })()}
        </tbody>
    </table>`;
}

function formatTeamName(name) {
    if (!name) return '';
    // Title-case: capitalize first letter of each word, lowercase the rest
    return name.replace(/\S+/g, w => {
        // Keep acronyms (all-caps 2+ letters) as-is
        if (w.length >= 2 && w === w.toUpperCase() && /^[A-Z]+$/.test(w)) return w;
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    });
}

function _ordinal(n) {
    const s = ['th','st','nd','rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function sortTeams(col) {
    if (!teamsData) return;
    if (teamsSortCol === col) {
        teamsSortAsc = !teamsSortAsc;
    } else {
        teamsSortCol = col;
        teamsSortAsc = true;
    }

    sortTeamsData();
    $('event-teams').innerHTML = rankingsCardView
        ? renderTeamCards(teamsData)
        : renderTeamTable(teamsData, teamsSortCol, teamsSortAsc);
    _syncUrl({ sort: col });
}


// ═══════════════════════════════════════════════════════════
// 1b. EVENT SUMMARY
// ═══════════════════════════════════════════════════════════

// Pre-fetch cache for FTC awards (populated in background during event load)
let _ftcPrefetchedAwards = null;
let _ftcPrefetchedSeasonAwards = null;
let _ftcPrefetchEventKey = null;

async function _ftcPrefetchSummary(code) {
    _ftcPrefetchedAwards = null;
    _ftcPrefetchedSeasonAwards = null;
    _ftcPrefetchEventKey = code;
    try {
        // Fire both slow API calls in parallel
        const [awards, seasonResp] = await Promise.all([
            FTC_API.eventAwards(code).catch(() => null),
            FTC_API.eventSeasonAwards(code).catch(() => null),
        ]);
        if (_ftcPrefetchEventKey !== code) return; // stale
        _ftcPrefetchedAwards = awards;
        _ftcPrefetchedSeasonAwards = (seasonResp && Array.isArray(seasonResp.season_awards))
            ? seasonResp.season_awards : [];
    } catch { /* ignore */ }
}

async function loadSummary() {
    if (!currentEvent) return;
    hide('summary-empty');
    hideInlineError('summary-error');

    // FTC mode: build summary from event teams data (no TBA)
    if (isFTCMode()) {
        // If we have teamsData, build a demographic summary from it
        if (!teamsData || !teamsData.length) {
            showInlineError('summary-error', 'Load an event first to see its summary. Team data is required.');
            return;
        }
        showSkeleton('summary-loading', 'summary-loading-status', 'Analysing FTC event data\u2026');
        try {
            const teams = teamsData;
            const countries = [...new Set(teams.map(t => t.country).filter(Boolean))];
            const eventCtry = (eventInfoData && eventInfoData.country) || (countries.length === 1 ? countries[0] : '');
            const foreignCount = eventCtry ? teams.filter(t => t.country && t.country !== eventCtry).length : 0;
            const rookies = teams.filter(t => t.rookie_year && currentEventYear && t.rookie_year >= currentEventYear);

            const demographics = {
                total_teams: teams.length,
                rookie_count: rookies.length,
                rookie_pct: Math.round((rookies.length / teams.length) * 100),
                veteran_count: teams.length - rookies.length,
                veteran_pct: Math.round(((teams.length - rookies.length) / teams.length) * 100),
                avg_team_age: teams.length > 0
                    ? Math.round(teams.reduce((s, t) => s + ((currentEventYear || 2026) - (t.rookie_year || (currentEventYear || 2026))), 0) / teams.length * 10) / 10
                    : 0,
                foreign_count: foreignCount,
                foreign_pct: Math.round((foreignCount / teams.length) * 100),
                event_country: eventCtry,
                country_count: countries.length,
                countries: countries,
            };
            // ── Build top scorers from OPR ──
            const sorted = [...teams].filter(t => t.opr > 0).sort((a, b) => b.opr - a.opr);
            const top_scorers = sorted.slice(0, 3).map(t => ({
                team_number: t.team_number,
                nickname: t.nickname || `Team ${t.team_number}`,
                opr: t.opr,
                rank: t.rank || '-',
            }));

            // ── Build high scores placeholder (empty for now) ──
            const high_scores = [];

            // ── Fetch awards for Inspire winners ──
            let inspire_finalists = [];
            let champMap = new Map();
            try {
                setLoadingStatus('summary-loading-status', 'Fetching event awards\u2026');
                // Use pre-fetched data if available (from _ftcPrefetchSummary), or fetch fresh
                const awards = (_ftcPrefetchEventKey === currentEvent && _ftcPrefetchedAwards != null)
                    ? _ftcPrefetchedAwards
                    : await FTC_API.eventAwards(currentEvent);
                if (Array.isArray(awards)) {
                    // Inspire Award (awardId varies, match by name)
                    const inspireAwards = awards.filter(a =>
                        a.name && /inspire/i.test(a.name) && a.team_number
                    );
                    // Winner / Finalist awards
                    const winnerAwards = awards.filter(a =>
                        a.name && /^(winning|winner)/i.test(a.name) && a.team_number
                    );
                    const finalistAwards = awards.filter(a =>
                        a.name && /^(finalist)/i.test(a.name) && a.team_number
                    );

                    // Determine if this event is FIRST Championship or Premier
                    // (type 6 = "FIRST Championship", type 17 = "Premier")
                    // Excludes regional/country championships (type 4 = "Championship")
                    const evType = (eventInfoData && eventInfoData.event_type_string) || '';
                    const isChampOrPremier = /^FIRST Championship$/i.test(evType) || /premier/i.test(evType);

                    // If Championship/Premier, 1st-place Inspire winners go in the ⭐ prestige section
                    if (isChampOrPremier) {
                        const inspireMap = new Map();
                        const inspire1st = inspireAwards.filter(a => !/2nd|3rd|4th|5th/i.test(a.name));
                        inspire1st.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                        inspire1st.forEach(a => {
                            if (!inspireMap.has(a.team_number)) {
                                const tm = teams.find(t => t.team_number === a.team_number);
                                const typeTag = /championship/i.test(evType) ? ' (Championship)' : ' (Premier)';
                                inspireMap.set(a.team_number, {
                                    team_number: a.team_number,
                                    nickname: tm ? tm.nickname : `Team ${a.team_number}`,
                                    impact_years: [a.name + typeTag],
                                });
                            }
                        });
                        inspire_finalists = [...inspireMap.values()];
                    }

                    // Build Event Winners & Finalists from winner/finalist awards
                    champMap = new Map();
                    [...winnerAwards, ...finalistAwards].forEach(a => {
                        if (!champMap.has(a.team_number)) {
                            const tm = teams.find(t => t.team_number === a.team_number);
                            champMap.set(a.team_number, {
                                team_number: a.team_number,
                                nickname: tm ? tm.nickname : `Team ${a.team_number}`,
                                years_won: [],
                                years_finalist: [],
                                years_inspire: [],
                            });
                        }
                        const entry = champMap.get(a.team_number);
                        if (/^(winning|winner)/i.test(a.name)) entry.years_won.push(a.name);
                        else entry.years_finalist.push(a.name);
                    });

                    // Add only 1st-place Inspire winners to Event Winners & Finalists box
                    inspireAwards.filter(a => !/2nd|3rd|4th|5th/i.test(a.name)).forEach(a => {
                        if (!champMap.has(a.team_number)) {
                            const tm = teams.find(t => t.team_number === a.team_number);
                            champMap.set(a.team_number, {
                                team_number: a.team_number,
                                nickname: tm ? tm.nickname : `Team ${a.team_number}`,
                                years_won: [],
                                years_finalist: [],
                                years_inspire: [],
                            });
                        }
                        const entry = champMap.get(a.team_number);
                        if (!entry.years_inspire) entry.years_inspire = [];
                        entry.years_inspire.push(a.name);
                    });
                }
            } catch (e) {
                console.warn('Could not fetch FTC awards for summary:', e);
            }

            // Show Inspire at all FTC events (it's the top award in FTC)
            const ftcChampions = [...champMap.values()];

            // Collect season-wide big 3 award winners (from prior events this season)
            let ftcSeasonAwards = [];
            try {
                // Use pre-fetched data if available
                if (_ftcPrefetchEventKey === currentEvent && _ftcPrefetchedSeasonAwards != null) {
                    ftcSeasonAwards = _ftcPrefetchedSeasonAwards;
                } else {
                    const resp = await FTC_API.eventSeasonAwards(currentEvent);
                    if (resp && Array.isArray(resp.season_awards)) {
                        ftcSeasonAwards = resp.season_awards;
                    }
                }
            } catch (e) {
                console.warn('Could not fetch FTC season awards:', e);
            }

            const data = { demographics, hall_of_fame: [], impact_finalists: inspire_finalists, ftc_event_champions: ftcChampions, ftc_season_awards: ftcSeasonAwards, top_scorers, high_scores };
            summaryData = data;
            hideSkeleton('summary-loading');
            renderSummary(data);
            fadeIn('summary-container');
            updateTabDots();
        } catch (err) {
            hideSkeleton('summary-loading');
            showInlineError('summary-error', `Failed to build FTC summary: ${err.message}`, loadSummary);
        }
        return;
    }

    showSkeleton('summary-loading', 'summary-loading-status', 'Fetching event summary\u2026');
    hide('summary-container');

    try {
        setLoadingStatus('summary-loading-status', 'Analysing event data\u2026');
        const data = await API.eventSummary(currentEvent);
        if (data.error || !data.demographics) {
            hideSkeleton('summary-loading');
            showInlineError('summary-error', data.error || 'No summary data available for this event yet.', loadSummary);
            return;
        }
        summaryData = data;
        hideSkeleton('summary-loading');
        renderSummary(data);
        fadeIn('summary-container');
        autoCacheTab('summary', data);
        updateTabDots();
    } catch (err) {
        // Offline fallback for summary
        const cached = await DB.getCachedTab(currentEvent, 'summary');
        if (cached && cached.demographics) {
            summaryData = cached;
            hideSkeleton('summary-loading');
            renderSummary(cached);
            fadeIn('summary-container');
            updateTabDots();
            console.info('[Offline] Using cached summary for', currentEvent);
        } else {
            hideSkeleton('summary-loading');
            showInlineError('summary-error', `Failed to load summary: ${err.message}`, loadSummary);
        }
    }
}

/** Lazy-load prior playoff connections for the summary tab */
let _loadingConnections = false;
async function loadSummaryConnections() {
    if (!currentEvent || !summaryData || _loadingConnections) return;
    _loadingConnections = true;
    const eventKey = currentEvent;
    try {
        const connections = await getActiveAPI().eventConnections(eventKey, false);
        if (currentEvent !== eventKey || !summaryData) return; // user switched events
        summaryData.connections = connections;
        summaryData._connections_past3 = connections;
        const histEl = $('summary-history');
        if (connections.length > 0) {
            renderConnections(connections, 'all');
            document.querySelectorAll('.conn-filter-btn').forEach(b => b.classList.remove('active'));
            document.querySelector('.conn-filter-btn[data-conn-filter="all"]')?.classList.add('active');
            histEl.classList.remove('hidden');
        } else {
            histEl.classList.add('hidden');
        }
        // Persist connections into cache alongside the summary
        autoCacheTab('summary', summaryData);
    } catch (err) {
        if (currentEvent !== eventKey) return;
        const isRateLimit = err && (err.status === 429 || /429|rate.?limit/i.test(err.message));
        const msg = isRateLimit
            ? 'Rate limited by API — retrying shortly\u2026'
            : 'Could not load connections.';
        $('summary-history-list').innerHTML = `<p class="empty" style="margin:.5rem 0;font-size:.82rem">${msg}</p>`;
        if (isRateLimit) setTimeout(() => { _loadingConnections = false; loadSummaryConnections(); }, 5000);
    } finally {
        _loadingConnections = false;
    }
}

/** Lazy-load returning event champions & previous-season award winners */
let _loadingAwards = false;
async function loadSummaryAwards() {
    if (!currentEvent || !summaryData || _loadingAwards) return;
    _loadingAwards = true;
    const eventKey = currentEvent;
    try {
        const data = await API.eventSummaryAwards(eventKey);
        if (currentEvent !== eventKey || !summaryData) return; // user switched events

        // ── Championship division: special payload ─────────
        if (data.is_championship) {
            summaryData.is_championship = true;
            summaryData.season_winners = data.season_winners || [];
            summaryData.season_impact = data.season_impact || [];
            summaryData.einstein_contenders = data.einstein_contenders || [];
            _renderChampsSummaryAwards(data);
            autoCacheTab('summary', summaryData);
            return;
        }

        // ── Regular event flow ─────────────────────────────
        summaryData.past_event_champions = data.past_event_champions || [];
        summaryData.past_season_awards = data.past_season_awards || [];

        const champsEl = $('summary-past-champs');
        if (data.past_event_champions && data.past_event_champions.length > 0) {
            renderPastEventChampions(data.past_event_champions);
            champsEl.classList.remove('hidden');
        } else {
            champsEl.classList.add('hidden');
        }

        const awardsEl = $('summary-past-awards');
        if (data.past_season_awards && data.past_season_awards.length > 0) {
            // Only render if past-season tab is active (or no season toggle visible)
            if (currentAwardSeason === 'past') {
                renderPastSeasonAwards(data.past_season_awards);
            }
            awardsEl.classList.remove('hidden');
        } else if (currentAwardSeason === 'past') {
            awardsEl.classList.add('hidden');
        }

        // Persist awards into the cached summary so tab switches
        // and saved-event loads don't need to re-fetch from the API.
        autoCacheTab('summary', summaryData);
    } catch (err) {
        // Don't hide sections — leave summaryData fields unset so the next
        // re-render (tab switch) can retry the fetch automatically.
        if (currentEvent !== eventKey) return;
        const isRateLimit = err && (err.status === 429 || /429|rate.?limit/i.test(err.message));
        const msg = isRateLimit
            ? 'Rate limited by API — retrying shortly\u2026'
            : 'Could not load — switch tabs to retry.';
        $('summary-past-champs-list').innerHTML = `<p class="empty" style="margin:.5rem 0;font-size:.82rem">${msg}</p>`;
        $('summary-past-awards-list').innerHTML = `<p class="empty" style="margin:.5rem 0;font-size:.82rem">${msg}</p>`;
        if (isRateLimit) setTimeout(() => { _loadingAwards = false; loadSummaryAwards(); }, 5000);
    } finally {
        _loadingAwards = false;
    }
}

/** Lazy-load current-season Award Winners (Impact/Winner/Finalist from other events this year). */
let _loadingSeasonAwards = false;
async function loadSeasonAwards() {
    if (!currentEvent || !summaryData || _loadingSeasonAwards) return;
    _loadingSeasonAwards = true;
    const eventKey = currentEvent;
    try {
        const data = await API.eventSeasonAwards(eventKey);
        if (currentEvent !== eventKey || !summaryData) return;
        summaryData.season_awards = data.season_awards || [];
        // Only render if current season tab is still selected
        if (currentAwardSeason === 'current') {
            if (summaryData.season_awards.length > 0) {
                renderPastSeasonAwards(summaryData.season_awards);
                $('summary-past-awards').classList.remove('hidden');
            } else if (summaryData.past_season_awards && summaryData.past_season_awards.length > 0) {
                // No current season awards — auto-switch to past tab
                currentAwardSeason = 'past';
                const toggle = $('award-season-toggle');
                if (toggle) toggle.querySelectorAll('.award-season-btn').forEach(b =>
                    b.classList.toggle('active', b.dataset.season === 'past'));
                renderPastSeasonAwards(summaryData.past_season_awards);
                $('summary-past-awards').classList.remove('hidden');
            } else if (!summaryData.past_season_awards) {
                // Past data still loading — show placeholder
                $('summary-past-awards-list').innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">Loading\u2026</p>';
            } else {
                $('summary-past-awards').classList.add('hidden');
            }
        }
        autoCacheTab('summary', summaryData);
    } catch (err) {
        if (currentEvent !== eventKey) return;
        if (currentAwardSeason === 'current') {
            const isRateLimit = err && (err.status === 429 || /429|rate.?limit/i.test(err.message));
            $('summary-past-awards-list').innerHTML = `<p class="empty" style="margin:.5rem 0;font-size:.82rem">${
                isRateLimit ? 'Rate limited — retrying shortly\u2026' : 'Could not load — switch tabs to retry.'
            }</p>`;
            if (isRateLimit) setTimeout(() => { _loadingSeasonAwards = false; loadSeasonAwards(); }, 5000);
        }
    } finally {
        _loadingSeasonAwards = false;
    }
}

let currentAwardSeason = 'current';

function switchAwardSeason(season, btn) {
    currentAwardSeason = season;
    currentAwardFilter = 'all';
    // Update season toggle
    const bar = btn.parentNode;
    bar.querySelectorAll('.award-season-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // Reset filter buttons
    const body = $('summary-past-awards-body');
    if (body) body.querySelectorAll('.past-awards-filter-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.awardFilter === 'all');
    });
    // Get appropriate data
    const awards = season === 'current'
        ? summaryData?.season_awards
        : (summaryData?.past_season_awards || summaryData?.ftc_past_season_awards);
    if (awards && awards.length > 0) {
        renderPastSeasonAwards(awards);
    } else if (season === 'current' && !summaryData?.season_awards) {
        $('summary-past-awards-list').innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">Loading\u2026</p>';
        if (isFTCMode()) {
            // FTC current-season awards are populated from summary data (not lazy-loaded)
            $('summary-past-awards-list').innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">No award winners found.</p>';
        } else {
            loadSeasonAwards();
        }
    } else if (season === 'past' && !summaryData?.past_season_awards && !summaryData?.ftc_past_season_awards) {
        $('summary-past-awards-list').innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">Loading\u2026</p>';
        if (isFTCMode()) loadFtcPastAwards();
    } else {
        $('summary-past-awards-list').innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">No award winners found.</p>';
    }
}

/** Lazy-load FTC past-season awards (Inspire/Winner/Finalist from previous season). */
let _loadingFtcPastAwards = false;
async function loadFtcPastAwards() {
    if (!currentEvent || !summaryData || _loadingFtcPastAwards) return;
    _loadingFtcPastAwards = true;
    const eventKey = currentEvent;
    try {
        const data = await FTC_API.eventPastAwards(eventKey);
        if (currentEvent !== eventKey || !summaryData) return;
        summaryData.ftc_past_season_awards = data.past_season_awards || [];
        summaryData.past_season_awards = data.past_season_awards || [];
        summaryData.ftc_past_season_year = data.prev_season;

        const awardsEl = $('summary-past-awards');
        if (data.past_season_awards && data.past_season_awards.length > 0) {
            // Update the past-season toggle button label
            const tog = $('award-season-toggle');
            if (tog) {
                const btns = tog.querySelectorAll('.award-season-btn');
                if (btns[1]) btns[1].textContent = String(data.prev_season);
            }
            // Only render if we're currently on the past tab
            if (currentAwardSeason === 'past') {
                renderPastSeasonAwards(data.past_season_awards);
            }
            awardsEl.classList.remove('hidden');
        } else {
            // If nothing loaded & we're on past tab, hide
            if (currentAwardSeason === 'past') awardsEl.classList.add('hidden');
        }
    } catch (err) {
        if (currentEvent !== eventKey) return;
        const msg = /429|rate.?limit/i.test(err?.message || '')
            ? 'Rate limited — retrying shortly\u2026'
            : 'Could not load — switch tabs to retry.';
        $('summary-past-awards-list').innerHTML = `<p class="empty" style="margin:.5rem 0;font-size:.82rem">${msg}</p>`;
        if (/429|rate.?limit/i.test(err?.message || '')) {
            setTimeout(() => { _loadingFtcPastAwards = false; loadFtcPastAwards(); }, 5000);
        }
    } finally {
        _loadingFtcPastAwards = false;
    }
}

/** Render championship-specific awards into the two summary card slots. */
function _renderChampsSummaryAwards(data) {
    const champsEl = $('summary-past-champs');
    const awardsEl = $('summary-past-awards');

    // ── Left card: Season Winners + Impact ─────────────────
    const hasWinners = data.season_winners && data.season_winners.length > 0;
    const hasImpact = data.season_impact && data.season_impact.length > 0;
    if (hasWinners || hasImpact) {
        champsEl.querySelector('h3').textContent = `${currentEventYear} Season Winners & Impact`;

        // Show filter bar and reset to "all"
        const filterBar = $('champs-filter-bar');
        filterBar.classList.remove('hidden');
        filterBar.querySelectorAll('.past-awards-filter-btn').forEach(b => b.classList.remove('active'));
        filterBar.querySelector('[data-champs-filter="all"]').classList.add('active');

        const rows = [];
        for (const t of (data.season_winners || [])) {
            const chips = t.awards.map(a => {
                const front = `\u{1F3C6} Winner @ ${_esc(a.event_name)}`;
                if (a.pick) {
                    const alLabel = a.alliance ? `A${a.alliance} ` : '';
                    return `<span class="past-award-chip past-award-chip-winner pick-flip" onclick="this.classList.toggle('flipped')">
                        <span class="pick-flip-inner">
                            <span class="pick-flip-front">${front}</span>
                            <span class="pick-flip-back">${alLabel}${a.pick}</span>
                        </span>
                    </span>`;
                }
                return `<span class="past-award-chip past-award-chip-winner">${front}</span>`;
            }).join('');
            rows.push(`<div class="summary-hof-team past-award-row" data-champs-type="winner">
                <span class="summary-hof-num">${t.team_number}</span>
                <span class="summary-hof-name">${t.nickname}</span>
                <div class="past-award-chips">${chips}</div>
            </div>`);
        }
        for (const t of (data.season_impact || [])) {
            const chips = t.awards.map(a =>
                `<span class="past-award-chip past-award-chip-impact">\u2B50 Impact @ ${_esc(a.event_name)}</span>`
            ).join('');
            rows.push(`<div class="summary-hof-team past-award-row" data-champs-type="impact">
                <span class="summary-hof-num">${t.team_number}</span>
                <span class="summary-hof-name">${t.nickname}</span>
                <div class="past-award-chips">${chips}</div>
            </div>`);
        }
        $('summary-past-champs-list').innerHTML = rows.join('');
        champsEl.classList.remove('hidden');
    } else {
        champsEl.classList.add('hidden');
    }

    // ── Right card: Returning Einstein Contenders ──────────
    const hasEinstein = data.einstein_contenders && data.einstein_contenders.length > 0;
    if (hasEinstein) {
        awardsEl.querySelector('h3').textContent = 'Returning Einstein Contenders';
        const filterBar = awardsEl.querySelector('.past-awards-filter-bar');
        if (filterBar) filterBar.classList.add('hidden');
        $('summary-past-awards-list').innerHTML = data.einstein_contenders.map(t =>
            `<div class="summary-hof-team">
                <span class="summary-hof-num">${t.team_number}</span>
                <span class="summary-hof-name">${t.nickname}</span>
            </div>`
        ).join('');
        awardsEl.classList.remove('hidden');
    } else {
        awardsEl.classList.add('hidden');
    }
}

/** Filter championship Season Winners & Impact rows by type */
function filterChampsAwards(type, btn) {
    $('champs-filter-bar').querySelectorAll('.past-awards-filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    $('summary-past-champs-list').querySelectorAll('[data-champs-type]').forEach(row => {
        row.style.display = (type === 'all' || row.dataset.champsType === type) ? '' : 'none';
    });
}

/** Lazy-load advancement data (point standings, awards, district rankings) */
let _loadingAdvancement = false;
async function loadSummaryAdvancement() {
    if (!currentEvent || !summaryData || _loadingAdvancement) return;
    _loadingAdvancement = true;
    const eventKey = currentEvent;
    try {
        const data = await API.eventAdvancement(eventKey);
        if (currentEvent !== eventKey || !summaryData) return;
        summaryData.advancement = data;
        renderAdvancement(data);
        autoCacheTab('summary', summaryData);
    } catch (err) {
        if (currentEvent !== eventKey) return;
        const isRateLimit = err && (err.status === 429 || /429|rate.?limit/i.test(err.message));
        const msg = isRateLimit
            ? 'Rate limited by API — retrying shortly\u2026'
            : 'Could not load advancement data.';
        $('summary-advancement-content').innerHTML = `<p class="empty" style="margin:.5rem 0;font-size:.82rem">${msg}</p>`;
        if (isRateLimit) setTimeout(() => { _loadingAdvancement = false; loadSummaryAdvancement(); }, 5000);
    } finally {
        _loadingAdvancement = false;
    }
}

function togglePrequalified() {
    _toggleCollapse('summary-prequalified-body', 'prequalified-toggle-icon');
}

/** Show teams at this event that are already qualified for Championship */
function renderPrequalifiedTeams() {
    const el = $('summary-prequalified');
    const content = $('summary-prequalified-content');
    if (!el || !content) return;

    // Only for FRC 2026+ events with loaded team data
    if (isFTCMode() || !teamsData || !teamsData.length || (currentEventYear && currentEventYear < 2026)) {
        el.classList.add('hidden');
        return;
    }

    // Build lookup of team numbers at this event
    const eventTeamNums = new Set(teamsData.map(t => t.team_number));

    let prequalified = [];

    if (_regionalPoolAllTeams && _regionalPoolAllTeams.length) {
        // Primary: use global pool data (has all teams)
        prequalified = _regionalPoolAllTeams.filter(t =>
            t.qualifiedFirstCmp && eventTeamNums.has(t.teamNumber)
        );
    } else if (summaryData && summaryData.regional_pool && summaryData.regional_pool.length) {
        // Fallback: use summary's regional_pool (this event's teams only)
        prequalified = summaryData.regional_pool
            .filter(t => t.qualified)
            .map(t => ({
                teamNumber: t.team_number,
                totalPoints: t.total_points,
                qualifiedFirstCmpAwardName: t.qual_method || '',
                championshipStatus: t.status || '',
                qualifiedFirstCmp: true,
            }));
    }

    if (!prequalified.length) {
        el.classList.add('hidden');
        return;
    }

    // Sort: award-qualified first, then pool, by total points desc
    prequalified.sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0));

    const badge = $('prequalified-badge');
    if (badge) badge.textContent = `${prequalified.length} team${prequalified.length !== 1 ? 's' : ''}`;

    let html = '<div class="adv-qual-list">';
    prequalified.forEach(t => {
        const method = _rpQualMethod(t);
        let methodCls = 'adv-method-ranking'; // green — directly qualified
        if (method.startsWith('Pool')) {
            methodCls = 'adv-method-backup';  // amber — pool
        } else if (method.toLowerCase().includes('impact')) {
            methodCls = 'adv-method-impact';
        } else if (t.qualifiedFirstCmpAwardName) {
            methodCls = 'adv-method-award';
        }

        const teamObj = teamsData.find(et => et.team_number === t.teamNumber);
        const name = teamObj ? teamObj.nickname : (t.nameShort || '');

        html += '<div class="adv-qual-row">';
        html += `<span class="adv-team-num">${t.teamNumber}</span>`;
        html += `<span class="adv-team-name">${name}</span>`;
        html += '<span class="adv-right-group">';
        html += `<span class="adv-pts">${t.totalPoints != null ? t.totalPoints + ' pts' : ''}</span>`;
        html += `<span class="adv-method ${methodCls}">${method}</span>`;
        html += '</span>';
        html += '</div>';
    });
    html += '</div>';
    content.innerHTML = html;
    el.classList.remove('hidden');
}

function toggleAdvancement() {
    _toggleCollapse('summary-advancement-body', 'advancement-toggle-icon');
}

function renderAdvancement(data) {
    const el = $('summary-advancement');
    const content = $('summary-advancement-content');

    const hasQualified = data.qualified_teams && data.qualified_teams.length > 0;
    const hasDistrict = data.district_rankings && data.district_rankings.length > 0;

    if (!hasQualified && !hasDistrict) {
        el.classList.add('hidden');
        return;
    }

    el.classList.remove('hidden');
    let html = '';

    // ── Direct Qualifications ───────────────────────────────
    if (hasQualified) {
        html += '<div class="adv-section">';
        html += '<div class="adv-qual-list">';
        data.qualified_teams.forEach(t => {
            const m = (t.method || '').toLowerCase();
            const methodCls = m.includes('impact') ? 'adv-method-impact'
                            : m.includes('backup') ? 'adv-method-backup'
                            : m.includes('award')  ? 'adv-method-award'
                            : 'adv-method-ranking';
            const awardsStr = (t.awards || []).filter(a => a !== 'Winner' && a !== 'Finalist').join(', ');
            html += '<div class="adv-qual-row">';
            html += `<span class="adv-team-num">${t.team_number}</span>`;
            html += `<span class="adv-team-name">${t.nickname}</span>`;
            html += '<span class="adv-right-group">';
            if (awardsStr) {
                html += `<span class="adv-awards-badge" title="${awardsStr}">${awardsStr}</span>`;
            }
            html += `<span class="adv-pts" title="Qual ${t.qual_points} · Alliance ${t.alliance_points} · Elim ${t.elim_points} · Award ${t.award_points}">${t.total_points} pts</span>`;
            html += `<span class="adv-method ${methodCls}">${t.method}</span>`;
            html += '</span>';
            html += '</div>';
        });
        html += '</div>';
        html += '</div>';
    }

    // ── District Rankings ───────────────────────────────────
    if (hasDistrict) {
        html += '<div class="adv-section">';
        html += `<h4 class="adv-section-title">${data.district_name || 'District'} Rankings</h4>`;
        html += _renderDistrictRankingsTable(data.district_rankings);
        html += '</div>';
    }

    content.innerHTML = html;
}

function _renderDistrictRankingsTable(rankings) {
    let html = '<div class="adv-table-wrap adv-table-district"><table class="adv-table">';
    html += '<thead><tr><th>Rank</th><th>Team</th><th>Points</th><th>Events</th></tr></thead>';
    html += '<tbody>';

    // Show top 25 + all teams at this event, with gap markers
    const topN = 25;
    const rows = rankings.filter(dr => dr.rank <= topN || dr.at_this_event);
    rows.sort((a, b) => a.rank - b.rank);

    let lastRank = 0;
    rows.forEach(dr => {
        if (dr.rank > lastRank + 1 && lastRank > 0) {
            html += '<tr class="adv-gap"><td colspan="4">···</td></tr>';
        }
        const cls = dr.at_this_event ? 'adv-row-here' : '';
        const star = dr.at_this_event ? ' <span class="adv-here-star">★</span>' : '';
        html += `<tr class="${cls}">`;
        html += `<td>${dr.rank}</td>`;
        html += `<td>${dr.team_number}${star}</td>`;
        html += `<td class="adv-col-total">${dr.point_total}</td>`;
        html += `<td>${dr.event_count}</td>`;
        html += '</tr>';
        lastRank = dr.rank;
    });

    html += '</tbody></table></div>';
    return html;
}

function _champBadge(entries, cls, icon, label) {
    const years = entries.map(y => typeof y === 'object' ? y.year : y).join(', ');
    const frontText = `${icon} ${label}: ${years}`;
    const hasPick = entries.some(y => typeof y === 'object' && y.pick);
    if (!hasPick) return `<span class="past-champ-badge ${cls}">${frontText}</span>`;

    // Single entry with pick → use flip interaction (consistent with award chips)
    if (entries.length === 1) {
        const y = entries[0];
        const alLabel = y.alliance ? `A${y.alliance} ` : '';
        return `<span class="past-champ-badge ${cls} pick-flip" onclick="this.classList.toggle('flipped')">`
             + `<span class="pick-flip-inner">`
             + `<span class="pick-flip-front">${frontText}</span>`
             + `<span class="pick-flip-back">${alLabel}${y.pick}</span>`
             + `</span></span>`;
    }

    // Multiple entries with picks → dropdown popover
    const detailRows = entries.map(y => {
        if (typeof y === 'object' && y.pick) {
            const a = y.alliance ? `<span class="pick-detail-alliance">A${y.alliance}</span>` : '';
            return `<div class="pick-detail-row">`
                 + `<span class="pick-detail-year">${y.year}</span>`
                 + `${a}<span class="pick-detail-pick">${y.pick}</span>`
                 + `</div>`;
        }
        return '';
    }).filter(Boolean).join('');
    return `<span class="past-champ-badge ${cls} has-pick-detail" onclick="togglePickDetail(event, this)">`
         + frontText
         + `<svg class="pick-detail-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"/></svg>`
         + `<div class="pick-detail-popover">${detailRows}</div>`
         + `</span>`;
}

function togglePickDetail(event, el) {
    event.stopPropagation();
    const wasOpen = el.classList.contains('open');
    document.querySelectorAll('.has-pick-detail.open').forEach(e => e.classList.remove('open'));
    if (!wasOpen) {
        el.classList.add('open');
        const pop = el.querySelector('.pick-detail-popover');
        if (pop) {
            const r = el.getBoundingClientRect();
            pop.style.top = (r.bottom + 6) + 'px';
            pop.style.right = (window.innerWidth - r.right) + 'px';
            pop.style.left = '';
            // If it overflows the right edge, flip to left-aligned
            requestAnimationFrame(() => {
                const pr = pop.getBoundingClientRect();
                if (pr.left < 8) {
                    pop.style.right = '';
                    pop.style.left = r.left + 'px';
                }
            });
        }
    }
}
document.addEventListener('click', () => {
    document.querySelectorAll('.has-pick-detail.open').forEach(e => e.classList.remove('open'));
});

function renderPastEventChampions(champions) {
    $('summary-past-champs-list').innerHTML = champions.map(t => {
        const badges = [];
        if (t.years_won.length)
            badges.push(_champBadge(t.years_won, 'past-champ-winner', '\u{1F3C6}', 'Winner'));
        if (t.years_finalist.length)
            badges.push(_champBadge(t.years_finalist, 'past-champ-finalist', '\u{1F948}', 'Finalist'));
        return `<div class="summary-hof-team">
            <span class="summary-hof-num">${t.team_number}</span>
            <span class="summary-hof-name">${t.nickname}</span>
            <span class="past-champ-badges">${badges.join(' ')}</span>
        </div>`;
    }).join('');
}

let currentAwardFilter = 'all';

function filterPastAwards(filter, btn) {
    currentAwardFilter = filter;
    const body = $('summary-past-awards-body');
    if (body) body.querySelectorAll('.past-awards-filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    // Use data from the active season
    let awards;
    if (isFTCMode()) {
        awards = summaryData?.ftc_past_season_awards;
    } else if (currentAwardSeason === 'current') {
        awards = summaryData?.season_awards;
    } else {
        awards = summaryData?.past_season_awards;
    }
    if (awards) renderPastSeasonAwards(awards);
}

function renderPastSeasonAwards(awards) {

    const filtered = currentAwardFilter === 'all'
        ? awards
        : awards.map(t => ({
            ...t,
            // 'impact' filter also matches 'inspire' (FTC equivalent)
            awards: t.awards.filter(a => a.type === currentAwardFilter
                || (currentAwardFilter === 'impact' && a.type === 'inspire')
                || (currentAwardFilter === 'inspire' && a.type === 'impact')),
        })).filter(t => t.awards.length > 0);

    if (filtered.length === 0) {
        $('summary-past-awards-list').innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">No teams match this filter.</p>';
        return;
    }

    $('summary-past-awards-list').innerHTML = filtered.map(t => {
        const chips = t.awards.map(a => {
            const icon = a.type === 'winner' ? '\u{1F3C6}' : a.type === 'finalist' ? '\u{1F948}' : '\u{2B50}';
            const cls = `past-award-chip-${a.type}`;
            const label = a.type.charAt(0).toUpperCase() + a.type.slice(1);
            const front = `${icon} ${label} @ ${_esc(a.event_name)}`;
            if (a.pick) {
                const alLabel = a.alliance ? `A${a.alliance} ` : '';
                return `<span class="past-award-chip ${cls} pick-flip" onclick="this.classList.toggle('flipped')">`
                     + `<span class="pick-flip-inner">`
                     + `<span class="pick-flip-front">${front}</span>`
                     + `<span class="pick-flip-back">${alLabel}${a.pick}</span>`
                     + `</span></span>`;
            }
            return `<span class="past-award-chip ${cls}" title="${_esc(a.event_name)}">${front}</span>`;
        }).join('');
        return `<div class="summary-hof-team past-award-row">
            <span class="summary-hof-num">${t.team_number}</span>
            <span class="summary-hof-name">${t.nickname}</span>
            <div class="past-award-chips">${chips}</div>
        </div>`;
    }).join('');
}

async function refreshSummaryStats() {
    if (!currentEvent) return;
    const btn = document.querySelector('.summary-refresh-btn');
    if (btn) { btn.disabled = true; btn.textContent = '↻ Refreshing…'; }

    try {
        if (isFTCMode()) {
            // FTC: re-run the full summary load (stats are built client-side)
            summaryData = null;
            await loadSummary();
            return;
        }
        const data = await API.eventSummaryRefresh(currentEvent);
        if (data.top_scorers && summaryData) {
            summaryData.top_scorers = data.top_scorers;
            renderTopScorers(data.top_scorers);
        }
        if (data.high_scores && summaryData) {
            summaryData.high_scores = data.high_scores;
            renderHighScores(data.high_scores);
        }
    } catch (err) {
        showToast(`Error refreshing stats: ${err.message}`, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh Stats'; }
    }
}

function renderSummary(data) {
    $('summary-title').textContent = `Event Summary · ${currentEvent.toUpperCase()}`;
    show('summary-container');

    // Demographics
    const d = data.demographics;
    if (!d) {
        $('summary-demographics').innerHTML = '<p class="empty">Demographics not available.</p>';
    } else {
    $('summary-demographics').innerHTML = `
        <div class="summary-stat-card">
            <div class="summary-stat-value">${d.total_teams}</div>
            <div class="summary-stat-label">Total Teams</div>
        </div>
        <div class="summary-stat-card">
            <div class="summary-stat-value">${d.rookie_pct}%</div>
            <div class="summary-stat-label">Rookie Teams <span class="summary-stat-sub">(${d.rookie_count})</span></div>
        </div>
        <div class="summary-stat-card">
            <div class="summary-stat-value">${d.veteran_pct}%</div>
            <div class="summary-stat-label">Veteran Teams <span class="summary-stat-sub">(${d.veteran_count})</span></div>
            <div class="summary-stat-sub">Avg team age: ${d.avg_team_age} yrs</div>
        </div>
        <div class="summary-stat-card">
            <div class="summary-stat-value">${d.foreign_pct}%</div>
            <div class="summary-stat-label">International Teams <span class="summary-stat-sub">(${d.foreign_count}${d.event_country ? ', non-' + d.event_country : ''})</span></div>
        </div>
        <div class="summary-stat-card">
            <div class="summary-stat-value">${d.country_count}</div>
            <div class="summary-stat-label">Countries</div>
            <div class="summary-stat-sub">${d.countries.join(', ')}</div>
        </div>`;
    }

    // Hall of Fame
    const hofEl = $('summary-hof');
    const prestigeRow = $('summary-prestige-row');
    if (data.hall_of_fame.length > 0) {
        $('summary-hof-list').innerHTML = data.hall_of_fame.map(t => {
            const years = t.impact_years ? t.impact_years.join(', ') : '';
            return `<div class="prestige-entry">
                <span class="prestige-entry-num prestige-num-hof">${t.team_number}</span>
                <span class="prestige-entry-name">${t.nickname}</span>
                ${years ? `<span class="prestige-entry-year">${years}</span>` : ''}
            </div>`;
        }).join('');
        hofEl.classList.remove('hidden');
        prestigeRow.classList.remove('hidden');
    } else {
        hofEl.classList.add('hidden');
    }

    // Impact Award Finalists (FRC) / Inspire Winners (FTC)
    const impactEl = $('summary-impact');
    if (data.impact_finalists && data.impact_finalists.length > 0) {
        // Update section label based on program
        const impactLabel = impactEl.querySelector('.highlight-label');
        if (impactLabel) {
            impactLabel.textContent = isFTCMode() ? '⭐ Inspire Award Winners' : '⭐ Impact Award Finalists';
        }
        $('summary-impact-list').innerHTML = data.impact_finalists.map(t => {
            const years = t.impact_years.join(', ');
            return `<div class="prestige-entry">
                <span class="prestige-entry-num prestige-num-impact">${t.team_number}</span>
                <span class="prestige-entry-name">${t.nickname}</span>
                ${years ? `<span class="prestige-entry-year">${years}</span>` : ''}
            </div>`;
        }).join('');
        impactEl.classList.remove('hidden');
        prestigeRow.classList.remove('hidden');
    } else {
        impactEl.classList.add('hidden');
    }
    // Hide row if both empty
    if (data.hall_of_fame.length === 0 && (!data.impact_finalists || data.impact_finalists.length === 0)) {
        prestigeRow.classList.add('hidden');
    }

    // Returning Event Champions & Finalists — lazy-load
    // (Championship divisions use a different payload — handled by _renderChampsSummaryAwards)
    const pastChampsEl = $('summary-past-champs');
    const pastAwardsEl = $('summary-past-awards');

    if (data.is_championship) {
        // Cached championship data — re-render directly
        _renderChampsSummaryAwards(data);
        const seasonToggleHideChamps = $('award-season-toggle');
        if (seasonToggleHideChamps) seasonToggleHideChamps.classList.add('hidden');
    } else if (isFTCMode()) {
        // FTC: Event Winners & Finalists above Prior Playoff Connections, full width
        const historyEl = $('summary-history');
        const container = historyEl?.parentNode;
        if (container && pastChampsEl) {
            container.insertBefore(pastChampsEl, historyEl);
            pastChampsEl.classList.add('ftc-full-width-card');
        }
        // FTC: show event winners & finalists if available (left card)
        if (data.ftc_event_champions && data.ftc_event_champions.length > 0) {
            pastChampsEl.querySelector('h3').textContent = 'Event Winners & Finalists';
            const champsFilterBar = $('champs-filter-bar');
            if (champsFilterBar) champsFilterBar.classList.add('hidden');
            // Sort by award weight: Inspire 1st > Winner > Finalist
            const _awardWeight = t => {
                const inspire1st = (t.years_inspire || []).filter(n => !/2nd/i.test(n));
                return (inspire1st.length ? 4 : 0)
                    + (t.years_won.length ? 2 : 0)
                    + (t.years_finalist.length ? 1 : 0);
            };
            const sorted = [...data.ftc_event_champions].sort((a, b) => _awardWeight(b) - _awardWeight(a));
            $('summary-past-champs-list').innerHTML = sorted.map(t => {
                const wonBadge = t.years_won.length ? '<span class="badge badge-winner">Winner</span>' : '';
                const finBadge = t.years_finalist.length ? '<span class="badge badge-finalist">Finalist</span>' : '';
                // Only highlight 1st-place Inspire (exclude 2nd place)
                const inspire1st = (t.years_inspire || []).filter(n => !/2nd/i.test(n));
                const inspireBadge = inspire1st.length ? '<span class="badge badge-inspire">Inspire</span>' : '';
                return '<div class="adv-qual-row">'
                    + '<span class="adv-team-num">' + t.team_number + '</span>'
                    + '<span class="adv-team-name">' + t.nickname + '</span>'
                    + '<span class="adv-right-group">' + inspireBadge + wonBadge + finBadge + '</span>'
                    + '</div>';
            }).join('');
            pastChampsEl.classList.remove('hidden');
        } else {
            pastChampsEl.classList.add('hidden');
        }

        // Hide FTC dynamic awards card if it exists (migrated to unified card)
        const ftcAwardsOld = $('summary-current-awards');
        if (ftcAwardsOld) ftcAwardsOld.classList.add('hidden');

        // FTC: Unified Award-Winning Teams card with season switcher
        // Reuse the same pastAwardsEl card that FRC uses — move to full-width above connections
        const historyEl2 = $('summary-history');
        const container2 = historyEl2?.parentNode;
        if (container2 && pastAwardsEl) {
            container2.insertBefore(pastAwardsEl, historyEl2);
            pastAwardsEl.classList.add('ftc-full-width-card');
        }
        const impactFilterBtn = pastAwardsEl.querySelector('[data-award-filter="impact"]');
        if (impactFilterBtn) impactFilterBtn.textContent = 'Inspire';
        pastAwardsEl.querySelector('h3').textContent = 'Award-Winning Teams';
        const ftcSeasonToggle = $('award-season-toggle');
        if (ftcSeasonToggle) {
            ftcSeasonToggle.classList.remove('hidden');
            const btns = ftcSeasonToggle.querySelectorAll('.award-season-btn');
            btns[0].textContent = String(currentEventYear);
            btns[1].textContent = String(data.ftc_past_season_year || (currentEventYear - 1));
        }
        const ftcFilterBar = pastAwardsEl.querySelector('.past-awards-filter-bar');
        if (ftcFilterBar) ftcFilterBar.classList.remove('hidden');

        // Store FTC season awards in summaryData so switchAwardSeason can find them
        if (data.ftc_season_awards && data.ftc_season_awards.length > 0) {
            // Convert FTC season awards to the same shape as FRC (past-award-chip format)
            summaryData.season_awards = data.ftc_season_awards;
        }
        if (data.ftc_past_season_awards && data.ftc_past_season_awards.length > 0) {
            summaryData.past_season_awards = data.ftc_past_season_awards;
        }

        // Default to current season tab
        currentAwardSeason = 'current';
        currentAwardFilter = 'all';
        if (ftcSeasonToggle) {
            ftcSeasonToggle.querySelectorAll('.award-season-btn').forEach(b =>
                b.classList.toggle('active', b.dataset.season === 'current'));
        }

        pastAwardsEl.classList.remove('hidden');
        if (summaryData.season_awards && summaryData.season_awards.length > 0) {
            renderPastSeasonAwards(summaryData.season_awards);
        } else if (summaryData.past_season_awards && summaryData.past_season_awards.length > 0) {
            // No current season awards — fall back to past
            currentAwardSeason = 'past';
            if (ftcSeasonToggle) ftcSeasonToggle.querySelectorAll('.award-season-btn').forEach(b =>
                b.classList.toggle('active', b.dataset.season === 'past'));
            renderPastSeasonAwards(summaryData.past_season_awards);
        } else if (!data.ftc_past_season_awards) {
            $('summary-past-awards-list').innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">Loading\u2026</p>';
            loadFtcPastAwards();
        } else {
            pastAwardsEl.classList.add('hidden');
        }
    } else {
        // FRC: restore past-champs and past-awards into pair-row
        const pairRow = document.querySelector('.summary-pair-row');
        if (pairRow && !pairRow.contains(pastChampsEl)) {
            pairRow.insertBefore(pastChampsEl, pairRow.firstChild);
        }
        if (pairRow && !pairRow.contains(pastAwardsEl)) {
            pairRow.appendChild(pastAwardsEl);
        }
        pastChampsEl.classList.remove('ftc-full-width-card');
        pastAwardsEl.classList.remove('ftc-full-width-card');
        // Reset titles in case we're switching from a champs to a regular event
        pastChampsEl.querySelector('h3').textContent = 'Returning Champions & Finalists';
        pastAwardsEl.querySelector('h3').textContent = 'Award-Winning Teams';
        const filterBar = pastAwardsEl.querySelector('.past-awards-filter-bar');
        if (filterBar) filterBar.classList.remove('hidden');
        // Reset "Inspire" back to "Impact" for FRC
        const impactBtn = pastAwardsEl.querySelector('[data-award-filter="impact"]');
        if (impactBtn) impactBtn.textContent = 'Impact';
        // Hide FTC awards card in FRC mode
        const ftcAwardsElHide = $('summary-current-awards');
        if (ftcAwardsElHide) ftcAwardsElHide.classList.add('hidden');
        const champsFilterBar = $('champs-filter-bar');
        if (champsFilterBar) champsFilterBar.classList.add('hidden');

        pastChampsEl.classList.remove('hidden');
        if (data.past_event_champions && data.past_event_champions.length > 0) {
            renderPastEventChampions(data.past_event_champions);
        } else if (!data.past_event_champions) {
            $('summary-past-champs-list').innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">Loading\u2026</p>';
        } else {
            pastChampsEl.classList.add('hidden');
        }

        // FRC: Award-Winning Teams — season toggle (current year / previous year)
        const seasonToggle = $('award-season-toggle');
        if (seasonToggle) {
            seasonToggle.classList.remove('hidden');
            const btns = seasonToggle.querySelectorAll('.award-season-btn');
            btns[0].textContent = String(currentEventYear);
            btns[1].textContent = String(currentEventYear - 1);
        }
        pastAwardsEl.querySelector('h3').textContent = 'Award-Winning Teams';
        const awardFilterBar = pastAwardsEl.querySelector('.past-awards-filter-bar');
        if (awardFilterBar) awardFilterBar.classList.remove('hidden');

        // Default to current season tab
        currentAwardSeason = 'current';
        currentAwardFilter = 'all';
        // Reset toggle button active states
        if (seasonToggle) {
            seasonToggle.querySelectorAll('.award-season-btn').forEach(b =>
                b.classList.toggle('active', b.dataset.season === 'current'));
        }

        pastAwardsEl.classList.remove('hidden');
        if (data.season_awards && data.season_awards.length > 0) {
            renderPastSeasonAwards(data.season_awards);
        } else if (!data.season_awards) {
            $('summary-past-awards-list').innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">Loading\u2026</p>';
            loadSeasonAwards();
        } else if (data.past_season_awards && data.past_season_awards.length > 0) {
            // No current season awards — fall back to past season tab
            currentAwardSeason = 'past';
            if (seasonToggle) seasonToggle.querySelectorAll('.award-season-btn').forEach(b =>
                b.classList.toggle('active', b.dataset.season === 'past'));
            renderPastSeasonAwards(data.past_season_awards);
        } else if (!data.past_season_awards) {
            $('summary-past-awards-list').innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">Loading\u2026</p>';
        } else {
            pastAwardsEl.classList.add('hidden');
        }
    }

    // If awards haven't been loaded yet (undefined) or came back empty
    // (possibly due to a transient API failure), retry the fetch.
    // Skip for FTC — no past-event-champion / past-season-award API.
    const _noChamps = !data.is_championship && (!data.past_event_champions || data.past_event_champions.length === 0);
    const _noAwards = !data.is_championship && (!data.past_season_awards  || data.past_season_awards.length === 0);
    if (_noChamps && _noAwards && !isFTCMode()) {
        loadSummaryAwards();
    }

    // Pre-qualified teams (FRC only — cross-reference with regional pool)
    renderPrequalifiedTeams();

    // Advancement — lazy-load (only for completed events)
    const advEl = $('summary-advancement');
    if (currentEventStatus === 'completed' && !isFTCMode()) {
        advEl.classList.remove('hidden');
        if (data.advancement && (data.advancement.qualified_teams?.length || data.advancement.district_rankings?.length)) {
            renderAdvancement(data.advancement);
        } else if (!data.advancement) {
            $('summary-advancement-content').innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">Loading…</p>';
            loadSummaryAdvancement();
        } else {
            advEl.classList.add('hidden');
        }
    } else {
        advEl.classList.add('hidden');
    }

    // Prior connections — lazy-load on demand
    const histEl = $('summary-history');
    {
        histEl.classList.remove('hidden');
        if (data.connections && data.connections.length > 0) {
            // Connections came from cache — render immediately
            renderConnections(data.connections, 'all');
            document.querySelectorAll('.conn-filter-btn').forEach(b => b.classList.remove('active'));
            document.querySelector('.conn-filter-btn[data-conn-filter="all"]')?.classList.add('active');
        } else if (!data.connections) {
            // Not loaded yet — show placeholder, fetch in background
            $('summary-history-list').innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">Loading connections…</p>';
            loadSummaryConnections();
        } else {
            histEl.classList.add('hidden');
        }
    }

    // Top scorers
    renderTopScorers(data.top_scorers);

    // High scores (by match)
    renderHighScores(data.high_scores);
}

let currentConnFilter = 'all';
let currentConnSearch = '';
let currentConnSort = 'most';

function toggleSummarySection(type) {
    const bodyMap = {
        'past-champs': 'summary-past-champs-body',
        'past-awards': 'summary-past-awards-body',
    };
    const bodyId = bodyMap[type] || 'summary-past-awards-body';
    _toggleCollapse(bodyId, type + '-toggle-icon');
}

function toggleConnections() {
    _toggleCollapse('summary-history-body', 'conn-toggle-icon');
}

function filterConnections(filter, btn) {
    currentConnFilter = filter;
    document.querySelectorAll('.conn-filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    applyConnFilters();
}

function setConnSort(sort, btn) {
    currentConnSort = sort;
    document.querySelectorAll('.conn-sort-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    applyConnFilters();
}

function applyConnFilters() {
    currentConnSearch = ($('conn-team-search')?.value || '').trim();
    if (summaryData) renderConnections(summaryData.connections, currentConnFilter);
}

async function toggleConnRange(allTime) {
    if (!currentEvent || !summaryData) return;
    // Update toggle label styling (scoped to the summary connections card only)
    const card = $('summary-history');
    if (card) {
        const sides = card.querySelectorAll('.conn-range-side');
        if (sides.length === 2) {
            sides[0].classList.toggle('active', !allTime);
            sides[1].classList.toggle('active', allTime);
        }
    }
    const list = $('summary-history-list');

    try {
        let connections;
        if (allTime) {
            // Try cached all-time data first
            if (summaryData._connections_alltime) {
                connections = summaryData._connections_alltime;
            } else {
                list.innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">Loading connections…</p>';
                connections = await getActiveAPI().eventConnections(currentEvent, true);
                summaryData._connections_alltime = connections;
            }
        } else {
            // Past 3: use the original connections that came with the summary
            connections = summaryData._connections_past3 || summaryData.connections;
        }
        summaryData.connections = connections;
        applyConnFilters();
    } catch (err) {
        list.innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">Error loading connections.</p>';
    }
}

function toggleConnRow(el) {
    el.classList.toggle('expanded');
}

function renderConnections(connections, filter) {
    const search = currentConnSearch;

    let filtered = connections.filter(c => {
        // type filter
        if (filter === 'partners' && c.partnered_at.length === 0) return false;
        if (filter === 'opponents' && c.opponents_at.length === 0) return false;
        if (filter === 'winners' && !c.partnered_at.some(p => p.result === 'winner')) return false;
        if (filter === 'finalists' && !c.partnered_at.some(p => p.result === 'finalist')) return false;
        // team search
        if (search) {
            const q = search.toLowerCase();
            if (!String(c.team_a).includes(q) && !String(c.team_b).includes(q)
                && !c.team_a_name.toLowerCase().includes(q) && !c.team_b_name.toLowerCase().includes(q)) return false;
        }
        return true;
    });

    // Sort
    if (currentConnSort === 'recent') {
        filtered.sort((a, b) => {
            const ya = Math.max(...[...a.partnered_at, ...a.opponents_at].map(e => e.year));
            const yb = Math.max(...[...b.partnered_at, ...b.opponents_at].map(e => e.year));
            return yb - ya;
        });
    } else if (currentConnSort === 'oldest') {
        filtered.sort((a, b) => {
            const ya = Math.min(...[...a.partnered_at, ...a.opponents_at].map(e => e.year));
            const yb = Math.min(...[...b.partnered_at, ...b.opponents_at].map(e => e.year));
            return ya - yb;
        });
    } else {
        // 'most' — default: most total connections first
        filtered.sort((a, b) => (b.partnered_at.length + b.opponents_at.length) - (a.partnered_at.length + a.opponents_at.length));
    }

    if (filtered.length === 0) {
        $('summary-history-list').innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">No connections match this filter.</p>';
        return;
    }

    $('summary-history-list').innerHTML = filtered.map(c => {
        const partnerCount = c.partnered_at.length;
        const opponentCount = c.opponents_at.length;
        const totalCount = partnerCount + opponentCount;

        // Summary chips for the header
        const chips = [];
        const svgPartner = '<svg class="conn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 17a4 4 0 0 1-4 4H5a4 4 0 0 1-4-4 4 4 0 0 1 4-4h1"/><path d="M13 17a4 4 0 0 0 4 4h2a4 4 0 0 0 4-4 4 4 0 0 0-4-4h-1"/><path d="M7 13 5 3l4 2 3-2 3 2 4-2-2 10"/></svg>';
        const svgOpponent = '<svg class="conn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="M13 19l6-6"/><path d="M16 16l4 4"/><path d="M19 21l2-2"/><path d="M14.5 6.5 18 3h3v3l-3.5 3.5"/><path d="m5 14 4 4"/><path d="m7 17-2 2"/></svg>';
        if (partnerCount) chips.push(`<span class="conn-chip conn-chip-partner">${svgPartner} ${partnerCount}</span>`);
        if (opponentCount) chips.push(`<span class="conn-chip conn-chip-opponent">${svgOpponent} ${opponentCount}</span>`);

        // Detail lines (shown on expand)
        const lines = [];
        c.partnered_at.forEach(p => {
            const resultBadge = p.result === 'winner' ? '<span class="conn-detail-result conn-result-winner">Winner</span>'
                : p.result === 'finalist' ? '<span class="conn-detail-result conn-result-finalist">Finalist</span>' : '';
            lines.push(`<div class="conn-detail-line conn-line-partner">
                <span class="conn-detail-icon">${svgPartner}</span>
                <span class="conn-detail-event">${p.event_name || p.event_key}</span>
                <span class="conn-detail-year">${p.year}</span>
                ${resultBadge}
                <span class="conn-detail-stage">${p.stage}</span>
            </div>`);
        });
        c.opponents_at.forEach(o => {
            lines.push(`<div class="conn-detail-line conn-line-opponent">
                <span class="conn-detail-icon">${svgOpponent}</span>
                <span class="conn-detail-event">${o.event_name || o.event_key}</span>
                <span class="conn-detail-year">${o.year}</span>
                <span class="conn-detail-stage">${o.stage}</span>
            </div>`);
        });

        return `
        <div class="conn-row" onclick="toggleConnRow(this)">
            <div class="conn-row-header">
                <span class="conn-team has-tooltip">${c.team_a}<span class="custom-tooltip">${c.team_a_name}</span></span>
                <span class="conn-vs">&amp;</span>
                <span class="conn-team has-tooltip">${c.team_b}<span class="custom-tooltip">${c.team_b_name}</span></span>
                <span class="conn-chips">${chips.join('')}</span>
                <span class="conn-expand-icon">▸</span>
            </div>
            <div class="conn-row-details">${lines.join('')}</div>
        </div>`;
    }).join('');
}

function renderTopScorers(scorers) {
    const el = $('summary-top-scorers');
    if (!scorers || scorers.length === 0) { if (el) el.classList.add('hidden'); return; }
    if (scorers.length > 0) {
        const medals = ['1st', '2nd', '3rd'];
        $('summary-top-list').innerHTML = scorers.map((s, i) => `
            <div class="summary-top-row">
                <span class="top-medal">${medals[i] || ''}</span>
                <span class="top-team-num">${s.team_number}</span>
                <span class="top-team-name">${s.nickname}</span>
                <span class="top-opr">OPR ${s.opr}</span>
                <span class="top-rank">${s.rank !== '-' ? `Rank #${s.rank}` : ''}</span>
            </div>`).join('');
        el.classList.remove('hidden');
    } else {
        el.classList.add('hidden');
    }
}

function renderHighScores(scores) {
    const el = $('summary-high-scores');
    if (!el) return;
    if (!scores || scores.length === 0) {
        el.classList.add('hidden');
        return;
    }
    const medals = ['1st', '2nd', '3rd'];
    $('summary-high-list').innerHTML = scores.map((s, i) => {
        const colorCls = s.color === 'red' ? 'high-score-red' : 'high-score-blue';
        const teamNums = s.teams.map(t => {
            const nick = (_timsCache[t.team_number]?.nickname) || t.nickname;
            return `<span class="high-score-team has-tooltip">${t.team_number}${nick ? `<span class="custom-tooltip">${nick}</span>` : ''}</span>`;
        }).join(', ');
        return `
            <div class="summary-high-row">
                <span class="top-medal">${medals[i] || ''}</span>
                <span class="high-score-val ${colorCls}">${s.score}</span>
                <span class="high-score-match">${s.match}</span>
                <span class="high-score-teams">${teamNums}</span>
            </div>`;
    }).join('');
    el.classList.remove('hidden');
}


// ═══════════════════════════════════════════════════════════
// 2. PLAYOFFS
// ═══════════════════════════════════════════════════════════
async function loadPlayoffs() {
    if (!currentEvent) return;
    hideInlineError('playoff-error');
    try {
        setLoadingStatus('playoff-loading-status', 'Fetching playoff matches\u2026');
        const data = await getActiveAPI().playoffMatches(currentEvent);
        playoffData = data.matches;
        hideSkeleton('playoff-loading');
        if (!playoffData?.length) {
            const el = $('playoff-empty');
            if (el) {
                el.textContent = currentEventStatus === 'upcoming'
                    ? 'The playoff schedule for this event has not been published yet.'
                    : 'No playoff data available for this event.';
                el.classList.remove('hidden');
            }
            return;
        }
        hide('playoff-empty');
        if (isFTCMode()) {
            renderFtcBracket();
        } else {
            renderBracketTree();
        }
        fadeIn('playoff-bracket');
        updateTabDots();
    } catch (err) {
        hideSkeleton('playoff-loading');
        showInlineError('playoff-error', `Failed to load playoffs: ${err.message}`, loadPlayoffs);
    }
}

// ── Playoff auto-refresh ──────────────────────────────────
function startPlayoffRefresh() {
    stopPlayoffRefresh();
    if (currentEventStatus !== 'ongoing') return;
    // Realtime handles live updates — no setInterval needed.
}

function stopPlayoffRefresh() {
    if (playoffRefreshTimer) {
        clearInterval(playoffRefreshTimer);
        playoffRefreshTimer = null;
    }
}

async function playoffAutoRefresh() {
    if (!currentEvent) { stopPlayoffRefresh(); return; }
    try {
        const data = await getActiveAPI().playoffMatches(currentEvent);
        if (!data?.matches?.length || currentEvent !== data.event_key) return;
        playoffData = data.matches;
        if (renderedTabs.playoff) {
            if (isFTCMode()) renderFtcBracket();
            else renderBracketTree();
        }
    } catch (_) { /* silently ignore */ }
}

/* ── FRC Double-Elimination Bracket Tree ─────────────────── */

// Upper bracket structure: sets that merge
// [pair] → winner
const UPPER_R1_PAIRS = [[1, 2], [3, 4]]; // → sets 7, 8
const UPPER_R2_PAIR  = [7, 8];           // → set 11

// Lower bracket structure
const LOWER_R2_SETS  = [5, 6];         // L(R1) play-in
const LOWER_R3_SETS  = [9, 10];        // W(R2L) vs L(R2U)
const LOWER_R3_PAIR  = [9, 10];        // → set 12
const LOWER_R5_SET   = 13;             // W(12) vs L(11)

// Descriptions for each set
const SET_DESCRIPTIONS = {
    1: '#1 vs #8', 2: '#4 vs #5', 3: '#2 vs #7', 4: '#3 vs #6',
    5: 'L1 vs L2', 6: 'L3 vs L4',
    7: 'W1 vs W2', 8: 'W3 vs W4',
    9: 'W5 vs L8', 10: 'W6 vs L7',
    11: 'W7 vs W8', 12: 'W9 vs W10', 13: 'W12 vs L11',
    'f': 'W11 vs W13'
};

function renderBracketTree() {
    if (!playoffData || !playoffData.length) {
        $('playoff-bracket').innerHTML = '<p class="empty">No playoff matches found.</p>';
        return;
    }

    // Index matches by set_number; keep latest replay per set
    const bySet = {};
    const finals = [];
    playoffData.forEach(m => {
        if (m.bracket === 'final') {
            finals.push(m);
        } else {
            const s = m.set_number;
            if (!bySet[s] || m.match_number > bySet[s].match_number) bySet[s] = m;
        }
    });
    // Index finals by match_number so we can render all of them
    const finalsByNum = {};
    finals.forEach(m => { finalsByNum[m.match_number] = m; });
    // If no finals exist yet, ensure a placeholder slot for Final 1
    const finalNums = Object.keys(finalsByNum).map(Number).sort((a, b) => a - b);
    if (!finalNums.length) finalNums.push(1);

    // Build team_number -> nickname map from loaded teamsData
    const _nickMap = {};
    if (teamsData) teamsData.forEach(t => { if (t.nickname) _nickMap[t.team_number] = t.nickname; });
    const _teamSpan = (num) => {
        const nick = _nickMap[num];
        return nick
            ? `<span class="has-tooltip bkt-team-num">${num}<span class="custom-tooltip">${nick}</span></span>`
            : `<span class="bkt-team-num">${num}</span>`;
    };
    const _teamsHtml = (nums) => nums.map(_teamSpan).join(' · ');

    // Render helpers
    const slot = (setNum, label) => {
        let m;
        if (typeof setNum === 'string' && setNum.startsWith('f')) {
            m = finalsByNum[parseInt(setNum.substring(1), 10)];
        } else {
            m = bySet[setNum];
        }
        const desc = SET_DESCRIPTIONS[setNum] || '';
        if (!m) {
            return `<div class="bkt-slot bkt-tbd">
                        <div class="bkt-slot-header">${label}</div>
                        <div class="bkt-slot-body"><span class="bkt-tbd-text">TBD</span></div>
                        ${desc ? `<div class="bkt-slot-desc">${desc}</div>` : ''}
                    </div>`;
        }
        const redWon  = m.winning_alliance === 'red';
        const blueWon = m.winning_alliance === 'blue';
        const upcoming = m.red.score < 0 && m.blue.score < 0;
        const redLost = blueWon;
        const blueLost = redWon;
        const replay = m.match_number > 1 ? ` <span class="bkt-replay">R${m.match_number}</span>` : '';
        const redSeed  = m.red.alliance_number  ? `<span class="bkt-seed">#${m.red.alliance_number}</span>` : '';
        const blueSeed = m.blue.alliance_number ? `<span class="bkt-seed">#${m.blue.alliance_number}</span>` : '';
        return `<div class="bkt-slot ${upcoming ? 'bkt-upcoming' : ''} ${redWon || blueWon ? 'bkt-decided' : ''}">
                    <div class="bkt-slot-header">${label}${replay}</div>
                    <div class="bkt-row bkt-red ${redWon ? 'bkt-won' : ''}${redLost ? ' bkt-lost' : ''}">
                        ${redSeed}
                        <span class="bkt-teams">${_teamsHtml(m.red.team_numbers)}</span>
                        <span class="bkt-score">${upcoming ? '–' : m.red.score}</span>
                    </div>
                    <div class="bkt-row bkt-blue ${blueWon ? 'bkt-won' : ''}${blueLost ? ' bkt-lost' : ''}">
                        ${blueSeed}
                        <span class="bkt-teams">${_teamsHtml(m.blue.team_numbers)}</span>
                        <span class="bkt-score">${upcoming ? '–' : m.blue.score}</span>
                    </div>
                    ${desc ? `<div class="bkt-slot-desc">${desc}</div>` : ''}
                </div>`;
    };

    $('playoff-bracket').innerHTML = `
        <div class="bracket-grid">
            <!-- ── Round headers ─────────────────── -->
            <div class="bg-corner"></div>
            <div class="bg-rnd-hdr">Round 1</div>
            <div class="bg-rnd-hdr">Round 2</div>
            <div class="bg-rnd-hdr">Round 3</div>
            <div class="bg-rnd-hdr">Round 4</div>
            <div class="bg-rnd-hdr">Round 5</div>
            <div class="bg-rnd-hdr bg-rnd-hdr-final">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                Finals
            </div>

            <!-- ── Upper bracket row ─────────────── -->
            <div class="bg-side-label bg-upper-label">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>
                Upper
            </div>
            <div class="bg-cell bg-cell-upper">
                ${slot(1, 'M1')}${slot(2, 'M2')}${slot(3, 'M3')}${slot(4, 'M4')}
            </div>
            <div class="bg-cell bg-cell-upper">
                ${slot(7, 'M7')}${slot(8, 'M8')}
            </div>
            <div class="bg-cell bg-cell-upper bg-cell-empty"></div>
            <div class="bg-cell bg-cell-upper">
                ${slot(11, 'M11')}
            </div>
            <div class="bg-cell bg-cell-upper bg-cell-empty"></div>
            <div class="bg-cell bg-cell-final">
                ${finalNums.map(n => slot('f' + n, 'Final ' + n)).join('')}
            </div>

            <!-- ── Lower bracket row ─────────────── -->
            <div class="bg-side-label bg-lower-label">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                Lower
            </div>
            <div class="bg-cell bg-cell-lower bg-cell-empty"></div>
            <div class="bg-cell bg-cell-lower">
                ${slot(5, 'M5')}${slot(6, 'M6')}
            </div>
            <div class="bg-cell bg-cell-lower">
                ${slot(9, 'M9')}${slot(10, 'M10')}
            </div>
            <div class="bg-cell bg-cell-lower">
                ${slot(12, 'M12')}
            </div>
            <div class="bg-cell bg-cell-lower">
                ${slot(13, 'M13')}
            </div>
            <!-- Finals column already spans into this row -->
        </div>
        ${_buildMobileBracket(slot, finalNums)}
    `;

    // Append scroll-to-finals button to tab-playoff (outside the scroll container)
    let arrowWrapper = document.getElementById('bracket-scroll-wrapper');
    if (!arrowWrapper) {
        arrowWrapper = document.createElement('div');
        arrowWrapper.id = 'bracket-scroll-wrapper';
        arrowWrapper.className = 'bracket-scroll-arrow-wrapper';
        arrowWrapper.innerHTML = `<button class="bracket-scroll-arrow" id="bracket-scroll-finals" onclick="scrollBracketToFinals()" title="Scroll to Finals">
                Finals
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>`;
        $('tab-playoff').appendChild(arrowWrapper);
    }

    // Set up scroll-based visibility for the arrow
    _setupBracketScrollArrow();
}

/* ── FTC Playoff Bracket Renderer ────────────────────────── */
function renderFtcBracket() {
    if (!playoffData || !playoffData.length) {
        $('playoff-bracket').innerHTML = '<p class="empty">No playoff matches found.</p>';
        return;
    }
    // Detect double-elim events (labels contain "Upper" / "Lower")
    const hasDoubleElim = playoffData.some(m => /upper|lower/i.test(m.label || ''));
    if (hasDoubleElim) {
        _renderFtcBracketTree();
    } else {
        _renderFtcBracketSeries();
    }
}

/* ── FTC double-elim bracket tree (Upper / Lower / Finals grid) ── */
function _renderFtcBracketTree() {
    const _nickMap = {};
    if (teamsData) teamsData.forEach(t => { if (t.nickname) _nickMap[t.team_number] = t.nickname; });
    const _teamSpan = (num) => {
        const nick = _nickMap[num];
        return nick
            ? `<span class="has-tooltip bkt-team-num">${num}<span class="custom-tooltip">${nick}</span></span>`
            : `<span class="bkt-team-num">${num}</span>`;
    };
    const _teamsHtml = (nums) => nums.map(_teamSpan).join(' · ');

    // Group matches by series (set_number)
    const bySeries = {};
    playoffData.forEach(m => {
        const s = m.set_number || 1;
        if (!bySeries[s]) bySeries[s] = [];
        bySeries[s].push(m);
    });
    Object.values(bySeries).forEach(arr => arr.sort((a, b) => a.match_number - b.match_number));

    // Classify each series into upper / lower / final
    const upper = {};   // round -> [seriesMatches, ...]
    const lower = {};
    const finals = [];  // [seriesMatches, ...]

    for (const matches of Object.values(bySeries)) {
        const label = (matches[0].label || '').toLowerCase();
        if (/final/.test(label)) {
            finals.push(matches);
        } else if (/upper/.test(label)) {
            const rm = label.match(/r(\d+)/);
            const round = rm ? parseInt(rm[1]) : 1;
            if (!upper[round]) upper[round] = [];
            upper[round].push(matches);
        } else if (/lower/.test(label)) {
            const rm = label.match(/r(\d+)/);
            const round = rm ? parseInt(rm[1]) : 1;
            if (!lower[round]) lower[round] = [];
            lower[round].push(matches);
        } else {
            if (!upper[1]) upper[1] = [];
            upper[1].push(matches);
        }
    }

    // Sort series within each round by alliance number (first red alliance)
    const sortSeries = (arr) => arr.sort((a, b) =>
        (a[0]?.red?.alliance_number || 0) - (b[0]?.red?.alliance_number || 0));
    Object.values(upper).forEach(sortSeries);
    Object.values(lower).forEach(sortSeries);

    // Round columns
    const allRounds = new Set([...Object.keys(upper).map(Number), ...Object.keys(lower).map(Number)]);
    const maxRound = allRounds.size ? Math.max(...allRounds) : 1;
    const rounds = [];
    for (let r = 1; r <= maxRound; r++) rounds.push(r);

    // Series‐slot renderer (shows best-of-N result in one compact card)
    const seriesSlot = (matches) => {
        if (!matches || !matches.length) return '';
        const firstM = matches[0];
        const redNums  = firstM.red?.teams  ? firstM.red.teams.map(t => t.team_number)  : (firstM.red?.team_numbers || []);
        const blueNums = firstM.blue?.teams ? firstM.blue.teams.map(t => t.team_number) : (firstM.blue?.team_numbers || []);
        const redSeed  = firstM.red?.alliance_number  ? `<span class="bkt-seed">#${firstM.red.alliance_number}</span>` : '';
        const blueSeed = firstM.blue?.alliance_number ? `<span class="bkt-seed">#${firstM.blue.alliance_number}</span>` : '';

        let redWins = 0, blueWins = 0;
        matches.forEach(m => {
            if (m.winning_alliance === 'red') redWins++;
            else if (m.winning_alliance === 'blue') blueWins++;
        });

        const anyScored  = matches.some(m => (m.red?.score ?? -1) >= 0 && (m.blue?.score ?? -1) >= 0);
        const seriesDone = redWins >= 2 || blueWins >= 2 || (matches.length === 1 && (redWins + blueWins > 0));
        const redWon  = seriesDone && redWins > blueWins;
        const blueWon = seriesDone && blueWins > redWins;

        const shortLabel = /final/i.test(firstM.label || '') ? 'Finals' : ('Match ' + (firstM.set_number || '?'));
        const seriesScore = matches.length > 1 && anyScored
            ? ` <span class="bkt-replay">${redWins}-${blueWins}</span>` : '';

        // For single-match series, show actual score; for best-of-N, show series wins
        const redDisplay  = anyScored ? (matches.length > 1 ? redWins  : matches[0].red.score)  : '–';
        const blueDisplay = anyScored ? (matches.length > 1 ? blueWins : matches[0].blue.score) : '–';

        return `<div class="bkt-slot ${!anyScored ? 'bkt-upcoming' : ''} ${seriesDone ? 'bkt-decided' : ''}">
            <div class="bkt-slot-header">${shortLabel}${seriesScore}</div>
            <div class="bkt-row bkt-red ${redWon ? 'bkt-won' : ''}${blueWon ? ' bkt-lost' : ''}">
                ${redSeed}
                <span class="bkt-teams">${_teamsHtml(redNums)}</span>
                <span class="bkt-score">${redDisplay}</span>
            </div>
            <div class="bkt-row bkt-blue ${blueWon ? 'bkt-won' : ''}${redWon ? ' bkt-lost' : ''}">
                ${blueSeed}
                <span class="bkt-teams">${_teamsHtml(blueNums)}</span>
                <span class="bkt-score">${blueDisplay}</span>
            </div>
        </div>`;
    };

    // ── Build CSS-grid ──────────────────────────────────────
    const finalsCol = rounds.length + 2;   // 1-indexed: label=1, rounds 2..N+1, finals=N+2
    const colTpl = '20px ' + rounds.map(() => '280px').join(' ') + ' 280px';

    let html = `<div class="bracket-grid" style="grid-template-columns: ${colTpl};">`;

    // Header row
    html += '<div class="bg-corner"></div>';
    rounds.forEach(r => { html += `<div class="bg-rnd-hdr">Round ${r}</div>`; });
    html += `<div class="bg-rnd-hdr bg-rnd-hdr-final">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        Finals</div>`;

    // Upper row
    html += `<div class="bg-side-label bg-upper-label">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>
        Upper</div>`;
    rounds.forEach(r => {
        const list = upper[r] || [];
        html += `<div class="bg-cell bg-cell-upper ${!list.length ? 'bg-cell-empty' : ''}">`;
        list.forEach(s => { html += seriesSlot(s); });
        html += '</div>';
    });
    // Finals cell — spans upper + lower rows
    html += `<div class="bg-cell bg-cell-final" style="grid-column:${finalsCol}; grid-row:2/4;">`;
    if (finals.length) {
        finals.forEach(s => { html += seriesSlot(s); });
    } else {
        html += '<div class="bkt-slot bkt-tbd"><div class="bkt-slot-header">Finals</div><div class="bkt-slot-body"><span class="bkt-tbd-text">TBD</span></div></div>';
    }
    html += '</div>';

    // Lower row
    html += `<div class="bg-side-label bg-lower-label">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        Lower</div>`;
    rounds.forEach(r => {
        const list = lower[r] || [];
        html += `<div class="bg-cell bg-cell-lower ${!list.length ? 'bg-cell-empty' : ''}">`;
        list.forEach(s => { html += seriesSlot(s); });
        html += '</div>';
    });

    html += '</div>'; // close bracket-grid

    $('playoff-bracket').innerHTML = html;

    // Show scroll arrow for wide grids
    let arrowWrapper = document.getElementById('bracket-scroll-wrapper');
    if (rounds.length >= 3) {
        if (!arrowWrapper) {
            arrowWrapper = document.createElement('div');
            arrowWrapper.id = 'bracket-scroll-wrapper';
            arrowWrapper.className = 'bracket-scroll-arrow-wrapper';
            arrowWrapper.innerHTML = `<button class="bracket-scroll-arrow" id="bracket-scroll-finals" onclick="scrollBracketToFinals()" title="Scroll to Finals">
                    Finals
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                </button>`;
            $('tab-playoff').appendChild(arrowWrapper);
        }
        arrowWrapper.classList.remove('hidden');
        _setupBracketScrollArrow();
    } else if (arrowWrapper) {
        arrowWrapper.classList.add('hidden');
    }
}

/* ── FTC simple-elim bracket (series cards — SF / Finals) ── */
function _renderFtcBracketSeries() {
    const _nickMap = {};
    if (teamsData) teamsData.forEach(t => { if (t.nickname) _nickMap[t.team_number] = t.nickname; });
    const _teamSpan = (num) => {
        const nick = _nickMap[num];
        return nick
            ? `<span class="has-tooltip bkt-team-num">${num}<span class="custom-tooltip">${nick}</span></span>`
            : `<span class="bkt-team-num">${num}</span>`;
    };
    const _teamsHtml = (nums) => nums.map(_teamSpan).join(' · ');

    // Group matches by series (set_number) — each series is a best-of-N
    const bySeries = {};
    playoffData.forEach(m => {
        const series = m.set_number || 1;
        if (!bySeries[series]) bySeries[series] = [];
        bySeries[series].push(m);
    });

    // Sort each series by match_number
    Object.values(bySeries).forEach(arr => arr.sort((a, b) => a.match_number - b.match_number));
    const seriesKeys = Object.keys(bySeries).map(Number).sort((a, b) => a - b);

    const renderMatch = (m) => {
        const redWon  = m.winning_alliance === 'red';
        const blueWon = m.winning_alliance === 'blue';
        const upcoming = m.red.score < 0 && m.blue.score < 0;
        const redLost = blueWon;
        const blueLost = redWon;
        const redNums = m.red.teams ? m.red.teams.map(t => t.team_number) : (m.red.team_numbers || []);
        const blueNums = m.blue.teams ? m.blue.teams.map(t => t.team_number) : (m.blue.team_numbers || []);
        const redSeed  = m.red.alliance_number  ? `<span class="bkt-seed">#${m.red.alliance_number}</span>` : '';
        const blueSeed = m.blue.alliance_number ? `<span class="bkt-seed">#${m.blue.alliance_number}</span>` : '';

        const shortLabel = /final/i.test(m.label || '') ? 'Finals' : ('Match ' + (m.set_number || '?'));

        return `<div class="bkt-slot ${upcoming ? 'bkt-upcoming' : ''} ${redWon || blueWon ? 'bkt-decided' : ''}">
            <div class="bkt-slot-header">${shortLabel}</div>
            <div class="bkt-row bkt-red ${redWon ? 'bkt-won' : ''}${redLost ? ' bkt-lost' : ''}">
                ${redSeed}
                <span class="bkt-teams">${_teamsHtml(redNums)}</span>
                <span class="bkt-score">${upcoming ? '–' : m.red.score}</span>
            </div>
            <div class="bkt-row bkt-blue ${blueWon ? 'bkt-won' : ''}${blueLost ? ' bkt-lost' : ''}">
                ${blueSeed}
                <span class="bkt-teams">${_teamsHtml(blueNums)}</span>
                <span class="bkt-score">${upcoming ? '–' : m.blue.score}</span>
            </div>
        </div>`;
    };

    // Build each series card showing all matches in the series + series score
    let html = '<div class="ftc-bracket">';

    for (const sKey of seriesKeys) {
        const matches = bySeries[sKey];
        let redWins = 0, blueWins = 0;
        matches.forEach(m => {
            if (m.winning_alliance === 'red') redWins++;
            else if (m.winning_alliance === 'blue') blueWins++;
        });

        const firstMatch = matches[0];
        const allianceNumRed = firstMatch.red?.alliance_number;
        const allianceNumBlue = firstMatch.blue?.alliance_number;
        let seriesLabel = `Series ${sKey}`;
        if (allianceNumRed && allianceNumBlue) {
            seriesLabel = `#${allianceNumRed} vs #${allianceNumBlue}`;
        }

        const seriesWinner = redWins >= 2 ? 'red' : (blueWins >= 2 ? 'blue' : null);
        const resultBadge = seriesWinner
            ? `<span class="ftc-series-result ftc-series-${seriesWinner}">${seriesWinner === 'red' ? 'Red' : 'Blue'} Wins Series ${redWins}-${blueWins}</span>`
            : (redWins + blueWins > 0 ? `<span class="ftc-series-score">Series: ${redWins}-${blueWins}</span>` : '');

        html += `<div class="ftc-series-card${seriesWinner ? ' ftc-series-decided' : ''}">
            <div class="ftc-series-header">
                <span class="ftc-series-label">${seriesLabel}</span>
                ${resultBadge}
            </div>
            <div class="ftc-series-matches">
                ${matches.map(renderMatch).join('')}
            </div>
        </div>`;
    }

    html += '</div>';
    $('playoff-bracket').innerHTML = html;

    // Hide the FRC bracket scroll arrow for FTC series view
    const arrowWrapper = document.getElementById('bracket-scroll-wrapper');
    if (arrowWrapper) arrowWrapper.classList.add('hidden');
}

/* ── Bracket scroll-to-finals arrow ──────────────────────── */
function scrollBracketToFinals() {
    const container = $('playoff-bracket');
    if (!container) return;
    container.scrollTo({ left: container.scrollWidth, behavior: 'smooth' });
}

function _setupBracketScrollArrow() {
    const container = $('playoff-bracket');
    const arrow = $('bracket-scroll-finals');
    if (!container || !arrow) return;
    const wrapper = arrow.parentElement;

    const updateArrow = () => {
        const atEnd = container.scrollLeft + container.clientWidth >= container.scrollWidth - 20;
        const needsScroll = container.scrollWidth > container.clientWidth + 20;
        const shouldHide = atEnd || !needsScroll;
        arrow.classList.toggle('hidden', shouldHide);
        if (wrapper) wrapper.classList.toggle('hidden', shouldHide);
    };
    updateArrow();
    container.addEventListener('scroll', updateArrow, { passive: true });
    // Also update on resize
    new ResizeObserver(updateArrow).observe(container);

    // ── Parent-match highlighting on hover ─────────────────
    _setupBracketHover();
}

/* FRC double-elim bracket parent map: match → its feeder matches */
const _BKT_PARENTS = {
    7: [1, 2],   8: [3, 4],          // Upper R2 from Upper R1
    5: [1, 2],   6: [3, 4],          // Lower R2 from losers of Upper R1
    9: [5, 8],   10: [6, 7],         // Lower R3: W5 vs L8, W6 vs L7
    11: [7, 8],                       // Upper R4
    12: [9, 10],                      // Lower R4
    13: [11, 12],                     // Lower R5
    'f1': [11, 13],                   // Final from upper winner + lower winner
};

function _setupBracketHover() {
    const container = $('playoff-bracket');
    if (!container) return;

    // Build a map from set_number/label → DOM element
    const slotEls = container.querySelectorAll('.bkt-slot');
    const slotMap = {};
    slotEls.forEach(el => {
        const header = el.querySelector('.bkt-slot-header');
        if (!header) return;
        const text = header.textContent.trim();
        // Parse "M1", "M7", "Final 1" etc.
        const mMatch = text.match(/^M(\d+)/);
        const fMatch = text.match(/^Final\s*(\d+)/i);
        if (mMatch) slotMap[parseInt(mMatch[1])] = el;
        else if (fMatch) slotMap['f' + fMatch[1]] = el;
    });

    slotEls.forEach(el => {
        el.addEventListener('mouseenter', () => {
            const header = el.querySelector('.bkt-slot-header');
            if (!header) return;
            const text = header.textContent.trim();
            const mMatch = text.match(/^M(\d+)/);
            const fMatch = text.match(/^Final\s*(\d+)/i);
            const key = mMatch ? parseInt(mMatch[1]) : (fMatch ? 'f' + fMatch[1] : null);
            if (key == null) return;

            // Collect direct parent matches only (not grandparents)
            const parents = new Set();
            const direct = _BKT_PARENTS[key];
            if (direct) direct.forEach(p => parents.add(p));

            if (parents.size === 0) return;

            // Dim all slots, highlight parents
            slotEls.forEach(s => {
                const h = s.querySelector('.bkt-slot-header');
                if (!h) return;
                const t = h.textContent.trim();
                const mm = t.match(/^M(\d+)/);
                const fm = t.match(/^Final\s*(\d+)/i);
                const sk = mm ? parseInt(mm[1]) : (fm ? 'f' + fm[1] : null);
                if (sk === key) return; // don't modify the hovered slot
                if (parents.has(sk)) {
                    s.classList.add('bkt-highlight-parent');
                    s.classList.remove('bkt-dim');
                } else {
                    s.classList.add('bkt-dim');
                    s.classList.remove('bkt-highlight-parent');
                }
            });
        });

        el.addEventListener('mouseleave', () => {
            slotEls.forEach(s => {
                s.classList.remove('bkt-highlight-parent', 'bkt-dim');
            });
        });
    });
}

/* ── Mobile bracket: vertical stacked rounds ────────────── */
function _buildMobileBracket(slot, finalNums) {
    const rounds = [
        {
            label: 'Round 1',
            tag: 'upper', tagLabel: 'Upper',
            matches: [[1,'M1'],[2,'M2'],[3,'M3'],[4,'M4']],
        },
        {
            label: 'Round 2',
            tag: 'mixed',
            sections: [
                { tag: 'upper', tagLabel: 'Upper', matches: [[7,'M7'],[8,'M8']] },
                { tag: 'lower', tagLabel: 'Lower', matches: [[5,'M5'],[6,'M6']] },
            ],
        },
        {
            label: 'Round 3',
            tag: 'lower', tagLabel: 'Lower',
            matches: [[9,'M9'],[10,'M10']],
        },
        {
            label: 'Round 4',
            tag: 'mixed',
            sections: [
                { tag: 'upper', tagLabel: 'Upper', matches: [[11,'M11']] },
                { tag: 'lower', tagLabel: 'Lower', matches: [[12,'M12']] },
            ],
        },
        {
            label: 'Round 5',
            tag: 'lower', tagLabel: 'Lower',
            matches: [[13,'M13']],
        },
        {
            label: 'Finals',
            tag: 'final',
            matches: finalNums.map(n => ['f' + n, 'Final ' + n]),
            isFinal: true,
        },
    ];

    const chevron = '<svg class="bkt-m-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>';

    return `<div class="bracket-mobile">${rounds.map(r => {
        const hdrCls = r.isFinal ? ' bkt-m-round-hdr-final' : '';
        let bodyHtml = '';
        if (r.sections) {
            bodyHtml = r.sections.map(s => {
                const tag = `<span class="bkt-m-bracket-tag bkt-m-tag-${s.tag}">${s.tagLabel}</span>`;
                return tag + s.matches.map(([set, lbl]) => slot(set, lbl)).join('');
            }).join('');
        } else {
            const tag = r.tagLabel ? `<span class="bkt-m-bracket-tag bkt-m-tag-${r.tag}">${r.tagLabel}</span>` : '';
            bodyHtml = tag + r.matches.map(([set, lbl]) => slot(set, lbl)).join('');
        }
        return `<div class="bkt-m-round">
            <div class="bkt-m-round-hdr${hdrCls}" onclick="this.parentElement.classList.toggle('collapsed')">
                <span>${r.label}</span>
                ${chevron}
            </div>
            <div class="bkt-m-round-body">${bodyHtml}</div>
        </div>`;
    }).join('')}</div>`;
}


// ═══════════════════════════════════════════════════════════
// 3. ALLIANCE SELECTION
// ═══════════════════════════════════════════════════════════

/** Wrap a flat FTC alliance array into the object shape renderAlliances expects. */
function _wrapFtcAlliances(data) {
    const wrapped = {
        alliances: data.map(a => ({
            number: a.number,
            name: a.name,
            teams: (a.pick_numbers || []).map(num => ({
                team_key: `ftc${num}`,
                team_number: num,
                nickname: '',
                avatar: null,
                opr: 0,
                epa: null,
                rank: '-',
                wins: 0, losses: 0, ties: 0,
                country: '',
                rookie_year: null,
            })),
            combined_opr: 0,
            combined_epa: null,
            playoff_result: null,
            playoff_type: null,
            playoff_record: null,
        })),
        partnerships: [],
        max_combined_opr: 0,
    };
    if (teamsData) {
        const nameMap = new Map(teamsData.map(t => [t.team_number, t]));
        wrapped.alliances.forEach(a => {
            a.teams.forEach(t => {
                const td = nameMap.get(t.team_number);
                if (td) {
                    t.nickname = td.nickname || '';
                    t.opr = td.opr || 0;
                    t.avatar = td.avatar || null;
                    t.rank = td.rank || '-';
                    t.wins = td.wins || 0;
                    t.losses = td.losses || 0;
                    t.ties = td.ties || 0;
                    t.country = td.country || '';
                    t.rookie_year = td.rookie_year || null;
                }
            });
            a.combined_opr = a.teams.reduce((s, t) => s + (parseFloat(t.opr) || 0), 0);
        });
        wrapped.max_combined_opr = Math.max(...wrapped.alliances.map(a => a.combined_opr), 0);
    }
    // Patch any remaining missing avatars from the FTC avatar map
    if (_ftcAvatarMap && _ftcAvatarMap.size > 0) {
        wrapped.alliances.forEach(a => a.teams.forEach(t => {
            if (!t.avatar) { const url = _ftcAvatarMap.get(t.team_number); if (url) t.avatar = url; }
        }));
    }
    return wrapped;
}

async function loadAlliances() {
    if (!currentEvent) return;
    hide('alliance-empty');
    hideInlineError('alliance-error');
    showSkeleton('alliance-loading', 'alliance-loading-status', 'Fetching alliance selections\u2026');
    try {
        setLoadingStatus('alliance-loading-status', isFTCMode() ? 'Loading alliance selections\u2026' : 'Loading partnerships & EPA data\u2026');
        const data = await getActiveAPI().alliances(currentEvent);

        // FTC returns a flat array; normalise to the object shape FRC uses
        if (isFTCMode()) {
            if (!data || !Array.isArray(data) || data.length === 0) {
                hideSkeleton('alliance-loading');
                showInlineError('alliance-error', 'Alliance selections are not available for this event yet.', loadAlliances);
                return;
            }
            allianceData = _wrapFtcAlliances(data);
        } else {
            allianceData = data;
        }

        hideSkeleton('alliance-loading');
        renderAlliances(allianceData);
        fadeIn('alliance-grid');
        autoCacheTab('alliances', allianceData);
        updateTabDots();
    } catch (err) {
        hideSkeleton('alliance-loading');
        const msg = err && err.message ? err.message : 'An unknown error occurred.';
        showInlineError('alliance-error', `Failed to load alliances: ${msg}`, loadAlliances);
    }
}

function toggleAllianceAvatars(on) {
    allianceShowAvatars = on;
    if (allianceData) renderAlliances(allianceData);
}
function toggleAllianceEpa(on) {
    allianceShowEpa = on;
    if (allianceData) renderAlliances(allianceData);
}
function toggleAlliancePlayoff(on) {
    allianceShowPlayoff = on;
    if (allianceData) renderAlliances(allianceData);
}
function toggleAllianceAttrs(on) {
    allianceShowAttrs = on;
    if (allianceData) renderAlliances(allianceData);
}

function renderAlliances(data) {
    const { alliances, partnerships, max_combined_opr } = data;
    if (!alliances.length) {
        $('alliance-grid').innerHTML = '<p class="empty">Alliance selection has not occurred yet.</p>';
        return;
    }

    // Show toolbar once data is loaded
    const tb = $('alliance-toolbar');
    if (tb) tb.classList.remove('hidden');

    const roleLabels = ['Captain', '1st Pick', '2nd Pick', '3rd Pick', 'Backup'];
    // At non-championship events alliances have 4 teams; idx 3 is the backup
    const getRoleLabel = (idx, teamCount) => {
        if (idx === 3 && teamCount <= 4) return 'Backup';
        return roleLabels[idx] || '';
    };

    // Compute event-average OPR and EPA for highlighting
    const allOPRs = alliances.flatMap(a => a.teams.map(t => parseFloat(t.opr))).filter(v => !isNaN(v));
    allOPRs.sort((a, b) => a - b);
    const avgEventOPR = allOPRs.length > 0 ? allOPRs.reduce((s, v) => s + v, 0) / allOPRs.length : 0;
    const p75EventOPR = allOPRs.length > 0 ? allOPRs[Math.floor(allOPRs.length * 0.75)] : 0;
    const allEPAs = alliances.flatMap(a => a.teams.map(t => parseFloat(t.epa))).filter(v => !isNaN(v));
    allEPAs.sort((a, b) => a - b);
    const avgEventEPA = allEPAs.length > 0 ? allEPAs.reduce((s, v) => s + v, 0) / allEPAs.length : 0;
    const p75EventEPA = allEPAs.length > 0 ? allEPAs[Math.floor(allEPAs.length * 0.75)] : 0;

    $('alliance-grid').innerHTML = alliances.map(a => {
        const strengthPct = max_combined_opr ? Math.round((a.combined_opr / max_combined_opr) * 100) : 0;

        // Playoff ribbon (conditional)
        let ribbonHtml = '';
        let cardCls = '';
        if (allianceShowPlayoff && a.playoff_result) {
            const ribbonCls = a.playoff_type ? `ribbon-${a.playoff_type}` : '';
            ribbonHtml = `<span class="playoff-ribbon ${ribbonCls}">${a.playoff_type === 'winner' ? '🏆 ' : ''}${a.playoff_result}${a.playoff_record ? ` (${a.playoff_record})` : ''}</span>`;
            cardCls = a.playoff_type ? 'alliance-' + a.playoff_type : '';
        }

        // Combined stats
        const epaHtml = allianceShowEpa
            ? `<span class="combined-epa">Σ EPA ${a.combined_epa != null ? a.combined_epa : '\u2013'}</span>`
            : '';
        const epaDetailHtml = allianceShowEpa
            ? `<div class="alliance-epa-detail-row">`
              + `<span class="combined-epa-detail">Auto ${a.combined_epa_auto != null ? a.combined_epa_auto : '\u2013'}</span>`
              + `<span class="combined-epa-detail">Teleop ${a.combined_epa_teleop != null ? a.combined_epa_teleop : '\u2013'}</span>`
              + `<span class="combined-epa-detail">Endgame ${a.combined_epa_endgame != null ? a.combined_epa_endgame : '\u2013'}</span>`
              + `</div>`
            : '';

        // Collect all partnerships for this alliance into a summary section
        const partnerSummary = [];
        const seen = new Set();
        a.teams.forEach((t) => {
            a.teams.forEach((other) => {
                if (t.team_key === other.team_key) return;
                const pairKey = [t.team_key, other.team_key].sort().join('+');
                if (seen.has(pairKey)) return;
                seen.add(pairKey);
                const p = partnerships[pairKey]
                         || partnerships[`${t.team_key}+${other.team_key}`]
                         || partnerships[`${other.team_key}+${t.team_key}`];
                if (p && p.history && p.history.length > 0) {
                    const tooltipRows = p.history.map(h =>
                        `<div class="tip-row">${h.year} &mdash; ${h.event_name.replace(/</g, '&lt;')}</div>`
                    ).join('');
                    partnerSummary.push(`<span class="badge returning has-tooltip">⟳ ${t.team_number} + ${other.team_number} (${p.history.length}×)<span class="custom-tooltip">${tooltipRows}</span></span>`);
                }
            });
        });

        return `
        <div class="alliance-card ${cardCls}">
            <div class="alliance-header">
                <div class="alliance-header-left">
                    <h3>${a.name || 'Alliance ' + a.number}</h3>
                    ${ribbonHtml}
                </div>
                <div class="alliance-header-stats">
                    <div class="alliance-header-stats-row-1">
                        <span class="combined-opr">Σ OPR ${typeof a.combined_opr === 'number' ? a.combined_opr.toFixed(2) : a.combined_opr}</span>
                        ${epaHtml}
                    </div>
                    ${epaDetailHtml}
                </div>
            </div>
            <div class="alliance-strength-bar"><div class="alliance-strength-fill" style="width:${strengthPct}%"></div></div>
            <div class="alliance-teams-list">
                ${a.teams.map((t, idx) => {
                    const avatarHtml = allianceShowAvatars
                        ? (t.avatar
                            ? `<img class="alliance-team-avatar" src="${t.avatar}" alt="">`
                            : `<div class="alliance-team-avatar-placeholder">${isFTCMode() ? 'FTC' : 'FRC'}</div>`)
                        : '';

                    const isIntl = highlightForeign && t.country && eventCountry && t.country !== eventCountry;
                    const isRookie = highlightRookie && t.rookie_year && currentEventYear && t.rookie_year >= currentEventYear;

                    const oprVal = parseFloat(t.opr);
                    const oprCls = !isNaN(oprVal) && oprVal >= p75EventOPR ? ' opr-top25' : (!isNaN(oprVal) && oprVal > avgEventOPR ? ' opr-above-avg' : '');

                    const epaVal = parseFloat(t.epa);
                    const epaCls = !isNaN(epaVal) && epaVal >= p75EventEPA ? ' epa-top25' : (!isNaN(epaVal) && epaVal > avgEventEPA ? ' epa-above-avg' : '');
                    const teamEpaHtml = allianceShowEpa
                        ? `<span class="stat-epa${epaCls}">EPA ${t.epa != null ? t.epa : '\u2013'}</span>`
                        : '';

                    return `
                    <div class="alliance-team-row${isIntl ? ' foreign-team-row' : ''}${isRookie ? ' rookie-team-row' : ''}" data-country="${t.country || ''}" data-rookie-year="${t.rookie_year || ''}">
                        <span class="team-role">${getRoleLabel(idx, a.teams.length)}</span>
                        ${avatarHtml}
                        <span class="team-num has-tooltip">${_renderTeamNum(t)}${(_timsCache[t.team_number]?.nickname || t.nickname) ? `<span class="custom-tooltip">${_timsCache[t.team_number]?.nickname || t.nickname}</span>` : ''}</span>
                        ${allianceShowAttrs ? _renderBdTags(t.team_number) : ''}
                        ${allianceShowNames ? `<span class="team-nick">${_timsCache[t.team_number]?.nickname || t.nickname || ''}</span>` : ''}
                        <div class="team-stats-mini">
                            <span${Number(t.rank) >= 1 && Number(t.rank) <= 8 ? ' class="rank-top8"' : ''}>Rank ${t.rank}</span>
                            <span>${t.wins}-${t.losses}-${t.ties}</span>
                            <span class="stat-opr${oprCls}">OPR ${t.opr}</span>
                            ${teamEpaHtml}
                        </div>
                    </div>`;
                }).join('')}
            </div>
            ${partnerSummary.length ? `<div class="alliance-partners-row">${partnerSummary.join('')}</div>` : ''}
        </div>`;
    }).join('');
}


// ═══════════════════════════════════════════════════════════
// 4. TEAM LOOKUP
// ═══════════════════════════════════════════════════════════
async function loadTeam() {
    const num = parseInt($('team-number').value, 10);
    const year = $('team-year').value.trim() || null;
    if (!num) return;

    loading(true);
    $('team-stats').innerHTML = '';
    hideInlineError('team-error');
    showSkeleton('team-loading', 'team-loading-status', `Loading team ${num} data\u2026`);
    try {
        if (isFTCMode()) {
            setLoadingStatus('team-loading-status', `Fetching FTC data for team ${num}\u2026`);
            const data = await _buildFtcTeamLookup(num, year);
            lastTeamData = data;
            hideSkeleton('team-loading');
            $('team-stats').innerHTML = renderFtcTeamStats(data);
            fadeIn('team-stats');
            // Lazy-load OPR history chart
            FTC_API.teamOprHistory(num, year).then(h => renderFtcOprChart(h)).catch(() => {});
        } else {
            setLoadingStatus('team-loading-status', `Fetching stats for team ${num}\u2026`);
            const data = await API.teamStats(num, year);
            lastTeamData = data;
            hideSkeleton('team-loading');
            $('team-stats').innerHTML = renderTeamStats(data);
            fadeIn('team-stats');
        }
    } catch (err) {
        hideSkeleton('team-loading');
        showInlineError('team-error', `Failed to load team ${num}: ${err.message}`, loadTeam);
    } finally {
        loading(false);
    }
}

function renderTeamStats(d) {
    // Filter offseason events unless the setting is on
    const OFFSEASON_TYPE = 'Offseason';
    const eventsThisYear = showOffseason
        ? d.events_this_year
        : (d.events_this_year || []).filter(e => e.event_type !== OFFSEASON_TYPE);

    const avatarHtml = d.avatar
        ? `<img class="team-avatar" src="${d.avatar}" alt="Team ${d.team_number} avatar">`
        : '';

    // ── Blue banners highlight ──
    const bannerCount = d.blue_banner_count || 0;
    const bannerCard = `
        <div class="highlight-card${bannerCount > 0 ? ' highlight-banner' : ''}">
            <div class="highlight-label">Blue Banners (All Time)</div>
            <div class="highlight-value">${bannerCount > 0
                ? '<svg class="banner-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M5 2h14l-3 7 3 7H5V2z"/></svg> ' + bannerCount
                : '0'}</div>
        </div>`;

    // ── Blue banner detail list ──
    let bannerHtml = '';
    if (d.blue_banners && d.blue_banners.length) {
        const sorted = [...d.blue_banners].sort((a, b) => b.year - a.year);
        const VISIBLE = 6;
        const visible = sorted.slice(0, VISIBLE);
        const hidden = sorted.slice(VISIBLE);
        const chipHtml = (b) => `
            <div class="banner-chip">
                <span class="banner-chip-icon"><svg class="banner-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M5 2h14l-3 7 3 7H5V2z"/></svg></span>
                <span class="banner-chip-text">${b.name}</span>
                <span class="banner-chip-meta">${b.event_name || b.event_key} · ${b.year}</span>
            </div>`;
        bannerHtml = `
        <h3>Blue Banners</h3>
        <div class="banner-list">
            ${visible.map(chipHtml).join('')}${hidden.length ? `
            <button class="banner-more-btn" onclick="this.nextElementSibling.classList.toggle('hidden');this.textContent=this.textContent.startsWith('+')?'− collapse':'+${hidden.length} more'">+${hidden.length} more</button>
            <span class="banner-extra hidden">${hidden.map(chipHtml).join('')}</span>` : ''}
        </div>`;
    }

    // ── Awards table ──
    const allAwards = d.awards || [];
    let awardsHtml = '';
    if (allAwards.length) {
        awardsHtml = `
        <h3>Awards</h3>
        <table class="data-table compact">
            <thead>
                <tr><th>Year</th><th>Award</th><th>Event</th></tr>
            </thead>
            <tbody>
                ${[...allAwards].sort((a, b) => b.year - a.year).map(a => `
                <tr>
                    <td class="stat">${a.year}</td>
                    <td>${a.name}</td>
                    <td class="muted">${a.event_name || a.event_key}</td>
                </tr>`).join('')}
            </tbody>
        </table>`;
    }

    // ── HoF, Impact Finalist & Einstein Winner badges ──
    let prestigeBadges = '';
    if (d.is_hof) {
        const hofYears = d.hof_awards.map(a => a.year).join(', ');
        prestigeBadges += `<span class="team-badge hof-badge has-tooltip">🏛️ Hall of Fame<span class="custom-tooltip">Chairman's / FIRST Impact Award Winner at Championship (${hofYears})</span></span>`;
    }
    if (d.is_impact_finalist) {
        const impactYears = d.impact_finalist_awards.map(a => a.year).join(', ');
        prestigeBadges += `<span class="team-badge impact-badge has-tooltip">🏆 Impact Finalist<span class="custom-tooltip">FIRST Impact Award Finalist at Championship (${impactYears})</span></span>`;
    }
    if (d.is_einstein_winner) {
        const einsteinYears = d.einstein_wins.map(a => a.year).join(', ');
        prestigeBadges += `<span class="team-badge einstein-badge has-tooltip">⭐ Einstein Winner<span class="custom-tooltip">FIRST Championship Winner (${einsteinYears})</span></span>`;
    }
    const badgesRow = prestigeBadges
        ? `<div class="team-prestige-badges">${prestigeBadges}</div>`
        : '';

    return `
    <div class="team-card${d.is_hof ? ' team-card-hof' : ''}${d.is_einstein_winner ? ' team-card-einstein' : ''}">
        <div class="team-header">
            <div class="team-header-top">
                ${avatarHtml}
                <div class="team-header-text">
                    <h2>${d.team_number} | ${d.nickname}</h2>
                    ${badgesRow}
                    <p>${[d.city, d.state_prov, d.country].filter(Boolean).join(', ')}</p>
                    <p class="muted">Rookie: ${d.rookie_year || '?'} &nbsp;|&nbsp; ${d.years_active} season${d.years_active !== 1 ? 's' : ''} &nbsp;|&nbsp; Viewing: ${d.year}</p>
                </div>
            </div>
        </div>

        <div class="team-highlights">
            ${d.has_competed ? `
            <div class="highlight-card">
                <div class="highlight-label">Highest Stage of Play (${d.year})</div>
                <div class="highlight-value">${d.highest_stage_of_play}</div>
            </div>
            <div class="highlight-card">
                <div class="highlight-label">Highest Event Level (${d.year})</div>
                <div class="highlight-value">${d.highest_event_level}</div>
            </div>` : `
            <div class="highlight-card highlight-no-events">
                <div class="highlight-label">Season Status (${d.year})</div>
                <div class="highlight-value">Hasn't competed yet</div>
                ${d.last_season ? `<div class="highlight-sub">Last season (${d.last_season.year}): <strong>${d.last_season.achievement}</strong>${d.last_season.event_name ? ` · ${d.last_season.event_name}` : ''}</div>` : ''}
            </div>`}
            ${bannerCard}
        </div>

        ${(() => {
            const pastEvents = eventsThisYear.filter(e => !e.is_upcoming).sort((a, b) => (b.end_date || b.start_date || '').localeCompare(a.end_date || a.start_date || ''));
            const upcomingEvents = eventsThisYear.filter(e => e.is_upcoming);
            let html = '';

            // Past / current events table
            html += '<h3>Event Results \u00b7 ' + d.year + '</h3>';
            if (pastEvents.length) {
                html += '<table class="data-table compact"><thead><tr>' +
                    '<th>Event</th><th>Type</th><th>Qual Rank</th><th>Qual Record</th>' +
                    '<th>Alliance</th><th>Playoff Result</th></tr></thead><tbody>';
                pastEvents.forEach(e => {
                    const allianceCell = e.alliance_pick
                        ? 'A' + (e.alliance_number || '?') + ' ' + e.alliance_pick
                        : '\u2013';
                    let resultCell;
                    if (e.playoff_status === 'won') {
                        resultCell = '<span class="winner-text">Won</span>';
                    } else if (e.playoff_status === 'playing') {
                        resultCell = '<span class="playing-text">Playing (' + e.playoff_level + ')</span>';
                    } else if (e.playoff_level && e.playoff_level !== 'Qualifications' && e.playoff_status && e.playoff_status !== '-') {
                        resultCell = 'Eliminated (' + e.playoff_level + ')';
                    } else {
                        resultCell = '\u2013';
                    }
                    html += '<tr>' +
                        '<td>' + e.event_name + '</td>' +
                        '<td class="muted">' + e.event_type + '</td>' +
                        '<td class="rank">' + e.qual_rank + '</td>' +
                        '<td class="stat">' + e.qual_record + '</td>' +
                        '<td>' + allianceCell + '</td>' +
                        '<td>' + resultCell + '</td>' +
                        '</tr>';
                });
                html += '</tbody></table>';
            } else if (!upcomingEvents.length) {
                html += '<p class="empty">No events yet this year.</p>';
            }

            // Upcoming events section
            if (upcomingEvents.length) {
                html += '<h3>Upcoming Events</h3>';
                html += '<div class="upcoming-events-list">';
                upcomingEvents.forEach(e => {
                    const loc = [e.city, e.state_prov].filter(Boolean).join(', ');
                    const dateStr = e.start_date && e.end_date
                        ? _fmtDate(e.start_date) + ' \u2192 ' + _fmtDate(e.end_date)
                        : e.start_date ? _fmtDate(e.start_date) : '';
                    html += '<div class="upcoming-event-card">' +
                        '<span class="upcoming-event-name">' + e.event_name + '</span>' +
                        '<span class="upcoming-event-meta">' + e.event_type +
                            (loc ? ' \u00b7 ' + loc : '') +
                            (dateStr ? ' \u00b7 ' + dateStr : '') +
                        '</span></div>';
                });
                html += '</div>';
            }

            return html;
        })()}

        ${bannerHtml}

        ${d.season_achievements && d.season_achievements.length ? `
        <h3>Season-by-Season Achievements (since ${d.rookie_year || '?'})</h3>
        <table class="data-table compact">
            <thead>
                <tr>
                    <th>Year</th><th>Biggest Achievement</th><th>Event</th>
                </tr>
            </thead>
            <tbody>
                ${[...d.season_achievements].reverse().map(s => `
                <tr>
                    <td class="stat">${s.year}</td>
                    <td>${s.achievement.includes('Winner')
                        ? '<span class="winner-text">' + s.achievement + '</span>'
                        : s.achievement}</td>
                    <td class="muted">${s.event_name}</td>
                </tr>`).join('')}
            </tbody>
        </table>` : ''}

        ${awardsHtml}
    </div>`;
}


// ═══════════════════════════════════════════════════════════
// 5. HEAD TO HEAD
// ═══════════════════════════════════════════════════════════
let _h2hAllTime = false;

async function loadH2H() {
    const a = parseInt($('h2h-team-a').value, 10);
    const b = parseInt($('h2h-team-b').value, 10);
    if (!a || !b) return;

    loading(true);
    $('h2h-results').innerHTML = '';
    hideInlineError('h2h-error');
    showSkeleton('h2h-loading', 'h2h-loading-status', `Loading ${a} vs ${b} history\u2026`);
    try {
        const data = await getActiveAPI().headToHead(a, b, null, _h2hAllTime);
        hideSkeleton('h2h-loading');
        $('h2h-results').innerHTML = renderH2H(data);
        fadeIn('h2h-results');
    } catch (err) {
        hideSkeleton('h2h-loading');
        showInlineError('h2h-error', `Failed to load head-to-head: ${err.message}`, loadH2H);
    } finally {
        loading(false);
    }
}

function _buildFtcH2H(teamA, teamB) {
    const matches = (pbpData && pbpData.matches) || [];
    const nickA = teamsData?.find(t => t.team_number === teamA)?.nickname || '';
    const nickB = teamsData?.find(t => t.team_number === teamB)?.nickname || '';
    let aWins = 0, bWins = 0, draws = 0, asAllies = 0;
    const opponentMatches = [], allyMatches = [];
    matches.forEach(m => {
        const reds = (m.red_teams || []).map(t => t.team_number || t);
        const blues = (m.blue_teams || []).map(t => t.team_number || t);
        const aOnRed = reds.includes(teamA), aOnBlue = blues.includes(teamA);
        const bOnRed = reds.includes(teamB), bOnBlue = blues.includes(teamB);
        if (!aOnRed && !aOnBlue) return; // teamA not in this match
        if (!bOnRed && !bOnBlue) return; // teamB not in this match
        const sameAlliance = (aOnRed && bOnRed) || (aOnBlue && bOnBlue);
        const label = m.label || m.match_key || '';
        if (sameAlliance) {
            asAllies++;
            allyMatches.push({ match_label: label, red_score: m.red_score || 0, blue_score: m.blue_score || 0 });
        } else {
            const aScore = aOnRed ? (m.red_score || 0) : (m.blue_score || 0);
            const bScore = bOnRed ? (m.red_score || 0) : (m.blue_score || 0);
            if (aScore > bScore) aWins++;
            else if (bScore > aScore) bWins++;
            else draws++;
            opponentMatches.push({
                match_label: label,
                year: currentEventYear,
                event_key: currentEvent,
                team_a_alliance: aOnRed ? 'red' : 'blue',
                team_b_alliance: bOnRed ? 'red' : 'blue',
                red_score: m.red_score || 0,
                blue_score: m.blue_score || 0,
            });
        }
    });
    return {
        team_a: teamA,
        team_b: teamB,
        team_nicknames: { [teamA]: nickA, [teamB]: nickB },
        years_checked: [currentEventYear],
        h2h_summary: {
            team_a_wins: aWins,
            team_b_wins: bWins,
            draws: draws,
            total_opponent_matches: opponentMatches.length,
            total_ally_matches: asAllies,
        },
        opponent_matches: opponentMatches,
        ally_matches: allyMatches,
    };
}

function toggleH2HRange(allTime) {
    _h2hAllTime = allTime;
    const sides = document.querySelectorAll('.h2h-range-side');
    if (sides.length === 2) {
        sides[0].classList.toggle('active', !allTime);
        sides[1].classList.toggle('active', allTime);
    }
    // Auto re-fetch if teams are already filled in
    const a = parseInt($('h2h-team-a')?.value, 10);
    const b = parseInt($('h2h-team-b')?.value, 10);
    if (a && b) loadH2H();
}

function renderH2H(d) {
    const s = d.h2h_summary;
    const nicks = d.team_nicknames || {};
    // Apply TIMS nickname overrides
    for (const [num, ov] of Object.entries(_timsCache)) {
        if (ov.nickname) nicks[String(num)] = ov.nickname;
    }

    // Helper: render a team number with hover tooltip showing nickname
    const tn = (num) => {
        const n = nicks[String(num)];
        if (n) return `<span class="has-tooltip">${num}<span class="custom-tooltip">${n}</span></span>`;
        return String(num);
    };
    // Helper: render a list of team numbers with tooltips
    const tList = (nums) => nums.map(tn).join(', ');

    return `
    <div class="h2h-card">
        <div class="h2h-header">
            <span class="red-text">${tn(d.team_a)}</span>
            <span class="vs-label">vs</span>
            <span class="blue-text">${tn(d.team_b)}</span>
        </div>

        <div class="h2h-summary">
            <p>Checked years: ${d.years_checked.join(', ')}</p>
            <div class="h2h-score">
                <span class="red-text">${s.team_a_wins} W</span>
                <span>–</span>
                <span class="blue-text">${s.team_b_wins} W</span>
            </div>
            <p class="muted">${s.total_opponent_matches} opponent match${s.total_opponent_matches !== 1 ? 'es' : ''} &nbsp;|&nbsp;
               ${s.total_ally_matches} as allies</p>
        </div>

        ${d.opponent_matches.length ? `
        <h4>As Opponents</h4>
        <table class="data-table compact">
            <thead><tr>
                <th>Match</th><th>Event</th><th>Round</th>
                <th>Red</th><th>Score</th><th>Blue</th><th>Score</th><th>Winner</th>
            </tr></thead>
            <tbody>
                ${d.opponent_matches.map(m => `
                <tr>
                    <td class="stat">${m.match_label || m.match_key.split('_').pop()}</td>
                    <td class="muted">${m.event_name || m.event_key} (${m.year})</td>
                    <td>${m.comp_level}</td>
                    <td class="red-text stat">${tList(m.red_teams)}</td>
                    <td class="stat">${m.red_score}</td>
                    <td class="blue-text stat">${tList(m.blue_teams)}</td>
                    <td class="stat">${m.blue_score}</td>
                    <td class="${m.winner === String(d.team_a) ? 'red-text' : 'blue-text'} stat">
                        ${m.winner}</td>
                </tr>`).join('')}
            </tbody>
        </table>` : ''}

        ${d.ally_matches.length ? `
        <h4>As Allies</h4>
        <table class="data-table compact">
            <thead><tr>
                <th>Match</th><th>Event</th><th>Round</th>
                <th>Red</th><th>Score</th><th>Blue</th><th>Score</th><th>Result</th>
            </tr></thead>
            <tbody>
                ${d.ally_matches.map(m => `
                <tr>
                    <td class="stat">${m.match_label || m.match_key.split('_').pop()}</td>
                    <td class="muted">${m.event_name || m.event_key} (${m.year})</td>
                    <td>${m.comp_level}</td>
                    <td class="red-text stat">${tList(m.red_teams)}</td>
                    <td class="stat">${m.red_score}</td>
                    <td class="blue-text stat">${tList(m.blue_teams)}</td>
                    <td class="stat">${m.blue_score}</td>
                    <td class="stat">${m.winner === 'both' ? '✓ Won' : 'Lost'}</td>
                </tr>`).join('')}
            </tbody>
        </table>` : ''}

        ${!d.opponent_matches.length && !d.ally_matches.length
            ? '<p class="empty">No playoff history found between these teams.</p>' : ''}
    </div>`;
}


// ═══════════════════════════════════════════════════════════
// 5b. FTC TEAM LOOKUP (uses FTC Events API + FTC Scout)
// ═══════════════════════════════════════════════════════════

async function _buildFtcTeamLookup(teamNumber, year) {
    const season = year || 2025;
    const data = await FTC_API.teamLookup(teamNumber, season);
    // Patch avatar from the FTC scoring server CSS map
    if (!data.avatar && _ftcAvatarMap) {
        const url = _ftcAvatarMap.get(teamNumber);
        if (url) data.avatar = url;
    }
    // Also try to find the team in current event data
    if (teamsData) {
        const local = teamsData.find(t => t.team_number === teamNumber);
        if (local) {
            data._event_data = local;
        }
    }
    return data;
}

function renderFtcTeamStats(d) {
    const loc = d.location || [d.city, d.state_prov, d.country].filter(Boolean).join(', ');
    const qs = d.quick_stats || {};
    const tot = qs.tot || {};
    const auto = qs.auto || {};
    const dc = qs.dc || {};
    const totalTeams = qs.count || '?';
    const ev = d._event_data;

    const avatarHtml = d.avatar
        ? `<img class="team-avatar" src="${d.avatar}" alt="Team ${d.team_number} avatar">`
        : '';

    // Current-event highlight cards
    let eventHighlights = '';
    if (ev) {
        const avgTotal = ev.avg_total != null ? Math.round(ev.avg_total * 10) / 10 : '\u2013';
        const avgAuto = ev.avg_auto != null ? Math.round(ev.avg_auto * 10) / 10 : '\u2013';
        const avgDc = ev.avg_dc != null ? Math.round(ev.avg_dc * 10) / 10 : '\u2013';
        eventHighlights = `
        <h3>Current Event Stats</h3>
        <div class="team-highlights">
            <div class="highlight-card">
                <div class="highlight-label">Rank</div>
                <div class="highlight-value${Number(ev.rank) <= 8 ? ' rank-top8' : ''}">${ev.rank || '\u2013'}</div>
            </div>
            <div class="highlight-card">
                <div class="highlight-label">Record</div>
                <div class="highlight-value">${ev.wins}-${ev.losses}-${ev.ties}</div>
            </div>
            <div class="highlight-card">
                <div class="highlight-label">OPR</div>
                <div class="highlight-value">${ev.opr != null ? (typeof ev.opr === 'number' ? ev.opr.toFixed(1) : ev.opr) : '\u2013'}</div>
            </div>
            <div class="highlight-card">
                <div class="highlight-label">Avg Total</div>
                <div class="highlight-value">${avgTotal}</div>
            </div>
            <div class="highlight-card">
                <div class="highlight-label">Avg Auto</div>
                <div class="highlight-value">${avgAuto}</div>
            </div>
            <div class="highlight-card">
                <div class="highlight-label">Avg DC</div>
                <div class="highlight-value">${avgDc}</div>
            </div>
        </div>`;
    }

    // Global OPR/QuickStats section (with percentile)
    const _pct = (rank, total) => rank != null && total ? Math.round((1 - rank / total) * 100) : null;
    let globalSection = '';
    if (tot.value != null || auto.value != null || dc.value != null) {
        const totPct = _pct(tot.rank, totalTeams);
        const autoPct = _pct(auto.rank, totalTeams);
        const dcPct = _pct(dc.rank, totalTeams);
        globalSection = `
        <h3>Global Rankings <span class="muted">(out of ${totalTeams} teams)</span></h3>
        <div class="team-highlights">
            <div class="highlight-card">
                <div class="highlight-label">Total OPR</div>
                <div class="highlight-value">${tot.value != null ? tot.value.toFixed(1) : '\u2013'}</div>
                ${tot.rank != null ? `<div class="highlight-sub">#${tot.rank}${totPct != null ? ` (top ${100 - totPct > 0 ? 100 - totPct : 1}%)` : ''}</div>` : ''}
            </div>
            <div class="highlight-card">
                <div class="highlight-label">Auto OPR</div>
                <div class="highlight-value">${auto.value != null ? auto.value.toFixed(1) : '\u2013'}</div>
                ${auto.rank != null ? `<div class="highlight-sub">#${auto.rank}${autoPct != null ? ` (top ${100 - autoPct > 0 ? 100 - autoPct : 1}%)` : ''}</div>` : ''}
            </div>
            <div class="highlight-card">
                <div class="highlight-label">DC OPR</div>
                <div class="highlight-value">${dc.value != null ? dc.value.toFixed(1) : '\u2013'}</div>
                ${dc.rank != null ? `<div class="highlight-sub">#${dc.rank}${dcPct != null ? ` (top ${100 - dcPct > 0 ? 100 - dcPct : 1}%)` : ''}</div>` : ''}
            </div>
        </div>`;
    }

    // Event Results table (current season only: Event, Type, Playoff Result, Awards)
    let eventResultsSection = '';
    const eventResults = d.event_results || [];
    if (eventResults.length) {
        let rows = '';
        const sorted = [...eventResults].sort((a, b) => (b.date_end || b.year || '').localeCompare(a.date_end || a.year || ''));
        const _shortenAward = (name) => name
            .replace(/\bAward\b\s*/gi, '')
            .replace(/(\d+)\s*(st|nd|rd|th)\s*Place/gi, '$1$2')
            .trim();
        for (const e of sorted) {
            // Merge alliance info into playoff: "Winner - Captain" or just "Winner"
            let playoffText = '';
            if (e.playoff_result && e.alliance) {
                playoffText = `${e.playoff_result} (${e.alliance})`;
            } else if (e.playoff_result) {
                playoffText = e.playoff_result;
            }
            const playoffCls = e.playoff_result === 'Winner' ? ' class="winner-text"' : '';
            const awardChips = (e.awards || []).map(a =>
                `<span class="ftc-event-award-chip">${_shortenAward(a)}</span>`
            ).join(' ');
            rows += `<tr>
                <td>${e.event_name || e.event_code || ''}</td>
                <td class="muted">${e.event_type || ''}</td>
                <td${playoffCls}>${playoffText || '\u2013'}</td>
                <td>${awardChips}</td>
            </tr>`;
        }
        eventResultsSection = `
        <h3>Event Results</h3>
        <table class="data-table compact">
            <thead><tr><th>Event</th><th>Type</th><th>Playoff</th><th>Awards</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
    } else if (eventsThisSeason.length) {
        // Fallback: simple events list if no results data
        eventResultsSection = `
        <h3>Events \u00b7 ${d.season || 2025} Season</h3>
        <table class="data-table compact">
            <thead><tr><th>Event</th><th>Type</th><th>Location</th></tr></thead>
            <tbody>${eventsThisSeason.map(e => {
                const evLoc = [e.city, e.state_prov].filter(Boolean).join(', ');
                return `<tr><td>${e.event_name}</td><td class="muted">${e.event_type}</td><td class="muted">${evLoc}</td></tr>`;
            }).join('')}</tbody>
        </table>`;
    }

    // Season-by-season achievements (above Awards)
    let achievementsSection = '';
    const achievements = d.season_achievements || [];
    if (achievements.length) {
        const rookieYear = d.rookie_year || '?';
        const displaySeason = (yr) => `${yr}\u2011${String(yr + 1).slice(2)}`;
        achievementsSection = `
        <h3>Season-by-Season Achievements (since ${rookieYear})</h3>
        <table class="data-table compact">
            <thead><tr><th>Season</th><th>Biggest Achievement</th><th>Event</th></tr></thead>
            <tbody>${[...achievements].reverse().map(s => `
                <tr>
                    <td class="stat">${displaySeason(s.year)}</td>
                    <td>${s.achievement.includes('Winner')
                        ? '<span class="winner-text">' + s.achievement + '</span>'
                        : s.achievement}</td>
                    <td class="muted">${s.event_name || ''}</td>
                </tr>`).join('')}</tbody>
        </table>`;
    }

    // Awards section — only real awards (alliance selections excluded)
    let awardsSection = '';
    const allAwards = d.all_awards || [];
    const currentAwards = d.awards || [];
    if (allAwards.length) {
        const displaySeason = (yr) => `${yr}\u2011${String(yr + 1).slice(2)}`;
        awardsSection = `
        <h3>Awards (All Seasons)</h3>
        <table class="data-table compact">
            <thead><tr><th>Season</th><th>Award</th><th>Event</th></tr></thead>
            <tbody>${[...allAwards].sort((a, b) => b.year - a.year).map(a => `<tr><td class="stat">${displaySeason(a.year)}</td><td>${a.name}</td><td class="muted">${a.event || ''}</td></tr>`).join('')}</tbody>
        </table>`;
    } else if (currentAwards.length) {
        awardsSection = `
        <h3>Awards (${d.season || 2025} Season)</h3>
        <table class="data-table compact">
            <thead><tr><th>Award</th><th>Event</th></tr></thead>
            <tbody>${currentAwards.map(a => `<tr><td>${a.name}</td><td class="muted">${a.event || ''}</td></tr>`).join('')}</tbody>
        </table>`;
    }

    return `
    <div class="team-card">
        <div class="team-header">
            <div class="team-header-top">
                ${avatarHtml}
                <div class="team-header-text">
                    <h2>${d.team_number} | ${d.nickname || ''}</h2>
                    ${d.school_name ? `<p>${d.school_name}</p>` : ''}
                    ${loc ? `<p>${loc}</p>` : ''}
                    ${d.rookie_year ? `<p class="muted">Rookie Year: ${d.rookie_year}</p>` : ''}
                </div>
            </div>
        </div>
        ${eventHighlights}
        ${globalSection}
        <div class="ftc-opr-chart-section hidden" id="ftc-opr-chart-container">
            <h3>OPR Across Seasons</h3>
            <div id="ftc-opr-chart" style="width:100%;height:180px;position:relative"></div>
        </div>
        ${eventResultsSection}
        ${achievementsSection}
        ${awardsSection}
    </div>`;
}

function renderFtcOprChart(history) {
    const container = $('ftc-opr-chart');
    const section = $('ftc-opr-chart-container');
    if (!container || !section || !history || history.length < 2) return;
    section.classList.remove('hidden');
    const maxOpr = Math.max(...history.map(h => h.opr_total));
    const w = 300, h = 140, pad = 35, rightPad = 10;
    const plotW = w - pad - rightPad, plotH = h - 30;
    const step = plotW / Math.max(history.length - 1, 1);
    const scale = maxOpr > 0 ? plotH / (maxOpr * 1.15) : 1;
    let pts = history.map((d, i) => [pad + i * step, h - 15 - d.opr_total * scale]);
    let path = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    let areaPath = path + ' L' + pts[pts.length - 1][0].toFixed(1) + ',' + (h - 15) + ' L' + pts[0][0].toFixed(1) + ',' + (h - 15) + ' Z';
    let labels = history.map((d, i) => '<text x="' + (pad + i * step) + '" y="' + (h - 2) + '" text-anchor="middle" fill="var(--text-muted)" font-size="10">' + d.season + '</text>').join('');
    let dots = pts.map((p, i) => '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="4" fill="#f97316" stroke="#1e1b2e" stroke-width="2"/>' +
        '<text x="' + p[0].toFixed(1) + '" y="' + (p[1] - 8).toFixed(1) + '" text-anchor="middle" fill="var(--text-secondary)" font-size="10" font-weight="600">' + history[i].opr_total + '</text>').join('');
    container.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" style="width:100%;height:100%">' +
        '<path d="' + areaPath + '" fill="rgba(249,115,22,.1)" />' +
        '<path d="' + path + '" fill="none" stroke="#f97316" stroke-width="2.5" stroke-linejoin="round" />' +
        dots + labels + '</svg>';
}

// ═══════════════════════════════════════════════════════════
// 6. PLAY BY PLAY
// ═══════════════════════════════════════════════════════════
async function loadPlayByPlay() {
    if (!currentEvent) return;
    hideInlineError('pbp-error');
    try {
        setLoadingStatus('pbp-loading-status', 'Fetching match schedule\u2026');
        const data = await getActiveAPI().allMatches(currentEvent);
        pbpData = data;
        checkWorldRecordFromPbp(data);
        pbpIndex = findLatestScoredMatch(data?.matches || []);
        hideSkeleton('pbp-loading');
        if (!data?.matches?.length) {
            hide('pbp-container');
            const el = $('pbp-empty');
            if (el) {
                el.textContent = currentEventStatus === 'upcoming'
                    ? 'The match schedule for this event has not been published yet.'
                    : 'No match data available for this event.';
                el.classList.remove('hidden');
            }
            return;
        }
        hide('pbp-empty');
        show('pbp-container');
        buildPbpSelector();
        if (_pendingMatchKey) {
            _navigateToMatchByKey(_pendingMatchKey);
            _pendingMatchKey = null;
        } else {
            renderPbpMatch();
        }
        fadeIn('pbp-container');
        startPbpRefresh();
        updateTabDots();
    } catch (err) {
        hideSkeleton('pbp-loading');
        showInlineError('pbp-error', `Failed to load matches: ${err.message}`, loadPlayByPlay);
    }
}

// Pre-compute PbP display labels: Qual N for quals, Match N for playoffs, Final / Final N for finals
function _computePbpLabels() {
    if (!pbpData?.matches) return;
    let matchNum = 0;
    pbpData.matches.forEach(m => {
        if (m.comp_level === 'qm') {
            m._pbpLabel = (m.label || '').replace(/^Qualification\s*/i, 'Qual ');
        } else if (m.comp_level === 'f') {
            m._pbpLabel = m.label || 'Final';
        } else {
            matchNum++;
            m._pbpLabel = `Match ${matchNum}`;
        }
    });
}

// Get alliance pick role for a team (Captain, P1, P2, etc.)
function _getPickRole(teamNum) {
    if (!allianceData?.alliances) return null;
    for (const a of allianceData.alliances) {
        const idx = (a.teams || []).findIndex(t => t.team_number === teamNum);
        if (idx >= 0) {
            if (idx === 0) return 'C';
            if (a.teams.length <= 4 && idx === a.teams.length - 1 && idx >= 3) return 'BU';
            return `P${idx}`;
        }
    }
    return null;
}

function buildPbpSelector() {
    _computePbpLabels();
    const sel = $('pbp-match-select');
    sel.innerHTML = pbpData.matches.map((m, i) =>
        `<option value="${i}">${m._pbpLabel || m.label || ''}</option>`
    ).join('');
    sel.value = pbpIndex;
}

function pbpGoTo(idx) {
    pbpIndex = parseInt(idx, 10);
    dismissStoryline('pbp-storyline');
    renderPbpMatch();
}

function pbpPrev() {
    if (pbpIndex > 0) {
        pbpIndex--;
        $('pbp-match-select').value = pbpIndex;
        dismissStoryline('pbp-storyline');
        renderPbpMatch();
    }
}

function pbpNext() {
    if (pbpData && pbpIndex < pbpData.matches.length - 1) {
        pbpIndex++;
        $('pbp-match-select').value = pbpIndex;
        dismissStoryline('pbp-storyline');
        renderPbpMatch();
    }
}

/** Enrich PBP team objects with streak info and OPR-above-avg flag */
function _enrichPbpTeams(m) {
    // Compute event-wide averages from teamsData (all event teams)
    let avgOpr = 0, p75Opr = 0, avgEpa = 0, p75Epa = 0;
    if (teamsData && teamsData.length) {
        const ov = teamsData.map(t => parseFloat(t.opr)).filter(v => !isNaN(v)).sort((a, b) => a - b);
        if (ov.length) {
            avgOpr = ov.reduce((a, b) => a + b, 0) / ov.length;
            p75Opr = ov[Math.floor(ov.length * 0.75)] || avgOpr;
        }
        const ev = teamsData.map(t => parseFloat(t.epa)).filter(v => !isNaN(v)).sort((a, b) => a - b);
        if (ev.length) {
            avgEpa = ev.reduce((a, b) => a + b, 0) / ev.length;
            p75Epa = ev[Math.floor(ev.length * 0.75)] || avgEpa;
        }
    } else {
        // Fallback: use only match teams
        const allT = [...(m.red.teams || []), ...(m.blue.teams || [])];
        const ov = allT.map(t => parseFloat(t.opr)).filter(v => !isNaN(v));
        avgOpr = ov.length ? ov.reduce((a, b) => a + b, 0) / ov.length : 0;
        p75Opr = avgOpr;
        const ev = allT.map(t => parseFloat(t.epa)).filter(v => !isNaN(v));
        avgEpa = ev.length ? ev.reduce((a, b) => a + b, 0) / ev.length : 0;
        p75Epa = avgEpa;
    }

    // Compute streaks from match history (if available from pbpData)
    const matchesBefore = pbpData.matches.slice(0, pbpIndex);
    const allTeams = [...(m.red.teams || []), ...(m.blue.teams || [])];

    for (const t of allTeams) {
        // OPR tiers
        const opr = parseFloat(t.opr);
        t._opr_above_avg = !isNaN(opr) && opr > avgOpr;
        t._opr_top25 = !isNaN(opr) && opr >= p75Opr;

        // EPA tiers
        const epa = parseFloat(t.epa);
        t._epa_above_avg = !isNaN(epa) && epa > avgEpa;
        t._epa_top25 = !isNaN(epa) && epa >= p75Epa;

        // Delta: (OPR - EPA) / avgOpr × 100  — positive = outperforming predictions
        t._delta = null;
        if (!isNaN(opr) && !isNaN(epa) && avgOpr > 0) {
            t._delta = ((opr - epa) / avgOpr) * 100;
        }

        // Streak: count consecutive Ws or Ls up to the current match
        let streakType = null;
        let streakCount = 0;
        for (let i = matchesBefore.length - 1; i >= 0; i--) {
            const pm = matchesBefore[i];
            const onRed = pm.red.teams.some(rt => rt.team_number === t.team_number);
            const onBlue = pm.blue.teams.some(bt => bt.team_number === t.team_number);
            if (!onRed && !onBlue) continue;
            const won = (onRed && pm.winning_alliance === 'red') || (onBlue && pm.winning_alliance === 'blue');
            const lost = (onRed && pm.winning_alliance === 'blue') || (onBlue && pm.winning_alliance === 'red');
            if (!won && !lost) break; // tie or unplayed
            const type = won ? 'W' : 'L';
            if (streakType === null) streakType = type;
            if (type !== streakType) break;
            streakCount++;
        }
        t._streak_type = streakType;
        t._streak_count = streakCount;
    }
}

// ── AI Storyline shared render functions ────────────────────
function showStorylineLoading(containerId) {
    const el = $(containerId);
    if (!el) return;
    el.innerHTML = `
        <div class="storyline-loading">
            <div class="storyline-loading-dot"><span></span><span></span><span></span></div>
            <span class="storyline-loading-text">Crafting your storyline…</span>
        </div>`;
}

function renderStoryline(containerId, text, cached, label) {
    const el = $(containerId);
    if (!el) return;
    const title = label ? `AI Storyline — ${label}` : 'AI Storyline';
    el.innerHTML = `
        <div class="storyline-panel">
            <div class="storyline-header">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
                ${title}${cached ? ' <span class="storyline-cached-badge">(cached)</span>' : ''}
            </div>
            <div class="storyline-body">
                <div class="storyline-text">${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
                <div class="storyline-actions">
                    <button class="storyline-action-btn" onclick="copyStoryline(this)" title="Copy to clipboard">Copy</button>
                    <button class="storyline-action-btn" onclick="dismissStoryline('${containerId}')">Dismiss</button>
                </div>
            </div>
        </div>`;
}

function showStorylineError(containerId, msg, retryFn) {
    const el = $(containerId);
    if (!el) return;
    el.innerHTML = `
        <div class="storyline-error">
            <span>${msg}</span>
            ${retryFn ? `<button class="storyline-error-retry" onclick="${retryFn}">Retry</button>` : ''}
        </div>`;
}

function copyStoryline(btn) {
    const text = btn.closest('.storyline-panel')?.querySelector('.storyline-text')?.textContent;
    if (text) {
        navigator.clipboard.writeText(text).then(() => {
            btn.textContent = 'Copied!';
            btn.classList.add('copied');
            setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500);
        });
    }
}

const _storylineCache = {};   // key → {text, cached}

function dismissStoryline(containerId) {
    const el = $(containerId);
    if (el) el.innerHTML = '';
}

// ── PbP Storyline generation ───────────────────────────────
async function generateMatchStoryline() {
    if (!pbpData || !pbpData.matches.length) return;
    const m = pbpData.matches[pbpIndex];
    if (!m.key || !currentEvent) return;

    const cacheKey = `match:${m.key}`;
    if (_storylineCache[cacheKey]) {
        const c = _storylineCache[cacheKey];
        renderStoryline('pbp-storyline', c.text, true);
        return;
    }

    const btn = document.querySelector('.pbp-storyline-btn');
    if (btn) btn.disabled = true;

    showStorylineLoading('pbp-storyline');

    try {
        const result = await API.generateStoryline({
            mode: 'match',
            event_key: currentEvent,
            match_key: m.key,
        });
        _storylineCache[cacheKey] = { text: result.storyline };
        renderStoryline('pbp-storyline', result.storyline, result.cached);
    } catch (err) {
        showStorylineError('pbp-storyline', err.message || 'Failed to generate storyline.', 'generateMatchStoryline()');
    } finally {
        if (btn) btn.disabled = false;
    }
}

// ── Spotlight Storyline generation ─────────────────────────
async function generateTeamStoryline(teamNum) {
    if (!currentEvent) return;

    const cacheKey = `team:${currentEvent}:${teamNum}`;
    if (_storylineCache[cacheKey]) {
        const c = _storylineCache[cacheKey];
        renderStoryline('spotlight-storyline', c.text, true);
        return;
    }

    const btn = document.querySelector('.spotlight-storyline-btn');
    if (btn) btn.disabled = true;

    showStorylineLoading('spotlight-storyline');

    try {
        const result = await API.generateStoryline({
            mode: 'team',
            event_key: currentEvent,
            team_number: teamNum,
        });
        _storylineCache[cacheKey] = { text: result.storyline };
        renderStoryline('spotlight-storyline', result.storyline, result.cached);
    } catch (err) {
        showStorylineError('spotlight-storyline', err.message || 'Failed to generate storyline.', `generateTeamStoryline(${teamNum})`);
    } finally {
        if (btn) btn.disabled = false;
    }
}

// ── PbP inline Team Storyline (single-click on team number) ─
async function generatePbpTeamStoryline(teamNum) {
    if (!currentEvent) return;

    // Look up nickname from current match data
    const m = pbpData?.matches?.[pbpIndex];
    let nickname = '';
    if (m) {
        const allTeams = [...(m.red?.teams || []), ...(m.blue?.teams || [])];
        const t = allTeams.find(t => t.team_number === teamNum);
        if (t) nickname = t.nickname || '';
    }
    const label = nickname ? `${teamNum} ${nickname}` : `Team ${teamNum}`;

    const cacheKey = `team:${currentEvent}:${teamNum}`;
    if (_storylineCache[cacheKey]) {
        renderStoryline('pbp-storyline', _storylineCache[cacheKey].text, true, label);
        return;
    }

    showStorylineLoading('pbp-storyline');

    try {
        const result = await API.generateStoryline({
            mode: 'team',
            event_key: currentEvent,
            team_number: teamNum,
        });
        _storylineCache[cacheKey] = { text: result.storyline };
        renderStoryline('pbp-storyline', result.storyline, result.cached, label);
    } catch (err) {
        showStorylineError('pbp-storyline', err.message || 'Failed to generate storyline.', `generatePbpTeamStoryline(${teamNum})`);
    }
}

function renderPbpMatch() {
    if (!pbpData || !pbpData.matches.length) return;
    const m = pbpData.matches[pbpIndex];

    // Sync URL with current match key
    if (m.key) {
        const shortKey = m.key.replace(currentEvent + '_', '');
        _syncUrl({ match: shortKey });
    }

    // Enrich teams with streak and OPR-above-average data
    _enrichPbpTeams(m);

    $('pbp-match-label').textContent = m._pbpLabel || (m.label || '').replace(/^Qualification\s*/i, 'Qual ');
    $('pbp-match-select').value = pbpIndex;
    _syncMobPbpLabel();

    const redWon = m.winning_alliance === 'red';
    const blueWon = m.winning_alliance === 'blue';
    const upcoming = m.red.score < 0 && m.blue.score < 0;

    // Statbotics prediction bar
    let predHtml = '';
    if (showPredictions && m.pred) {
        const p = m.pred;
        const redPct = p.red_win_prob != null ? Math.round(p.red_win_prob * 100) : null;
        const bluePct = redPct != null ? 100 - redPct : null;
        if (redPct != null) {
            const favored = redPct >= 50 ? 'red' : 'blue';
            predHtml = `
            <div class="pbp-prediction">
                <div class="pbp-pred-header">
                    <span class="pbp-pred-label">Statbotics Win Prediction</span>
                    <span class="pbp-pred-scores">Predicted: <span class="pred-red">${p.red_score}</span> · <span class="pred-blue">${p.blue_score}</span></span>
                </div>
                <div class="pbp-pred-bar">
                    <div class="pbp-pred-fill pbp-pred-red ${favored === 'red' ? 'pbp-pred-favored' : ''}" style="width:${redPct}%">
                        ${redPct >= 15 ? `<span>${redPct}%</span>` : ''}
                    </div>
                    <div class="pbp-pred-fill pbp-pred-blue ${favored === 'blue' ? 'pbp-pred-favored' : ''}" style="width:${bluePct}%">
                        ${bluePct >= 15 ? `<span>${bluePct}%</span>` : ''}
                    </div>
                </div>
            </div>`;
        }
    }

    // Alliance titles (include alliance # for playoff matches)
    const redAllianceNum = m.red.alliance_number;
    const blueAllianceNum = m.blue.alliance_number;
    const redTitle = redAllianceNum ? `Alliance #${redAllianceNum}` : 'Red Alliance';
    const blueTitle = blueAllianceNum ? `Alliance #${blueAllianceNum}` : 'Blue Alliance';

    // Render team cards or alliance placeholder when teams aren't assigned yet
    const redTeamCards = m.red.teams.length
        ? m.red.teams.map(t => renderPbpTeam(t, 'red-side')).join('')
        : (redAllianceNum ? `<div class="pbp-alliance-placeholder red-side">Alliance #${redAllianceNum} — Teams TBD</div>` : '<div class="pbp-alliance-placeholder">Teams TBD</div>');
    const blueTeamCards = m.blue.teams.length
        ? m.blue.teams.map(t => renderPbpTeam(t, 'blue-side')).join('')
        : (blueAllianceNum ? `<div class="pbp-alliance-placeholder blue-side">Alliance #${blueAllianceNum} — Teams TBD</div>` : '<div class="pbp-alliance-placeholder">Teams TBD</div>');

    $('pbp-arena').innerHTML = `
        <div class="pbp-alliance red-side ${redWon ? 'pbp-alliance-won' : ''}">
            <div class="pbp-alliance-header">
                <span class="pbp-alliance-title">${redTitle}</span>
                <div class="pbp-score-group">
                    ${redWon ? '<span class="pbp-winner-label">WINNER</span>' : ''}
                    <span class="pbp-alliance-score">${upcoming ? '–' : m.red.score}</span>
                </div>
            </div>
            <div class="pbp-team-cards">
                ${redTeamCards}
            </div>
        </div>
        <div class="pbp-alliance blue-side ${blueWon ? 'pbp-alliance-won' : ''}">
            <div class="pbp-alliance-header">
                <div class="pbp-score-group">
                    <span class="pbp-alliance-score">${upcoming ? '–' : m.blue.score}</span>
                    ${blueWon ? '<span class="pbp-winner-label">WINNER</span>' : ''}
                </div>
                <span class="pbp-alliance-title">${blueTitle}</span>
            </div>
            <div class="pbp-team-cards">
                ${blueTeamCards}
            </div>
        </div>
    ` + predHtml;

    // If awards toggle is on, fetch and inject awards asynchronously
    if (pbpShowAwards) {
        const allTeams = [...m.red.teams, ...m.blue.teams];
        _injectPbpAwards(allTeams, pbpIndex);
    }

    // If GATool sponsors toggle is on, fetch and inject sponsors asynchronously
    if (showGatoolSponsors) {
        const allTeams = [...m.red.teams, ...m.blue.teams];
        _injectGatoolSponsors(allTeams, pbpIndex);
    }

    // Inject playoff-firsts badges for playoff matches
    if (m.comp_level && m.comp_level !== 'qm') {
        const allTeams = [...m.red.teams, ...m.blue.teams];
        _injectPlayoffFirsts(allTeams, pbpIndex, m.comp_level);
    }

    // Footer: event high score + compare button
    const qs = pbpData.event_high_score;
    const storylineBtn = _storylineAvailable && competitionMode === 'frc'
        ? `<button class="pbp-storyline-btn" onclick="generateMatchStoryline()" title="Generate AI broadcast storyline for this match">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
               Storyline <kbd class="kbd-desktop">S</kbd>
           </button>`
        : '';
    $('pbp-footer').innerHTML = `
        <div class="pbp-footer-actions">
            <button class="pbp-compare-btn" onclick="compareCurrentMatch()" title="Compare all 6 teams side by side">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 16l4-8 4 4 4-6"/></svg>
                Compare Teams <kbd class="kbd-desktop">C</kbd>
            </button>
            <button class="pbp-breakdown-btn" onclick="goToBreakdownFromPbp()" title="View score breakdown for this match">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                Breakdown <kbd class="kbd-desktop">B</kbd>
            </button>
            ${storylineBtn}
        </div>
        ${qs && qs.score > 0
            ? `<span class="pbp-footer-text">
                   Event High Score: <span class="pbp-footer-score">${qs.score}</span>
                   in ${qs.match} (${qs.teams.join(', ')})
               </span>`
            : ''}
    `;

    // Prior connections between the teams on the field
    renderPbpConnections(m);
}

let _pbpConnCache = {};           // keyed by "teamA,teamB,...,teamF|allTime" → connections array
let _pbpConnAllTime = false;      // current range toggle state

function _connCacheKey(teamNums, allTime) {
    return [...teamNums].sort((a, b) => a - b).join(',') + '|' + (allTime ? '1' : '0');
}

async function fetchMatchConnections(teamNums, forceAllTime) {
    const wantAllTime = forceAllTime !== undefined ? forceAllTime : _pbpConnAllTime;
    const key = _connCacheKey(teamNums, wantAllTime);
    if (_pbpConnCache[key]) return _pbpConnCache[key];
    try {
        const result = await getActiveAPI().eventConnections(currentEvent, wantAllTime, teamNums);
        _pbpConnCache[key] = result;
        return result;
    } catch {
        _pbpConnCache[key] = [];
        return [];
    }
}

async function renderPbpConnections(match) {
    // Collect team numbers on each side
    const redNums = new Set(match.red.teams.map(t => t.team_number));
    const blueNums = new Set(match.blue.teams.map(t => t.team_number));
    const allTeamNums = [...redNums, ...blueNums];

    // Show loading spinner while connections are being fetched
    let container = $('pbp-connections');
    if (!container) {
        container = document.createElement('div');
        container.id = 'pbp-connections';
        container.className = 'pbp-connections';
        $('pbp-footer').insertAdjacentElement('afterend', container);
    }
    const wasExpanded = container.classList.contains('pbp-conn-expanded');

    // Check if we already have cached data for these exact teams
    const cacheKey = _connCacheKey(allTeamNums, _pbpConnAllTime);
    const cached = _pbpConnCache[cacheKey];

    if (!cached) {
        container.innerHTML = `
            <div class="pbp-conn-header pbp-conn-loading-header" onclick="togglePbpConnections(event)">
                <svg class="pbp-conn-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                <svg class="conn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 17a4 4 0 0 1-4 4H5a4 4 0 0 1-4-4 4 4 0 0 1 4-4h1"/><path d="M13 17a4 4 0 0 0 4 4h2a4 4 0 0 0 4-4 4 4 0 0 0-4-4h-1"/><path d="M7 13 5 3l4 2 3-2 3 2 4-2-2 10"/></svg>
                Prior Connections on the Field
                <span class="pbp-conn-loading-spinner"></span>
                <span style="color:var(--text-muted); font-size:.78rem; font-style:italic;">Loading connections…</span>
            </div>
            <div class="pbp-conn-body"></div>`;
        if (wasExpanded) container.classList.add('pbp-conn-expanded');
    }

    // Fetch connections for only the 6 teams on the field (cached if revisited)
    const connections = await fetchMatchConnections(allTeamNums);

    // Guard: user may have navigated away during fetch
    if (pbpData && pbpData.matches[pbpIndex] !== match) return;

    const svgPartner = '<svg class="conn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 17a4 4 0 0 1-4 4H5a4 4 0 0 1-4-4 4 4 0 0 1 4-4h1"/><path d="M13 17a4 4 0 0 0 4 4h2a4 4 0 0 0 4-4 4 4 0 0 0-4-4h-1"/><path d="M7 13 5 3l4 2 3-2 3 2 4-2-2 10"/></svg>';
    const svgOpponent = '<svg class="conn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="M13 19l6-6"/><path d="M16 16l4 4"/><path d="M19 21l2-2"/><path d="M14.5 6.5 18 3h3v3l-3.5 3.5"/><path d="m5 14 4 4"/><path d="m7 17-2 2"/></svg>';

    // Find relevant connections
    const allNums = new Set(allTeamNums);
    const items = [];
    for (const c of connections) {
        if (!allNums.has(c.team_a) || !allNums.has(c.team_b)) continue;

        // Determine context: are they on same side or opposing?
        const sameSide = (redNums.has(c.team_a) && redNums.has(c.team_b)) ||
                         (blueNums.has(c.team_a) && blueNums.has(c.team_b));
        const sideClass = sameSide
            ? (redNums.has(c.team_a) ? 'pbp-conn-red' : 'pbp-conn-blue')
            : 'pbp-conn-cross';

        // Build summary of prior history — pick the most notable entry
        const allEvents = [...c.partnered_at, ...c.opponents_at];
        allEvents.sort((a, b) => b.year - a.year);

        const highlights = [];
        for (const e of allEvents) {
            const isPartner = c.partnered_at.includes(e);
            const icon = isPartner ? svgPartner : svgOpponent;
            const typeLabel = isPartner ? 'Partners' : 'Opponents';
            const resultTag = e.result === 'winner' ? ' <span class="pbp-conn-winner">Winner</span>'
                : e.result === 'finalist' ? ' <span class="pbp-conn-finalist">Finalist</span>' : '';
            highlights.push(`${icon} <span class="pbp-conn-type">${typeLabel}</span> at ${e.event_name || e.event_key} ${e.year} <span class="pbp-conn-stage">${e.stage}</span>${resultTag}`);
        }

        const visibleHtml = highlights.slice(0, 2).join('<span class="pbp-conn-sep">·</span>');
        const extraCount = highlights.length - 2;
        let extraHtml = '';
        if (extraCount > 0) {
            const hiddenEntries = highlights.slice(2).join('<span class="pbp-conn-sep">·</span>');
            extraHtml = ` <span class="pbp-conn-more" onclick="this.parentElement.querySelector('.pbp-conn-extra').classList.toggle('hidden');this.textContent=this.textContent.startsWith('+')?'− collapse':'+${extraCount} more'">+${extraCount} more</span><span class="pbp-conn-extra hidden"><span class="pbp-conn-sep">·</span>${hiddenEntries}</span>`;
        }

        const groupOrder = sideClass === 'pbp-conn-red' ? 0 : sideClass === 'pbp-conn-blue' ? 1 : 2;
        items.push({ order: groupOrder, html: `
            <div class="pbp-conn-item ${sideClass}">
                <span class="pbp-conn-teams">${c.team_a} &amp; ${c.team_b}</span>
                <div class="pbp-conn-highlights">${visibleHtml}${extraHtml}</div>
            </div>` });
    }

    // Sort: red first, then blue, then cross-alliance
    items.sort((a, b) => a.order - b.order);

    // Render into the container (already created above)
    const isExpanded = container.classList.contains('pbp-conn-expanded');
    const checkedAttr = _pbpConnAllTime ? ' checked' : '';
    const bodyContent = items.length > 0
        ? items.map(i => i.html).join('')
        : '<div class="pbp-conn-empty">No prior connections for this match.</div>';
    container.innerHTML = `
        <div class="pbp-conn-header" onclick="togglePbpConnections(event)">
            <svg class="pbp-conn-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            <svg class="conn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 17a4 4 0 0 1-4 4H5a4 4 0 0 1-4-4 4 4 0 0 1 4-4h1"/><path d="M13 17a4 4 0 0 0 4 4h2a4 4 0 0 0 4-4 4 4 0 0 0-4-4h-1"/><path d="M7 13 5 3l4 2 3-2 3 2 4-2-2 10"/></svg>
            Prior Connections on the Field
            <span class="pbp-conn-count">${items.length}</span>
            <label class="pbp-conn-range-toggle" onclick="event.stopPropagation()">
                <span class="conn-range-side${!_pbpConnAllTime ? ' active' : ''}">Past 3 Seasons</span>
                <input type="checkbox"${checkedAttr} onchange="togglePbpConnRange(this.checked)">
                <span class="conn-toggle-slider"></span>
                <span class="conn-range-side${_pbpConnAllTime ? ' active' : ''}">${isFTCMode() ? 'Since 2019' : 'All time'}</span>
            </label>
        </div>
        <div class="pbp-conn-body">
            ${bodyContent}
        </div>`;
    // Re-apply expanded state if it was open
    if (isExpanded) container.classList.add('pbp-conn-expanded');
}

function togglePbpConnections(e) {
    const container = $('pbp-connections');
    if (container) container.classList.toggle('pbp-conn-expanded');
}

async function togglePbpConnRange(allTime) {
    _pbpConnAllTime = allTime;
    // Update toggle label styling
    const container = $('pbp-connections');
    if (container) {
        const sides = container.querySelectorAll('.conn-range-side');
        if (sides.length === 2) {
            sides[0].classList.toggle('active', !allTime);
            sides[1].classList.toggle('active', allTime);
        }
    }
    // Re-render current match
    if (typeof pbpData !== 'undefined' && pbpData && pbpData.matches && pbpData.matches.length) {
        const idx = pbpIndex;
        const m = pbpData.matches[idx];
        if (m) {
            // Ensure expanded stays open through re-render
            const wasExpanded = container && container.classList.contains('pbp-conn-expanded');
            await renderPbpConnections(m);
            if (wasExpanded) $('pbp-connections')?.classList.add('pbp-conn-expanded');
        }
    }
}

function renderPbpTeam(t, sideCls) {
    t = _applyTimsOverrides(t);
    const loc = [t.city, t.state_prov, t.country].filter(Boolean).join(', ');
    const shortLoc = [t.state_prov, t.country].filter(Boolean).join(', ');
    const foreignCls = highlightForeign && t.country && eventCountry && t.country !== eventCountry ? 'foreign-team' : '';
    const rookieCls = highlightRookie && t.rookie_year && currentEventYear && t.rookie_year >= currentEventYear ? 'rookie-team' : '';
    const ftcMode = isFTCMode();

    // Streak indicator
    let streakHtml = '';
    if (t.wins != null && t.losses != null) {
        const totalPlayed = t.wins + t.losses + (t.ties || 0);
        if (totalPlayed > 0 && t._streak_type && t._streak_count > 1) {
            const cls = t._streak_type === 'W' ? 'pbp-streak-win' : 'pbp-streak-loss';
            const ord = _ordinal(t._streak_count);
            const streakWord = t._streak_type === 'W' ? 'win' : 'loss';
            streakHtml = `<span class="pbp-streak-badge ${cls}" title="${ord} consecutive ${streakWord}">${t._streak_type}${t._streak_count}</span>`;
        }
    }

    // OPR/EPA highlighting (top-25% colored, above-avg white, default muted)
    const oprCls = t._opr_top25 ? ' opr-top25' : (t._opr_above_avg ? ' opr-above-avg' : '');
    const epaCls = t._epa_top25 ? ' epa-top25' : (t._epa_above_avg ? ' epa-above-avg' : '');

    // Delta indicator: (OPR - EPA) / avgEventOPR × 100 — positive = outperforming
    let deltaHtml = '';
    if (!ftcMode && t._delta != null && (t._delta > 15 || t._delta < -15)) {
        const pct = Math.round(Math.abs(t._delta));
        if (t._delta > 15) {
            deltaHtml = `<span class="pbp-delta pbp-delta-up" title="Outperforming Statbotics predictions by ${pct}%">\u2191</span>`;
        } else {
            deltaHtml = `<span class="pbp-delta pbp-delta-down" title="Underperforming Statbotics predictions by ${pct}%">\u2193</span>`;
        }
    }

    // Alliance pick role indicator (Captain / Pick #) — only in playoff matches
    const isPlayoff = pbpData?.matches?.[pbpIndex]?.comp_level && pbpData.matches[pbpIndex].comp_level !== 'qm';
    const pickRole = isPlayoff ? _getPickRole(t.team_number) : null;
    const pickHtml = pickRole ? `<span class="pbp-pick-role">${pickRole}</span>` : '';

    return `
    <div class="pbp-team ${foreignCls} ${rookieCls}" data-country="${t.country || ''}" data-rookie-year="${t.rookie_year || ''}">
        <div class="pbp-team-top">
            <div class="pbp-team-number">${_renderTeamNum(t)}${pickHtml}</div>
            <div class="pbp-team-identity">
                <div class="pbp-team-name-row">
                    <div class="pbp-team-nickname">${t.nickname || 'Team ' + t.team_number}</div>
                    <div class="pbp-firsts-slot" data-firsts-team="${t.team_number}"></div>
                </div>
                ${t.school_name ? `<div class="pbp-team-school">${t.school_name}</div>` : ''}
                ${loc ? `<div class="pbp-team-location pbp-loc-full">${loc}</div>` : ''}
                ${shortLoc ? `<div class="pbp-team-location pbp-loc-short">${shortLoc}</div>` : ''}
            </div>
        </div>
        <div class="pbp-team-stats">
            <div class="pbp-stat">
                <div class="pbp-stat-label">Rank</div>
                <div class="pbp-stat-value${Number(t.rank) >= 1 && Number(t.rank) <= 8 ? ' rank-top8' : ''}">${t.rank}</div>
            </div>
            <div class="pbp-stat">
                <div class="pbp-stat-label">W-L-T${streakHtml}</div>
                <div class="pbp-stat-value">${t.wins}-${t.losses}-${t.ties}</div>
            </div>
            <div class="pbp-stat-group-gap"></div>
            <div class="pbp-stat">
                <div class="pbp-stat-label">OPR</div>
                <div class="pbp-stat-value opr-val${oprCls}">${t.opr}</div>
            </div>
            ${ftcMode ? '' : `<div class="pbp-stat">
                <div class="pbp-stat-label">EPA${deltaHtml}</div>
                <div class="pbp-stat-value epa-val${epaCls}">${t.epa != null ? t.epa : '\u2013'}</div>
            </div>`}
            <div class="pbp-stat">
                <div class="pbp-stat-label">Avg RP</div>
                <div class="pbp-stat-value">${t.avg_rp}</div>
            </div>
        </div>
        <div class="pbp-awards-slot" data-team="${t.team_number}"></div>
        <div class="pbp-bottom-row">
            ${t.robot_name ? `<div class="pbp-robot-name" title="Robot Name"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg><span class="pbp-robot-name-text">${_esc(t.robot_name)}</span></div>` : ''}
            ${_renderPbpTags(_parseTags(_timsCache[t.team_number]?.hardware), 'Hardware', 'pbp-hardware-tag')}
            ${_renderPbpTags(_parseTags(_timsCache[t.team_number]?.auto_strategy).concat(_parseTags(_timsCache[t.team_number]?.teleop_strategy)), 'Strategy', 'pbp-strategy-tag')}
            <div class="pbp-sponsors-slot" data-sponsors-team="${t.team_number}">${t._tims_sponsors ? `<div class="pbp-sponsors" title="Sponsors (TIMS)"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg><span class="pbp-sponsors-text">${t._tims_sponsors}</span></div>` : ''}</div>
        </div>
    </div>`;
}

// ── PBP Playoff-firsts injection ───────────────────────────

let _playoffFirstsCache = null;  // {team_number: {first_playoff, first_finals, rookie}} or null

async function _injectPlayoffFirsts(teams, matchIdx, compLevel) {
    // Lazy-load once per event
    if (_playoffFirstsCache === null) {
        if (isFTCMode()) { _playoffFirstsCache = {}; return; }
        try {
            _playoffFirstsCache = await API.playoffFirsts(currentEvent);
        } catch {
            _playoffFirstsCache = {};  // mark as loaded but empty
            return;
        }
    }

    // Guard: user may have navigated to a different match
    if (pbpIndex !== matchIdx) return;

    const isFinals = compLevel === 'f';

    for (const t of teams) {
        const info = _playoffFirstsCache[t.team_number];
        if (!info) continue;

        const slot = document.querySelector(`.pbp-firsts-slot[data-firsts-team="${t.team_number}"]`);
        if (!slot) continue;

        const badges = [];
        if (isFinals && info.first_finals) {
            badges.push(`<span class="pbp-first-badge pbp-first-finals" title="First-ever appearance in Finals">
                First Finals
            </span>`);
        } else if (info.first_playoff) {
            badges.push(`<span class="pbp-first-badge pbp-first-playoff" title="First-ever playoff appearance${info.rookie ? ' (Rookie)' : ''}">
                First Playoffs${info.rookie ? ' (R)' : ''}
            </span>`);
        }
        slot.innerHTML = badges.join('');
    }
}

// ── PBP Awards injection ───────────────────────────────────

async function _injectPbpAwards(teams, matchIdx) {
    // Determine which teams need fetching
    const nums = teams.map(t => t.team_number);
    const uncached = nums.filter(n => !_pbpAwardsCache[n]);

    if (uncached.length) {
        try {
            // Use FTC or FRC awards endpoint depending on mode
            const data = isFTCMode()
                ? await FTC_API.teamAwardsSummary(uncached)
                : await API.teamAwardsSummary(uncached);
            for (const [key, val] of Object.entries(data)) {
                _pbpAwardsCache[parseInt(key)] = val;
            }
        } catch {
            // silently skip — awards are a nice-to-have
            return;
        }
    }

    // Guard: user may have navigated to a different match during the fetch
    if (pbpIndex !== matchIdx) return;

    // Inject awards HTML into each team's slot
    for (const num of nums) {
        const info = _pbpAwardsCache[num];
        if (!info) continue;
        const slot = document.querySelector(`.pbp-awards-slot[data-team="${num}"]`);
        if (!slot) continue;
        slot.innerHTML = _renderPbpAwardsRow(info);
    }
}

function _renderPbpAwardsRow(info) {
    const parts = [];

    // Blue banners
    if (info.blue_banner_count > 0) {
        parts.push(`<span class="pbp-award-banner has-tooltip" tabindex="0">
            <svg class="pbp-award-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M5 2h14l-3 7 3 7H5V2z"/></svg>
            <span class="pbp-award-count">${info.blue_banner_count}</span>
            <span class="custom-tooltip">${info.blue_banner_count} Blue Banner${info.blue_banner_count !== 1 ? 's' : ''}</span>
        </span>`);
    }

    // Recent awards (last 3 seasons)
    const recent = info.recent_awards || [];
    if (recent.length) {
        const renderEntry = (a) => {
            const cls = a.is_blue_banner ? 'pbp-award-entry pbp-award-blue-banner has-tooltip' : 'pbp-award-entry has-tooltip';
            return `<span class="${cls}" tabindex="0">${a.name} <span class="pbp-award-year">'${String(a.year).slice(-2)}</span><span class="custom-tooltip">${a.event_name || a.event_key} (${a.year})</span></span>`;
        };

        const visible = recent.slice(0, 4).map(renderEntry);
        const hidden = recent.slice(4);

        let html = visible.join('');
        if (hidden.length) {
            html += `<span class="pbp-award-toggle" onclick="pbpToggleAwardsOverflow(this)">+${hidden.length} more</span>`;
            html += `<span class="pbp-award-overflow hidden" data-count="${hidden.length}">${hidden.map(renderEntry).join('')}</span>`;
        }
        parts.push(`<span class="pbp-award-recent">${html}</span>`);
    }

    if (!parts.length) return '';
    return `<div class="pbp-awards-row">${parts.join('')}</div>`;
}

function pbpToggleAwardsOverflow(el) {
    const overflow = el.nextElementSibling;
    if (!overflow) return;
    const isHidden = overflow.classList.contains('hidden');
    overflow.classList.toggle('hidden');
    const count = overflow.dataset.count || '?';
    el.textContent = isHidden ? '− collapse' : `+${count} more`;
}


// ═══════════════════════════════════════════════════════════
// 6b. PLAY-BY-PLAY LIVE REFRESH
// ═══════════════════════════════════════════════════════════

function startPbpRefresh() {
    stopPbpRefresh();
    if (currentEventStatus !== 'ongoing') return;
    // Realtime handles live updates — no setInterval needed.
    // Show live badge to indicate the connection is active
    $('pbp-live-badge')?.classList.remove('hidden');
}

function stopPbpRefresh() {
    if (pbpRefreshTimer) {
        clearInterval(pbpRefreshTimer);
        pbpRefreshTimer = null;
    }
    $('pbp-live-badge')?.classList.add('hidden');
}

/** Manual refresh (triggered by refresh button) */
async function pbpManualRefresh() {
    const btn = $('pbp-refresh-btn');
    if (btn) btn.classList.add('spinning');
    await pbpAutoRefresh();
    if (btn) btn.classList.remove('spinning');
}

/** Auto-refresh: fetch latest match data, diff against current, and update. */
async function pbpAutoRefresh() {
    if (!currentEvent || !pbpData) return;
    try {
        // Fast path: try FRC Events API scores first (instant from FIRST)
        let fastScoresApplied = false;
        try {
            const fast = await getActiveAPI().fastScores(currentEvent);
            if (fast?.scores?.length) {
                const oldMatches = pbpData.matches;
                let changed = false;
                const matchMap = {};
                oldMatches.forEach(m => { matchMap[m.key] = m; });

                for (const fs of fast.scores) {
                    const m = matchMap[fs.key];
                    if (!m) continue;
                    if (fs.red_score >= 0 && fs.blue_score >= 0) {
                        if (m.red.score !== fs.red_score || m.blue.score !== fs.blue_score) {
                            m.red.score = fs.red_score;
                            m.blue.score = fs.blue_score;
                            m.winning_alliance = fs.winning_alliance;
                            changed = true;
                        }
                    }
                }

                if (changed) {
                    fastScoresApplied = true;
                    renderPbpMatch();
                    if (renderedTabs.breakdown) buildBdSelector();
                    const arena = $('pbp-arena');
                    if (arena) {
                        arena.classList.remove('pbp-updated-flash');
                        void arena.offsetWidth;
                        arena.classList.add('pbp-updated-flash');
                    }
                    // Scores changed — refresh rankings immediately
                    refreshRankings();
                }
            }
        } catch (_) { /* FRC scores unavailable, continue to TBA */ }

        // Full refresh (gets new matches, etc)
        const fresh = await getActiveAPI().allMatches(currentEvent);
        if (!fresh || !fresh.matches || currentEvent !== fresh.event_key) return;

        const oldMatches = pbpData.matches;
        const newMatches = fresh.matches;

        // Track what changed
        let scoresChanged = false;
        let newMatchesAdded = false;
        const wasAtLatest = pbpIndex === oldMatches.length - 1;

        // Build a map of old matches by key for diffing
        const oldMap = {};
        oldMatches.forEach(m => { oldMap[m.key] = m; });

        // Check for score changes in existing matches
        for (const nm of newMatches) {
            const om = oldMap[nm.key];
            if (!om) {
                newMatchesAdded = true;
                continue;
            }
            if (om.red.score !== nm.red.score || om.blue.score !== nm.blue.score) {
                scoresChanged = true;
            }
            if (om.winning_alliance !== nm.winning_alliance) {
                scoresChanged = true;
            }
        }

        if (newMatches.length > oldMatches.length) {
            newMatchesAdded = true;
        }

        // Check event high score change
        const oldQHS = pbpData.event_high_score;
        const newQHS = fresh.event_high_score;
        if (oldQHS?.score !== newQHS?.score) scoresChanged = true;

        // Update global data
        pbpData = fresh;
        bdData = fresh;  // Shared data source for breakdown tab
        checkWorldRecordFromPbp(fresh);

        // If nothing changed, skip re-render
        if (!scoresChanged && !newMatchesAdded) return;

        // Rebuild the selector (may have new matches)
        const currentMatchKey = oldMatches[pbpIndex]?.key;
        buildPbpSelector();

        // Preserve the user's current match selection
        if (currentMatchKey) {
            const newIdx = newMatches.findIndex(m => m.key === currentMatchKey);
            if (newIdx >= 0) pbpIndex = newIdx;
        }

        // Auto-advance to newest match if user was viewing the latest
        if (wasAtLatest && newMatchesAdded) {
            pbpIndex = newMatches.length - 1;
        }

        $('pbp-match-select').value = pbpIndex;

        // Re-render the current match with updated scores/stats
        renderPbpMatch();

        // Also update breakdown selector if it was already rendered
        if (renderedTabs.breakdown) buildBdSelector();

        // Scores changed — refresh rankings immediately
        if (scoresChanged) {
            refreshRankings();
            // Flash the arena container to indicate a score update
            const arena = $('pbp-arena');
            if (arena) {
                arena.classList.remove('pbp-updated-flash');
                void arena.offsetWidth; // force reflow
                arena.classList.add('pbp-updated-flash');
            }
        }

        // Cache the updated data
        autoCacheTab('matches', fresh);

    } catch (_) {
        // Silently ignore — network hiccups shouldn't disrupt the UI
    }
}


// ═══════════════════════════════════════════════════════════
// 7. SCORE BREAKDOWN
// ═══════════════════════════════════════════════════════════

/** Enable or disable the Breakdown tab based on the loaded event year. */
function updateBreakdownTabState() {
    const bdBtn = document.querySelector('.tab[data-tab="breakdown"]');
    if (!bdBtn) return;
    if (currentEventYear && currentEventYear < 2025) {
        bdBtn.classList.add('disabled');
        bdBtn.title = isFTCMode()
            ? 'Score breakdown is only available for the 2025-2026 DECODE season and later'
            : 'Score breakdown is only available for 2025 events onwards';
    } else {
        bdBtn.classList.remove('disabled');
        bdBtn.title = '';
    }
}

async function loadBreakdownTab() {
    if (!currentEvent) return;
    hideInlineError('bd-error');
    try {
        setLoadingStatus('bd-loading-status', 'Loading score data\u2026');
        // Reuse the same all-matches data as PBP (or fetch if needed)
        if (!pbpData) {
            const data = await getActiveAPI().allMatches(currentEvent);
            pbpData = data;
        }
        bdData = pbpData;
        bdIndex = _pendingBdIndex != null ? _pendingBdIndex : 0;
        _pendingBdIndex = null;
        bdCache = {};
        hideSkeleton('bd-loading');
        if (!bdData?.matches?.length) {
            hide('bd-container');
            const el = $('bd-empty');
            if (el) {
                el.textContent = currentEventStatus === 'upcoming'
                    ? 'The match schedule for this event has not been published yet.'
                    : 'No match data available for this event.';
                el.classList.remove('hidden');
            }
            return;
        }
        hide('bd-empty');
        show('bd-container');
        buildBdSelector();
        loadBdMatch();
        startBdListRefresh();
        fadeIn('bd-container');
        updateTabDots();
    } catch (err) {
        hideSkeleton('bd-loading');
        showInlineError('bd-error', `Failed to load breakdowns: ${err.message}`, loadBreakdownTab);
    }
}

// ── Periodic match-list refresh (updates has_breakdown flags) ──
function startBdListRefresh() {
    stopBdListRefresh();
    // Realtime handles live updates — no setInterval needed.
}
function stopBdListRefresh() {
    if (bdListTimer) { clearInterval(bdListTimer); bdListTimer = null; }
}
async function refreshBdList() {
    if (!currentEvent) return;
    try {
        const fresh = await getActiveAPI().allMatches(currentEvent);
        // Merge updated has_breakdown flags into existing data
        if (fresh && fresh.matches && bdData && bdData.matches) {
            const keyMap = {};
            fresh.matches.forEach(m => { keyMap[m.key] = m; });
            let changed = false;
            bdData.matches.forEach(m => {
                const fm = keyMap[m.key];
                if (fm && fm.has_breakdown && !m.has_breakdown) {
                    m.has_breakdown = true;
                    changed = true;
                }
            });
            if (changed) buildBdSelector();
        }
    } catch (_) { /* silent */ }
}

function buildBdSelector() {
    const sel = $('bd-match-select');
    sel.innerHTML = bdData.matches.map((m, i) => {
        const hasBd = m.has_breakdown;
        return `<option value="${i}" ${hasBd ? 'class="has-breakdown" style="color:#22c55e"' : ''}>${hasBd ? '● ' : '○ '}${(m.label || '').replace(/^Qualification\s*/i, 'Qual ')}</option>`;
    }).join('');
    sel.value = bdIndex;
}

function bdGoTo(idx) {
    bdIndex = parseInt(idx, 10);
    loadBdMatch();
}

function bdPrev() {
    if (bdIndex > 0) {
        bdIndex--;
        $('bd-match-select').value = bdIndex;
        loadBdMatch();
    }
}

function bdNext() {
    if (bdData && bdIndex < bdData.matches.length - 1) {
        bdIndex++;
        $('bd-match-select').value = bdIndex;
        loadBdMatch();
    }
}

async function loadBdMatch() {
    if (!bdData || !bdData.matches.length) return;
    stopBdPolling();
    closeSpotlight();  // clear spotlight when switching matches
    const m = bdData.matches[bdIndex];
    $('bd-match-label').textContent = (m.label || '').replace(/^Qualification\s*/i, 'Qual ');
    $('bd-match-select').value = bdIndex;

    // Sync URL with current breakdown match key
    if (m.key) {
        const shortKey = m.key.replace(currentEvent + '_', '');
        _syncUrl({ match: shortKey });
    }

    // Use client-side cache if available (instant render, no API call)
    if (bdCache[m.key] && bdCache[m.key].available) {
        renderBreakdown(bdCache[m.key]);
        return;
    }

    // Fetch from API
    $('bd-status').innerHTML = '<span style="color:var(--text-muted)">Loading breakdown…</span>';
    $('bd-content').innerHTML = '';

    try {
        const data = await getActiveAPI().matchBreakdown(m.key);
        if (data.available) {
            m.has_breakdown = true;   // update local flag
            bdCache[m.key] = data;
            autoCacheTab('breakdowns', bdCache);
            renderBreakdown(data);
            stopBdPolling();
            return;
        }
    } catch (_) { /* will fall through to pending state */ }

    // Breakdown not available yet — show waiting state and start polling
    $('bd-status').innerHTML = '<span class="bd-unavailable">⏳ Waiting for score breakdown… <span class="bd-poll-dot"></span></span>';
    $('bd-content').innerHTML = '';
    startBdPolling();
}

// ── Breakdown auto-polling ────────────────────────────────
function startBdPolling() {
    stopBdPolling();
    // Mark that we're waiting for a breakdown (Realtime match handler will trigger pollBdMatch)
    bdPollTimer = true;  // sentinel — indicates we're waiting for breakdown
}

function stopBdPolling() {
    bdPollTimer = null;
}

async function pollBdMatch() {
    if (!bdData || !bdData.matches.length) return;
    const m = bdData.matches[bdIndex];
    try {
        const data = await getActiveAPI().matchBreakdown(m.key);
        if (data.available) {
            m.has_breakdown = true;
            bdCache[m.key] = data;
            autoCacheTab('breakdowns', bdCache);
            stopBdPolling();
            renderBreakdown(data);
            // Flash the status briefly to signal live update
            const statusEl = $('bd-status');
            statusEl.innerHTML = '<span class="bd-available">✓ Score breakdown available - just posted!</span>';
            setTimeout(() => {
                if (statusEl.querySelector('.bd-available'))
                    statusEl.innerHTML = '<span class="bd-available">✓ Score breakdown available</span>';
            }, 4000);
            buildBdSelector(); // update ● / ○ indicators
        }
    } catch (_) { /* keep polling */ }
}

function renderBreakdown(data) {
    $('bd-status').innerHTML = `<span class="bd-available">✓ Score breakdown available</span>`;

    // Build team_number -> nickname map and stats map from bdData match teams
    const nickMap = {};
    const statsMap = {};
    if (bdData && bdData.matches && bdData.matches[bdIndex]) {
        const m = bdData.matches[bdIndex];
        for (const side of ['red', 'blue']) {
            if (m[side] && m[side].teams) {
                m[side].teams.forEach(t => {
                    if (t.nickname) nickMap[t.team_number] = t.nickname;
                    statsMap[t.team_number] = { opr: t.opr, epa: t.epa };
                });
            }
        }
    }

    const redWon = data.winning_alliance === 'red';
    const blueWon = data.winning_alliance === 'blue';

    // Extract alliance numbers and playoff flag from PBP match data
    const m = (bdData && bdData.matches) ? bdData.matches[bdIndex] : null;
    const redAllianceNum = m && m.red ? m.red.alliance_number : null;
    const blueAllianceNum = m && m.blue ? m.blue.alliance_number : null;
    const isPlayoff = m && m.comp_level && m.comp_level !== 'qm';

    let renderFn;
    if (data.program === 'FTC') {
        renderFn = renderBdAllianceFTC;
    } else if (data.game_year >= 2026) {
        renderFn = renderBdAlliance2026;
    } else {
        renderFn = renderBdAlliance;
    }

    $('bd-content').innerHTML = `
        ${renderFn(data.red, 'red', redWon, nickMap, statsMap, redAllianceNum, isPlayoff)}
        ${renderFn(data.blue, 'blue', blueWon, nickMap, statsMap, blueAllianceNum, isPlayoff)}
    `;
}

function renderBdAlliance(alliance, color, won, nickMap, statsMap, allianceNum, isPlayoff) {
    const bd = alliance.breakdown;
    const sideCls = color === 'red' ? 'red-side' : 'blue-side';
    const title = allianceNum ? `Alliance #${allianceNum}` : (color === 'red' ? 'Red Alliance' : 'Blue Alliance');
    const displayScore = alliance.score != null && alliance.score >= 0 ? alliance.score : '–';

    const headerContent = color === 'blue'
        ? `<div class="bd-alliance-score-group">
                <span class="bd-alliance-score">${displayScore}</span>
                ${won ? '<span class="bd-winner-label">WINNER</span>' : ''}
            </div>
            <span>${title}</span>`
        : `<span>${title}</span>
            <div class="bd-alliance-score-group">
                ${won ? '<span class="bd-winner-label">WINNER</span>' : ''}
                <span class="bd-alliance-score">${displayScore}</span>
            </div>`;

    return `
    <div class="bd-alliance ${sideCls}">
        <div class="bd-alliance-header">
            ${headerContent}
        </div>

        <!-- Per-robot: Auto Leave + Barge -->
        <div class="bd-section">
            <div class="bd-section-title">Per-Team Performance</div>
            <div class="bd-robots">
                ${bd.robots.map(r => renderBdRobot(r, nickMap, statsMap, color)).join('')}
            </div>
        </div>

        <!-- Autonomous -->
        <div class="bd-section">
            <div class="bd-section-title">Autonomous (${bd.autoPoints} pts)</div>
            <div class="bd-stats">
                <div class="bd-stat-row">
                    <span class="bd-stat-label">Mobility Points</span>
                    <span class="bd-stat-value">${bd.autoMobilityPoints}</span>
                </div>
                <div class="bd-stat-row">
                    <span class="bd-stat-label">Coral Scored</span>
                    <span class="bd-stat-value">${bd.autoCoralCount}</span>
                </div>
                <div class="bd-stat-row">
                    <span class="bd-stat-label">Coral Points</span>
                    <span class="bd-stat-value">${bd.autoCoralPoints}</span>
                </div>
            </div>
            ${renderReefGrid(bd.autoReef, bd.teleopReef, true)}
        </div>

        <!-- Teleop -->
        <div class="bd-section">
            <div class="bd-section-title">Teleop (${bd.teleopPoints} pts)</div>
            <div class="bd-stats">
                <div class="bd-stat-row">
                    <span class="bd-stat-label">Coral Scored</span>
                    <span class="bd-stat-value">${bd.teleopCoralCount}</span>
                </div>
                <div class="bd-stat-row">
                    <span class="bd-stat-label">Coral Points</span>
                    <span class="bd-stat-value">${bd.teleopCoralPoints}</span>
                </div>
            </div>
            ${renderReefGrid(bd.teleopReef, bd.autoReef, false)}
        </div>

        <!-- Algae -->
        <div class="bd-section">
            <div class="bd-section-title">Algae (${bd.algaePoints} pts)</div>
            <div class="bd-stats">
                <div class="bd-stat-row">
                    <span class="bd-stat-label">Net Algae</span>
                    <span class="bd-stat-value">${bd.netAlgaeCount}</span>
                </div>
                <div class="bd-stat-row">
                    <span class="bd-stat-label">Wall Algae</span>
                    <span class="bd-stat-value">${bd.wallAlgaeCount}</span>
                </div>
            </div>
        </div>

        <!-- Barge -->
        <div class="bd-section">
            <div class="bd-section-title">Barge (${bd.endGameBargePoints} pts)</div>
            <div class="bd-stats">
                <div class="bd-stat-row">
                    <span class="bd-stat-label">Barge Points</span>
                    <span class="bd-stat-value">${bd.endGameBargePoints}</span>
                </div>
            </div>
        </div>

        <!-- Fouls -->
        <div class="bd-section">
            <div class="bd-section-title">Fouls & Penalties</div>
            <div class="bd-fouls">
                <div class="bd-foul-item">
                    <span class="bd-foul-label">Fouls:</span>
                    <span class="bd-foul-value">${bd.foulCount}</span>
                </div>
                <div class="bd-foul-item">
                    <span class="bd-foul-label">Tech Fouls:</span>
                    <span class="bd-foul-value">${bd.techFoulCount}</span>
                </div>
                <div class="bd-foul-item">
                    <span class="bd-foul-label">Foul Pts:</span>
                    <span class="bd-foul-value">${bd.foulPoints}</span>
                </div>
            </div>
            ${bd.g206Penalty || bd.g410Penalty || bd.g418Penalty || bd.g428Penalty ? `
                <div class="bd-bonuses" style="margin-top:.3rem">
                    ${bd.g206Penalty ? '<span class="bd-bonus-badge" style="border-color:rgba(239,68,68,.4);color:#ef4444">G206</span>' : ''}
                    ${bd.g410Penalty ? '<span class="bd-bonus-badge" style="border-color:rgba(239,68,68,.4);color:#ef4444">G410</span>' : ''}
                    ${bd.g418Penalty ? '<span class="bd-bonus-badge" style="border-color:rgba(239,68,68,.4);color:#ef4444">G418</span>' : ''}
                    ${bd.g428Penalty ? '<span class="bd-bonus-badge" style="border-color:rgba(239,68,68,.4);color:#ef4444">G428</span>' : ''}
                </div>
            ` : ''}
        </div>

        <!-- Bonuses / RP -->
        <div class="bd-section">
            <div class="bd-section-title">${isPlayoff ? 'Bonuses' : 'Bonuses & Ranking Points'}</div>
            <div class="bd-bonuses">
                <span class="bd-bonus-badge ${bd.autoBonusAchieved ? 'achieved' : ''}">Auto Bonus</span>
                <span class="bd-bonus-badge ${bd.coralBonusAchieved ? 'achieved' : ''}">Coral Bonus</span>
                <span class="bd-bonus-badge ${bd.bargeBonusAchieved ? 'achieved' : ''}">Barge Bonus</span>
                <span class="bd-bonus-badge ${bd.coopertitionCriteriaMet ? 'achieved' : ''}">Coopertition</span>
            </div>
            ${!isPlayoff ? `<div class="bd-stats" style="margin-top:.4rem">
                <div class="bd-stat-row">
                    <span class="bd-stat-label">Ranking Points</span>
                    <span class="bd-stat-value">${bd.rp}</span>
                </div>
                <div class="bd-stat-row">
                    <span class="bd-stat-label">Adjust Points</span>
                    <span class="bd-stat-value">${bd.adjustPoints || 0}</span>
                </div>
            </div>` : `<div class="bd-stats" style="margin-top:.4rem">
                <div class="bd-stat-row">
                    <span class="bd-stat-label">Adjust Points</span>
                    <span class="bd-stat-value">${bd.adjustPoints || 0}</span>
                </div>
            </div>`}
        </div>

        <!-- Total -->
        <div class="bd-total-bar">
            <span class="bd-total-label">Total</span>
            <span class="bd-total-score">${bd.totalPoints}</span>
        </div>
    </div>`;
}

function renderBdRobot(robot, nickMap, statsMap, color) {
    const leaveVal = robot.autoLine === 'Yes' ? 'Yes' : 'No';
    const leaveCls = robot.autoLine === 'Yes' ? 'yes' : 'no';

    const endGameMap = {
        'DeepCage': { label: 'Deep Cage', cls: 'deep' },
        'ShallowCage': { label: 'Shallow Cage', cls: 'shallow' },
        'Parked': { label: 'Parked', cls: 'parked' },
        'None': { label: '–', cls: 'no' },
    };
    const eg = endGameMap[robot.endGame] || { label: robot.endGame, cls: '' };
    const num = robot.team_number || '?';
    const nick = (nickMap && nickMap[num]) || '';
    const tooltipHtml = nick ? `<span class="custom-tooltip">${nick}</span>` : '';
    const ndTeam = teamsData?.find(td => td.team_number == num);
    const numHtml = ndTeam ? _renderTeamNum(ndTeam) : num;
    const st = (statsMap && statsMap[num]) || {};
    const oprStr = st.opr != null ? st.opr : '–';
    const epaStr = st.epa != null ? st.epa : '–';

    return `
    <div class="bd-robot-card bd-robot-card-clickable" data-team="${num}" data-color="${color}" onclick="toggleSpotlight(${num}, '${color}')">
        <div class="bd-robot-num has-tooltip">${numHtml}${tooltipHtml}</div>
        <div class="bd-micro-tags-slot">${_renderBdTags(num)}</div>
        <div class="bd-robot-fields">
            <div class="bd-robot-field">
                <span class="bd-robot-label">Leave</span>
                <span class="bd-robot-value ${leaveCls}">${leaveVal}</span>
            </div>
            <div class="bd-robot-field">
                <span class="bd-robot-label">Barge</span>
                <span class="bd-robot-value ${eg.cls}">${eg.label}</span>
            </div>
        </div>
    </div>`;
}

function renderReefGrid(reef, otherPhaseReef, isAuto) {
    const nodes = ['A','B','C','D','E','F','G','H','I','J','K','L'];
    const levels = [
        { key: 'topRow', label: 'L4 (Top)' },
        { key: 'midRow', label: 'L3 (Mid)' },
        { key: 'botRow', label: 'L2 (Bot)' },
    ];

    let html = '<div class="bd-reef">';
    html += `<div class="bd-reef-title">Reef Grid</div>`;
    html += '<div class="bd-reef-grid">';

    // Header row with node labels
    for (const n of nodes) {
        html += `<div class="bd-reef-cell" style="border:none;background:transparent;font-weight:700;color:var(--text-muted)">${n}</div>`;
    }

    for (const level of levels) {
        const row = reef[level.key] || {};
        const otherRow = otherPhaseReef ? (otherPhaseReef[level.key] || {}) : {};
        for (const n of nodes) {
            const nodeKey = `node${n}`;
            const filled = row[nodeKey] === true;
            // For teleop view, show auto-scored nodes differently
            const autoFilled = !isAuto && otherRow[nodeKey] === true;
            let cls = '';
            if (filled && isAuto) cls = 'filled-auto';
            else if (filled && !isAuto) cls = autoFilled ? 'filled-auto' : 'filled';
            else if (autoFilled && !isAuto) cls = 'filled-auto';
            html += `<div class="bd-reef-cell ${cls}" title="${n} ${level.label}${filled ? ' ●' : ''}">${filled || autoFilled ? '●' : ''}</div>`;
        }
    }

    html += '</div>';

    // Trough
    html += `<div class="bd-trough">
        <span class="bd-trough-label">Trough:</span>
        <span class="bd-trough-value">${reef.trough || 0}</span>
    </div>`;

    html += '</div>';
    return html;
}


// ═══════════════════════════════════════════════════════════
//  FTC DECODE — BREAKDOWN RENDERER
// ═══════════════════════════════════════════════════════════

function renderBdAllianceFTC(alliance, color, won, nickMap, statsMap, allianceNum, isPlayoff) {
    const bd = alliance.breakdown;
    if (!bd) return '<div class="bd-alliance">No breakdown data</div>';

    const sideCls = color === 'red' ? 'red-side' : 'blue-side';
    const title = allianceNum ? `Alliance #${allianceNum}` : (color === 'red' ? 'Red Alliance' : 'Blue Alliance');
    const displayScore = alliance.score != null && alliance.score >= 0 ? alliance.score : '–';

    const headerContent = color === 'blue'
        ? `<div class="bd-alliance-score-group">
                <span class="bd-alliance-score">${displayScore}</span>
                ${won ? '<span class="bd-winner-label">WINNER</span>' : ''}
            </div>
            <span>${title}</span>`
        : `<span>${title}</span>
            <div class="bd-alliance-score-group">
                ${won ? '<span class="bd-winner-label">WINNER</span>' : ''}
                <span class="bd-alliance-score">${displayScore}</span>
            </div>`;

    // Get match teams from bdData for robot → team mapping
    const m = (bdData && bdData.matches) ? bdData.matches[bdIndex] : null;
    const sideTeams = m && m[color] && m[color].teams ? m[color].teams : [];

    return `
    <div class="bd-alliance ${sideCls}">
        <div class="bd-alliance-header">
            ${headerContent}
        </div>

        <!-- Per-robot: Auto Leave + Endgame -->
        <div class="bd-section">
            <div class="bd-section-title">Per-Robot Performance</div>
            <div class="bd-robots">
                ${(bd.robots || []).map((r, i) => renderBdRobotFTC(r, sideTeams[i], nickMap, statsMap, color)).join('')}
            </div>
        </div>

        <!-- Autonomous -->
        <div class="bd-section">
            <div class="bd-section-title">Autonomous (${bd.autoPoints} pts)</div>
            <div class="bd-stats">
                <div class="bd-stat-row">
                    <span class="bd-stat-label">Leave Points</span>
                    <span class="bd-stat-value">${bd.autoLeavePoints}</span>
                </div>
                <div class="bd-stat-row">
                    <span class="bd-stat-label">Artifacts Classified</span>
                    <span class="bd-stat-value">${bd.autoClassifiedArtifacts}</span>
                </div>
                <div class="bd-stat-row">
                    <span class="bd-stat-label">Overflow Artifacts</span>
                    <span class="bd-stat-value">${bd.autoOverflowArtifacts}</span>
                </div>
                <div class="bd-stat-row">
                    <span class="bd-stat-label">Artifact Points</span>
                    <span class="bd-stat-value">${bd.autoArtifactPoints}</span>
                </div>
                <div class="bd-stat-row">
                    <span class="bd-stat-label">Pattern Points</span>
                    <span class="bd-stat-value">${bd.autoPatternPoints}</span>
                </div>
            </div>
            ${renderClassifierGrid(bd.autoClassifierState, 'Auto Classifier')}
        </div>

        <!-- Driver-Controlled (Teleop) -->
        <div class="bd-section">
            <div class="bd-section-title">Driver-Controlled (${bd.teleopPoints} pts)</div>
            <div class="bd-stats">
                <div class="bd-stat-row">
                    <span class="bd-stat-label">Artifacts Classified</span>
                    <span class="bd-stat-value">${bd.teleopClassifiedArtifacts}</span>
                </div>
                <div class="bd-stat-row">
                    <span class="bd-stat-label">Overflow Artifacts</span>
                    <span class="bd-stat-value">${bd.teleopOverflowArtifacts}</span>
                </div>
                <div class="bd-stat-row">
                    <span class="bd-stat-label">Depot Artifacts</span>
                    <span class="bd-stat-value">${bd.teleopDepotArtifacts}</span>
                </div>
                <div class="bd-stat-row">
                    <span class="bd-stat-label">Artifact Points</span>
                    <span class="bd-stat-value">${bd.teleopArtifactPoints}</span>
                </div>
                <div class="bd-stat-row">
                    <span class="bd-stat-label">Depot Points</span>
                    <span class="bd-stat-value">${bd.teleopDepotPoints}</span>
                </div>
                <div class="bd-stat-row">
                    <span class="bd-stat-label">Base Points</span>
                    <span class="bd-stat-value">${bd.teleopBasePoints}</span>
                </div>
                <div class="bd-stat-row">
                    <span class="bd-stat-label">Pattern Points</span>
                    <span class="bd-stat-value">${bd.teleopPatternPoints}</span>
                </div>
            </div>
            ${renderClassifierGrid(bd.teleopClassifierState, 'Teleop Classifier')}
        </div>

        <!-- Fouls -->
        <div class="bd-section">
            <div class="bd-section-title">Fouls & Penalties</div>
            <div class="bd-fouls">
                <div class="bd-foul-item">
                    <span class="bd-foul-label">Minor:</span>
                    <span class="bd-foul-value">${bd.minorFouls}</span>
                </div>
                <div class="bd-foul-item">
                    <span class="bd-foul-label">Major:</span>
                    <span class="bd-foul-value">${bd.majorFouls}</span>
                </div>
                <div class="bd-foul-item">
                    <span class="bd-foul-label">Foul Pts Committed:</span>
                    <span class="bd-foul-value">${bd.foulPointsCommitted}</span>
                </div>
            </div>
        </div>

        <!-- Ranking Points -->
        <div class="bd-section">
            <div class="bd-section-title">${isPlayoff ? 'Bonuses' : 'Ranking Points'}</div>
            <div class="bd-bonuses">
                <span class="bd-bonus-badge ${bd.movementRP ? 'achieved' : ''}">🏃 Movement</span>
                <span class="bd-bonus-badge ${bd.goalRP ? 'achieved' : ''}">🎯 Goal</span>
                <span class="bd-bonus-badge ${bd.patternRP ? 'achieved' : ''}">🧩 Pattern</span>
            </div>
        </div>

        <!-- Total -->
        <div class="bd-total-bar">
            <span class="bd-total-label">Total</span>
            <span class="bd-total-score">${bd.totalPoints}</span>
        </div>
    </div>`;
}

function renderBdRobotFTC(robot, teamObj, nickMap, statsMap, color) {
    const leaveCls = robot.auto_leave ? 'yes' : 'no';
    const leaveVal = robot.auto_leave ? 'Yes' : 'No';

    const endMap = {
        'None': { label: '–', cls: 'no' },
        'Partial Ascent': { label: 'Partial', cls: 'parked' },
        'Full Ascent': { label: 'Full', cls: 'deep' },
    };
    const eg = endMap[robot.endgame] || { label: robot.endgame || '–', cls: '' };

    // Try to get team number from the match data
    const num = teamObj ? teamObj.team_number : `R${robot.robot_number}`;
    const nick = teamObj ? teamObj.nickname : (nickMap && nickMap[num]) || '';
    const tooltipHtml = nick ? `<span class="custom-tooltip">${nick}</span>` : '';
    const st = teamObj || (statsMap && statsMap[num]) || {};
    const oprStr = st.opr != null ? st.opr : '–';

    return `
    <div class="bd-robot-card" data-team="${num}" data-color="${color}">
        <div class="bd-robot-num has-tooltip">${num}${tooltipHtml}</div>
        <div class="bd-micro-tags-slot">${_renderBdTags(num)}</div>
        <div class="bd-robot-fields">
            <div class="bd-robot-field">
                <span class="bd-robot-label">Auto Leave</span>
                <span class="bd-robot-value ${leaveCls}">${leaveVal}</span>
            </div>
            <div class="bd-robot-field">
                <span class="bd-robot-label">Endgame</span>
                <span class="bd-robot-value ${eg.cls}">${eg.label}</span>
            </div>
        </div>
    </div>`;
}

function renderClassifierGrid(state, title) {
    if (!state || !state.length) return '';
    const colorMap = {
        'NONE':   { cls: '',           label: '–' },
        'GREEN':  { cls: 'cls-green',  label: '●' },
        'PURPLE': { cls: 'cls-purple', label: '●' },
        'YELLOW': { cls: 'cls-yellow', label: '●' },
    };
    return `
    <div class="bd-classifier">
        <div class="bd-classifier-title">${title}</div>
        <div class="bd-classifier-grid">
            ${state.map((s, i) => {
                const c = colorMap[s] || colorMap['NONE'];
                return `<div class="bd-classifier-cell ${c.cls}" title="Slot ${i + 1}: ${s}">${c.label}</div>`;
            }).join('')}
        </div>
    </div>`;
}


// ═══════════════════════════════════════════════════════════
//  2026 GAME — BREAKDOWN RENDERER
// ═══════════════════════════════════════════════════════════

function renderBdAlliance2026(alliance, color, won, nickMap, statsMap, allianceNum, isPlayoff) {
    const bd = alliance.breakdown;
    const sideCls = color === 'red' ? 'red-side' : 'blue-side';
    const title = allianceNum ? `Alliance #${allianceNum}` : (color === 'red' ? 'Red Alliance' : 'Blue Alliance');
    const displayScore = alliance.score != null && alliance.score >= 0 ? alliance.score : '–';

    const headerContent = color === 'blue'
        ? `<div class="bd-alliance-score-group">
                <span class="bd-alliance-score">${displayScore}</span>
                ${won ? '<span class="bd-winner-label">WINNER</span>' : ''}
            </div>
            <span>${title}</span>`
        : `<span>${title}</span>
            <div class="bd-alliance-score-group">
                ${won ? '<span class="bd-winner-label">WINNER</span>' : ''}
                <span class="bd-alliance-score">${displayScore}</span>
            </div>`;

    // Build fuel shift phases for the timeline
    const phases = [
        { label: 'Auto',       count: bd.autoFuelCount },
        { label: 'Transition', count: bd.transitionFuelCount },
        { label: 'Shift 1',    count: bd.shift1FuelCount },
        { label: 'Shift 2',    count: bd.shift2FuelCount },
        { label: 'Shift 3',    count: bd.shift3FuelCount },
        { label: 'Shift 4',    count: bd.shift4FuelCount },
        { label: 'Endgame',    count: bd.endgameFuelCount },
    ];
    const maxPhase = Math.max(...phases.map(p => p.count), 1);

    const penaltyStr = bd.penalties && bd.penalties !== 'None' ? bd.penalties : '';

    return `
    <div class="bd-alliance ${sideCls}">
        <div class="bd-alliance-header">
            ${headerContent}
        </div>

        <!-- Per-robot: Auto Tower + Endgame Tower -->
        <div class="bd-section">
            <div class="bd-section-title">Per-Team Performance</div>
            <div class="bd-robots">
                ${bd.robots.map(r => renderBdRobot2026(r, nickMap, statsMap, color)).join('')}
            </div>
        </div>

        <!-- Autonomous -->
        <div class="bd-section">
            <div class="bd-section-title">Autonomous (${bd.totalAutoPoints} pts)</div>
            <div class="bd-stats">
                <div class="bd-stat-row">
                    <span class="bd-stat-label">Tower Points</span>
                    <span class="bd-stat-value">${bd.autoTowerPoints}</span>
                </div>
                <div class="bd-stat-row">
                    <span class="bd-stat-label">Fuel Scored</span>
                    <span class="bd-stat-value">${bd.autoFuelCount}</span>
                </div>
            </div>
        </div>

        <!-- Fuel Timeline -->
        <div class="bd-section">
            <div class="bd-section-title">Fuel by Phase</div>
            <div class="bd-fuel-timeline">
                ${phases.map(p => {
                    const pct = Math.round((p.count / maxPhase) * 100);
                    const active = p.count > 0;
                    return `<div class="bd-fuel-phase ${active ? 'active' : ''}">
                        <div class="bd-fuel-bar-track">
                            <div class="bd-fuel-bar-fill" style="height:${pct}%"></div>
                        </div>
                        <span class="bd-fuel-count">${p.count}</span>
                        <span class="bd-fuel-label">${p.label}</span>
                    </div>`;
                }).join('')}
            </div>
            <div class="bd-fuel-totals">
                <span>Total Fuel <strong>${bd.totalFuelCount}</strong></span>
                ${(bd.uncountedFuel || 0) > 0 ? `<span class="bd-fuel-uncounted">Uncounted <strong>${bd.uncountedFuel}</strong></span>` : ''}
            </div>
        </div>

        <!-- Tower -->
        <div class="bd-section">
            <div class="bd-section-title">Tower (${bd.totalTowerPoints} pts)</div>
            <div class="bd-stats">
                <div class="bd-stat-row">
                    <span class="bd-stat-label">Auto Tower</span>
                    <span class="bd-stat-value">${bd.autoTowerPoints}</span>
                </div>
                <div class="bd-stat-row">
                    <span class="bd-stat-label">Endgame Tower</span>
                    <span class="bd-stat-value">${bd.endGameTowerPoints}</span>
                </div>
            </div>
        </div>

        <!-- Fouls -->
        <div class="bd-section">
            <div class="bd-section-title">Fouls & Penalties</div>
            <div class="bd-fouls">
                <div class="bd-foul-item">
                    <span class="bd-foul-label">Minor:</span>
                    <span class="bd-foul-value">${bd.minorFoulCount}</span>
                </div>
                <div class="bd-foul-item">
                    <span class="bd-foul-label">Major:</span>
                    <span class="bd-foul-value">${bd.majorFoulCount}</span>
                </div>
                <div class="bd-foul-item">
                    <span class="bd-foul-label">Foul Pts:</span>
                    <span class="bd-foul-value">+${bd.foulPoints}</span>
                </div>
            </div>
            ${bd.g206Penalty || penaltyStr ? `
                <div class="bd-bonuses" style="margin-top:.3rem">
                    ${bd.g206Penalty ? '<span class="bd-bonus-badge" style="border-color:rgba(239,68,68,.4);color:#ef4444">G206</span>' : ''}
                    ${penaltyStr ? `<span class="bd-bonus-badge" style="border-color:rgba(239,68,68,.4);color:#ef4444">${penaltyStr}</span>` : ''}
                </div>
            ` : ''}
        </div>

        <!-- RP Progress -->
        ${!isPlayoff ? `<div class="bd-section">
            <div class="bd-section-title">Ranking Points</div>
            <div class="bd-bonuses">
                <span class="bd-bonus-badge ${bd.energizedAchieved ? 'achieved' : ''}">⚡ Energized</span>
                <span class="bd-bonus-badge ${bd.superchargedAchieved ? 'achieved' : ''}">🔋 Supercharged</span>
                <span class="bd-bonus-badge ${bd.traversalAchieved ? 'achieved' : ''}">🗼 Traversal</span>
            </div>
            ${renderRpProgress(bd)}
            <div class="bd-stats" style="margin-top:.4rem">
                <div class="bd-stat-row">
                    <span class="bd-stat-label">Ranking Points</span>
                    <span class="bd-stat-value">${bd.rp}</span>
                </div>
                <div class="bd-stat-row">
                    <span class="bd-stat-label">Adjust Points</span>
                    <span class="bd-stat-value">${bd.adjustPoints || 0}</span>
                </div>
            </div>
        </div>` : `<div class="bd-section">
            <div class="bd-section-title">Bonuses</div>
            <div class="bd-bonuses">
                <span class="bd-bonus-badge ${bd.energizedAchieved ? 'achieved' : ''}">⚡ Energized</span>
                <span class="bd-bonus-badge ${bd.superchargedAchieved ? 'achieved' : ''}">🔋 Supercharged</span>
                <span class="bd-bonus-badge ${bd.traversalAchieved ? 'achieved' : ''}">🗼 Traversal</span>
            </div>
            <div class="bd-stats" style="margin-top:.4rem">
                <div class="bd-stat-row">
                    <span class="bd-stat-label">Adjust Points</span>
                    <span class="bd-stat-value">${bd.adjustPoints || 0}</span>
                </div>
            </div>
        </div>`}

        <!-- Total -->
        <div class="bd-total-bar">
            <span class="bd-total-label">Total</span>
            <span class="bd-total-score">${bd.totalPoints}</span>
        </div>
    </div>`;
}

function renderBdRobot2026(robot, nickMap, statsMap, color) {
    const autoVal = robot.autoTower || 'None';
    const autoCls = autoVal === 'Leave' ? 'yes' : 'no';
    const autoLabel = autoVal === 'None' ? '–' : autoVal;

    const endVal = robot.endGameTower || 'None';
    const endMap = {
        'None':   { label: '–',       cls: 'no' },
        'Park':   { label: 'Park',   cls: 'parked' },
        'Shallow':{ label: 'Shallow', cls: 'shallow' },
        'Deep':   { label: 'Deep',   cls: 'deep' },
    };
    const eg = endMap[endVal] || { label: endVal, cls: '' };

    const num = robot.team_number || '?';
    const nick = (nickMap && nickMap[num]) || '';
    const tooltipHtml = nick ? `<span class="custom-tooltip">${nick}</span>` : '';
    const st = (statsMap && statsMap[num]) || {};
    const oprStr = st.opr != null ? st.opr : '–';
    const epaStr = st.epa != null ? st.epa : '–';

    return `
    <div class="bd-robot-card bd-robot-card-clickable" data-team="${num}" data-color="${color}" onclick="toggleSpotlight(${num}, '${color}')">
        <div class="bd-robot-num has-tooltip">${num}${tooltipHtml}</div>
        <div class="bd-micro-tags-slot">${_renderBdTags(num)}</div>
        <div class="bd-robot-fields">
            <div class="bd-robot-field">
                <span class="bd-robot-label">Auto Tower</span>
                <span class="bd-robot-value ${autoCls}">${autoLabel}</span>
            </div>
            <div class="bd-robot-field">
                <span class="bd-robot-label">Endgame</span>
                <span class="bd-robot-value ${eg.cls}">${eg.label}</span>
            </div>
        </div>
    </div>`;
}

function renderRpProgress(bd) {
    const bars = [
        { label: 'Energized',    current: bd.totalPoints, threshold: 100, achieved: bd.energizedAchieved },
        { label: 'Supercharged', current: bd.totalPoints, threshold: 360, achieved: bd.superchargedAchieved },
        { label: 'Traversal',    current: bd.totalTowerPoints, threshold: 50, achieved: bd.traversalAchieved },
    ];

    return `<div class="bd-rp-progress">
        ${bars.map(b => {
            const pct = Math.min(100, (b.current / b.threshold) * 100);
            const cls = b.achieved ? 'rp-bar-achieved' : '';
            return `
            <div class="rp-progress-row">
                <span class="rp-progress-label">${b.label}</span>
                <div class="rp-progress-track">
                    <div class="rp-progress-fill ${cls}" style="width:${pct.toFixed(1)}%"></div>
                </div>
                <span class="rp-progress-text">${b.current} / ${b.threshold}</span>
            </div>`;
        }).join('')}
    </div>`;
}


// ═══════════════════════════════════════════════════════════
//  TEAM SPOTLIGHT — Focus on a single team in breakdown
// ═══════════════════════════════════════════════════════════

let _spotlightTeam = null;  // currently spotlighted team number

function toggleSpotlight(teamNum, color) {
    const panel = $('bd-spotlight');
    if (!panel) return;

    if (_spotlightTeam === teamNum) { closeSpotlight(); return; }
    _spotlightTeam = teamNum;

    const m = bdData && bdData.matches ? bdData.matches[bdIndex] : null;
    const bd = bdCache[m?.key];
    if (!bd) return;

    const alliance = bd[color];
    if (!alliance) return;
    const abdwn = alliance.breakdown;
    const robot = abdwn.robots.find(r => r.team_number === teamNum);
    if (!robot) return;

    // Nickname + stats
    const nickMap = {};
    const statsMap = {};
    if (m) {
        for (const side of ['red', 'blue']) {
            if (m[side] && m[side].teams)
                m[side].teams.forEach(t => {
                    if (t.nickname) nickMap[t.team_number] = t.nickname;
                    statsMap[t.team_number] = { opr: t.opr, epa: t.epa };
                });
        }
    }
    const nick = nickMap[teamNum] || '';
    const st = statsMap[teamNum] || {};
    const oprStr = st.opr != null ? st.opr : '–';
    const epaStr = st.epa != null ? st.epa : '–';

    const colorLabel = color === 'red' ? 'Red Alliance' : 'Blue Alliance';

    const spotStorylineBtn = _storylineAvailable && competitionMode === 'frc'
        ? `<button class="spotlight-storyline-btn" onclick="event.stopPropagation(); generateTeamStoryline(${teamNum})" title="Generate AI storyline for this team">✨ Storyline</button>`
        : '';

    // Show loading state with header immediately
    panel.innerHTML = `
        <div class="spotlight-card spotlight-${color}">
            <div class="spotlight-header">
                <div class="spotlight-team-info">
                    <span class="spotlight-team-num">${teamNum}</span>
                    ${nick ? `<span class="spotlight-team-nick">${nick}</span>` : ''}
                    <span class="spotlight-alliance-badge spotlight-badge-${color}">${colorLabel}</span>
                    <span class="spotlight-stat-pill">OPR ${oprStr}</span>
                    <span class="spotlight-stat-pill">EPA ${epaStr}</span>
                    ${spotStorylineBtn}
                </div>
                <button class="spotlight-close" onclick="closeSpotlight()" title="Close Spotlight">&times;</button>
            </div>
            <div id="spotlight-storyline"></div>
            <div class="spotlight-loading">Loading individual performance…</div>
        </div>`;

    panel.classList.remove('hidden');

    // Highlight/dim robot cards
    document.querySelectorAll('.bd-robot-card').forEach(card => {
        const cardTeam = parseInt(card.dataset.team);
        if (cardTeam === teamNum) {
            card.classList.add('bd-spotlight-active');
            card.classList.remove('bd-spotlight-dimmed');
        } else {
            card.classList.remove('bd-spotlight-active');
            card.classList.add('bd-spotlight-dimmed');
        }
    });

    // Determine the current match identification for highlighting
    const currentMatchNum = m?.match_number || 0;
    const currentCompLevel = m?.comp_level || 'qm';
    const frcLevel = currentCompLevel === 'qm' ? 'Qualification' : 'Playoff';

    // Fetch individual performance data from Events API
    const eventKey = currentEvent;
    if (!eventKey) return;

    const _perfApi = isFTCMode() ? null : API;
    if (!_perfApi) {
        // FTC: show fallback with just the current-match robot data
        _renderSpotlightFallback(panel, robot, bd.game_year, color, nick, teamNum, colorLabel);
        return;
    }
    _perfApi.teamPerf(eventKey, teamNum).then(perf => {
        if (_spotlightTeam !== teamNum) return;  // user closed or switched

        _renderSpotlightContent(panel, perf, robot, bd.game_year, color, nick, teamNum, colorLabel, frcLevel, currentMatchNum, oprStr, epaStr);
    }).catch(err => {
        if (_spotlightTeam !== teamNum) return;
        // Fallback: show just the current-match per-robot data
        _renderSpotlightFallback(panel, robot, bd.game_year, color, nick, teamNum, colorLabel);
    });
}

function _towerBadge(val) {
    const cls = {
        'None': 'tower-none', 'Level1': 'tower-level1',
        'Level2': 'tower-level2', 'Level3': 'tower-level3',
    }[val] || 'tower-none';
    const label = {
        'None': '–', 'Level1': 'L1', 'Level2': 'L2', 'Level3': 'L3',
    }[val] || val;
    return `<span class="tower-badge ${cls}">${label}</span>`;
}

function _renderSpotlightContent(panel, perf, robot, gameYear, color, nick, teamNum, colorLabel, frcLevel, currentMatchNum, oprStr, epaStr) {
    let html = '';

    if (gameYear >= 2026) {
        // ── Current match individual data ──
        const autoTower = robot.autoTower || 'None';
        const endTower = robot.endGameTower || 'None';

        html += `
            <div class="spotlight-section">
                <div class="spotlight-section-title">This Match · Individual</div>
                <div class="spotlight-featured">
                    <div class="spotlight-feat-cell">
                        ${_towerBadge(autoTower)}
                        <span class="spotlight-feat-lbl">Auto Tower</span>
                    </div>
                    <div class="spotlight-feat-cell">
                        ${_towerBadge(endTower)}
                        <span class="spotlight-feat-lbl">Endgame Tower</span>
                    </div>
                </div>
            </div>`;

        // ── Aggregate performance across event ──
        if (perf.matches_played > 0) {
            const rec = perf.record;
            const winPct = perf.matches_played > 0 ? Math.round((rec.wins / perf.matches_played) * 100) : 0;

            html += `
            <div class="spotlight-section">
                <div class="spotlight-section-title">Event Performance · ${perf.matches_played} Matches</div>
                <div class="spotlight-stats-grid">
                    <div class="spotlight-stat-cell">
                        <span class="spotlight-stat-val">${rec.wins}-${rec.losses}${rec.ties ? `-${rec.ties}` : ''}</span>
                        <span class="spotlight-stat-lbl">Record</span>
                    </div>
                    <div class="spotlight-stat-cell">
                        <span class="spotlight-stat-val">${winPct}%</span>
                        <span class="spotlight-stat-lbl">Win Rate</span>
                    </div>
                    <div class="spotlight-stat-cell">
                        <span class="spotlight-stat-val">${perf.avg_alliance_score}</span>
                        <span class="spotlight-stat-lbl">Avg Alliance Pts</span>
                    </div>
                </div>
                <div style="margin-top: .4rem;">
                    <div class="spotlight-tower-dist">
                        ${(() => {
                            const ad = perf.autoTower.distribution || {};
                            const atot = perf.autoTower.total || 1;
                            const aL1 = ad['1'] || 0;
                            return `
                            <span class="spotlight-tower-label">Auto</span>
                            <div class="spotlight-tower-levels">
                                <span class="tower-level-chip tower-level1">L1 <b>${aL1}</b> / ${perf.autoTower.total}</span>
                            </div>`;
                        })()}
                    </div>
                    <div class="spotlight-tower-dist">
                        ${(() => {
                            const d = perf.endGameTower.distribution || {};
                            const l1 = d['1'] || 0;
                            const l2 = d['2'] || 0;
                            const l3 = d['3'] || 0;
                            const tot = perf.endGameTower.total;
                            return `
                            <span class="spotlight-tower-label">Endgame</span>
                            <div class="spotlight-tower-levels">
                                <span class="tower-level-chip tower-level1">L1 <b>${l1}</b> / ${tot}</span>
                                <span class="tower-level-chip tower-level2">L2 <b>${l2}</b> / ${tot}</span>
                                <span class="tower-level-chip tower-level3">L3 <b>${l3}</b> / ${tot}</span>
                            </div>`;
                        })()}
                    </div>
                </div>
            </div>`;
        }

        // ── Match-by-match history (collapsible) ──
        if (perf.matches && perf.matches.length > 0) {
            let rows = '';
            for (const pm of perf.matches) {
                const isCurrent = pm.matchLevel === frcLevel && pm.matchNumber === currentMatchNum;
                const rowCls = isCurrent ? 'current-match' : '';
                const desc = (pm.description || '').replace(/Qualification\s*/gi, 'Qual ');
                const score = pm.allianceScore != null ? `<span class="mh-score-bold">${pm.allianceScore}</span>-${pm.opponentScore}` : '–';
                rows += `<tr class="${rowCls}">
                    <td>${desc}</td>
                    <td><span class="result-badge result-${pm.result}">${pm.result}</span></td>
                    <td>${score}</td>
                    <td>${_towerBadge(pm.autoTower)}</td>
                    <td>${_towerBadge(pm.endGameTower)}</td>
                </tr>`;
            }

            html += `
            <div class="spotlight-section spotlight-collapsible collapsed">
                <button type="button" class="spotlight-collapse-btn" onclick="const p=this.parentElement;p.classList.toggle('collapsed');const c=this.querySelector('.spot-chevron');if(c)c.classList.toggle('spot-chevron-up');this.querySelector('.spot-btn-text').textContent=p.classList.contains('collapsed')?'View Match History (${perf.matches.length})':'Hide Match History'">
                    <svg class="spot-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                    <span class="spot-btn-text">View Match History (${perf.matches.length})</span>
                </button>
                <div class="spotlight-collapse-body">
                    <table class="spotlight-matches-table">
                        <thead><tr>
                            <th>Match</th><th></th><th>Score</th><th>Auto</th><th>End</th>
                        </tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>`;
        }
    } else {
        // 2025 REEFSCAPE
        const leave = robot.autoLine === 'Yes' ? 'Yes' : 'No';
        const leaveCls = robot.autoLine === 'Yes' ? 'yes' : 'no';
        const endGameMap = {
            'DeepCage': { label: 'Deep Cage', cls: 'deep' },
            'ShallowCage': { label: 'Shallow Cage', cls: 'shallow' },
            'Parked': { label: 'Parked', cls: 'parked' },
            'None': { label: '–', cls: 'no' },
        };
        const eg = endGameMap[robot.endGame] || { label: robot.endGame, cls: '' };

        html += `
            <div class="spotlight-section">
                <div class="spotlight-section-title">This Match · Individual</div>
                <div class="spotlight-featured">
                    <div class="spotlight-feat-cell">
                        <span class="spotlight-feat-val bd-robot-value ${leaveCls}">${leave}</span>
                        <span class="spotlight-feat-lbl">Auto Leave</span>
                    </div>
                    <div class="spotlight-feat-cell">
                        <span class="spotlight-feat-val bd-robot-value ${eg.cls}">${eg.label}</span>
                        <span class="spotlight-feat-lbl">Endgame</span>
                    </div>
                </div>
            </div>`;

        // Event performance if we have it
        if (perf.matches_played > 0) {
            const rec = perf.record;
            const winPct = Math.round((rec.wins / perf.matches_played) * 100);
            html += `
            <div class="spotlight-section">
                <div class="spotlight-section-title">Event Performance · ${perf.matches_played} Matches</div>
                <div class="spotlight-stats-grid">
                    <div class="spotlight-stat-cell">
                        <span class="spotlight-stat-val">${rec.wins}-${rec.losses}${rec.ties ? `-${rec.ties}` : ''}</span>
                        <span class="spotlight-stat-lbl">Record</span>
                    </div>
                    <div class="spotlight-stat-cell">
                        <span class="spotlight-stat-val">${winPct}%</span>
                        <span class="spotlight-stat-lbl">Win Rate</span>
                    </div>
                    <div class="spotlight-stat-cell">
                        <span class="spotlight-stat-val">${perf.avg_alliance_score}</span>
                        <span class="spotlight-stat-lbl">Avg Alliance Pts</span>
                    </div>
                </div>
            </div>`;
        }
    }

    // Re-render the card with real data
    const spotStoryBtn = _storylineAvailable && competitionMode === 'frc'
        ? `<button class="spotlight-storyline-btn" onclick="event.stopPropagation(); generateTeamStoryline(${teamNum})" title="Generate AI storyline for this team">✨ Storyline</button>`
        : '';
    panel.innerHTML = `
        <div class="spotlight-card spotlight-${color}">
            <div class="spotlight-header">
                <div class="spotlight-team-info">
                    <span class="spotlight-team-num">${teamNum}</span>
                    ${nick ? `<span class="spotlight-team-nick">${nick}</span>` : ''}
                    <span class="spotlight-alliance-badge spotlight-badge-${color}">${colorLabel}</span>
                    ${oprStr ? `<span class="spotlight-stat-pill">OPR ${oprStr}</span>` : ''}
                    ${epaStr ? `<span class="spotlight-stat-pill">EPA ${epaStr}</span>` : ''}
                    ${spotStoryBtn}
                </div>
                <button class="spotlight-close" onclick="closeSpotlight()" title="Close Spotlight">&times;</button>
            </div>
            <div id="spotlight-storyline"></div>
            ${html}
        </div>`;
}

function _renderSpotlightFallback(panel, robot, gameYear, color, nick, teamNum, colorLabel) {
    let html = '';

    if (gameYear >= 2026) {
        const autoTower = robot.autoTower || 'None';
        const endTower = robot.endGameTower || 'None';

        html = `
            <div class="spotlight-section">
                <div class="spotlight-section-title">This Match · Individual</div>
                <div class="spotlight-featured">
                    <div class="spotlight-feat-cell">
                        ${_towerBadge(autoTower)}
                        <span class="spotlight-feat-lbl">Auto Tower</span>
                    </div>
                    <div class="spotlight-feat-cell">
                        ${_towerBadge(endTower)}
                        <span class="spotlight-feat-lbl">Endgame Tower</span>
                    </div>
                </div>
            </div>
            <div class="spotlight-section" style="text-align:center; padding:.6rem;">
                <span style="font-size:.7rem; color:var(--text-muted);">FRC Events API unavailable - showing current match only</span>
            </div>`;
    } else {
        const leave = robot.autoLine === 'Yes' ? 'Yes' : 'No';
        const leaveCls = robot.autoLine === 'Yes' ? 'yes' : 'no';
        const endGameMap = {
            'DeepCage': { label: 'Deep Cage', cls: 'deep' },
            'ShallowCage': { label: 'Shallow Cage', cls: 'shallow' },
            'Parked': { label: 'Parked', cls: 'parked' },
            'None': { label: '–', cls: 'no' },
        };
        const eg = endGameMap[robot.endGame] || { label: robot.endGame, cls: '' };

        html = `
            <div class="spotlight-section">
                <div class="spotlight-section-title">This Match · Individual</div>
                <div class="spotlight-featured">
                    <div class="spotlight-feat-cell">
                        <span class="spotlight-feat-val bd-robot-value ${leaveCls}">${leave}</span>
                        <span class="spotlight-feat-lbl">Auto Leave</span>
                    </div>
                    <div class="spotlight-feat-cell">
                        <span class="spotlight-feat-val bd-robot-value ${eg.cls}">${eg.label}</span>
                        <span class="spotlight-feat-lbl">Endgame</span>
                    </div>
                </div>
            </div>`;
    }

    const spotStoryBtnFb = _storylineAvailable && competitionMode === 'frc'
        ? `<button class="spotlight-storyline-btn" onclick="event.stopPropagation(); generateTeamStoryline(${teamNum})" title="Generate AI storyline for this team">✨ Storyline</button>`
        : '';
    panel.innerHTML = `
        <div class="spotlight-card spotlight-${color}">
            <div class="spotlight-header">
                <div class="spotlight-team-info">
                    <span class="spotlight-team-num">${teamNum}</span>
                    ${nick ? `<span class="spotlight-team-nick">${nick}</span>` : ''}
                    <span class="spotlight-alliance-badge spotlight-badge-${color}">${colorLabel}</span>
                    ${spotStoryBtnFb}
                </div>
                <button class="spotlight-close" onclick="closeSpotlight()" title="Close Spotlight">&times;</button>
            </div>
            <div id="spotlight-storyline"></div>
            ${html}
        </div>`;
}

function closeSpotlight() {
    _spotlightTeam = null;
    const panel = $('bd-spotlight');
    if (panel) { panel.classList.add('hidden'); panel.innerHTML = ''; }
    document.querySelectorAll('.bd-robot-card').forEach(card => {
        card.classList.remove('bd-spotlight-active', 'bd-spotlight-dimmed');
    });
}


// ═══════════════════════════════════════════════════════════
// 8. TEAM COMPARISON
// ═══════════════════════════════════════════════════════════

let compareSelection = new Set();  // team_keys selected from rankings table


// ── Open / Close ───────────────────────────────────────────
function openCompare() {
    show('compare-overlay');
    document.body.style.overflow = 'hidden';
}

function closeCompare() {
    hide('compare-overlay');
    document.body.style.overflow = '';
    // Clear compare from URL
    const params = new URLSearchParams(location.search);
    if (params.has('compare')) {
        params.delete('compare');
        const qs = params.toString();
        history.replaceState(null, '', `${location.pathname}${qs ? '?' + qs : ''}${location.hash}`);
    }
}

// Close on Escape or Q
document.addEventListener('keydown', e => {
    const isEsc = e.key === 'Escape';
    const isQ = (e.key === 'q' || e.key === 'Q') && !e.ctrlKey && !e.metaKey && !e.altKey;
    // Q should not fire when the user is typing in an input/textarea/select
    const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    const dismiss = isEsc || (isQ && !inInput);
    if (!dismiss) return;

    if (compareSelection.size > 0) {
        // Also close the lookup overlay if it's open (from ranking selection)
        if (!$('lookup-overlay')?.classList.contains('hidden')) {
            closeLookup();
        }
        clearCompareSelection();
        return;
    }
    if (_spotlightTeam != null) {
        closeSpotlight();
        return;
    }
    // Close floating lookup panel if open
    if (!$('float-lookup')?.classList.contains('hidden')) {
        closeFloatingLookup();
        return;
    }
    if (!$('match-history-overlay')?.classList.contains('hidden')) {
        closeMatchHistory();
        return;
    }
    if (!$('lookup-overlay')?.classList.contains('hidden')) {
        closeLookup();
        return;
    }
    if (!$('compare-overlay')?.classList.contains('hidden')) {
        closeCompare();
        return;
    }
});

// ── Auto-compare from PBP match ────────────────────────────
let _pendingBdIndex = null;  // set by goToBreakdownFromPbp before tab click

function goToBreakdownFromPbp() {
    if (!pbpData || !pbpData.matches.length) return;
    // Save desired index before the tab handler potentially resets bdIndex
    _pendingBdIndex = pbpIndex;
    bdIndex = pbpIndex;
    // Navigate to breakdown tab
    const tabBtn = document.querySelector('.tab[data-tab="breakdown"]');
    if (tabBtn) tabBtn.click();
}

async function compareCurrentMatch() {
    if (!pbpData || !pbpData.matches.length || !currentEvent) return;
    const m = pbpData.matches[pbpIndex];
    const redKeys = m.red.teams.map(t => t.team_key);
    const blueKeys = m.blue.teams.map(t => t.team_key);
    const allKeys = [...redKeys, ...blueKeys];

    const isMob = window.innerWidth <= 768;
    if (isMob) {
        openMobUtilPanel('compare');
        const body = document.getElementById('mob-util-body');
        if (body) body.innerHTML = '<div id="compare-body" class="mob-compare-body"><p class="loading-msg">Loading\u2026</p></div>';
    } else {
        openCompare();
        $('compare-body').innerHTML = '<p class="loading-msg">Fetching comparison data\u2026</p>';
        $('compare-title').textContent = `Match Comparison: ${m.label}`;
    }

    try {
        if (isFTCMode()) throw new Error('use-fallback');
        const data = await API.compareTeams(currentEvent, allKeys);
        renderComparison(data, { redKeys, blueKeys, matchLabel: m.label });
    } catch {
        // Fallback: build comparison data from PBP team objects
        const fallbackTeams = allKeys.map(tk => {
            const t = [...m.red.teams, ...m.blue.teams].find(x => x.team_key === tk) || {};
            return {
                team_key: tk,
                team_number: t.team_number || parseInt(tk.replace('frc', '')),
                nickname: t.nickname || '',
                city: t.city || '',
                state_prov: t.state_prov || '',
                country: t.country || '',
                rank: t.rank || '-',
                wins: t.wins || 0,
                losses: t.losses || 0,
                ties: t.ties || 0,
                opr: t.opr || 0,
                epa: t.epa ?? null,
                avg_rp: t.avg_rp || 0,
                qual_average: t.qual_average || 0,
                high_score: t.high_score || 0,
                matches_played: 0,
            };
        });
        renderComparison(
            { event_key: currentEvent, teams: fallbackTeams },
            { redKeys, blueKeys, matchLabel: m.label }
        );
    }
}

// ── Compare from rankings selection ────────────────────────

// Clicking anywhere on a rankings row toggles comparison selection
document.addEventListener('click', (e) => {
    const tr = e.target.closest('.data-table tbody tr');
    if (!tr) return;
    // Don't double-fire on the checkbox itself
    if (e.target.closest('.compare-cb')) return;
    const cb = tr.querySelector('.compare-cb');
    if (cb) {
        toggleCompareTeam(cb.dataset.team);
    }
});

function toggleCompareTeam(teamKey) {
    if (compareSelection.has(teamKey)) {
        compareSelection.delete(teamKey);
    } else {
        if (compareSelection.size >= 6) return;  // max 6
        compareSelection.add(teamKey);
    }
    updateCompareBar();
    updateCompareCheckboxes();
}

function updateCompareBar() {
    const n = compareSelection.size;
    if (n > 0) {
        show('compare-bar');
        $('compare-bar-count').textContent = `${n} team${n > 1 ? 's' : ''} selected`;
        // Show Lookup and Match History buttons only when exactly 1 team is selected
        const lkBtn = $('compare-bar-lookup');
        if (lkBtn) { n === 1 ? show('compare-bar-lookup') : hide('compare-bar-lookup'); }
        const mhBtn = $('compare-bar-match-history');
        if (mhBtn) { n === 1 ? show('compare-bar-match-history') : hide('compare-bar-match-history'); }
        // Edit Details: show when exactly 1 team selected and user is authenticated
        const edBtn = $('compare-bar-edit');
        if (edBtn) { (n === 1 && !window.isGuest) ? show('compare-bar-edit') : hide('compare-bar-edit'); }
        // Compare: show when 2+ teams selected
        const cmpBtn = $('compare-bar-compare');
        if (cmpBtn) { n >= 2 ? show('compare-bar-compare') : hide('compare-bar-compare'); }
    } else {
        hide('compare-bar');
    }
}

function updateCompareCheckboxes() {
    document.querySelectorAll('.compare-cb').forEach(cb => {
        cb.checked = compareSelection.has(cb.dataset.team);
    });
}

function clearCompareSelection() {
    compareSelection.clear();
    updateCompareBar();
    updateCompareCheckboxes();
}

async function launchCompareFromSelection() {
    if (compareSelection.size < 2 || !currentEvent) return;
    const keys = [...compareSelection];
    await showComparison(keys, {});
}

// ── Team lookup from rankings selection ────────────────────
function openLookup() {
    show('lookup-overlay');
    document.body.style.overflow = 'hidden';
}

function closeLookup() {
    hide('lookup-overlay');
    document.body.style.overflow = '';
}

async function launchLookupFromSelection() {
    if (compareSelection.size !== 1) return;
    const teamKey = [...compareSelection][0];
    const num = parseInt(teamKey.replace(/^(frc|ftc)/, ''), 10);
    if (!num) return;

    openLookup();
    $('lookup-title').textContent = `Team Lookup · ${num}`;
    $('lookup-body').innerHTML = '<p class="loading-msg">Loading team data\u2026</p>';

    try {
        if (isFTCMode()) {
            const data = await _buildFtcTeamLookup(num, currentEventYear);
            $('lookup-body').innerHTML = renderFtcTeamStats(data);
            FTC_API.teamOprHistory(num, currentEventYear).then(h => renderFtcOprChart(h)).catch(() => {});
        } else {
            const data = await API.teamStats(num, null);
            $('lookup-body').innerHTML = renderTeamStats(data);
        }
    } catch (err) {
        $('lookup-body').innerHTML = `<p class="empty">Error: ${err.message}</p>`;
    }
}

// ── Keyboard shortcuts on Rankings tab ─────────────────────
document.addEventListener('keydown', e => {
    // Skip if user is typing in an input / textarea / select
    if (e.target.matches('input, textarea, select')) return;
    // Only active on the Rankings tab
    if (!$('tab-rankings')?.classList.contains('active')) return;

    if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey) {
        // Toggle: close if already open
        if (!$('compare-overlay')?.classList.contains('hidden')) {
            e.preventDefault();
            closeCompare();
            return;
        }
        // Skip if lookup overlay is open or no teams selected
        if (!$('lookup-overlay')?.classList.contains('hidden')) return;
        if (compareSelection.size === 0) return;
        e.preventDefault();
        launchCompareFromSelection();
    }
    if ((e.key === 'l' || e.key === 'L') && !e.ctrlKey && !e.metaKey) {
        if (compareSelection.size === 1) {
            e.preventDefault();
            launchLookupFromSelection();
        }
    }
    if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey) {
        // Toggle: close if already open
        if (!$('match-history-overlay')?.classList.contains('hidden')) {
            e.preventDefault();
            closeMatchHistory();
            return;
        }
        if (compareSelection.size === 1) {
            e.preventDefault();
            launchMatchHistoryFromSelection();
        }
    }
    if ((e.key === 'e' || e.key === 'E') && !e.ctrlKey && !e.metaKey) {
        // Toggle: close if already open
        if (!$('editor-overlay')?.classList.contains('hidden')) {
            e.preventDefault();
            closeEditor();
            return;
        }
        if (compareSelection.size === 1 && !window.isGuest) {
            e.preventDefault();
            launchEditorFromSelection();
        }
    }
});

// ═══════════════════════════════════════════════════════════
// MATCH HISTORY FROM RANKINGS
// ═══════════════════════════════════════════════════════════

function openMatchHistory() {
    if (window.innerWidth <= 768) return; // mobile uses mob-util-panel
    show('match-history-overlay');
    document.body.style.overflow = 'hidden';
}

function closeMatchHistory() {
    hide('match-history-overlay');
    document.body.style.overflow = '';
}

async function launchMatchHistoryFromSelection() {
    if (compareSelection.size !== 1 || !currentEvent) return;
    const teamKey = [...compareSelection][0];
    const num = parseInt(teamKey.replace(/^(frc|ftc)/, ''), 10);
    if (!num) return;

    const teamInfo = teamsData?.find(t => t.team_key === teamKey);
    const nick = teamInfo ? formatTeamName(teamInfo.nickname) : '';
    _launchMatchHistoryShared(num, nick);
}

async function _launchMatchHistoryShared(num, nick) {
    if (window.innerWidth <= 768) {
        openMobUtilPanel('matchhistory');
        const body = document.getElementById('mob-util-body');
        if (body) body.innerHTML = '<div class="mob-util-lookup-empty">Loading\u2026</div>';
        try {
            let perf;
            if (typeof isFTCMode === 'function' && isFTCMode()) {
                perf = typeof _buildFtcTeamPerf === 'function' ? _buildFtcTeamPerf(num) : null;
            } else {
                perf = await API.teamPerf(currentEvent, num);
            }
            if (body) {
                body.innerHTML = '';
                _renderMobMatchHistory(body, perf, num, nick);
            }
        } catch (err) {
            if (body) body.innerHTML = '<div class="mob-util-lookup-empty">' + err.message + '</div>';
        }
        return;
    }

    openMatchHistory();
    $('match-history-title').textContent = `Match History · ${num}${nick ? ` — ${nick}` : ''}`;
    $('match-history-body').innerHTML = '<p class="loading-msg">Loading match history…</p>';

    try {
        if (isFTCMode()) {
            const perf = _buildFtcTeamPerf(num);
            renderMatchHistoryPanel(perf, num, nick);
        } else {
            const perf = await API.teamPerf(currentEvent, num);
            renderMatchHistoryPanel(perf, num, nick);
        }
    } catch (err) {
        $('match-history-body').innerHTML = `<p class="empty">Error: ${err.message}</p>`;
    }
}

function _buildFtcTeamPerf(teamNum) {
    const matches = (pbpData && pbpData.matches) || [];
    const teamMatches = matches.filter(m => {
        const redTeams = (m.red && m.red.teams) || [];
        const blueTeams = (m.blue && m.blue.teams) || [];
        return redTeams.some(t => t.team_number === teamNum) || blueTeams.some(t => t.team_number === teamNum);
    });
    let wins = 0, losses = 0, ties = 0, totalScore = 0;
    const matchList = teamMatches.map(m => {
        const redTeams = (m.red && m.red.teams) || [];
        const blueTeams = (m.blue && m.blue.teams) || [];
        const onRed = redTeams.some(t => t.team_number === teamNum);
        const myAlliance = onRed ? redTeams : blueTeams;
        const oppAlliance = onRed ? blueTeams : redTeams;
        const myScore = onRed ? ((m.red && m.red.score) || 0) : ((m.blue && m.blue.score) || 0);
        const oppScore = onRed ? ((m.blue && m.blue.score) || 0) : ((m.red && m.red.score) || 0);
        const result = myScore > oppScore ? 'W' : myScore < oppScore ? 'L' : 'T';
        if (result === 'W') wins++; else if (result === 'L') losses++; else ties++;
        totalScore += myScore;
        const desc = (m.label || m.match_key || '').replace(/Qualification\s*/gi, 'Qual ');
        return {
            label: m.label || m.match_key || '',
            description: desc,
            allianceScore: myScore,
            opponentScore: oppScore,
            allianceColor: onRed ? 'Red' : 'Blue',
            allianceTeams: myAlliance.filter(t => t.team_number !== teamNum).map(t => t.team_number),
            opponentTeams: oppAlliance.map(t => t.team_number),
            alliance_score: myScore,
            opponent_score: oppScore,
            result: result,
            comp_level: m.comp_level || 'qm',
        };
    });
    return {
        team_number: teamNum,
        record: { wins, losses, ties },
        matches_played: teamMatches.length,
        avg_alliance_score: teamMatches.length > 0 ? Math.round(totalScore / teamMatches.length) : 0,
        matches: matchList,
    };
}

function renderMatchHistoryPanel(perf, teamNum, nick) {
    const body = $('match-history-body');
    if (!perf || perf.matches_played === 0) {
        body.innerHTML = '<p class="empty">No matches played yet.</p>';
        return;
    }

    const rec = perf.record;
    const winPct = perf.matches_played > 0 ? Math.round((rec.wins / perf.matches_played) * 100) : 0;

    // Summary stats
    let html = `
        <div class="mh-summary">
            <div class="mh-stat">
                <span class="mh-stat-val">${rec.wins}-${rec.losses}${rec.ties ? `-${rec.ties}` : ''}</span>
                <span class="mh-stat-lbl">Record</span>
            </div>
            <div class="mh-stat">
                <span class="mh-stat-val">${winPct}%</span>
                <span class="mh-stat-lbl">Win Rate</span>
            </div>
            <div class="mh-stat">
                <span class="mh-stat-val">${perf.matches_played}</span>
                <span class="mh-stat-lbl">Matches</span>
            </div>
            <div class="mh-stat">
                <span class="mh-stat-val">${perf.avg_alliance_score}</span>
                <span class="mh-stat-lbl">Avg Alliance Pts</span>
            </div>
        </div>`;

    // Tower distribution (2026+)
    if (perf.autoTower && perf.endGameTower) {
        const ad = perf.autoTower.distribution || {};
        const ed = perf.endGameTower.distribution || {};
        html += `
        <div class="mh-towers">
            <div class="mh-tower-row">
                <span class="mh-tower-label">Auto Tower</span>
                <div class="mh-tower-chips">
                    ${ad['1'] ? `<span class="tower-level-chip tower-level1">L1 <b>${ad['1']}</b></span>` : ''}
                    ${ad['2'] ? `<span class="tower-level-chip tower-level2">L2 <b>${ad['2']}</b></span>` : ''}
                    ${ad['3'] ? `<span class="tower-level-chip tower-level3">L3 <b>${ad['3']}</b></span>` : ''}
                    ${!ad['1'] && !ad['2'] && !ad['3'] ? '<span class="mh-none">–</span>' : ''}
                </div>
            </div>
            <div class="mh-tower-row">
                <span class="mh-tower-label">Endgame Tower</span>
                <div class="mh-tower-chips">
                    ${ed['1'] ? `<span class="tower-level-chip tower-level1">L1 <b>${ed['1']}</b></span>` : ''}
                    ${ed['2'] ? `<span class="tower-level-chip tower-level2">L2 <b>${ed['2']}</b></span>` : ''}
                    ${ed['3'] ? `<span class="tower-level-chip tower-level3">L3 <b>${ed['3']}</b></span>` : ''}
                    ${!ed['1'] && !ed['2'] && !ed['3'] ? '<span class="mh-none">–</span>' : ''}
                </div>
            </div>
        </div>`;
    }

    // Build a nickname lookup from teamsData for hover tooltips
    const nickLookup = {};
    if (teamsData) {
        for (const t of teamsData) {
            nickLookup[t.team_number] = formatTeamName(t.nickname) || '';
        }
    }

    // Match-by-match table
    if (perf.matches && perf.matches.length > 0) {
        let rows = '';
        for (const pm of perf.matches) {
            const desc = (pm.description || '').replace(/Qualification\s*/gi, 'Qual ');
            const score = pm.allianceScore != null ? `<span class="mh-score-bold">${pm.allianceScore}</span>-${pm.opponentScore}` : '–';
            const colorCls = pm.allianceColor === 'Red' ? 'mh-color-red' : 'mh-color-blue';
            const allyCls = pm.allianceColor === 'Red' ? 'mh-ally-red' : 'mh-ally-blue';
            const oppCls = pm.allianceColor === 'Red' ? 'mh-ally-blue' : 'mh-ally-red';
            const allies = (pm.allianceTeams || []).map(n =>
                `<span class="mh-team-link ${allyCls}" title="${nickLookup[n] || ''}" onclick="lookupTeamFromMatchHistory(${n})">${n}</span>`
            ).join(', ');
            const opps = (pm.opponentTeams || []).map(n =>
                `<span class="mh-team-link ${oppCls}" title="${nickLookup[n] || ''}" onclick="lookupTeamFromMatchHistory(${n})">${n}</span>`
            ).join(', ');
            rows += `<tr>
                <td>${desc}</td>
                <td><span class="mh-alliance-dot ${colorCls}"></span></td>
                <td><span class="result-badge result-${pm.result}">${pm.result}</span></td>
                <td>${score}</td>
                <td class="mh-teams-cell">${allies}</td>
                <td class="mh-teams-cell">${opps}</td>
            </tr>`;
        }

        html += `
        <table class="mh-table">
            <thead><tr>
                <th>Match</th><th></th><th></th><th>Score</th><th>Alliance</th><th>Opponents</th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
    }

    body.innerHTML = html;
}

function lookupTeamFromMatchHistory(teamNum) {
    if (window.innerWidth <= 768) {
        closeMatchHistory();
        openMobUtilPanel('lookup');
        setTimeout(() => {
            const inp = document.getElementById('mob-util-team-num');
            if (inp) { inp.value = teamNum; _mobUtilLookupTeam(); }
        }, 60);
        return;
    }
    closeMatchHistory();
    openLookup();
    $('lookup-title').textContent = `Team Lookup · ${teamNum}`;
    $('lookup-body').innerHTML = '<p class="loading-msg">Loading team data\u2026</p>';
    if (isFTCMode()) {
        _buildFtcTeamLookup(teamNum, currentEventYear).then(data => {
            $('lookup-body').innerHTML = renderFtcTeamStats(data);
            FTC_API.teamOprHistory(teamNum, currentEventYear).then(h => renderFtcOprChart(h)).catch(() => {});
        }).catch(err => {
            $('lookup-body').innerHTML = `<p class="empty">Error: ${err.message}</p>`;
        });
    } else {
        API.teamStats(teamNum, null).then(data => {
            $('lookup-body').innerHTML = renderTeamStats(data);
        }).catch(err => {
            $('lookup-body').innerHTML = `<p class="empty">Error: ${err.message}</p>`;
        });
    }
}

// ═══════════════════════════════════════════════════════════
// FLOATING TEAM LOOKUP PANEL
// ═══════════════════════════════════════════════════════════
let _floatMinimized = false;

function toggleFloatingLookup() {
    if (window.innerWidth <= 768) {
        openMobUtilPanel('lookup');
        return;
    }
    const panel = $('float-lookup');
    if (panel.classList.contains('hidden')) {
        openFloatingLookup();
    } else {
        closeFloatingLookup();
    }
}

function openFloatingLookup() {
    const panel = $('float-lookup');
    panel.classList.remove('hidden', 'float-lookup-minimized');
    _floatMinimized = false;
    $('float-lookup-btn').classList.add('active');
    // Re-trigger the open animation
    panel.style.animation = 'none';
    panel.offsetHeight; // force reflow
    panel.style.animation = '';
    requestAnimationFrame(() => $('float-team-number').focus());
}

function closeFloatingLookup() {
    const panel = $('float-lookup');
    panel.classList.add('hidden');
    panel.classList.remove('float-lookup-minimized');
    _floatMinimized = false;
    $('float-lookup-btn').classList.remove('active');
    _updateFloatTitleBadge('');
}

function minimizeFloatingLookup() {
    const panel = $('float-lookup');
    if (_floatMinimized) {
        panel.classList.remove('float-lookup-minimized');
        _floatMinimized = false;
    } else {
        panel.classList.add('float-lookup-minimized');
        _floatMinimized = true;
    }
}

/** Show/hide a small team number pill in the titlebar (when minimized) */
function _updateFloatTitleBadge(text) {
    let badge = document.querySelector('.float-lookup-title-badge');
    if (!badge) {
        badge = document.createElement('span');
        badge.className = 'float-lookup-title-badge';
        document.querySelector('.float-lookup-title').appendChild(badge);
    }
    badge.textContent = text;
    badge.style.display = text ? '' : 'none';
}

async function floatLookupTeam() {
    const num = parseInt($('float-team-number').value, 10);
    const year = $('float-team-year').value.trim() || null;
    if (!num) return;

    const body = $('float-lookup-body');
    body.innerHTML = '<div class="float-lookup-loading"><span>Loading team data\u2026</span></div>';
    _updateFloatTitleBadge('#' + num);

    try {
        if (isFTCMode()) {
            const data = await _buildFtcTeamLookup(num, year);
            body.innerHTML = renderFtcTeamStats(data);
            FTC_API.teamOprHistory(num, year).then(h => renderFtcOprChart(h)).catch(() => {});
        } else {
            const data = await API.teamStats(num, year);
            body.innerHTML = renderTeamStats(data);
        }
    } catch (err) {
        body.innerHTML = `<div class="float-lookup-empty"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg><p>${err.message}</p></div>`;
        _updateFloatTitleBadge('');
    }
}

/** Open floating lookup pre-filled with a team number (e.g. from PBP click) */
function floatLookupQuick(teamNumber) {
    if (window.innerWidth <= 768) {
        openMobUtilPanel('lookup');
        // Pre-fill and search after panel builds
        setTimeout(() => {
            const inp = document.getElementById('mob-util-team-num');
            if (inp) { inp.value = teamNumber; _mobUtilLookupTeam(); }
        }, 60);
        return;
    }
    openFloatingLookup();
    $('float-team-number').value = teamNumber;
    floatLookupTeam();
}

// ── Dragging ───────────────────────────────────────────────
(function initFloatDrag() {
    let isDragging = false, startX, startY, origX, origY;

    document.addEventListener('mousedown', e => {
        const titlebar = e.target.closest('#float-lookup-titlebar');
        if (!titlebar) return;
        if (e.target.closest('button')) return; // don't drag from buttons
        isDragging = true;
        const panel = $('float-lookup');
        const rect = panel.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        origX = rect.left;
        origY = rect.top;
        panel.style.transition = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
        if (!isDragging) return;
        const panel = $('float-lookup');
        let newX = origX + (e.clientX - startX);
        let newY = origY + (e.clientY - startY);
        // Clamp to viewport
        newX = Math.max(0, Math.min(newX, window.innerWidth - 60));
        newY = Math.max(0, Math.min(newY, window.innerHeight - 40));
        panel.style.left = newX + 'px';
        panel.style.top = newY + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        $('float-lookup').style.transition = '';
    });
})();

// Q key toggles the floating quick lookup panel
// Escape key closes it
document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName;
    const isInput = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';

    // Q toggles the floating lookup even when its own input is focused
    if ((e.key === 'q' || e.key === 'Q') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const panel = $('float-lookup');
        if (!panel.classList.contains('hidden')) {
            e.preventDefault();
            closeFloatingLookup();
            return;
        }
        if (!isInput) {
            e.preventDefault();
            openFloatingLookup();
            return;
        }
    }

    if (isInput) return;

    if (e.key === 'Escape' && !$('float-lookup').classList.contains('hidden')) {
        closeFloatingLookup();
    }
});

// ── Core comparison renderer ───────────────────────────────
async function showComparison(teamKeys, opts = {}) {
    const isMob = window.innerWidth <= 768;
    if (isMob) {
        openMobUtilPanel('compare');
        const body = document.getElementById('mob-util-body');
        if (body) {
            body.innerHTML = '<div id="compare-body" class="mob-compare-body"><p class="loading-msg">Loading\u2026</p></div>';
        }
    } else {
        openCompare();
    }
    const prefix = isFTCMode() ? 'ftc' : 'frc';
    _syncUrl({ compare: teamKeys.map(k => k.replace(prefix,'')).join(',') });
    $('compare-body').innerHTML = '<p class="loading-msg">Fetching comparison data\u2026</p>';
    if (!isMob) {
        $('compare-title').textContent = opts.matchLabel
            ? `Match Comparison: ${opts.matchLabel}`
            : 'Team Comparison';
    }

    try {
        if (isFTCMode()) {
            // FTC: use cached teamsData directly (no dedicated compare endpoint)
            throw new Error('use-fallback');
        }
        const data = await API.compareTeams(currentEvent, teamKeys);
        renderComparison(data, opts);
    } catch (err) {
        // Fallback: use cached teamsData from the rankings table if available
        if (teamsData) {
            const fallbackTeams = teamKeys.map(tk => {
                const t = teamsData.find(x => x.team_key === tk) || {};
                return {
                    team_key: tk,
                    team_number: t.team_number || parseInt(tk.replace(/^(frc|ftc)/, '')),
                    nickname: t.nickname || '',
                    city: t.city || '',
                    state_prov: t.state_prov || '',
                    country: t.country || '',
                    rank: t.rank || '-',
                    wins: t.wins || 0,
                    losses: t.losses || 0,
                    ties: t.ties || 0,
                    opr: t.opr || 0,
                    opr_auto: t.opr_auto ?? null,
                    opr_dc: t.opr_dc ?? null,
                    opr_np: t.opr_np ?? null,
                    epa: t.epa ?? null,
                    avg_rp: t.avg_rp ?? t.rp ?? 0,
                    qual_average: t.qual_average ?? 0,
                    high_score: t.high_score ?? 0,
                    matches_played: t.matches_played ?? 0,
                    avg_total: t.avg_total ?? null,
                    avg_auto: t.avg_auto ?? null,
                    avg_dc: t.avg_dc ?? null,
                    avg_np: t.avg_np ?? null,
                    max_total: t.max_total ?? null,
                    max_auto: t.max_auto ?? null,
                    max_dc: t.max_dc ?? null,
                    min_total: t.min_total ?? null,
                    dev_total: t.dev_total ?? null,
                    quick_stats: t.quick_stats ?? null,
                };
            });
            renderComparison({ event_key: currentEvent, teams: fallbackTeams }, opts);
        } else {
            $('compare-body').innerHTML = `<p class="empty">Error: ${err.message}</p>`;
        }
    }
}

function renderComparison(data, opts) {
    const teams = data.teams;
    const redKeys = new Set(opts.redKeys || []);
    const blueKeys = new Set(opts.blueKeys || []);
    const isMatchMode = redKeys.size > 0;

    const ftcMode = isFTCMode();
    const stats = ftcMode ? [
        { key: 'rank',         label: 'Rank',        fmt: v => v === '-' ? '\u2013' : `#${v}`, lower: true },
        { key: 'opr',          label: 'OPR',         fmt: v => v.toFixed(1) },
        { key: 'avg_total',    label: 'Avg Score',    fmt: v => v != null ? v.toFixed(1) : '\u2013' },
        { key: 'max_total',    label: 'High Score',   fmt: v => v != null ? Math.round(v) : '\u2013' },
        { key: 'min_total',    label: 'Low Score',    fmt: v => v != null ? Math.round(v) : '\u2013', lower: true },
        { key: 'dev_total',    label: 'Consistency',  fmt: v => v != null ? `\u00b1${v.toFixed(1)}` : '\u2013', lower: true },
    ] : [
        { key: 'rank',         label: 'Rank',       fmt: v => v === '-' ? '\u2013' : `#${v}`, lower: true },
        { key: 'opr',          label: 'OPR',        fmt: v => v.toFixed(2) },
        { key: 'epa',          label: 'EPA',        fmt: v => v != null ? v.toFixed(2) : '\u2013' },
        { key: 'qual_average', label: 'Avg Score',   fmt: v => v.toFixed(1) },
        { key: 'high_score',   label: 'High Score',  fmt: v => v },
        { key: 'avg_rp',       label: 'Avg RP',      fmt: v => v.toFixed(2) },
    ];

    // Compute max absolute values for bar widths
    const maxVals = {};
    stats.forEach(s => {
        const vals = teams.map(t => {
            const v = t[s.key];
            return typeof v === 'number' ? Math.abs(v) : 0;
        });
        maxVals[s.key] = Math.max(...vals, 0.01);
    });

    const isH2H = teams.length === 2;

    // Compute event-average OPR for delta indicator
    let avgEventOpr = 0;
    if (teamsData && teamsData.length) {
        const ov = teamsData.map(x => parseFloat(x.opr)).filter(v => !isNaN(v));
        avgEventOpr = ov.length ? ov.reduce((a, b) => a + b, 0) / ov.length : 0;
    }

    // Header
    let html = '<div class="compare-grid" style="--cols:' + (teams.length + (isH2H ? 1 : 0)) + '">';

    // Team header row
    html += '<div class="comp-label comp-corner"></div>';
    teams.forEach(t => {
        let sideCls = '';
        if (redKeys.has(t.team_key)) sideCls = 'comp-red';
        else if (blueKeys.has(t.team_key)) sideCls = 'comp-blue';
        const ov = _timsCache[t.team_number];
        const nick = ov?.nickname || t.nickname;
        const loc = [t.state_prov, t.country].filter(Boolean).join(', ');

        html += `
        <div class="comp-header ${sideCls}">
            <div class="comp-team-num">${t.team_number}</div>
            <div class="comp-team-name">${formatTeamName(nick)}</div>
            <div class="comp-team-record">${t.wins}-${t.losses}-${t.ties}</div>
            ${loc ? `<div class="comp-team-loc">${loc}</div>` : ''}
        </div>`;
    });
    if (isH2H) html += '<div class="comp-header comp-delta-header">Δ</div>';

    // Stat rows
    stats.forEach(s => {
        const vals = teams.map(t => {
            const v = t[s.key];
            return typeof v === 'number' ? v : 0;
        });
        const best = s.lower
            ? Math.min(...vals.filter(v => v > 0 || s.key === 'losses'))
            : Math.max(...vals);

        html += `<div class="comp-label">${s.label}</div>`;
        teams.forEach((t, i) => {
            const raw = t[s.key];
            const v = typeof raw === 'number' ? raw : 0;
            const isNull = raw == null || raw === '-' || raw === '–';
            const display = isNull ? '–' : s.fmt(raw);
            const isBest = teams.length > 1 && !isNull && v === best && (v !== 0 || s.key === 'losses');
            const pct = (!isNull && maxVals[s.key] > 0) ? Math.round((Math.abs(v) / maxVals[s.key]) * 100) : 0;

            let sideCls = '';
            if (redKeys.has(t.team_key)) sideCls = 'comp-red';
            else if (blueKeys.has(t.team_key)) sideCls = 'comp-blue';

            html += `
            <div class="comp-cell ${sideCls} ${isBest ? 'comp-best' : ''}">
                <div class="comp-bar-bg">
                    <div class="comp-bar" style="width:${pct}%"></div>
                </div>
                <span class="comp-val">${display}</span>
            </div>`;
        });
        // Delta column for H2H mode
        if (isH2H) {
            const v0 = typeof teams[0][s.key] === 'number' ? teams[0][s.key] : 0;
            const v1 = typeof teams[1][s.key] === 'number' ? teams[1][s.key] : 0;
            const diff = v0 - v1;
            const sign = diff > 0 ? '+' : '';
            const cls = diff > 0 ? 'positive' : diff < 0 ? 'negative' : 'neutral';
            const fmt = s.key === 'rank' || s.key === 'wins' || s.key === 'losses' || s.key === 'high_score' ? `${sign}${diff}` : `${sign}${diff.toFixed(2)}`;
            html += `<div class="comp-delta ${cls}">${fmt}</div>`;
        }
    });

    // OPR sub-rows for FTC (Auto/TeleOp number rows + global rank)
    if (ftcMode) {
        const hasOprBreakdown = teams.some(t => t.opr_auto != null || t.opr_dc != null);
        if (hasOprBreakdown) {
            // Auto OPR / TeleOp OPR number rows
            const oprParts = [
                { key: 'opr_auto', label: 'Auto OPR',   color: 'epa-lbl-auto' },
                { key: 'opr_dc',   label: 'TeleOp OPR', color: 'epa-lbl-teleop' },
            ];
            oprParts.forEach(ep => {
                const vals = teams.map(t => typeof t[ep.key] === 'number' ? t[ep.key] : 0);
                const absVals = vals.map(v => Math.abs(v));
                const best = Math.max(...vals);
                const maxV = Math.max(...absVals, 0.01);
                html += `<div class="comp-label"><span class="${ep.color}">${ep.label}</span></div>`;
                teams.forEach((t, i) => {
                    const raw = t[ep.key];
                    const v = typeof raw === 'number' ? raw : 0;
                    const display = typeof raw === 'number' ? raw.toFixed(1) : '\u2013';
                    const isBest = teams.length > 1 && v === best && v > 0;
                    const pct = maxV > 0 ? Math.round((Math.abs(v) / maxV) * 100) : 0;
                    let sideCls = '';
                    if (redKeys.has(t.team_key)) sideCls = 'comp-red';
                    else if (blueKeys.has(t.team_key)) sideCls = 'comp-blue';
                    html += `
                    <div class="comp-cell ${sideCls} ${isBest ? 'comp-best' : ''}">
                        <div class="comp-bar-bg"><div class="comp-bar" style="width:${pct}%"></div></div>
                        <span class="comp-val">${display}</span>
                    </div>`;
                });
                if (isH2H) {
                    const v0 = typeof teams[0][ep.key] === 'number' ? teams[0][ep.key] : 0;
                    const v1 = typeof teams[1][ep.key] === 'number' ? teams[1][ep.key] : 0;
                    const diff = v0 - v1;
                    const sign = diff > 0 ? '+' : '';
                    const cls = diff > 0 ? 'positive' : diff < 0 ? 'negative' : 'neutral';
                    html += `<div class="comp-delta ${cls}">${sign}${diff.toFixed(1)}</div>`;
                }
            });
        }

        // Global ranking row (QuickStats — rank out of all FTC teams)
        const hasQS = teams.some(t => t.quick_stats && t.quick_stats.tot);
        if (hasQS) {
            const totalCount = teams.reduce((c, t) => {
                const cnt = t.quick_stats?.count;
                return cnt > c ? cnt : c;
            }, 0);
            const suffix = totalCount ? ` / ${totalCount.toLocaleString()}` : '';

            html += `<div class="comp-label">Global Rank</div>`;
            teams.forEach(t => {
                const qs = t.quick_stats?.tot;
                const rank = qs?.rank;
                const display = rank != null ? `#${rank}${suffix}` : '\u2013';
                const isBest = teams.length > 1 && rank != null && rank === Math.min(...teams.map(x => x.quick_stats?.tot?.rank ?? Infinity));
                let sideCls = '';
                if (redKeys.has(t.team_key)) sideCls = 'comp-red';
                else if (blueKeys.has(t.team_key)) sideCls = 'comp-blue';
                html += `
                <div class="comp-cell ${sideCls} ${isBest ? 'comp-best' : ''}">
                    <span class="comp-val">${display}</span>
                </div>`;
            });
            if (isH2H) {
                const r0 = teams[0].quick_stats?.tot?.rank ?? 0;
                const r1 = teams[1].quick_stats?.tot?.rank ?? 0;
                const diff = r0 - r1;
                const sign = diff > 0 ? '+' : '';
                const cls = diff < 0 ? 'positive' : diff > 0 ? 'negative' : 'neutral'; // lower rank = better
                html += `<div class="comp-delta ${cls}">${sign}${diff}</div>`;
            }
        }
    }

    // EPA Breakdown stacked bar row (visual only) + number rows
    const hasEpaBreakdown = !ftcMode && teams.some(t => t.epa_auto != null || t.epa_teleop != null || t.epa_endgame != null);
    if (hasEpaBreakdown) {
        // Visual bar row
        html += '<div class="comp-label">EPA Breakdown</div>';
        teams.forEach(t => {
            const a = t.epa_auto ?? 0;
            const tp = t.epa_teleop ?? 0;
            const eg = t.epa_endgame ?? 0;
            const total = a + tp + eg;
            const aPct  = total > 0 ? (a / total * 100).toFixed(1) : 0;
            const tpPct = total > 0 ? (tp / total * 100).toFixed(1) : 0;
            const egPct = total > 0 ? (eg / total * 100).toFixed(1) : 0;

            let sideCls = '';
            if (redKeys.has(t.team_key)) sideCls = 'comp-red';
            else if (blueKeys.has(t.team_key)) sideCls = 'comp-blue';

            if (total === 0) {
                html += `<div class="comp-cell ${sideCls}"><span class="comp-val">\u2013</span></div>`;
            } else {
                html += `
                <div class="comp-cell ${sideCls} comp-epa-breakdown">
                    <div class="epa-stacked-bar">
                        <div class="epa-seg epa-seg-auto" style="width:${aPct}%" title="Auto: ${a.toFixed(1)}"></div>
                        <div class="epa-seg epa-seg-teleop" style="width:${tpPct}%" title="Teleop: ${tp.toFixed(1)}"></div>
                        <div class="epa-seg epa-seg-endgame" style="width:${egPct}%" title="Endgame: ${eg.toFixed(1)}"></div>
                    </div>
                </div>`;
            }
        });
        if (isH2H) html += '<div class="comp-delta"></div>';

        // Separate number rows for Auto, Teleop, Endgame
        const epaParts = [
            { key: 'epa_auto',    label: 'Auto EPA',    color: 'epa-lbl-auto' },
            { key: 'epa_teleop',  label: 'Teleop EPA',  color: 'epa-lbl-teleop' },
            { key: 'epa_endgame', label: 'Endgame EPA', color: 'epa-lbl-endgame' },
        ];
        epaParts.forEach(ep => {
            const vals = teams.map(t => typeof t[ep.key] === 'number' ? t[ep.key] : 0);
            const absVals = vals.map(v => Math.abs(v));
            const best = Math.max(...vals);
            const maxV = Math.max(...absVals, 0.01);
            html += `<div class="comp-label"><span class="${ep.color}">${ep.label}</span></div>`;
            teams.forEach((t, i) => {
                const raw = t[ep.key];
                const v = typeof raw === 'number' ? raw : 0;
                const display = typeof raw === 'number' ? raw.toFixed(1) : '\u2013';
                const isBest = teams.length > 1 && v === best && v > 0;
                const pct = maxV > 0 ? Math.round((Math.abs(v) / maxV) * 100) : 0;
                let sideCls = '';
                if (redKeys.has(t.team_key)) sideCls = 'comp-red';
                else if (blueKeys.has(t.team_key)) sideCls = 'comp-blue';
                html += `
                <div class="comp-cell ${sideCls} ${isBest ? 'comp-best' : ''}">
                    <div class="comp-bar-bg"><div class="comp-bar" style="width:${pct}%"></div></div>
                    <span class="comp-val">${display}</span>
                </div>`;
            });
            if (isH2H) {
                const v0 = typeof teams[0][ep.key] === 'number' ? teams[0][ep.key] : 0;
                const v1 = typeof teams[1][ep.key] === 'number' ? teams[1][ep.key] : 0;
                const diff = v0 - v1;
                const sign = diff > 0 ? '+' : '';
                const cls = diff > 0 ? 'positive' : diff < 0 ? 'negative' : 'neutral';
                html += `<div class="comp-delta ${cls}">${sign}${diff.toFixed(1)}</div>`;
            }
        });
    }

    // Alliance totals row for match mode
    if (isMatchMode) {
        const allianceStats = ftcMode ? ['opr'] : ['opr', 'epa'];
        html += '<div class="comp-divider" style="grid-column: 1 / -1"></div>';

        const redTeamsList = teams.filter(t => redKeys.has(t.team_key));
        const blueTeamsList = teams.filter(t => blueKeys.has(t.team_key));
        const redSpan = redTeamsList.length;
        const blueSpan = blueTeamsList.length;

        allianceStats.forEach(key => {
            const label = key.toUpperCase();
            const redSum = redTeamsList.reduce((s, t) => s + (t[key] || 0), 0);
            const blueSum = blueTeamsList.reduce((s, t) => s + (t[key] || 0), 0);
            const maxSum = Math.max(redSum, blueSum, 0.01);
            const redPct = Math.round((redSum / maxSum) * 100);
            const bluePct = Math.round((blueSum / maxSum) * 100);
            const redBest = redSum >= blueSum;
            const blueBest = !redBest;

            html += `<div class="comp-label comp-label-total">Σ ${label}</div>`;

            // Red alliance spanning cell
            html += `<div class="comp-cell comp-red comp-total comp-total-span ${redBest ? 'comp-best' : ''}" style="grid-column: span ${redSpan}">
                <div class="comp-bar-bg"><div class="comp-bar" style="width:${redPct}%"></div></div>
                <span class="comp-val">${redSum.toFixed(2)}</span>
            </div>`;

            // Blue alliance spanning cell
            html += `<div class="comp-cell comp-blue comp-total comp-total-span ${blueBest ? 'comp-best' : ''}" style="grid-column: span ${blueSpan}">
                <div class="comp-bar-bg"><div class="comp-bar" style="width:${bluePct}%"></div></div>
                <span class="comp-val">${blueSum.toFixed(2)}</span>
            </div>`;
        });
    }

    html += '</div>';
    $('compare-body').innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
//  Region & Event History tab
// ═══════════════════════════════════════════════════════════

async function loadHistory() {
    if (!currentEvent) return;
    hide('history-empty');
    hideInlineError('history-error');

    // FTC mode: history temporarily out of order
    if (isFTCMode()) {
        hideSkeleton('history-loading');
        showInlineError('history-error', 'Event history is not yet available for FTC events.');
        return;
    }

    showSkeleton('history-loading', 'history-loading-status', 'Loading region & event history\u2026');
    hide('history-container');

    try {
        setLoadingStatus('history-loading-status', 'Fetching region facts\u2026');
        // Region facts load instantly from static JSON; event history is dynamic
        const [regionResult, historyResult] = await Promise.all([
            eventRegion ? API.regionFacts(eventRegion).catch(() => null) : Promise.resolve(null),
            API.eventHistory(currentEvent).catch(() => null),
        ]);

        regionData = regionResult;
        historyData = historyResult;

        hideSkeleton('history-loading');
        show('history-container');
        fadeIn('history-container');

        renderRegionFacts(regionData);
        renderEventHistory(historyData);

        renderedTabs.history = true;
        updateTabDots();
    } catch (err) {
        hideSkeleton('history-loading');
        showInlineError('history-error', `Failed to load history: ${err.message}`, loadHistory);
    }
}


// ── Region Facts panel ─────────────────────────────────────
function renderRegionFacts(data) {
    const title = $('history-region-title');
    const body = $('history-region-body');
    if (!data) {
        title.textContent = 'Region Facts';
        body.innerHTML = '<p class="empty">No region data available.</p>';
        return;
    }

    title.textContent = `${eventRegion}`;

    // Stats cards row
    let html = '<div class="history-stats-row">';
    html += _statCard('First Event', `${data.first_event_year || '–'}`, data.first_event_name || '');
    html += _statCard('Total Events', `${data.total_events}`, `${(data.active_years || []).length} seasons`);
    const teamCount = data.official_team_count || data.current_season_teams || data.team_count;
    const teamSrc = data.official_team_count ? 'FIRST official' : 'TBA registrations';
    html += _statCard('Active Teams', `${teamCount}`, `${data.active_year || new Date().getFullYear()} season`, `${teamCount} teams (${teamSrc})`);
    html += _statCard('Hall of Fame', `${data.hof_count}`, data.hof_count ? data.hof_teams.map(t => t.team_number).join(', ') : 'none yet');
    html += _statCard('Einstein Teams', `${data.einstein_count}`, data.einstein_count ? `top: ${data.einstein_teams.slice(0,3).map(t => t.team_number).join(', ')}` : 'none yet');
    html += '</div>';

    // HoF teams detail
    if (data.hof_teams && data.hof_teams.length) {
        html += '<div class="history-detail-section">';
        html += '<h4>Hall of Fame Teams</h4>';
        html += '<div class="history-team-chips">';
        for (const t of data.hof_teams) {
            html += `<span class="history-chip hof-chip">${t.team_number} <span class="chip-name">${_esc(t.nickname)}</span> <span class="chip-years">${t.years.join(', ')}</span></span>`;
        }
        html += '</div></div>';
    }

    // Einstein Winners
    if (data.einstein_winners && data.einstein_winners.length) {
        html += '<div class="history-detail-section">';
        html += '<h4>Einstein Winners</h4>';
        html += '<div class="history-team-chips">';
        for (const t of data.einstein_winners) {
            html += `<span class="history-chip einstein-win-chip">${t.team_number} <span class="chip-name">${_esc(t.nickname)}</span> <span class="chip-years">${t.years.join(', ')}</span></span>`;
        }
        html += '</div></div>';
    }

    // Impact finalists
    if (data.impact_finalists && data.impact_finalists.length) {
        html += '<div class="history-detail-section">';
        html += '<h4>Impact Award Finalists</h4>';
        html += '<div class="history-team-chips">';
        for (const t of data.impact_finalists) {
            html += `<span class="history-chip impact-chip">${t.team_number} <span class="chip-name">${_esc(t.nickname)}</span> <span class="chip-years">${t.years.join(', ')}</span></span>`;
        }
        html += '</div></div>';
    }

    // Einstein teams (top 10)
    if (data.einstein_teams && data.einstein_teams.length) {
        html += '<div class="history-detail-section">';
        html += '<h4>Einstein Appearances</h4>';
        html += '<table class="data-table history-table"><thead><tr><th>#</th><th>Team</th><th>Apps</th><th>Years</th></tr></thead><tbody>';
        const einsteinSlice = data.einstein_teams.slice(0, 15);
        for (const t of einsteinSlice) {
            html += `<tr><td>${t.team_number}</td><td>${_esc(t.nickname)}</td><td class="num">${t.years.length}</td><td class="years-cell">${t.years.join(', ')}</td></tr>`;
        }
        if (data.einstein_teams.length > 15) {
            html += `<tr class="more-row"><td colspan="4">+${data.einstein_teams.length - 15} more</td></tr>`;
        }
        html += '</tbody></table></div>';
    }

    // International visitors
    if (data.top_international_visitors && data.top_international_visitors.length) {
        html += '<div class="history-detail-section">';
        html += '<h4>Most International Appearances <span class="detail-note">(last 5 seasons)</span></h4>';
        html += '<div class="history-team-chips">';
        const vis = data.top_international_visitors;
        const SHOW = 5;
        vis.slice(0, SHOW).forEach(v => {
            html += `<span class="history-chip visitor-chip">${v.team_number} <span class="chip-name">${_esc(v.nickname)}</span> <span class="chip-country">${_esc(v.country)}</span> <span class="chip-count">${v.appearances}×</span></span>`;
        });
        if (vis.length > SHOW) {
            const extra = vis.length - SHOW;
            html += `<span class="history-chip-more" onclick="this.nextElementSibling.classList.toggle('hidden');this.textContent=this.textContent.startsWith('+')?'− collapse':'+${extra} more'">+${extra} more</span>`;
            html += '<span class="history-chip-extra hidden">';
            vis.slice(SHOW).forEach(v => {
                html += `<span class="history-chip visitor-chip">${v.team_number} <span class="chip-name">${_esc(v.nickname)}</span> <span class="chip-country">${_esc(v.country)}</span> <span class="chip-count">${v.appearances}×</span></span>`;
            });
            html += '</span>';
        }
        html += '</div></div>';
    }

    body.innerHTML = html;
}


// ── Event History panel ────────────────────────────────────
function renderEventHistory(data) {
    const title = $('history-event-title');
    const body = $('history-event-body');
    if (!data) {
        title.textContent = 'Event History';
        body.innerHTML = '<p class="empty">No event history available.</p>';
        return;
    }

    title.textContent = `${_esc(data.event_name)} History`;

    let html = '<div class="history-stats-row">';
    html += _statCard('First Held', `${data.first_held}`, data.event_name || '');
    html += _statCard('Editions', `${data.editions}`, `${data.first_held}–${data.years_held[data.years_held.length - 1]}`);
    html += '</div>';

    // Leaderboards
    const boards = [
        { title: 'Most Event Wins', data: data.most_wins, icon: '🏆' },
        { title: 'Most Finalist Appearances', data: data.most_finalists, icon: '🥈' },
        { title: 'Most Event Impact Awards', data: data.most_impact, icon: '⭐' },
    ];

    html += '<div class="history-leaderboards">';
    for (const b of boards) {
        if (!b.data || !b.data.length) continue;
        html += '<div class="history-leaderboard">';
        html += `<h4>${b.icon} ${b.title}</h4>`;
        html += '<ol class="leaderboard-list">';
        for (const t of b.data) {
            const nick = _timsCache[t.team_number]?.nickname || t.nickname;
            html += `<li><span class="lb-team has-tooltip">${t.team_number}<span class="custom-tooltip">${_esc(nick)}</span></span> <span class="lb-count">${t.count}</span></li>`;
        }
        html += '</ol></div>';
    }
    html += '</div>';

    // Year-by-year timeline
    if (data.timeline && data.timeline.length) {
        html += '<div class="history-detail-section">';
        html += '<h4>Year-by-Year Results</h4>';
        html += '<table class="data-table history-table"><thead><tr><th>Year</th><th>Winners</th><th>Finalists</th><th>Event Impact</th></tr></thead><tbody>';
        for (const yr of data.timeline) {
            const winners = (yr.winners || []).map(t => `<span class="has-tooltip">${t.team_number}<span class="custom-tooltip">${_esc(_timsCache[t.team_number]?.nickname || t.nickname)}</span></span>`).join(', ') || '–';
            const finalists = (yr.finalists || []).map(t => `<span class="has-tooltip">${t.team_number}<span class="custom-tooltip">${_esc(_timsCache[t.team_number]?.nickname || t.nickname)}</span></span>`).join(', ') || '–';
            const impact = yr.impact ? `<span class="has-tooltip">${yr.impact.team_number}<span class="custom-tooltip">${_esc(_timsCache[yr.impact.team_number]?.nickname || yr.impact.nickname)}</span></span>` : '–';
            html += `<tr><td class="year-cell">${yr.year}</td><td>${winners}</td><td>${finalists}</td><td>${impact}</td></tr>`;
        }
        html += '</tbody></table></div>';
    }

    body.innerHTML = html;
}


// ── Helpers ────────────────────────────────────────────────
function _statCard(label, value, sub, tooltip) {
    const tip = tooltip ? ` title="${tooltip}"` : '';
    return `<div class="history-stat-card"${tip}><div class="hsc-value">${value}</div><div class="hsc-label">${label}</div>${sub ? `<div class="hsc-sub">${sub}</div>` : ''}</div>`;
}
function _esc(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/** Format ISO date (2026-03-15) as "Mar 15" */
function _fmtDate(dateStr) {
    if (!dateStr) return '';
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const parts = dateStr.split('-');
    if (parts.length < 3) return dateStr;
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    return `${months[m - 1] || parts[1]} ${d}`;
}


// ═══════════════════════════════════════════════════════════
// MOBILE UX IMPROVEMENTS
// ═══════════════════════════════════════════════════════════

// ── 1. Mobile Bottom Navigation ────────────────────────────
function mobileNavTo(tabName) {
    // Close the more panel if open
    closeMobileMore();

    // Use the existing tab switching mechanism
    const tabBtn = document.querySelector(`.tab[data-tab="${tabName}"]`);
    if (tabBtn) tabBtn.click();

    // Sync bottom nav active state
    syncMobileNav(tabName);
}

/**
 * Toggle between PBP custom nav and standard nav (Apple Liquid Glass style).
 * Called by the play-icon back button inside the PBP nav bar.
 * Does NOT change the active tab — just swaps which nav bar is visible.
 */
function toggleMobilePbpNav() {
    const stdNav = document.querySelector('.mobile-bottom-nav-inner');
    const pbpNav = document.getElementById('mob-pbp-nav');
    if (!stdNav || !pbpNav) return;
    const pbpVisible = !pbpNav.classList.contains('hidden');
    if (pbpVisible) {
        // Show standard nav, hide PBP nav, keep PBP highlighted
        stdNav.style.display = '';
        pbpNav.classList.add('hidden');
        document.querySelectorAll('.mob-nav-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.tab === 'playbyplay');
        });
    } else {
        // Show PBP nav, hide standard nav
        stdNav.style.display = 'none';
        pbpNav.classList.remove('hidden');
        _syncMobPbpLabel();
    }
}

function syncMobileNav(tabName) {
    document.querySelectorAll('.mob-nav-btn').forEach(b => {
        const t = b.dataset.tab;
        b.classList.toggle('active', t === tabName);
    });
    // Also highlight "more" items
    document.querySelectorAll('.mob-more-item').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tabName);
    });
    // If tab is in the "more" menu, highlight the "more" button
    const moreTabs = ['history', 'summary', 'breakdown', 'alliance', 'team'];
    const moreBtn = document.querySelector('.mob-nav-btn[data-tab="more"]');
    if (moreBtn) {
        moreBtn.classList.toggle('active', moreTabs.includes(tabName));
    }

    // Dynamic PbP navbar: swap standard nav ↔ PbP controls on mobile
    const stdNav = document.querySelector('.mobile-bottom-nav-inner');
    const pbpNav = document.getElementById('mob-pbp-nav');
    if (stdNav && pbpNav) {
        const isPbp = tabName === 'playbyplay';
        stdNav.style.display = isPbp ? 'none' : '';
        pbpNav.classList.toggle('hidden', !isPbp);
        if (isPbp) _syncMobPbpLabel();
    }
}

/** Update the mobile PbP nav bar match label */
function _syncMobPbpLabel() {
    const lbl = document.getElementById('mob-pbp-label');
    if (!lbl) return;
    if (pbpData && pbpData.matches && pbpData.matches.length) {
        const m = pbpData.matches[pbpIndex];
        lbl.textContent = m?._pbpLabel || (m?.label || 'Match').replace(/^Qualification\s*/i, 'Qual ');
    } else {
        lbl.textContent = 'Match';
    }
}

/** Open the PbP match picker bottom sheet */
function openMobilePbpMatchList() {
    const scrim = document.getElementById('mob-pbp-picker-scrim');
    const sheet = document.getElementById('mob-pbp-picker');
    const list = document.getElementById('mob-pbp-picker-list');
    if (!scrim || !sheet || !list) return;
    // Build match list from pbpData
    list.innerHTML = '';
    if (pbpData && pbpData.matches) {
        pbpData.matches.forEach((m, i) => {
            const btn = document.createElement('button');
            btn.className = 'mob-pbp-picker-item' + (i === pbpIndex ? ' active' : '');
            btn.textContent = m?._pbpLabel || (m?.label || 'Match ' + (i+1)).replace(/^Qualification\s*/i, 'Qual ');
            btn.onclick = () => { pbpGoTo(i); closeMobilePbpPicker(); };
            list.appendChild(btn);
        });
    }
    scrim.classList.add('open');
    sheet.classList.add('open');
    // Scroll active item into view
    requestAnimationFrame(() => {
        const active = list.querySelector('.active');
        if (active) active.scrollIntoView({ block: 'center', behavior: 'instant' });
    });
}

function closeMobilePbpPicker() {
    const scrim = document.getElementById('mob-pbp-picker-scrim');
    const sheet = document.getElementById('mob-pbp-picker');
    if (scrim) scrim.classList.remove('open');
    if (sheet) sheet.classList.remove('open');
}

/* ── Mobile unified panel (Lookup / Settings / Editor / Match Picker) ──── */
let _mobUtilMode = null; // 'lookup' | 'settings' | 'editor' | 'matches'

function openMobUtilPanel(mode) {
    const scrim = document.getElementById('mob-util-scrim');
    const panel = document.getElementById('mob-util-panel');
    const header = document.getElementById('mob-util-header');
    const body  = document.getElementById('mob-util-body');
    if (!scrim || !panel || !body) return;

    _mobUtilMode = mode;

    // Set title (header may include tabs for lookup)
    header.innerHTML = '';
    body.innerHTML = '';

    if (mode === 'lookup') {
        // Tab header: Lookup | H2H
        header.innerHTML = `<div class="mob-util-tabs"><button class="mob-util-tab active" data-pane="lookup" onclick="_switchMobUtilTab('lookup')">Lookup</button><button class="mob-util-tab" data-pane="h2h" onclick="_switchMobUtilTab('h2h')">H2H</button></div>`;
        _buildMobLookup(body);
    } else if (mode === 'settings') {
        header.innerHTML = '<span class="mob-util-title">Settings</span>';
        _buildMobSettings(body);
    } else if (mode === 'editor') {
        header.innerHTML = '<span class="mob-util-title">TIMS Editor</span>';
        _buildMobEditor(body);
    } else if (mode === 'matches') {
        header.innerHTML = '<span class="mob-util-title">Select Match</span>';
        _buildMobMatchPicker(body);
    } else if (mode === 'matchhistory') {
        header.innerHTML = '<span class="mob-util-title">Match History</span>';
        // body filled by caller after async load
    } else if (mode === 'history') {
        header.innerHTML = `<div class="mob-util-tabs"><button class="mob-util-tab active" data-pane="region" onclick="_switchMobHistoryTab('region')">Region</button><button class="mob-util-tab" data-pane="event" onclick="_switchMobHistoryTab('event')">Event</button></div>`;
        _buildMobHistoryRegion(body);
    } else if (mode === 'compare') {
        header.innerHTML = '<span class="mob-util-title">Compare</span>';
        // body filled by caller
    }

    scrim.classList.add('open');
    panel.style.display = 'flex';
    void panel.offsetWidth;
    panel.classList.add('open');
}

function _switchMobUtilTab(pane) {
    const header = document.getElementById('mob-util-header');
    const body = document.getElementById('mob-util-body');
    if (!header || !body) return;
    // Capture current lookup team before clearing
    if (pane === 'h2h') {
        const inp = document.getElementById('mob-util-team-num');
        if (inp && inp.value.trim()) _mobLastLookupTeam = inp.value.trim();
    }
    header.querySelectorAll('.mob-util-tab').forEach(b => b.classList.toggle('active', b.dataset.pane === pane));
    body.innerHTML = '';
    if (pane === 'lookup') _buildMobLookup(body);
    else if (pane === 'h2h') _buildMobH2H(body);
}

function _switchMobHistoryTab(pane) {
    const header = document.getElementById('mob-util-header');
    const body = document.getElementById('mob-util-body');
    if (!header || !body) return;
    header.querySelectorAll('.mob-util-tab').forEach(b => b.classList.toggle('active', b.dataset.pane === pane));
    body.innerHTML = '';
    if (pane === 'region') _buildMobHistoryRegion(body);
    else if (pane === 'event') _buildMobHistoryEvent(body);
}

async function _buildMobHistoryRegion(container) {
    if (!regionData && !historyData) {
        container.innerHTML = '<div class="mob-util-lookup-empty">Loading\u2026</div>';
        try {
            const [r, h] = await Promise.all([
                eventRegion ? API.regionFacts(eventRegion).catch(() => null) : Promise.resolve(null),
                currentEvent ? API.eventHistory(currentEvent).catch(() => null) : Promise.resolve(null),
            ]);
            regionData = r; historyData = h;
        } catch (e) {}
    }
    const data = regionData;
    if (!data) { container.innerHTML = '<div class="mob-util-lookup-empty">No region data available.</div>'; return; }

    let html = `<div class="mob-hist-title">${_esc(eventRegion || 'Region')}</div>`;
    html += '<div class="mob-hist-stats">';
    html += `<div class="mob-hist-stat"><span class="mob-hist-val">${data.first_event_year || '\u2013'}</span><span class="mob-hist-lbl">First Event</span></div>`;
    html += `<div class="mob-hist-stat"><span class="mob-hist-val">${data.total_events}</span><span class="mob-hist-lbl">Total Events</span></div>`;
    const tc = data.official_team_count || data.current_season_teams || data.team_count;
    html += `<div class="mob-hist-stat"><span class="mob-hist-val">${tc}</span><span class="mob-hist-lbl">Active Teams</span></div>`;
    html += `<div class="mob-hist-stat"><span class="mob-hist-val">${data.hof_count}</span><span class="mob-hist-lbl">Hall of Fame</span></div>`;
    html += `<div class="mob-hist-stat"><span class="mob-hist-val">${data.einstein_count}</span><span class="mob-hist-lbl">Einstein</span></div>`;
    html += '</div>';

    if (data.hof_teams && data.hof_teams.length) {
        html += '<div class="mob-hist-section"><span class="mob-hist-sec-title">Hall of Fame</span>';
        html += data.hof_teams.map(t => `<span class="mob-hist-chip hof-chip">${t.team_number} ${_esc(t.nickname)} <em>${t.years.join(', ')}</em></span>`).join('');
        html += '</div>';
    }
    if (data.impact_finalists && data.impact_finalists.length) {
        html += '<div class="mob-hist-section"><span class="mob-hist-sec-title">Impact Finalists</span>';
        html += data.impact_finalists.map(t => `<span class="mob-hist-chip impact-chip">${t.team_number} ${_esc(t.nickname)} <em>${t.years.join(', ')}</em></span>`).join('');
        html += '</div>';
    }
    if (data.einstein_teams && data.einstein_teams.length) {
        html += '<div class="mob-hist-section"><span class="mob-hist-sec-title">Einstein Appearances</span>';
        html += '<div class="mob-hist-table"><table><thead><tr><th>#</th><th>Team</th><th>Apps</th></tr></thead><tbody>';
        data.einstein_teams.slice(0, 10).forEach(t => {
            html += `<tr><td>${t.team_number}</td><td>${_esc(t.nickname)}</td><td>${t.years.length}</td></tr>`;
        });
        html += '</tbody></table></div></div>';
    }
    container.innerHTML = html;
}

async function _buildMobHistoryEvent(container) {
    if (!historyData && !regionData) {
        container.innerHTML = '<div class="mob-util-lookup-empty">Loading\u2026</div>';
        try {
            const [r, h] = await Promise.all([
                eventRegion ? API.regionFacts(eventRegion).catch(() => null) : Promise.resolve(null),
                currentEvent ? API.eventHistory(currentEvent).catch(() => null) : Promise.resolve(null),
            ]);
            regionData = r; historyData = h;
        } catch (e) {}
    }
    const data = historyData;
    if (!data) { container.innerHTML = '<div class="mob-util-lookup-empty">No event history available.</div>'; return; }

    let html = `<div class="mob-hist-title">${_esc(data.event_name || 'Event')}</div>`;
    html += '<div class="mob-hist-stats">';
    html += `<div class="mob-hist-stat"><span class="mob-hist-val">${data.first_held}</span><span class="mob-hist-lbl">First Held</span></div>`;
    html += `<div class="mob-hist-stat"><span class="mob-hist-val">${data.editions}</span><span class="mob-hist-lbl">Editions</span></div>`;
    html += '</div>';

    const boards = [
        { title: 'Most Wins', data: data.most_wins },
        { title: 'Most Finalists', data: data.most_finalists },
        { title: 'Most Impact', data: data.most_impact },
    ];
    for (const b of boards) {
        if (!b.data || !b.data.length) continue;
        html += `<div class="mob-hist-section"><span class="mob-hist-sec-title">${b.title}</span>`;
        html += '<ol class="mob-hist-lb">';
        b.data.forEach(t => { html += `<li><span>${t.team_number}</span> <span class="mob-hist-lbl">${_esc(t.nickname)}</span> <b>${t.count}</b></li>`; });
        html += '</ol></div>';
    }

    if (data.timeline && data.timeline.length) {
        html += '<div class="mob-hist-section"><span class="mob-hist-sec-title">Year-by-Year</span>';
        html += '<div class="mob-hist-table"><table><thead><tr><th>Year</th><th>Winners</th><th>Finalists</th></tr></thead><tbody>';
        data.timeline.forEach(yr => {
            const w = (yr.winners || []).map(t => t.team_number).join(', ') || '\u2013';
            const f = (yr.finalists || []).map(t => t.team_number).join(', ') || '\u2013';
            html += `<tr><td>${yr.year}</td><td>${w}</td><td>${f}</td></tr>`;
        });
        html += '</tbody></table></div></div>';
    }
    container.innerHTML = html;
}

function closeMobUtilPanel() {
    const scrim = document.getElementById('mob-util-scrim');
    const panel = document.getElementById('mob-util-panel');
    if (scrim) scrim.classList.remove('open');
    if (panel) {
        panel.classList.remove('open');
        setTimeout(() => { if (!panel.classList.contains('open')) panel.style.display = ''; }, 220);
    }
    _mobUtilMode = null;
}

/* Settings panel content */
function _buildMobSettings(container) {
    const groups = [
        { title: 'General', toggles: [
            { id: 'toggle-theme', label: 'Light mode', fn: 'toggleTheme' },
            { id: 'toggle-highlight-foreign', label: 'Highlight International Teams', fn: 'toggleHighlightForeign' },
            { id: 'toggle-highlight-rookie', label: 'Highlight Rookie Teams', fn: 'toggleHighlightRookie' },
            { id: 'toggle-offseason', label: 'Show Offseason Events', fn: 'toggleShowOffseason' },
            { id: 'toggle-world-record', label: 'Show Season High Score', fn: 'toggleWorldRecord' },
        ]},
        { title: 'Play-by-Play', toggles: [
            { id: 'toggle-pbp-awards', label: 'Show Awards', fn: 'togglePbpAwards' },
            { id: 'toggle-predictions', label: 'Show Win Predictions (Statbotics)', fn: 'toggleShowPredictions' },
            { id: 'toggle-gatool-sponsors', label: 'Sponsors', fn: 'toggleGatoolSponsors' },
            { id: 'toggle-sponsor-first-only', label: 'Hide Sponsors After First Appearance', fn: 'toggleSponsorFirstOnly' },
            { id: 'toggle-team-attrs', label: 'Show Team Attributes', fn: 'toggleTeamAttrs' },
            { id: 'toggle-hide-stats', label: 'Hide Stats', fn: 'toggleHideStats' },
        ]},
    ];
    groups.forEach(g => {
        const hdr = document.createElement('div');
        hdr.className = 'settings-group-title';
        hdr.textContent = g.title;
        container.appendChild(hdr);
        g.toggles.forEach(t => {
            const orig = document.getElementById(t.id);
            const checked = orig ? orig.checked : false;
            const lbl = document.createElement('label');
            lbl.className = 'settings-toggle';
            lbl.innerHTML = `<input type="checkbox" ${checked ? 'checked' : ''} onchange="${t.fn}(this.checked); var o=document.getElementById('${t.id}'); if(o) o.checked=this.checked;"><span class="toggle-slider"></span><span class="toggle-label">${t.label}</span>`;
            container.appendChild(lbl);
        });
    });
}

/* Lookup panel content */
let _mobLastLookupTeam = '';
function _buildMobLookup(container) {
    const search = document.createElement('div');
    search.className = 'mob-util-lookup-search';
    search.innerHTML = `<input type="text" id="mob-util-team-num" placeholder="Team #" inputmode="numeric" autocomplete="off"><input type="text" id="mob-util-team-year" placeholder="Year" style="max-width:70px" autocomplete="off"><button onclick="_mobUtilLookupTeam()">Go</button>`;
    container.appendChild(search);

    const body = document.createElement('div');
    body.className = 'mob-util-lookup-body';
    body.id = 'mob-util-lookup-result';
    body.innerHTML = '<div class="mob-util-lookup-empty">Enter a team number to get started</div>';
    container.appendChild(body);

    // Enter key handler
    setTimeout(() => {
        const inp = document.getElementById('mob-util-team-num');
        if (inp) {
            inp.focus();
            inp.addEventListener('keydown', e => { if (e.key === 'Enter') _mobUtilLookupTeam(); });
        }
        const yinp = document.getElementById('mob-util-team-year');
        if (yinp) yinp.addEventListener('keydown', e => { if (e.key === 'Enter') _mobUtilLookupTeam(); });
    }, 50);
}

async function _mobUtilLookupTeam() {
    const numEl = document.getElementById('mob-util-team-num');
    const yearEl = document.getElementById('mob-util-team-year');
    const result = document.getElementById('mob-util-lookup-result');
    if (!numEl || !result) return;
    const num = parseInt(numEl.value, 10);
    const year = yearEl ? yearEl.value.trim() || null : null;
    if (!num) return;
    _mobLastLookupTeam = String(num);

    result.innerHTML = '<div class="mob-util-lookup-empty">Loading\u2026</div>';
    try {
        if (typeof isFTCMode === 'function' && isFTCMode()) {
            const data = await _buildFtcTeamLookup(num, year);
            result.innerHTML = renderFtcTeamStats(data);
        } else {
            const data = await API.teamStats(num, year);
            result.innerHTML = renderTeamStats(data);
        }
    } catch (err) {
        result.innerHTML = '<div class="mob-util-lookup-empty">' + err.message + '</div>';
    }
}

/* Editor panel content — opens the full editor overlay from inside the panel */
function _buildMobEditor(container) {
    container.innerHTML = '<div class="mob-util-lookup-empty">Select a team from the rankings or match tables first, then tap TIMS Editor.</div>';
    // If a team is already selected in the compare bar, offer to edit it
    const sel = document.querySelector('#compare-bar .compare-bar-team');
    if (sel) {
        const teamNum = sel.dataset.team;
        if (teamNum) {
            container.innerHTML = `<div style="text-align:center;padding:1rem 0"><p style="color:var(--text-muted);margin-bottom:.75rem;font-size:.82rem">Open editor for selected team:</p><button onclick="closeMobUtilPanel(); openEditor(${parseInt(teamNum,10)})" style="background:var(--primary);color:#fff;border:none;border-radius:10px;padding:.5rem 1.2rem;font-weight:600;font-family:var(--font);cursor:pointer">#${parseInt(teamNum,10)} — Edit</button></div>`;
        }
    }
}

/* H2H panel content */
function _buildMobH2H(container) {
    const row = document.createElement('div');
    row.className = 'mob-util-lookup-search';
    row.innerHTML = `<input type="text" id="mob-util-h2h-a" placeholder="Team A" inputmode="numeric" autocomplete="off"><span style="color:var(--text-muted);font-size:.75rem;align-self:center">vs</span><input type="text" id="mob-util-h2h-b" placeholder="Team B" inputmode="numeric" autocomplete="off"><button onclick="_mobUtilH2H()">Go</button>`;
    container.appendChild(row);

    const toggle = document.createElement('label');
    toggle.className = 'pbp-conn-range-toggle';
    toggle.style.cssText = 'margin:.4rem 0 .5rem;font-size:.72rem';
    toggle.innerHTML = `<span class="conn-range-side h2h-range-side active">Past 3 Seasons</span><input type="checkbox" id="mob-h2h-all-time"><span class="conn-toggle-slider"></span><span class="conn-range-side h2h-range-side">All time</span>`;
    container.appendChild(toggle);

    const body = document.createElement('div');
    body.className = 'mob-util-lookup-body';
    body.id = 'mob-util-h2h-result';
    body.innerHTML = '<div class="mob-util-lookup-empty">Enter two team numbers</div>';
    container.appendChild(body);

    setTimeout(() => {
        const a = document.getElementById('mob-util-h2h-a');
        if (a) {
            if (_mobLastLookupTeam) a.value = _mobLastLookupTeam;
            const b = document.getElementById('mob-util-h2h-b');
            if (_mobLastLookupTeam && b) b.focus();
            else a.focus();
            a.addEventListener('keydown', e => { if (e.key === 'Enter') _mobUtilH2H(); });
            if (b) b.addEventListener('keydown', e => { if (e.key === 'Enter') _mobUtilH2H(); });
        }
    }, 50);
}

async function _mobUtilH2H() {
    const aEl = document.getElementById('mob-util-h2h-a');
    const bEl = document.getElementById('mob-util-h2h-b');
    const result = document.getElementById('mob-util-h2h-result');
    const allTime = document.getElementById('mob-h2h-all-time');
    if (!aEl || !bEl || !result) return;
    const a = parseInt(aEl.value, 10);
    const b = parseInt(bEl.value, 10);
    if (!a || !b) return;

    result.innerHTML = '<div class="mob-util-lookup-empty">Loading\u2026</div>';
    try {
        const data = await getActiveAPI().headToHead(a, b, null, allTime && allTime.checked);
        result.innerHTML = typeof renderH2H === 'function' ? renderH2H(data) : JSON.stringify(data);
    } catch (err) {
        result.innerHTML = '<div class="mob-util-lookup-empty">' + err.message + '</div>';
    }
}

/* Match picker panel content */
function _buildMobMatchPicker(container) {
    if (!pbpData || !pbpData.matches) {
        container.innerHTML = '<div class="mob-util-lookup-empty">No matches loaded</div>';
        return;
    }
    const list = document.createElement('div');
    list.className = 'mob-match-picker-list';
    pbpData.matches.forEach((m, i) => {
        const btn = document.createElement('button');
        btn.className = 'mob-match-picker-item' + (i === pbpIndex ? ' active' : '');
        btn.textContent = m?._pbpLabel || (m?.label || 'Match ' + (i+1)).replace(/^Qualification\s*/i, 'Qual ');
        btn.onclick = () => { pbpGoTo(i); closeMobUtilPanel(); };
        list.appendChild(btn);
    });
    container.appendChild(list);
    // Scroll active into view
    requestAnimationFrame(() => {
        const active = list.querySelector('.active');
        if (active) active.scrollIntoView({ block: 'center', behavior: 'instant' });
    });
}

/* Render match history into mob-util panel */
function _renderMobMatchHistory(container, perf, teamNum, nick) {
    if (!perf || perf.matches_played === 0) {
        container.innerHTML = '<div class="mob-util-lookup-empty">No matches played yet.</div>';
        return;
    }
    const rec = perf.record;
    const winPct = perf.matches_played > 0 ? Math.round((rec.wins / perf.matches_played) * 100) : 0;
    let html = `<div class="mob-mh-title">${teamNum}${nick ? ' \u2014 ' + nick : ''}</div>`;
    html += `<div class="mob-mh-stats">
        <div class="mob-mh-stat"><span class="mob-mh-val">${rec.wins}-${rec.losses}${rec.ties ? '-' + rec.ties : ''}</span><span class="mob-mh-lbl">Record</span></div>
        <div class="mob-mh-stat"><span class="mob-mh-val">${winPct}%</span><span class="mob-mh-lbl">Win Rate</span></div>
        <div class="mob-mh-stat"><span class="mob-mh-val">${perf.matches_played}</span><span class="mob-mh-lbl">Matches</span></div>
        <div class="mob-mh-stat"><span class="mob-mh-val">${perf.avg_alliance_score}</span><span class="mob-mh-lbl">Avg Pts</span></div>
    </div>`;

    const nickLookup = {};
    if (teamsData) { for (const t of teamsData) nickLookup[t.team_number] = formatTeamName(t.nickname) || ''; }

    if (perf.matches && perf.matches.length) {
        html += '<div class="mob-mh-matches">';
        for (const pm of perf.matches) {
            const desc = (pm.description || '').replace(/Qualification\s*/gi, 'Qual ');
            const colorCls = pm.allianceColor === 'Red' ? 'mh-color-red' : 'mh-color-blue';
            const allyCls = pm.allianceColor === 'Red' ? 'mh-ally-red' : 'mh-ally-blue';
            const oppCls = pm.allianceColor === 'Red' ? 'mh-ally-blue' : 'mh-ally-red';
            // Determine winner for bold + underline alliance score
            const allyWon = pm.result === 'Won';
            const oppWon = pm.result === 'Lost';
            const allyScoreClass = 'mob-mh-sc ' + allyCls + (allyWon ? ' mob-mh-sc-win' : '') + ' mob-mh-sc-ally';
            const oppScoreClass = 'mob-mh-sc ' + oppCls + (oppWon ? ' mob-mh-sc-win' : '');
            const allyScore = pm.allianceScore != null ? pm.allianceScore : '\u2013';
            const oppScore = pm.opponentScore != null ? pm.opponentScore : '\u2013';
            const allies = (pm.allianceTeams || []).map(n =>
                `<span class="mob-mh-team ${allyCls}" onclick="_mobMhLookup(${n})">${n}</span>`).join(' ');
            const opps = (pm.opponentTeams || []).map(n =>
                `<span class="mob-mh-team ${oppCls}" onclick="_mobMhLookup(${n})">${n}</span>`).join(' ');
            html += `<div class="mob-mh-row">
                <div class="mob-mh-row-left">
                    <span class="mob-mh-desc">${desc}</span>
                    <span class="mh-alliance-dot ${colorCls}"></span>
                    <span class="result-badge result-${pm.result}">${pm.result}</span>
                    <span class="${allyScoreClass}">${allyScore}</span><span class="mob-mh-sc-dash">\u2013</span><span class="${oppScoreClass}">${oppScore}</span>
                </div>
                <div class="mob-mh-row-teams"><span class="${allyCls}">${allies}</span> <span class="mob-mh-vs">vs</span> <span class="${oppCls}">${opps}</span></div>
            </div>`;
        }
        html += '</div>';
    }
    container.innerHTML = html;
}

/* Lookup from inside mob match history panel */
function _mobMhLookup(teamNum) {
    closeMobUtilPanel();
    setTimeout(() => {
        openMobUtilPanel('lookup');
        setTimeout(() => {
            const inp = document.getElementById('mob-util-team-num');
            if (inp) { inp.value = teamNum; _mobUtilLookupTeam(); }
        }, 60);
    }, 250);
}

/** Swipe gesture on PbP pill — left/right swipe switches match */
(function initPbpPillSwipe() {
    let startX = 0, startY = 0, swiping = false;
    const THRESHOLD = 40;

    document.addEventListener('touchstart', function(e) {
        const wrap = e.target.closest('.mob-pbp-label-wrap');
        if (!wrap) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        swiping = true;
    }, { passive: true });

    document.addEventListener('touchend', function(e) {
        if (!swiping) return;
        swiping = false;
        const dx = e.changedTouches[0].clientX - startX;
        const dy = e.changedTouches[0].clientY - startY;
        if (Math.abs(dx) < THRESHOLD || Math.abs(dy) > Math.abs(dx)) return;

        // Prevent the tap/click from also firing
        e.preventDefault();

        const lbl = document.getElementById('mob-pbp-label');
        const dir = dx < 0 ? 'left' : 'right';

        // Slide out
        if (lbl) lbl.classList.add('slide-' + dir);
        setTimeout(() => {
            if (dir === 'left') pbpNext(); else pbpPrev();
            if (lbl) {
                lbl.classList.remove('slide-' + dir);
                lbl.classList.add('slide-' + (dir === 'left' ? 'right' : 'left'));
                // Force reflow then slide in
                void lbl.offsetWidth;
                lbl.classList.remove('slide-left', 'slide-right');
            }
        }, 180);
    });
})();

function toggleMobileMore() {
    const panel = document.getElementById('mob-more-menu');
    const scrim = document.getElementById('mob-more-scrim');
    const isOpen = panel.classList.contains('open');
    if (isOpen) {
        closeMobileMore();
    } else {
        panel.classList.add('open');
        if (scrim) scrim.classList.add('open');
    }
}

function closeMobileMore() {
    const panel = document.getElementById('mob-more-menu');
    const scrim = document.getElementById('mob-more-scrim');
    if (panel) panel.classList.remove('open');
    if (scrim) scrim.classList.remove('open');
}

// Close more menu on outside click
document.addEventListener('click', e => {
    const menu = document.getElementById('mob-more-menu');
    if (!menu || !menu.classList.contains('open')) return;
    if (!e.target.closest('#mob-more-menu') && !e.target.closest('.mob-nav-btn[data-tab="more"]')) {
        closeMobileMore();
    }
});

// Sync bottom nav when desktop tabs are clicked
document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
        syncMobileNav(btn.dataset.tab);
    });
});

// Update mobile nav badges
function updateMobileNavBadges() {
    const rankBadge = document.getElementById('mob-badge-rankings');
    const pbpBadge = document.getElementById('mob-badge-pbp');
    if (rankBadge) {
        if (teamsData && teamsData.length) {
            rankBadge.textContent = teamsData.length;
            rankBadge.classList.add('visible');
        } else {
            rankBadge.classList.remove('visible');
        }
    }
    if (pbpBadge) {
        if (pbpData && pbpData.matches && pbpData.matches.length) {
            const m = pbpData.matches[pbpIndex];
            pbpBadge.textContent = m ? m.label.replace(/^Qualification /i, 'Q').replace(/^Playoff /i, 'P') : '';
            pbpBadge.classList.add('visible');
        } else {
            pbpBadge.classList.remove('visible');
        }
    }
}


// ── 2. Swipe Gestures for Match Navigation ─────────────────
(function initSwipeGestures() {
    const swipeTargets = [
        { containerId: 'tab-playbyplay', prev: () => pbpPrev(), next: () => pbpNext() },
        { containerId: 'tab-breakdown',  prev: () => bdPrev(),  next: () => bdNext() },
    ];

    swipeTargets.forEach(({ containerId, prev, next }) => {
        const el = document.getElementById(containerId);
        if (!el) return;

        let startX = 0, startY = 0, swiping = false;
        const THRESHOLD = 60;

        el.addEventListener('touchstart', e => {
            if (e.touches.length !== 1) return;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            swiping = true;
        }, { passive: true });

        el.addEventListener('touchmove', e => {
            if (!swiping) return;
            // If vertical scroll is larger than horizontal, cancel swipe
            const dx = Math.abs(e.touches[0].clientX - startX);
            const dy = Math.abs(e.touches[0].clientY - startY);
            if (dy > dx) swiping = false;
        }, { passive: true });

        el.addEventListener('touchend', e => {
            if (!swiping) return;
            swiping = false;
            const endX = e.changedTouches[0].clientX;
            const dx = endX - startX;
            if (Math.abs(dx) < THRESHOLD) return;
            if (dx < 0) next();  // swipe left → next
            else prev();          // swipe right → prev
        }, { passive: true });
    });
})();


// ── 3. Auto-Hiding Header on Scroll ────────────────────────
(function initAutoHideHeader() {
    const header = document.querySelector('header');
    if (!header) return;
    let lastScrollY = 0;
    let ticking = false;
    const SCROLL_THRESHOLD = 10;

    window.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            // Only apply on narrow screens
            if (window.innerWidth > 768) {
                header.classList.remove('header-hidden');
                ticking = false;
                return;
            }
            const currentY = window.scrollY;
            if (currentY > lastScrollY + SCROLL_THRESHOLD && currentY > 80) {
                header.classList.add('header-hidden');
            } else if (currentY < lastScrollY - SCROLL_THRESHOLD || currentY < 20) {
                header.classList.remove('header-hidden');
            }
            lastScrollY = currentY;
            ticking = false;
        });
    }, { passive: true });
})();


// ── 4. Bottom-Sheet Modal Drag-to-Close ────────────────────
(function initSheetDrag() {
    if (window.innerWidth > 768) return;

    /** Attach drag-to-dismiss to a modal overlay. */
    function makeDraggable(overlayId, closeFn) {
        const overlay = document.getElementById(overlayId);
        if (!overlay) return;

        let startY = 0, currentY = 0, dragging = false;

        // Watch for new modals being shown (MutationObserver would be heavier,
        // so instead we use touchstart directly on the overlay)
        overlay.addEventListener('touchstart', e => {
            const modal = overlay.querySelector('.compare-modal, .lookup-modal, .match-history-modal');
            if (!modal) return;
            // Only activate on the "handle" area (top 40px of modal)
            const rect = modal.getBoundingClientRect();
            if (e.touches[0].clientY - rect.top > 40) return;
            startY = e.touches[0].clientY;
            currentY = startY;
            dragging = true;
            modal.style.transition = 'none';
        }, { passive: true });

        overlay.addEventListener('touchmove', e => {
            if (!dragging) return;
            currentY = e.touches[0].clientY;
            const dy = currentY - startY;
            if (dy < 0) return; // don't drag up
            const modal = overlay.querySelector('.compare-modal, .lookup-modal, .match-history-modal');
            if (modal) modal.style.transform = `translateY(${dy}px)`;
        }, { passive: true });

        overlay.addEventListener('touchend', () => {
            if (!dragging) return;
            dragging = false;
            const dy = currentY - startY;
            const modal = overlay.querySelector('.compare-modal, .lookup-modal, .match-history-modal');
            if (modal) {
                modal.style.transition = '';
                modal.style.transform = '';
            }
            if (dy > 120) closeFn();
        }, { passive: true });
    }

    makeDraggable('compare-overlay', closeCompare);
    makeDraggable('lookup-overlay', closeLookup);
    makeDraggable('match-history-overlay', closeMatchHistory);
})();


// ── 5. Card-Based Rankings View ────────────────────────────

function toggleRankingsView() {
    rankingsCardView = !rankingsCardView;
    if (teamsData) {
        $('event-teams').innerHTML = rankingsCardView
            ? renderTeamCards(teamsData)
            : renderTeamTable(teamsData, teamsSortCol, teamsSortAsc);
    }
}

function renderTeamCards(teams) {
    const compact = rankingsCompact;
    const school = rankingsShowSchool;
    const ftcMode = isFTCMode();
    const autoTele = ftcMode && rankingsShowAutoTele;
    const viewToggle = `<button class="rankings-view-toggle" onclick="toggleRankingsView()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        ${rankingsCardView ? 'Table View' : 'Card View'}
    </button>`;
    const toolbar = `<div class="rankings-toolbar">
        <label class="toggle-label"><input type="checkbox" ${compact ? 'checked' : ''} onchange="toggleRankingsCompact(this.checked)"> Compact</label>
        <label class="toggle-label school-toggle"><input type="checkbox" ${school ? 'checked' : ''} onchange="toggleRankingsSchool(this.checked)"> School / Org</label>
        ${ftcMode ? `<label class="toggle-label"><input type="checkbox" ${autoTele ? 'checked' : ''} onchange="toggleRankingsAutoTele(this.checked)"> Auto / TeleOp</label>` : ''}
        ${viewToggle}
    </div>`;

    if (!rankingsCardView) return toolbar;

    // Compute OPR/EPA percentiles for color grading
    const allOPRs = teams.map(t => parseFloat(t.opr)).filter(v => !isNaN(v)).sort((a, b) => a - b);
    const avgOPR = allOPRs.length ? allOPRs.reduce((s, v) => s + v, 0) / allOPRs.length : 0;
    const p75OPR = allOPRs.length ? allOPRs[Math.floor(allOPRs.length * 0.75)] : 0;
    const allEPAs = teams.map(t => parseFloat(t.epa)).filter(v => !isNaN(v)).sort((a, b) => a - b);
    const avgEPA = allEPAs.length ? allEPAs.reduce((s, v) => s + v, 0) / allEPAs.length : 0;
    const p75EPA = allEPAs.length ? allEPAs[Math.floor(allEPAs.length * 0.75)] : 0;

    const cards = teams.map(t => {
        const name = formatTeamName(t.nickname);
        const avatarImg = t.avatar
            ? `<img src="${t.avatar}" class="rank-card-avatar" alt="" loading="lazy">`
            : `<span class="rank-card-avatar-placeholder">${t.team_number}</span>`;
        const isIntl = highlightForeign && t.country && eventCountry && t.country !== eventCountry;
        const isRookie = highlightRookie && t.rookie_year && currentEventYear && t.rookie_year >= currentEventYear;
        const oprVal = parseFloat(t.opr);
        const oprCls = !isNaN(oprVal) && oprVal >= p75OPR ? ' opr-top25' : (!isNaN(oprVal) && oprVal > avgOPR ? ' opr-above-avg' : '');
        const epaVal = parseFloat(t.epa);
        const epaCls = !isNaN(epaVal) && epaVal >= p75EPA ? ' epa-top25' : (!isNaN(epaVal) && epaVal > avgEPA ? ' epa-above-avg' : '');

        return `<div class="rank-card${isIntl ? ' foreign-team-row' : ''}${isRookie ? ' rookie-team-row' : ''}" data-team-key="${t.team_key}" onclick="floatLookupQuick(${t.team_number})">
            <div class="rank-card-top">
                <span class="rank-card-rank${Number(t.rank) >= 1 && Number(t.rank) <= 8 ? ' rank-top8' : ''}">#${t.rank}</span>
                ${avatarImg}
                <div class="rank-card-info">
                    <span class="rank-card-num team-num">${t.team_number}</span>
                    <span class="rank-card-name">${name}</span>
                </div>
            </div>
            <div class="rank-card-stats">
                <div class="rank-card-stat"><div class="rank-card-stat-val">${t.wins}-${t.losses}-${t.ties}</div><div class="rank-card-stat-label">W-L-T</div></div>
                <div class="rank-card-stat"><div class="rank-card-stat-val stat-opr${oprCls}">${t.opr}</div><div class="rank-card-stat-label">OPR</div></div>
                ${autoTele ? `<div class="rank-card-stat"><div class="rank-card-stat-val">${t.opr_auto != null ? Number(t.opr_auto).toFixed(1) : '\u2013'}</div><div class="rank-card-stat-label">Auto</div></div>` : ''}
                ${autoTele ? `<div class="rank-card-stat"><div class="rank-card-stat-val">${t.opr_dc != null ? Number(t.opr_dc).toFixed(1) : '\u2013'}</div><div class="rank-card-stat-label">TeleOp</div></div>` : ''}
                ${ftcMode ? '' : `<div class="rank-card-stat"><div class="rank-card-stat-val stat-epa${epaCls}">${t.epa != null ? t.epa : '\u2013'}</div><div class="rank-card-stat-label">EPA</div></div>`}
                ${ftcMode ? '' : `<div class="rank-card-stat"><div class="rank-card-stat-val">${t.ranking_points != null ? t.ranking_points : '\u2013'}</div><div class="rank-card-stat-label">RP</div></div>`}
            </div>
        </div>`;
    }).join('');

    return toolbar + `<div class="rankings-card-grid">${cards}</div>`;
}

// ── 6. Pull-to-Refresh ─────────────────────────────────────
(function initPullToRefresh() {
    if (!('ontouchstart' in window)) return;

    const refreshFns = {
        rankings: () => {
            if (!currentEvent) return;
            // Trigger a re-load of rankings
            const eventKey = currentEvent;
            getActiveAPI().eventTeams(eventKey).then(async data => {
                if (data && !data.error) {
                    $('event-teams').innerHTML = await buildTeamTable(data.teams || data);
                    showToast('Rankings refreshed', 'info', 2000);
                    updateMobileNavBadges();
                }
            }).catch(() => showToast('Refresh failed', 'error', 2000));
        },
        summary: () => { if (currentEvent) loadSummary(); },
        playbyplay: () => {
            if (pbpData && pbpData.matches && pbpData.matches.length) {
                if (typeof pbpAutoRefresh === 'function') pbpAutoRefresh();
                showToast('Refreshing match data\u2026', 'info', 1500);
            }
        },
    };

    document.querySelectorAll('[data-ptr]').forEach(section => {
        const key = section.dataset.ptr;
        const indicator = document.getElementById('ptr-' + key);
        if (!indicator) return;

        let startY = 0, pulling = false, triggered = false;
        const PULL_THRESHOLD = 70;

        section.addEventListener('touchstart', e => {
            // Only activate if scrolled to top
            if (section.scrollTop > 5 || window.scrollY > 5) return;
            startY = e.touches[0].clientY;
            pulling = true;
            triggered = false;
        }, { passive: true });

        section.addEventListener('touchmove', e => {
            if (!pulling) return;
            const dy = e.touches[0].clientY - startY;
            if (dy < 0) { pulling = false; return; }
            const progress = Math.min(dy, PULL_THRESHOLD + 20);
            indicator.style.height = progress + 'px';
            indicator.classList.add('pulling');

            const arrow = indicator.querySelector('.ptr-arrow');
            if (arrow) arrow.classList.toggle('flipped', dy >= PULL_THRESHOLD);

            if (dy >= PULL_THRESHOLD) triggered = true;
            else triggered = false;
        }, { passive: true });

        section.addEventListener('touchend', () => {
            if (!pulling) return;
            pulling = false;

            if (triggered && refreshFns[key]) {
                indicator.innerHTML = '<span class="ptr-spinner spinning"></span> Refreshing\u2026';
                indicator.classList.add('refreshing');
                indicator.style.height = '40px';
                refreshFns[key]();
                setTimeout(() => {
                    indicator.style.height = '0';
                    indicator.classList.remove('pulling', 'refreshing');
                    indicator.innerHTML = '<span class="ptr-arrow">\u2193</span> Pull to refresh';
                    indicator.querySelector('.ptr-arrow')?.classList.remove('flipped');
                }, 2000);
            } else {
                indicator.style.height = '0';
                indicator.classList.remove('pulling');
                const arrow = indicator.querySelector('.ptr-arrow');
                if (arrow) arrow.classList.remove('flipped');
            }
        }, { passive: true });
    });
})();


// ── 8. Settings as Bottom Sheet on Mobile ──────────────────
(function initSettingsSheet() {
    const origToggle = window.toggleSettings;
    // Remember the original parent so we can put the menu back for desktop
    let _settingsOrigParent = null;

    function closeSheet(menu) {
        menu.classList.add('hidden');
        document.getElementById('settings-backdrop')?.remove();
        document.body.style.overflow = '';
        // Move menu back into the header wrapper for desktop use
        if (_settingsOrigParent && menu.parentNode !== _settingsOrigParent) {
            _settingsOrigParent.appendChild(menu);
        }
    }

    window.toggleSettings = function() {
        const menu = document.getElementById('settings-menu');
        if (!menu) return;

        if (window.innerWidth <= 768) {
            const isOpen = !menu.classList.contains('hidden');
            if (isOpen) {
                closeSheet(menu);
            } else {
                // Move menu to body so it escapes the header's backdrop-filter
                // containing block (which breaks position:fixed)
                if (!_settingsOrigParent) _settingsOrigParent = menu.parentNode;
                if (menu.parentNode !== document.body) {
                    document.body.appendChild(menu);
                }
                menu.classList.remove('hidden');
                document.body.style.overflow = 'hidden';
                // Add backdrop
                if (!document.getElementById('settings-backdrop')) {
                    const bd = document.createElement('div');
                    bd.id = 'settings-backdrop';
                    bd.className = 'settings-backdrop';
                    bd.onclick = () => closeSheet(menu);
                    document.body.appendChild(bd);
                }
            }
        } else {
            // Desktop: ensure menu is back in its wrapper
            if (_settingsOrigParent && menu.parentNode !== _settingsOrigParent) {
                _settingsOrigParent.appendChild(menu);
            }
            origToggle();
        }
    };
})();


// ── 15. Landscape Orientation Warning ──────────────────────
(function initLandscapeHint() {
    const hint = document.getElementById('landscape-hint');
    if (!hint) return;

    const dismissed = sessionStorage.getItem('landscapeHintDismissed');
    if (dismissed) { hint.classList.add('dismissed'); return; }

    function checkOrientation() {
        if (window.innerWidth <= 900 && window.innerHeight <= 500 && window.innerWidth > window.innerHeight) {
            hint.classList.add('show');
        } else {
            hint.classList.remove('show');
        }
    }

    window.addEventListener('resize', checkOrientation, { passive: true });
    screen.orientation?.addEventListener('change', checkOrientation);
    checkOrientation();
})();

function dismissLandscapeHint() {
    const hint = document.getElementById('landscape-hint');
    if (hint) hint.classList.add('dismissed');
    sessionStorage.setItem('landscapeHintDismissed', 'true');
}
