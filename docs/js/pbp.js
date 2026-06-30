/* ═══════════════════════════════════════════════════════════
   pbp.js — Play-by-Play tab (extracted from app.js)

   Loaded as a classic <script> *before* app.js. Top-level
   `let`/`const`/`function` declarations live in the shared
   global declarative environment, so cross-file references
   to globals (pbpData, currentEvent, summaryData, allianceData,
   teamsData, BattleStation, Realtime, getActiveAPI, ...) work
   exactly as they did when this section was inline.
   ═══════════════════════════════════════════════════════════ */

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

/** Enrich PBP team objects with streak info and OPR-above-avg flag.
 *
 *  Memoised via WeakMap keyed by the match object plus a global version
 *  stamp. Recomputation is triggered only when pbpData/teamsData actually
 *  change (via _bumpEnrichmentVersion()), so re-renders for the same
 *  match (e.g. settings toggles, tab re-entry) skip the O(matches × teams)
 *  history walk entirely.
 */
const _enrichmentCache = new WeakMap(); // m → { version, derived: Map<team_number, fields> }
let _enrichmentVersion = 0;
function _bumpEnrichmentVersion() { _enrichmentVersion++; }

function _enrichPbpTeams(m) {
    const allTeams = [...(m.red.teams || []), ...(m.blue.teams || [])];

    // Cache hit: paint cached derived fields onto the current team objects.
    const cached = _enrichmentCache.get(m);
    if (cached && cached.version === _enrichmentVersion) {
        for (const t of allTeams) {
            const d = cached.derived.get(t.team_number);
            if (d) Object.assign(t, d);
        }
        return;
    }

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
        const ov = allTeams.map(t => parseFloat(t.opr)).filter(v => !isNaN(v));
        avgOpr = ov.length ? ov.reduce((a, b) => a + b, 0) / ov.length : 0;
        p75Opr = avgOpr;
        const ev = allTeams.map(t => parseFloat(t.epa)).filter(v => !isNaN(v));
        avgEpa = ev.length ? ev.reduce((a, b) => a + b, 0) / ev.length : 0;
        p75Epa = avgEpa;
    }

    // Compute streaks from match history (if available from pbpData)
    const matchesBefore = pbpData.matches.slice(0, pbpIndex);
    const derivedMap = new Map();

    for (const t of allTeams) {
        // OPR tiers
        const opr = parseFloat(t.opr);
        const _opr_above_avg = !isNaN(opr) && opr > avgOpr;
        const _opr_top25     = !isNaN(opr) && opr >= p75Opr;

        // EPA tiers
        const epa = parseFloat(t.epa);
        const _epa_above_avg = !isNaN(epa) && epa > avgEpa;
        const _epa_top25     = !isNaN(epa) && epa >= p75Epa;

        // Delta: (OPR - EPA) / avgOpr × 100  — positive = outperforming predictions
        let _delta = null;
        if (!isNaN(opr) && !isNaN(epa) && avgOpr > 0) {
            _delta = ((opr - epa) / avgOpr) * 100;
        }

        // Streak: count consecutive Ws or Ls up to the current match
        let _streak_type = null;
        let _streak_count = 0;
        for (let i = matchesBefore.length - 1; i >= 0; i--) {
            const pm = matchesBefore[i];
            const onRed = pm.red.teams.some(rt => rt.team_number === t.team_number);
            const onBlue = pm.blue.teams.some(bt => bt.team_number === t.team_number);
            if (!onRed && !onBlue) continue;
            const won = (onRed && pm.winning_alliance === 'red') || (onBlue && pm.winning_alliance === 'blue');
            const lost = (onRed && pm.winning_alliance === 'blue') || (onBlue && pm.winning_alliance === 'red');
            if (!won && !lost) break; // tie or unplayed
            const type = won ? 'W' : 'L';
            if (_streak_type === null) _streak_type = type;
            if (type !== _streak_type) break;
            _streak_count++;
        }

        const derived = {
            _opr_above_avg, _opr_top25,
            _epa_above_avg, _epa_top25,
            _delta, _streak_type, _streak_count,
        };
        Object.assign(t, derived);
        derivedMap.set(t.team_number, derived);
    }

    _enrichmentCache.set(m, { version: _enrichmentVersion, derived: derivedMap });
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
const _STORYLINE_SS_PREFIX = 'sl:';  // sessionStorage key prefix

