/* ═══════════════════════════════════════════════════════════
   event_select.js — extracted from app.js

   Loaded as a classic <script> *before* app.js. Top-level
   declarations live in the shared global declarative
   environment, so cross-file references work as before.
   Section: 1. EVENT SELECTION
   ═══════════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════════════
// 1. EVENT SELECTION
// ═══════════════════════════════════════════════════════════

let _modeSwitchGeneration = 0;

// ── Season events loader ──────────────────────────────────
async function loadSeasonEvents() {
    const status = $('season-status');
    const seasonYear = 2026;
    status.textContent = `Loading ${seasonYear} events…`;
    try {
        let loaded = false;
        const staticCandidates = [`data/season_${seasonYear}.json`];
        for (const file of staticCandidates) {
            try {
                const resp = await fetch(file);
                if (!resp.ok) continue;
                seasonEventsRaw = await resp.json();
                loaded = true;
                break;
            } catch (_) { /* try next */ }
        }
        if (!loaded) throw new Error('No static season file');
        populateSeasonFilters();
        filterSeasonEvents();
        status.textContent = '';
        const badge = $('season-count-badge');
        if (badge) badge.textContent = `${seasonEventsRaw.length} events`;
    } catch (err) {
        try {
            seasonEventsRaw = await API.seasonEvents(seasonYear);
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
    const label = 'TBA';
    const seasonYear = 2026;
    status.textContent = `Refreshing from ${label}…`;
    try {
        seasonEventsRaw = await API.seasonEvents(seasonYear, true);
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

function populateSeasonFilters() {
    const regions = [...new Set(seasonEventsRaw.map(e => e.region))].sort((a, b) => a.localeCompare(b));
    const regionSel = $('season-filter-region');
    regionSel.innerHTML = '<option value="">All Regions</option>'
        + regions.map(r => `<option value="${r}">${r}</option>`).join('');

    const weekSel = $('season-filter-week');
    const weeks = [...new Set(seasonEventsRaw.map(e => e.week).filter(w => w !== null && w !== undefined))].sort((a, b) => a - b);
    weekSel.innerHTML = '<option value="">All Weeks</option>'
        + weeks.map(w => `<option value="${w}">Week ${w + 1}</option>`).join('');

    const typeSel = $('season-filter-type');
    if (typeSel) {
        typeSel.classList.add('hidden');
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
                // Month-based filter
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
// NOTE: wrapped in DOMContentLoaded so $() (defined inline + as const in app.js)
// is guaranteed available regardless of script load order.
document.addEventListener('DOMContentLoaded', () => {
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
}); // end DOMContentLoaded

function highlightDropdownItem(items) {
    items.forEach(el => el.classList.remove('highlighted'));
    if (items[seasonDropdownIdx]) {
        items[seasonDropdownIdx].classList.add('highlighted');
        items[seasonDropdownIdx].scrollIntoView({ block: 'nearest' });
    }
}

// loadSeasonEvents() and loadRegionalPool() are kicked off from app.js's
// init block (search 'typeof loadSeasonEvents'); top-level invocations
// here would crash because they call getActiveAPI() which is defined in
// app.js (loaded LAST).

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

// loadRegionalPool() is invoked from app.js init (typeof check);
// calling it here at top-level crashes because it calls getActiveAPI()
// which is defined in app.js (loaded LAST).

async function loadRegionalPool() {
    if (_loadingRegionalPool) return;
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

    // Snapshot of mode + generation at call time — lets us bail out if the user
    // switches competition mode while the fetch is still in-flight.
    const _loadMode = competitionMode;
    const _loadGen  = _modeSwitchGeneration;

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
    Realtime.unsubscribe();
    _pbpConnCache = {};
    _pbpConnAllTime = false;
    _pbpAwardsCache = {};
    _gatoolUpdatesCache = {};
    _sponsorsShownTeams.clear();
    _playoffFirstsCache = null;
    _pbpLastSig = null;
    _pbpShellMounted = false;
    _bumpEnrichmentVersion();
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
        try {
            const _ac = new AbortController();
            const _tm = setTimeout(() => _ac.abort(), 5000);
            const _r = await fetch(`${API_BASE}/api/events/${code}/snapshot`, { signal: _ac.signal });
            clearTimeout(_tm);
            if (_r.ok) _snap = await _r.json();
        } catch (_) { /* snapshot unavailable — fall back */ }

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

        // If mode switched while Phase 1 was awaiting, discard everything:
        // resetEventData() already cleared the badge and globals, so just exit.
        if (competitionMode !== _loadMode || _modeSwitchGeneration !== _loadGen) {
            if (btn) { btn.disabled = false; btn.textContent = btn.dataset.origText || 'Load Event'; btn.classList.remove('btn-loading'); }
            badge.textContent = '';
            badge.className = 'event-badge hidden';
            return;
        }

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
        if (competitionMode !== _loadMode || _modeSwitchGeneration !== _loadGen) return;
        fadeIn('rankings-container');
        _scheduleFrcAvatarPatch(currentEvent);

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
        // NOTE: do NOT clear #pbp-footer — it holds static action buttons
        // (Compare/Breakdown/Storyline) that are never re-injected by JS.
        // Wiping innerHTML here left an empty bordered box above prior connections.
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
            if (_snap.summary) {
                summaryData = _snap.summary;
                updateTabDots();
            }
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
                allianceData = allianceResult;
                autoCacheTab('alliances', allianceResult);
                // If the user is already viewing a playoff match, re-render so that
                // the bench team card (which requires allianceData) is shown.
                if (allianceData?.is_championship && pbpData?.matches) {
                    const _activeTab = document.querySelector('.tab.active');
                    if (_activeTab && _activeTab.dataset.tab === 'pbp') {
                        const _curMatch = pbpData.matches[pbpIndex];
                        if (_curMatch && _curMatch.comp_level && _curMatch.comp_level !== 'qm') {
                            renderPbpMatch();
                        }
                    }
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
                        allianceData = ar;
                        autoCacheTab('alliances', allianceData);
                    }).catch(() => {});
                }, 5000);
            }
        }).finally(phase2Check);

        // Summary — pre-fetch so tab switch is instant
        {
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
                    // For championship events, proactively load the awards payload
                    // (einstein_contenders etc.) regardless of the active tab, so
                    // Einstein Winner badges are ready when the user opens PBP.
                    if (data.is_championship && !data.einstein_contenders) {
                        loadSummaryAwards();
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
                    if (cached.is_championship && !cached.einstein_contenders) {
                        loadSummaryAwards();
                    }
                }
            });
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

