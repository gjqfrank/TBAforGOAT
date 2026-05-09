/* ═══════════════════════════════════════════════════════════
   editor.js — TIMS Override Editor (Phase 2.9A)

   Custom context menu, tabbed glassmorphism modal,
   tag-input UI for hardware & playstyle, auth-gated.

   Public API:
     openEditor(teamNumber, defaultTab)  — open editor modal
     closeEditor()                       — close editor modal
   ═══════════════════════════════════════════════════════════ */

// ── State ──────────────────────────────────────────────────
let _editorTeam = null;    // team number being edited
let _editorTab  = 'identity'; // active tab

// Tag arrays (each tag input has its own array)
let _hardwareTags   = [];
let _autoTags       = [];
let _teleopTags     = [];

function _getDeviceId() {
    let id = localStorage.getItem('casters_device_id');
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('casters_device_id', id); }
    return id;
}

// ═══════════════════════════════════════════════════════════
// TIMS DATA + FIELD PRE-POPULATION
// ═══════════════════════════════════════════════════════════

function _findTeamInEvent(teamNumber) {
    // teamsData is the in-memory array built by app.js: buildTeamTable()
    if (typeof teamsData === 'undefined' || !teamsData) return null;
    return teamsData.find(t => t.team_number == teamNumber) || null;
}

function _populateEditorFromTIMS(teamNumber) {
    const t = _findTeamInEvent(teamNumber);
    if (!t) return;

    // Overlay any locally-cached TIMS edits (survives stale teamsData)
    const ov = (typeof _timsCache !== 'undefined') ? _timsCache[teamNumber] : null;

    // Header — team name + avatar
    const nameEl = document.getElementById('editor-header-name');
    if (nameEl) nameEl.textContent = ov?.nickname || t.nickname || '';

    const avatarEl = document.getElementById('editor-header-avatar');
    if (avatarEl) {
        if (t.avatar) {
            const img = document.createElement('img');
            img.src = t.avatar;
            img.alt = '';
            img.className = 'editor-avatar-img';
            avatarEl.innerHTML = '';
            avatarEl.appendChild(img);
        } else {
            avatarEl.innerHTML = `<span class="editor-avatar-placeholder">${_escHtml(String(teamNumber))}</span>`;
        }
    }

    // Identity fields — pre-fill from TIMS cache first, then event data
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val || '';
    };
    setVal('editor-nickname', ov?.nickname || t.nickname);
    setVal('editor-org', ov?.organization || t.school_name);
    setVal('editor-location', ov?.location || [t.city, t.state_prov].filter(Boolean).join(', '));
    setVal('editor-robot-name', ov?.robot_name || t.robot_name);
    setVal('editor-number-display', ov?.number_display || t.number_display);
    setVal('editor-pronunciation', ov?.pronunciation || t.name_pronounce);
    setVal('editor-motto', ov?.motto || t.motto);
    setVal('editor-sponsors', ov?.top_sponsors || ov?.sponsor_read || t.sponsor_read);

    // Hardware & Playstyle — restore from cache first, then event data
    _hardwareTags = _parseJsonTags(ov?.hardware || t.hardware);
    _autoTags     = _parseJsonTags(ov?.auto_strategy || t.auto_strategy);
    _teleopTags   = _parseJsonTags(ov?.teleop_strategy || t.teleop_strategy);
    _renderTags('editor-hardware-tags', _hardwareTags);
    _renderTags('editor-auto-tags', _autoTags);
    _renderTags('editor-teleop-tags', _teleopTags);

    // Audit trail — show "Last updated by..." if available
    _renderAuditTrail(t);
}

