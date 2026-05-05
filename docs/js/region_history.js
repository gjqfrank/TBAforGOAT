/* ═══════════════════════════════════════════════════════════
   region_history.js — extracted from app.js

   Loaded as a classic <script> *before* app.js. Top-level
   declarations live in the shared global declarative
   environment, so cross-file references work as before.
   Section: Region & Event History tab
   ═══════════════════════════════════════════════════════════ */

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
    html += _statCard('Hall of Fame', `${data.hof_count}`, data.hof_count && data.hof_teams ? data.hof_teams.map(t => t.team_number).join(', ') : 'none yet');
    html += _statCard('Einstein Teams', `${data.einstein_count}`, data.einstein_count && data.einstein_teams ? `top: ${data.einstein_teams.slice(0,3).map(t => t.team_number).join(', ')}` : 'none yet');
    html += '</div>';

    // HoF teams detail
    if (data.hof_teams && data.hof_teams.length) {
        html += '<div class="history-detail-section">';
        html += '<h4>Hall of Fame Teams</h4>';
        html += '<div class="history-team-chips">';
        for (const t of data.hof_teams) {
            html += `<span class="history-chip hof-chip"><span class="chip-team">${t.team_number}</span> <span class="chip-name">${_esc(t.nickname)}</span> <span class="chip-years">${t.years.join(', ')}</span></span>`;
        }
        html += '</div></div>';
    }

    // Einstein Winners
    if (data.einstein_winners && data.einstein_winners.length) {
        html += '<div class="history-detail-section">';
        html += '<h4>Einstein Winners</h4>';
        html += '<div class="history-team-chips">';
        for (const t of data.einstein_winners) {
            html += `<span class="history-chip einstein-win-chip"><span class="chip-team">${t.team_number}</span> <span class="chip-name">${_esc(t.nickname)}</span> <span class="chip-years">${t.years.join(', ')}</span></span>`;
        }
        html += '</div></div>';
    }

    // Impact finalists
    if (data.impact_finalists && data.impact_finalists.length) {
        html += '<div class="history-detail-section">';
        html += '<h4>Impact Award Finalists</h4>';
        html += '<div class="history-team-chips">';
        for (const t of data.impact_finalists) {
            html += `<span class="history-chip impact-chip"><span class="chip-team">${t.team_number}</span> <span class="chip-name">${_esc(t.nickname)}</span> <span class="chip-years">${t.years.join(', ')}</span></span>`;
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
            html += `<tr><td class="team-num">${t.team_number}</td><td>${_esc(t.nickname)}</td><td class="num">${t.years.length}</td><td class="years-cell">${t.years.join(', ')}</td></tr>`;
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
            html += `<span class="history-chip visitor-chip"><span class="chip-team">${v.team_number}</span> <span class="chip-name">${_esc(v.nickname)}</span> <span class="chip-country">${_esc(v.country)}</span> <span class="chip-count">${v.appearances}×</span></span>`;
        });
        if (vis.length > SHOW) {
            const extra = vis.length - SHOW;
            html += `<span class="history-chip-more" onclick="this.nextElementSibling.classList.toggle('hidden');this.textContent=this.textContent.startsWith('+')?'− collapse':'+${extra} more'">+${extra} more</span>`;
            html += '<span class="history-chip-extra hidden">';
            vis.slice(SHOW).forEach(v => {
                html += `<span class="history-chip visitor-chip"><span class="chip-team">${v.team_number}</span> <span class="chip-name">${_esc(v.nickname)}</span> <span class="chip-country">${_esc(v.country)}</span> <span class="chip-count">${v.appearances}×</span></span>`;
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


