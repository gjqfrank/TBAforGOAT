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

    // Show modal
    document.getElementById('editor-overlay').classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    // Activate requested tab
    _switchEditorTab(_editorTab);

    // TODO: Fetch existing overrides from backend and populate fields
}

function closeEditor() {
    document.getElementById('editor-overlay')?.classList.add('hidden');
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
}

// ═══════════════════════════════════════════════════════════
// CUSTOM CONTEXT MENU
// ═══════════════════════════════════════════════════════════

let _ctxTeamNumber = null;

function _hideCtxMenu() {
    document.getElementById('team-ctx-menu')?.classList.add('hidden');
    _ctxTeamNumber = null;
}

function _showCtxMenu(x, y, teamNumber) {
    _ctxTeamNumber = teamNumber;
    const menu = document.getElementById('team-ctx-menu');
    if (!menu) return;

    // Auth-gate the edit options
    const editItems = menu.querySelectorAll('[data-ctx-auth]');
    editItems.forEach(el => {
        el.classList.toggle('ctx-disabled', window.isGuest);
    });

    menu.classList.remove('hidden');

    // Position at cursor, clamped to viewport
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (left + rect.width > vw - 8) left = vw - rect.width - 8;
    if (top + rect.height > vh - 8) top = vh - rect.height - 8;
    menu.style.left = left + 'px';
    menu.style.top  = top + 'px';
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

// ── Context menu on team numbers ───────────────────────────
const _CTX_SELECTORS = [
    '.team-num', '.adv-team-num', '.pbp-team-number', '.top-team-num',
    '.high-score-team', '.summary-hof-num', '.prestige-entry-num',
    '.conn-team-num', '.rp-team-num', '.shs-team-num',
    '.bkt-team-num', '.spotlight-team-num'
];

document.addEventListener('contextmenu', e => {
    const el = e.target.closest(_CTX_SELECTORS.join(','));
    if (!el) return;

    const num = parseInt(el.childNodes[0]?.textContent?.trim() || el.textContent.trim(), 10);
    if (!num || num <= 0 || num >= 100000) return;

    e.preventDefault();
    _showCtxMenu(e.clientX, e.clientY, num);
});

// Close context menu on any click or Escape
document.addEventListener('click', e => {
    if (!e.target.closest('#team-ctx-menu')) _hideCtxMenu();
});
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        if (!document.getElementById('editor-overlay')?.classList.contains('hidden')) {
            closeEditor();
            return;
        }
        _hideCtxMenu();
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

// ── Keyboard shortcut: E key ───────────────────────────────
document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.key !== 'e' && e.key !== 'E') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // Only when Rankings tab active and exactly 1 team selected
    const rankingsTab = document.getElementById('tab-rankings');
    if (!rankingsTab?.classList.contains('active')) return;
    if (compareSelection.size !== 1) return;

    e.preventDefault();
    launchEditorFromSelection();
});

// ── Wire tag inputs ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    ['editor-hardware-input', 'editor-auto-input', 'editor-teleop-input'].forEach(id => {
        document.getElementById(id)?.addEventListener('keydown', _handleTagKeydown);
    });
});
