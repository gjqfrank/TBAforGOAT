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
    let _allGoatScoutData = [];

    // BattleStation state
    let _bsCtx = 'match';      // 'match' | 'frcXXXX'
    let _bsNotes = [];
    let _bsMatchStartTime = null;

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

            <div class="gs-main-row">
              <div class="gs-panel gs-pbp-panel">
                <h3 class="gs-panel-title">Play by Play</h3>
                <div id="gs-pbp-card" class="gs-pbp-card"></div>
              </div>
              <div class="gs-panel gs-bd-panel">
                <h3 class="gs-panel-title">Score Breakdown</h3>
                <div id="gs-bd-content" class="gs-bd-content"></div>
              </div>
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
        _allGoatScoutData = [];
        _matches6907 = [];
        _matchIndex = 0;
        _bsNotes = [];
        _bsCtx = 'match';

        const msel = _$('gs-match-sel');
        if (msel) msel.innerHTML = '<option value="">Loading matches…</option>';
        const bd = _$('gs-bd-content');
        if (bd) bd.innerHTML = '<p class="gs-loading">Loading…</p>';
        const pbp = _$('gs-pbp-card');
        if (pbp) pbp.innerHTML = '';
        const comp = _$('gs-comparison');
        if (comp) comp.innerHTML = '';
        const bsRoot = _$('gs-bs-root');
        if (bsRoot) bsRoot.innerHTML = '';

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

        _renderPbpPanel(m);
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
    // PBP — Full team cards (reuses .pbp-* CSS classes)
    // ═══════════════════════════════════════════════════════

    function _renderPbpPanel(m) {
        const el = _$('gs-pbp-card');
        if (!el) return;

        const redWon = m.winning_alliance === 'red';
        const blueWon = m.winning_alliance === 'blue';
        const upcoming = m.red?.score < 0 && m.blue?.score < 0;
        const redScore = upcoming ? '–' : (m.red?.score != null ? m.red.score : '–');
        const blueScore = upcoming ? '–' : (m.blue?.score != null ? m.blue.score : '–');
        const redTitle = m.red?.alliance_number ? `Alliance #${m.red.alliance_number}` : 'Red Alliance';
        const blueTitle = m.blue?.alliance_number ? `Alliance #${m.blue.alliance_number}` : 'Blue Alliance';

        const redCards = (m.red?.teams?.length)
            ? m.red.teams.map(t => _renderTeamCard(t, 'red-side')).join('')
            : `<div class="pbp-alliance-placeholder red-side">${redTitle} — Teams TBD</div>`;
        const blueCards = (m.blue?.teams?.length)
            ? m.blue.teams.map(t => _renderTeamCard(t, 'blue-side')).join('')
            : `<div class="pbp-alliance-placeholder blue-side">${blueTitle} — Teams TBD</div>`;

        el.innerHTML = `
          <div class="pbp-arena gs-pbp-arena">
            <div class="pbp-alliance red-side${redWon ? ' pbp-alliance-won' : ''}">
              <div class="pbp-alliance-header">
                <span class="pbp-alliance-title">${_esc(redTitle)}</span>
                <div class="pbp-score-group">
                  ${redWon ? '<span class="pbp-winner-label">WINNER</span>' : ''}
                  <span class="pbp-alliance-score">${redScore}</span>
                </div>
              </div>
              <div class="pbp-team-cards">${redCards}</div>
            </div>
            <div class="pbp-alliance blue-side${blueWon ? ' pbp-alliance-won' : ''}">
              <div class="pbp-alliance-header">
                <div class="pbp-score-group">
                  <span class="pbp-alliance-score">${blueScore}</span>
                  ${blueWon ? '<span class="pbp-winner-label">WINNER</span>' : ''}
                </div>
                <span class="pbp-alliance-title">${_esc(blueTitle)}</span>
              </div>
              <div class="pbp-team-cards">${blueCards}</div>
            </div>
          </div>`;
    }

    function _renderTeamCard(t, sideCls) {
        if (!t) return '';
        const is6907 = t.team_number === TEAM_NUM;
        const highlightCls = is6907 ? ' gs-team-highlight' : '';
        const loc = [t.city, t.state_prov, t.country].filter(Boolean).join(', ');
        const shortLoc = [t.state_prov, t.country].filter(Boolean).join(', ');

        const opr = t.opr != null ? (typeof t.opr === 'number' ? t.opr.toFixed(1) : t.opr) : '–';
        const epa = t.epa != null ? (typeof t.epa === 'number' ? t.epa.toFixed(1) : t.epa) : '–';
        const rank = t.rank ?? '–';
        const wlt = `${t.wins ?? 0}-${t.losses ?? 0}-${t.ties ?? 0}`;
        const avgRp = t.avg_rp != null ? (typeof t.avg_rp === 'number' ? t.avg_rp.toFixed(2) : t.avg_rp) : '–';
        const rankCls = Number(t.rank) >= 1 && Number(t.rank) <= 8 ? ' rank-top8' : '';

        return `
        <div class="pbp-team ${sideCls}${highlightCls}" data-team="${t.team_number}">
            <div class="pbp-team-top">
                <div class="pbp-team-number" data-team-number="${t.team_number}">${t.team_number}${is6907 ? '<span class="gs-6907-badge">6907</span>' : ''}</div>
                <div class="pbp-team-identity">
                    <div class="pbp-team-name-row">
                        <div class="pbp-team-nickname">${_esc(t.nickname || 'Team ' + t.team_number)}</div>
                    </div>
                    ${t.school_name ? `<div class="pbp-team-school">${_esc(t.school_name)}</div>` : ''}
                    ${loc ? `<div class="pbp-team-location pbp-loc-full">${_esc(loc)}</div>` : ''}
                    ${shortLoc ? `<div class="pbp-team-location pbp-loc-short">${_esc(shortLoc)}</div>` : ''}
                </div>
            </div>
            <div class="pbp-team-stats">
                <div class="pbp-stat">
                    <div class="pbp-stat-label">Rank</div>
                    <div class="pbp-stat-value${rankCls}">${rank}</div>
                </div>
                <div class="pbp-stat">
                    <div class="pbp-stat-label">W-L-T</div>
                    <div class="pbp-stat-value">${wlt}</div>
                </div>
                <div class="pbp-stat">
                    <div class="pbp-stat-label">OPR</div>
                    <div class="pbp-stat-value opr-val">${opr}</div>
                </div>
                <div class="pbp-stat">
                    <div class="pbp-stat-label">EPA</div>
                    <div class="pbp-stat-value epa-val">${epa}</div>
                </div>
                <div class="pbp-stat">
                    <div class="pbp-stat-label">Avg RP</div>
                    <div class="pbp-stat-value">${avgRp}</div>
                </div>
            </div>
        </div>`;
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

    // ── Comparison view ────────────────────────────────────

    function _renderComparison(m) {
        const el = _$('gs-comparison');
        if (!el) return;
        const matchKey = m.key || m.match_key;
        const strat = _strategyNotes[matchKey] || { auto: '', teleop: '', endgame: '' };
        const notes = _casterNotes[matchKey] || [];
        const bd = _breakdownCache[matchKey];

        const planHtml = _renderPlanColumn(strat);
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
        } else {
            el.innerHTML = '<p class="gs-empty">GoatScout renderer unavailable.</p>';
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
        _onBsPillClick,
        _onBsMacro,
        _onBsSubmit,
    };
})();
