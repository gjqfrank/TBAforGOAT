/* ═══════════════════════════════════════════════════════════
   battle_station.js — Live-match Battle Station UI

   A full-height split timeline for the active match:
   Red notes on the left, Blue on the right, system events
   rendered as centred badges on the spine.

   Timeline flows TOP → DOWN (newest at top, older pushed down).

   Depends on: app.js (pbpData, pbpIndex, currentEvent,
               pbpGoTo, pbpPrev, pbpNext),
               notes_service.js, realtime.js, auth.js
   ═══════════════════════════════════════════════════════════ */

const BattleStation = (() => {
    'use strict';

    // ── State ──────────────────────────────────────────────
    let _notes     = [];
    let _ctx       = 'match';  // 'match' | team_key string
    let _match     = null;
    let _eventKey  = null;
    let _matchKey  = null;
    let _mounted   = false;
    let _realtimeWired = false;
    let _matchStartTime = null;

    // ── Helpers ────────────────────────────────────────────
    function _teamPrefix() { return (typeof isFTCMode === 'function' && isFTCMode()) ? 'ftc' : 'frc'; }

    // ── Lexicon ────────────────────────────────────────────
    const LEXICON = {
        AUTO_START:   { label: 'Auto',       color: 'emerald', icon: _iconRobot },
        TELEOP_START: { label: 'Teleop',     color: 'sky',     icon: _iconGamepad },
        ENDGAME_START:{ label: 'Endgame',    color: 'amber',   icon: _iconFlag },
        MATCH_OVER:   { label: 'Match Over', color: 'slate',   icon: _iconStopwatch },
        FIELD_FAULT:  { label: 'Field Fault',color: 'red',     icon: _iconWarning },
    };

    // ── SVG icon factories (14×14 inline) ──────────────────
    function _iconRobot() {
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg>';
    }
    function _iconGamepad() {
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="15" y1="13" x2="15.01" y2="13"/><line x1="18" y1="11" x2="18.01" y2="11"/><rect x="2" y="6" width="20" height="12" rx="2"/></svg>';
    }
    function _iconFlag() {
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>';
    }
    function _iconStopwatch() {
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M10 2h4"/><path d="M12 2v3"/></svg>';
    }
    function _iconWarning() {
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
    }

    // ── Helpers ─────────────────────────────────────────────
    function _esc(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    function _formatMatchTime(isoString) {
        if (!isoString) return '';
        const ts = new Date(isoString).getTime();
        if (Number.isNaN(ts)) return '';
        if (!_matchStartTime) {
            const auto = _notes.find(n => n.type === 'system' && n.content === 'AUTO_START');
            _matchStartTime = auto ? auto.created_at
                            : (_notes.length ? _notes[_notes.length - 1].created_at : isoString);
        }
        const base = new Date(_matchStartTime).getTime();
        const diffSec = Math.round((ts - base) / 1000);
        const sign = diffSec < 0 ? '\u2212' : '+';
        const abs  = Math.abs(diffSec);
        const min  = Math.floor(abs / 60);
        const sec  = String(abs % 60).padStart(2, '0');
        return `T${sign}\u2009${min}:${sec}`;
    }

    function _getAuthor() {
        if (typeof Auth !== 'undefined' && Auth.getUser) {
            const u = Auth.getUser();
            if (u) return u.user_metadata?.name || u.email || 'Caster';
        }
        return 'Caster';
    }

    function _initials(name) {
        if (!name) return '?';
        const parts = name.trim().split(/[\s.@]+/).filter(Boolean);
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        return name.slice(0, 2).toUpperCase();
    }

    function _getTeamNums(alliance) {
        if (!alliance) return [];
        return alliance.teams
            ? alliance.teams.map(t => t.team_number)
            : (alliance.team_numbers || []);
    }

    function _noteSide(note) {
        if (note.type === 'system') return 'center';
        if (!note.team_key || !_match) return 'center';
        const num = parseInt(String(note.team_key).replace(/\D/g, ''), 10);
        const reds = _getTeamNums(_match.red);
        const blues = _getTeamNums(_match.blue);
        if (reds.includes(num)) return 'red';
        if (blues.includes(num)) return 'blue';
        return 'center';
    }

    // ── Lifecycle ──────────────────────────────────────────
    function _isAuthed() {
        return !window.isGuest;
    }

    function mount() {
        if (!_isAuthed()) return;
        if (_mounted) return;
        _mounted = true;
        _wireRealtime();
        refresh();
    }

    function unmount() { _mounted = false; }

    function refresh() {
        if (typeof pbpData === 'undefined' || !pbpData?.matches?.length) { _showEmpty(); return; }
        if (typeof pbpIndex === 'undefined') { _showEmpty(); return; }
        const m = pbpData.matches[pbpIndex];
        if (!m) { _showEmpty(); return; }

        const newKey = m.match_key || m.key || null;

        // If same match, just sync dropdown selection and reload notes
        if (_matchKey === newKey && _match) {
            const dd = document.getElementById('bs-match-dd');
            if (dd) dd.value = String(pbpIndex);
            _loadNotes();
            return;
        }

        _match    = m;
        _eventKey = (typeof currentEvent !== 'undefined') ? currentEvent : null;
        _matchKey = newKey;
        _ctx      = 'match';
        _matchStartTime = null;
        _render();
        _loadNotes();
    }

    function _showEmpty() {
        const root = document.getElementById('bs-root');
        if (root) { root.innerHTML = ''; root.style.display = 'none'; }
        const empty = document.getElementById('bs-empty');
        if (empty) { empty.classList.remove('hidden'); empty.style.display = ''; }
    }

    // ── Realtime ───────────────────────────────────────────
    function _wireRealtime() {
        if (_realtimeWired) return;
        _realtimeWired = true;
        if (typeof Realtime !== 'undefined' && Realtime.onNoteInsert) {
            Realtime.onNoteInsert((payload) => {
                if (!_mounted) return;
                const note = payload.new;
                if (!note) return;
                if (note.event_key !== _eventKey) return;
                if (note.match_key && note.match_key !== _matchKey) return;
                if (_notes.find(n => n.id === note.id)) return;
                _notes.push(note);
                _renderTimeline();
                _scrollToTop();
            });
        }
        // Catch-up after Wi-Fi drop: re-fetch notes we may have missed
        if (typeof Realtime !== 'undefined' && Realtime.onReconnect) {
            Realtime.onReconnect(() => {
                if (_mounted && _eventKey) {
                    console.info('[BattleStation] Reconnected — re-fetching notes');
                    _loadNotes();
                }
            });
        }
    }

    // ── Data loading ───────────────────────────────────────
    async function _loadNotes() {
        if (!_eventKey) return;
        try {
            _notes = await NotesService.fetchNotes(_eventKey, _matchKey, null);
            _notes.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
            _matchStartTime = null;
            _renderTimeline();
            _scrollToTop();
        } catch (e) {
            console.warn('[BattleStation] Failed to load notes:', e);
        }
    }

    function _scrollToTop() {
        requestAnimationFrame(() => {
            const tl = document.getElementById('bs-timeline');
            if (tl) tl.scrollTop = 0;
        });
    }

    // ═══════════════════════════════════════════════════════
    //  RENDER
    // ═══════════════════════════════════════════════════════
    function _render() {
        const empty = document.getElementById('bs-empty');
        if (empty) { empty.classList.add('hidden'); empty.style.display = 'none'; }
        const root = document.getElementById('bs-root');
        if (!root) return;
        root.style.display = '';

        const reds  = _getTeamNums(_match.red);
        const blues = _getTeamNums(_match.blue);

        // Build match dropdown options
        const matches = (typeof pbpData !== 'undefined' && pbpData?.matches) ? pbpData.matches : [];
        const options = matches.map((m, i) => {
            const raw = m.label || m.match_key || m.key || ('Match ' + (i + 1));
            const lbl = raw.replace(/^Qualification\s*/i, 'Qual ');
            return `<option value="${i}"${i === pbpIndex ? ' selected' : ''}>${_esc(lbl)}</option>`;
        }).join('');

        root.innerHTML = `
          <div class="bs-shell">

            <!-- ▸ TOP TIER: Match navigation ───────────────── -->
            <div class="bs-match-bar">
              <select class="bs-match-select" id="bs-match-dd"
                      onchange="BattleStation._onMatchSelect(this.value)">
                ${options}
              </select>
            </div>

            <!-- ▸ BOTTOM TIER: Context pills ───────────────── -->
            <div class="bs-hotrow">
              ${reds.map(n => `
                <button class="bs-pill-btn bs-pill-red${_ctx === _teamPrefix() + n ? ' bs-pill-active' : ''}"
                        data-team="${_teamPrefix()}${n}" onclick="BattleStation._onHotClick(this)">
                  ${n}
                </button>`).join('')}

              <button class="bs-pill-btn bs-pill-general${_ctx === 'match' ? ' bs-pill-active' : ''}"
                      data-team="match" onclick="BattleStation._onHotClick(this)">
                General
              </button>

              ${blues.map(n => `
                <button class="bs-pill-btn bs-pill-blue${_ctx === _teamPrefix() + n ? ' bs-pill-active' : ''}"
                        data-team="${_teamPrefix()}${n}" onclick="BattleStation._onHotClick(this)">
                  ${n}
                </button>`).join('')}
            </div>

            <!-- ▸ MIDDLE: Spine + Feed (newest at top) ─────── -->
            <div class="bs-feed" id="bs-timeline">
              <div class="bs-gradient-anchor" aria-hidden="true">
                <div class="bs-gradient-red"></div>
                <div class="bs-gradient-blue"></div>
              </div>
              <div class="bs-spine"></div>
              <div class="bs-feed-inner" id="bs-timeline-inner"></div>
            </div>

            <!-- ▸ BOTTOM: Macros (floating) + input dock ───── -->
            <div class="bs-dock-macros">
              ${Object.entries(LEXICON).map(([code, def]) => `
                <button class="bs-chip bs-chip-${def.color}"
                        onclick="BattleStation._onMacro('${code}')" title="${def.label}">
                  ${def.icon()}
                  <span>${_esc(def.label)}</span>
                </button>`).join('')}
            </div>
            <div class="bs-dock">
              <form class="bs-dock-form" onsubmit="BattleStation._onSubmit(event)">
                <input type="text" id="bs-input" class="bs-input"
                       placeholder="Add a note\u2026" autocomplete="off" />
                <button type="submit" class="bs-send-btn">Send</button>
              </form>
            </div>

          </div>`;

        _renderTimeline();
    }

    // ── Timeline rendering (newest-first) ──────────────────
    function _renderTimeline() {
        const inner = document.getElementById('bs-timeline-inner');
        if (!inner) return;

        if (!_notes.length) {
            inner.innerHTML = '<div class="bs-empty-feed"><span>No notes yet \u2014 use the macro deck or type below.</span></div>';
            return;
        }

        const visible = _notes.filter(n => {
            if (n.type === 'system') return true;
            return true;
        });

        const reversed = [...visible].reverse();
        inner.innerHTML = reversed.map((n, i) => {
            const isDimmed = _ctx !== 'match' && n.type !== 'system' && n.team_key !== _ctx;
            const html = _renderNote(n, i === 0 && !isDimmed);
            if (isDimmed) {
                return html.replace(/class="bs-row/, 'class="bs-row bs-note-dimmed');
            }
            return html;
        }).join('');
    }

    function _renderNote(note, isNewest) {
        const side = _noteSide(note);
        const tPlus = _formatMatchTime(note.created_at);
        const animClass = isNewest ? ' bs-anim-in' : '';

        if (note.type === 'system') {
            const def = LEXICON[note.content] || { label: note.content, color: 'slate', icon: _iconWarning };
            return `
              <div class="bs-row bs-row-center${animClass}">
                <div class="bs-sys-badge bs-sys-${def.color}">
                  ${def.icon()}
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

        // center / neutral — keep author name for general match notes
        return `
          <div class="bs-row bs-row-center${animClass}">
            <div class="bs-bubble bs-bubble-neutral">
              <span class="bs-bubble-author">${_esc(authorName)}</span>
              <p class="bs-bubble-body bs-bubble-body-center">${_esc(note.content)}</p>
              <span class="bs-bubble-time">${tPlus}</span>
            </div>
          </div>`;
    }

    // ── Event handlers ─────────────────────────────────────
    function _onHotClick(btn) {
        const team = btn.dataset.team;
        _ctx = team === 'match' ? 'match' : team;
        document.querySelectorAll('.bs-pill-btn').forEach(b => b.classList.remove('bs-pill-active'));
        btn.classList.add('bs-pill-active');
        _renderTimeline();
    }

    function _onMatchSelect(val) {
        const idx = parseInt(val, 10);
        if (!Number.isNaN(idx) && typeof pbpGoTo === 'function') pbpGoTo(idx);
    }

    async function _onMacro(code) {
        if (!_isAuthed() || !_eventKey) return;
        const optimistic = {
            id: 'opt-' + Date.now(),
            event_key: _eventKey,
            match_key: _matchKey,
            author: 'SYSTEM',
            content: code,
            type: 'system',
            created_at: new Date().toISOString(),
        };
        _notes.push(optimistic);
        _renderTimeline();
        _scrollToTop();
        try {
            const saved = await NotesService.insertNote({
                event_key: _eventKey,
                match_key: _matchKey,
                author: 'SYSTEM',
                content: code,
                type: 'system',
            });
            const optIdx = _notes.findIndex(n => n.id === optimistic.id);
            if (optIdx !== -1 && saved) _notes[optIdx] = saved;
        } catch (e) {
            console.error('[BattleStation] Macro inject failed:', e);
        }
    }

    async function _onSubmit(e) {
        e.preventDefault();
        if (!_isAuthed()) return;
        const input = document.getElementById('bs-input');
        if (!input) return;
        const text = input.value.trim();
        if (!text || !_eventKey) return;
        input.value = '';

        // Capture team before resetting to GENERAL
        const teamKey = (_ctx !== 'match') ? _ctx : null;

        // Reset to GENERAL after sending
        _ctx = 'match';
        document.querySelectorAll('.bs-pill-btn').forEach(b => b.classList.remove('bs-pill-active'));
        const generalBtn = document.querySelector('.bs-pill-general');
        if (generalBtn) generalBtn.classList.add('bs-pill-active');

        const author = _getAuthor();
        const optimistic = {
            id: 'opt-' + Date.now(),
            event_key: _eventKey,
            match_key: _matchKey,
            team_key: teamKey,
            author: author,
            content: text,
            type: 'manual',
            created_at: new Date().toISOString(),
        };
        _notes.push(optimistic);
        _renderTimeline();
        _scrollToTop();
        try {
            const saved = await NotesService.insertNote({
                event_key: _eventKey,
                match_key: _matchKey,
                team_key: teamKey,
                author: author,
                content: text,
                type: 'manual',
            });
            const optIdx = _notes.findIndex(n => n.id === optimistic.id);
            if (optIdx !== -1 && saved) _notes[optIdx] = saved;
        } catch (e2) {
            console.error('[BattleStation] Note submit failed:', e2);
            input.value = text;
        }
    }

    // ── Mobile submit (from nav bar input pill) ─────────
    async function _onMobileSubmit(e) {
        e.preventDefault();
        if (!_isAuthed()) return;
        const input = document.getElementById('mob-bs-input');
        if (!input) return;
        const text = input.value.trim();
        if (!text || !_eventKey) return;
        input.value = '';
        const teamKey = (_ctx !== 'match') ? _ctx : null;
        _ctx = 'match';
        document.querySelectorAll('.bs-pill-btn').forEach(b => b.classList.remove('bs-pill-active'));
        const generalBtn = document.querySelector('.bs-pill-general');
        if (generalBtn) generalBtn.classList.add('bs-pill-active');
        const author = _getAuthor();
        const optimistic = {
            id: 'opt-' + Date.now(),
            event_key: _eventKey,
            match_key: _matchKey,
            team_key: teamKey,
            author: author,
            content: text,
            type: 'manual',
            created_at: new Date().toISOString(),
        };
        _notes.push(optimistic);
        _renderTimeline();
        _scrollToTop();
        try {
            const saved = await NotesService.insertNote({
                event_key: _eventKey,
                match_key: _matchKey,
                team_key: teamKey,
                author: author,
                content: text,
                type: 'manual',
            });
            const optIdx = _notes.findIndex(n => n.id === optimistic.id);
            if (optIdx !== -1 && saved) _notes[optIdx] = saved;
        } catch (e2) {
            console.error('[BattleStation] Mobile submit failed:', e2);
            input.value = text;
        }
    }

    // ── Public API ─────────────────────────────────────────
    return {
        mount,
        unmount,
        refresh,
        _onHotClick,
        _onMatchSelect,
        _onMacro,
        _onSubmit,
        _onMobileSubmit,
    };
})();
