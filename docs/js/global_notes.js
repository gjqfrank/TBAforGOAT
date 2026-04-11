/* ═══════════════════════════════════════════════════════════
   global_notes.js — Floating Notes Panel

   A draggable, floating glassmorphic window (like the lookup
   panel) with three tabs (Team / Match / Event).  Does NOT
   dim the page — just floats above the content.

   Depends on: notes_service.js, app.js (pbpData, pbpIndex,
               currentEvent, teamsData), battle_station.js
   ═══════════════════════════════════════════════════════════ */

const GlobalNotes = (() => {
    'use strict';

    // ── State ──────────────────────────────────────────────
    let _open        = false;
    let _tab         = 'team';          // 'team' | 'match' | 'event'
    let _teamFilter  = null;            // e.g. 'frc254'
    let _matchFilter = null;            // e.g. '2025arc_qm12'
    let _notes       = [];
    let _loading     = false;
    let _teamQuery   = '';              // live search input text
    let _matchQuery  = '';              // live search for matches
    let _teamListOpen  = false;         // whether dropdown is showing
    let _matchListOpen = false;         // whether match dropdown is showing
    let _teamSubFilter = 'all';         // 'all' | 'match' | 'general'

    // ── System macro lexicon (mirrors battle_station.js) ───
    const LEXICON = {
        AUTO_START:    { label: 'Auto' },
        TELEOP_START:  { label: 'Teleop' },
        ENDGAME_START: { label: 'Endgame' },
        MATCH_OVER:    { label: 'Match Over' },
        FIELD_FAULT:   { label: 'Field Fault' },
    };

    function _sysLabel(content) {
        const def = LEXICON[content];
        return def ? def.label : content;
    }

    // ── Helpers ────────────────────────────────────────────
    function _esc(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    function _eventKey() {
        return (typeof currentEvent !== 'undefined' && currentEvent)
            ? currentEvent : null;
    }

    function _matchKey() {
        if (typeof pbpData === 'undefined' || !pbpData?.matches?.length) return null;
        if (typeof pbpIndex === 'undefined') return null;
        const m = pbpData.matches[pbpIndex];
        return m ? (m.match_key || m.key || null) : null;
    }

    function _matches() {
        return (typeof pbpData !== 'undefined' && pbpData?.matches) ? pbpData.matches : [];
    }

    function _searchTeams(query) {
        const all = (typeof teamsData !== 'undefined' && Array.isArray(teamsData)) ? teamsData : [];
        if (!query) return all.slice(0, 30);
        const q = query.toLowerCase().trim();
        return all.filter(t => {
            const num = String(t.team_number || '');
            const name = (t.nickname || '').toLowerCase();
            return num.includes(q) || name.includes(q);
        }).slice(0, 30);
    }

    function _searchMatches(query) {
        const all = _matches();
        if (!query) return all;
        const q = query.toLowerCase().trim();
        return all.filter(m => {
            const key = (m.match_key || m.key || '').toLowerCase();
            const label = (m.label || '').toLowerCase();
            const ml = _matchLabelFull(m.match_key || m.key || '').toLowerCase();
            return key.includes(q) || label.includes(q) || ml.includes(q);
        });
    }

    function _timeAgo(iso) {
        if (!iso) return '';
        const now = new Date();
        const ts  = new Date(iso);
        const diff = Math.round((now.getTime() - ts.getTime()) / 1000);
        // Same calendar day → relative time
        if (ts.toDateString() === now.toDateString()) {
            if (diff < 60)   return 'just now';
            if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
            return Math.floor(diff / 3600) + 'h ago';
        }
        // Older → "Day N" based on event's first note
        const dayNum = _eventDay(ts);
        return dayNum ? 'Day ' + dayNum : ts.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    function _eventDay(ts) {
        if (!_notes.length) return 0;
        // Find earliest note date
        let earliest = ts;
        for (const n of _notes) {
            if (!n.created_at) continue;
            const d = new Date(n.created_at);
            if (d < earliest) earliest = d;
        }
        // Day 1 = first day, compute offset
        const start = new Date(earliest.getFullYear(), earliest.getMonth(), earliest.getDate());
        const target = new Date(ts.getFullYear(), ts.getMonth(), ts.getDate());
        return Math.floor((target - start) / 86400000) + 1;
    }

    function _matchLabel(matchKey) {
        if (!matchKey) return '';
        const parts = matchKey.split('_');
        const code = parts[parts.length - 1] || matchKey;
        const qm = code.match(/^qm(\d+)$/i);
        if (qm) return 'Qual ' + qm[1];
        const sf = code.match(/^sf(\d+)m(\d+)$/i);
        if (sf) return 'SF' + sf[1] + (sf[2] !== '1' ? '-' + sf[2] : '');
        const f = code.match(/^f(\d+)m(\d+)$/i);
        if (f) return 'F' + f[1] + (f[2] !== '1' ? '-' + f[2] : '');
        return code.toUpperCase();
    }

    function _matchLabelFull(matchKey) {
        if (!matchKey) return '';
        const parts = matchKey.split('_');
        const code = parts[parts.length - 1] || matchKey;
        const qm = code.match(/^qm(\d+)$/i);
        if (qm) return 'Qual ' + qm[1];
        const sf = code.match(/^sf(\d+)m(\d+)$/i);
        if (sf) return 'SF ' + sf[1] + (sf[2] !== '1' ? ' Match ' + sf[2] : '');
        const f = code.match(/^f(\d+)m(\d+)$/i);
        if (f) return 'Final ' + f[1] + (f[2] !== '1' ? ' Match ' + f[2] : '');
        return code.toUpperCase();
    }

    function _teamName(teamKey) {
        if (!teamKey) return '';
        const all = (typeof teamsData !== 'undefined' && Array.isArray(teamsData)) ? teamsData : [];
        const num = parseInt(String(teamKey).replace(/\D/g, ''), 10);
        const t = all.find(x => x.team_number === num);
        return t ? (t.nickname || '') : '';
    }

    // ── Panel DOM ───────────────────────────────────────────
    function _ensurePanel() {
        if (document.getElementById('gn-panel')) return;
        const el = document.createElement('div');
        el.id = 'gn-panel';
        el.className = 'gn-panel hidden';
        el.innerHTML = [
          '<div class="gn-titlebar" id="gn-titlebar">',
            '<span class="gn-title">',
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
              'Notes',
            '</span>',
            '<button class="gn-close" onclick="GlobalNotes.close()" title="Close (Esc)">',
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
            '</button>',
          '</div>',
          '<div class="gn-tabs">',
            '<button class="gn-tab gn-tab-active" data-gn-tab="team" onclick="GlobalNotes._switchTab(\'team\')">Team</button>',
            '<button class="gn-tab" data-gn-tab="match" onclick="GlobalNotes._switchTab(\'match\')">Match</button>',
            '<button class="gn-tab" data-gn-tab="event" onclick="GlobalNotes._switchTab(\'event\')">Event</button>',
          '</div>',
          '<div class="gn-body" id="gn-body"></div>',
          '<div class="gn-footer" id="gn-footer"></div>',
        ].join('\n');
        document.body.appendChild(el);
        _initDrag();
    }

    // ── Drag logic ──────────────────────────────────────────
    function _initDrag() {
        let dragging = false, startX, startY, origX, origY;

        document.addEventListener('mousedown', e => {
            const bar = e.target.closest('#gn-titlebar');
            if (!bar) return;
            if (e.target.closest('button')) return;
            dragging = true;
            const panel = document.getElementById('gn-panel');
            const rect = panel.getBoundingClientRect();
            startX = e.clientX;  startY = e.clientY;
            origX  = rect.left;  origY  = rect.top;
            panel.style.transition = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', e => {
            if (!dragging) return;
            const panel = document.getElementById('gn-panel');
            let nx = origX + (e.clientX - startX);
            let ny = origY + (e.clientY - startY);
            nx = Math.max(0, Math.min(nx, window.innerWidth  - 60));
            ny = Math.max(0, Math.min(ny, window.innerHeight - 40));
            panel.style.left   = nx + 'px';
            panel.style.top    = ny + 'px';
            panel.style.right  = 'auto';
            panel.style.bottom = 'auto';
        });

        document.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            const panel = document.getElementById('gn-panel');
            if (panel) panel.style.transition = '';
        });
    }

    // ── Open / Close ───────────────────────────────────────
    function open() {
        _ensurePanel();
        const panel = document.getElementById('gn-panel');
        if (!panel) return;
        _open = true;
        panel.classList.remove('hidden');
        panel.style.animation = 'none';
        panel.offsetHeight;
        panel.style.animation = '';
        const btn = document.getElementById('global-notes-btn');
        if (btn) btn.classList.add('active');
        _render();
        _loadNotes();
    }

    function close() {
        const panel = document.getElementById('gn-panel');
        if (!panel) return;
        _open = false;
        panel.classList.add('hidden');
        const btn = document.getElementById('global-notes-btn');
        if (btn) btn.classList.remove('active');
    }

    function toggle() { _open ? close() : open(); }
    function isOpen()  { return _open; }

    // ── Tab switch ─────────────────────────────────────────
    function _switchTab(tab) {
        _tab = tab;
        // Preserve _teamFilter and _teamSubFilter across tab switches
        _matchFilter = null;
        _matchQuery = '';
        _teamListOpen = false;
        _matchListOpen = false;
        _notes = [];
        document.querySelectorAll('.gn-tab').forEach(t => {
            t.classList.toggle('gn-tab-active', t.dataset.gnTab === tab);
        });
        _render();
        _loadNotes();
    }

    // ── Data loading ───────────────────────────────────────
    async function _loadNotes() {
        const ek = _eventKey();
        if (!ek) { _notes = []; _renderFeed(); return; }

        _loading = true;
        _renderFeed();

        try {
            if (_tab === 'team') {
                if (_teamFilter) {
                    _notes = await NotesService.fetchNotes(ek, null, _teamFilter);
                } else {
                    _notes = [];
                }
            } else if (_tab === 'match') {
                const mk = _matchFilter || _matchKey();
                if (mk) {
                    _notes = await NotesService.fetchNotes(ek, mk, null);
                } else {
                    _notes = [];
                }
            } else {
                // Event tab: only event-level notes (no team or match)
                const all = await NotesService.fetchNotes(ek, null, null);
                _notes = all.filter(n => !n.match_key && !n.team_key);
            }
        } catch (e) {
            console.error('[GlobalNotes] loadNotes error:', e);
            _notes = [];
        }

        _loading = false;
        _renderFeed();
    }

    // ── Rendering ──────────────────────────────────────────
    function _render() {
        const body = document.getElementById('gn-body');
        const footer = document.getElementById('gn-footer');
        if (!body || !footer) return;

        if (_tab === 'team') {
            body.innerHTML = _renderTeamTab();
            footer.innerHTML = _teamFilter ? _renderTeamFooter() : '';
            _wireTeamSearch();
        } else if (_tab === 'match') {
            body.innerHTML = _renderMatchTab();
            footer.innerHTML = '';  // read-only
            _wireMatchSearch();
        } else {
            body.innerHTML = _renderEventTab();
            footer.innerHTML = _renderEventFooter();
        }
    }

    // ══════════════════════════════════════════════════════
    //  TEAM TAB
    // ══════════════════════════════════════════════════════
    function _renderTeamTab() {
        const selectedNum = _teamFilter ? _teamFilter.replace(/\D/g, '') : '';
        const selectedName = _teamFilter ? _teamName(_teamFilter) : '';
        const displayText = _teamFilter
            ? selectedNum + (selectedName ? ' \u2014 ' + selectedName : '')
            : '';

        let dropdownHTML = '';
        if (_teamListOpen) {
            const results = _searchTeams(_teamQuery);
            dropdownHTML = '<div class="gn-dropdown" id="gn-team-dropdown">' +
                results.map(t => {
                    const num = t.team_number;
                    const key = t.team_key || ('frc' + num);
                    const name = t.nickname || '';
                    return '<button class="gn-dropdown-row" onclick="GlobalNotes._selectTeam(\'' + _esc(key) + '\')">' +
                             '<span class="gn-dropdown-num">' + num + '</span>' +
                             '<span class="gn-dropdown-name">' + _esc(name) + '</span>' +
                           '</button>';
                }).join('') +
            '</div>';
        }

        let subHTML = '';
        if (_teamFilter) {
            subHTML = '<div class="gn-sub-filters">' +
                '<button class="gn-sub-btn' + (_teamSubFilter === 'all' ? ' gn-sub-active' : '') + '" onclick="GlobalNotes._setTeamSub(\'all\')">All</button>' +
                '<button class="gn-sub-btn' + (_teamSubFilter === 'match' ? ' gn-sub-active' : '') + '" onclick="GlobalNotes._setTeamSub(\'match\')">Match</button>' +
                '<button class="gn-sub-btn' + (_teamSubFilter === 'general' ? ' gn-sub-active' : '') + '" onclick="GlobalNotes._setTeamSub(\'general\')">General</button>' +
              '</div>';
        }

        return '<div class="gn-selector">' +
            '<input type="text" class="gn-selector-input" id="gn-team-search"' +
            ' placeholder="Search team # or name\u2026"' +
            ' value="' + (_teamFilter ? _esc(displayText) : _esc(_teamQuery)) + '"' +
            ' autocomplete="off" />' +
            dropdownHTML +
          '</div>' +
          subHTML +
          '<div class="gn-feed" id="gn-feed"></div>';
    }

    function _wireTeamSearch() {
        const input = document.getElementById('gn-team-search');
        if (!input) return;
        input.addEventListener('focus', () => {
            if (_teamFilter) {
                _teamQuery = '';
                input.value = '';
            }
            _teamListOpen = true;
            _updateTeamDropdown();
        });
        input.addEventListener('input', e => {
            _teamQuery = e.target.value;
            _teamListOpen = true;
            _updateTeamDropdown();
        });
    }

    function _updateTeamDropdown() {
        let dd = document.getElementById('gn-team-dropdown');
        const container = document.querySelector('.gn-selector');
        if (!container) return;

        if (!_teamListOpen) {
            if (dd) dd.remove();
            return;
        }

        const results = _searchTeams(_teamQuery);
        const html = results.map(t => {
            const num = t.team_number;
            const key = t.team_key || ('frc' + num);
            const name = t.nickname || '';
            return '<button class="gn-dropdown-row" onclick="GlobalNotes._selectTeam(\'' + _esc(key) + '\')">' +
                     '<span class="gn-dropdown-num">' + num + '</span>' +
                     '<span class="gn-dropdown-name">' + _esc(name) + '</span>' +
                   '</button>';
        }).join('');

        if (!dd) {
            dd = document.createElement('div');
            dd.id = 'gn-team-dropdown';
            dd.className = 'gn-dropdown';
            container.appendChild(dd);
        }
        dd.innerHTML = html;
    }

    function _renderTeamFooter() {
        const num = _teamFilter ? _teamFilter.replace(/\D/g, '') : '';
        return '<form class="gn-note-form" onsubmit="GlobalNotes._submitTeamNote(event)">' +
            '<input type="text" class="gn-note-input" id="gn-team-note-input"' +
            ' placeholder="Note for ' + _esc(num) + '\u2026" autocomplete="off" />' +
            '<button type="submit" class="gn-send" title="Send">' +
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>' +
            '</button>' +
          '</form>';
    }

    function _selectTeam(teamKey) {
        if (!teamKey || teamKey === 'frc') return;
        _teamFilter = teamKey;
        _teamListOpen = false;
        _teamQuery = '';
        _teamSubFilter = 'all';
        _render();
        _loadNotes();
    }

    function _setTeamSub(sub) {
        _teamSubFilter = sub;
        document.querySelectorAll('.gn-sub-btn').forEach(b => {
            const bSub = b.textContent.trim().toLowerCase();
            b.classList.toggle('gn-sub-active', bSub === sub);
        });
        _renderFeed();
    }

    async function _submitTeamNote(e) {
        e.preventDefault();
        const input = document.getElementById('gn-team-note-input');
        const text = input?.value?.trim();
        if (!text || !_teamFilter) return;
        input.value = '';

        const ek = _eventKey();
        if (!ek) return;

        const author = _getAuthor();
        try {
            await NotesService.insertNote({
                event_key: ek,
                team_key: _teamFilter,
                author: author,
                content: text,
                type: 'manual',
            });
            _loadNotes();
        } catch (err) {
            console.error('[GlobalNotes] insertTeamNote error:', err);
        }
    }

    // ══════════════════════════════════════════════════════
    //  MATCH TAB  (read-only — shows BS notes)
    // ══════════════════════════════════════════════════════
    function _renderMatchTab() {
        const mk = _matchFilter || _matchKey();
        const selectedLabel = mk ? _matchLabelFull(mk) : '';

        let dropdownHTML = '';
        if (_matchListOpen) {
            const results = _searchMatches(_matchQuery);
            dropdownHTML = '<div class="gn-dropdown" id="gn-match-dropdown">' +
                results.map(m => {
                    const key = m.match_key || m.key || '';
                    const lbl = _matchLabelFull(key);
                    return '<button class="gn-dropdown-row" onclick="GlobalNotes._selectMatch(\'' + _esc(key) + '\')">' +
                             '<span class="gn-dropdown-num">' + _esc(lbl) + '</span>' +
                           '</button>';
                }).join('') +
            '</div>';
        }

        return '<div class="gn-selector">' +
            '<input type="text" class="gn-selector-input" id="gn-match-search"' +
            ' placeholder="Search match\u2026"' +
            ' value="' + (mk ? _esc(selectedLabel) : _esc(_matchQuery)) + '"' +
            ' autocomplete="off" />' +
            dropdownHTML +
          '</div>' +
          '<div class="gn-feed" id="gn-feed"></div>';
    }

    function _wireMatchSearch() {
        const input = document.getElementById('gn-match-search');
        if (!input) return;
        input.addEventListener('focus', () => {
            if (_matchFilter) {
                _matchQuery = '';
                input.value = '';
            }
            _matchListOpen = true;
            _updateMatchDropdown();
        });
        input.addEventListener('input', e => {
            _matchQuery = e.target.value;
            _matchListOpen = true;
            _updateMatchDropdown();
        });
    }

    function _updateMatchDropdown() {
        let dd = document.getElementById('gn-match-dropdown');
        const container = document.querySelector('#gn-body .gn-selector');
        if (!container) return;

        if (!_matchListOpen) {
            if (dd) dd.remove();
            return;
        }

        const results = _searchMatches(_matchQuery);
        const html = results.map(m => {
            const key = m.match_key || m.key || '';
            const lbl = _matchLabelFull(key);
            return '<button class="gn-dropdown-row" onclick="GlobalNotes._selectMatch(\'' + _esc(key) + '\')">' +
                     '<span class="gn-dropdown-num">' + _esc(lbl) + '</span>' +
                   '</button>';
        }).join('');

        if (!dd) {
            dd = document.createElement('div');
            dd.id = 'gn-match-dropdown';
            dd.className = 'gn-dropdown';
            container.appendChild(dd);
        }
        dd.innerHTML = html;
    }

    function _selectMatch(matchKey) {
        _matchFilter = matchKey;
        _matchListOpen = false;
        _matchQuery = '';
        _render();
        _loadNotes();
    }

    // ══════════════════════════════════════════════════════
    //  EVENT TAB
    // ══════════════════════════════════════════════════════
    function _renderEventTab() {
        return '<div class="gn-feed" id="gn-feed"></div>';
    }

    function _renderEventFooter() {
        return '<form class="gn-note-form" onsubmit="GlobalNotes._submitEventNote(event)">' +
            '<input type="text" class="gn-note-input" id="gn-event-input"' +
            ' placeholder="Add an event note\u2026" autocomplete="off" />' +
            '<button type="submit" class="gn-send" title="Send">' +
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>' +
            '</button>' +
          '</form>';
    }

    async function _submitEventNote(e) {
        e.preventDefault();
        const input = document.getElementById('gn-event-input');
        const text = input?.value?.trim();
        if (!text) return;
        input.value = '';

        const ek = _eventKey();
        if (!ek) return;

        const author = _getAuthor();
        try {
            await NotesService.insertNote({
                event_key: ek,
                author: author,
                content: text,
                type: 'manual',
            });
            _loadNotes();
        } catch (err) {
            console.error('[GlobalNotes] submitEventNote error:', err);
        }
    }

    function _getAuthor() {
        if (typeof Auth !== 'undefined' && Auth.getUser) {
            const u = Auth.getUser();
            if (u?.user_metadata?.name) return u.user_metadata.name;
            if (u?.email) return u.email.split('@')[0];
        }
        return 'Caster';
    }

    // ── Feed rendering ─────────────────────────────────────
    function _renderFeed() {
        const feed = document.getElementById('gn-feed');
        if (!feed) return;

        if (_loading) {
            feed.innerHTML = '<div class="gn-empty"><div class="gn-spinner"></div></div>';
            return;
        }

        if (_tab === 'team' && !_teamFilter) {
            feed.innerHTML = '<div class="gn-empty gn-muted">Select a team above</div>';
            return;
        }
        if (_tab === 'match' && !_matchFilter && !_matchKey()) {
            feed.innerHTML = '<div class="gn-empty gn-muted">Select a match above</div>';
            return;
        }

        if (!_notes.length) {
            feed.innerHTML = '<div class="gn-empty gn-muted">No notes yet</div>';
            return;
        }

        if (_tab === 'team') {
            feed.innerHTML = _renderTeamFeed();
        } else if (_tab === 'match') {
            feed.innerHTML = _notes.map(n => _renderMatchNote(n)).join('');
        } else {
            feed.innerHTML = _notes.map(n => _renderEventNote(n)).join('');
        }
    }

    // ── Team feed (sub-filters + match grouping) ───────────
    function _renderTeamFeed() {
        const manual = _notes.filter(n => n.type !== 'system');

        if (_teamSubFilter === 'general') {
            const gen = manual.filter(n => !n.match_key);
            if (!gen.length) return '<div class="gn-empty gn-muted">No general notes</div>';
            return gen.map(n => _renderTeamNoteCard(n, false)).join('');
        }

        if (_teamSubFilter === 'match') {
            const match = manual.filter(n => n.match_key);
            if (!match.length) return '<div class="gn-empty gn-muted">No match notes</div>';
            return _renderMatchGroups(match, false);
        }

        // 'all' — general first (normal), match second (muted)
        const gen = manual.filter(n => !n.match_key);
        const match = manual.filter(n => n.match_key);
        let html = '';
        html += gen.map(n => _renderTeamNoteCard(n, false)).join('');
        if (match.length) html += _renderMatchGroups(match, true);
        if (!html) return '<div class="gn-empty gn-muted">No notes yet</div>';
        return html;
    }

    function _renderMatchGroups(notes, muted) {
        const groups = new Map();
        for (const n of notes) {
            const mk = n.match_key;
            if (!groups.has(mk)) groups.set(mk, []);
            groups.get(mk).push(n);
        }
        let html = '';
        for (const [mk, items] of groups) {
            const label = _matchLabel(mk);
            html += '<div class="gn-match-group' + (muted ? ' gn-match-muted' : '') + '">' +
                '<div class="gn-match-group-pill">' + _esc(label) + '</div>' +
                items.map(n => _renderTeamNoteInner(n)).join('') +
              '</div>';
        }
        return html;
    }

    function _renderTeamNoteCard(note, muted) {
        const ml = note.match_key ? _matchLabel(note.match_key) : '';
        return '<div class="gn-note gn-note-generic' + (muted ? ' gn-note-muted' : '') + '">' +
            '<div class="gn-note-head">' +
              (ml ? '<span class="gn-note-match-tag">' + _esc(ml) + '</span>'
                  : '<span class="gn-note-match-tag gn-tag-general">GEN</span>') +
              '<span class="gn-note-author">' + _esc(note.author || 'Caster') + '</span>' +
              '<span class="gn-note-time">' + _timeAgo(note.created_at) + '</span>' +
            '</div>' +
            '<p class="gn-note-body">' + _esc(note.content) + '</p>' +
          '</div>';
    }

    function _renderTeamNoteInner(note) {
        return '<div class="gn-note gn-note-generic">' +
            '<div class="gn-note-head">' +
              '<span class="gn-note-author">' + _esc(note.author || 'Caster') + '</span>' +
              '<span class="gn-note-time">' + _timeAgo(note.created_at) + '</span>' +
            '</div>' +
            '<p class="gn-note-body">' + _esc(note.content) + '</p>' +
          '</div>';
    }

    // ── Match note rendering ───────────────────────────────
    function _renderMatchNote(note) {
        if (note.type === 'system') {
            const label = _sysLabel(note.content || '');
            return '<div class="gn-note gn-note-system">' +
                '<span class="gn-note-badge gn-badge-system">' + _esc(label) + '</span>' +
                '<span class="gn-note-time">' + _timeAgo(note.created_at) + '</span>' +
              '</div>';
        }

        const teamNum = note.team_key ? note.team_key.replace(/\D/g, '') : '';
        const side = _noteSide(note);

        return '<div class="gn-note gn-note-' + side + '">' +
            '<div class="gn-note-head">' +
              (teamNum ? '<span class="gn-note-team gn-team-' + side + '">' + teamNum + '</span>' : '') +
              '<span class="gn-note-author">' + _esc(note.author || 'Caster') + '</span>' +
              '<span class="gn-note-time">' + _timeAgo(note.created_at) + '</span>' +
            '</div>' +
            '<p class="gn-note-body">' + _esc(note.content) + '</p>' +
          '</div>';
    }

    // ── Event note rendering ───────────────────────────────
    function _renderEventNote(note) {
        if (note.type === 'system') return '';
        return '<div class="gn-note gn-note-generic">' +
            '<div class="gn-note-head">' +
              '<span class="gn-note-author">' + _esc(note.author || 'Caster') + '</span>' +
              '<span class="gn-note-time">' + _timeAgo(note.created_at) + '</span>' +
            '</div>' +
            '<p class="gn-note-body">' + _esc(note.content) + '</p>' +
          '</div>';
    }

    function _noteSide(note) {
        if (note.type === 'system') return 'system';
        if (!note.team_key) return 'neutral';
        if (typeof pbpData === 'undefined' || !pbpData?.matches?.length) return 'neutral';
        const mk = note.match_key;
        if (!mk) return 'neutral';
        const match = pbpData.matches.find(m => (m.match_key || m.key) === mk);
        if (!match) return 'neutral';
        const num = parseInt(String(note.team_key).replace(/\D/g, ''), 10);
        const getRed = (a) => a?.teams ? a.teams.map(t => t.team_number) : (a?.team_numbers || []);
        const getBlue = (a) => a?.teams ? a.teams.map(t => t.team_number) : (a?.team_numbers || []);
        if (getRed(match.red).includes(num)) return 'red';
        if (getBlue(match.blue).includes(num)) return 'blue';
        return 'neutral';
    }

    // ── Keyboard ───────────────────────────────────────────
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && _open) close();
        if ((e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey && !e.altKey) {
            if (e.target.matches('input, textarea, select, [contenteditable]')) return;
            toggle();
        }
    });

    // Close dropdowns on outside click
    document.addEventListener('mousedown', e => {
        if (!_open) return;
        const panel = document.getElementById('gn-panel');
        if (!panel || !panel.contains(e.target)) return;
        if (!e.target.closest('.gn-selector')) {
            if (_teamListOpen)  { _teamListOpen  = false; _updateTeamDropdown();  }
            if (_matchListOpen) { _matchListOpen = false; _updateMatchDropdown(); }
        }
    });

    // ── Public API ─────────────────────────────────────────
    return {
        open,
        close,
        toggle,
        isOpen,
        _switchTab,
        _selectTeam,
        _selectMatch,
        _submitEventNote,
        _submitTeamNote,
        _setTeamSub,
    };
})();
