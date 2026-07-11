/* ═══════════════════════════════════════════════════════════
   goatstrat.js — GoatStrat: 6907 strategy hub

   Aggregates PBP, Breakdown, BattleStation notes, GoatScout data,
   and a strategy planning/comparison view for all matches that
   include team 6907. Visible to admin/scouter roles only.

   Depends on: api.js, auth.js, notes_service.js, breakdown.js
              (renderBdAlliance2026), goatscout.js
   ═══════════════════════════════════════════════════════════ */

const GoatStrat = (() => {
    'use strict';

    const TEAM_NUM = 6907;
    const TEAM_KEY = 'frc6907';
    const STRATEGY_CATEGORY = 'strategy';
    const SUPABASE_URL  = 'https://dhbowudmzwzmmfbetmum.supabase.co';
    const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRoYm93dWRtend6bW1mYmV0bXVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4ODMwMjMsImV4cCI6MjA5ODQ1OTAyM30.QgkuH1-KYj9x1ZjPeDjk_Bhp-4XKN9EF4BdptrZb4AM';
    const REST_BASE = SUPABASE_URL + '/rest/v1';

    // ── State ──────────────────────────────────────────────
    let _mounted = false;
    let _events = [];
    let _currentEvent = null;
    let _matches6907 = [];
    let _matchIndex = 0;
    let _breakdownCache = {};
    let _strategyNotes = {};
    let _casterNotes = {};

    // ── Helpers ────────────────────────────────────────────
    function _esc(s) {
        if (s == null) return '';
        const d = document.createElement('div');
        d.textContent = String(s);
        return d.innerHTML;
    }

    function _$(id) { return document.getElementById(id); }

    function _isAuthed() {
        return typeof Auth !== 'undefined' && Auth.isAuthenticated && Auth.isAuthenticated();
    }

    function _isAuthorized() {
        if (!_isAuthed()) return false;
        const user = Auth.getUser();
        const role = user?.user_metadata?.role;
        return user?.email === 'gjqfrank@163.com' || role === 'admin' || role === 'scouter';
    }

    function _deviceId() {
        return localStorage.getItem('casters_device_id') || 'web-' + Date.now().toString(36);
    }

    function _postgrestHeaders(prefer) {
        const h = {
            'apikey': SUPABASE_ANON,
            'Content-Type': 'application/json',
        };
        if (prefer) h['Prefer'] = prefer;
        if (typeof Auth !== 'undefined' && Auth.getAccessToken) {
            const token = Auth.getAccessToken();
            if (token) h['Authorization'] = `Bearer ${token}`;
        }
        if (!h['Authorization']) h['Authorization'] = `Bearer ${SUPABASE_ANON}`;
        return h;
    }

    function _teamNums(alliance) {
        if (!alliance?.teams) return [];
        return alliance.teams.map(t => t.team_number);
    }

    function _has6907(m) {
        return _teamNums(m.red).includes(TEAM_NUM) || _teamNums(m.blue).includes(TEAM_NUM);
    }

    function _6907Side(m) {
        if (_teamNums(m.red).includes(TEAM_NUM)) return 'red';
        if (_teamNums(m.blue).includes(TEAM_NUM)) return 'blue';
        return null;
    }

    // ── Lifecycle ──────────────────────────────────────────
    function mount() {
        if (!_isAuthorized()) return;
        if (_mounted) { refresh(); return; }
        _mounted = true;
        _renderShell();
        _loadEvents();
    }

    function unmount() { _mounted = false; }

    function refresh() {
        if (!_mounted) return;
        if (_matches6907.length) _loadMatchData();
    }

    // ── Shell render ───────────────────────────────────────
    function _renderShell() {
        const c = _$('goatstrat-container');
        if (!c) return;
        c.innerHTML = `
          <div class="goatstrat-shell">
            <div class="gs-topbar">
              <select id="gs-event-sel" class="gs-select" onchange="GoatStrat._onEventSelect(this.value)">
                <option value="">Loading events…</option>
              </select>
              <select id="gs-match-sel" class="gs-select" onchange="GoatStrat._onMatchSelect(this.value)">
                <option value="">—</option>
              </select>
              <button class="gs-btn gs-btn-refresh" onclick="GoatStrat.refresh()" title="Refresh">↻</button>
            </div>

            <div class="gs-main-row">
              <div class="gs-panel">
                <h3 class="gs-panel-title">Match Overview</h3>
                <div id="gs-pbp-card" class="gs-pbp-card"></div>
              </div>
              <div class="gs-panel">
                <h3 class="gs-panel-title">Score Breakdown</h3>
                <div id="gs-bd-content" class="gs-bd-content"></div>
              </div>
            </div>

            <div class="gs-panel gs-strat-panel">
              <h3 class="gs-panel-title">6907 Strategy Plan</h3>
              <div class="gs-strat-grid">
                <div class="gs-strat-field">
                  <label>Auto</label>
                  <textarea id="gs-strat-auto" rows="4" placeholder="Auto phase strategy…"></textarea>
                </div>
                <div class="gs-strat-field">
                  <label>Teleop</label>
                  <textarea id="gs-strat-teleop" rows="4" placeholder="Teleop phase strategy…"></textarea>
                </div>
                <div class="gs-strat-field">
                  <label>Endgame</label>
                  <textarea id="gs-strat-endgame" rows="4" placeholder="Endgame phase strategy…"></textarea>
                </div>
              </div>
              <button class="gs-btn gs-btn-save" onclick="GoatStrat._onSaveStrategy()">Save Strategy</button>
              <span id="gs-strat-status" class="gs-status"></span>
            </div>

            <div class="gs-panel gs-comp-panel">
              <h3 class="gs-panel-title">Plan vs Actual</h3>
              <div id="gs-comparison"></div>
            </div>

            <div class="gs-panel">
              <h3 class="gs-panel-title">Event Scout Data</h3>
              <div id="gs-goatscout-content"></div>
            </div>
          </div>`;
    }

    // ── Data loading ───────────────────────────────────────

    async function _loadEvents() {
        const sel = _$('gs-event-sel');
        try {
            const stats = await API.teamStats(TEAM_NUM, 2026);
            _events = stats?.events_this_year || [];
            if (!_events.length) {
                sel.innerHTML = '<option value="">No events found for 6907 in 2026</option>';
                return;
            }
            // Default to currentEvent if 6907 is in it
            const globalEv = (typeof currentEvent !== 'undefined') ? currentEvent : null;
            const defaultKey = (globalEv && _events.some(e => e.event_key === globalEv)) ? globalEv : _events[0].event_key;
            sel.innerHTML = _events.map(e =>
                `<option value="${e.event_key}"${e.event_key === defaultKey ? ' selected' : ''}>${_esc(e.event_name || e.event_key)}</option>`
            ).join('');
            await _onEventSelect(defaultKey);
        } catch (e) {
            sel.innerHTML = `<option value="">Error: ${_esc(e.message)}</option>`;
        }
    }

    async function _onEventSelect(eventKey) {
        if (!eventKey) return;
        _currentEvent = eventKey;
        _breakdownCache = {};
        _strategyNotes = {};
        _casterNotes = {};
        _goatscoutData = [];
        _matches6907 = [];
        _matchIndex = 0;

        const msel = _$('gs-match-sel');
        if (msel) msel.innerHTML = '<option value="">Loading matches…</option>';
        const bd = _$('gs-bd-content');
        if (bd) bd.innerHTML = '<p class="gs-loading">Loading…</p>';
        const pbp = _$('gs-pbp-card');
        if (pbp) pbp.innerHTML = '';
        const comp = _$('gs-comparison');
        if (comp) comp.innerHTML = '';

        try {
            const data = await API.allMatches(eventKey);
            const all = data?.matches || [];
            _matches6907 = all.filter(_has6907);

            if (!_matches6907.length) {
                if (msel) msel.innerHTML = '<option value="">No matches with 6907</option>';
                if (pbp) pbp.innerHTML = '<p class="gs-empty">Team 6907 has no matches at this event yet.</p>';
                return;
            }

            _matchIndex = Math.max(0, _matches6907.length - 1);
            if (msel) {
                msel.innerHTML = _matches6907.map((m, i) => {
                    const label = (m.label || m.match_key || m.key || `Match ${i+1}`).replace(/^Qualification\s*/i, 'Qual ');
                    return `<option value="${i}"${i === _matchIndex ? ' selected' : ''}>${_esc(label)}</option>`;
                }).join('');
            }
            await _loadMatchData();
        } catch (e) {
            if (msel) msel.innerHTML = `<option value="">Error: ${_esc(e.message)}</option>`;
        }

        // Load GoatScout in parallel (non-blocking)
        _loadGoatScout(eventKey);
    }

    function _onMatchSelect(val) {
        const idx = parseInt(val, 10);
        if (isNaN(idx) || idx < 0 || idx >= _matches6907.length) return;
        _matchIndex = idx;
        _loadMatchData();
    }

    async function _loadMatchData() {
        const m = _matches6907[_matchIndex];
        if (!m) return;

        _renderPbpCard(m);

        const matchKey = m.key || m.match_key;
        await Promise.all([
            _loadBreakdown(matchKey),
            _loadStrategyNotes(m),
            _loadCasterNotes(m),
        ]);
        _renderComparison(m);
    }

    // ── PBP simplified card ────────────────────────────────

    function _renderPbpCard(m) {
        const el = _$('gs-pbp-card');
        if (!el) return;

        const reds = _teamNums(m.red);
        const blues = _teamNums(m.blue);
        const side = _6907Side(m);

        const redScore = (m.red?.score != null && m.red.score >= 0) ? m.red.score : '–';
        const blueScore = (m.blue?.score != null && m.blue.score >= 0) ? m.blue.score : '–';
        const label = (m.label || m.match_key || m.key || '').replace(/^Qualification\s*/i, 'Qual ');
        const winner = m.winning_alliance;

        const pill = (num) => {
            const is6907 = num === TEAM_NUM;
            const colorClass = is6907 ? 'gs-team-6907' : '';
            return `<span class="gs-team-pill ${colorClass}">${num}</span>`;
        };

        el.innerHTML = `
          <div class="gs-match-label">${_esc(label)}</div>
          <div class="gs-score-row">
            <div class="gs-alliance gs-red${winner === 'red' ? ' gs-winner' : ''}">
              <div class="gs-alliance-teams">${reds.map(pill).join('')}</div>
              <div class="gs-alliance-score">${redScore}</div>
            </div>
            <div class="gs-vs">vs</div>
            <div class="gs-alliance gs-blue${winner === 'blue' ? ' gs-winner' : ''}">
              <div class="gs-alliance-score">${blueScore}</div>
              <div class="gs-alliance-teams">${blues.map(pill).join('')}</div>
            </div>
          </div>
          ${side ? `<div class="gs-6907-side">6907 is on <strong>${side}</strong> alliance</div>` : ''}`;
    }

    // ── Breakdown ─────────────────────────────────────────

    async function _loadBreakdown(matchKey) {
        const el = _$('gs-bd-content');
        if (!el) return;
        if (!matchKey) { el.innerHTML = '<p class="gs-empty">No match key</p>'; return; }

        if (_breakdownCache[matchKey]?.available) {
            _renderBreakdown(_breakdownCache[matchKey]);
            return;
        }

        el.innerHTML = '<p class="gs-loading">Loading breakdown…</p>';
        try {
            const data = await API.matchBreakdown(matchKey);
            if (data?.available) {
                _breakdownCache[matchKey] = data;
                _renderBreakdown(data);
            } else {
                el.innerHTML = '<p class="gs-empty">⏳ Breakdown not available yet.</p>';
            }
        } catch (e) {
            el.innerHTML = `<p class="gs-empty">Breakdown error: ${_esc(e.message)}</p>`;
        }
    }

    function _renderBreakdown(data) {
        const el = _$('gs-bd-content');
        if (!el) return;

        const m = _matches6907[_matchIndex];
        if (!m) return;

        const nickMap = {};
        const statsMap = {};
        for (const side of ['red', 'blue']) {
            if (m[side]?.teams) {
                m[side].teams.forEach(t => {
                    if (t.nickname) nickMap[t.team_number] = t.nickname;
                    statsMap[t.team_number] = { opr: t.opr, epa: t.epa };
                });
            }
        }

        const redWon = data.winning_alliance === 'red';
        const blueWon = data.winning_alliance === 'blue';
        const redAllianceNum = m.red?.alliance_number;
        const blueAllianceNum = m.blue?.alliance_number;
        const isPlayoff = m.comp_level && m.comp_level !== 'qm';

        const renderFn = (data.game_year >= 2026)
            ? (typeof renderBdAlliance2026 === 'function' ? renderBdAlliance2026 : renderBdAlliance)
            : renderBdAlliance;

        el.innerHTML = `
            ${renderFn(data.red, 'red', redWon, nickMap, statsMap, redAllianceNum, isPlayoff)}
            ${renderFn(data.blue, 'blue', blueWon, nickMap, statsMap, blueAllianceNum, isPlayoff)}`;
    }

    // ── Strategy notes CRUD ────────────────────────────────

    async function _loadStrategyNotes(m) {
        const matchKey = m.key || m.match_key;
        try {
            const notes = await API.get(
                `/events/${_currentEvent}/notes?team_key=${TEAM_KEY}&match_key=${matchKey}&category=${STRATEGY_CATEGORY}&sort=desc`
            );
            if (notes && notes.length > 0) {
                const latest = notes[0];
                let parsed = { auto: '', teleop: '', endgame: '' };
                try { parsed = { ...parsed, ...JSON.parse(latest.content) }; } catch (_) {
                    parsed.auto = latest.content;
                }
                _strategyNotes[matchKey] = { ...parsed, noteId: latest.id };
            } else {
                _strategyNotes[matchKey] = { auto: '', teleop: '', endgame: '', noteId: null };
            }
        } catch (_) {
            _strategyNotes[matchKey] = { auto: '', teleop: '', endgame: '', noteId: null };
        }
        _renderStrategyForm(matchKey);
    }

    function _renderStrategyForm(matchKey) {
        const s = _strategyNotes[matchKey];
        if (!s) return;
        const auto = _$('gs-strat-auto');
        const teleop = _$('gs-strat-teleop');
        const end = _$('gs-strat-endgame');
        if (auto) auto.value = s.auto || '';
        if (teleop) teleop.value = s.teleop || '';
        if (end) end.value = s.endgame || '';
    }

    async function _onSaveStrategy() {
        const m = _matches6907[_matchIndex];
        if (!m || !_currentEvent) return;
        const matchKey = m.key || m.match_key;

        const content = JSON.stringify({
            auto: (_$('gs-strat-auto')?.value || '').trim(),
            teleop: (_$('gs-strat-teleop')?.value || '').trim(),
            endgame: (_$('gs-strat-endgame')?.value || '').trim(),
        });

        const status = _$('gs-strat-status');
        if (status) { status.textContent = 'Saving…'; status.style.color = ''; }

        const existing = _strategyNotes[matchKey];
        const headers = _postgrestHeaders('return=representation');

        try {
            if (existing?.noteId) {
                const resp = await fetch(`${REST_BASE}/notes?id=eq.${existing.noteId}`, {
                    method: 'PATCH',
                    headers,
                    body: JSON.stringify({ content, updated_at: new Date().toISOString() }),
                });
                if (!resp.ok) throw new Error(`PATCH failed: ${resp.status}`);
                if (status) status.textContent = '✓ Strategy updated';
            } else {
                const row = {
                    target_key: `${TEAM_KEY}:${matchKey}`,
                    content,
                    author_device_id: _deviceId(),
                    team_key: TEAM_KEY,
                    match_key: matchKey,
                    event_key: _currentEvent,
                    category: STRATEGY_CATEGORY,
                };
                const resp = await fetch(`${REST_BASE}/notes`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(row),
                });
                if (!resp.ok) throw new Error(`POST failed: ${resp.status}`);
                const rows = await resp.json();
                if (rows[0]) _strategyNotes[matchKey].noteId = rows[0].id;
                if (status) status.textContent = '✓ Strategy saved';
            }
            if (status) { status.style.color = 'var(--success, #22c55e)'; }
            _renderComparison(m);
        } catch (e) {
            if (status) { status.textContent = `✗ ${e.message}`; status.style.color = 'var(--danger, #ef4444)'; }
        }
    }

    // ── Caster notes (BattleStation) ──────────────────────

    async function _loadCasterNotes(m) {
        const matchKey = m.key || m.match_key;
        try {
            const notes = await NotesService.fetchNotes(_currentEvent, matchKey, TEAM_KEY);
            _casterNotes[matchKey] = (notes || []).filter(n => n.type !== 'system');
        } catch (_) {
            _casterNotes[matchKey] = [];
        }
    }

    // ── Comparison view ────────────────────────────────────

    function _renderComparison(m) {
        const el = _$('gs-comparison');
        if (!el) return;
        const matchKey = m.key || m.match_key;
        const strat = _strategyNotes[matchKey] || { auto: '', teleop: '', endgame: '' };
        const notes = _casterNotes[matchKey] || [];
        const bd = _breakdownCache[matchKey];

        // Plan column
        const planHtml = _renderPlanColumn(strat);

        // Actual column
        const actualHtml = _renderActualColumn(m, notes, bd);

        el.innerHTML = `
          <div class="gs-comp-grid">
            <div class="gs-comp-col gs-comp-plan">
              <h4 class="gs-comp-header">📋 Planned Strategy</h4>
              ${planHtml}
            </div>
            <div class="gs-comp-col gs-comp-actual">
              <h4 class="gs-comp-header">⚡ Actual Performance</h4>
              ${actualHtml}
            </div>
          </div>`;
    }

    function _renderPlanColumn(strat) {
        const phases = [
            { label: 'Auto', value: strat.auto },
            { label: 'Teleop', value: strat.teleop },
            { label: 'Endgame', value: strat.endgame },
        ];
        return phases.map(p => `
          <div class="gs-comp-phase">
            <span class="gs-phase-label">${p.label}</span>
            <span class="gs-phase-value">${p.value ? _esc(p.value) : '<em class="gs-empty-inline">—</em>'}</span>
          </div>`).join('');
    }

    function _renderActualColumn(m, notes, bd) {
        let html = '';

        // Caster notes for 6907
        if (notes.length) {
            html += '<div class="gs-actual-section"><h5 class="gs-actual-sub">Battle Notes</h5>';
            html += notes.map(n => {
                const time = n.created_at ? new Date(n.created_at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : '';
                return `<div class="gs-actual-note"><span class="gs-note-time">${time}</span><span class="gs-note-text">${_esc(n.content)}</span></div>`;
            }).join('');
            html += '</div>';
        } else {
            html += '<div class="gs-actual-section"><h5 class="gs-actual-sub">Battle Notes</h5><span class="gs-empty-inline">No caster notes for 6907</span></div>';
        }

        // Breakdown metrics for 6907's alliance
        if (bd?.available) {
            const side = _6907Side(m);
            const alliance = side ? bd[side] : null;
            const b = alliance?.breakdown;
            if (b) {
                html += '<div class="gs-actual-section"><h5 class="gs-actual-sub">Breakdown Metrics</h5>';
                const metrics = [];
                if (b.totalPoints != null) metrics.push(['Total Points', b.totalPoints]);
                if (b.totalAutoPoints != null) metrics.push(['Auto Points', b.totalAutoPoints]);
                if (b.totalTeleopPoints != null) metrics.push(['Teleop Points', b.totalTeleopPoints]);
                if (b.endGameTowerPoints != null) metrics.push(['Endgame Tower', b.endGameTowerPoints]);
                if (b.totalTowerPoints != null) metrics.push(['Tower Points', b.totalTowerPoints]);
                if (b.totalFuelCount != null) metrics.push(['Total Fuel', b.totalFuelCount]);
                if (b.autoFuelCount != null) metrics.push(['Auto Fuel', b.autoFuelCount]);
                if (b.teleopFuelCount != null) metrics.push(['Teleop Fuel', b.teleopFuelCount]);
                if (b.endgameFuelCount != null) metrics.push(['Endgame Fuel', b.endgameFuelCount]);
                if (b.foulPoints != null) metrics.push(['Foul Points', b.foulPoints]);
                if (metrics.length) {
                    html += '<div class="gs-metrics-grid">';
                    html += metrics.map(([k, v]) => `<div class="gs-metric"><span class="gs-metric-label">${_esc(k)}</span><span class="gs-metric-value">${_esc(v)}</span></div>`).join('');
                    html += '</div>';
                }
                html += '</div>';
            }
        }

        return html || '<span class="gs-empty-inline">No actual data available</span>';
    }

    // ── GoatScout table ────────────────────────────────────

    async function _loadGoatScout(eventKey) {
        const el = _$('gs-goatscout-content');
        if (!el) return;
        el.innerHTML = '<p class="gs-loading">Loading scout data…</p>';
        try {
            _goatscoutData = await API.goatscoutList(eventKey);
            if (!_goatscoutData.length) {
                el.innerHTML = '<p class="gs-empty">No GoatScout data for this event.</p>';
                return;
            }
            // Use the existing renderGoatScoutTable but with a custom container
            if (typeof renderGoatScoutTable === 'function') {
                renderGoatScoutTable('gs-goatscout-content');
            } else {
                el.innerHTML = '<p class="gs-empty">GoatScout renderer unavailable.</p>';
            }
        } catch (e) {
            el.innerHTML = `<p class="gs-empty">Error: ${_esc(e.message)}</p>`;
        }
    }

    // ── Public API ─────────────────────────────────────────
    return {
        mount,
        unmount,
        refresh,
        _onEventSelect,
        _onMatchSelect,
        _onSaveStrategy,
    };
})();
