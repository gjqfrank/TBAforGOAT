/* ═══════════════════════════════════════════════════════════
   battle_station.js — Live-match Battle Station UI

   A full-height split timeline for the active match:
   Red notes on the left, Blue on the right, system events
   rendered as centred badges on the spine.

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
        return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
    }
    function _iconChevRight() {
        return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
    }

    // ── Helpers ─────────────────────────────────────────────
    function _esc(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    function _ts(iso) {
        try {
            const d = new Date(iso);
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        } catch { return ''; }
    }

    function _getAuthor() {
        if (typeof Auth !== 'undefined' && Auth.getUser) {
            const u = Auth.getUser();
            if (u) return u.user_metadata?.name || u.email || 'Caster';
        }
        return 'Caster';
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
                _scrollToBottom();
            });
        }
    }

    // ── Data loading ───────────────────────────────────────
    async function _loadNotes() {
        if (!_eventKey) return;
        try {
            _notes = await NotesService.fetchNotes(_eventKey, _matchKey, null);
            _notes.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
            _renderTimeline();
            _scrollToBottom();
        } catch (e) {
            console.warn('[BattleStation] Failed to load notes:', e);
        }
    }

    function _scrollToBottom() {
        requestAnimationFrame(() => {
            const tl = document.getElementById('bs-timeline');
            if (tl) tl.scrollTop = tl.scrollHeight;
        });
    }

    // ═══════════════════════════════════════════════════════
    //  RENDER — Glassmorphic Panel Layout
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

            <!-- ▸ TOP: Glassmorphic Hot-Row ────────────────── -->
            <div class="bs-hotrow">
              <!-- Red team buttons -->
              <div class="bs-hotrow-side">
                ${reds.map((n, i) => `
                  <button class="bs-team-btn bs-team-red${_ctx === 'frc' + n ? ' bs-team-active' : ''}"
                          data-team="frc${n}" onclick="BattleStation._onHotClick(this)">
                    ${n}
                  </button>`).join('')}
              </div>

              <!-- Center: match switcher [ < ] [ QUAL 1 ] [ > ] -->
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

              <!-- Blue team buttons -->
              <div class="bs-hotrow-side">
                ${blues.map((n, i) => `
                  <button class="bs-team-btn bs-team-blue${_ctx === 'frc' + n ? ' bs-team-active' : ''}"
                          data-team="frc${n}" onclick="BattleStation._onHotClick(this)">
                    ${n}
                  </button>`).join('')}
              </div>
            </div>

            <!-- ▸ MIDDLE: Spine + Feed ─────────────────────── -->
            <div class="bs-feed" id="bs-timeline">
              <div class="bs-spine"></div>
              <div class="bs-feed-inner" id="bs-timeline-inner"></div>
            </div>

            <!-- ▸ BOTTOM: Pinned glassy input dock ─────────── -->
            <div class="bs-dock">
              <div class="bs-dock-macros">
                ${Object.entries(LEXICON).map(([code, def]) => `
                  <button class="bs-pill bs-pill-${def.color}"
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

    // ── Timeline rendering ─────────────────────────────────
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

        inner.innerHTML = visible.map(n => _renderNote(n)).join('');
    }

    function _renderNote(note) {
        const side = _noteSide(note);
        const time = _ts(note.created_at);

        if (note.type === 'system') {
            const def = LEXICON[note.content] || { label: note.content, color: 'slate', icon: _iconWarning };
            return `
              <div class="bs-row bs-row-center">
                <div class="bs-sys-badge bs-sys-${def.color}">
                  ${def.icon()}
                  <span class="bs-sys-label">${_esc(def.label)}</span>
                  <span class="bs-sys-time">${time}</span>
                </div>
              </div>`;
        }

        const teamNum = note.team_key ? note.team_key.replace(/\D/g, '') : '';
        const meta = `<span class="bs-note-meta">${_esc(note.author)} · ${time}</span>`;

        if (side === 'red') {
            return `
              <div class="bs-row">
                <div class="bs-col bs-col-left">
                  <div class="bs-note bs-note-red">
                    <div class="bs-note-head bs-note-head-right">
                      ${meta}
                      <span class="bs-note-team bs-note-team-red">${teamNum}</span>
                    </div>
                    <p class="bs-note-body bs-note-body-right">${_esc(note.content)}</p>
                  </div>
                </div>
                <div class="bs-col bs-col-right"></div>
              </div>`;
        }

        if (side === 'blue') {
            return `
              <div class="bs-row">
                <div class="bs-col bs-col-left"></div>
                <div class="bs-col bs-col-right">
                  <div class="bs-note bs-note-blue">
                    <div class="bs-note-head">
                      <span class="bs-note-team bs-note-team-blue">${teamNum}</span>
                      ${meta}
                    </div>
                    <p class="bs-note-body">${_esc(note.content)}</p>
                  </div>
                </div>
              </div>`;
        }

        return `
          <div class="bs-row bs-row-center">
            <div class="bs-note bs-note-neutral">
              <div class="bs-note-head bs-note-head-center">${meta}</div>
              <p class="bs-note-body bs-note-body-center">${_esc(note.content)}</p>
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
        // Optimistic local insert
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
        _scrollToBottom();
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
        // Optimistic local insert
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
        _scrollToBottom();
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
