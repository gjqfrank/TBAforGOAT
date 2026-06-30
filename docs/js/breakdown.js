/* ═══════════════════════════════════════════════════════════
   breakdown.js — extracted from app.js

   Loaded as a classic <script> *before* app.js. Top-level
   declarations live in the shared global declarative
   environment, so cross-file references work as before.
   Section: 7. SCORE BREAKDOWN (+ game renderers)
   ═══════════════════════════════════════════════════════════ */

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
        _syncMobBdLabel();
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
    _syncMobBdLabel();
    loadBdMatch();
}

function bdPrev() {
    if (bdIndex > 0) {
        bdIndex--;
        $('bd-match-select').value = bdIndex;
        _syncMobBdLabel();
        loadBdMatch();
    }
}

function bdNext() {
    if (bdData && bdIndex < bdData.matches.length - 1) {
        bdIndex++;
        $('bd-match-select').value = bdIndex;
        _syncMobBdLabel();
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
    _syncMobBdLabel();

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
    if (data.game_year >= 2026) {
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

var _spotlightTeam = null;  // var: read by comparison.js / mobile_ux.js

function toggleSpotlight(teamNum, color) {
    if (_spotlightTeam === teamNum) { closeSpotlight(); return; }

    // On mobile, render spotlight inside the mob-util panel
    if (window.innerWidth <= 768) {
        _openMobSpotlight(teamNum, color);
        return;
    }

    const panel = $('bd-spotlight');
    if (!panel) return;
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

function _openMobSpotlight(teamNum, color) {
    _spotlightTeam = teamNum;

    const m = bdData && bdData.matches ? bdData.matches[bdIndex] : null;
    const bd = bdCache[m?.key];
    if (!bd) return;

    const alliance = bd[color];
    if (!alliance) return;
    const abdwn = alliance.breakdown;
    const robot = abdwn.robots.find(r => r.team_number === teamNum);
    if (!robot) return;

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
    const oprStr = st.opr != null ? st.opr : '\u2013';
    const epaStr = st.epa != null ? st.epa : '\u2013';
    const colorLabel = color === 'red' ? 'Red Alliance' : 'Blue Alliance';

    openMobUtilPanel('spotlight');
    const body = document.getElementById('mob-util-body');
    const header = document.getElementById('mob-util-header');
    if (!body || !header) return;

    header.innerHTML = `<span class="mob-util-title">${teamNum} ${nick}</span>`;
    body.innerHTML = `<div class="spotlight-card spotlight-${color}" style="border:none;box-shadow:none;">
        <div class="spotlight-header" style="flex-wrap:wrap;">
            <div class="spotlight-team-info">
                <span class="spotlight-team-num">${teamNum}</span>
                ${nick ? `<span class="spotlight-team-nick">${nick}</span>` : ''}
                <span class="spotlight-alliance-badge spotlight-badge-${color}">${colorLabel}</span>
                <span class="spotlight-stat-pill">OPR ${oprStr}</span>
                <span class="spotlight-stat-pill">EPA ${epaStr}</span>
            </div>
        </div>
        <div id="spotlight-storyline"></div>
        <div class="spotlight-loading">Loading individual performance\u2026</div>
    </div>`;

    // Highlight/dim robot cards
    document.querySelectorAll('.bd-robot-card').forEach(card => {
        const cardTeam = parseInt(card.dataset.team);
        card.classList.toggle('bd-spotlight-active', cardTeam === teamNum);
        card.classList.toggle('bd-spotlight-dimmed', cardTeam !== teamNum);
    });

    const frcLevel = (m?.comp_level || 'qm') === 'qm' ? 'Qualification' : 'Playoff';
    const currentMatchNum = m?.match_number || 0;
    API.teamPerf(currentEvent, teamNum).then(perf => {
        if (_spotlightTeam !== teamNum) return;
        _renderSpotlightContent(body.querySelector('.spotlight-card'), perf, robot, bd.game_year, color, nick, teamNum, colorLabel, frcLevel, currentMatchNum, oprStr, epaStr);
    }).catch(() => {
        if (_spotlightTeam !== teamNum) return;
        _renderSpotlightFallback(body.querySelector('.spotlight-card'), robot, bd.game_year, color, nick, teamNum, colorLabel);
    });
}

function closeSpotlight() {
    _spotlightTeam = null;
    const panel = $('bd-spotlight');
    if (panel) { panel.classList.add('hidden'); panel.innerHTML = ''; }
    document.querySelectorAll('.bd-robot-card').forEach(card => {
        card.classList.remove('bd-spotlight-active', 'bd-spotlight-dimmed');
    });
    // Close mobile panel if open in spotlight mode
    if (_mobUtilMode === 'spotlight') closeMobUtilPanel();
}