// ── Open / Close ───────────────────────────────────────────
function openEditor(teamNumber, defaultTab) {
    if (window.isGuest) {
        showLoginModal();
        return;
    }
    if (!teamNumber) return;

    _editorTeam = teamNumber;
    _editorTab = defaultTab || 'identity';

    // Reset tags
    _hardwareTags = [];
    _autoTags = [];
    _teleopTags = [];

    // Set header team number
    const hdr = document.getElementById('editor-team-num');
    if (hdr) hdr.textContent = teamNumber;

    // Clear all form fields
    _resetEditorForm();

    // Pre-populate from available TIMS data
    _populateEditorFromTIMS(teamNumber);

    // Show modal
    const overlay = document.getElementById('editor-overlay');
    overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    // Scroll modal body to top
    const modalBody = overlay.querySelector('.editor-body');
    if (modalBody) modalBody.scrollTop = 0;

    // Activate requested tab
    _switchEditorTab(_editorTab);
}

function closeEditor() {
    const overlay = document.getElementById('editor-overlay');
    if (!overlay || overlay.classList.contains('hidden')) return;
    overlay.classList.add('hidden');
    document.body.style.overflow = '';
    _editorTeam = null;
    hideTeamContextMenu();
}

// ── Tab switching ──────────────────────────────────────────
function _switchEditorTab(tab) {
    _editorTab = tab;
    const tabs = ['identity', 'hardware', 'playstyle'];
    tabs.forEach(t => {
        const btn  = document.getElementById('editor-tab-' + t);
        const body = document.getElementById('editor-body-' + t);
        if (btn)  btn.classList.toggle('active', t === tab);
        if (body) body.classList.toggle('hidden', t !== tab);
    });
    // Reset-to-FIRST-defaults only relevant on Identity tab
    const rstBtn = document.getElementById('editor-reset-defaults-btn');
    if (rstBtn) rstBtn.style.display = tab === 'identity' ? '' : 'none';
}

// ── Form reset ─────────────────────────────────────────────
function _resetEditorForm() {
    // Identity fields
    ['editor-nickname', 'editor-pronunciation', 'editor-location',
     'editor-org', 'editor-robot-name', 'editor-number-display',
     'editor-motto', 'editor-sponsors'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    // Clear tag containers
    _hardwareTags = [];
    _autoTags = [];
    _teleopTags = [];
    _renderTags('editor-hardware-tags', _hardwareTags);
    _renderTags('editor-auto-tags', _autoTags);
    _renderTags('editor-teleop-tags', _teleopTags);
}

// ═══════════════════════════════════════════════════════════
// TAG INPUT LOGIC
// ═══════════════════════════════════════════════════════════

function _getTagArray(inputId) {
    if (inputId === 'editor-hardware-input')  return { arr: _hardwareTags,  containerId: 'editor-hardware-tags',  setter: v => { _hardwareTags = v; } };
    if (inputId === 'editor-auto-input')      return { arr: _autoTags,      containerId: 'editor-auto-tags',      setter: v => { _autoTags = v; } };
    if (inputId === 'editor-teleop-input')    return { arr: _teleopTags,    containerId: 'editor-teleop-tags',    setter: v => { _teleopTags = v; } };
    return null;
}

function _handleTagKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ',') return;
    e.preventDefault();
    const input = e.target;
    const val = input.value.trim().replace(/,$/,'');
    if (!val) return;

    const ref = _getTagArray(input.id);
    if (!ref) return;

    // Prevent duplicates (case-insensitive)
    if (ref.arr.some(t => t.toLowerCase() === val.toLowerCase())) {
        input.value = '';
        return;
    }

    ref.arr.push(val);
    input.value = '';
    _renderTags(ref.containerId, ref.arr);
}

function _removeTag(containerId, index) {
    if (containerId === 'editor-hardware-tags')  _hardwareTags.splice(index, 1);
    else if (containerId === 'editor-auto-tags') _autoTags.splice(index, 1);
    else if (containerId === 'editor-teleop-tags') _teleopTags.splice(index, 1);
    _renderTags(containerId, containerId === 'editor-hardware-tags' ? _hardwareTags : containerId === 'editor-auto-tags' ? _autoTags : _teleopTags);
}

function _renderTags(containerId, tags) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = tags.map((tag, i) =>
        `<span class="editor-tag">
            ${_escHtml(tag)}
            <button type="button" class="editor-tag-remove" onclick="_removeTag('${containerId}', ${i})" title="Remove">&times;</button>
        </span>`
    ).join('');
}

