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

    // Custom (non-TBA) offseason event placeholders that should always
    // appear in the event dropdown even if TEAM_NUM isn't registered.
    // Kept in sync with goatpredict.js CUSTOM_EVENTS until TBA publishes
    // the real event and the placeholder is dropped.
    const CUSTOM_EVENTS = [
        {
            event_key:  '2026cnsanya',
            event_name: 'China Sanya Offseason Event',
        },
    ];

    // ── State ──────────────────────────────────────────────
    let _mounted = false;
    let _events = [];
    let _currentEvent = null;
    let _matches6907 = [];
    let _matchIndex = 0;
    let _breakdownCache = {};
    let _strategyNotes = {};
    let _casterNotes = {};
    let _allGoatScoutData = [];
    let _allMatches = [];           // all event matches (not just 6907's)
    let _compareTeamA = '';
    let _compareTeamB = '';
    let _activeSubTab = 'strategy'; // 'strategy' | 'compare'

    // BattleStation state
    let _bsCtx = 'match';      // 'match' | 'frcXXXX'
    let _bsNotes = [];
    let _bsMatchStartTime = null;

    // Note editing state
    let _editingNoteId = null;

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

    function _initials(name) {
        if (!name) return '?';
        const parts = name.trim().split(/[\s.@]+/).filter(Boolean);
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        return name.slice(0, 2).toUpperCase();
    }

    function _getAuthor() {
        if (typeof Auth !== 'undefined' && Auth.getUser) {
            const u = Auth.getUser();
            if (u) return u.user_metadata?.name || u.email || 'Caster';
        }
        return 'Caster';
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

            <div class="gs-subtabs">
              <button class="gs-subtab active" data-subtab="strategy" onclick="GoatStrat._onSubTabClick('strategy')">Strategy</button>
              <button class="gs-subtab" data-subtab="compare" onclick="GoatStrat._onSubTabClick('compare')">1v1 Compare</button>
            </div>

            <div id="gs-strategy-view">
              <div class="gs-panel gs-bd-panel">
                <h3 class="gs-panel-title">Score Breakdown</h3>
                <div id="gs-bd-content" class="gs-bd-content"></div>
              </div>

              <div class="gs-panel gs-bs-panel">
                <h3 class="gs-panel-title">Battle Station</h3>
                <div id="gs-bs-root" class="gs-bs-root"></div>
              </div>

              <div class="gs-main-row">
                <div class="gs-panel gs-strat-panel">
                  <h3 class="gs-panel-title">6907 Strategy Plan</h3>
                  <div class="gs-strat-grid">
                    <div class="gs-strat-field">
                      <label>Auto</label>
                      <textarea id="gs-strat-auto" rows="4" placeholder="Auto phase strategy…"></textarea>
                    </div>
                    <div class="gs-strat-field">
                      <label>Transition</label>
                      <textarea id="gs-strat-transition" rows="4" placeholder="Auto→Teleop transition strategy…"></textarea>
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
              </div>

              <div class="gs-panel">
                <h3 class="gs-panel-title">Match Scout Data <span class="gs-panel-sub" id="gs-scout-sub"></span></h3>
                <div id="gs-goatscout-content"></div>
              </div>
            </div>

            <div id="gs-compare-view" class="hidden">
              <div class="gs-panel">
                <div class="gs-compare-bar">
                  <div class="gs-compare-team-sel">
                    <label>Team A</label>
                    <select id="gs-cmp-team-a" class="gs-select" onchange="GoatStrat._onCompareTeamAChange(this.value)">
                      <option value="">Select team…</option>
                    </select>
                  </div>
                  <span class="gs-compare-vs">VS</span>
                  <div class="gs-compare-team-sel">
                    <label>Team B</label>
                    <select id="gs-cmp-team-b" class="gs-select" onchange="GoatStrat._onCompareTeamBChange(this.value)">
                      <option value="">Select team…</option>
                    </select>
                  </div>
                  <button class="gs-btn gs-btn-save" onclick="GoatStrat._onCompareBtn()">Compare</button>
                </div>
                <div id="gs-compare-results"></div>
              </div>
            </div>
          </div>`;
    }

    // ── Data loading ───────────────────────────────────────

    async function _loadEvents() {
        const sel = _$('gs-event-sel');
        try {
            const stats = await API.teamStats(TEAM_NUM, 2026);
            _events = stats?.events_this_year || [];

            // Inject custom event placeholders (Sanya, etc.) at the top of
            // the list so they're selectable even if TEAM_NUM isn't
            // registered. Skip any whose key already came back from TBA.
            for (const ce of CUSTOM_EVENTS) {
                if (!_events.some(e => e.event_key === ce.event_key)) {
                    _events.unshift(ce);
                }
            }

            if (!_events.length) {
                sel.innerHTML = '<option value="">No events found for 6907 in 2026</option>';
                return;
            }
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
        // Sync global currentEvent so shared goatscout.js save/add-team
        // functions (which use the global) target the correct event.
        if (typeof currentEvent !== 'undefined') currentEvent = eventKey;
        _breakdownCache = {};
        _strategyNotes = {};
        _casterNotes = {};
        _allGoatScoutData = [];
        _allMatches = [];
        _matches6907 = [];
        _matchIndex = 0;
        _bsNotes = [];
        _bsCtx = 'match';

        const msel = _$('gs-match-sel');
        if (msel) msel.innerHTML = '<option value="">Loading matches…</option>';
        const bd = _$('gs-bd-content');
        if (bd) bd.innerHTML = '<p class="gs-loading">Loading…</p>';
        const comp = _$('gs-comparison');
        if (comp) comp.innerHTML = '';
        const bsRoot = _$('gs-bs-root');
        if (bsRoot) bsRoot.innerHTML = '';

        try {
            const data = await API.allMatches(eventKey);
            const all = data?.matches || [];
            _allMatches = all;
            _matches6907 = all.filter(_has6907);

            if (!_matches6907.length) {
                // Friendlier message for custom offseason events whose
                // schedule hasn't been published yet.
                const isCustom = CUSTOM_EVENTS.some(ce => ce.event_key === eventKey);
                const matchMsg = isCustom ? '赛程尚未发布' : 'No matches with 6907';
                const bdMsg = isCustom
                    ? '赛程尚未发布。比赛开始后这里会显示比分拆解、Battle Station 笔记和 6907 战术计划。'
                    : 'Team 6907 has no matches at this event yet.';
                if (msel) msel.innerHTML = `<option value="">${_esc(matchMsg)}</option>`;
                if (bd) bd.innerHTML = `<p class="gs-empty">${_esc(bdMsg)}</p>`;
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
            _populateCompareSelectors();
        } catch (e) {
            if (msel) msel.innerHTML = `<option value="">Error: ${_esc(e.message)}</option>`;
        }

        // Load GoatScout in parallel (non-blocking)
        _loadAllGoatScout(eventKey);
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

        _renderBattleStation(m);
        _renderGoatScoutForMatch(m);

        const matchKey = m.key || m.match_key;
        await Promise.all([
            _loadBreakdown(matchKey),
            _loadStrategyNotes(m),
            _loadCasterNotes(m),
        ]);
        _renderComparison(m);
    }

    // ═══════════════════════════════════════════════════════
    // BattleStation — Team pills + Timeline + Note input
    // (reuses .bs-* CSS classes, self-contained state)
    // ═══════════════════════════════════════════════════════

    const BS_LEXICON = {
        AUTO_START:    { label: 'Auto',        color: 'emerald' },
        TELEOP_START:  { label: 'Teleop',      color: 'sky' },
        ENDGAME_START: { label: 'Endgame',     color: 'amber' },
        MATCH_OVER:    { label: 'Match Over',  color: 'slate' },
        FIELD_FAULT:   { label: 'Field Fault', color: 'red' },
    };

    function _bsIcon(type) {
        const icons = {
            robot: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg>',
            gamepad: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="15" y1="13" x2="15.01" y2="13"/><line x1="18" y1="11" x2="18.01" y2="11"/><rect x="2" y="6" width="20" height="12" rx="2"/></svg>',
            flag: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>',
            stopwatch: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M10 2h4"/><path d="M12 2v3"/></svg>',
            warning: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        };
        if (type === 'AUTO_START') return icons.robot;
        if (type === 'TELEOP_START') return icons.gamepad;
        if (type === 'ENDGAME_START') return icons.flag;
        if (type === 'MATCH_OVER') return icons.stopwatch;
        return icons.warning;
    }

    function _renderBattleStation(m) {
        const root = _$('gs-bs-root');
        if (!root) return;

        const reds = _teamNums(m.red);
        const blues = _teamNums(m.blue);
        _bsCtx = 'match';

        root.innerHTML = `
          <div class="bs-shell gs-bs-shell">
            <div class="bs-hotrow">
              ${reds.map(n => `
                <button class="bs-pill-btn bs-pill-red" data-team="frc${n}" onclick="GoatStrat._onBsPillClick(this)">
                  ${n}
                </button>`).join('')}
              <button class="bs-pill-btn bs-pill-general bs-pill-active" data-team="match" onclick="GoatStrat._onBsPillClick(this)">
                General
              </button>
              ${blues.map(n => `
                <button class="bs-pill-btn bs-pill-blue" data-team="frc${n}" onclick="GoatStrat._onBsPillClick(this)">
                  ${n}
                </button>`).join('')}
            </div>

            <div class="bs-feed gs-bs-feed" id="gs-bs-timeline">
              <div class="bs-gradient-anchor" aria-hidden="true">
                <div class="bs-gradient-red"></div>
                <div class="bs-gradient-blue"></div>
              </div>
              <div class="bs-spine"></div>
              <div class="bs-feed-inner" id="gs-bs-timeline-inner">
                <div class="bs-empty-feed"><span>Loading notes…</span></div>
              </div>
            </div>

            <div class="bs-dock-macros">
              ${Object.entries(BS_LEXICON).map(([code, def]) => `
                <button class="bs-chip bs-chip-${def.color}" onclick="GoatStrat._onBsMacro('${code}')" title="${def.label}">
                  ${_bsIcon(code)}
                  <span>${_esc(def.label)}</span>
                </button>`).join('')}
            </div>
            <div class="bs-dock">
              <form class="bs-dock-form" onsubmit="GoatStrat._onBsSubmit(event)">
                <input type="text" id="gs-bs-input" class="bs-input" placeholder="Add a note…" autocomplete="off" />
                <button type="submit" class="bs-send-btn">Send</button>
              </form>
            </div>
          </div>`;
    }

    function _bsNoteSide(note, m) {
        if (note.type === 'system') return 'center';
        if (!note.team_key || !m) return 'center';
        const num = parseInt(String(note.team_key).replace(/\D/g, ''), 10);
        if (_teamNums(m.red).includes(num)) return 'red';
        if (_teamNums(m.blue).includes(num)) return 'blue';
        return 'center';
    }

    function _bsFormatTime(isoString) {
        if (!isoString) return '';
        const ts = new Date(isoString).getTime();
        if (Number.isNaN(ts)) return '';
        if (!_bsMatchStartTime) {
            const auto = _bsNotes.find(n => n.type === 'system' && n.content === 'AUTO_START');
            _bsMatchStartTime = auto ? auto.created_at
                            : (_bsNotes.length ? _bsNotes[0].created_at : isoString);
        }
        const base = new Date(_bsMatchStartTime).getTime();
        const diffSec = Math.round((ts - base) / 1000);
        const sign = diffSec < 0 ? '\u2212' : '+';
        const abs = Math.abs(diffSec);
        const min = Math.floor(abs / 60);
        const sec = String(abs % 60).padStart(2, '0');
        return `T${sign}\u2009${min}:${sec}`;
    }

    function _renderBsTimeline() {
        const inner = _$('gs-bs-timeline-inner');
        if (!inner) return;

        if (!_bsNotes.length) {
            inner.innerHTML = '<div class="bs-empty-feed"><span>No notes yet — use the macro deck or type below.</span></div>';
            return;
        }

        const m = _matches6907[_matchIndex];
        const reversed = [..._bsNotes].reverse();
        inner.innerHTML = reversed.map((n, i) => {
            const isDimmed = _bsCtx !== 'match' && n.type !== 'system' && n.team_key !== _bsCtx;
            const html = _renderBsNote(n, i === 0 && !isDimmed, m);
            if (isDimmed) {
                return html.replace(/class="bs-row/, 'class="bs-row bs-note-dimmed');
            }
            return html;
        }).join('');
    }

    function _renderBsNote(note, isNewest, m) {
        const side = _bsNoteSide(note, m);
        const tPlus = _bsFormatTime(note.created_at);
        const animClass = isNewest ? ' bs-anim-in' : '';

        if (note.type === 'system') {
            const def = BS_LEXICON[note.content] || { label: note.content, color: 'slate' };
            return `
              <div class="bs-row bs-row-center${animClass}">
                <div class="bs-sys-badge bs-sys-${def.color}">
                  ${_bsIcon(note.content)}
                  <span class="bs-sys-label">${_esc(def.label)}</span>
                  <span class="bs-sys-time">${tPlus}</span>
                </div>
              </div>`;
        }

        const teamNum = note.team_key ? note.team_key.replace(/\D/g, '') : '';
        const authorName = note.author || 'Caster';
        const avatarColor = side === 'blue' ? 'blue' : (side === 'red' ? 'red' : 'neutral');
        const avatar = `<div class="bs-avatar bs-avatar-${avatarColor}">${_esc(_initials(authorName))}</div>`;

        if (side === 'red') {
            return `
              <div class="bs-row${animClass}">
                <div class="bs-col bs-col-left">
                  ${avatar}
                  <div class="bs-bubble bs-bubble-red">
                    <div class="bs-bubble-head">
                      <span class="bs-bubble-time">${tPlus}</span>
                      <span class="bs-bubble-team bs-bubble-team-red">${teamNum}</span>
                    </div>
                    <p class="bs-bubble-body">${_esc(note.content)}</p>
                  </div>
                </div>
                <div class="bs-col bs-col-right"></div>
              </div>`;
        }

        if (side === 'blue') {
            return `
              <div class="bs-row${animClass}">
                <div class="bs-col bs-col-left"></div>
                <div class="bs-col bs-col-right">
                  <div class="bs-bubble bs-bubble-blue">
                    <div class="bs-bubble-head">
                      <span class="bs-bubble-team bs-bubble-team-blue">${teamNum}</span>
                      <span class="bs-bubble-time">${tPlus}</span>
                    </div>
                    <p class="bs-bubble-body">${_esc(note.content)}</p>
                  </div>
                  ${avatar}
                </div>
              </div>`;
        }

        return `
          <div class="bs-row bs-row-center${animClass}">
            <div class="bs-bubble bs-bubble-neutral">
              <span class="bs-bubble-author">${_esc(authorName)}</span>
              <p class="bs-bubble-body bs-bubble-body-center">${_esc(note.content)}</p>
              <span class="bs-bubble-time">${tPlus}</span>
            </div>
          </div>`;
    }

    function _onBsPillClick(btn) {
        const team = btn.dataset.team;
        _bsCtx = team === 'match' ? 'match' : team;
        const root = _$('gs-bs-root');
        if (root) root.querySelectorAll('.bs-pill-btn').forEach(b => b.classList.remove('bs-pill-active'));
        btn.classList.add('bs-pill-active');
        _renderBsTimeline();
    }

    async function _onBsMacro(code) {
        if (!_currentEvent) return;
        const m = _matches6907[_matchIndex];
        if (!m) return;
        const matchKey = m.key || m.match_key;

        const optimistic = {
            id: 'opt-' + Date.now(),
            event_key: _currentEvent,
            match_key: matchKey,
            author: 'SYSTEM',
            content: code,
            type: 'system',
            created_at: new Date().toISOString(),
        };
        _bsNotes.push(optimistic);
        _bsMatchStartTime = null;
        _renderBsTimeline();
        _bsScrollToTop();

        try {
            await NotesService.insertNote({
                event_key: _currentEvent,
                match_key: matchKey,
                author: 'SYSTEM',
                content: code,
                type: 'system',
            });
            // Refresh from server to get the real ID
            await _loadCasterNotes(m);
            _renderBsTimeline();
        } catch (e) {
            console.error('[GoatStrat] Macro inject failed:', e);
        }
    }

    async function _onBsSubmit(e) {
        e.preventDefault();
        if (!_currentEvent) return;
        const m = _matches6907[_matchIndex];
        if (!m) return;
        const matchKey = m.key || m.match_key;

        const input = _$('gs-bs-input');
        if (!input) return;
        const text = input.value.trim();
        if (!text) return;
        input.value = '';

        const teamKey = (_bsCtx !== 'match') ? _bsCtx : null;
        const author = _getAuthor();

        const optimistic = {
            id: 'opt-' + Date.now(),
            event_key: _currentEvent,
            match_key: matchKey,
            team_key: teamKey,
            author: author,
            content: text,
            type: 'manual',
            created_at: new Date().toISOString(),
        };
        _bsNotes.push(optimistic);
        _bsMatchStartTime = null;
        _renderBsTimeline();
        _bsScrollToTop();

        // Reset to General after sending
        _bsCtx = 'match';
        const root = _$('gs-bs-root');
        if (root) {
            root.querySelectorAll('.bs-pill-btn').forEach(b => b.classList.remove('bs-pill-active'));
            const generalBtn = root.querySelector('.bs-pill-general');
            if (generalBtn) generalBtn.classList.add('bs-pill-active');
        }

        try {
            await NotesService.insertNote({
                event_key: _currentEvent,
                match_key: matchKey,
                team_key: teamKey,
                author: author,
                content: text,
                type: 'manual',
            });
            await _loadCasterNotes(m);
            _renderBsTimeline();
        } catch (err) {
            console.error('[GoatStrat] Note submit failed:', err);
        }
    }

    function _bsScrollToTop() {
        requestAnimationFrame(() => {
            const tl = _$('gs-bs-timeline');
            if (tl) tl.scrollTop = 0;
        });
    }

    // ── Caster notes loading (for BattleStation + comparison) ──

    async function _loadCasterNotes(m) {
        const matchKey = m.key || m.match_key;
        try {
            const notes = await NotesService.fetchNotes(_currentEvent, matchKey, null);
            _casterNotes[matchKey] = (notes || []).filter(n => n.type !== 'system');
            _bsNotes = notes || [];
            _bsMatchStartTime = null;
            _renderBsTimeline();
            _bsScrollToTop();
        } catch (_) {
            _casterNotes[matchKey] = [];
            _bsNotes = [];
            _renderBsTimeline();
        }
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
        const teamLookup = {};
        for (const side of ['red', 'blue']) {
            if (m[side]?.teams) {
                m[side].teams.forEach(t => {
                    if (t.nickname) nickMap[t.team_number] = t.nickname;
                    statsMap[t.team_number] = { opr: t.opr, epa: t.epa };
                    teamLookup[t.team_number] = t;
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

        const rawHtml = `
            <div class="gs-bd-alliances-row">
              <div class="gs-bd-alliance-col gs-bd-alliance-red">
                ${renderFn(data.red, 'red', redWon, nickMap, statsMap, redAllianceNum, isPlayoff)}
              </div>
              <div class="gs-bd-alliance-col gs-bd-alliance-blue">
                ${renderFn(data.blue, 'blue', blueWon, nickMap, statsMap, blueAllianceNum, isPlayoff)}
              </div>
            </div>`;

        // Post-process: inject team stats under each robot card's team number
        const temp = document.createElement('div');
        temp.innerHTML = rawHtml;
        temp.querySelectorAll('.bd-robot-card[data-team]').forEach(card => {
            const num = parseInt(card.dataset.team, 10);
            const t = teamLookup[num];
            if (!t) return;
            const rank = t.rank ?? '–';
            const wlt = `${t.wins ?? 0}-${t.losses ?? 0}-${t.ties ?? 0}`;
            const opr = t.opr != null ? (typeof t.opr === 'number' ? t.opr.toFixed(1) : t.opr) : '–';
            const avgRp = t.avg_rp != null ? (typeof t.avg_rp === 'number' ? t.avg_rp.toFixed(2) : t.avg_rp) : '–';
            const is6907 = num === TEAM_NUM;
            const statsDiv = document.createElement('div');
            statsDiv.className = 'gs-bd-robot-stats' + (is6907 ? ' gs-bd-robot-6907' : '');
            statsDiv.innerHTML = `
                <span class="gs-bd-stat"><span class="gs-bd-stat-lbl">Rank</span><span class="gs-bd-stat-val">${rank}</span></span>
                <span class="gs-bd-stat"><span class="gs-bd-stat-lbl">Avg RP</span><span class="gs-bd-stat-val">${avgRp}</span></span>
                <span class="gs-bd-stat"><span class="gs-bd-stat-lbl">OPR</span><span class="gs-bd-stat-val">${opr}</span></span>
                <span class="gs-bd-stat"><span class="gs-bd-stat-lbl">W-L-T</span><span class="gs-bd-stat-val">${wlt}</span></span>`;
            const numEl = card.querySelector('.bd-robot-num');
            if (numEl && numEl.nextSibling) {
                card.insertBefore(statsDiv, numEl.nextSibling);
            } else if (numEl) {
                card.appendChild(statsDiv);
            }
        });

        el.innerHTML = temp.innerHTML;
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
                let parsed = { auto: '', transition: '', teleop: '', endgame: '' };
                try { parsed = { ...parsed, ...JSON.parse(latest.content) }; } catch (_) {
                    parsed.auto = latest.content;
                }
                _strategyNotes[matchKey] = { ...parsed, noteId: latest.id };
            } else {
                _strategyNotes[matchKey] = { auto: '', transition: '', teleop: '', endgame: '', noteId: null };
            }
        } catch (_) {
            _strategyNotes[matchKey] = { auto: '', transition: '', teleop: '', endgame: '', noteId: null };
        }
        _renderStrategyForm(matchKey);
    }

    function _renderStrategyForm(matchKey) {
        const s = _strategyNotes[matchKey];
        if (!s) return;
        const auto = _$('gs-strat-auto');
        const trans = _$('gs-strat-transition');
        const teleop = _$('gs-strat-teleop');
        const end = _$('gs-strat-endgame');
        if (auto) auto.value = s.auto || '';
        if (trans) trans.value = s.transition || '';
        if (teleop) teleop.value = s.teleop || '';
        if (end) end.value = s.endgame || '';
    }

    async function _onSaveStrategy() {
        const m = _matches6907[_matchIndex];
        if (!m || !_currentEvent) return;
        const matchKey = m.key || m.match_key;

        const content = JSON.stringify({
            auto: (_$('gs-strat-auto')?.value || '').trim(),
            transition: (_$('gs-strat-transition')?.value || '').trim(),
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

    // ── Comparison view ────────────────────────────────────

    function _renderComparison(m) {
        const el = _$('gs-comparison');
        if (!el) return;
        const matchKey = m.key || m.match_key;
        const notes = _casterNotes[matchKey] || [];
        const bd = _breakdownCache[matchKey];

        const actualHtml = _renderActualColumn(m, notes, bd);

        el.innerHTML = `
          <div class="gs-comp-single">
            <h4 class="gs-comp-header">⚡ Actual Performance</h4>
            ${actualHtml}
          </div>`;
    }

    function _renderActualColumn(m, notes, bd) {
        let html = '';

        // Battle Notes with edit
        html += '<div class="gs-actual-section"><h5 class="gs-actual-sub">Battle Notes</h5>';
        if (notes.length) {
            html += notes.map(n => {
                const time = n.created_at ? new Date(n.created_at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : '';
                if (_editingNoteId === n.id) {
                    return `<div class="gs-actual-note gs-note-editing" data-note-id="${n.id}">
                        <span class="gs-note-time">${time}</span>
                        <textarea class="gs-note-edit-area" id="gs-note-edit-${n.id}" rows="2">${_esc(n.content)}</textarea>
                        <div class="gs-note-edit-actions">
                            <button class="gs-btn gs-btn-sm" onclick="GoatStrat._onSaveNoteEdit('${n.id}')">Save</button>
                            <button class="gs-btn gs-btn-sm gs-btn-cancel" onclick="GoatStrat._onCancelNoteEdit()">Cancel</button>
                        </div>
                    </div>`;
                }
                return `<div class="gs-actual-note" data-note-id="${n.id}">
                    <span class="gs-note-time">${time}</span>
                    <span class="gs-note-text">${_esc(n.content)}</span>
                    <button class="gs-note-edit-btn" onclick="GoatStrat._onEditNote('${n.id}')">✎</button>
                </div>`;
            }).join('');
        } else {
            html += '<span class="gs-empty-inline">No caster notes</span>';
        }
        html += '</div>';

        // Breakdown metrics — red vs blue fuel points per phase + tower + foul
        if (bd?.available) {
            const rb = bd.red?.breakdown || {};
            const bb = bd.blue?.breakdown || {};
            const phases = [
                ['Auto Fuel', rb.autoFuelPoints, bb.autoFuelPoints],
                ['Transition Fuel', rb.transitionFuelPoints, bb.transitionFuelPoints],
                ['Shift 1 Fuel', rb.shift1FuelPoints, bb.shift1FuelPoints],
                ['Shift 2 Fuel', rb.shift2FuelPoints, bb.shift2FuelPoints],
                ['Shift 3 Fuel', rb.shift3FuelPoints, bb.shift3FuelPoints],
                ['Shift 4 Fuel', rb.shift4FuelPoints, bb.shift4FuelPoints],
                ['Endgame Fuel', rb.endgameFuelPoints, bb.endgameFuelPoints],
                ['Tower', rb.totalTowerPoints, bb.totalTowerPoints],
                ['Foul', rb.foulPoints, bb.foulPoints],
            ];
            html += '<div class="gs-actual-section"><h5 class="gs-actual-sub">Breakdown metrics</h5>';
            html += `<table class="gs-bd-metrics-table">
                <thead><tr><th>Phase</th><th class="gs-red-col">Red</th><th class="gs-blue-col">Blue</th></tr></thead>
                <tbody>`;
            html += phases.map(([label, red, blue]) => {
                const rv = red != null ? red : '–';
                const bv = blue != null ? blue : '–';
                return `<tr><td class="gs-metric-phase">${_esc(label)}</td><td class="gs-red-col">${rv}</td><td class="gs-blue-col">${bv}</td></tr>`;
            }).join('');
            html += '</tbody></table></div>';
        }

        return html || '<span class="gs-empty-inline">No actual data available</span>';
    }

    function _onEditNote(noteId) {
        _editingNoteId = noteId;
        const m = _matches6907[_matchIndex];
        if (m) _renderComparison(m);
    }

    function _onCancelNoteEdit() {
        _editingNoteId = null;
        const m = _matches6907[_matchIndex];
        if (m) _renderComparison(m);
    }

    async function _onSaveNoteEdit(noteId) {
        const ta = _$('gs-note-edit-' + noteId);
        if (!ta) return;
        const text = ta.value.trim();
        if (!text) return;

        const headers = _postgrestHeaders();
        try {
            const resp = await fetch(`${REST_BASE}/caster_notes?id=eq.${noteId}`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ content: text }),
            });
            if (!resp.ok) throw new Error(`PATCH failed: ${resp.status}`);
            _editingNoteId = null;
            const m = _matches6907[_matchIndex];
            if (m) {
                await _loadCasterNotes(m);
                _renderComparison(m);
            }
        } catch (e) {
            console.error('[GoatStrat] Note edit failed:', e);
        }
    }

    // ── GoatScout (filtered to current match teams) ────────

    async function _loadAllGoatScout(eventKey) {
        try {
            _allGoatScoutData = await API.goatscoutList(eventKey);
            // If we already have a match selected, render filtered data
            if (_matches6907.length) {
                _renderGoatScoutForMatch(_matches6907[_matchIndex]);
            }
        } catch (e) {
            const el = _$('gs-goatscout-content');
            if (el) el.innerHTML = `<p class="gs-empty">Error loading scout data: ${_esc(e.message)}</p>`;
        }
    }

    function _renderGoatScoutForMatch(m) {
        const el = _$('gs-goatscout-content');
        if (!el) return;
        const sub = _$('gs-scout-sub');

        if (!_allGoatScoutData || !_allGoatScoutData.length) {
            el.innerHTML = '<p class="gs-empty">No GoatScout data for this event.</p>';
            if (sub) sub.textContent = '';
            return;
        }

        // Get the 6 team numbers in this match
        const matchTeamKeys = new Set();
        for (const side of ['red', 'blue']) {
            if (m[side]?.teams) {
                m[side].teams.forEach(t => {
                    matchTeamKeys.add(`frc${t.team_number}`);
                });
            }
        }

        // Filter to only teams in this match
        const filtered = _allGoatScoutData.filter(entry => matchTeamKeys.has(entry.team_key));

        if (!filtered.length) {
            el.innerHTML = '<p class="gs-empty">No scout data for teams in this match.</p>';
            if (sub) sub.textContent = '';
            return;
        }

        // Set the global _goatscoutData (from goatscout.js) to the filtered list
        if (typeof _goatscoutData !== 'undefined') {
            _goatscoutData.length = 0;
            _goatscoutData.push(...filtered);
        }

        if (sub) sub.textContent = `(${filtered.length} teams in this match)`;

        // Use the existing renderGoatScoutTable with our custom container
        if (typeof renderGoatScoutTable === 'function') {
            renderGoatScoutTable('gs-goatscout-content');
            // Add alliance color classes to rows
            const redNums = new Set(_teamNums(m.red));
            const blueNums = new Set(_teamNums(m.blue));
            el.querySelectorAll('tr').forEach(tr => {
                const firstCell = tr.querySelector('.gs-team-name, td');
                if (!firstCell) return;
                const num = parseInt(firstCell.textContent.trim().replace(/\D/g, ''), 10);
                if (isNaN(num)) return;
                if (redNums.has(num)) tr.classList.add('gs-scout-row-red');
                else if (blueNums.has(num)) tr.classList.add('gs-scout-row-blue');
            });
        } else {
            el.innerHTML = '<p class="gs-empty">GoatScout renderer unavailable.</p>';
        }
    }

    // ── 1v1 Team Compare ──────────────────────────────────

    function _onSubTabClick(tabName) {
        _activeSubTab = tabName;
        const stratView = _$('gs-strategy-view');
        const cmpView = _$('gs-compare-view');
        if (!stratView || !cmpView) return;
        document.querySelectorAll('.gs-subtab').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.subtab === tabName);
        });
        if (tabName === 'compare') {
            stratView.classList.add('hidden');
            cmpView.classList.remove('hidden');
            if (!_allMatches.length) _populateCompareSelectors();
        } else {
            stratView.classList.remove('hidden');
            cmpView.classList.add('hidden');
        }
    }

    function _populateCompareSelectors() {
        const selA = _$('gs-cmp-team-a');
        const selB = _$('gs-cmp-team-b');
        if (!selA || !selB) return;

        // Extract unique team keys from all matches
        const teamSet = new Map(); // teamKey -> team_number
        for (const m of _allMatches) {
            for (const side of ['red', 'blue']) {
                if (m[side]?.teams) {
                    m[side].teams.forEach(t => {
                        const tk = `frc${t.team_number}`;
                        if (!teamSet.has(tk)) teamSet.set(tk, t.team_number);
                    });
                }
            }
        }

        const sorted = [...teamSet.entries()].sort((a, b) => a[1] - b[1]);
        const options = ['<option value="">Select team…</option>']
            .concat(sorted.map(([tk, num]) => `<option value="${tk}">${num}</option>`));

        const html = options.join('');
        selA.innerHTML = html;
        selB.innerHTML = html;

        // Pre-select 6907 as Team A if available
        const key6907 = `frc${TEAM_NUM}`;
        if (teamSet.has(key6907)) {
            selA.value = key6907;
            _compareTeamA = key6907;
        }
    }

    function _onCompareTeamAChange(val) {
        _compareTeamA = val;
    }

    function _onCompareTeamBChange(val) {
        _compareTeamB = val;
    }

    async function _onCompareBtn() {
        if (!_compareTeamA || !_compareTeamB) {
            const el = _$('gs-compare-results');
            if (el) el.innerHTML = '<p class="gs-empty">Please select both teams.</p>';
            return;
        }
        if (_compareTeamA === _compareTeamB) {
            const el = _$('gs-compare-results');
            if (el) el.innerHTML = '<p class="gs-empty">Please select two different teams.</p>';
            return;
        }
        await _renderCompare();
    }

    async function _renderCompare() {
        const el = _$('gs-compare-results');
        if (!el) return;
        el.innerHTML = '<p class="gs-loading">Loading comparison…</p>';

        try {
            // Build team stats lookup from _allMatches (has rank, avg_rp, w-l-t, opr)
            const statsMap = {};
            for (const m of _allMatches) {
                for (const side of ['red', 'blue']) {
                    if (m[side]?.teams) {
                        for (const t of m[side].teams) {
                            const tk = `frc${t.team_number}`;
                            if (!statsMap[tk]) {
                                statsMap[tk] = {
                                    team_key: tk,
                                    team_number: t.team_number,
                                    nickname: t.nickname || '',
                                    rank: t.rank ?? null,
                                    avg_rp: t.avg_rp ?? null,
                                    opr: t.opr ?? null,
                                    wins: t.wins ?? 0,
                                    losses: t.losses ?? 0,
                                    ties: t.ties ?? 0,
                                };
                            }
                        }
                    }
                }
            }

            // Merge with compareTeams API for EPA, qual_average, high_score
            let teamAStats = statsMap[_compareTeamA] || { team_key: _compareTeamA, team_number: parseInt(_compareTeamA.replace('frc',''), 10) };
            let teamBStats = statsMap[_compareTeamB] || { team_key: _compareTeamB, team_number: parseInt(_compareTeamB.replace('frc',''), 10) };

            try {
                const cmpData = await API.compareTeams(_currentEvent, [_compareTeamA, _compareTeamB]);
                const teams = cmpData?.teams || [];
                const cmpA = teams.find(t => t.team_key === _compareTeamA) || {};
                const cmpB = teams.find(t => t.team_key === _compareTeamB) || {};
                // Fill in fields only from compareTeams (EPA, qual_average, high_score, matches_played)
                teamAStats = { ...cmpA, ...teamAStats };
                teamBStats = { ...cmpB, ...teamBStats };
            } catch (_) { /* _allMatches data is sufficient fallback */ }

            // Get scouting data for both teams
            const scoutA = _allGoatScoutData.find(d => d.team_key === _compareTeamA);
            const scoutB = _allGoatScoutData.find(d => d.team_key === _compareTeamB);
            const metricsA = scoutA?.metrics || {};
            const metricsB = scoutB?.metrics || {};

            // Get match history for both teams
            const matchesA = _getTeamMatches(_compareTeamA);
            const matchesB = _getTeamMatches(_compareTeamB);

            el.innerHTML = _buildCompareHtml(teamAStats, teamBStats, metricsA, metricsB, matchesA, matchesB);
        } catch (e) {
            el.innerHTML = `<p class="gs-empty">Error: ${_esc(e.message)}</p>`;
        }
    }

    function _getTeamMatches(teamKey) {
        const results = [];
        for (const m of _allMatches) {
            if (m.comp_level && m.comp_level !== 'qm') continue;
            for (const side of ['red', 'blue']) {
                if (m[side]?.teams) {
                    const found = m[side].teams.some(t => `frc${t.team_number}` === teamKey);
                    if (found) {
                        const otherSide = side === 'red' ? 'blue' : 'red';
                        const myScore = m[side]?.score ?? -1;
                        const oppScore = m[otherSide]?.score ?? -1;
                        const won = myScore > oppScore;
                        const tied = myScore === oppScore;
                        results.push({
                            label: (m.label || m.key || '').replace(/^Qualification\s*/i, 'Qual '),
                            side,
                            myScore,
                            oppScore,
                            won,
                            tied,
                        });
                        break;
                    }
                }
            }
        }
        return results;
    }

    function _fmtVal(v) {
        if (v == null || v === '') return '—';
        return _esc(String(v));
    }

    function _statRow(label, valA, valB, higherIsBetter) {
        const aNum = typeof valA === 'number' ? valA : parseFloat(valA);
        const bNum = typeof valB === 'number' ? valB : parseFloat(valB);
        let aClass = '', bClass = '';
        if (!isNaN(aNum) && !isNaN(bNum) && aNum !== bNum) {
            if (higherIsBetter) {
                if (aNum > bNum) aClass = ' gs-cmp-better';
                else bClass = ' gs-cmp-better';
            } else {
                if (aNum < bNum) aClass = ' gs-cmp-better';
                else bClass = ' gs-cmp-better';
            }
        }
        return `<tr>
            <td class="gs-cmp-lbl">${_esc(label)}</td>
            <td class="gs-cmp-val${aClass}">${_fmtVal(valA)}</td>
            <td class="gs-cmp-val${bClass}">${_fmtVal(valB)}</td>
        </tr>`;
    }

    function _buildCompareHtml(a, b, mA, mB, matchesA, matchesB) {
        const numA = a.team_number || _compareTeamA.replace('frc', '');
        const numB = b.team_number || _compareTeamB.replace('frc', '');
        const nickA = _esc(a.nickname || '');
        const nickB = _esc(b.nickname || '');

        // Section 1: Team Info Cards
        let html = `
        <div class="gs-cmp-section">
            <h4 class="gs-cmp-section-title">Team Stats</h4>
            <div class="gs-cmp-team-grid">
                <div class="gs-cmp-team-card gs-cmp-team-a">
                    <div class="gs-cmp-team-num">${numA}</div>
                    <div class="gs-cmp-team-nick">${nickA}</div>
                </div>
                <div class="gs-cmp-team-card gs-cmp-team-b">
                    <div class="gs-cmp-team-num">${numB}</div>
                    <div class="gs-cmp-team-nick">${nickB}</div>
                </div>
            </div>
            <table class="gs-cmp-table">
                <thead><tr><th>Metric</th><th>Team ${numA}</th><th>Team ${numB}</th></tr></thead>
                <tbody>
                    ${_statRow('Rank', a.rank, b.rank, false)}
                    ${_statRow('W-L-T', `${a.wins || 0}-${a.losses || 0}-${a.ties || 0}`, `${b.wins || 0}-${b.losses || 0}-${b.ties || 0}`, null)}
                    ${_statRow('OPR', a.opr, b.opr, true)}
                    ${_statRow('EPA', a.epa, b.epa, true)}
                    ${_statRow('EPA Auto', a.epa_auto, b.epa_auto, true)}
                    ${_statRow('EPA Teleop', a.epa_teleop, b.epa_teleop, true)}
                    ${_statRow('EPA Endgame', a.epa_endgame, b.epa_endgame, true)}
                    ${_statRow('Avg RP', a.avg_rp, b.avg_rp, true)}
                    ${_statRow('Qual Avg', a.qual_average, b.qual_average, true)}
                    ${_statRow('High Score', a.high_score, b.high_score, true)}
                    ${_statRow('Matches Played', a.matches_played, b.matches_played, null)}
                </tbody>
            </table>
        </div>`;

        // Section 2: Scouting Metrics
        const groups = (typeof GOATSCOUT_METRIC_GROUPS !== 'undefined') ? GOATSCOUT_METRIC_GROUPS : [];
        if (groups.length) {
            html += `
        <div class="gs-cmp-section">
            <h4 class="gs-cmp-section-title">Scouting Data</h4>
            <table class="gs-cmp-table">
                <thead><tr><th>Metric</th><th>Team ${numA}</th><th>Team ${numB}</th></tr></thead>
                <tbody>`;
            for (const grp of groups) {
                html += `<tr class="gs-cmp-group-row"><td colspan="3">${_esc(grp.label)}</td></tr>`;
                for (const key of grp.metrics) {
                    const valA = mA[key];
                    const valB = mB[key];
                    const aNonEmpty = valA != null && valA !== '' && valA !== '未填';
                    const bNonEmpty = valB != null && valB !== '' && valB !== '未填';
                    html += `<tr>
                        <td class="gs-cmp-lbl">${_esc(key)}</td>
                        <td class="gs-cmp-val${aNonEmpty ? ' gs-cmp-filled' : ''}">${aNonEmpty ? _fmtVal(valA) : '<span class="gs-cmp-empty">—</span>'}</td>
                        <td class="gs-cmp-val${bNonEmpty ? ' gs-cmp-filled' : ''}">${bNonEmpty ? _fmtVal(valB) : '<span class="gs-cmp-empty">—</span>'}</td>
                    </tr>`;
                }
            }
            html += `</tbody></table>
        </div>`;
        }

        // Section 3: Match History
        html += `
        <div class="gs-cmp-section">
            <h4 class="gs-cmp-section-title">Match History</h4>
            <div class="gs-cmp-team-grid">
                <div class="gs-cmp-match-col">
                    <div class="gs-cmp-match-hdr">Team ${numA}</div>
                    ${_buildMatchListHtml(matchesA)}
                </div>
                <div class="gs-cmp-match-col">
                    <div class="gs-cmp-match-hdr">Team ${numB}</div>
                    ${_buildMatchListHtml(matchesB)}
                </div>
            </div>
        </div>`;

        return html;
    }

    function _buildMatchListHtml(matches) {
        if (!matches.length) return '<p class="gs-cmp-empty">No qual matches</p>';
        return '<div class="gs-cmp-match-list">' + matches.map(m => {
            const cls = m.won ? 'gs-cmp-win' : (m.tied ? 'gs-cmp-tie' : 'gs-cmp-loss');
            const sideCls = m.side === 'red' ? 'gs-cmp-red' : 'gs-cmp-blue';
            const result = m.won ? 'W' : (m.tied ? 'T' : 'L');
            return `<div class="gs-cmp-match-row ${cls}">
                <span class="gs-cmp-match-label">${_esc(m.label)}</span>
                <span class="gs-cmp-match-side ${sideCls}">${m.side[0].toUpperCase()}</span>
                <span class="gs-cmp-match-score">${m.myScore}–${m.oppScore}</span>
                <span class="gs-cmp-match-result">${result}</span>
            </div>`;
        }).join('') + '</div>';
    }

    // ── Public API ─────────────────────────────────────────
    return {
        mount,
        unmount,
        refresh,
        _onEventSelect,
        _onMatchSelect,
        _onSaveStrategy,
        _onBsPillClick,
        _onBsMacro,
        _onBsSubmit,
        _onEditNote,
        _onCancelNoteEdit,
        _onSaveNoteEdit,
        _onSubTabClick,
        _onCompareTeamAChange,
        _onCompareTeamBChange,
        _onCompareBtn,
    };
})();
