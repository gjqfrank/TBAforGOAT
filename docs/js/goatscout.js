/* ═══════════════════════════════════════════════════════════
   goatscout.js — GoatScout data tab (admin-only)
   ═══════════════════════════════════════════════════════════ */

const GOATSCOUT_ADMIN_EMAIL = 'gjqfrank@163.com';

// Metrics rendered as a <select> dropdown in edit mode (key = metric name,
// value = list of options). Anything not listed here uses a free-text input.
const GOATSCOUT_SELECT_METRICS = {
    robot_type: [
        '1690', '4414', '1323', '1678', '1114', '254', '2910', '118',
        '7769', '9483', '6766', 'kitbot', '6907（正赛）', '9084',
        '8044', '2231', 'other',
    ],
};

// Metrics that are auto-computed and must not be edited by hand.
// `initial_epa` is derived from `robot_type` (EPA from Statbotics) ×
// `copy_accuracy` and is updated whenever either input changes.
const GOATSCOUT_READONLY_METRICS = new Set(['initial_epa']);

// Hardcoded EPA fallback for robot_type teams.
// Used when Statbotics API is unavailable (returns 500 or times out).
// Values sourced from statbotics.io on 2026-07-19.
// To refresh: visit statbotics.io, look up each team's EPA, update here.
const _GS_EPA_FALLBACK = {
    1690: 295.4,
    4414: 356.9,
    254: 328.1,
    7769: 311.6,
    1323: 310.0,
    2056: 302.2,
    27: 295.1,
    1114: 287.6,
    1678: 278.2,
    118: 182.4,
    9483: 261.3,
    6766: 111.5,
    6907: 133.1,
    9084: 133.5,
    8044: 256.5,
    2231: 233.0,
};

const GOATSCOUT_METRIC_GROUPS = [
    { label: 'Meta', metrics: ['sessions'] },
    { label: 'Pre-Scout', metrics: [
        '状态', 'robot_type', '照片', '车高', '最大容量', 'Shooter',
        '过坡', 'Hood', 'Intake', '自动爬升', '手动爬升',
        '自动', '过 trench', '更新',
        'copy_accuracy', 'initial_epa',
    ]},
    { label: 'Start Position', metrics: [
        'start_trenchFront', 'start_trenchRide', 'start_trenchBack',
        'start_bumpFront', 'start_hub',
        'sameSideStartRate', 'oppositeSideStartRate',
        'start_ds1_left', 'start_ds1_right', 'start_ds2_left',
        'start_ds2_right', 'start_ds3_left', 'start_ds3_right',
    ]},
    { label: 'Auto Movement', metrics: [
        'centerlineTrips', 'firstTouchTime', 'secondTouchTime',
        'firstTouchMedian', 'secondTouchMedian',
    ]},
    { label: 'Cut Preference', metrics: [
        'firstCutEdgeRate', 'firstCutCornerRate', 'firstCutMiddleRate',
        'secondCutNormalRate', 'secondCutCenterRate',
    ]},
    { label: 'Preload', metrics: ['preloadScore'] },
    { label: 'Climb / Park', metrics: [
        'climbAttemptRate', 'noClimbRate', 'autoClimbRate',
        'climbLaneLeftRate', 'climbLaneMiddleRate', 'climbLaneRightRate',
        'parkWallRate', 'parkHomeRate', 'parkMidRate', 'noShowRate',
    ]},
    { label: 'Shooting', metrics: [
        'shootCornerRate', 'shootFenceRate', 'shootWallRate', 'shootBermBackRate',
        'shootClimbFrameRate', 'shootHubRate', 'shootAnywhereRate',
        'undefendedShotAccuracyMedian', 'defendedShotAccuracyMedian',
        'activeShotShare', 'activeShotAccuracy',
    ]},
    { label: 'Intake / Passing', metrics: [
        'intakeHomeRate', 'intakeMidfieldRate', 'intakeOpponentRate',
        'passOpponentMedian', 'passMidfieldMedian',
    ]},
    { label: 'Defense', metrics: [
        'homeScreenMedian', 'pushHomeMedian', 'routeBlockMedian', 'shotCrashMedian',
    ]},
];

let _goatscoutData = [];
let _goatscoutEditMode = false;

// Cache of team_number → current EPA (from Statbotics via /teams/batch-epa).
// Populated in loadGoatScoutData() for every distinct robot_type team.
let _gsEpaCache = {};