function _escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

/** Parse a JSON array string (or plain array) into an array of strings. */
function _parseJsonTags(val) {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    try { const a = JSON.parse(val); return Array.isArray(a) ? a : []; }
    catch { return []; }
}

/** Render the "Last updated by X at Y on Date" audit line inside the editor. */
function _renderAuditTrail(team) {
    const el = document.getElementById('editor-audit-trail');
    if (!el) return;
    if (!team.tims_author && !team.has_tims_overrides) {
        el.innerHTML = '';
        el.style.display = 'none';
        return;
    }
    const name = team.tims_author || 'Unknown';
    const evKey = team.tims_event_key || '';
    const ts = team.tims_updated_at;
    let dateStr = '';
    if (ts) {
        try { dateStr = new Date(ts).toLocaleString(); }
        catch { dateStr = ts; }
    }
    let html = `Last updated by <strong>${_escHtml(name)}</strong>`;
    if (evKey) html += ` at <strong>${_escHtml(evKey)}</strong>`;
    if (dateStr) html += ` on ${_escHtml(dateStr)}`;
    const teamKey = team.team_key || '';
    if (teamKey) html += ` &mdash; <a href="#" onclick="_showTimsHistory('${_escHtml(teamKey)}');return false" style="color:var(--primary)">View History</a>`;
    el.innerHTML = html;
    el.style.display = '';
}

/** Show TIMS edit history in a simple overlay. */
async function _showTimsHistory(teamKey) {
    try {
        const rows = await API.timsHistory(teamKey);
        if (!rows || !rows.length) { alert('No edit history found.'); return; }
        let html = '<div style="max-height:60vh;overflow:auto;font-size:.82rem;line-height:1.6">';
        html += '<table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left;padding:.3rem .5rem;border-bottom:1px solid var(--border)">Who</th><th style="text-align:left;padding:.3rem .5rem;border-bottom:1px solid var(--border)">Event</th><th style="text-align:left;padding:.3rem .5rem;border-bottom:1px solid var(--border)">When</th></tr></thead><tbody>';
        for (const r of rows) {
            const dt = r.created_at ? new Date(r.created_at).toLocaleString() : '—';
            html += `<tr><td style="padding:.25rem .5rem">${_escHtml(r.author_name || '—')}</td><td style="padding:.25rem .5rem">${_escHtml(r.author_event_key || '—')}</td><td style="padding:.25rem .5rem">${_escHtml(dt)}</td></tr>`;
        }
        html += '</tbody></table></div>';
        const overlay = document.createElement('div');
        overlay.id = 'tims-history-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center';
        overlay.innerHTML = `<div style="background:var(--card);border-radius:16px;padding:1.2rem;max-width:500px;width:90%;color:var(--text);box-shadow:0 8px 32px rgba(0,0,0,.4)"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem"><strong>Edit History — ${_escHtml(teamKey)}</strong><button onclick="this.closest('#tims-history-overlay').remove()" style="background:none;border:none;color:var(--text);font-size:1.2rem;cursor:pointer">&times;</button></div>${html}</div>`;
        document.body.appendChild(overlay);
    } catch (err) {
        alert('Could not load history: ' + (err.message || err));
    }
}

/** Reset TIMS overrides to FIRST defaults (soft-delete from Supabase). */
async function _handleEditorResetToDefaults() {
    if (!_editorTeam) return;
    if (!confirm('Reset all TIMS edits for this team to FIRST defaults? This cannot be undone.')) return;

    const prefix = typeof isFTCMode === 'function' && isFTCMode() ? 'ftc' : 'frc';
    const teamKey = `${prefix}${_editorTeam}`;
    const btn = document.getElementById('editor-reset-defaults-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Resetting…'; }

    try {
        await API.timsDelete(teamKey);
        // Clear local cache
        if (typeof _timsCache !== 'undefined') delete _timsCache[_editorTeam];
        await DB.putOverride({ id: `override_${teamKey}`, team_key: teamKey, team_number: _editorTeam, _deleted: true }).catch(() => {});
        console.info('[Editor] Reset TIMS to defaults for', teamKey);
        closeEditor();
        if (typeof showToast === 'function') showToast('Reset to FIRST defaults', 'info', 2500);
    } catch (err) {
        console.error('[Editor] Reset failed', err);
        alert('Reset failed: ' + (err.message || err));
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Reset to FIRST Defaults'; }
    }
}

