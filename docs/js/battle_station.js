/* ═══════════════════════════════════════════════════════════
   battle_station.js — Live-match Battle Station UI

   A full-height split timeline for the active match:
   Red notes on the left, Blue on the right, system events
   rendered as centred badges on the spine.

   Timeline flows TOP → DOWN (newest at top).

   Depends on: app.js (pbpData, pbpIndex, currentEvent,
               pbpPrev, pbpNext),
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
    let _matchStartTime = null;  // ISO string or null

    // ── Lexicon: system event definitions ──────────────────
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
    function _iconChevLeft() {
        return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
    }
    function _iconChevRight() {
        return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
    }

    // ── Helpers ─────────────────────────────────────────────
    function _esc(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    /** Format T+ / T- relative to the first system event (AUTO_START).
     *  Falls back to T+ 0:00 offset from the earliest note if no
     *  AUTO_START exists. Returns e.g. "T+ 1:23" or "T- 0:05". */
    function _formatMatchTime(isoString) {
        if (!isoString) return '';
        const ts = new Date(isoString).getTime();
        if (Number.isNaN(ts)) return '';

        // Determine baseline: first AUTO_START or earliest note in set
        if (!_matchStartTime) {
            const auto = _notes.find(n => n.type === 'system' && n.content === 'AUTO_START');
            _matchStartTime = auto ? auto.created_at
                            : (_notes.length ? _notes[_notes.length - 1].created_at : isoString);
        }
        const base = new Date(_matchStartTime).getTime();
        const diffSec = Math.round((ts - base) / 1000);
        const sign = diffSec < 0 ? '−' : '+';
        const abs  = Math.abs(diffSec);
        const min  = Math.floor(abs / 60);
        const sec  = String(abs % 60).padStart(2, '0');
        return `T${sign} ${min}:${sec}`;
    }

    function _getAuthor() {
        if (typeof Auth !== 'undefined' && Auth.getUser) {
            const u = Auth.getUser();
            if (u) return u.user_metadata?.name || u.email || 'Caster';
        }
        return 'Caster';
    }

    /** Return 1- or 2-char initials from a name/email string. */
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
    function mount() {
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

        _match    = m;
        _eventKey = (typeof currentEvent !== 'undefined') ? currentEvent : null;
        _matchKey = m.match_key || m.key || null;
        _ctx      = 'match';
        _matchStartTime = null;  // reset for new match
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
    }

    // ── Data loading ───────────────────────────────────────
    async function _loadNotes() {
        if (!_eventKey) return;
        try {
            _notes = await NotesService.fetchNotes(_eventKey, _matchKey, null);
            _notes.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
            _matchStartTime = null;  // recalculate from loaded notes
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
    //  RENDER — Clustered Action Bar + Top-Down Timeline
    // ═══════════════════════════════════════════════════════
    function _render() {
        const empty = document.getElementById('bs-empty');
        if (empty) { empty.classList.add('hidden'); empty.style.display = 'none'; }
        const root = document.getElementById('bs-root');
        if (!root) return;
        root.style.display = '';

        const label = _match.label || _match.match_key || 'Match';
        const reds  = _getTeamNums(_match.red);
        const blues = _getTeamNums(_match.blue);
        const hasPrev = (typeof pbpIndex !== 'undefined') && pbpIndex > 0;
        const hasNext = (typeof pbpIndex !== 'undefined' && typeof pbpData !== 'undefined')
                        && pbpIndex < pbpData.matches.length - 1;

        root.innerHTML = `
          <div class="bs-shell">

            <!-- ▸ TOP: Clustered Action Bar ────────────────── -->
            <div class="bs-hotrow">
              ${reds.map(n => `
                <button class="bs-team-btn bs-team-red${_ctx === 'frc' + n ? ' bs-team-active' : ''}"
                        data-team="frc${n}" onclick="BattleStation._onHotClick(this)">
                  ${n}
                </button>`).join('')}

              <div class="bs-match-switcher">
                <button class="bs-nav-btn${hasPrev ? '' : ' bs-nav-disabled'}"
                        onclick="BattleStation._onMatchPrev()" title="Previous match">
                  ${_iconChevLeft()}
                </button>
                <button class="bs-match-label${_ctx === 'match' ? ' bs-match-label-active' : ''}"
                        data-team="match" onclick="BattleStation._onHotClick(this)">
                  ${_esc(label)}
                </button>
                <button class="bs-nav-btn${hasNext ? '' : ' bs-nav-disabled'}"
                        onclick="BattleStation._onMatchNext()" title="Next match">
                  ${_iconChevRight()}
                </button>
              </div>

              ${blues.map(n => `
                <button class="bs-team-btn bs-team-blue${_ctx === 'frc' + n ? ' bs-team-active' : ''}"
                        data-team="frc${n}" onclick="BattleStation._onHotClick(this)">
                  ${n}
                </button>`).join('')}
            </div>

            <!-- ▸ MIDDLE: Spine + Feed (top-down: newest first) ──── -->
            <div class="bs-feed" id="bs-timeline">
              <div class="bs-spine"></div>
              <div class="bs-feed-inner" id="bs-timeline-inner"></div>
            </div>

            <!-- ▸ BOTTOM: Pinned macro deck + input ────────── -->
            <div class="bs-dock">
              <div class="bs-dock-macros">
                ${Object.entries(LEXICON).map(([code, def]) => `
                  <button class="bs-macro bs-macro-${def.color}"
                          onclick="BattleStation._onMacro('${code}')" title="${def.label}">
                    ${def.icon()}
                    <span>${_esc(def.label)}</span>
                  </button>`).join('')}
              </div>
              <form class="bs-dock-form" onsubmit="BattleStation._onSubmit(event)">
                <input type="text" id="bs-input" class="bs-input"
                       placeholder="Add a note…" autocomplete="off" />
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
            inner.innerHTML = '<div class="bs-empty-feed"><span>No notes yet — use the macro deck or type below.</span></div>';
            return;
        }

        const visible = _notes.filter(n => {
            if (n.type === 'system') return true;
            if (_ctx === 'match') return true;
            return n.team_key === _ctx;
        });

        // Newest first — reverse a copy so _notes stays chronological
        const reversed = [...visible].reverse();
        inner.innerHTML = reversed.map((n, i) => _renderNote(n, i === 0)).join('');
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
        const avatar = `<div class="bs-avatar bs-avatar-${side === 'blue' ? 'blue' : (side === 'red' ? 'red' : 'neutral')}">${_esc(_initials(authorName))}</div>`;

        if (side === 'red') {
            return `
              <div class="bs-row${animClass}">
                <div class="bs-col bs-col-left">
                  <div class="bs-bubble bs-bubble-red">
                    <div class="bs-bubble-head">
                      <span class="bs-bubble-team bs-bubble-team-red">${teamNum}</span>
                      <span class="bs-bubble-meta">${_esc(authorName)} · ${tPlus}</span>
                    </div>
                    <p class="bs-bubble-body">${_esc(note.content)}</p>
                  </div>
                  ${avatar}
                </div>
                <div class="bs-col bs-col-right"></div>
              </div>`;
        }

        if (side === 'blue') {
            return `
              <div class="bs-row${animClass}">
                <div class="bs-col bs-col-left"></div>
                <div class="bs-col bs-col-right">
                  ${avatar}
                  <div class="bs-bubble bs-bubble-blue">
                    <div class="bs-bubble-head">
                      <span class="bs-bubble-team bs-bubble-team-blue">${teamNum}</span>
                      <span class="bs-bubble-meta">${_esc(authorName)} · ${tPlus}</span>
                    </div>
                    <p class="bs-bubble-body">${_esc(note.content)}</p>
                  </div>
                </div>
              </div>`;
        }

        // center / neutral
        return `
          <div class="bs-row bs-row-center${animClass}">
            <div class="bs-bubble bs-bubble-neutral">
              <div class="bs-bubble-head bs-bubble-head-center">
                <span class="bs-bubble-meta">${_esc(authorName)} · ${tPlus}</span>
              </div>
              <p class="bs-bubble-body bs-bubble-body-center">${_esc(note.content)}</p>
            </div>
          </div>`;
    }

    // ── Event handlers ─────────────────────────────────────
    function _onHotClick(btn) {
        const team = btn.dataset.team;
        _ctx = team === 'match' ? 'match' : team;
        // Update active states
        document.querySelectorAll('.bs-team-btn').forEach(b => b.classList.remove('bs-team-active'));
        document.querySelector('.bs-match-label')?.classList.remove('bs-match-label-active');
        if (team === 'match') {
            document.querySelector('.bs-match-label')?.classList.add('bs-match-label-active');
        } else {
            btn.classList.add('bs-team-active');
        }
        _renderTimeline();
    }

    function _onMatchPrev() {
        if (typeof pbpPrev === 'function') pbpPrev();
    }

    function _onMatchNext() {
        if (typeof pbpNext === 'function') pbpNext();
    }

    async function _onMacro(code) {
        if (!_eventKey) return;
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
            await NotesService.insertNote({
                event_key: _eventKey,
                match_key: _matchKey,
                author: 'SYSTEM',
                content: code,
                type: 'system',
            });
        } catch (e) {
            console.error('[BattleStation] Macro inject failed:', e);
        }
    }

    async function _onSubmit(e) {
        e.preventDefault();
        const input = document.getElementById('bs-input');
        if (!input) return;
        const text = input.value.trim();
        if (!text || !_eventKey) return;
        input.value = '';
        const teamKey = (_ctx !== 'match') ? _ctx : null;
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
            await NotesService.insertNote({
                event_key: _eventKey,
                match_key: _matchKey,
                team_key: teamKey,
                author: author,
                content: text,
                type: 'manual',
            });
        } catch (e2) {
            console.error('[BattleStation] Note submit failed:', e2);
            input.value = text;
        }
    }

    // ── Public API ─────────────────────────────────────────
    return {
        mount,
        unmount,
        refresh,
        _onHotClick,
        _onMacro,
        _onSubmit,
        _onMatchPrev,
        _onMatchNext,
    };
})();