// Extract the team number from a robot_type value.
// '1690' → 1690, '6907（正赛）' → 6907, 'kitbot' / 'other' → null.
function _robotTypeTeamNumber(robotType) {
    if (!robotType) return null;
    const m = String(robotType).match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
}

// Compute initial_epa = robotType's EPA × copy_accuracy.
// Returns null if either input is missing/invalid.
// Handles copy_accuracy in two formats: "70" (decimal 0.70) or "70%" (percent).
function _computeInitialEpa(robotType, copyAccuracy, epaCache) {
    const teamNum = _robotTypeTeamNumber(robotType);
    if (!teamNum) return null;
    const epa = epaCache[teamNum];
    if (epa == null) return null;
    const s = String(copyAccuracy ?? '').trim();
    if (!s) return null;
    // Accept "70%" (percent) or "70" (treated as percent too, to match user input).
    const m = s.match(/^(\d+(?:\.\d+)?)%?$/);
    if (!m) return null;
    const pct = parseFloat(m[1]);
    if (isNaN(pct)) return null;
    return Math.round(epa * pct / 100 * 100) / 100;
}

function isGoatScoutAdmin() {
    const user = (typeof Auth !== 'undefined') ? Auth.getUser() : null;
    if (!user) return false;
    // Grant access to the original hardcoded admin email, OR any user whose
    // JWT user_metadata.role is 'admin' or 'scouter'.
    //   - admin:   full access (also sees account_requests, profiles, etc.)
    //   - scouter: can view/edit GoatScout only (no other admin RLS grants)
    // To add a new GoatScout editor: create the user in Supabase Dashboard →
    // Authentication → Users → Add user, set user_metadata to
    // {"role":"scouter","name":"<name>"} (or "admin" for full access).
    const role = user.user_metadata?.role;
    return user.email === GOATSCOUT_ADMIN_EMAIL
        || role === 'admin'
        || role === 'scouter';
}

function shouldShowGoatScoutTab() {
    return isGoatScoutAdmin() && currentEvent;
}

async function renderGoatScoutTab() {
    const container = document.getElementById('goatscout-container');
    if (!container) return;

    if (!isGoatScoutAdmin()) {
        container.innerHTML = '<p class="goatscout-empty">GoatScout is admin-only.</p>';
        return;
    }

    if (!currentEvent) {
        container.innerHTML = '<p class="goatscout-empty">Load an event first.</p>';
        return;
    }

    container.innerHTML = `
        <div class="goatscout-toolbar">
            <button id="gs-import-btn" class="gs-btn gs-btn-primary">Import CSV</button>
            <button id="gs-edit-toggle" class="gs-btn">Edit Mode</button>
            <button id="gs-add-team-btn" class="gs-btn" style="display:none">+ Add Team</button>
            <button id="gs-add-col-btn" class="gs-btn" style="display:none">+ Add Column</button>
            <input type="file" id="gs-file-input" accept=".csv" style="display:none" />
            <span id="gs-status" class="gs-status"></span>
        </div>
        <div id="gs-content"></div>
    `;

    document.getElementById('gs-import-btn').addEventListener('click', () => {
        document.getElementById('gs-file-input').click();
    });
    document.getElementById('gs-file-input').addEventListener('change', handleGoatScoutCsvImport);
    document.getElementById('gs-add-col-btn').addEventListener('click', handleAddMetricColumn);
    document.getElementById('gs-edit-toggle').addEventListener('click', () => {
        _goatscoutEditMode = !_goatscoutEditMode;
        const btn = document.getElementById('gs-edit-toggle');
        btn.classList.toggle('gs-btn-active', _goatscoutEditMode);
        btn.textContent = _goatscoutEditMode ? 'Exit Edit' : 'Edit Mode';
        document.getElementById('gs-add-team-btn').style.display = _goatscoutEditMode ? '' : 'none';
        document.getElementById('gs-add-col-btn').style.display = _goatscoutEditMode ? '' : 'none';
        renderGoatScoutTable();
    });
    document.getElementById('gs-add-team-btn').addEventListener('click', handleAddTeamColumn);

    await loadGoatScoutData();
}

async function loadGoatScoutData() {
    const status = document.getElementById('gs-status');
    if (status) status.textContent = 'Loading…';
    try {
        _goatscoutData = await API.goatscoutList(currentEvent);
        // Pre-fetch EPA for every team referenced by a robot_type value so
        // that initial_epa can be auto-computed in the render path.
        await _refreshEpaCache();
        renderGoatScoutTable();
        if (status) status.textContent = `${_goatscoutData.length} teams`;
    } catch (e) {
        if (status) status.textContent = `Error: ${e.message}`;
        _goatscoutData = [];
        renderGoatScoutTable();
    }
}