// `var` (not `let`) — read by app.js / mobile_ux.js loaded after this script
// but also touched by handlers that may fire during initial mount.
var teamsData = null;      // cached teams list for sorting
var teamsSortCol = 'rank';  // current sort column
var teamsSortAsc = true;    // sort direction

// ── TIMS overrides in-memory cache ──────────────────────
// `var` — referenced by editor.js (loaded BEFORE event_select.js); using
// `let` would put it in TDZ for any editor.js handler firing early.
var _timsCache = {};  // { teamNumber: { nickname, organization, location, top_sponsors, ... } }

async function _loadTimsOverrides() {
    if (!teamsData) return;
    _timsCache = {};
    // Load ALL local overrides in a single IndexedDB transaction (batch read)
    const teamKeySet = new Set(teamsData.map(t => t.team_key));
    try {
        const allRows = await DB.getAllOverrides();
        for (const row of allRows) {
            if (teamKeySet.has(row.team_key)) {
                const num = parseInt(row.team_key.replace(/\D/g, ''), 10);
                if (num) _timsCache[num] = row;
            }
        }
    } catch { /* ignore */ }
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
    _bumpEnrichmentVersion();
    // Apply the current sort so upcoming events (sorted by team_number) render correctly
    sortTeamsData();
    // Render immediately with available data — don't block on TIMS overrides
    const html = rankingsCardView
        ? renderTeamCards(teamsData)
        : renderTeamTable(teamsData, teamsSortCol, teamsSortAsc);
    // Load TIMS overrides async; re-render only if any are found (avoids unnecessary reflow)
    _loadTimsOverrides().then(() => {
        if (teamsData !== teams) return; // user switched events
        if (!Object.keys(_timsCache).length) return;
        sortTeamsData();
        const el = $('event-teams');
        if (el) el.innerHTML = rankingsCardView
            ? renderTeamCards(teamsData)
            : renderTeamTable(teamsData, teamsSortCol, teamsSortAsc);
    }).catch(() => {});
    return html;
}

/** After initial FRC rankings render, patch avatar cells for any teams that loaded
 *  without one (backend prefetch runs async; 4 s is enough for it to complete). */
