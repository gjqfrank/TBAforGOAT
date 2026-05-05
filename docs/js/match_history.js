/* ═══════════════════════════════════════════════════════════
   match_history.js — extracted from app.js

   Loaded as a classic <script> *before* app.js. Top-level
   declarations live in the shared global declarative
   environment, so cross-file references work as before.
   Section: MATCH HISTORY FROM RANKINGS
   ═══════════════════════════════════════════════════════════ */

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
            const colorCls = pm.allianceColor === 'Red' ? 'mh-color-red' : 'mh-color-blue';
            const allyCls = pm.allianceColor === 'Red' ? 'mh-ally-red' : 'mh-ally-blue';
            const oppCls = pm.allianceColor === 'Red' ? 'mh-ally-blue' : 'mh-ally-red';
            const allyWon = pm.result === 'Won';
            const oppWon = pm.result === 'Lost';
            let score = '–';
            if (pm.allianceScore != null) {
                const aCls = 'mh-sc-ally' + (allyWon ? ' mh-sc-win' : '');
                const oCls = oppWon ? ' mh-sc-win' : '';
                score = `<span class="${aCls}">${pm.allianceScore}</span> – <span class="${oCls}">${pm.opponentScore}</span>`;
            }
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
                <td class="mh-score-cell">${score}</td>
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