// Build a list of distinct team numbers from every row's robot_type and
// fetch their EPA from Statbotics (via backend proxy). Also tops up the
// cache with any team numbers added in edit mode without a full reload.
// Falls back to hardcoded _GS_EPA_FALLBACK when Statbotics API is down.
async function _refreshEpaCache(extraTeamNums) {
    const nums = new Set(extraTeamNums || []);
    for (const row of _goatscoutData) {
        const n = _robotTypeTeamNumber((row.metrics || {}).robot_type);
        if (n) nums.add(n);
    }
    if (!nums.size) return;
    // Skip team numbers we already have cached (from live API or fallback).
    const missing = [...nums].filter(n => _gsEpaCache[n] == null);
    if (!missing.length) return;
    // Try backend proxy first (fetches live EPA from Statbotics).
    try {
        const map = await API.batchEpa(missing, 2026);
        if (map) {
            for (const [k, v] of Object.entries(map)) {
                _gsEpaCache[parseInt(k, 10)] = v;
            }
        }
    } catch (e) {
        // Non-fatal: fall through to hardcoded fallback below.
    }
    // Fill in any remaining gaps with hardcoded fallback values so
    // initial_epa shows a number even when Statbotics API is unavailable.
    for (const n of missing) {
        if (_gsEpaCache[n] == null && _GS_EPA_FALLBACK[n] != null) {
            _gsEpaCache[n] = _GS_EPA_FALLBACK[n];
        }
    }
}

function _parseGsVal(val) {
    if (val === '' || val === undefined || val === null) return null;
    const s = String(val).trim();
    let m = s.match(/^(\d+\.?\d*)%$/);
    if (m) return { type: 'percent', num: parseFloat(m[1]), raw: s };
    m = s.match(/^(\d+\.?\d*)s$/);
    if (m) return { type: 'time', num: parseFloat(m[1]), raw: s };
    if (/^-?\d+\.?\d*$/.test(s)) return { type: 'number', num: parseFloat(s), raw: s };
    return { type: 'text', num: null, raw: s };
}

let _gsSortMetric = null;
let _gsSortDir = 'desc';

function _gsSortedTeams() {
    const teams = [..._goatscoutData];
    if (!_gsSortMetric) {
        teams.sort((a, b) => parseInt(a.team_key.replace('frc','')) - parseInt(b.team_key.replace('frc','')));
        return teams;
    }
    teams.sort((a, b) => {
        const pa = _parseGsVal((a.metrics || {})[_gsSortMetric] ?? '');
        const pb = _parseGsVal((b.metrics || {})[_gsSortMetric] ?? '');
        const na = pa?.num, nb = pb?.num;
        if (na === null || na === undefined) return 1;
        if (nb === null || nb === undefined) return -1;
        return _gsSortDir === 'asc' ? na - nb : nb - na;
    });
    return teams;
}

