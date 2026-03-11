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
];
document.addEventListener('dblclick', e => {
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

let currentEvent = null;   // event_key once loaded
let currentEventYear = null; // numeric year of the loaded event
let eventInfoData = null;  // cached event info for saving
let playoffData  = null;   // cached playoff matches
let allianceData = null;   // cached alliance data
let summaryData  = null;   // cached event summary
let pbpData      = null;   // cached play-by-play data
let pbpIndex     = 0;      // current match index
let highlightForeign = false; // settings: highlight international teams
let highlightRookie = false;   // settings: highlight rookie teams
let showOffseason = false;     // settings: show offseason events
let rankingsCompact = false;      // toggle: compressed rankings view
let rankingsShowSchool = false;   // toggle: show school/org column
let rankingsCardView = false;     // toggle: card view on mobile
let allianceShowEpa = false;      // toggle: show EPA breakdown in alliance cards
let allianceShowPlayoff = false;  // toggle: show playoff ribbons/status
let allianceShowAvatars = true;  // toggle: show team avatars
let allianceShowNames = false;    // toggle: show team nicknames
let pbpShowAwards = false;        // toggle: show blue banners + awards in PBP
let showPredictions = false;       // settings: show Statbotics win predictions in PBP
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

// ── Settings ───────────────────────────────────────────────
function toggleSettings() {
    document.getElementById('settings-menu').classList.toggle('hidden');
}
// Close settings when clicking outside
document.addEventListener('click', e => {
    const wrapper = e.target.closest('.settings-wrapper');
    if (!wrapper) document.getElementById('settings-menu')?.classList.add('hidden');
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

function toggleHighlightForeign(on) {
    highlightForeign = on;
    applyForeignHighlight();
    // Re-render tabs that embed highlight logic at render time
    if (teamsData) $('event-teams').innerHTML = renderTeamTable(teamsData, teamsSortCol, teamsSortAsc);
    if (allianceData) renderAlliances(allianceData);
    if (pbpData) renderPbpMatch();
}

function toggleHighlightRookie(on) {
    highlightRookie = on;
    applyRookieHighlight();
    if (teamsData) $('event-teams').innerHTML = renderTeamTable(teamsData, teamsSortCol, teamsSortAsc);
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

        // Update URL hash (without triggering hashchange)
        history.replaceState(null, '', `#${btn.dataset.tab}`);

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
                renderSummary(summaryData);
                fadeIn('summary-container');
                // Stale-while-revalidate: for ongoing events, silently refresh in background
                if (currentEventStatus === 'ongoing') {
                    const _code = currentEvent;
                    API.eventSummary(_code).then(freshData => {
                        if (currentEvent !== _code) return;
                        if (freshData.error || !freshData.demographics) return;
                        summaryData = freshData;
                        renderSummary(freshData);
                        autoCacheTab('summary', freshData);
                    }).catch(() => {});
                }
            } else {
                // Optimistic skeleton
                hide('summary-empty');
                hideInlineError('summary-error');
                showSkeleton('summary-loading', 'summary-loading-status', 'Fetching event summary\u2026');
                loadSummary();
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
                el.innerHTML = 'Score breakdown is only available for 2025 events onwards.';
                el.classList.remove('hidden');
            }
        } else if (btn.dataset.tab === 'breakdown' && currentEvent && !renderedTabs.breakdown) {
            if (bdData?.matches?.length) {
                bdIndex = 0;
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

// ── Restore last event on page load ───────────────────────
(function restoreEvent() {
    const saved = localStorage.getItem('selectedEvent');
    if (!saved) return;
    try {
        const { year, eventCode } = JSON.parse(saved);
        if (!year || !eventCode) return;
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
    } catch (_) { /* ignore corrupt data */ }
})();
document.getElementById('team-number')?.addEventListener('keydown', e => { if (e.key === 'Enter') loadTeam(); });
document.getElementById('h2h-team-b')?.addEventListener('keydown', e => { if (e.key === 'Enter') loadH2H(); });

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

// ── Restore tab from URL hash on load ──────────────────────
// ── Store pending tab from URL hash (restored after event loads) ──
let _pendingTabHash = null;
(function captureTabHash() {
    const hash = location.hash.replace('#', '');
    if (hash && hash !== 'event') _pendingTabHash = hash;
})();

/** Restore the tab from URL hash after event data is available. */
function restorePendingTab() {
    if (!_pendingTabHash) return;
    const tab = _pendingTabHash;
    _pendingTabHash = null;
    const btn = document.querySelector(`.tab[data-tab="${tab}"]`);
    if (btn) requestAnimationFrame(() => btn.click());
}


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

// ── API Status Polling ────────────────────────────────────
async function checkApiStatus() {
    try {
        const resp = await fetch('/api/status');
        const data = await resp.json();

        const tbaDot = document.querySelector('#status-tba .status-dot');
        const frcDot = document.querySelector('#status-frc .status-dot');
        const sbDot  = document.querySelector('#status-statbotics .status-dot');
        if (tbaDot) {
            tbaDot.className = 'status-dot ' + (data.tba ? 'status-ok' : 'status-down');
        }
        if (frcDot) {
            frcDot.className = 'status-dot ' + (data.frc ? 'status-ok' : 'status-down');
        }
        if (sbDot) {
            sbDot.className = 'status-dot ' + (data.statbotics ? 'status-ok' : 'status-down');
        }
    } catch {
        document.querySelectorAll('.status-dot').forEach(d => d.className = 'status-dot status-down');
    }
}
// Check on load, then every 60 seconds
checkApiStatus();
setInterval(checkApiStatus, 60000);

// ── World Record in footer ────────────────────────────────
let _worldRecord = null;

async function fetchWorldRecord() {
    try {
        const rec = await API.worldRecord();
        if (rec && rec.score > 0) {
            _worldRecord = rec;
            renderWorldRecord(rec, false);
        }
    } catch { /* non-critical */ }
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
    $('footer-wr-score').textContent = rec.score;
    const eventLabel = rec.event_name || rec.event_key || '';
    const matchLabel = rec.match || '';
    const teamsStr = (rec.teams || []).join(', ');
    let detail = '';
    if (matchLabel) detail += matchLabel;
    if (eventLabel) detail += (detail ? ' · ' : '') + eventLabel;
    if (teamsStr) detail += ` (${teamsStr})`;
    $('footer-wr-detail').textContent = detail;
    if (_showWorldRecord) el.classList.remove('hidden');
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

fetchWorldRecord();

// Load saved events list on startup
loadSavedEventsList();


// ═══════════════════════════════════════════════════════════
// 1. EVENT SELECTION
// ═══════════════════════════════════════════════════════════

// ── Season events loader ──────────────────────────────────
async function loadSeasonEvents() {
    const status = $('season-status');
    status.textContent = 'Loading 2026 events…';
    try {
        // Load from bundled static JSON (instant, no API call)
        const resp = await fetch('data/season_2026.json');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        seasonEventsRaw = await resp.json();
        populateSeasonFilters();
        filterSeasonEvents();
        status.textContent = '';
        const badge = $('season-count-badge');
        if (badge) badge.textContent = `${seasonEventsRaw.length} events`;
    } catch (err) {
        // Fallback: fetch live from API if static file missing
        try {
            seasonEventsRaw = await API.seasonEvents(2026);
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
    status.textContent = 'Refreshing from TBA…';
    try {
        seasonEventsRaw = await API.seasonEvents(2026, true);
        populateSeasonFilters();
        filterSeasonEvents();
        status.textContent = 'Updated from TBA ✓';
        setTimeout(() => { if (status.textContent === 'Updated from TBA ✓') status.textContent = ''; }, 3000);
        const badge = $('season-count-badge');
        if (badge) badge.textContent = `${seasonEventsFiltered.length} events`;
    } catch (err) {
        status.textContent = `Refresh failed: ${err.message}`;
    } finally {
        btn.classList.remove('spinning');
    }
}

function populateSeasonFilters() {
    // Region filter
    const regions = [...new Set(seasonEventsRaw.map(e => e.region))].sort();
    const regionSel = $('season-filter-region');
    regionSel.innerHTML = '<option value="">All Regions</option>'
        + regions.map(r => `<option value="${r}">${r}</option>`).join('');

    // Week filter
    const weeks = [...new Set(seasonEventsRaw.map(e => e.week).filter(w => w !== null && w !== undefined))].sort((a, b) => a - b);
    const weekSel = $('season-filter-week');
    weekSel.innerHTML = '<option value="">All Weeks</option>'
        + weeks.map(w => `<option value="${w}">Week ${w + 1}</option>`).join('');
}

function filterSeasonEvents() {
    const region = $('season-filter-region').value;
    const week = $('season-filter-week').value;
    const search = ($('season-search').value || '').toLowerCase().trim();

    seasonEventsFiltered = seasonEventsRaw.filter(e => {
        // Hide offseason events unless the setting is on
        if (!showOffseason && e.event_type === 99) return false;
        if (region && e.region !== region) return false;
        if (week !== '' && String(e.week) !== week) return false;
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
        const weekLabel = e.week !== null && e.week !== undefined ? `Wk ${e.week + 1}` : 'CMP';
        const loc = [e.city, e.country].filter(Boolean).join(', ');
        return `<div class="season-dropdown-item" data-idx="${i}" onclick="selectSeasonEvent(${i})">
            <span class="sdi-name">${e.name}</span>
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
        const weekLabel = ev.week !== null && ev.week !== undefined ? `Week ${ev.week + 1}` : 'Championship';
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
loadRegionalPool();

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
let _regionalPoolData = null;      // raw array of team objects
let _regionalPoolFiltered = null;  // filtered view

async function loadRegionalPool() {
    try {
        const resp = await API.regionalPool(2026);
        if (!resp || !resp.teams || !resp.teams.length) return;
        _regionalPoolData = resp.teams;
        _regionalPoolFiltered = _regionalPoolData;
        const card = $('regional-pool-card');
        card.classList.remove('hidden');
        const badge = $('regional-pool-badge');
        const qualCount = _regionalPoolData.filter(t => t.qualifiedFirstCmp).length;
        badge.textContent = `${_regionalPoolData.length} teams · ${qualCount} qualified`;
        renderRegionalPool();
    } catch (err) {
        console.warn('[Regional Pool]', err);
    }
}

function toggleRegionalPool() {
    _toggleCollapse('regional-pool-body', 'regional-pool-toggle');
}

function filterRegionalPool() {
    if (!_regionalPoolData) return;
    const q = ($('regional-pool-search').value || '').trim().toLowerCase();
    const qualOnly = $('regional-pool-qualified-only').checked;

    _regionalPoolFiltered = _regionalPoolData.filter(t => {
        if (qualOnly && !t.qualifiedFirstCmp) return false;
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
    html += '<th title="Best event points">Event 1</th>';
    html += '<th title="Second event / projection">Event 2</th>';
    html += '<th class="adv-col-total">Total</th>';
    html += '<th>Status</th>';
    html += '</tr></thead><tbody>';

    teams.forEach(t => {
        const isQual = t.qualifiedFirstCmp;
        const rowCls = isQual ? 'rp-row-qualified' : '';

        // Event 1 details
        const e1 = t.regional1Details;
        const e1Code = e1 ? e1.tournamentCode : '';
        const e1Pts = t.regional1Points != null ? t.regional1Points : '–';

        // Event 2: actual or projected
        const e2 = t.regional2Details;
        const e2Pts = t.regional2Points != null ? t.regional2Points
                    : (t.regional2PointsProjection != null ? `~${t.regional2PointsProjection}` : '–');
        const e2Code = e2 ? e2.tournamentCode : '';

        // Status
        let statusHtml = '';
        if (isQual) {
            if (t.declinedFirstCmp) {
                statusHtml = '<span class="rp-status rp-status-declined">Declined</span>';
            } else {
                const method = _rpQualMethod(t);
                statusHtml = `<span class="rp-status rp-status-qualified">${method}</span>`;
            }
        } else {
            statusHtml = '<span class="rp-status rp-status-none">–</span>';
        }

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

function _rpQualMethod(t) {
    if (t.qualifiedFirstCmpAwardName) return t.qualifiedFirstCmpAwardName;
    const status = (t.championshipStatus || '').toLowerCase();
    if (status.includes('ranking')) return 'Directly Qualified';
    if (status.includes('award')) return 'By Award';
    if (status.includes('waitlist')) return 'Waitlist';
    return 'Qualified';
}

function clearActiveEvent() {
    currentEvent = null;
    currentEventYear = null;
    currentEventStatus = null;
    localStorage.removeItem('selectedEvent');
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
    rankingsRefreshTimer = setInterval(refreshRankings, RANKINGS_POLL_INTERVAL);
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
        const oldMap = snapshotRankings();
        // Use fast FRC-API rankings (lightweight: rank, W-L-T, RP only)
        const fastData = await API.fastRankings(currentEvent);
        if (fastData && fastData.length) {
            applyFastRankings(fastData, oldMap);
            return;
        }
        // Fallback: full refresh from TBA
        const teams = await API.refreshRankings(currentEvent);
        $('event-teams').innerHTML = buildTeamTable(teams);
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
    _pbpConnCache = {};
    _pbpConnAllTime = false;
    _pbpAwardsCache = {};
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
        const [info, teams] = await Promise.all([
            API.eventInfo(code),
            API.eventTeams(code),
        ]);

        // Restore the load button and season search
        if (btn) { btn.disabled = false; btn.textContent = btn.dataset.origText || 'Load Event'; btn.classList.remove('btn-loading'); }
        $('season-search')?.classList.remove('input-loading');

        currentEvent = code;
        currentEventYear = parseInt(year, 10);
        eventInfoData = info;
        localStorage.setItem('selectedEvent', JSON.stringify({ year, eventCode }));

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
        $('event-teams').innerHTML = buildTeamTable(teams);
        fadeIn('rankings-container');

        // Reset dependent tabs — clear both visibility and inner content
        $('summary-empty')?.classList.remove('hidden');
        $('summary-container')?.classList.add('hidden');
        hideSkeleton('summary-loading');
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

        // Hide cache badge for fresh loads
        $('aeb-cache-badge')?.classList.add('hidden');

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

        // Matches (feeds PBP + Breakdown)
        API.allMatches(code).then(matchData => {
            if (currentEvent !== code) return;
            if (matchData) {
                pbpData = matchData;
                bdData  = matchData;
                autoCacheTab('matches', matchData);
            }
        }).catch(() => {}).finally(phase2Check);

        // Playoffs
        API.playoffMatches(code).then(playoffResult => {
            if (currentEvent !== code) return;
            if (playoffResult && playoffResult.matches) {
                playoffData = playoffResult.matches;
            }
        }).catch(() => {}).finally(phase2Check);

        // Alliances
        API.alliances(code).then(allianceResult => {
            if (currentEvent !== code) return;
            if (allianceResult) {
                allianceData = allianceResult;
                autoCacheTab('alliances', allianceResult);
            }
        }).catch(() => {}).finally(phase2Check);

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

// ═══════════════════════════════════════════════════════════
//  Save / Load Event Cache
// ═══════════════════════════════════════════════════════════

/** Save current event — stores snapshot in browser IndexedDB (per-user) */
async function saveCurrentEvent() {
    if (!currentEvent) return;
    const btn = $('btn-save-event');
    const label = $('save-event-label');
    if (!btn || !label) return;

    btn.disabled = true;
    label.textContent = 'Saving…';
    btn.classList.add('saving');

    try {
        // Build the snapshot from already-loaded client data
        const snapshot = {
            info:       eventInfoData || null,
            teams:      teamsData || null,
            summary:    summaryData || null,
            matches:    pbpData || null,
            playoffs:   playoffData ? { matches: playoffData } : null,
            alliances:  allianceData || null,
            breakdowns: (bdCache && Object.keys(bdCache).length) ? bdCache : null,
            connections: null,
            connections_alltime: null,
        };

        // Store in browser IndexedDB (per-user, per-browser)
        await EventCache.put(currentEvent, snapshot);

        label.textContent = 'Saved ✓';
        btn.classList.remove('saving');
        btn.classList.add('saved');
        setTimeout(() => {
            label.textContent = 'Save Event';
            btn.classList.remove('saved');
            btn.disabled = false;
        }, 3000);

        // Refresh the saved events list
        loadSavedEventsList();
    } catch (err) {
        label.textContent = 'Error!';
        btn.classList.remove('saving');
        setTimeout(() => {
            label.textContent = 'Save Event';
            btn.disabled = false;
        }, 2000);
        console.error('Save event failed:', err);
    }
}

/** Load an event from saved cache (instant) — used by saved events list */
async function loadSavedEvent(eventKey) {
    // Reset state
    playoffData = null; allianceData = null; summaryData = null; eventInfoData = null;
    pbpData = null; pbpIndex = 0; bdData = null; bdIndex = 0; bdCache = {};
    historyData = null; regionData = null;
    stopBdPolling(); stopBdListRefresh(); stopPbpRefresh(); stopPlayoffRefresh();
    _pbpConnCache = {}; _pbpConnAllTime = false;
    _pbpAwardsCache = {};
    _playoffFirstsCache = null;
    _h2hAllTime = false;
    _loadingAwards = false;
    _loadingConnections = false;
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
        // Load from browser IndexedDB
        const snapshot = await EventCache.get(eventKey);
        if (!snapshot) throw new Error('Event not found in local cache');

        const data = snapshot.data || snapshot;
        if (!data.info || !data.teams) throw new Error('Incomplete saved data');

        // Parse event key
        const year = eventKey.substring(0, 4);
        const eventCode = eventKey.substring(4);
        $('event-year').value = year;
        $('event-code').value = eventCode;

        currentEvent = eventKey;
        currentEventYear = parseInt(year, 10);
        eventInfoData = data.info;
        localStorage.setItem('selectedEvent', JSON.stringify({ year, eventCode }));

        // Disable breakdown tab for pre-2025 events
        updateBreakdownTabState();

        const info = data.info;
        const teams = data.teams;

        // Sync season search
        const matchedSeason = seasonEventsRaw.find(e => e.key === eventKey);
        if (matchedSeason) $('season-search').value = matchedSeason.name;

        // Badge
        const badge = $('event-badge');
        badge.textContent = `${info.name} (${info.year})`;
        badge.classList.remove('status-ongoing', 'status-upcoming', 'status-completed');
        if (info.status) badge.classList.add(`status-${info.status}`);
        currentEventStatus = info.status || null;
        eventCountry = info.country || '';
        eventRegion = info.region || '';

        // If saved snapshot is missing region, fetch it live
        if (!eventRegion && currentEvent) {
            try {
                const liveInfo = await API.eventInfo(currentEvent);
                if (liveInfo && liveInfo.region) {
                    eventRegion = liveInfo.region;
                    info.region = liveInfo.region;
                }
            } catch (_) { /* non-critical */ }
        }

        show('event-badge');

        // Active event banner
        const statusBadge = info.status
            ? `<span class="aeb-status-badge status-${info.status}">${info.status.toUpperCase()}</span>`
            : '';
        $('aeb-name').textContent = info.name;
        $('aeb-meta').innerHTML = `<span>${info.event_type_string || ''} · ${info.city || ''}, ${info.state_prov || ''} · ${_fmtDate(info.start_date)} → ${_fmtDate(info.end_date)} · ${teams.length} teams</span>${statusBadge}`;

        const dot = document.querySelector('.aeb-dot');
        if (dot) {
            dot.classList.remove('dot-ongoing', 'dot-upcoming', 'dot-completed');
            if (info.status) dot.classList.add(`dot-${info.status}`);
        }
        show('active-event-banner');

        // Show cache badge
        const cacheBadge = $('aeb-cache-badge');
        if (cacheBadge) {
            const savedTime = snapshot.saved_at
                ? new Date(typeof snapshot.saved_at === 'number' && snapshot.saved_at > 1e12
                    ? snapshot.saved_at  // already ms
                    : snapshot.saved_at * 1000  // unix seconds → ms
                ).toLocaleString()
                : 'Unknown';
            cacheBadge.innerHTML = `<svg class="cache-badge-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Loaded from cache (${savedTime})`;
            cacheBadge.classList.remove('hidden');
        }

        // Sort — by team number when no rankings exist
        const hasRankings = teams.some(t => typeof t.rank === 'number');
        if (!hasRankings || currentEventStatus === 'upcoming') {
            teamsSortCol = 'team_number'; teamsSortAsc = true;
        } else {
            teamsSortCol = 'rank'; teamsSortAsc = true;
        }
        hide('rankings-empty');
        show('rankings-container');
        $('event-teams').innerHTML = buildTeamTable(teams);

        // Reset dependent tabs
        $('summary-empty')?.classList.remove('hidden');
        $('summary-container')?.classList.add('hidden');
        hideSkeleton('summary-loading');
        hideInlineError('summary-error');
        $('playoff-empty')?.classList.remove('hidden');
        $('playoff-bracket').innerHTML = '';
        hideSkeleton('playoff-loading');
        hideInlineError('playoff-error');
        $('alliance-empty')?.classList.remove('hidden');
        $('alliance-grid').innerHTML = '';
        hideSkeleton('alliance-loading');
        hideInlineError('alliance-error');
        $('bd-empty')?.classList.remove('hidden');
        $('bd-container')?.classList.add('hidden');
        hideSkeleton('bd-loading');
        hideInlineError('bd-error');
        $('pbp-empty')?.classList.remove('hidden');
        $('pbp-container')?.classList.add('hidden');
        hideSkeleton('pbp-loading');
        hideInlineError('pbp-error');
        $('history-empty')?.classList.remove('hidden');
        $('history-container')?.classList.add('hidden');
        hideSkeleton('history-loading');
        hideInlineError('history-error');

        // Pre-populate tab data from cache
        if (data.matches) { pbpData = data.matches; bdData = data.matches; }
        if (data.playoffs && data.playoffs.matches) {
            playoffData = data.playoffs.matches;
        }
        if (data.alliances) allianceData = data.alliances;
        if (data.breakdowns) bdCache = data.breakdowns;
        if (data.summary) {
            summaryData = data.summary;
            if (data.summary.connections) summaryData._connections_past3 = data.summary.connections;
        }
        if (data.connections) {
            // Pre-populate cache but don't block — this is from a saved snapshot
        }

        updateTabDots();

        // Restore tab from URL hash now that the saved event is loaded
        restorePendingTab();

        // For ongoing events, do a background refresh
        if (currentEventStatus === 'ongoing') {
            backgroundRefreshEvent(eventKey);
        }

    } catch (err) {
        showInlineError('summary-error', `Error loading saved event: ${err.message}`, () => loadSavedEvent(eventKey));
    }
}

/** Background refresh for ongoing events — update data silently */
async function backgroundRefreshEvent(eventKey) {
    try {
        const [freshTeams, freshMatches, freshPlayoffs, freshAlliances] = await Promise.all([
            API.eventTeams(eventKey).catch(() => null),
            API.allMatches(eventKey).catch(() => null),
            API.playoffMatches(eventKey).catch(() => null),
            API.alliances(eventKey).catch(() => null),
        ]);

        // Guard: user may have switched events during fetch
        if (currentEvent !== eventKey) return;

        // Update rankings/teams
        if (freshTeams) {
            $('event-teams').innerHTML = buildTeamTable(freshTeams);
            autoCacheTab('teams', freshTeams);
        }

        // Update match data (PBP + Breakdown share this)
        if (freshMatches) {
            pbpData = freshMatches;
            bdData  = freshMatches;
            autoCacheTab('matches', freshMatches);
            // If PBP or Breakdown tab was already rendered, refresh their selectors + re-render
            if (renderedTabs.playbyplay) {
                buildPbpSelector();
                renderPbpMatch();
            }
            if (renderedTabs.breakdown)  buildBdSelector();
        }

        // Update playoff bracket
        if (freshPlayoffs && freshPlayoffs.matches) {
            playoffData = freshPlayoffs.matches;
            if (renderedTabs.playoff) renderBracketTree();
        }

        // Update alliance data
        if (freshAlliances) {
            allianceData = freshAlliances;
            if (renderedTabs.alliance) renderAlliances(freshAlliances);
        }

        // Brief "updated" flash on cache badge
        const cacheBadge = $('aeb-cache-badge');
        if (cacheBadge && !cacheBadge.classList.contains('hidden')) {
            const prev = cacheBadge.textContent;
            cacheBadge.innerHTML = '<svg class="cache-badge-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Live data refreshed';
            cacheBadge.classList.add('cache-badge-flash');
            setTimeout(() => {
                cacheBadge.textContent = prev;
                cacheBadge.classList.remove('cache-badge-flash');
            }, 3000);
        }
    } catch (_) { /* silent */ }
}

/** Auto-cache tab data to IndexedDB as user visits each tab */
async function autoCacheTab(tabName, tabData) {
    if (!currentEvent || !tabData) return;
    await EventCache.patchTab(currentEvent, tabName, tabData);
}

/** Load and render the saved events list on the Events tab */
async function loadSavedEventsList() {
    try {
        // Load saved events from browser IndexedDB only (per-user)
        const events = (await EventCache.list()).sort((a, b) => (b.saved_at || 0) - (a.saved_at || 0));

        const card = $('saved-events-card');
        const list = $('saved-events-list');
        if (!card || !list) return;

        if (events.length === 0) {
            card.classList.add('hidden');
            return;
        }

        card.classList.remove('hidden');
        list.innerHTML = events.map(e => {
            const time = e.saved_at
                ? new Date(e.saved_at > 1e12 ? e.saved_at : e.saved_at * 1000).toLocaleString()
                : '';
            const statusCls = e.status ? `status-${e.status}` : '';
            const statusLabel = e.status ? e.status.charAt(0).toUpperCase() + e.status.slice(1) : '';
            return `
                <div class="saved-event-item" onclick="loadSavedEvent('${e.event_key}')">
                    <div class="saved-event-info">
                        <span class="saved-event-name">${e.name || e.event_key}</span>
                        ${statusLabel ? `<span class="saved-event-status ${statusCls}">${statusLabel}</span>` : ''}
                    </div>
                    <div class="saved-event-meta">
                        <span class="saved-event-time">${time}</span>
                        <button class="saved-event-delete" onclick="event.stopPropagation(); deleteSavedEvent('${e.event_key}')" title="Remove saved event">✕</button>
                    </div>
                </div>`;
        }).join('');
    } catch (err) {
        console.error('Failed to load saved events:', err);
    }
}

/** Delete a saved event from browser cache */
async function deleteSavedEvent(eventKey) {
    await EventCache.remove(eventKey);
    loadSavedEventsList();
}

let teamsData = null;      // cached teams list for sorting
let teamsSortCol = 'rank';  // current sort column
let teamsSortAsc = true;    // sort direction

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

function buildTeamTable(teams) {
    teamsData = teams;
    // Apply the current sort so upcoming events (sorted by team_number) render correctly
    sortTeamsData();
    return renderTeamTable(teamsData, teamsSortCol, teamsSortAsc);
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

function renderTeamTable(teams, sortCol, asc) {
    const arrow = asc ? ' ▲' : ' ▼';
    const th = (key, label) =>
        `<th class="sortable-th col-${key}${sortCol === key ? ' sorted' : ''}" onclick="sortTeams('${key}')">${label}${sortCol === key ? arrow : ''}</th>`;
    const compact = rankingsCompact;

    const school = rankingsShowSchool;
    const viewToggle = `<button class="rankings-view-toggle" onclick="toggleRankingsView()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        ${rankingsCardView ? 'Table View' : 'Card View'}
    </button>`;
    const toolbar = `<div class="rankings-toolbar">
        <label class="toggle-label"><input type="checkbox" ${compact ? 'checked' : ''} onchange="toggleRankingsCompact(this.checked)"> Compact</label>
        <label class="toggle-label"><input type="checkbox" ${school ? 'checked' : ''} onchange="toggleRankingsSchool(this.checked)"> School / Org</label>
        ${viewToggle}
    </div>`;

    return toolbar + `
    <table class="data-table${compact ? ' compact' : ''}">
        <thead>
            <tr>
                <th class="compare-th"></th>
                ${th('rank', 'Rank')}
                <th></th>
                ${th('team_number', 'Team')}
                ${th('nickname', 'Name')}
                ${compact ? '' : th('location', 'Location')}
                ${school ? th('school_name', 'School / Org') : ''}
                ${th('record', 'Record')}
                ${th('opr', 'OPR')}
                ${compact ? '' : th('epa', 'EPA')}
                ${th('ranking_points', 'RP')}
            </tr>
        </thead>
        <tbody>
            ${teams.map(t => {
                const loc = [t.city, t.state_prov, t.country].filter(Boolean).join(', ');
                const name = formatTeamName(t.nickname);
                const avatarImg = t.avatar
                    ? `<img src="${t.avatar}" class="team-avatar" alt="" loading="lazy">`
                    : `<span class="team-avatar team-avatar-placeholder">${t.team_number}</span>`;
                const checked = compareSelection.has(t.team_key) ? 'checked' : '';
                const isIntl = highlightForeign && t.country && eventCountry && t.country !== eventCountry;
                const isRookie = highlightRookie && t.rookie_year && currentEventYear && t.rookie_year >= currentEventYear;
                return `
            <tr class="${isIntl ? 'foreign-team-row' : ''}${isRookie ? ' rookie-team-row' : ''}" data-team-key="${t.team_key}" data-country="${t.country || ''}" data-rookie-year="${t.rookie_year || ''}">
                <td class="compare-td"><input type="checkbox" class="compare-cb" data-team="${t.team_key}" ${checked} onclick="toggleCompareTeam('${t.team_key}')"></td>
                <td class="rank${Number(t.rank) >= 1 && Number(t.rank) <= 8 ? ' rank-top8' : ''}">${t.rank}</td>
                <td class="team-avatar-cell">${avatarImg}</td>
                <td class="team-num">${t.team_number}</td>
                <td>${name}</td>
                ${compact ? '' : `<td class="location">${loc}</td>`}
                ${school ? `<td class="location">${t.school_name || ''}</td>` : ''}
                <td class="stat">${t.wins}-${t.losses}-${t.ties}</td>
                <td class="stat stat-opr">${t.opr}</td>
                ${compact ? '' : `<td class="stat stat-epa">${t.epa != null ? t.epa : '\u2013'}</td>`}
                <td class="stat">${t.ranking_points != null ? t.ranking_points : '\u2013'}</td>
            </tr>`;
            }).join('')}
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

function sortTeams(col) {
    if (!teamsData) return;
    if (teamsSortCol === col) {
        teamsSortAsc = !teamsSortAsc;
    } else {
        teamsSortCol = col;
        teamsSortAsc = true;
    }

    sortTeamsData();
    $('event-teams').innerHTML = renderTeamTable(teamsData, teamsSortCol, teamsSortAsc);
}


// ═══════════════════════════════════════════════════════════
// 1b. EVENT SUMMARY
// ═══════════════════════════════════════════════════════════

async function loadSummary() {
    if (!currentEvent) return;
    hide('summary-empty');
    hideInlineError('summary-error');
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
        hideSkeleton('summary-loading');
        showInlineError('summary-error', `Failed to load summary: ${err.message}`, loadSummary);
    }
}

/** Lazy-load prior playoff connections for the summary tab */
let _loadingConnections = false;
async function loadSummaryConnections() {
    if (!currentEvent || !summaryData || _loadingConnections) return;
    _loadingConnections = true;
    const eventKey = currentEvent;
    try {
        const connections = await API.eventConnections(eventKey, false);
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
    } catch {
        $('summary-history-list').innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">Could not load connections.</p>';
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
            renderPastSeasonAwards(data.past_season_awards);
            awardsEl.classList.remove('hidden');
        } else {
            awardsEl.classList.add('hidden');
        }

        // Persist awards into the cached summary so tab switches
        // and saved-event loads don't need to re-fetch from the API.
        autoCacheTab('summary', summaryData);
    } catch {
        // Don't hide sections — leave summaryData fields unset so the next
        // re-render (tab switch) can retry the fetch automatically.
        if (currentEvent !== eventKey) return;
        $('summary-past-champs-list').innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">Could not load — switch tabs to retry.</p>';
        $('summary-past-awards-list').innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">Could not load — switch tabs to retry.</p>';
    } finally {
        _loadingAwards = false;
    }
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
    } catch {
        if (currentEvent !== eventKey) return;
        $('summary-advancement-content').innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">Could not load advancement data.</p>';
    } finally {
        _loadingAdvancement = false;
    }
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
        html += '<h4 class="adv-section-title">Championship Qualifications</h4>';
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
            html += `<span class="adv-method ${methodCls}">${t.method}</span>`;
            html += `<span class="adv-pts" title="Qual ${t.qual_points} · Alliance ${t.alliance_points} · Elim ${t.elim_points} · Award ${t.award_points}">${t.total_points} pts</span>`;
            if (awardsStr) {
                html += `<span class="adv-awards-badge" title="${awardsStr}">${awardsStr}</span>`;
            }
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
    if (!wasOpen) el.classList.add('open');
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
    document.querySelectorAll('.past-awards-filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    if (summaryData?.past_season_awards) renderPastSeasonAwards(summaryData.past_season_awards);
}

function renderPastSeasonAwards(awards) {
    const prevYear = currentEventYear ? currentEventYear - 1 : new Date().getFullYear() - 1;
    $('summary-past-awards-title').textContent = `${prevYear} Award-Winning Teams`;

    const filtered = currentAwardFilter === 'all'
        ? awards
        : awards.map(t => ({
            ...t,
            awards: t.awards.filter(a => a.type === currentAwardFilter),
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

    // Impact Award Finalists
    const impactEl = $('summary-impact');
    if (data.impact_finalists && data.impact_finalists.length > 0) {
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
    const pastChampsEl = $('summary-past-champs');
    pastChampsEl.classList.remove('hidden');
    if (data.past_event_champions && data.past_event_champions.length > 0) {
        renderPastEventChampions(data.past_event_champions);
    } else if (!data.past_event_champions) {
        $('summary-past-champs-list').innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">Loading…</p>';
    } else {
        pastChampsEl.classList.add('hidden');
    }

    // Past Season Award Winners — lazy-load
    const pastAwardsEl = $('summary-past-awards');
    pastAwardsEl.classList.remove('hidden');
    if (data.past_season_awards && data.past_season_awards.length > 0) {
        renderPastSeasonAwards(data.past_season_awards);
    } else if (!data.past_season_awards) {
        $('summary-past-awards-list').innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">Loading…</p>';
    } else {
        pastAwardsEl.classList.add('hidden');
    }

    // If awards haven't been loaded yet (undefined) or came back empty
    // (possibly due to a transient API failure), retry the fetch.
    const _noChamps = !data.past_event_champions || data.past_event_champions.length === 0;
    const _noAwards = !data.past_season_awards  || data.past_season_awards.length === 0;
    if (_noChamps && _noAwards) {
        loadSummaryAwards();
    }

    // Advancement — lazy-load (only for completed events)
    const advEl = $('summary-advancement');
    if (currentEventStatus === 'completed') {
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

    // Top scorers
    renderTopScorers(data.top_scorers);

    // High scores (by match)
    renderHighScores(data.high_scores);
}

let currentConnFilter = 'all';
let currentConnSearch = '';
let currentConnSort = 'most';

function toggleSummarySection(type) {
    const bodyId = type === 'past-champs' ? 'summary-past-champs-body' : 'summary-past-awards-body';
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
                connections = await API.eventConnections(currentEvent, true);
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
        const teamNums = s.teams.map(t => `<span class="high-score-team has-tooltip">${t.team_number}${t.nickname ? `<span class="custom-tooltip">${t.nickname}</span>` : ''}</span>`).join(', ');
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
        const data = await API.playoffMatches(currentEvent);
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
        renderBracketTree();
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
    playoffRefreshTimer = setInterval(playoffAutoRefresh, PLAYOFF_REFRESH_INTERVAL);
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
        const data = await API.playoffMatches(currentEvent);
        if (!data?.matches?.length || currentEvent !== data.event_key) return;
        playoffData = data.matches;
        if (renderedTabs.playoff) renderBracketTree();
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
        const replay = m.match_number > 1 ? ` <span class="bkt-replay">R${m.match_number}</span>` : '';
        const redSeed  = m.red.alliance_number  ? `<span class="bkt-seed">#${m.red.alliance_number}</span>` : '';
        const blueSeed = m.blue.alliance_number ? `<span class="bkt-seed">#${m.blue.alliance_number}</span>` : '';
        return `<div class="bkt-slot ${upcoming ? 'bkt-upcoming' : ''} ${redWon || blueWon ? 'bkt-decided' : ''}">
                    <div class="bkt-slot-header">${label}${replay}</div>
                    <div class="bkt-row bkt-red ${redWon ? 'bkt-won' : ''}">
                        ${redSeed}
                        <span class="bkt-teams">${_teamsHtml(m.red.team_numbers)}</span>
                        <span class="bkt-score">${upcoming ? '–' : m.red.score}</span>
                    </div>
                    <div class="bkt-row bkt-blue ${blueWon ? 'bkt-won' : ''}">
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
        <div class="bracket-scroll-arrow-wrapper">
            <button class="bracket-scroll-arrow" id="bracket-scroll-finals" onclick="scrollBracketToFinals()" title="Scroll to Finals">
                Finals
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
        </div>
        ${_buildMobileBracket(slot, finalNums)}
    `;

    // Set up scroll-based visibility for the arrow
    _setupBracketScrollArrow();
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
            bodyHtml = r.matches.map(([set, lbl]) => slot(set, lbl)).join('');
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
async function loadAlliances() {
    if (!currentEvent) return;
    hide('alliance-empty');
    hideInlineError('alliance-error');
    showSkeleton('alliance-loading', 'alliance-loading-status', 'Fetching alliance selections\u2026');
    try {
        setLoadingStatus('alliance-loading-status', 'Loading partnerships & EPA data\u2026');
        const data = await API.alliances(currentEvent);
        allianceData = data;
        hideSkeleton('alliance-loading');
        renderAlliances(data);
        fadeIn('alliance-grid');
        autoCacheTab('alliances', data);
        updateTabDots();
    } catch (err) {
        hideSkeleton('alliance-loading');
        showInlineError('alliance-error', `Failed to load alliances: ${err.message}`, loadAlliances);
    }
}

function toggleAllianceAvatars(on) {
    allianceShowAvatars = on;
    if (allianceData) renderAlliances(allianceData);
}
function toggleAllianceNames(on) {
    allianceShowNames = on;
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
              + `<span class="combined-epa-detail">Auto ${a.combined_epa_auto != null ? a.combined_epa_auto : '\u2013'}</span>`
              + `<span class="combined-epa-detail">Teleop ${a.combined_epa_teleop != null ? a.combined_epa_teleop : '\u2013'}</span>`
              + `<span class="combined-epa-detail">Endgame ${a.combined_epa_endgame != null ? a.combined_epa_endgame : '\u2013'}</span>`
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
                    <span class="combined-opr">Σ OPR ${a.combined_opr}</span>
                    ${epaHtml}
                </div>
            </div>
            <div class="alliance-strength-bar"><div class="alliance-strength-fill" style="width:${strengthPct}%"></div></div>
            <div class="alliance-teams-list">
                ${a.teams.map((t, idx) => {
                    const avatarHtml = allianceShowAvatars
                        ? (t.avatar
                            ? `<img class="alliance-team-avatar" src="${t.avatar}" alt="">`
                            : `<div class="alliance-team-avatar-placeholder"></div>`)
                        : '';

                    const isIntl = highlightForeign && t.country && eventCountry && t.country !== eventCountry;
                    const isRookie = highlightRookie && t.rookie_year && currentEventYear && t.rookie_year >= currentEventYear;

                    const teamEpaHtml = allianceShowEpa
                        ? `<span class="stat-epa">EPA ${t.epa != null ? t.epa : '\u2013'}</span>`
                        : '';

                    return `
                    <div class="alliance-team-row${isIntl ? ' foreign-team-row' : ''}${isRookie ? ' rookie-team-row' : ''}" data-country="${t.country || ''}" data-rookie-year="${t.rookie_year || ''}">
                        <span class="team-role">${roleLabels[idx] || ''}</span>
                        ${avatarHtml}
                        <span class="team-num has-tooltip">${t.team_number}${t.nickname ? `<span class="custom-tooltip">${t.nickname}</span>` : ''}</span>
                        ${allianceShowNames ? `<span class="team-nick">${t.nickname || ''}</span>` : ''}
                        <div class="team-stats-mini">
                            <span${Number(t.rank) >= 1 && Number(t.rank) <= 8 ? ' class="rank-top8"' : ''}>Rank ${t.rank}</span>
                            <span>${t.wins}-${t.losses}-${t.ties}</span>
                            <span class="stat-opr">OPR ${t.opr}</span>
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
        setLoadingStatus('team-loading-status', `Fetching stats for team ${num}\u2026`);
        const data = await API.teamStats(num, year);
        lastTeamData = data;
        hideSkeleton('team-loading');
        $('team-stats').innerHTML = renderTeamStats(data);
        fadeIn('team-stats');
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
                ${allAwards.map(a => `
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
            const pastEvents = eventsThisYear.filter(e => !e.is_upcoming);
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
        const data = await API.headToHead(a, b, null, _h2hAllTime);
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
// 6. PLAY BY PLAY
// ═══════════════════════════════════════════════════════════
async function loadPlayByPlay() {
    if (!currentEvent) return;
    hideInlineError('pbp-error');
    try {
        setLoadingStatus('pbp-loading-status', 'Fetching match schedule\u2026');
        const data = await API.allMatches(currentEvent);
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
        renderPbpMatch();
        fadeIn('pbp-container');
        startPbpRefresh();
        updateTabDots();
    } catch (err) {
        hideSkeleton('pbp-loading');
        showInlineError('pbp-error', `Failed to load matches: ${err.message}`, loadPlayByPlay);
    }
}

function buildPbpSelector() {
    const sel = $('pbp-match-select');
    sel.innerHTML = pbpData.matches.map((m, i) =>
        `<option value="${i}">${m.label}</option>`
    ).join('');
    sel.value = pbpIndex;
}

function pbpGoTo(idx) {
    pbpIndex = parseInt(idx, 10);
    renderPbpMatch();
}

function pbpPrev() {
    if (pbpIndex > 0) {
        pbpIndex--;
        $('pbp-match-select').value = pbpIndex;
        renderPbpMatch();
    }
}

function pbpNext() {
    if (pbpData && pbpIndex < pbpData.matches.length - 1) {
        pbpIndex++;
        $('pbp-match-select').value = pbpIndex;
        renderPbpMatch();
    }
}

function renderPbpMatch() {
    if (!pbpData || !pbpData.matches.length) return;
    const m = pbpData.matches[pbpIndex];

    $('pbp-match-label').textContent = m.label;
    $('pbp-match-select').value = pbpIndex;

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
                <span class="pbp-alliance-opr">Σ OPR ${m.red.total_opr}</span>
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
                <span class="pbp-alliance-opr">Σ OPR ${m.blue.total_opr}</span>
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

    // Inject playoff-firsts badges for playoff matches
    if (m.comp_level && m.comp_level !== 'qm') {
        const allTeams = [...m.red.teams, ...m.blue.teams];
        _injectPlayoffFirsts(allTeams, pbpIndex, m.comp_level);
    }

    // Footer: event high score + compare button
    const qs = pbpData.event_high_score;
    $('pbp-footer').innerHTML = `
        <button class="pbp-compare-btn" onclick="compareCurrentMatch()" title="Compare all 6 teams side by side">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            Compare Teams <kbd>C</kbd>
        </button>
        ${qs && qs.score > 0
            ? `<span class="pbp-footer-text">
                   Event High Score: <span class="pbp-footer-score">${qs.score}</span>
                   in ${qs.match} (${qs.teams.join(', ')})
               </span>`
            : ''}
    `;

    // Prior connections between the 6 teams on the field
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
        const result = await API.eventConnections(currentEvent, wantAllTime, teamNums);
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
                <span class="conn-range-side${_pbpConnAllTime ? ' active' : ''}">All time</span>
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
    const loc = [t.city, t.state_prov, t.country].filter(Boolean).join(', ');
    const foreignCls = highlightForeign && t.country && eventCountry && t.country !== eventCountry ? 'foreign-team' : '';
    const rookieCls = highlightRookie && t.rookie_year && currentEventYear && t.rookie_year >= currentEventYear ? 'rookie-team' : '';

    return `
    <div class="pbp-team ${foreignCls} ${rookieCls}" data-country="${t.country || ''}" data-rookie-year="${t.rookie_year || ''}">
        <div class="pbp-team-top">
            <div class="pbp-team-number">${t.team_number}</div>
            <div class="pbp-firsts-slot" data-firsts-team="${t.team_number}"></div>
            <div class="pbp-team-identity">
                <div class="pbp-team-nickname">${t.nickname || 'Team ' + t.team_number}</div>
                ${t.school_name ? `<div class="pbp-team-school">${t.school_name}</div>` : ''}
                ${loc ? `<div class="pbp-team-location">${loc}</div>` : ''}
            </div>
        </div>
        <div class="pbp-team-stats">
            <div class="pbp-stat">
                <div class="pbp-stat-label">Rank</div>
                <div class="pbp-stat-value${Number(t.rank) >= 1 && Number(t.rank) <= 8 ? ' rank-top8' : ''}">${t.rank}</div>
            </div>
            <div class="pbp-stat">
                <div class="pbp-stat-label">Qual Avg</div>
                <div class="pbp-stat-value">${t.qual_average}</div>
            </div>
            <div class="pbp-stat">
                <div class="pbp-stat-label">W-L-T</div>
                <div class="pbp-stat-value">${t.wins}-${t.losses}-${t.ties}</div>
            </div>
            <div class="pbp-stat">
                <div class="pbp-stat-label">OPR</div>
                <div class="pbp-stat-value opr-val">${t.opr}</div>
            </div>
            <div class="pbp-stat">
                <div class="pbp-stat-label">EPA</div>
                <div class="pbp-stat-value epa-val">${t.epa != null ? t.epa : '\u2013'}</div>
            </div>
            <div class="pbp-stat">
                <div class="pbp-stat-label">Avg RP</div>
                <div class="pbp-stat-value">${t.avg_rp}</div>
            </div>
        </div>
        <div class="pbp-awards-slot" data-team="${t.team_number}"></div>
    </div>`;
}

// ── PBP Playoff-firsts injection ───────────────────────────

let _playoffFirstsCache = null;  // {team_number: {first_playoff, first_finals, rookie}} or null

async function _injectPlayoffFirsts(teams, matchIdx, compLevel) {
    // Lazy-load once per event
    if (_playoffFirstsCache === null) {
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
            const data = await API.teamAwardsSummary(uncached);
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
    pbpRefreshTimer = setInterval(pbpAutoRefresh, PBP_REFRESH_INTERVAL);
    // Show live badge
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
            const fast = await API.fastScores(currentEvent);
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

        // Full refresh from TBA (gets new matches, OPR, stats, etc)
        const fresh = await API.allMatches(currentEvent);
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
        if (scoresChanged) refreshRankings();

        // Flash the arena container to indicate an update
        const arena = $('pbp-arena');
        if (arena) {
            arena.classList.remove('pbp-updated-flash');
            void arena.offsetWidth; // force reflow
            arena.classList.add('pbp-updated-flash');
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
        bdBtn.title = 'Score breakdown is only available for 2025 events onwards';
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
            const data = await API.allMatches(currentEvent);
            pbpData = data;
        }
        bdData = pbpData;
        bdIndex = 0;
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
    bdListTimer = setInterval(refreshBdList, BD_LIST_REFRESH);
}
function stopBdListRefresh() {
    if (bdListTimer) { clearInterval(bdListTimer); bdListTimer = null; }
}
async function refreshBdList() {
    if (!currentEvent) return;
    try {
        const fresh = await API.allMatches(currentEvent);
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
        return `<option value="${i}" ${hasBd ? 'class="has-breakdown" style="color:#22c55e"' : ''}>${hasBd ? '● ' : '○ '}${m.label}</option>`;
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
    $('bd-match-label').textContent = m.label;
    $('bd-match-select').value = bdIndex;

    // Use client-side cache if available (instant render, no API call)
    if (bdCache[m.key] && bdCache[m.key].available) {
        renderBreakdown(bdCache[m.key]);
        return;
    }

    // Fetch from API
    $('bd-status').innerHTML = '<span style="color:var(--text-muted)">Loading breakdown…</span>';
    $('bd-content').innerHTML = '';

    try {
        const data = await API.matchBreakdown(m.key);
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
    bdPollTimer = setInterval(pollBdMatch, BD_POLL_INTERVAL);
}

function stopBdPolling() {
    if (bdPollTimer) { clearInterval(bdPollTimer); bdPollTimer = null; }
}

async function pollBdMatch() {
    if (!bdData || !bdData.matches.length) return;
    const m = bdData.matches[bdIndex];
    try {
        const data = await API.matchBreakdown(m.key);
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

    const renderFn = (data.game_year >= 2026) ? renderBdAlliance2026 : renderBdAlliance;

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
        'None': { label: 'None', cls: 'no' },
    };
    const eg = endGameMap[robot.endGame] || { label: robot.endGame, cls: '' };
    const num = robot.team_number || '?';
    const nick = (nickMap && nickMap[num]) || '';
    const tooltipHtml = nick ? `<span class="custom-tooltip">${nick}</span>` : '';
    const st = (statsMap && statsMap[num]) || {};
    const oprStr = st.opr != null ? st.opr : '–';
    const epaStr = st.epa != null ? st.epa : '–';

    return `
    <div class="bd-robot-card bd-robot-card-clickable" data-team="${num}" data-color="${color}" onclick="toggleSpotlight(${num}, '${color}')">
        <div class="bd-robot-num has-tooltip">${num}${tooltipHtml}</div>
        <div class="bd-robot-field">
            <span class="bd-robot-label">Leave</span>
            <span class="bd-robot-value ${leaveCls}">${leaveVal}</span>
        </div>
        <div class="bd-robot-field">
            <span class="bd-robot-label">Barge</span>
            <span class="bd-robot-value ${eg.cls}">${eg.label}</span>
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
    const autoLabel = autoVal === 'None' ? 'None' : autoVal;

    const endVal = robot.endGameTower || 'None';
    const endMap = {
        'None':   { label: 'None',   cls: 'no' },
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
        <div class="bd-robot-field">
            <span class="bd-robot-label">Auto Tower</span>
            <span class="bd-robot-value ${autoCls}">${autoLabel}</span>
        </div>
        <div class="bd-robot-field">
            <span class="bd-robot-label">Endgame</span>
            <span class="bd-robot-value ${eg.cls}">${eg.label}</span>
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
                </div>
                <button class="spotlight-close" onclick="closeSpotlight()" title="Close Spotlight">&times;</button>
            </div>
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

    // Fetch individual performance data from FRC Events API
    const eventKey = currentEvent;
    if (!eventKey) return;

    API.teamPerf(eventKey, teamNum).then(perf => {
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
                const score = pm.allianceScore != null ? `${pm.allianceScore}-${pm.opponentScore}` : '–';
                rows += `<tr class="${rowCls}">
                    <td>${pm.description}</td>
                    <td><span class="result-badge result-${pm.result}">${pm.result}</span></td>
                    <td>${score}</td>
                    <td>${_towerBadge(pm.autoTower)}</td>
                    <td>${_towerBadge(pm.endGameTower)}</td>
                </tr>`;
            }

            html += `
            <div class="spotlight-section spotlight-collapsible collapsed">
                <button type="button" class="spotlight-collapse-btn" onclick="const p=this.parentElement;p.classList.toggle('collapsed');this.textContent=p.classList.contains('collapsed')?'View Match History (${perf.matches.length})':'Hide Match History'">
                    View Match History (${perf.matches.length})
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
            'None': { label: 'None', cls: 'no' },
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
    panel.innerHTML = `
        <div class="spotlight-card spotlight-${color}">
            <div class="spotlight-header">
                <div class="spotlight-team-info">
                    <span class="spotlight-team-num">${teamNum}</span>
                    ${nick ? `<span class="spotlight-team-nick">${nick}</span>` : ''}
                    <span class="spotlight-alliance-badge spotlight-badge-${color}">${colorLabel}</span>
                    ${oprStr ? `<span class="spotlight-stat-pill">OPR ${oprStr}</span>` : ''}
                    ${epaStr ? `<span class="spotlight-stat-pill">EPA ${epaStr}</span>` : ''}
                </div>
                <button class="spotlight-close" onclick="closeSpotlight()" title="Close Spotlight">&times;</button>
            </div>
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
            'None': { label: 'None', cls: 'no' },
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

    panel.innerHTML = `
        <div class="spotlight-card spotlight-${color}">
            <div class="spotlight-header">
                <div class="spotlight-team-info">
                    <span class="spotlight-team-num">${teamNum}</span>
                    ${nick ? `<span class="spotlight-team-nick">${nick}</span>` : ''}
                    <span class="spotlight-alliance-badge spotlight-badge-${color}">${colorLabel}</span>
                </div>
                <button class="spotlight-close" onclick="closeSpotlight()" title="Close Spotlight">&times;</button>
            </div>
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
async function compareCurrentMatch() {
    if (!pbpData || !pbpData.matches.length || !currentEvent) return;
    const m = pbpData.matches[pbpIndex];
    const redKeys = m.red.teams.map(t => t.team_key);
    const blueKeys = m.blue.teams.map(t => t.team_key);
    const allKeys = [...redKeys, ...blueKeys];

    // Try API first; if it fails (e.g. upcoming event with no matches),
    // build comparison from the local PBP data we already have
    openCompare();
    $('compare-body').innerHTML = '<p class="loading-msg">Fetching comparison data\u2026</p>';
    $('compare-title').textContent = `Match Comparison \u2014 ${m.label}`;

    try {
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
    const num = parseInt(teamKey.replace('frc', ''), 10);
    if (!num) return;

    openLookup();
    $('lookup-title').textContent = `Team Lookup · ${num}`;
    $('lookup-body').innerHTML = '<p class="loading-msg">Loading team data\u2026</p>';

    try {
        const year = currentEventYear || null;
        const data = await API.teamStats(num, year);
        $('lookup-body').innerHTML = renderTeamStats(data);
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
});

// ═══════════════════════════════════════════════════════════
// MATCH HISTORY FROM RANKINGS
// ═══════════════════════════════════════════════════════════

function openMatchHistory() {
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
    const num = parseInt(teamKey.replace('frc', ''), 10);
    if (!num) return;

    // Find team nickname from teamsData
    const teamInfo = teamsData?.find(t => t.team_key === teamKey);
    const nick = teamInfo ? formatTeamName(teamInfo.nickname) : '';

    openMatchHistory();
    $('match-history-title').textContent = `Match History · ${num}${nick ? ` — ${nick}` : ''}`;
    $('match-history-body').innerHTML = '<p class="loading-msg">Loading match history…</p>';

    try {
        const perf = await API.teamPerf(currentEvent, num);
        renderMatchHistoryPanel(perf, num, nick);
    } catch (err) {
        $('match-history-body').innerHTML = `<p class="empty">Error: ${err.message}</p>`;
    }
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
            const score = pm.allianceScore != null ? `${pm.allianceScore}-${pm.opponentScore}` : '–';
            const colorCls = pm.allianceColor === 'Red' ? 'mh-color-red' : 'mh-color-blue';
            const allies = (pm.allianceTeams || []).map(n =>
                `<span class="mh-team-link" title="${nickLookup[n] || ''}" onclick="lookupTeamFromMatchHistory(${n})">${n}</span>`
            ).join(', ');
            const opps = (pm.opponentTeams || []).map(n =>
                `<span class="mh-team-link" title="${nickLookup[n] || ''}" onclick="lookupTeamFromMatchHistory(${n})">${n}</span>`
            ).join(', ');
            rows += `<tr>
                <td>${pm.description}</td>
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
    closeMatchHistory();
    openLookup();
    $('lookup-title').textContent = `Team Lookup · ${teamNum}`;
    $('lookup-body').innerHTML = '<p class="loading-msg">Loading team data\u2026</p>';
    const year = currentEventYear || null;
    API.teamStats(teamNum, year).then(data => {
        $('lookup-body').innerHTML = renderTeamStats(data);
    }).catch(err => {
        $('lookup-body').innerHTML = `<p class="empty">Error: ${err.message}</p>`;
    });
}

// ═══════════════════════════════════════════════════════════
// FLOATING TEAM LOOKUP PANEL
// ═══════════════════════════════════════════════════════════
let _floatMinimized = false;

function toggleFloatingLookup() {
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
        const data = await API.teamStats(num, year);
        body.innerHTML = renderTeamStats(data);
    } catch (err) {
        body.innerHTML = `<div class="float-lookup-empty"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg><p>${err.message}</p></div>`;
        _updateFloatTitleBadge('');
    }
}

/** Open floating lookup pre-filled with a team number (e.g. from PBP click) */
function floatLookupQuick(teamNumber) {
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
    openCompare();
    $('compare-body').innerHTML = '<p class="loading-msg">Fetching comparison data\u2026</p>';
    $('compare-title').textContent = opts.matchLabel
        ? `Match Comparison \u2014 ${opts.matchLabel}`
        : 'Team Comparison';

    try {
        const data = await API.compareTeams(currentEvent, teamKeys);
        renderComparison(data, opts);
    } catch (err) {
        // Fallback: use cached teamsData from the rankings table if available
        if (teamsData) {
            const fallbackTeams = teamKeys.map(tk => {
                const t = teamsData.find(x => x.team_key === tk) || {};
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
                    avg_rp: 0,
                    qual_average: 0,
                    high_score: 0,
                    matches_played: 0,
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

    const stats = [
        { key: 'rank',         label: 'Rank',       fmt: v => v === '-' ? '–' : `#${v}`, lower: true },
        { key: 'opr',          label: 'OPR',        fmt: v => v.toFixed(2) },
        { key: 'epa',          label: 'EPA',        fmt: v => v != null ? v.toFixed(2) : '\u2013' },
        { key: 'wins',         label: 'Wins',       fmt: v => v },
        { key: 'losses',       label: 'Losses',     fmt: v => v, lower: true },
        { key: 'qual_average', label: 'Avg Score',  fmt: v => v.toFixed(1) },
        { key: 'high_score',   label: 'High Score', fmt: v => v },
        { key: 'avg_rp',       label: 'Avg RP',     fmt: v => v.toFixed(2) },
    ];

    // Compute max values for bar widths
    const maxVals = {};
    stats.forEach(s => {
        const vals = teams.map(t => {
            const v = t[s.key];
            return typeof v === 'number' ? v : 0;
        });
        maxVals[s.key] = Math.max(...vals, 0.01);
    });

    // Header
    let html = '<div class="compare-grid" style="--cols:' + teams.length + '">';

    // Team header row
    html += '<div class="comp-label comp-corner"></div>';
    teams.forEach(t => {
        let sideCls = '';
        if (redKeys.has(t.team_key)) sideCls = 'comp-red';
        else if (blueKeys.has(t.team_key)) sideCls = 'comp-blue';
        const loc = [t.state_prov, t.country].filter(Boolean).join(', ');
        html += `
        <div class="comp-header ${sideCls}">
            <div class="comp-team-num">${t.team_number}</div>
            <div class="comp-team-name">${formatTeamName(t.nickname)}</div>
            <div class="comp-team-record">${t.wins}-${t.losses}-${t.ties}</div>
            ${loc ? `<div class="comp-team-loc">${loc}</div>` : ''}
        </div>`;
    });

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
            const display = s.fmt(raw);
            const isBest = teams.length > 1 && v === best && (v !== 0 || s.key === 'losses');
            const pct = maxVals[s.key] > 0 ? Math.round((v / maxVals[s.key]) * 100) : 0;

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
    });

    // EPA Breakdown stacked bar row
    const hasEpaBreakdown = teams.some(t => t.epa_auto != null || t.epa_teleop != null || t.epa_endgame != null);
    if (hasEpaBreakdown) {
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
                    <div class="epa-breakdown-labels">
                        <span class="epa-lbl epa-lbl-auto">A ${a.toFixed(1)}</span>
                        <span class="epa-lbl epa-lbl-teleop">T ${tp.toFixed(1)}</span>
                        <span class="epa-lbl epa-lbl-endgame">E ${eg.toFixed(1)}</span>
                    </div>
                </div>`;
            }
        });
    }

    // Alliance totals row for match mode
    if (isMatchMode) {
        const allianceStats = ['opr', 'epa'];
        html += '<div class="comp-divider" style="grid-column: 1 / -1"></div>';
        allianceStats.forEach(key => {
            const label = key.toUpperCase();
            const redSum = teams.filter(t => redKeys.has(t.team_key)).reduce((s, t) => s + (t[key] || 0), 0);
            const blueSum = teams.filter(t => blueKeys.has(t.team_key)).reduce((s, t) => s + (t[key] || 0), 0);
            const maxSum = Math.max(redSum, blueSum, 0.01);

            html += `<div class="comp-label comp-label-total">Σ ${label}</div>`;

            // Red teams cells + blue teams cells for the sum row
            const redTeamCount = teams.filter(t => redKeys.has(t.team_key)).length;
            const blueTeamCount = teams.filter(t => blueKeys.has(t.team_key)).length;

            // Red sum spans across red columns
            const redPct = Math.round((redSum / maxSum) * 100);
            const bluePct = Math.round((blueSum / maxSum) * 100);
            const redBest = redSum >= blueSum;
            const blueBest = !redBest;

            // Output one cell per team, but show the sum only in the middle cell of each alliance
            teams.forEach((t, i) => {
                const isRed = redKeys.has(t.team_key);
                const isBlue = blueKeys.has(t.team_key);
                const redTeams = teams.filter(t2 => redKeys.has(t2.team_key));
                const blueTeams = teams.filter(t2 => blueKeys.has(t2.team_key));
                const midRedIdx = teams.indexOf(redTeams[Math.floor(redTeams.length / 2)]);
                const midBlueIdx = teams.indexOf(blueTeams[Math.floor(blueTeams.length / 2)]);

                if (i === midRedIdx) {
                    html += `<div class="comp-cell comp-red comp-total ${redBest ? 'comp-best' : ''}">
                        <div class="comp-bar-bg"><div class="comp-bar" style="width:${redPct}%"></div></div>
                        <span class="comp-val">${redSum.toFixed(2)}</span>
                    </div>`;
                } else if (i === midBlueIdx) {
                    html += `<div class="comp-cell comp-blue comp-total ${blueBest ? 'comp-best' : ''}">
                        <div class="comp-bar-bg"><div class="comp-bar" style="width:${bluePct}%"></div></div>
                        <span class="comp-val">${blueSum.toFixed(2)}</span>
                    </div>`;
                } else {
                    const cls = isRed ? 'comp-red' : isBlue ? 'comp-blue' : '';
                    html += `<div class="comp-cell ${cls} comp-total-empty"></div>`;
                }
            });
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
            html += `<li><span class="lb-team has-tooltip">${t.team_number}<span class="custom-tooltip">${_esc(t.nickname)}</span></span> <span class="lb-count">${t.count}</span></li>`;
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
            const winners = (yr.winners || []).map(t => `<span class="has-tooltip">${t.team_number}<span class="custom-tooltip">${_esc(t.nickname)}</span></span>`).join(', ') || '–';
            const finalists = (yr.finalists || []).map(t => `<span class="has-tooltip">${t.team_number}<span class="custom-tooltip">${_esc(t.nickname)}</span></span>`).join(', ') || '–';
            const impact = yr.impact ? `<span class="has-tooltip">${yr.impact.team_number}<span class="custom-tooltip">${_esc(yr.impact.nickname)}</span></span>` : '–';
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
    // Close the more menu if open
    const moreMenu = document.getElementById('mob-more-menu');
    if (moreMenu) moreMenu.classList.remove('open');

    // Use the existing tab switching mechanism
    const tabBtn = document.querySelector(`.tab[data-tab="${tabName}"]`);
    if (tabBtn) tabBtn.click();

    // Sync bottom nav active state
    syncMobileNav(tabName);
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
}

function toggleMobileMore() {
    const menu = document.getElementById('mob-more-menu');
    menu.classList.toggle('open');
}

// Close more menu on outside click
document.addEventListener('click', e => {
    const menu = document.getElementById('mob-more-menu');
    if (!menu || !menu.classList.contains('open')) return;
    if (!e.target.closest('#mob-more-menu') && !e.target.closest('.mob-nav-btn[data-tab="more"]')) {
        menu.classList.remove('open');
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
    const toolbar = `<div class="rankings-toolbar">
        <button class="rankings-view-toggle" onclick="toggleRankingsView()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            ${rankingsCardView ? 'Table View' : 'Card View'}
        </button>
    </div>`;

    if (!rankingsCardView) return toolbar;

    const cards = teams.map(t => {
        const name = formatTeamName(t.nickname);
        const avatarImg = t.avatar
            ? `<img src="${t.avatar}" class="rank-card-avatar" alt="" loading="lazy">`
            : `<span class="rank-card-avatar-placeholder">${t.team_number}</span>`;
        const isIntl = highlightForeign && t.country && eventCountry && t.country !== eventCountry;
        const isRookie = highlightRookie && t.rookie_year && currentEventYear && t.rookie_year >= currentEventYear;

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
                <div class="rank-card-stat"><div class="rank-card-stat-val">${t.opr}</div><div class="rank-card-stat-label">OPR</div></div>
                <div class="rank-card-stat"><div class="rank-card-stat-val">${t.epa != null ? t.epa : '\u2013'}</div><div class="rank-card-stat-label">EPA</div></div>
                <div class="rank-card-stat"><div class="rank-card-stat-val">${t.ranking_points != null ? t.ranking_points : '\u2013'}</div><div class="rank-card-stat-label">RP</div></div>
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
            API.eventTeams(eventKey).then(data => {
                if (data && !data.error) {
                    $('event-teams').innerHTML = buildTeamTable(data.teams || data);
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
    window.toggleSettings = function() {
        const menu = document.getElementById('settings-menu');
        if (!menu) return;

        if (window.innerWidth <= 768) {
            const isOpen = !menu.classList.contains('hidden');
            if (isOpen) {
                menu.classList.add('hidden');
                document.getElementById('settings-backdrop')?.remove();
                document.body.style.overflow = '';
            } else {
                menu.classList.remove('hidden');
                document.body.style.overflow = 'hidden';
                // Add backdrop
                if (!document.getElementById('settings-backdrop')) {
                    const bd = document.createElement('div');
                    bd.id = 'settings-backdrop';
                    bd.className = 'settings-backdrop';
                    bd.onclick = () => {
                        menu.classList.add('hidden');
                        bd.remove();
                        document.body.style.overflow = '';
                    };
                    document.body.appendChild(bd);
                }
            }
        } else {
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
