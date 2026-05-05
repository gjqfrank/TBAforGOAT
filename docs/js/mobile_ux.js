/* ═══════════════════════════════════════════════════════════
   mobile_ux.js — extracted from app.js

   Loaded as a classic <script> *before* app.js. Top-level
   declarations live in the shared global declarative
   environment, so cross-file references work as before.
   Section: MOBILE UX IMPROVEMENTS
   ═══════════════════════════════════════════════════════════ */

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
    // Dynamic BD navbar: swap standard nav ↔ Breakdown controls on mobile
    // Dynamic BS navbar: swap standard nav ↔ BS input pill on mobile
    const stdNav = document.querySelector('.mobile-bottom-nav-inner');
    const pbpNav = document.getElementById('mob-pbp-nav');
    const bdNav  = document.getElementById('mob-bd-nav');
    const bsNav  = document.getElementById('mob-bs-nav');
    const bsMacros = document.getElementById('mob-bs-macros');
    if (stdNav && pbpNav) {
        const isPbp = tabName === 'playbyplay';
        const isBd  = tabName === 'breakdown';
        const isBs  = tabName === 'battlestation';
        stdNav.style.display = (isPbp || isBd || isBs) ? 'none' : '';
        pbpNav.classList.toggle('hidden', !isPbp);
        if (bdNav) {
            if (isBd) { bdNav.classList.remove('hidden'); bdNav.style.display = 'flex'; }
            else       { bdNav.classList.add('hidden');    bdNav.style.display = '';    }
        }
        if (bsNav)    bsNav.classList.toggle('hidden', !isBs);
        if (bsMacros) bsMacros.classList.toggle('hidden', !isBs);
        if (isPbp) _syncMobPbpLabel();
        if (isBd)  _syncMobBdLabel();
        if (isBs)  _syncMobBsMacros();
    }
}

/**
 * Toggle between Breakdown custom nav and standard nav.
 * Called by the back button inside the BD nav bar.
 */
function toggleMobileBdNav() {
    const stdNav = document.querySelector('.mobile-bottom-nav-inner');
    const bdNav  = document.getElementById('mob-bd-nav');
    if (!stdNav || !bdNav) return;
    const bdVisible = !bdNav.classList.contains('hidden');
    if (bdVisible) {
        stdNav.style.display = '';
        bdNav.classList.add('hidden');
        document.querySelectorAll('.mob-nav-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.tab === 'breakdown');
        });
    } else {
        stdNav.style.display = 'none';
        bdNav.classList.remove('hidden');
        _syncMobBdLabel();
    }
}

/** Update the mobile Breakdown nav bar match label */
function _syncMobBdLabel() {
    const lbl = document.getElementById('mob-bd-label');
    if (!lbl) return;
    if (bdData && bdData.matches && bdData.matches.length) {
        const m = bdData.matches[bdIndex];
        lbl.textContent = (m?.label || 'Match').replace(/^Qualification\s*/i, 'Qual ');
    } else {
        lbl.textContent = 'Match';
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

/** Populate mobile BS macro chips */
function _syncMobBsMacros() {
    const container = document.getElementById('mob-bs-macros');
    if (!container) return;
    if (container.children.length) return; // already built
    const LEXICON = {
        AUTO_START:    { label: 'Auto',        color: 'emerald' },
        TELEOP_START:  { label: 'Teleop',      color: 'sky' },
        ENDGAME_START: { label: 'Endgame',     color: 'amber' },
        MATCH_OVER:    { label: 'Match Over',  color: 'slate' },
        FIELD_FAULT:   { label: 'Field Fault', color: 'red' },
    };
    Object.entries(LEXICON).forEach(([code, def]) => {
        const btn = document.createElement('button');
        btn.className = `bs-chip bs-chip-${def.color}`;
        btn.textContent = def.label;
        btn.onclick = () => BattleStation._onMacro(code);
        container.appendChild(btn);
    });
}

/** Toggle between BS custom nav and standard nav on mobile */
function toggleMobileBsNav() {
    const stdNav = document.querySelector('.mobile-bottom-nav-inner');
    const bsNav  = document.getElementById('mob-bs-nav');
    const bsMacros = document.getElementById('mob-bs-macros');
    if (!stdNav || !bsNav) return;
    const bsVisible = !bsNav.classList.contains('hidden');
    if (bsVisible) {
        stdNav.style.display = '';
        bsNav.classList.add('hidden');
        if (bsMacros) bsMacros.classList.add('hidden');
        document.querySelectorAll('.mob-nav-btn').forEach(b => {
            b.classList.toggle('active', false);
        });
        // highlight "more" since BS is under more
        const moreBtn = document.querySelector('.mob-nav-btn[data-tab="more"]');
        if (moreBtn) moreBtn.classList.add('active');
    } else {
        stdNav.style.display = 'none';
        bsNav.classList.remove('hidden');
        if (bsMacros) bsMacros.classList.remove('hidden');
        _syncMobBsMacros();
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
var _mobUtilMode = null; // var: read by breakdown.js

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
    } else if (mode === 'bd-matches') {
        header.innerHTML = '<span class="mob-util-title">Select Match</span>';
        _buildMobBdMatchPicker(body);
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
    // Clear spotlight state when closing mobile spotlight panel
    if (_mobUtilMode === 'spotlight') {
        _spotlightTeam = null;
        document.querySelectorAll('.bd-robot-card').forEach(card => {
            card.classList.remove('bd-spotlight-active', 'bd-spotlight-dimmed');
        });
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

/* Match picker panel content for Breakdown tab */
function _buildMobBdMatchPicker(container) {
    if (!bdData || !bdData.matches) {
        container.innerHTML = '<div class="mob-util-lookup-empty">No matches loaded</div>';
        return;
    }
    const list = document.createElement('div');
    list.className = 'mob-match-picker-list';
    bdData.matches.forEach((m, i) => {
        const btn = document.createElement('button');
        const hasBd = m.has_breakdown;
        btn.className = 'mob-match-picker-item' + (i === bdIndex ? ' active' : '');
        btn.textContent = (hasBd ? '● ' : '○ ') + (m?.label || 'Match ' + (i + 1)).replace(/^Qualification\s*/i, 'Qual ');
        if (hasBd) btn.style.color = 'var(--success, #22c55e)';
        btn.onclick = () => { bdGoTo(i); closeMobUtilPanel(); };
        list.appendChild(btn);
    });
    container.appendChild(list);
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
            ? `<img src="${t.avatar}" class="rank-card-avatar" width="32" height="32" alt="">`
            : `<span class="rank-card-avatar-placeholder">${t.team_number}</span>`;
        const isIntl = highlightForeign && t.country && eventCountry && t.country !== eventCountry;
        const isRookie = highlightRookie && t.rookie_year && currentEventYear && t.rookie_year >= currentEventYear;
        const oprVal = parseFloat(t.opr);
        const oprCls = !isNaN(oprVal) && oprVal >= p75OPR ? ' opr-top25' : (!isNaN(oprVal) && oprVal > avgOPR ? ' opr-above-avg' : '');
        const epaVal = parseFloat(t.epa);
        const epaCls = !isNaN(epaVal) && epaVal >= p75EPA ? ' epa-top25' : (!isNaN(epaVal) && epaVal > avgEPA ? ' epa-above-avg' : '');

        return `<div class="rank-card${isIntl ? ' foreign-team-row' : ''}${isRookie ? ' rookie-team-row' : ''}" data-team-key="${t.team_key}">
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
