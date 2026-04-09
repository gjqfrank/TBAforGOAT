/* ═══════════════════════════════════════════════════════════
   battle_station.js — Live-match Battle Station UI

   A full-height split timeline for the active match:
   Red notes on the left, Blue on the right, system events
   rendered as centred badges on the spine.

   Depends on: app.js (pbpData, pbpIndex, currentEvent),
               notes_service.js, realtime.js, auth.js
   ═══════════════════════════════════════════════════════════ */

const BattleStation = (() => {
    'use strict';

    // ── State ──────────────────────────────────────────────
    let _notes     = [];       // all notes for the active match
    let _ctx       = 'match';  // 'match' | team_key string (e.g. 'frc254')
    let _match     = null;     // current match object
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

    // ── SVG icon factories (Lucide-style 16×16) ───────────
    function _iconRobot() {
        return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg>`;
    }
    function _iconGamepad() {
        return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="15" y1="13" x2="15.01" y2="13"/><line x1="18" y1="11" x2="18.01" y2="11"/><rect x="2" y="6" width="20" height="12" rx="2"/></svg>`;
    }
    function _iconFlag() {
        return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`;
    }
    function _iconStopwatch() {
        return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M10 2h4"/><path d="M12 2v3"/></svg>`;
    }
    function _iconWarning() {
        return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
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

    // ── Determine which "side" a note belongs to ───────────
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

    // ── Mount / Unmount lifecycle ──────────────────────────
    function mount() {
        if (_mounted) return;
        _mounted = true;
        _wireRealtime();
        refresh();
    }

    function unmount() {
        _mounted = false;
    }

    function refresh() {
        // Sync with global PbP state
        if (typeof pbpData === 'undefined' || !pbpData?.matches?.length) {
            _showEmpty(); return;
        }
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

    // ── Realtime wiring (once) ─────────────────────────────
    function _wireRealtime() {
        if (_realtimeWired) return;
        _realtimeWired = true;
        if (typeof Realtime !== 'undefined' && Realtime.onNoteInsert) {
            Realtime.onNoteInsert((payload) => {
                if (!_mounted) return;
                const note = payload.new;
                if (!note) return;
                // Only accept notes for our event
                if (note.event_key !== _eventKey) return;
                // If match-scoped and doesn't match, skip
                if (note.match_key && note.match_key !== _matchKey) return;
                // Dedupe
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

    // ── Rendering ──────────────────────────────────────────
    function _render() {
        const empty = document.getElementById('bs-empty');
        if (empty) { empty.classList.add('hidden'); empty.style.display = 'none'; }

        const root = document.getElementById('bs-root');
        if (!root) return;
        root.style.display = '';

        const label = _match.label || _match.match_key || 'Match';
        const reds  = _getTeamNums(_match.red);
        const blues = _getTeamNums(_match.blue);

        root.innerHTML = /* html */`
            <!-- ▸ SKELETON: flex-col, fills parent, no scroll on outer shell -->
            <div class="bs-shell">

                <!-- ▸ TOP: Hot-Row — shrink-0, never scrolls -->
                <div class="bs-hotrow" id="bs-hotrow">
                    <div class="bs-hotrow-inner">
                        ${reds.map((n, i) => `<button class="bs-hot-btn bs-hot-red${_ctx === 'frc' + n ? ' bs-hot-active' : ''}" data-team="frc${n}" onclick="BattleStation._onHotClick(this)" title="Red ${i + 1}"><span class="font-mono text-xs text-red-400">${n}</span></button>`).join('')}
                        <button class="bs-hot-btn bs-hot-match${_ctx === 'match' ? ' bs-hot-active' : ''}" data-team="match" onclick="BattleStation._onHotClick(this)" title="Full Match">
                            <span class="font-mono text-[10px] font-bold text-slate-300 tracking-wider">${_esc(label)}</span>
                        </button>
                        ${blues.map((n, i) => `<button class="bs-hot-btn bs-hot-blue${_ctx === 'frc' + n ? ' bs-hot-active' : ''}" data-team="frc${n}" onclick="BattleStation._onHotClick(this)" title="Blue ${i + 1}"><span class="font-mono text-xs text-blue-400">${n}</span></button>`).join('')}
                    </div>
                    <span class="text-[10px] text-slate-600 font-mono" id="bs-note-count">${_notes.length} notes</span>
                </div>

                <!-- ▸ MIDDLE: Spine + Feed — flex-1 overflow-y-auto -->
                <div class="bs-feed" id="bs-timeline">
                    <!-- The literal vertical center spine — always visible -->
                    <div class="bs-spine"></div>
                    <!-- Notes land here -->
                    <div class="bs-feed-inner" id="bs-timeline-inner"></div>
                </div>

                <!-- ▸ BOTTOM: Pinned input bar — shrink-0, glassmorphism -->
                <div class="bs-dock" id="bs-footer">
                    <div class="bs-dock-macros" id="bs-macros">
                        ${Object.entries(LEXICON).map(([code, def]) => `
                            <button class="bs-macro-btn bs-macro-${def.color}" onclick="BattleStation._onMacro('${code}')" title="${def.label}">
                                ${def.icon()}
                                <span class="text-[10px] font-semibold leading-none">${_esc(def.label)}</span>
                            </button>
                        `).join('')}
                    </div>
                    <form class="bs-dock-input" onsubmit="BattleStation._onSubmit(event)">
                        <input type="text" id="bs-input"
                               class="bs-input"
                               placeholder="Add a note…" autocomplete="off" />
                        <button type="submit" class="bs-send-btn">Send</button>
                    </form>
                </div>
            </div>
        `;

        _renderTimeline();
    }

    // ── Timeline note rendering ────────────────────────────
    function _renderTimeline() {
        const inner = document.getElementById('bs-timeline-inner');
        if (!inner) return;

        // Update note count badge
        const badge = document.getElementById('bs-note-count');
        if (badge) badge.textContent = `${_notes.length} note${_notes.length !== 1 ? 's' : ''}`;

        if (!_notes.length) {
            inner.innerHTML = `<div class="flex-1 flex items-center justify-center"><span class="text-xs text-slate-600 italic">No notes yet — use the macro deck or type below.</span></div>`;
            return;
        }

        // Filter by context
        const visible = _notes.filter(n => {
            if (n.type === 'system') return true;  // always show system events
            if (_ctx === 'match') return true;      // show all in match mode
            return n.team_key === _ctx;             // team filter
        });

        inner.innerHTML = visible.map(n => _renderNote(n)).join('');
    }

    function _renderNote(note) {
        const side = _noteSide(note);
        const time = _ts(note.created_at);

        // ── System badge (centred on spine) ──
        if (note.type === 'system') {
            const def = LEXICON[note.content] || { label: note.content, color: 'slate', icon: _iconWarning };
            return `
                <div class="bs-row bs-row-center">
                    <div class="bs-col-left"></div>
                    <div class="bs-sys-badge bs-sys-${def.color}">
                        ${def.icon()}
                        <span class="text-[10px] font-bold uppercase tracking-wider leading-none">${_esc(def.label)}</span>
                        <span class="text-[9px] opacity-60 font-mono">${time}</span>
                    </div>
                    <div class="bs-col-right"></div>
                </div>`;
        }

        // ── Manual note (red left / blue right / center fallback) ──
        const teamNum = note.team_key ? note.team_key.replace(/\D/g, '') : '';
        const meta = `<span class="text-[10px] text-slate-500">${_esc(note.author)} · ${time}</span>`;

        if (side === 'red') {
            return `
                <div class="bs-row">
                    <div class="bs-col-left">
                        <div class="bs-note bs-note-red">
                            <div class="flex items-baseline gap-2 justify-end">
                                ${meta}
                                <span class="font-mono text-[11px] font-bold text-red-400">${teamNum}</span>
                            </div>
                            <p class="text-xs text-slate-300 leading-snug text-right">${_esc(note.content)}</p>
                        </div>
                    </div>
                    <div class="bs-col-right"></div>
                </div>`;
        }

        if (side === 'blue') {
            return `
                <div class="bs-row">
                    <div class="bs-col-left"></div>
                    <div class="bs-col-right">
                        <div class="bs-note bs-note-blue">
                            <div class="flex items-baseline gap-2">
                                <span class="font-mono text-[11px] font-bold text-blue-400">${teamNum}</span>
                                ${meta}
                            </div>
                            <p class="text-xs text-slate-300 leading-snug">${_esc(note.content)}</p>
                        </div>
                    </div>
                </div>`;
        }

        // Center / unassigned — spans both columns
        return `
            <div class="bs-row bs-row-center">
                <div class="bs-col-left"></div>
                <div class="bs-note bs-note-neutral" style="position:relative;z-index:1;">
                    <div class="flex items-baseline gap-2 justify-center">
                        ${meta}
                    </div>
                    <p class="text-xs text-slate-300 leading-snug text-center">${_esc(note.content)}</p>
                </div>
                <div class="bs-col-right"></div>
            </div>`;
    }

    // ── Event handlers ─────────────────────────────────────
    function _onHotClick(btn) {
        const team = btn.dataset.team;
        _ctx = team === 'match' ? 'match' : team;

        // Update active state visually
        document.querySelectorAll('.bs-hot-btn').forEach(b => b.classList.remove('bs-hot-active'));
        btn.classList.add('bs-hot-active');

        _renderTimeline();
    }

    async function _onMacro(code) {
        if (!_eventKey) return;
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

        // Determine team_key from context
        const teamKey = (_ctx !== 'match') ? _ctx : null;

        try {
            await NotesService.insertNote({
                event_key: _eventKey,
                match_key: _matchKey,
                team_key: teamKey,
                author: _getAuthor(),
                content: text,
                type: 'manual',
            });
        } catch (e2) {
            console.error('[BattleStation] Note submit failed:', e2);
            input.value = text; // restore on failure
        }
    }

    // ── Public API ─────────────────────────────────────────
    return {
        mount,
        unmount,
        refresh,
        // Exposed for inline onclick handlers
        _onHotClick: _onHotClick,
        _onMacro: _onMacro,
        _onSubmit: _onSubmit,
    };
})();