// ═══════════════════════════════════════════════════════════
// SAVE / RESET
// ═══════════════════════════════════════════════════════════

async function saveOverrideData(teamNumber, payload) {
    const prefix = typeof isFTCMode === 'function' && isFTCMode() ? 'ftc' : 'frc';
    const teamKey = `${prefix}${teamNumber}`;

    // Build the Supabase-compatible payload
    const body = { author_device_id: _getDeviceId() };

    // Identity fields — send value or null (to clear).
    // number_display must contain at least one digit to be valid; strip garbage.
    body.custom_nickname      = payload.nickname      || null;
    body.custom_organization  = payload.organization  || null;
    body.custom_location      = payload.location      || null;
    body.custom_top_sponsors  = payload.top_sponsors  || null;
    body.custom_pronunciation = payload.pronunciation || null;
    body.custom_robot_name    = payload.robot_name    || null;
    body.custom_motto         = payload.motto         || null;
    body.custom_number_display = (payload.number_display && /\d/.test(payload.number_display))
        ? payload.number_display : null;

    // Hardware & Playstyle — store as JSON array strings or null
    body.custom_hardware       = payload.hardware?.length        ? JSON.stringify(payload.hardware) : null;
    body.custom_auto_strategy  = payload.auto_strategy?.length   ? JSON.stringify(payload.auto_strategy) : null;
    body.custom_teleop_strategy = payload.teleop_strategy?.length ? JSON.stringify(payload.teleop_strategy) : null;

    // Audit: author name + current event
    const user = typeof Auth !== 'undefined' ? Auth.getUser() : null;
    body.author_name = user?.user_metadata?.name || user?.email || 'Unknown';
    body.author_event_key = typeof currentEvent !== 'undefined' ? currentEvent : null;

    try {
        const result = await API.timsPut(teamKey, body);
        // Also save locally for offline / instant display
        const record = {
            id: `override_${teamKey}`,
            team_key: teamKey,
            team_number: teamNumber,
            ...payload,
            updated_at: Date.now(),
        };
        await DB.putOverride(record).catch(() => {});
        if (typeof _timsCache !== 'undefined') _timsCache[teamNumber] = record;

        // Also update the in-memory teamsData entry so stale server-applied
        // values (e.g. a corrupted number_display that the backend had already
        // baked into the response) don't linger for this session.
        if (typeof teamsData !== 'undefined' && teamsData) {
            const td = teamsData.find(t => t.team_number === teamNumber);
            if (td) {
                if (payload.nickname)      td.nickname    = payload.nickname;
                if (payload.organization)  td.school_name = payload.organization;
                if (payload.robot_name)    td.robot_name  = payload.robot_name;
                if (payload.top_sponsors)  td.top_sponsors = payload.top_sponsors;
                if (payload.motto)         td.motto       = payload.motto;
                // Always update number_display (even to empty) so _renderTeamNum
                // picks up the cleared value via the cache, not the stale td value.
                td.number_display = body.custom_number_display || '';
                if (payload.location) {
                    const parts = payload.location.split(',').map(s => s.trim());
                    td.city       = parts[0] || td.city;
                    td.state_prov = parts.slice(1).join(', ') || td.state_prov;
                }
            }
        }
        console.info('[Editor] Saved override for team', teamNumber, result);
        return { success: true, data: result };
    } catch (err) {
        console.error('[Editor] Failed to save override', err);
        return { success: false, error: String(err.message || err) };
    }
}

