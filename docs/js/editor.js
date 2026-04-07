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

// ═══════════════════════════════════════════════════════════
// TIMS DATA + FIELD PRE-POPULATION
// ═══════════════════════════════════════════════════════════

function _findTeamInEvent(teamNumber) {
    // teamsData is the in-memory array built by app.js: buildTeamTable()
    if (!window.teamsData) return null;
    return window.teamsData.find(t => t.team_number === teamNumber) || null;
}

function _populateEditorFromTIMS(teamNumber) {
    const t = _findTeamInEvent(teamNumber);
    if (!t) return;

    // Header — team name + avatar
    const nameEl = document.getElementById('editor-header-name');
    if (nameEl) nameEl.textContent = t.nickname || '';

    const avatarEl = document.getElementById('editor-header-avatar');
    if (avatarEl) {
        if (t.avatar) {
            avatarEl.innerHTML = `<img src="${t.avatar}" alt="" class="editor-avatar-img">`;
        } else {
            avatarEl.innerHTML = `<span class="editor-avatar-placeholder">${teamNumber}</span>`;
        }
    }

    // Identity fields — pre-fill from TIMS data
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el && val) el.placeholder = val;
    };
    setVal('editor-nickname', t.nickname);
    setVal('editor-org', t.school_name);
    setVal('editor-location', [t.city, t.state_prov].filter(Boolean).join(', '));
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

    // Activate requested tab
    _switchEditorTab(_editorTab);
}

function closeEditor() {
    const overlay = document.getElementById('editor-overlay');
    if (!overlay || overlay.classList.contains('hidden')) return;
    overlay.classList.add('hidden');
    document.body.style.overflow = '';
    _editorTeam = null;
    _hideCtxMenu();
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
}

// ── Form reset ─────────────────────────────────────────────
function _resetEditorForm() {
    // Identity fields
    ['editor-nickname', 'editor-pronunciation', 'editor-location',
     'editor-org', 'editor-robot-name', 'editor-motto',
     'editor-sponsors'].forEach(id => {
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

// ═══════════════════════════════════════════════════════════
// SAVE / RESET
// ═══════════════════════════════════════════════════════════

async function saveOverrideData(teamNumber, payload) {
    // TODO: POST to backend endpoint
    console.info('[Editor] Save override for team', teamNumber, payload);
    // Placeholder — will wire to /api/tims/overrides/{team} in next phase
    return { success: true };
}

function _gatherEditorPayload() {
    return {
        // Tab 1: Identity
        nickname:       document.getElementById('editor-nickname')?.value.trim() || '',
        organization:   document.getElementById('editor-org')?.value.trim() || '',
        location:       document.getElementById('editor-location')?.value.trim() || '',
        robot_name:     document.getElementById('editor-robot-name')?.value.trim() || '',
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
    }
}

function _handleEditorReset() {
    _resetEditorForm();
    // Re-populate from TIMS data
    if (_editorTeam) _populateEditorFromTIMS(_editorTeam);
}

// ═══════════════════════════════════════════════════════════
// CUSTOM CONTEXT MENU
// ═══════════════════════════════════════════════════════════

let _ctxTeamNumber = null;

function _hideCtxMenu() {
    const menu = document.getElementById('team-ctx-menu');
    if (!menu || menu.classList.contains('hidden')) return;
    menu.classList.add('ctx-out');
    menu.addEventListener('animationend', () => {
        menu.classList.add('hidden');
        menu.classList.remove('ctx-out');
    }, { once: true });
    _ctxTeamNumber = null;
}

function _showCtxMenu(x, y, teamNumber) {
    _ctxTeamNumber = teamNumber;
    const menu = document.getElementById('team-ctx-menu');
    if (!menu) return;

    // Set the team number label in the menu header
    const label = menu.querySelector('.ctx-team-label');
    if (label) label.textContent = `Team ${teamNumber}`;

    // Auth-gate the edit options
    const editItems = menu.querySelectorAll('[data-ctx-auth]');
    editItems.forEach(el => {
        el.classList.toggle('ctx-disabled', window.isGuest);
    });

    menu.classList.remove('hidden', 'ctx-out');

    // Position at cursor, clamped to viewport
    requestAnimationFrame(() => {
        const rect = menu.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let left = x;
        let top = y;
        if (left + rect.width > vw - 8) left = vw - rect.width - 8;
        if (top + rect.height > vh - 8) top = vh - rect.height - 8;
        if (left < 8) left = 8;
        if (top < 8)  top = 8;
        menu.style.left = left + 'px';
        menu.style.top  = top + 'px';
    });
}

function _handleCtxAction(action) {
    const num = _ctxTeamNumber;
    _hideCtxMenu();
    if (!num) return;

    if (action === 'lookup') {
        floatLookupQuick(num);
    } else if (action === 'matches') {
        // Use compare-bar single-team match history
        const key = (typeof isFTCMode === 'function' && isFTCMode()) ? 'ftc' + num : 'frc' + num;
        compareSelection.clear();
        compareSelection.add(key);
        launchMatchHistoryFromSelection();
    } else if (action === 'edit-identity') {
        openEditor(num, 'identity');
    } else if (action === 'edit-hardware') {
        openEditor(num, 'hardware');
    } else if (action === 'edit-playstyle') {
        openEditor(num, 'playstyle');
    }
}

// ── Context menu on team numbers + full ranking rows ───────
const _CTX_SELECTORS = [
    '.team-num', '.adv-team-num', '.pbp-team-number', '.top-team-num',
    '.high-score-team', '.summary-hof-num', '.prestige-entry-num',
    '.conn-team-num', '.rp-team-num', '.shs-team-num',
    '.bkt-team-num', '.spotlight-team-num'
];

function _extractTeamNumber(el) {
    // Try from team-num-type element first
    const numEl = el.closest(_CTX_SELECTORS.join(','));
    if (numEl) {
        const n = parseInt(numEl.childNodes[0]?.textContent?.trim() || numEl.textContent.trim(), 10);
        if (n > 0 && n < 100000) return n;
    }
    // Try from ranking row (tr[data-team-key] or .rank-card[data-team-key])
    const row = el.closest('tr[data-team-key], .rank-card[data-team-key]');
    if (row) {
        const key = row.dataset.teamKey;
        const n = parseInt((key || '').replace(/^(frc|ftc)/, ''), 10);
        if (n > 0 && n < 100000) return n;
    }
    return null;
}

document.addEventListener('contextmenu', e => {
    // Check: is the target within a team number element OR a ranking row?
    const isTeamEl = e.target.closest(_CTX_SELECTORS.join(','));
    const isRankRow = e.target.closest('tr[data-team-key], .rank-card[data-team-key]');
    if (!isTeamEl && !isRankRow) return;

    const num = _extractTeamNumber(e.target);
    if (!num) return;

    e.preventDefault();
    _showCtxMenu(e.clientX, e.clientY, num);
});

// Close context menu on any click or Escape
document.addEventListener('click', e => {
    if (!e.target.closest('#team-ctx-menu')) _hideCtxMenu();
});
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        const editorOpen = !document.getElementById('editor-overlay')?.classList.contains('hidden');
        const ctxOpen    = !document.getElementById('team-ctx-menu')?.classList.contains('hidden');
        if (ctxOpen) { _hideCtxMenu(); return; }
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