function _scheduleFrcAvatarPatch(eventKey) {
    if (!teamsData) return;
    const missing = teamsData.filter(t => !t.avatar);
    if (!missing.length) return;
    setTimeout(async () => {
        if (currentEvent !== eventKey || !teamsData) return;
        try {
            const fresh = await API.eventTeams(eventKey);
            if (!fresh || !fresh.length || currentEvent !== eventKey) return;
            const freshMap = new Map((fresh.teams || fresh).map(t => [t.team_key, t.avatar]));
            let patched = 0;
            for (const team of teamsData) {
                const newAvatar = freshMap.get(team.team_key);
                if (!team.avatar && newAvatar) {
                    team.avatar = newAvatar;
                    const row = document.querySelector(`#event-teams tr[data-team-key="${team.team_key}"]`);
                    if (row) {
                        const cell = row.querySelector('.team-avatar-cell');
                        if (cell) cell.innerHTML = `<img src="${newAvatar}" class="team-avatar" width="32" height="32" alt="">`;
                    }
                    // Card view: patch the card avatar too
                    const card = document.querySelector(`#event-teams .rank-card[data-team-key="${team.team_key}"]`);
                    if (card) {
                        const ph = card.querySelector('.rank-card-avatar-placeholder');
                        if (ph) ph.outerHTML = `<img src="${newAvatar}" class="rank-card-avatar" width="32" height="32" alt="">`;
                    }
                    patched++;
                }
            }
            if (patched) console.debug(`[Avatar] Patched ${patched} FRC avatars`);
        } catch { /* silent — avatars are non-critical */ }
    }, 4000);
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
    const viewToggle = `<button class="rankings-view-toggle" onclick="toggleRankingsView()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        ${rankingsCardView ? 'Table View' : 'Card View'}
    </button>`;
    const toolbar = `<div class="rankings-toolbar">
        <label class="toggle-label"><input type="checkbox" ${compact ? 'checked' : ''} onchange="toggleRankingsCompact(this.checked)"> Compact</label>
        <label class="toggle-label school-toggle"><input type="checkbox" ${school ? 'checked' : ''} onchange="toggleRankingsSchool(this.checked)"> School / Org</label>
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
                ${compact ? '' : th('epa', 'EPA')}
                <th class="sortable-th col-ranking_points${teamsSortCol === 'ranking_points' ? ' sorted' : ''}" onclick="sortTeams('ranking_points')"><span class="rp-header-note" title="Unofficial, calculated by TBA">RP*</span>${teamsSortCol === 'ranking_points' ? arrow : ''}</th>
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
                    ? `<img src="${t.avatar}" class="team-avatar" width="32" height="32" alt="">`
                    : `<span class="team-avatar team-avatar-placeholder">${t.team_number}</span>`;
                const isIntl = highlightForeign && t.country && eventCountry && t.country !== eventCountry;
                const isRookie = highlightRookie && t.rookie_year && currentEventYear && t.rookie_year >= currentEventYear;
                const oprVal = parseFloat(t.opr);
                const oprAboveCls = !isNaN(oprVal) && oprVal >= p75OPR ? ' opr-top25-rank' : (!isNaN(oprVal) && oprVal > avgOPR ? ' opr-above-avg-rank' : '');
                const epaVal = parseFloat(t.epa);
                const epaAboveCls = !isNaN(epaVal) && epaVal >= p75EPA ? ' epa-top25-rank' : (!isNaN(epaVal) && epaVal > avgEPA ? ' epa-above-avg-rank' : '');
                return `
            <tr class="${isIntl ? 'foreign-team-row' : ''}${isRookie ? ' rookie-team-row' : ''}" data-team-key="${t.team_key}" data-country="${t.country || ''}" data-rookie-year="${t.rookie_year || ''}">
                <td class="compare-td"><input type="checkbox" class="compare-cb" data-team="${t.team_key}" ${compareSelection.has(t.team_key) ? 'checked' : ''} onclick="toggleCompareTeam('${t.team_key}')"></td>
                <td class="rank${Number(t.rank) >= 1 && Number(t.rank) <= 8 ? ' rank-top8' : ''}">${t.rank != null ? t.rank : '\u2013'}</td>
                <td class="team-avatar-cell">${avatarImg}</td>
                <td class="team-num">${t.team_number}</td>
                <td class="team-name">${name}</td>
                ${compact ? '' : `<td class="location">${loc}</td>`}
                ${school ? `<td class="location">${t.school_name || ''}</td>` : ''}
                <td class="stat">${t.wins}-${t.losses}-${t.ties}</td>
                <td class="stat stat-opr${oprAboveCls}">${t.opr}</td>
                ${compact ? '' : `<td class="stat stat-epa${epaAboveCls}">${t.epa != null ? t.epa : '\u2013'}</td>`}
                <td class="stat">${t.ranking_points != null ? t.ranking_points : '\u2013'}</td>
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


