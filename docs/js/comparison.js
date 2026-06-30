/* ═══════════════════════════════════════════════════════════
   comparison.js — extracted from app.js

   Loaded as a classic <script> *before* app.js. Top-level
   declarations live in the shared global declarative
   environment, so cross-file references work as before.
   Section: 8. TEAM COMPARISON
   ═══════════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════════════
// 8. TEAM COMPARISON
// ═══════════════════════════════════════════════════════════

var compareSelection = new Set();  // var: referenced by event_select.js / editor.js (loaded before this file)


// ── Open / Close ───────────────────────────────────────────
function openCompare() {
    show('compare-overlay');
    document.body.style.overflow = 'hidden';
}

function closeCompare() {
    hide('compare-overlay');
    document.body.style.overflow = '';
    // Clear compare from URL
    const params = new URLSearchParams(location.search);
    if (params.has('compare')) {
        params.delete('compare');
        const qs = params.toString();
        history.replaceState(null, '', `${location.pathname}${qs ? '?' + qs : ''}${location.hash}`);
    }
}

// Close on Escape (Q handled by its own dedicated handler below)
document.addEventListener('keydown', e => {
    const isEsc = e.key === 'Escape';
    if (!isEsc) return;

    if (compareSelection.size > 0) {
        // Also close the lookup overlay if it's open (from ranking selection)
        if (!$('lookup-overlay')?.classList.contains('hidden')) {
            closeLookup();
        }
        clearCompareSelection();
        return;
    }
    if (_spotlightTeam != null) {
        closeSpotlight();
        return;
    }
    // Close floating lookup panel if open
    if (!$('float-lookup')?.classList.contains('hidden')) {
        closeFloatingLookup();
        return;
    }
    if (!$('match-history-overlay')?.classList.contains('hidden')) {
        closeMatchHistory();
        return;
    }
    if (!$('lookup-overlay')?.classList.contains('hidden')) {
        closeLookup();
        return;
    }
    if (!$('compare-overlay')?.classList.contains('hidden')) {
        closeCompare();
        return;
    }
});

// ── Auto-compare from PBP match ────────────────────────────
var _pendingBdIndex = null;  // var: read by app.js / breakdown.js

function goToBreakdownFromPbp() {
    if (!pbpData || !pbpData.matches.length) return;
    // Save desired index before the tab handler potentially resets bdIndex
    _pendingBdIndex = pbpIndex;
    bdIndex = pbpIndex;
    // Navigate to breakdown tab
    const tabBtn = document.querySelector('.tab[data-tab="breakdown"]');
    if (tabBtn) tabBtn.click();
}

async function compareCurrentMatch() {
    if (!pbpData || !pbpData.matches.length || !currentEvent) return;
    const m = pbpData.matches[pbpIndex];
    const redKeys = m.red.teams.map(t => t.team_key);
    const blueKeys = m.blue.teams.map(t => t.team_key);
    const allKeys = [...redKeys, ...blueKeys];

    const isMob = window.innerWidth <= 768;
    if (isMob) {
        openMobUtilPanel('compare');
        const body = document.getElementById('mob-util-body');
        if (body) body.innerHTML = '<div id="compare-body" class="mob-compare-body"><p class="loading-msg">Loading\u2026</p></div>';
    } else {
        openCompare();
        $('compare-body').innerHTML = '<p class="loading-msg">Fetching comparison data\u2026</p>';
        $('compare-title').textContent = `Match Comparison: ${m.label}`;
    }

    try {
        const data = await API.compareTeams(currentEvent, allKeys);
        renderComparison(data, { redKeys, blueKeys, matchLabel: m.label });
    } catch {
        // Fallback: build comparison data from PBP team objects
        const fallbackTeams = allKeys.map(tk => {
            const t = [...m.red.teams, ...m.blue.teams].find(x => x.team_key === tk) || {};
            return {
                team_key: tk,
                team_number: t.team_number || parseInt(tk.replace('frc', '')),
                nickname: t.nickname || '',
                city: t.city || '',
                state_prov: t.state_prov || '',
                country: t.country || '',
                rank: t.rank || '-',
                wins: t.wins || 0,
                losses: t.losses || 0,
                ties: t.ties || 0,
                opr: t.opr || 0,
                epa: t.epa ?? null,
                avg_rp: t.avg_rp || 0,
                qual_average: t.qual_average || 0,
                high_score: t.high_score || 0,
                matches_played: 0,
            };
        });
        renderComparison(
            { event_key: currentEvent, teams: fallbackTeams },
            { redKeys, blueKeys, matchLabel: m.label }
        );
    }
}

// ── Compare from rankings selection ────────────────────────

// Clicking anywhere on a rankings row toggles comparison selection
document.addEventListener('click', (e) => {
    const tr = e.target.closest('.data-table tbody tr');
    if (!tr) return;
    // Don't double-fire on the checkbox itself
    if (e.target.closest('.compare-cb')) return;
    const cb = tr.querySelector('.compare-cb');
    if (cb) {
        toggleCompareTeam(cb.dataset.team);
    }
});

function toggleCompareTeam(teamKey) {
    if (compareSelection.has(teamKey)) {
        compareSelection.delete(teamKey);
    } else {
        if (compareSelection.size >= 6) return;  // max 6
        compareSelection.add(teamKey);
    }
    updateCompareBar();
    updateCompareCheckboxes();
}

function updateCompareBar() {
    const n = compareSelection.size;
    if (n > 0) {
        show('compare-bar');
        $('compare-bar-count').textContent = `${n} team${n > 1 ? 's' : ''} selected`;
        // Show Lookup and Match History buttons only when exactly 1 team is selected
        const lkBtn = $('compare-bar-lookup');
        if (lkBtn) { n === 1 ? show('compare-bar-lookup') : hide('compare-bar-lookup'); }
        const mhBtn = $('compare-bar-match-history');
        if (mhBtn) { n === 1 ? show('compare-bar-match-history') : hide('compare-bar-match-history'); }
        // Edit Details: show when exactly 1 team selected and user is authenticated
        const edBtn = $('compare-bar-edit');
        if (edBtn) { (n === 1 && !window.isGuest) ? show('compare-bar-edit') : hide('compare-bar-edit'); }
        // Compare: show when 2+ teams selected
        const cmpBtn = $('compare-bar-compare');
        if (cmpBtn) { n >= 2 ? show('compare-bar-compare') : hide('compare-bar-compare'); }
    } else {
        hide('compare-bar');
    }
}

function updateCompareCheckboxes() {
    document.querySelectorAll('.compare-cb').forEach(cb => {
        cb.checked = compareSelection.has(cb.dataset.team);
    });
}

function clearCompareSelection() {
    compareSelection.clear();
    updateCompareBar();
    updateCompareCheckboxes();
}

async function launchCompareFromSelection() {
    if (compareSelection.size < 2 || !currentEvent) return;
    const keys = [...compareSelection];
    await showComparison(keys, {});
}

// ── Team lookup from rankings selection ────────────────────
function openLookup() {
    show('lookup-overlay');
    document.body.style.overflow = 'hidden';
}

function closeLookup() {
    hide('lookup-overlay');
    document.body.style.overflow = '';
}

async function launchLookupFromSelection() {
    if (compareSelection.size !== 1) return;
    const teamKey = [...compareSelection][0];
    const num = parseInt(teamKey.replace(/^frc/, ''), 10);
    if (!num) return;

    openLookup();
    $('lookup-title').textContent = `Team Lookup · ${num}`;
    $('lookup-body').innerHTML = '<p class="loading-msg">Loading team data\u2026</p>';

    try {
        const data = await API.teamStats(num, null);
        $('lookup-body').innerHTML = renderTeamStats(data);
    } catch (err) {
        $('lookup-body').innerHTML = `<p class="empty">Error: ${err.message}</p>`;
    }
}

// ── Keyboard shortcuts on Rankings tab ─────────────────────
document.addEventListener('keydown', e => {
    // Skip if user is typing in an input / textarea / select
    if (e.target.matches('input, textarea, select')) return;
    // Only active on the Rankings tab
    if (!$('tab-rankings')?.classList.contains('active')) return;

    if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey) {
        // Toggle: close if already open
        if (!$('compare-overlay')?.classList.contains('hidden')) {
            e.preventDefault();
            closeCompare();
            return;
        }
        // Skip if lookup overlay is open or no teams selected
        if (!$('lookup-overlay')?.classList.contains('hidden')) return;
        if (compareSelection.size === 0) return;
        e.preventDefault();
        launchCompareFromSelection();
    }
    if ((e.key === 'l' || e.key === 'L') && !e.ctrlKey && !e.metaKey) {
        if (compareSelection.size === 1) {
            e.preventDefault();
            launchLookupFromSelection();
        }
    }
    if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey) {
        // Toggle: close if already open
        if (!$('match-history-overlay')?.classList.contains('hidden')) {
            e.preventDefault();
            closeMatchHistory();
            return;
        }
        if (compareSelection.size === 1) {
            e.preventDefault();
            launchMatchHistoryFromSelection();
        }
    }
    if ((e.key === 'e' || e.key === 'E') && !e.ctrlKey && !e.metaKey) {
        // Toggle: close if already open
        if (!$('editor-overlay')?.classList.contains('hidden')) {
            e.preventDefault();
            closeEditor();
            return;
        }
        if (compareSelection.size === 1 && !window.isGuest) {
            e.preventDefault();
            launchEditorFromSelection();
        }
    }
});