function renderGoatScoutTable(containerId = 'gs-content') {
    const content = document.getElementById(containerId);
    if (!content) return;

    if (!_goatscoutData.length) {
        content.innerHTML = '<p class="goatscout-empty">No GoatScout data yet. Import a CSV or click Edit Mode to add teams manually.</p>';
        return;
    }

    const sorted = _goatscoutEditMode ? [..._goatscoutData].sort((a, b) => {
        return parseInt(a.team_key.replace('frc','')) - parseInt(b.team_key.replace('frc',''));
    }) : _gsSortedTeams();

    let html = '<div class="gs-table-wrap"><table class="gs-table">';

    // ── Header: two rows (group names + metric names) ──
    html += '<thead>';
    html += '<tr>';
    html += '<th class="gs-sticky-col gs-team-head" rowspan="2">Team</th>';
    _effectiveMetricGroups().forEach(group => {
        const metaCls = group.label === 'Meta' ? 'gs-meta-sticky' : '';
        html += `<th class="gs-group-head ${metaCls}" colspan="${group.metrics.length}">${group.label}</th>`;
    });
    if (_goatscoutEditMode) {
        html += '<th class="gs-add-col" rowspan="2" id="gs-add-col-trigger" title="Add column">+</th>';
    }
    html += '</tr>';
    html += '<tr>';
    _effectiveMetricGroups().forEach(group => {
        const metaCls = group.label === 'Meta' ? 'gs-meta-sticky' : '';
        const isCustom = group.label === 'Custom';
        group.metrics.forEach(m => {
            const isActive = _gsSortMetric === m;
            const arrow = isActive ? (_gsSortDir === 'asc' ? ' \u2191' : ' \u2193') : '';
            const sortCls = !_goatscoutEditMode ? 'gs-sortable' : '';
            const activeCls = isActive ? 'gs-sort-active' : '';
            const rmBtn = (_goatscoutEditMode && isCustom)
                ? `<span class="gs-remove-col" data-remove-metric="${_esc(m)}" title="Remove column">\u00d7</span>`
                : '';
            html += `<th class="gs-metric-col ${sortCls} ${activeCls} ${metaCls}" ${!_goatscoutEditMode ? `data-sort="${m}"` : ''} title="${m}">${_esc(m)}${arrow}${rmBtn}</th>`;
        });
    });
    html += '</tr>';
    html += '</thead><tbody>';

    // ── Team rows ──
    sorted.forEach((entry, idx) => {
        const num = entry.team_key.replace('frc', '');
        const zebra = idx % 2 === 0 ? 'gs-row-even' : 'gs-row-odd';
        html += `<tr class="${zebra}">`;
        if (_goatscoutEditMode) {
            html += `<td class="gs-sticky-col gs-team-name">${num}<span class="gs-remove-team" data-remove="${entry.team_key}" title="Remove">\u00d7</span></td>`;
        } else {
            html += `<td class="gs-sticky-col gs-team-name">${num}</td>`;
        }
        _effectiveMetricGroups().forEach(group => {
            const metaCls = group.label === 'Meta' ? 'gs-meta-sticky' : '';
            group.metrics.forEach(m => {
                // initial_epa is always recomputed from robot_type × copy_accuracy
                // so the displayed value stays in sync with the latest edits.
                let val = (entry.metrics || {})[m] ?? '';
                if (m === 'initial_epa') {
                    const rt = (entry.metrics || {}).robot_type;
                    const ca = (entry.metrics || {}).copy_accuracy;
                    const computed = _computeInitialEpa(rt, ca, _gsEpaCache);
                    if (computed != null) val = String(computed);
                }
                if (_goatscoutEditMode) {
                    if (GOATSCOUT_READONLY_METRICS.has(m)) {
                        // Render as a disabled input so saveAllGoatScout still
                        // picks up its value, but users can't type into it.
                        html += `<td class="gs-cell-edit ${metaCls}"><input type="text" data-team="${entry.team_key}" data-metric="${m}" value="${_esc(val)}" disabled title="自动计算：robot_type EPA × copy_accuracy" /></td>`;
                    } else {
                        const opts = GOATSCOUT_SELECT_METRICS[m];
                        if (opts) {
                            let optHtml = '<option value=""></option>';
                            for (const o of opts) {
                                const sel = (val === o) ? ' selected' : '';
                                optHtml += `<option value="${_esc(o)}"${sel}>${_esc(o)}</option>`;
                            }
                            html += `<td class="gs-cell-edit ${metaCls}"><select data-team="${entry.team_key}" data-metric="${m}">${optHtml}</select></td>`;
                        } else {
                            html += `<td class="gs-cell-edit ${metaCls}"><input type="text" data-team="${entry.team_key}" data-metric="${m}" value="${_esc(val)}" /></td>`;
                        }
                    }
                } else {
                    const display = val !== '' && val != null ? _esc(val) : '<span class="gs-empty-val">\u2014</span>';
                    html += `<td class="gs-cell ${metaCls}">${display}</td>`;
                }
            });
        });
        html += '</tr>';
    });

    html += '</tbody></table></div>';

    if (_goatscoutEditMode) {
        html += '<div class="gs-save-bar"><button id="gs-save-all" class="gs-btn gs-btn-save">Save All Changes</button></div>';
    }

    content.innerHTML = html;

    // Dynamically set header row 1 height so row 2's sticky top offset is exact.
    // NOTE: must measure a non-rowspan cell (a group head), NOT the Team header
    // which has rowspan="2" and would return row1+row2 combined height — that
    // would make the metric-name row stick one row too low.
    const groupHeadCell = content.querySelector('.gs-table thead tr:first-child .gs-group-head');
    if (groupHeadCell) {
        const h = groupHeadCell.offsetHeight;
        const table = content.querySelector('.gs-table');
        if (table) table.style.setProperty('--gs-header-row1-h', h + 'px');
    }

    if (_goatscoutEditMode) {
        const saveBtn = document.getElementById('gs-save-all');
        if (saveBtn) saveBtn.addEventListener('click', saveAllGoatScout);
        content.querySelectorAll('[data-remove]').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const tk = el.dataset.remove;
                _goatscoutData = _goatscoutData.filter(d => d.team_key !== tk);
                renderGoatScoutTable();
            });
        });
        const addColTrigger = document.getElementById('gs-add-col-trigger');
        if (addColTrigger) addColTrigger.addEventListener('click', handleAddMetricColumn);
        content.querySelectorAll('[data-remove-metric]').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                handleRemoveMetricColumn(el.dataset.removeMetric);
            });
        });
        // Live-recompute initial_epa when robot_type or copy_accuracy changes.
        // Doesn't trigger a full re-render — just updates the disabled cell.
        content.querySelectorAll('[data-metric="robot_type"], [data-metric="copy_accuracy"]').forEach(el => {
            el.addEventListener('change', async () => {
                const tk = el.dataset.team;
                // Read the latest values of both inputs in this row.
                const rtEl = content.querySelector(`[data-team="${tk}"][data-metric="robot_type"]`);
                const caEl = content.querySelector(`[data-team="${tk}"][data-metric="copy_accuracy"]`);
                const rt = rtEl?.value || '';
                const ca = caEl?.value || '';
                // If the user picked a robot_type we haven't cached yet,
                // fetch its EPA on demand so the computed value is accurate.
                const newTeam = _robotTypeTeamNumber(rt);
                if (newTeam && _gsEpaCache[newTeam] == null) {
                    await _refreshEpaCache([newTeam]);
                }
                const computed = _computeInitialEpa(rt, ca, _gsEpaCache);
                const epaEl = content.querySelector(`[data-team="${tk}"][data-metric="initial_epa"]`);
                if (epaEl) epaEl.value = computed != null ? computed : '';
            });
        });
    } else {
        content.querySelectorAll('[data-sort]').forEach(el => {
            el.addEventListener('click', () => {
                const metric = el.dataset.sort;
                if (_gsSortMetric === metric) {
                    _gsSortDir = _gsSortDir === 'asc' ? 'desc' : 'asc';
                } else {
                    _gsSortMetric = metric;
                    _gsSortDir = 'desc';
                }
                renderGoatScoutTable();
            });
        });
    }
}