function _gatherEditorPayload() {
    return {
        // Tab 1: Identity
        nickname:       document.getElementById('editor-nickname')?.value.trim() || '',
        organization:   document.getElementById('editor-org')?.value.trim() || '',
        location:       document.getElementById('editor-location')?.value.trim() || '',
        robot_name:     document.getElementById('editor-robot-name')?.value.trim() || '',
        number_display: document.getElementById('editor-number-display')?.value.trim() || '',
        motto:          document.getElementById('editor-motto')?.value.trim() || '',
        top_sponsors:   document.getElementById('editor-sponsors')?.value.trim() || '',
        pronunciation:  document.getElementById('editor-pronunciation')?.value.trim() || '',
        // Tab 2: Hardware
        hardware:       [..._hardwareTags],
        // Tab 3: Playstyle
        auto_strategy:  [..._autoTags],
        teleop_strategy:[..._teleopTags],
    };
}

async function _handleEditorSave() {
    if (!_editorTeam) return;
    const btn = document.getElementById('editor-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    const payload = _gatherEditorPayload();
    const result = await saveOverrideData(_editorTeam, payload);

    if (btn) { btn.disabled = false; btn.textContent = 'Save Changes'; }

    if (result?.success) {
        closeEditor();
        if (typeof showToast === 'function') showToast('Changes saved', 'info', 2500);
        if (typeof renderPbpMatch === 'function') renderPbpMatch();
    } else {
        const msg = result?.error || 'Unknown error';
        const errEl = document.getElementById('editor-error');
        if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
        else alert(`Save failed: ${msg}`);
    }
}

function _handleEditorReset() {
    _resetEditorForm();
    // Re-populate from current TIMS data (NOT a reset to FIRST defaults)
    if (_editorTeam) _populateEditorFromTIMS(_editorTeam);
}

// ═══════════════════════════════════════════════════════════
// CUSTOM CONTEXT MENU
// ═══════════════════════════════════════════════════════════

let _ctxTeamKey = '';
let _ctxTeamNumber = 0;
let _ctxTeamData = null;
let _longPressTimer = null;
let _longPressStartX = 0;
let _longPressStartY = 0;

/** Resolve team data from the global teamsData array */
function _resolveTeamData(teamKey) {
    if (!teamKey || typeof teamsData === 'undefined' || !teamsData) return null;
    return teamsData.find(t => t.team_key === teamKey) || null;
}

/** Find the nearest team element — checks data-team-key first, then team-number CSS classes */
function _findTeamElement(target) {
    const byKey = target.closest('[data-team-key]');
    if (byKey) return byKey;
    // Fallback: match known team-number selectors (same list as _TEAM_NUM_SELECTORS in app.js)
    const teamNumEl = target.closest('.team-num, .adv-team-num, .pbp-team-number, .top-team-num, .high-score-team, .summary-hof-num, .prestige-entry-num, .conn-team-num, .rp-team-num, .alliance-team-num');
    if (teamNumEl) {
        const raw = teamNumEl.dataset.teamNumber || teamNumEl.textContent.replace(/[^0-9]/g, '');
        const num = parseInt(raw, 10);
        if (num > 0 && num < 100000) {
            // Synthesize a team key and attach it so the rest of the pipeline works
            const prefix = (typeof competitionMode !== 'undefined' && competitionMode === 'ftc') ? 'ftc' : 'frc';
            teamNumEl.dataset.teamKey = prefix + num;
            return teamNumEl;
        }
    }
    return null;
}

function showTeamContextMenu(teamKey, x, y) {
    const data = _resolveTeamData(teamKey);
    _ctxTeamKey = teamKey;
    _ctxTeamNumber = data?.team_number || parseInt((teamKey || '').replace(/\D/g, ''), 10) || 0;
    _ctxTeamData = data;

    // Populate header
    const numEl = document.getElementById('ctx-menu-team-num');
    const nameEl = document.getElementById('ctx-menu-team-name');
    if (numEl) numEl.textContent = '#' + _ctxTeamNumber;
    if (nameEl) nameEl.textContent = data?.nickname || '';

    // Hide auth-gated items for guests
    const authItems = document.querySelectorAll('#team-ctx-menu [data-ctx-auth]');
    authItems.forEach(el => { el.style.display = window.isGuest ? 'none' : ''; });

    // Show storyline option when on PBP tab and storylines available
    const storyEl = document.getElementById('ctx-menu-storyline');
    if (storyEl) {
        const onPbp = document.querySelector('.tab-content[data-tab="playbyplay"]')?.classList.contains('active')
            || document.getElementById('pbp-container')?.offsetParent !== null;
        storyEl.style.display = (onPbp && typeof _storylineAvailable !== 'undefined' && _storylineAvailable) ? '' : 'none';
    }

    // Tab-aware action visibility: Events tab → only Lookup
    const activeTab = document.querySelector('.tab.active')?.dataset.tab || '';
    const matchesEl = document.getElementById('ctx-menu-matches');
    if (matchesEl) {
        matchesEl.style.display = (activeTab === 'event') ? 'none' : '';
    }

    // Events tab → also hide edit buttons
    const editGroups = document.querySelectorAll('#team-ctx-menu [data-ctx-auth]');
    editGroups.forEach(el => {
        if (activeTab === 'event') el.style.display = 'none';
    });

    // Position the menu near the pointer / touch point
    const menu = document.getElementById('team-ctx-menu');
    const scrim = document.getElementById('ctx-menu-scrim');
    if (!menu || !scrim) return;

    menu.style.left = '0'; menu.style.top = '0';
    menu.classList.add('open');
    scrim.classList.add('open');

    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = Math.min(x, vw - mw - 8);
    let top  = Math.min(y, vh - mh - 8);
    left = Math.max(8, left);
    top  = Math.max(8, top);

    menu.style.left = left + 'px';
    menu.style.top  = top + 'px';
}

function hideTeamContextMenu() {
    const menu = document.getElementById('team-ctx-menu');
    const scrim = document.getElementById('ctx-menu-scrim');
    if (menu)  menu.classList.remove('open');
    if (scrim) scrim.classList.remove('open');
}

/* Context menu actions */
function _handleCtxAction(action) {
    hideTeamContextMenu();
    switch (action) {
        case 'lookup':
            if (_ctxTeamNumber && typeof floatLookupQuick === 'function') {
                floatLookupQuick(_ctxTeamNumber);
            }
            break;
        case 'matches':
            if (_ctxTeamKey) _launchMatchHistoryForTeam(_ctxTeamKey);
            break;
        case 'edit-identity':
            if (_ctxTeamNumber) openEditor(_ctxTeamNumber, 'identity');
            break;
        case 'edit-hardware':
            if (_ctxTeamNumber) openEditor(_ctxTeamNumber, 'hardware');
            break;
        case 'edit-playstyle':
            if (_ctxTeamNumber) openEditor(_ctxTeamNumber, 'playstyle');
            break;
        case 'storyline':
            if (_ctxTeamNumber && typeof generatePbpTeamStoryline === 'function') {
                generatePbpTeamStoryline(_ctxTeamNumber);
            }
            break;
    }
}

/** Open match history from context menu for a specific team */
async function _launchMatchHistoryForTeam(teamKey) {
    if (!teamKey || typeof currentEvent === 'undefined' || !currentEvent) return;
    const num = parseInt((teamKey || '').replace(/\D/g, ''), 10);
    if (!num) return;
    const teamInfo = (typeof teamsData !== 'undefined' && teamsData)
        ? teamsData.find(t => t.team_key === teamKey) : null;
    const nick = teamInfo && typeof formatTeamName === 'function'
        ? formatTeamName(teamInfo.nickname) : '';

    if (typeof _launchMatchHistoryShared === 'function') {
        _launchMatchHistoryShared(num, nick);
        return;
    }

    if (typeof openMatchHistory === 'function') openMatchHistory();
    const titleEl = document.getElementById('match-history-title');
    const bodyEl = document.getElementById('match-history-body');
    if (titleEl) titleEl.textContent = `Match History · ${num}${nick ? ' — ' + nick : ''}`;
    if (bodyEl) bodyEl.innerHTML = '<p class="loading-msg">Loading match history…</p>';

    try {
        if (typeof isFTCMode === 'function' && isFTCMode()) {
            const perf = typeof _buildFtcTeamPerf === 'function' ? _buildFtcTeamPerf(num) : null;
            if (perf && typeof renderMatchHistoryPanel === 'function') renderMatchHistoryPanel(perf, num, nick);
        } else if (typeof API !== 'undefined' && API.teamPerf) {
            const perf = await API.teamPerf(currentEvent, num);
            if (typeof renderMatchHistoryPanel === 'function') renderMatchHistoryPanel(perf, num, nick);
        }
    } catch (err) {
        if (bodyEl) bodyEl.innerHTML = `<p class="empty">Error: ${err.message}</p>`;
    }
}

/* ── Dual trigger: Desktop right-click + Mobile long-press ─────────── */
(function initTeamContextTriggers() {
    let _justFiredCtx = false;

    // Desktop: right-click
    document.addEventListener('contextmenu', (e) => {
        const teamEl = _findTeamElement(e.target);
        if (!teamEl) return;
        e.preventDefault();
        e.stopPropagation();
        _justFiredCtx = true;
        setTimeout(() => { _justFiredCtx = false; }, 300);
        showTeamContextMenu(teamEl.dataset.teamKey, e.clientX, e.clientY);
    });

    // Mobile: long-press
    const LONG_PRESS_MS = 500;
    const MOVE_THRESHOLD = 10;

    document.addEventListener('touchstart', (e) => {
        const teamEl = _findTeamElement(e.target);
        if (!teamEl) return;
        const touch = e.touches[0];
        _longPressStartX = touch.clientX;
        _longPressStartY = touch.clientY;
        _longPressTimer = setTimeout(() => {
            _longPressTimer = null;
            _justFiredCtx = true;
            setTimeout(() => { _justFiredCtx = false; }, 300);
            if (navigator.vibrate) navigator.vibrate(50);
            showTeamContextMenu(teamEl.dataset.teamKey, touch.clientX, touch.clientY);
        }, LONG_PRESS_MS);
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!_longPressTimer) return;
        const touch = e.touches[0];
        const dx = Math.abs(touch.clientX - _longPressStartX);
        const dy = Math.abs(touch.clientY - _longPressStartY);
        if (dx > MOVE_THRESHOLD || dy > MOVE_THRESHOLD) {
            clearTimeout(_longPressTimer);
            _longPressTimer = null;
        }
    }, { passive: true });

    document.addEventListener('touchend', () => {
        if (_longPressTimer) { clearTimeout(_longPressTimer); _longPressTimer = null; }
    }, { passive: true });

    document.addEventListener('touchcancel', () => {
        if (_longPressTimer) { clearTimeout(_longPressTimer); _longPressTimer = null; }
    }, { passive: true });

    // Touch callout disabled on team elements
    document.head.insertAdjacentHTML('beforeend',
        `<style>[data-team-key],.rank-card,.alliance-team-row{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}</style>`);
})();

// Close context menu on Escape
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        const ctxOpen = document.getElementById('team-ctx-menu')?.classList.contains('open');
        const editorOpen = !document.getElementById('editor-overlay')?.classList.contains('hidden');
        if (ctxOpen) { hideTeamContextMenu(); return; }
        if (editorOpen) { closeEditor(); return; }
    }
});

// ── Bottom bar "Edit Details" ──────────────────────────────
function launchEditorFromSelection() {
    if (compareSelection.size !== 1) return;
    const teamKey = [...compareSelection][0];
    const num = parseInt(teamKey.replace(/^(frc|ftc)/, ''), 10);
    if (!num) return;
    openEditor(num, 'identity');
}

// ── Wire tag inputs ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    ['editor-hardware-input', 'editor-auto-input', 'editor-teleop-input'].forEach(id => {
        document.getElementById(id)?.addEventListener('keydown', _handleTagKeydown);
    });
});