function _slGet(key) {
    const mem = _storylineCache[key];
    if (mem) return mem;
    try {
        const raw = sessionStorage.getItem(_STORYLINE_SS_PREFIX + key);
        if (raw) { const obj = JSON.parse(raw); _storylineCache[key] = obj; return obj; }
    } catch {}
    return null;
}
function _slSet(key, text, cached) {
    const obj = { text, cached: !!cached };
    _storylineCache[key] = obj;
    try { sessionStorage.setItem(_STORYLINE_SS_PREFIX + key, JSON.stringify(obj)); } catch {}
}

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
    const hit = _slGet(cacheKey);
    if (hit) {
        renderStoryline('pbp-storyline', hit.text, true);
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
        _slSet(cacheKey, result.storyline, result.cached);
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
    const hit = _slGet(cacheKey);
    if (hit) {
        renderStoryline('spotlight-storyline', hit.text, true);
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
        _slSet(cacheKey, result.storyline, result.cached);
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
    const hit2 = _slGet(cacheKey);
    if (hit2) {
        renderStoryline('pbp-storyline', hit2.text, true, label);
        return;
    }

    showStorylineLoading('pbp-storyline');

    try {
        const result = await API.generateStoryline({
            mode: 'team',
            event_key: currentEvent,
            team_number: teamNum,
        });
        _slSet(cacheKey, result.storyline, result.cached);
        renderStoryline('pbp-storyline', result.storyline, result.cached, label);
    } catch (err) {
        showStorylineError('pbp-storyline', err.message || 'Failed to generate storyline.', `generatePbpTeamStoryline(${teamNum})`);
    }
}

// ── Restart the score-update flash without a forced reflow ─────────
// Two nested rAFs let the browser commit the class removal on its own
// frame, then re-add on the next, restarting the CSS animation without
// the layout-thrashing `void el.offsetWidth` trick.
function _flashPbpArena() {
    const arena = document.getElementById('pbp-arena');
    if (!arena) return;
    arena.classList.remove('pbp-updated-flash');
    requestAnimationFrame(() => {
        requestAnimationFrame(() => arena.classList.add('pbp-updated-flash'));
    });
}

// ── Static arena shell mounted once per event ──────────────────────
// Pre-creating the alliance/header/score skeleton means the score-only
// fast path can patch text nodes from the very first render, and the
// slow path only has to swap children inside .pbp-team-cards instead
// of rebuilding the whole arena innerHTML on every match update.
var _pbpShellMounted = false;  // var: read by event_select.js
const _PBP_ARENA_SHELL = `
    <div class="pbp-alliance red-side">
        <div class="pbp-alliance-header">
            <span class="pbp-alliance-title"></span>
            <div class="pbp-score-group">
                <span class="pbp-winner-label hidden">WINNER</span>
                <span class="pbp-alliance-score">–</span>
            </div>
        </div>
        <div class="pbp-team-cards"></div>
    </div>
    <div class="pbp-alliance blue-side">
        <div class="pbp-alliance-header">
            <div class="pbp-score-group">
                <span class="pbp-alliance-score">–</span>
                <span class="pbp-winner-label hidden">WINNER</span>
            </div>
            <span class="pbp-alliance-title"></span>
        </div>
        <div class="pbp-team-cards"></div>
    </div>
    <div class="pbp-prediction-slot"></div>`;

function _pbpMountShell() {
    const arena = document.getElementById('pbp-arena');
    if (!arena) return;
    arena.innerHTML = _PBP_ARENA_SHELL;
    _pbpShellMounted = true;
}

// ── Fast-path signature for score-only diff ────────────────────────
// Captured at the end of every full render so the next call can decide
// whether a cheap text-node patch is sufficient (the common case during
// a live match: only the alliance scores tick).
var _pbpLastSig = null;  // var: read by event_select.js
function _pbpSig(m) {
    return [
        m.key,
        pbpIndex,
        m.red.teams.length, m.blue.teams.length,
        ...m.red.teams.map(t => t.team_number),
        ...m.blue.teams.map(t => t.team_number),
        m.red.alliance_number, m.blue.alliance_number,
        m.comp_level || '',
    ].join('|');
}

/** Patch only the two alliance score nodes + winner classes.
 *  Returns true if the patch succeeded (caller can skip full render). */
function _pbpPatchScoresOnly(m) {
    const arena = document.getElementById('pbp-arena');
    if (!arena) return false;
    const redScoreEl  = arena.querySelector('.red-side  > .pbp-alliance-header .pbp-alliance-score');
    const blueScoreEl = arena.querySelector('.blue-side > .pbp-alliance-header .pbp-alliance-score');
    if (!redScoreEl || !blueScoreEl) return false;

    const upcoming = m.red.score < 0 && m.blue.score < 0;
    const redText  = upcoming ? '–' : String(m.red.score);
    const blueText = upcoming ? '–' : String(m.blue.score);
    if (redScoreEl.firstChild)  redScoreEl.firstChild.data  = redText;
    else                        redScoreEl.textContent      = redText;
    if (blueScoreEl.firstChild) blueScoreEl.firstChild.data = blueText;
    else                        blueScoreEl.textContent     = blueText;

    const redSide  = arena.querySelector('.red-side');
    const blueSide = arena.querySelector('.blue-side');
    redSide  && redSide .classList.toggle('pbp-alliance-won', m.winning_alliance === 'red');
    blueSide && blueSide.classList.toggle('pbp-alliance-won', m.winning_alliance === 'blue');
    return true;
}

function renderPbpMatch() {
    if (!pbpData || !pbpData.matches.length) return;
    const m = pbpData.matches[pbpIndex];

    // Notify Battle Station of match change
    if (typeof BattleStation !== 'undefined') {
        try { BattleStation.refresh(); } catch (_e) { /* not mounted */ }
    }

    // ── Score-only fast path ──────────────────────────────────────────
    // When a Realtime payload only changes red/blue score (the dominant
    // case during live matches), skip the full innerHTML rebuild and
    // patch the two text nodes directly. Async injectors (awards,
    // sponsors, firsts) are also skipped because their content is
    // independent of the score.
    const sig = _pbpSig(m);
    if (sig === _pbpLastSig && _pbpPatchScoresOnly(m)) {
        return;
    }

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
    if (showPredictions) {
        if (m.pred) {
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
        } else {
            predHtml = `
                <div class="pbp-prediction pbp-prediction-unavailable">
                    <span class="pbp-pred-label">Statbotics Win Prediction</span>
                    <span class="pbp-pred-unavailable-msg">Statbotics unavailable for this match</span>
                </div>`;
        }
    }

    // Alliance titles (include alliance # for playoff matches)
    // For Einstein, use division name instead of "Alliance #N"
    const redAllianceNum = m.red.alliance_number;
    const blueAllianceNum = m.blue.alliance_number;
    const _divLabel = (num, fallback) => {
        if (!num) return fallback;
        if (allianceData && allianceData.is_einstein && allianceData.division_names) {
            const name = allianceData.division_names[num];
            if (name) return name;
        }
        return `Alliance #${num}`;
    };
    const redTitle = _divLabel(redAllianceNum, 'Red Alliance');
    const blueTitle = _divLabel(blueAllianceNum, 'Blue Alliance');

    // For championship playoff matches, include any bench team (3rd Pick not playing)
    const _isChampPlayoff = allianceData && allianceData.is_championship && m.comp_level && m.comp_level !== 'qm';
    const _getBenchCard = (side, sideClass) => {
        if (!_isChampPlayoff) return '';
        const allianceNum = side.alliance_number;
        if (!allianceNum || !allianceData.alliances) return '';
        const fullAlliance = allianceData.alliances.find(a => a.number === allianceNum);
        if (!fullAlliance || fullAlliance.teams.length < 4) return '';
        const playingNums = new Set((side.teams || []).map(t => t.team_number));
        const benchTeamData = fullAlliance.teams.find(t => !playingNums.has(t.team_number));
        if (!benchTeamData) return '';
        // Build a team object compatible with renderPbpTeam
        const benchTeam = Object.assign({
            city: '', state_prov: '', country: '',
            robot_name: null, avg_rp: '\u2013',
            _streak_type: null, _streak_count: 0,
            _opr_top25: false, _opr_above_avg: false,
            _epa_top25: false, _epa_above_avg: false,
            _delta: null, _tims_sponsors: null,
        }, benchTeamData);
        return renderPbpTeam(benchTeam, sideClass, { isBench: true });
    };

    // Render team cards or alliance placeholder when teams aren't assigned yet
    const redTeamCards = m.red.teams.length
        ? m.red.teams.map(t => renderPbpTeam(t, 'red-side')).join('') + _getBenchCard(m.red, 'red-side')
        : (redAllianceNum ? `<div class="pbp-alliance-placeholder red-side">${redTitle} \u2014 Teams TBD</div>` : '<div class="pbp-alliance-placeholder">Teams TBD</div>');
    const blueTeamCards = m.blue.teams.length
        ? m.blue.teams.map(t => renderPbpTeam(t, 'blue-side')).join('') + _getBenchCard(m.blue, 'blue-side')
        : (blueAllianceNum ? `<div class="pbp-alliance-placeholder blue-side">${blueTitle} \u2014 Teams TBD</div>` : '<div class="pbp-alliance-placeholder">Teams TBD</div>');

    // Mount static shell once per event — subsequent renders only patch
    // changed text nodes, classes, and the team-cards children.
    const arena = $('pbp-arena');
    if (!_pbpShellMounted) _pbpMountShell();

    const redSide  = arena.querySelector('.red-side');
    const blueSide = arena.querySelector('.blue-side');
    redSide.classList.toggle('pbp-alliance-won', redWon);
    blueSide.classList.toggle('pbp-alliance-won', blueWon);

    redSide.querySelector('.pbp-alliance-title').textContent  = redTitle;
    blueSide.querySelector('.pbp-alliance-title').textContent = blueTitle;
    redSide.querySelector('.pbp-winner-label') .classList.toggle('hidden', !redWon);
    blueSide.querySelector('.pbp-winner-label').classList.toggle('hidden', !blueWon);

    const redScoreEl  = redSide.querySelector('.pbp-alliance-score');
    const blueScoreEl = blueSide.querySelector('.pbp-alliance-score');
    redScoreEl.textContent  = upcoming ? '–' : String(m.red.score);
    blueScoreEl.textContent = upcoming ? '–' : String(m.blue.score);

    redSide.querySelector('.pbp-team-cards').innerHTML  = redTeamCards;
    blueSide.querySelector('.pbp-team-cards').innerHTML = blueTeamCards;

    arena.querySelector('.pbp-prediction-slot').innerHTML = predHtml;

    // If awards toggle is on, fetch and inject awards asynchronously
    if (pbpShowAwards) {
        const allTeams = [...(m.red?.teams || []), ...(m.blue?.teams || [])];
        _injectPbpAwards(allTeams, pbpIndex);
    }

    // If GATool sponsors toggle is on, fetch and inject sponsors asynchronously
    if (showGatoolSponsors) {
        const allTeams = [...(m.red?.teams || []), ...(m.blue?.teams || [])];
        _injectGatoolSponsors(allTeams, pbpIndex);
    }

    // Inject playoff-firsts badges for playoff matches
    if (m.comp_level && m.comp_level !== 'qm') {
        const allTeams = [...(m.red?.teams || []), ...(m.blue?.teams || [])];
        // Include bench teams for champ playoffs so they also get Einstein badges
        if (_isChampPlayoff && allianceData && allianceData.alliances) {
            for (const side of [m.red, m.blue]) {
                const allianceNum = side?.alliance_number;
                if (!allianceNum) continue;
                const fullAlliance = allianceData.alliances.find(a => a.number === allianceNum);
                if (!fullAlliance || fullAlliance.teams.length < 4) continue;
                const playingNums = new Set((side.teams || []).map(t => t.team_number));
                const benchTeamData = fullAlliance.teams.find(t => !playingNums.has(t.team_number));
                if (benchTeamData) allTeams.push(benchTeamData);
            }
        }
        // Proactively load Einstein contenders when on a champ event playoff match.
        // loadSummaryAwards() is normally only called from renderSummary(), so if the
        // user goes directly to the PBP tab, einstein_contenders is never populated.
        // Use summaryData.is_championship as fallback when allianceData hasn't loaded yet.
        const _isChampEvent = _isChampPlayoff || !!(summaryData && summaryData.is_championship);
        if (_isChampEvent && !summaryData?.einstein_contenders) {
            loadSummaryAwards();
        }
        _injectPlayoffFirsts(allTeams, pbpIndex, m.comp_level);
    }

    // Footer: high-score text + storyline button visibility (static buttons
    // live in index.html and are no longer rebuilt on every match render).
    const qs = pbpData.event_high_score;
    const storylineBtn = document.getElementById('pbp-storyline-btn');
    if (storylineBtn) {
        storylineBtn.classList.toggle('hidden', !(_storylineAvailable && competitionMode === 'frc'));
    }
    const hsEl = document.getElementById('pbp-footer-highscore');
    if (hsEl) {
        if (qs && qs.score > 0) {
            hsEl.innerHTML = `Event High Score: <span class="pbp-footer-score">${qs.score}</span> in ${qs.match} (${qs.teams.join(', ')})`;
            hsEl.classList.remove('hidden');
        } else {
            hsEl.classList.add('hidden');
            hsEl.textContent = '';
        }
    }

    // Prior connections between the teams on the field
    renderPbpConnections(m);

    // Record signature for next call's score-only fast path.
    _pbpLastSig = sig;
}

// var: read by event_select.js (loaded before pbp.js)
var _pbpConnCache = {};           // keyed by "teamA,teamB,...,teamF|allTime" → connections array
var _pbpConnAllTime = false;      // current range toggle state

// Hoisted SVG markup — these strings used to be re-allocated on every
// renderPbpConnections() call (twice per match update during live play).
const _SVG_CONN_HEADER = '<svg class="conn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 17a4 4 0 0 1-4 4H5a4 4 0 0 1-4-4 4 4 0 0 1 4-4h1"/><path d="M13 17a4 4 0 0 0 4 4h2a4 4 0 0 0 4-4 4 4 0 0 0-4-4h-1"/><path d="M7 13 5 3l4 2 3-2 3 2 4-2-2 10"/></svg>';
const _SVG_PARTNER     = _SVG_CONN_HEADER;
const _SVG_OPPONENT    = '<svg class="conn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="M13 19l6-6"/><path d="M16 16l4 4"/><path d="M19 21l2-2"/><path d="M14.5 6.5 18 3h3v3l-3.5 3.5"/><path d="m5 14 4 4"/><path d="m7 17-2 2"/></svg>';
const _SVG_CHEVRON     = '<svg class="pbp-conn-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

function _connCacheKey(teamNums, allTime) {
    return [...teamNums].sort((a, b) => a - b).join(',') + '|' + (allTime ? '1' : '0');
}

/** Compute prior connections for the 6 teams on the field from pbpData match history.
 *  Scans all completed matches before upToMatchIdx — no network call needed. */
function _computeInEventConnections(upToMatchIdx) {
    if (!pbpData || !pbpData.matches) return [];
    const connMap = {};
    const getConn = (a, b) => {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const key = `${lo}:${hi}`;
        if (!connMap[key]) connMap[key] = { team_a: lo, team_b: hi, partnered_at: [], opponents_at: [], h2h_wins_a: 0, h2h_wins_b: 0 };
        return connMap[key];
    };
    const eventName = eventInfoData?.name || currentEvent;
    const year = currentEventYear || new Date().getFullYear();

    for (let i = 0; i < upToMatchIdx; i++) {
        const m = pbpData.matches[i];
        if (!m) continue;
        const redScore = m.red?.score ?? -1;
        const blueScore = m.blue?.score ?? -1;
        if (redScore < 0 || blueScore < 0) continue; // not yet played

        const redTeams = (m.red?.teams || []).map(t => t.team_number);
        const blueTeams = (m.blue?.teams || []).map(t => t.team_number);
        const compLevel = m.comp_level || 'qm';
        const matchShort = compLevel === 'qm'
            ? `Q${m.match_number}`
            : compLevel === 'f'
                ? `Final ${m.match_number}`
                : `P${m.set_number || 1}-${m.match_number}`;
        const entry = { event_key: currentEvent, event_name: eventName, match_key: m.match_key || m.key, year, stage: matchShort };

        // Same-alliance pairs (partners)
        for (const arr of [redTeams, blueTeams]) {
            const won = (arr === redTeams) ? redScore > blueScore : blueScore > redScore;
            const result = won ? 'winner' : '';
            for (let x = 0; x < arr.length; x++) {
                for (let y = x + 1; y < arr.length; y++) {
                    getConn(arr[x], arr[y]).partnered_at.push({ ...entry, result });
                }
            }
        }
        // Cross-alliance pairs (opponents)
        for (const r of redTeams) {
            for (const b of blueTeams) {
                const conn = getConn(r, b);
                const aIsRed = redTeams.includes(conn.team_a);
                const redWon = redScore > blueScore;
                const blueWon = blueScore > redScore;
                if (aIsRed && redWon) conn.h2h_wins_a++;
                else if (!aIsRed && blueWon) conn.h2h_wins_a++;
                else if (aIsRed && blueWon) conn.h2h_wins_b++;
                else if (!aIsRed && redWon) conn.h2h_wins_b++;
                conn.opponents_at.push({ ...entry, result: redWon ? 'winner' : blueWon ? 'winner' : '' });
            }
        }
    }
    return Object.values(connMap);
}

async function fetchMatchConnections(teamNums, forceAllTime) {
    const wantAllTime = forceAllTime !== undefined ? forceAllTime : _pbpConnAllTime;
    const key = _connCacheKey(teamNums, wantAllTime);
    if (_pbpConnCache[key]) return _pbpConnCache[key];

    // Default (past 3yr) and all-time both go to the API — historical context is the value here
    try {
        const result = await getActiveAPI().eventConnections(currentEvent, wantAllTime, teamNums);
        _pbpConnCache[key] = result;
        return result;
    } catch {
        // Do NOT cache errors — allow the user to retry by re-toggling
        return [];
    }
}

async function renderPbpConnections(match) {
    // Collect team numbers on each side
    const redNums = new Set((match.red?.teams || []).map(t => t.team_number));
    const blueNums = new Set((match.blue?.teams || []).map(t => t.team_number));
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
            <div class="pbp-conn-header pbp-conn-loading-header" data-action="toggle-conn">
                ${_SVG_CHEVRON}
                ${_SVG_CONN_HEADER}
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

    const svgPartner = _SVG_PARTNER;
    const svgOpponent = _SVG_OPPONENT;

    // Helper: format a single past-event row.
    const _renderEvtRow = (e) => {
        const resultTag = e.result === 'winner' ? ' <span class="pbp-conn-winner">Winner</span>'
            : e.result === 'finalist' ? ' <span class="pbp-conn-finalist">Finalist</span>' : '';
        return `<li class="pbp-conn-evt">
            <span class="pbp-conn-evt-name">${e.event_name || e.event_key}</span>
            <span class="pbp-conn-evt-year">${e.year}</span>
            <span class="pbp-conn-stage">${e.stage}</span>${resultTag}
        </li>`;
    };

    // Helper: render a labeled section ("Partners" / "Opponents") with collapsible overflow.
    const _renderEvtSection = (events, label, icon, extraClass) => {
        if (!events || !events.length) return '';
        const sorted = [...events].sort((a, b) => b.year - a.year);
        const visible = sorted.slice(0, 3).map(_renderEvtRow).join('');
        const hidden = sorted.slice(3).map(_renderEvtRow).join('');
        const more = sorted.length > 3
            ? `<button type="button" class="pbp-conn-more" data-action="toggle-more" data-count="${sorted.length - 3}">+${sorted.length - 3} more</button>
               <ul class="pbp-conn-evt-list pbp-conn-extra hidden">${hidden}</ul>`
            : '';
        return `<div class="pbp-conn-section ${extraClass}">
            <div class="pbp-conn-section-label">${icon}<span>${label}</span><span class="pbp-conn-section-count">${sorted.length}</span></div>
            <ul class="pbp-conn-evt-list">${visible}</ul>
            ${more}
        </div>`;
    };

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
        const isCross = sideClass === 'pbp-conn-cross';

        const partnered = c.partnered_at || [];
        const opposed   = c.opponents_at || [];

        // ── Header: team numbers (+ H2H record for cross-alliance) ──
        let headerHtml;
        if (isCross) {
            const winsA = c.h2h_wins_a != null ? c.h2h_wins_a : null;
            const winsB = c.h2h_wins_b != null ? c.h2h_wins_b : null;
            const record = (winsA != null && winsB != null)
                ? `<span class="pbp-conn-h2h-wins" title="Head-to-head match record">${winsA}–${winsB} H2H</span>`
                : '';
            headerHtml = `<div class="pbp-conn-teams-header">
                <span class="pbp-conn-team-num">${c.team_a}</span>
                <span class="pbp-conn-vs">vs</span>
                <span class="pbp-conn-team-num">${c.team_b}</span>
                ${record}
            </div>`;
        } else {
            headerHtml = `<div class="pbp-conn-teams-header">
                <span class="pbp-conn-team-num">${c.team_a}</span>
                <span class="pbp-conn-amp">&amp;</span>
                <span class="pbp-conn-team-num">${c.team_b}</span>
            </div>`;
        }

        // ── Body: Partners section + Opponents section, stacked beneath header ──
        const bodyHtml = `${_renderEvtSection(partnered, 'Partners', svgPartner, 'pbp-conn-partners')}${_renderEvtSection(opposed, 'Opponents', svgOpponent, 'pbp-conn-opponents')}`;

        const groupOrder = sideClass === 'pbp-conn-red' ? 0 : sideClass === 'pbp-conn-blue' ? 1 : 2;
        items.push({ order: groupOrder, html: `
            <div class="pbp-conn-item ${sideClass}">
                ${headerHtml}
                <div class="pbp-conn-sections">${bodyHtml}</div>
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
        <div class="pbp-conn-header" data-action="toggle-conn">
            ${_SVG_CHEVRON}
            ${_SVG_CONN_HEADER}
            Prior Connections on the Field
            <span class="pbp-conn-count">${items.length}</span>
            <label class="pbp-conn-range-toggle" data-action="stop">
                <span class="conn-range-side${!_pbpConnAllTime ? ' active' : ''}">Past 3yr</span>
                <input type="checkbox"${checkedAttr} data-action="toggle-range">
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

function renderPbpTeam(t, sideCls, opts = {}) {
    const isBench = opts.isBench === true;
    t = _applyTimsOverrides(t);
    const loc = [t.city, t.state_prov, t.country].filter(Boolean).join(', ');
    const shortLoc = [t.state_prov, t.country].filter(Boolean).join(', ');
    const foreignCls = highlightForeign && t.country && eventCountry && t.country !== eventCountry ? 'foreign-team' : '';
    const rookieCls = highlightRookie && t.rookie_year && currentEventYear && t.rookie_year >= currentEventYear ? 'rookie-team' : '';
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
    if (t._delta != null && (t._delta > 15 || t._delta < -15)) {
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

    const benchBadge = isBench ? `<span class="pbp-bench-badge">Bench</span>` : '';

    return `
    <div class="pbp-team ${isBench ? 'pbp-is-bench' : ''} ${foreignCls} ${rookieCls}" data-country="${t.country || ''}" data-rookie-year="${t.rookie_year || ''}">
        <div class="pbp-team-top">
            <div class="pbp-team-number" data-team-number="${t.team_number}">${_renderTeamNum(t)}${pickHtml}</div>
            <div class="pbp-team-identity">
                <div class="pbp-team-name-row">
                    <div class="pbp-team-nickname">${t.nickname || 'Team ' + t.team_number}</div>
                    ${benchBadge}
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
            <div class="pbp-stat">
                <div class="pbp-stat-label">EPA${deltaHtml}</div>
                <div class="pbp-stat-value epa-val${epaCls}">${t.epa != null ? t.epa : '\u2013'}</div>
            </div>
            <div class="pbp-stat">
                <div class="pbp-stat-label">Avg RP</div>
                <div class="pbp-stat-value">${t.avg_rp}</div>
            </div>
        </div>
        <div class="pbp-awards-slot" data-team="${t.team_number}"></div>
        <div class="pbp-bottom-row">
            <div class="pbp-sponsors-slot" data-sponsors-team="${t.team_number}">${t._tims_sponsors ? `<div class="pbp-sponsors" title="Sponsors (TIMS)"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg><span class="pbp-sponsors-text">${t._tims_sponsors}</span></div>` : ''}</div>
            ${t.robot_name ? `<div class="pbp-robot-name" title="Robot Name"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg><span class="pbp-robot-name-text">${_esc(t.robot_name)}</span></div>` : ''}
            ${_renderPbpTags(_parseTags(_timsCache[t.team_number]?.hardware), 'Hardware', 'pbp-hardware-tag')}
            ${_renderPbpTags(_parseTags(_timsCache[t.team_number]?.auto_strategy).concat(_parseTags(_timsCache[t.team_number]?.teleop_strategy)), 'Strategy', 'pbp-strategy-tag')}
        </div>
    </div>`;
}

// ── PBP Playoff-firsts injection ───────────────────────────

var _playoffFirstsCache = null;  // var: read by event_select.js / summary.js

async function _injectPlayoffFirsts(teams, matchIdx, compLevel) {
    // Lazy-load once per event
    if (_playoffFirstsCache === null) {
        try {
            _playoffFirstsCache = await API.playoffFirsts(currentEvent);
        } catch {
            _playoffFirstsCache = {};
            return;
        }
    }

    // Guard: user may have navigated to a different match
    if (pbpIndex !== matchIdx) return;

    const isFinals = compLevel === 'f';
    const isEinstein = !!(allianceData && allianceData.is_einstein);
    const isChampDiv  = !!(allianceData && allianceData.is_championship && !allianceData.is_einstein);

    // Build Einstein contenders lookup for champ division events AND Einstein itself
    // summaryData.einstein_contenders = [{team_number, nickname, einstein_winner}, ...]
    const einsteinContenderMap = new Map(); // team_number → entry
    if ((isChampDiv || isEinstein) && summaryData && summaryData.einstein_contenders) {
        for (const ec of summaryData.einstein_contenders) {
            einsteinContenderMap.set(ec.team_number, ec);
        }
    }

    for (const t of teams) {
        const info = _playoffFirstsCache[t.team_number];
        const slot = document.querySelector(`.pbp-firsts-slot[data-firsts-team="${t.team_number}"]`);
        if (!slot) continue;

        const badges = [];

        // ── Einstein Finals event: First Einstein badge ────────────────────
        if (isEinstein && info && info.first_einstein) {
            badges.push(`<span class="pbp-first-badge pbp-first-einstein" title="First-ever Einstein appearance${info.rookie ? ' (Rookie)' : ''}">First Einstein${info.rookie ? ' (R)' : ''}</span>`);
        }

        // ── Championship division: Returning Einstein badges ───────────────
        // On Einstein itself: only show "Einstein Winner" (not "Returning" — everyone there is a contender).
        // On division events: show both winner and contender badges.
        if (isChampDiv || isEinstein) {
            const ec = einsteinContenderMap.get(t.team_number);
            if (ec) {
                if (ec.einstein_winner) {
                    // Always show the winner pill
                    const winCount = ec.winner_count > 1 ? ` (${ec.winner_count}×)` : '';
                    badges.push(`<span class="pbp-first-badge pbp-einstein-winner" title="Previous Einstein Winner${ec.winner_count > 1 ? ` — ${ec.winner_count} times` : ''}">Einstein Winner${winCount}</span>`);
                    // Also show appearances pill when they've appeared more than once
                    if (ec.contender_count > 1) {
                        badges.push(`<span class="pbp-first-badge pbp-einstein-contender" title="${ec.contender_count} Einstein appearances">${ec.contender_count}× Einstein</span>`);
                    }
                } else if (isChampDiv) {
                    const appLabel = ec.contender_count > 1 ? `Returning Einstein (${ec.contender_count}×)` : 'Returning Einstein';
                    const appTitle = ec.contender_count > 1 ? `Returning Einstein Contender — ${ec.contender_count} appearances` : 'Returning Einstein Contender';
                    badges.push(`<span class="pbp-first-badge pbp-einstein-contender" title="${appTitle}">${appLabel}</span>`);
                }
            }
        }

        // ── Standard first-time badges (only when no Einstein badge shown) ─
        if (badges.length === 0 && info) {
            if (isFinals && info.first_finals) {
                badges.push(`<span class="pbp-first-badge pbp-first-finals" title="First-ever appearance in Finals">
                First Finals
            </span>`);
            } else if (info.first_playoff) {
                badges.push(`<span class="pbp-first-badge pbp-first-playoff" title="First-ever playoff appearance${info.rookie ? ' (Rookie)' : ''}">
                First Playoffs${info.rookie ? ' (R)' : ''}
            </span>`);
            }
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
            html += `<span class="pbp-award-toggle" data-action="toggle-awards" data-count="${hidden.length}">+${hidden.length} more</span>`;
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
                    _flashPbpArena();
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
        _bumpEnrichmentVersion();
        bdData = fresh;  // Shared data source for breakdown tab
        // Invalidate in-event connection cache (computed from pbpData, which just changed)
        for (const k of Object.keys(_pbpConnCache)) {
            if (!k.endsWith('|1')) delete _pbpConnCache[k];
        }
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
            _flashPbpArena();
        }

        // Cache the updated data
        autoCacheTab('matches', fresh);

    } catch (_) {
        // Silently ignore — network hiccups shouldn't disrupt the UI
    }
}