async function saveAllGoatScout() {
    const fields = document.querySelectorAll('.gs-table input[data-team], .gs-table select[data-team]');
    const byTeam = {};
    fields.forEach(f => {
        const tk = f.dataset.team;
        if (!byTeam[tk]) byTeam[tk] = {};
        byTeam[tk][f.dataset.metric] = f.value;
    });

    const status = document.getElementById('gs-status');
    if (status) status.textContent = 'Saving…';

    const user = Auth.getUser();
    const deviceId = localStorage.getItem('casters_device_id') || 'web';
    const authorName = user?.user_metadata?.name || user?.email || 'Unknown';

    // Fire all PUTs in parallel — serial await was the main source of
    // latency on cross-origin (GitHub Pages → HF Space) deployments.
    const entries = Object.entries(byTeam);
    const results = await Promise.allSettled(entries.map(([teamKey, metrics]) =>
        API.goatscoutPut(currentEvent, teamKey, {
            metrics,
            author_device_id: deviceId,
            author_name: authorName,
        }).then(() => {
            const entry = _goatscoutData.find(d => d.team_key === teamKey);
            if (entry) entry.metrics = metrics;
        })
    ));
    const saved = results.filter(r => r.status === 'fulfilled').length;
    const errors = results.length - saved;

    if (status) status.textContent = `Saved ${saved} teams${errors ? `, ${errors} errors` : ''}`;
    _goatscoutEditMode = false;
    const btn = document.getElementById('gs-edit-toggle');
    if (btn) {
        btn.classList.toggle('gs-btn-active', false);
        btn.textContent = 'Edit Mode';
    }
    const addBtn = document.getElementById('gs-add-team-btn');
    if (addBtn) addBtn.style.display = 'none';
    const addColBtn = document.getElementById('gs-add-col-btn');
    if (addColBtn) addColBtn.style.display = 'none';
    // Re-render from the in-memory data we just updated (no reload round-trip),
    // so the "Saved N teams" status text is not clobbered by loadGoatScoutData.
    renderGoatScoutTable();
}

