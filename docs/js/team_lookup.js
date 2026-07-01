/* ═══════════════════════════════════════════════════════════
   team_lookup.js — extracted from app.js

   Loaded as a classic <script> *before* app.js. Top-level
   declarations live in the shared global declarative
   environment, so cross-file references work as before.
   Section: 4/5/5b. TEAM LOOKUP + HEAD TO HEAD
   ═══════════════════════════════════════════════════════════ */

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
        const hofYears = (d.hof_awards || []).map(a => a.year).join(', ');
        prestigeBadges += `<span class="team-badge hof-badge has-tooltip">🏛️ Hall of Fame<span class="custom-tooltip">Chairman's / FIRST Impact Award Winner at Championship (${hofYears})</span></span>`;
    }
    if (d.is_impact_finalist) {
        const impactYears = (d.impact_finalist_awards || []).map(a => a.year).join(', ');
        prestigeBadges += `<span class="team-badge impact-badge has-tooltip">🏆 Impact Finalist<span class="custom-tooltip">FIRST Impact Award Finalist at Championship (${impactYears})</span></span>`;
    }
    if (d.is_einstein_winner) {
        const einsteinYears = (d.einstein_wins || []).map(a => a.year).join(', ');
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
var _h2hAllTime = false;  // var: read by event_select.js

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

    // Bold colored team number chip with tooltip
    const tnChip = (num, cls) => {
        const n = nicks[String(num)];
        const tip = n ? `<span class="custom-tooltip">${n}</span>` : '';
        return `<span class="h2h-match-num ${cls} has-tooltip">${num}${tip}</span>`;
    };
    const tChips = (nums, cls) => nums.map(n => tnChip(n, cls)).join(' ');

    const nickA = nicks[String(d.team_a)] || '';
    const nickB = nicks[String(d.team_b)] || '';

    return `
    <div class="h2h-card">
        <div class="h2h-header">
            <span class="h2h-team-num red-text has-tooltip">${d.team_a}${nickA ? `<span class="custom-tooltip">${nickA}</span>` : ''}</span>
            <span class="vs-label">vs</span>
            <span class="h2h-team-num blue-text has-tooltip">${d.team_b}${nickB ? `<span class="custom-tooltip">${nickB}</span>` : ''}</span>
            <span class="h2h-score-badge"><span class="red-text">${s.team_a_wins}</span><span class="h2h-score-dash">–</span><span class="blue-text">${s.team_b_wins}</span></span>
        </div>

        <p class="muted" style="text-align:center; margin:.2rem 0 1.2rem">
            ${s.total_opponent_matches} playoff match${s.total_opponent_matches !== 1 ? 'es' : ''} as opponents
            &nbsp;·&nbsp; ${s.total_ally_matches} as allies
            &nbsp;·&nbsp; Years: ${d.years_checked.join(', ')}
        </p>

        ${d.opponent_matches.length ? `
        <h4>As Opponents</h4>
        <table class="data-table compact">
            <thead><tr>
                <th>Match</th><th>Event</th><th>Red</th><th></th><th>Blue</th><th>Winner</th>
            </tr></thead>
            <tbody>
                ${d.opponent_matches.map(m => {
                    const winnerIsA = m.winner === String(d.team_a);
                    const winnerCls = winnerIsA ? 'red-text' : (m.winner === 'tie' ? '' : 'blue-text');
                    const winnerNum = winnerIsA ? d.team_a : d.team_b;
                    return `
                <tr>
                    <td class="stat">${m.match_label || m.match_key.split('_').pop()}</td>
                    <td class="muted">${m.event_name || m.event_key} (${m.year})</td>
                    <td class="stat">${tChips(m.red_teams, 'red-text')}</td>
                    <td class="stat h2h-score-cell"><span class="red-text">${m.red_score}</span><span class="h2h-score-dash">–</span><span class="blue-text">${m.blue_score}</span></td>
                    <td class="stat">${tChips(m.blue_teams, 'blue-text')}</td>
                    <td class="stat ${winnerCls}"><span class="h2h-match-num">${m.winner === 'tie' ? '–' : winnerNum}</span></td>
                </tr>`;
                }).join('')}
            </tbody>
        </table>` : ''}

        ${d.ally_matches.length ? `
        <h4>As Allies</h4>
        <table class="data-table compact">
            <thead><tr>
                <th>Match</th><th>Event</th><th>Red</th><th></th><th>Blue</th><th>Result</th>
            </tr></thead>
            <tbody>
                ${d.ally_matches.map(m => {
                    const aOnRed = m.red_teams.map(String).includes(String(d.team_a));
                    const resultCls = m.winner === 'both' ? (aOnRed ? 'red-text' : 'blue-text') : 'muted';
                    return `
                <tr>
                    <td class="stat">${m.match_label || m.match_key.split('_').pop()}</td>
                    <td class="muted">${m.event_name || m.event_key} (${m.year})</td>
                    <td class="stat">${tChips(m.red_teams, 'red-text')}</td>
                    <td class="stat h2h-score-cell"><span class="red-text">${m.red_score}</span><span class="h2h-score-dash">–</span><span class="blue-text">${m.blue_score}</span></td>
                    <td class="stat">${tChips(m.blue_teams, 'blue-text')}</td>
                    <td class="stat ${resultCls}">${m.winner === 'both' ? '✓ Won' : 'Lost'}</td>
                </tr>`;
                }).join('')}
            </tbody>
        </table>` : ''}

        ${!d.opponent_matches.length && !d.ally_matches.length
            ? '<p class="empty">No playoff history found between these teams.</p>' : ''}
    </div>`;
}


// ═══════════════════════════════════════════════════════════
