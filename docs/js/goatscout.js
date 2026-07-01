/* ═══════════════════════════════════════════════════════════
   goatscout.js — GoatScout data tab (admin-only)
   ═══════════════════════════════════════════════════════════ */

const GOATSCOUT_ADMIN_EMAIL = 'gjqfrank@163.com';

const GOATSCOUT_METRIC_GROUPS = [
    { label: 'Meta', metrics: ['sessions'] },
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
let _goatscoutExpandedTeam = null;

function isGoatScoutAdmin() {
    const user = (typeof Auth !== 'undefined') ? Auth.getUser() : null;
    return user?.email === GOATSCOUT_ADMIN_EMAIL;
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
        document.getElementById('gs-edit-toggle').classList.toggle('gs-btn-active', _goatscoutEditMode);
        document.getElementById('gs-edit-toggle').textContent = _goatscoutEditMode ? 'Exit Edit' : 'Edit Mode';
        renderGoatScoutList();
    });

    await loadGoatScoutData();
}

async function loadGoatScoutData() {
    const status = document.getElementById('gs-status');
    if (status) status.textContent = 'Loading…';
    try {
        _goatscoutData = await API.goatscoutList(currentEvent);
        renderGoatScoutList();
        if (status) status.textContent = `${_goatscoutData.length} teams`;
    } catch (e) {
        if (status) status.textContent = `Error: ${e.message}`;
        _goatscoutData = [];
        renderGoatScoutList();
    }
}

function renderGoatScoutList() {
    const content = document.getElementById('gs-content');
    if (!content) return;

    if (!_goatscoutData.length) {
        content.innerHTML = '<p class="goatscout-empty">No GoatScout data yet. Import a CSV or edit manually.</p>';
        return;
    }

    const rows = _goatscoutData.map(entry => {
        const teamNum = entry.team_key.replace('frc', '');
        const metrics = entry.metrics || {};
        const isExpanded = _goatscoutExpandedTeam === entry.team_key;

        const metricHtml = isExpanded ? GOATSCOUT_METRIC_GROUPS.map(group => {
            const cells = group.metrics.map(m => {
                const val = metrics[m] ?? '';
                if (_goatscoutEditMode) {
                    return `<div class="gs-metric-row"><label>${m}</label><input type="text" data-team="${entry.team_key}" data-metric="${m}" value="${_esc(val)}" /></div>`;
                }
                return `<div class="gs-metric-row"><span class="gs-metric-label">${m}</span><span class="gs-metric-value">${_esc(val) || '—'}</span></div>`;
            }).join('');
            return `<div class="gs-group"><h4>${group.label}</h4>${cells}</div>`;
        }).join('') : '';

        const summary = metrics.sessions ? `${metrics.sessions} sessions` : '';
        const expandedEdit = isExpanded && _goatscoutEditMode
            ? `<button class="gs-btn gs-btn-save" data-save="${entry.team_key}">Save</button>`
            : '';

        return `
            <div class="gs-team-row ${isExpanded ? 'gs-expanded' : ''}" data-team="${entry.team_key}">
                <div class="gs-team-header" data-toggle="${entry.team_key}">
                    <span class="gs-team-num">${teamNum}</span>
                    <span class="gs-team-key">${entry.team_key}</span>
                    <span class="gs-summary">${summary}</span>
                    <span class="gs-chevron">${isExpanded ? '▼' : '▶'}</span>
                </div>
                ${isExpanded ? `<div class="gs-metrics">${metricHtml}${expandedEdit}</div>` : ''}
            </div>
        `;
    }).join('');

    content.innerHTML = `<div class="gs-list">${rows}</div>`;

    content.querySelectorAll('[data-toggle]').forEach(el => {
        el.addEventListener('click', () => {
            const tk = el.dataset.toggle;
            _goatscoutExpandedTeam = _goatscoutExpandedTeam === tk ? null : tk;
            renderGoatScoutList();
        });
    });

    content.querySelectorAll('[data-save]').forEach(el => {
        el.addEventListener('click', async () => {
            const tk = el.dataset.save;
            await saveGoatScoutTeam(tk);
        });
    });
}

async function saveGoatScoutTeam(teamKey) {
    const inputs = document.querySelectorAll(`input[data-team="${teamKey}"]`);
    const metrics = {};
    inputs.forEach(inp => { metrics[inp.dataset.metric] = inp.value; });

    const user = Auth.getUser();
    const body = {
        metrics,
        author_device_id: localStorage.getItem('casters_device_id') || 'web',
        author_name: user?.user_metadata?.name || user?.email || 'Unknown',
    };

    const status = document.getElementById('gs-status');
    if (status) status.textContent = 'Saving…';
    try {
        await API.goatscoutPut(currentEvent, teamKey, body);
        const entry = _goatscoutData.find(d => d.team_key === teamKey);
        if (entry) entry.metrics = metrics;
        else _goatscoutData.push({ team_key: teamKey, event_key: currentEvent, metrics });
        if (status) status.textContent = 'Saved';
        renderGoatScoutList();
    } catch (e) {
        if (status) status.textContent = `Error: ${e.message}`;
    }
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