function handleAddTeamColumn() {
    const num = prompt('Enter team number:');
    if (!num || !/^\d+$/.test(num.trim())) return;
    const teamKey = `frc${num.trim()}`;
    if (_goatscoutData.find(d => d.team_key === teamKey)) {
        alert('Team already exists in the table.');
        return;
    }
    _goatscoutData.push({ team_key: teamKey, event_key: currentEvent, metrics: {} });
    renderGoatScoutTable();
}

// ── Dynamic column management ─────────────────────────────
// Custom metrics are stored per-event in localStorage and appended to the
// "Custom" group. They behave like any built-in metric: editable in edit
// mode, saved via saveAllGoatScout, and sortable in view mode.
function _customMetricsKey() {
    return `gs_custom_metrics:${currentEvent || 'global'}`;
}

function _loadCustomMetrics() {
    try {
        const raw = localStorage.getItem(_customMetricsKey());
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}

function _saveCustomMetrics(list) {
    try { localStorage.setItem(_customMetricsKey(), JSON.stringify(list)); } catch {}
}

function _ensureCustomGroup() {
    let g = GOATSCOUT_METRIC_GROUPS.find(x => x.label === 'Custom');
    if (!g) {
        g = { label: 'Custom', metrics: [] };
        GOATSCOUT_METRIC_GROUPS.push(g);
    }
    return g;
}

// Returns the effective metric groups (built-in + custom for this event).
function _effectiveMetricGroups() {
    const custom = _loadCustomMetrics();
    if (custom.length === 0) return GOATSCOUT_METRIC_GROUPS;
    // Build a fresh copy so we don't mutate the constant on every render.
    const groups = GOATSCOUT_METRIC_GROUPS
        .filter(g => g.label !== 'Custom')
        .map(g => ({ label: g.label, metrics: [...g.metrics] }));
    // Filter out custom metrics that already exist in a built-in group.
    // This handles the case where a metric (e.g. copy_accuracy) was promoted
    // to a built-in group but is still saved in localStorage from a prior
    // custom-column addition — we don't want it to show up twice.
    const builtIn = new Set(groups.flatMap(g => g.metrics));
    const dedupedCustom = custom.filter(m => !builtIn.has(m));
    if (dedupedCustom.length > 0) {
        groups.push({ label: 'Custom', metrics: [...dedupedCustom] });
    }
    return groups;
}

function handleAddMetricColumn() {
    const name = prompt('Enter new column (metric) name:');
    if (!name || !name.trim()) return;
    const metric = name.trim();
    // Reject duplicates (across all groups).
    const allMetrics = _effectiveMetricGroups().flatMap(g => g.metrics);
    if (allMetrics.includes(metric)) {
        alert(`Column "${metric}" already exists.`);
        return;
    }
    const custom = _loadCustomMetrics();
    custom.push(metric);
    _saveCustomMetrics(custom);
    _ensureCustomGroup();
    renderGoatScoutTable();
}

function handleRemoveMetricColumn(metric) {
    if (!confirm(`Remove column "${metric}"? Values saved on existing teams are kept in the database but will no longer be shown.`)) return;
    const custom = _loadCustomMetrics().filter(m => m !== metric);
    _saveCustomMetrics(custom);
    renderGoatScoutTable();
}

async function handleGoatScoutCsvImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    const status = document.getElementById('gs-status');
    if (status) status.textContent = 'Parsing CSV…';

    try {
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) throw new Error('CSV too short');

        const header = lines[0].split(',').map(s => s.trim());
        const teamNums = header.slice(1).filter(n => /^\d+$/.test(n));
        const teamKeys = teamNums.map(n => `frc${n}`);

        const teams = teamKeys.map((tk, i) => {
            const metrics = {};
            for (const line of lines.slice(1)) {
                const cols = line.split(',').map(s => s.trim());
                const metricName = cols[0];
                if (!metricName) continue;
                const val = cols[i + 1];
                if (val !== undefined && val !== '') metrics[metricName] = val;
            }
            return { team_key: tk, metrics };
        });

        if (status) status.textContent = `Importing ${teams.length} teams…`;
        const result = await API.goatscoutImport(currentEvent, { teams });
        if (status) status.textContent = `Imported ${result.imported}/${result.total} teams`;
        await loadGoatScoutData();
    } catch (err) {
        if (status) status.textContent = `Import error: ${err.message}`;
    }

    e.target.value = '';
}
