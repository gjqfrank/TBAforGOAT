/* ═══════════════════════════════════════════════════════════
   goatscout.js — GoatScout data tab (admin-only)
   ═══════════════════════════════════════════════════════════ */

const GOATSCOUT_ADMIN_EMAIL = 'gjqfrank@163.com';

const GOATSCOUT_METRIC_GROUPS = [
    { label: 'Meta', metrics: ['sessions'] },
    { label: 'Pre-Scout', metrics: [
        '状态', '照片', '车高', '最大容量', 'Shooter',
        '过坡', 'Hood', 'Intake', '自动爬升', '手动爬升',
        '自动', '过 trench', '更新',
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

function isGoatScoutAdmin() {
    const user = (typeof Auth !== 'undefined') ? Auth.getUser() : null;
    if (!user) return false;
    // Grant access to the original hardcoded admin email OR any user whose
    // JWT user_metadata.role is 'admin'. To add a new GoatScout editor,
    // set role='admin' on their Supabase user (Authentication → Users →
    // edit user → user_metadata: {"role":"admin","name":"..."}).
    return user.email === GOATSCOUT_ADMIN_EMAIL
        || user.user_metadata?.role === 'admin';
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
            <input type="file" id="gs-file-input" accept=".csv" style="display:none" />
            <span id="gs-status" class="gs-status"></span>
        </div>
        <div id="gs-content"></div>
    `;

    document.getElementById('gs-import-btn').addEventListener('click', () => {
        document.getElementById('gs-file-input').click();
    });
    document.getElementById('gs-file-input').addEventListener('change', handleGoatScoutCsvImport);
    document.getElementById('gs-edit-toggle').addEventListener('click', () => {
        _goatscoutEditMode = !_goatscoutEditMode;
        const btn = document.getElementById('gs-edit-toggle');
        btn.classList.toggle('gs-btn-active', _goatscoutEditMode);
        btn.textContent = _goatscoutEditMode ? 'Exit Edit' : 'Edit Mode';
        document.getElementById('gs-add-team-btn').style.display = _goatscoutEditMode ? '' : 'none';
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
        renderGoatScoutTable();
        if (status) status.textContent = `${_goatscoutData.length} teams`;
    } catch (e) {
        if (status) status.textContent = `Error: ${e.message}`;
        _goatscoutData = [];
        renderGoatScoutTable();
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

function renderGoatScoutTable() {
    const content = document.getElementById('gs-content');
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
    GOATSCOUT_METRIC_GROUPS.forEach(group => {
        const metaCls = group.label === 'Meta' ? 'gs-meta-sticky' : '';
        html += `<th class="gs-group-head ${metaCls}" colspan="${group.metrics.length}">${group.label}</th>`;
    });
    if (_goatscoutEditMode) {
        html += '<th class="gs-add-col" rowspan="2">+</th>';
    }
    html += '</tr>';
    html += '<tr>';
    GOATSCOUT_METRIC_GROUPS.forEach(group => {
        const metaCls = group.label === 'Meta' ? 'gs-meta-sticky' : '';
        group.metrics.forEach(m => {
            const isActive = _gsSortMetric === m;
            const arrow = isActive ? (_gsSortDir === 'asc' ? ' \u2191' : ' \u2193') : '';
            const sortCls = !_goatscoutEditMode ? 'gs-sortable' : '';
            const activeCls = isActive ? 'gs-sort-active' : '';
            html += `<th class="gs-metric-col ${sortCls} ${activeCls} ${metaCls}" ${!_goatscoutEditMode ? `data-sort="${m}"` : ''} title="${m}">${m}${arrow}</th>`;
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
        GOATSCOUT_METRIC_GROUPS.forEach(group => {
            const metaCls = group.label === 'Meta' ? 'gs-meta-sticky' : '';
            group.metrics.forEach(m => {
                const val = (entry.metrics || {})[m] ?? '';
                if (_goatscoutEditMode) {
                    html += `<td class="gs-cell-edit ${metaCls}"><input type="text" data-team="${entry.team_key}" data-metric="${m}" value="${_esc(val)}" /></td>`;
                } else {
                    const display = val ? _esc(val) : '<span class="gs-empty-val">\u2014</span>';
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
    const inputs = document.querySelectorAll('.gs-table input[data-team]');
    const byTeam = {};
    inputs.forEach(inp => {
        const tk = inp.dataset.team;
        if (!byTeam[tk]) byTeam[tk] = {};
        byTeam[tk][inp.dataset.metric] = inp.value;
    });

    const status = document.getElementById('gs-status');
    if (status) status.textContent = 'Saving…';

    let saved = 0;
    let errors = 0;
    const user = Auth.getUser();
    const deviceId = localStorage.getItem('casters_device_id') || 'web';
    const authorName = user?.user_metadata?.name || user?.email || 'Unknown';

    for (const [teamKey, metrics] of Object.entries(byTeam)) {
        try {
            await API.goatscoutPut(currentEvent, teamKey, {
                metrics,
                author_device_id: deviceId,
                author_name: authorName,
            });
            const entry = _goatscoutData.find(d => d.team_key === teamKey);
            if (entry) entry.metrics = metrics;
            saved++;
        } catch (e) {
            errors++;
        }
    }

    if (status) status.textContent = `Saved ${saved} teams${errors ? `, ${errors} errors` : ''}`;
    _goatscoutEditMode = false;
    const btn = document.getElementById('gs-edit-toggle');
    if (btn) {
        btn.classList.toggle('gs-btn-active', false);
        btn.textContent = 'Edit Mode';
    }
    const addBtn = document.getElementById('gs-add-team-btn');
    if (addBtn) addBtn.style.display = 'none';
    await loadGoatScoutData();
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
