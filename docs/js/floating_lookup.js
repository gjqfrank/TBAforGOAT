/* ═══════════════════════════════════════════════════════════
   floating_lookup.js — extracted from app.js

   Loaded as a classic <script> *before* app.js. Top-level
   declarations live in the shared global declarative
   environment, so cross-file references work as before.
   Section: FLOATING TEAM LOOKUP PANEL
   ═══════════════════════════════════════════════════════════ */

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
        const data = await API.teamStats(num, year);
        body.innerHTML = renderTeamStats(data);
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
    const inLookup = document.activeElement?.closest('#float-lookup');
    const inNotes  = document.activeElement?.closest('#gn-panel');

    // Q toggles the floating lookup even when its own input is focused
    if ((e.key === 'q' || e.key === 'Q') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const panel = $('float-lookup');
        if (!panel.classList.contains('hidden')) {
            e.preventDefault();
            closeFloatingLookup();
            return;
        }
        // Allow opening even when notes input is focused (Q is not a notes char)
        if (!isInput || inNotes) {
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
    _syncUrl({ compare: teamKeys.map(k => k.replace('frc','')).join(',') });
    $('compare-body').innerHTML = '<p class="loading-msg">Fetching comparison data\u2026</p>';
    if (!isMob) {
        $('compare-title').textContent = opts.matchLabel
            ? `Match Comparison: ${opts.matchLabel}`
            : 'Team Comparison';
    }

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
                    team_number: t.team_number || parseInt(tk.replace(/^frc/, '')),
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

    const stats = [
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

    // EPA Breakdown stacked bar row (visual only) + number rows
    const hasEpaBreakdown = teams.some(t => t.epa_auto != null || t.epa_teleop != null || t.epa_endgame != null);
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
        const allianceStats = ['opr', 'epa'];
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

