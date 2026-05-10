/* ═══════════════════════════════════════════════════════════
   summary.js — extracted from app.js

   Loaded as a classic <script> *before* app.js. Top-level
   declarations live in the shared global declarative
   environment, so cross-file references work as before.
   Section: 1b. EVENT SUMMARY
   ═══════════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════════════
// 1b. EVENT SUMMARY
// ═══════════════════════════════════════════════════════════

// Pre-fetch cache for FTC awards (populated in background during event load)
let _ftcPrefetchedAwards = null;
let _ftcPrefetchedSeasonAwards = null;
let _ftcPrefetchEventKey = null;

async function _ftcPrefetchSummary(code) {
    _ftcPrefetchedAwards = null;
    _ftcPrefetchedSeasonAwards = null;
    _ftcPrefetchEventKey = code;
    try {
        // Fire both slow API calls in parallel
        const [awards, seasonResp] = await Promise.all([
            FTC_API.eventAwards(code).catch(() => null),
            FTC_API.eventSeasonAwards(code).catch(() => null),
        ]);
        if (_ftcPrefetchEventKey !== code) return; // stale
        _ftcPrefetchedAwards = awards;
        _ftcPrefetchedSeasonAwards = (seasonResp && Array.isArray(seasonResp.season_awards))
            ? seasonResp.season_awards : [];
    } catch { /* ignore */ }
}

async function loadSummary() {
    if (!currentEvent) return;
    hide('summary-empty');
    hideInlineError('summary-error');

    // FTC mode: build summary from event teams data (no TBA)
    if (isFTCMode()) {
        // If we have teamsData, build a demographic summary from it
        if (!teamsData || !teamsData.length) {
            showInlineError('summary-error', 'Load an event first to see its summary. Team data is required.');
            return;
        }
        showSkeleton('summary-loading', 'summary-loading-status', 'Analysing FTC event data\u2026');
        try {
            const teams = teamsData;
            const countries = [...new Set(teams.map(t => t.country).filter(Boolean))];
            const eventCtry = (eventInfoData && eventInfoData.country) || (countries.length === 1 ? countries[0] : '');
            const foreignCount = eventCtry ? teams.filter(t => t.country && t.country !== eventCtry).length : 0;
            const rookies = teams.filter(t => t.rookie_year && currentEventYear && t.rookie_year >= currentEventYear);

            const demographics = {
                total_teams: teams.length,
                rookie_count: rookies.length,
                rookie_pct: Math.round((rookies.length / teams.length) * 100),
                veteran_count: teams.length - rookies.length,
                veteran_pct: Math.round(((teams.length - rookies.length) / teams.length) * 100),
                avg_team_age: teams.length > 0
                    ? Math.round(teams.reduce((s, t) => s + ((currentEventYear || 2026) - (t.rookie_year || (currentEventYear || 2026))), 0) / teams.length * 10) / 10
                    : 0,
                foreign_count: foreignCount,
                foreign_pct: Math.round((foreignCount / teams.length) * 100),
                event_country: eventCtry,
                country_count: countries.length,
                countries: countries,
            };
            // ── Build top scorers from OPR ──
            const sorted = [...teams].filter(t => t.opr > 0).sort((a, b) => b.opr - a.opr);
            const top_scorers = sorted.slice(0, 3).map(t => ({
                team_number: t.team_number,
                nickname: t.nickname || `Team ${t.team_number}`,
                opr: t.opr,
                rank: t.rank || '-',
            }));

            // ── Build event high scores from match data ──
            let high_scores = [];
            try {
                setLoadingStatus('summary-loading-status', 'Fetching event high scores…');
                // Use already-loaded PbP matches if available, otherwise fetch fresh
                let eventMatches = (typeof pbpData !== 'undefined' && pbpData && pbpData.matches && pbpData.matches.length)
                    ? pbpData.matches
                    : null;
                if (!eventMatches) {
                    const allData = await FTC_API.allMatches(currentEvent);
                    eventMatches = (allData && Array.isArray(allData.matches)) ? allData.matches : [];
                }
                // Collect all alliance scores, sort descending, take top 10
                const allScores = [];
                for (const m of eventMatches) {
                    const label = m.label || m.match_label || '';
                    for (const side of ['red', 'blue']) {
                        const score = m[side]?.score ?? -1;
                        if (score < 0) continue;
                        allScores.push({
                            score,
                            match: label,
                            color: side,
                            teams: (m[side]?.teams || []).map(t => ({
                                team_number: t.team_number,
                                nickname: t.nickname || '',
                            })),
                        });
                    }
                }
                allScores.sort((a, b) => b.score - a.score);
                high_scores = allScores.slice(0, 10);
            } catch (e) {
                console.warn('[FTC Summary] Could not build event high scores:', e);
            }

            // ── Fetch awards for Inspire winners ──
            let inspire_finalists = [];
            let champMap = new Map();
            try {
                setLoadingStatus('summary-loading-status', 'Fetching event awards\u2026');
                // Use pre-fetched data if available (from _ftcPrefetchSummary), or fetch fresh
                const awards = (_ftcPrefetchEventKey === currentEvent && _ftcPrefetchedAwards != null)
                    ? _ftcPrefetchedAwards
                    : await FTC_API.eventAwards(currentEvent);
                if (Array.isArray(awards)) {
                    // Inspire Award (awardId varies, match by name)
                    const inspireAwards = awards.filter(a =>
                        a.name && /inspire/i.test(a.name) && a.team_number
                    );
                    // Winner / Finalist awards
                    const winnerAwards = awards.filter(a =>
                        a.name && /^(winning|winner)/i.test(a.name) && a.team_number
                    );
                    const finalistAwards = awards.filter(a =>
                        a.name && /^(finalist)/i.test(a.name) && a.team_number
                    );

                    // Determine if this event is FIRST Championship or Premier
                    // (type 6 = "FIRST Championship", type 17 = "Premier")
                    // Excludes regional/country championships (type 4 = "Championship")
                    const evType = (eventInfoData && eventInfoData.event_type_string) || '';
                    const isChampOrPremier = /^FIRST Championship$/i.test(evType) || /premier/i.test(evType);

                    // If Championship/Premier, 1st-place Inspire winners go in the ⭐ prestige section
                    if (isChampOrPremier) {
                        const inspireMap = new Map();
                        const inspire1st = inspireAwards.filter(a => !/2nd|3rd|4th|5th/i.test(a.name));
                        inspire1st.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                        inspire1st.forEach(a => {
                            if (!inspireMap.has(a.team_number)) {
                                const tm = teams.find(t => t.team_number === a.team_number);
                                const typeTag = /championship/i.test(evType) ? ' (Championship)' : ' (Premier)';
                                inspireMap.set(a.team_number, {
                                    team_number: a.team_number,
                                    nickname: tm ? tm.nickname : `Team ${a.team_number}`,
                                    impact_years: [a.name + typeTag],
                                });
                            }
                        });
                        inspire_finalists = [...inspireMap.values()];
                    }

                    // Build Event Winners & Finalists from winner/finalist awards
                    champMap = new Map();
                    [...winnerAwards, ...finalistAwards].forEach(a => {
                        if (!champMap.has(a.team_number)) {
                            const tm = teams.find(t => t.team_number === a.team_number);
                            champMap.set(a.team_number, {
                                team_number: a.team_number,
                                nickname: tm ? tm.nickname : `Team ${a.team_number}`,
                                years_won: [],
                                years_finalist: [],
                                years_inspire: [],
                            });
                        }
                        const entry = champMap.get(a.team_number);
                        if (/^(winning|winner)/i.test(a.name)) entry.years_won.push(a.name);
                        else entry.years_finalist.push(a.name);
                    });

                    // Add only 1st-place Inspire winners to Event Winners & Finalists box
                    inspireAwards.filter(a => !/2nd|3rd|4th|5th/i.test(a.name)).forEach(a => {
                        if (!champMap.has(a.team_number)) {
                            const tm = teams.find(t => t.team_number === a.team_number);
                            champMap.set(a.team_number, {
                                team_number: a.team_number,
                                nickname: tm ? tm.nickname : `Team ${a.team_number}`,
                                years_won: [],
                                years_finalist: [],
                                years_inspire: [],
                            });
                        }
                        const entry = champMap.get(a.team_number);
                        if (!entry.years_inspire) entry.years_inspire = [];
                        entry.years_inspire.push(a.name);
                    });
                }
            } catch (e) {
                console.warn('Could not fetch FTC awards for summary:', e);
            }

            // Show Inspire at all FTC events (it's the top award in FTC)
            const ftcChampions = [...champMap.values()];

            // Collect season-wide big 3 award winners (from prior events this season)
            let ftcSeasonAwards = [];
            try {
                // Use pre-fetched data if available
                if (_ftcPrefetchEventKey === currentEvent && _ftcPrefetchedSeasonAwards != null) {
                    ftcSeasonAwards = _ftcPrefetchedSeasonAwards;
                } else {
                    const resp = await FTC_API.eventSeasonAwards(currentEvent);
                    if (resp && Array.isArray(resp.season_awards)) {
                        ftcSeasonAwards = resp.season_awards;
                    }
                }
            } catch (e) {
                console.warn('Could not fetch FTC season awards:', e);
            }

            const data = { demographics, hall_of_fame: [], impact_finalists: inspire_finalists, ftc_event_champions: ftcChampions, ftc_season_awards: ftcSeasonAwards, top_scorers, high_scores };
            summaryData = data;
            hideSkeleton('summary-loading');
            renderSummary(data);
            fadeIn('summary-container');
            updateTabDots();
        } catch (err) {
            hideSkeleton('summary-loading');
            showInlineError('summary-error', `Failed to build FTC summary: ${err.message}`, loadSummary);
        }
        return;
    }

    showSkeleton('summary-loading', 'summary-loading-status', 'Fetching event summary\u2026');
    hide('summary-container');

    try {
        setLoadingStatus('summary-loading-status', 'Analysing event data\u2026');
        const data = await API.eventSummary(currentEvent);
        if (data.error || !data.demographics) {
            hideSkeleton('summary-loading');
            showInlineError('summary-error', data.error || 'No summary data available for this event yet.', loadSummary);
            return;
        }
        summaryData = data;
        hideSkeleton('summary-loading');
        renderSummary(data);
        fadeIn('summary-container');
        autoCacheTab('summary', data);
        updateTabDots();
    } catch (err) {
        // Offline fallback for summary
        const cached = await DB.getCachedTab(currentEvent, 'summary');
        if (cached && cached.demographics) {
            summaryData = cached;
            hideSkeleton('summary-loading');
            renderSummary(cached);
            fadeIn('summary-container');
            updateTabDots();
            console.info('[Offline] Using cached summary for', currentEvent);
        } else {
            hideSkeleton('summary-loading');
            showInlineError('summary-error', `Failed to load summary: ${err.message}`, loadSummary);
        }
    }
}

/** Lazy-load prior playoff connections for the summary tab */
var _loadingConnections = false;  // var: read by event_select.js
async function loadSummaryConnections() {
    if (!currentEvent || !summaryData || _loadingConnections) return;
    _loadingConnections = true;
    const eventKey = currentEvent;
    try {
        const connections = await getActiveAPI().eventConnections(eventKey, false);
        if (currentEvent !== eventKey || !summaryData) return; // user switched events
        summaryData.connections = connections;
        summaryData._connections_past3 = connections;
        const histEl = $('summary-history');
        if (connections.length > 0) {
            renderConnections(connections, 'all');
            document.querySelectorAll('.conn-filter-btn').forEach(b => b.classList.remove('active'));
            document.querySelector('.conn-filter-btn[data-conn-filter="all"]')?.classList.add('active');
            histEl.classList.remove('hidden');
        } else {
            histEl.classList.add('hidden');
        }
        // Persist connections into cache alongside the summary
        autoCacheTab('summary', summaryData);
    } catch (err) {
        if (currentEvent !== eventKey) return;
        const isRateLimit = err && (err.status === 429 || /429|rate.?limit/i.test(err.message));
        const msg = isRateLimit
            ? 'Rate limited by API — retrying shortly\u2026'
            : 'Could not load connections.';
        $('summary-history-list').innerHTML = `<p class="empty" style="margin:.5rem 0;font-size:.82rem">${msg}</p>`;
        if (isRateLimit) setTimeout(() => { _loadingConnections = false; loadSummaryConnections(); }, 5000);
    } finally {
        _loadingConnections = false;
    }
}

/** Lazy-load returning event champions & previous-season award winners */
var _loadingAwards = false;  // var: read by event_select.js
async function loadSummaryAwards() {
    if (!currentEvent || !summaryData || _loadingAwards) return;
    _loadingAwards = true;
    const eventKey = currentEvent;
    try {
        const data = await API.eventSummaryAwards(eventKey);
        if (currentEvent !== eventKey || !summaryData) return; // user switched events

        // ── Championship division: special payload ─────────
        if (data.is_championship) {
            summaryData.is_championship = true;
            summaryData.season_winners = data.season_winners || [];
            summaryData.season_impact = data.season_impact || [];
            summaryData.einstein_contenders = data.einstein_contenders || [];
            _renderChampsSummaryAwards(data);
            renderPrequalifiedTeams(); // ensure "Already Qualified" section is hidden
            // Ensure the year toggle is hidden — it's an artifact from the
            // regular-event awards card and must not appear on championship divisions
            const champToggle = $('award-season-toggle');
            if (champToggle) champToggle.classList.add('hidden');
            autoCacheTab('summary', summaryData);
            // Re-render the PBP match now that einstein_contenders is available,
            // so Einstein Winner / Returning Einstein badges appear on any
            // already-visible playoff match card.
            if (pbpData?.matches) {
                const _pbpM = pbpData.matches[pbpIndex];
                if (_pbpM?.comp_level && _pbpM.comp_level !== 'qm') {
                    const _activeTab = document.querySelector('.tab.active');
                    if (_activeTab?.dataset.tab === 'pbp') {
                        // Full re-render: simplest and most reliable way to
                        // ensure badges (and bench cards) are injected with
                        // both allianceData and einstein_contenders ready.
                        renderPbpMatch();
                    } else {
                        // User is on a different tab — inject badges directly into
                        // the existing (hidden) slots if we can. If _playoffFirstsCache
                        // hasn't loaded yet, skip — renderPbpMatch() will handle it
                        // when the user switches to PBP.
                        if (_playoffFirstsCache !== null) {
                            _injectPlayoffFirsts(_pbpTeams, pbpIndex, _pbpM.comp_level);
                        }
                    }
                }
            }
            return;
        }

        // ── Regular event flow ─────────────────────────────
        summaryData.past_event_champions = data.past_event_champions || [];
        summaryData.past_season_awards = data.past_season_awards || [];

        const champsEl = $('summary-past-champs');
        if (data.past_event_champions && data.past_event_champions.length > 0) {
            renderPastEventChampions(data.past_event_champions);
            champsEl.classList.remove('hidden');
        } else {
            champsEl.classList.add('hidden');
        }

        const awardsEl = $('summary-past-awards');
        if (data.past_season_awards && data.past_season_awards.length > 0) {
            // Only render if past-season tab is active (or no season toggle visible)
            if (currentAwardSeason === 'past') {
                renderPastSeasonAwards(data.past_season_awards);
            }
            awardsEl.classList.remove('hidden');
        } else if (currentAwardSeason === 'past') {
            awardsEl.classList.add('hidden');
        }

        // Persist awards into the cached summary so tab switches
        // and saved-event loads don't need to re-fetch from the API.
        autoCacheTab('summary', summaryData);
    } catch (err) {
        // Don't hide sections — leave summaryData fields unset so the next
        // re-render (tab switch) can retry the fetch automatically.
        if (currentEvent !== eventKey) return;
        const isRateLimit = err && (err.status === 429 || /429|rate.?limit/i.test(err.message));
        const msg = isRateLimit
            ? 'Rate limited by API — retrying shortly\u2026'
            : 'Could not load — switch tabs to retry.';
        $('summary-past-champs-list').innerHTML = `<p class="empty" style="margin:.5rem 0;font-size:.82rem">${msg}</p>`;
        // Only overwrite the awards list if season awards haven't already been loaded
        if (!summaryData.season_awards || summaryData.season_awards.length === 0) {
            $('summary-past-awards-list').innerHTML = `<p class="empty" style="margin:.5rem 0;font-size:.82rem">${msg}</p>`;
        }
        if (isRateLimit) setTimeout(() => { _loadingAwards = false; loadSummaryAwards(); }, 5000);
    } finally {
        _loadingAwards = false;
    }
}

/** Lazy-load current-season Award Winners (Impact/Winner/Finalist from other events this year). */
let _loadingSeasonAwards = false;
async function loadSeasonAwards() {
    if (!currentEvent || !summaryData || _loadingSeasonAwards) return;
    _loadingSeasonAwards = true;
    const eventKey = currentEvent;
    try {
        const data = await API.eventSeasonAwards(eventKey);
        if (currentEvent !== eventKey || !summaryData) return;
        summaryData.season_awards = data.season_awards || [];
        // Only render if current season tab is still selected
        if (currentAwardSeason === 'current') {
            if (summaryData.season_awards.length > 0) {
                renderPastSeasonAwards(summaryData.season_awards);
                $('summary-past-awards').classList.remove('hidden');
            } else if (summaryData.past_season_awards && summaryData.past_season_awards.length > 0) {
                // No current season awards — auto-switch to past tab
                currentAwardSeason = 'past';
                const toggle = $('award-season-toggle');
                if (toggle) toggle.querySelectorAll('.award-season-btn').forEach(b =>
                    b.classList.toggle('active', b.dataset.season === 'past'));
                renderPastSeasonAwards(summaryData.past_season_awards);
                $('summary-past-awards').classList.remove('hidden');
            } else if (!summaryData.past_season_awards) {
                // Past data still loading — show placeholder
                $('summary-past-awards-list').innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">Loading\u2026</p>';
            } else {
                $('summary-past-awards').classList.add('hidden');
            }
        }
        autoCacheTab('summary', summaryData);
    } catch (err) {
        if (currentEvent !== eventKey) return;
        if (currentAwardSeason === 'current') {
            const isRateLimit = err && (err.status === 429 || /429|rate.?limit/i.test(err.message));
            $('summary-past-awards-list').innerHTML = `<p class="empty" style="margin:.5rem 0;font-size:.82rem">${
                isRateLimit ? 'Rate limited — retrying shortly\u2026' : 'Could not load — switch tabs to retry.'
            }</p>`;
            if (isRateLimit) setTimeout(() => { _loadingSeasonAwards = false; loadSeasonAwards(); }, 5000);
        }
    } finally {
        _loadingSeasonAwards = false;
    }
}

let currentAwardSeason = 'current';

function switchAwardSeason(season, btn) {
    currentAwardSeason = season;
    currentAwardFilter = 'all';
    // Update season toggle
    const bar = btn.parentNode;
    bar.querySelectorAll('.award-season-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // Reset filter buttons
    const body = $('summary-past-awards-body');
    if (body) body.querySelectorAll('.past-awards-filter-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.awardFilter === 'all');
    });
    // Get appropriate data
    const awards = season === 'current'
        ? summaryData?.season_awards
        : (summaryData?.past_season_awards || summaryData?.ftc_past_season_awards);
    if (awards && awards.length > 0) {
        renderPastSeasonAwards(awards);
    } else if (season === 'current' && !summaryData?.season_awards) {
        $('summary-past-awards-list').innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">Loading\u2026</p>';
        if (isFTCMode()) {
            // FTC current-season awards are populated from summary data (not lazy-loaded)
            $('summary-past-awards-list').innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">No award winners found.</p>';
        } else {
            loadSeasonAwards();
        }
    } else if (season === 'past' && !summaryData?.past_season_awards && !summaryData?.ftc_past_season_awards) {
        $('summary-past-awards-list').innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">Loading\u2026</p>';
        if (isFTCMode()) loadFtcPastAwards();
    } else {
        $('summary-past-awards-list').innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">No award winners found.</p>';
    }
}

/** Lazy-load FTC past-season awards (Inspire/Winner/Finalist from previous season). */
let _loadingFtcPastAwards = false;
async function loadFtcPastAwards() {
    if (!currentEvent || !summaryData || _loadingFtcPastAwards) return;
    _loadingFtcPastAwards = true;
    const eventKey = currentEvent;
    try {
        const data = await FTC_API.eventPastAwards(eventKey);
        if (currentEvent !== eventKey || !summaryData) return;
        summaryData.ftc_past_season_awards = data.past_season_awards || [];
        summaryData.past_season_awards = data.past_season_awards || [];
        summaryData.ftc_past_season_year = data.prev_season;

        const awardsEl = $('summary-past-awards');
        if (data.past_season_awards && data.past_season_awards.length > 0) {
            // Update the past-season toggle button label
            const tog = $('award-season-toggle');
            if (tog) {
                const btns = tog.querySelectorAll('.award-season-btn');
                if (btns[1]) btns[1].textContent = String(data.prev_season);
            }
            // Only render if we're currently on the past tab
            if (currentAwardSeason === 'past') {
                renderPastSeasonAwards(data.past_season_awards);
            }
            awardsEl.classList.remove('hidden');
        } else {
            // If nothing loaded & we're on past tab, hide
            if (currentAwardSeason === 'past') awardsEl.classList.add('hidden');
        }
    } catch (err) {
        if (currentEvent !== eventKey) return;
        const msg = /429|rate.?limit/i.test(err?.message || '')
            ? 'Rate limited — retrying shortly\u2026'
            : 'Could not load — switch tabs to retry.';
        $('summary-past-awards-list').innerHTML = `<p class="empty" style="margin:.5rem 0;font-size:.82rem">${msg}</p>`;
        if (/429|rate.?limit/i.test(err?.message || '')) {
            setTimeout(() => { _loadingFtcPastAwards = false; loadFtcPastAwards(); }, 5000);
        }
    } finally {
        _loadingFtcPastAwards = false;
    }
}

/** Render championship-specific awards into the summary card slots and prestige row. */
function _renderChampsSummaryAwards(data) {
    const champsEl    = $('summary-past-champs');
    const awardsEl    = $('summary-past-awards');
    const prestigeRow = $('summary-prestige-row');

    // ── Left card: Season Winners + Impact ─────────────────
    const hasWinners = data.season_winners && data.season_winners.length > 0;
    const hasImpact = data.season_impact && data.season_impact.length > 0;
    if (hasWinners || hasImpact) {
        champsEl.querySelector('h3').textContent = `${currentEventYear} Season Winners & Impact`;

        // Show filter bar and reset to "all"
        const filterBar = $('champs-filter-bar');
        filterBar.classList.remove('hidden');
        filterBar.querySelectorAll('.past-awards-filter-btn').forEach(b => b.classList.remove('active'));
        filterBar.querySelector('[data-champs-filter="all"]').classList.add('active');

        const _latestYear = t => Math.max(0, ...(t.awards || []).map(a => parseInt(a.event_key, 10) || 0));
        const sortedWinners = [...(data.season_winners || [])].sort((a, b) => _latestYear(b) - _latestYear(a) || a.team_number - b.team_number);
        const sortedImpact  = [...(data.season_impact  || [])].sort((a, b) => _latestYear(b) - _latestYear(a) || a.team_number - b.team_number);
        const rows = [];
        for (const t of sortedWinners) {
            const chips = t.awards.map(a => {
                const front = `\u{1F3C6} Winner @ ${_esc(a.event_name)}`;
                if (a.pick) {
                    const alLabel = a.alliance ? `A${a.alliance} ` : '';
                    return `<span class="past-award-chip past-award-chip-winner pick-flip" onclick="this.classList.toggle('flipped')">
                        <span class="pick-flip-inner">
                            <span class="pick-flip-front">${front}</span>
                            <span class="pick-flip-back">${alLabel}${a.pick}</span>
                        </span>
                    </span>`;
                }
                return `<span class="past-award-chip past-award-chip-winner">${front}</span>`;
            }).join('');
            rows.push(`<div class="summary-hof-team past-award-row" data-champs-type="winner">
                <span class="summary-hof-num">${t.team_number}</span>
                <span class="summary-hof-name">${t.nickname}</span>
                <div class="past-award-chips">${chips}</div>
            </div>`);
        }
        for (const t of sortedImpact) {
            const chips = t.awards.map(a =>
                `<span class="past-award-chip past-award-chip-impact">\u2B50 Impact @ ${_esc(a.event_name)}</span>`
            ).join('');
            rows.push(`<div class="summary-hof-team past-award-row" data-champs-type="impact">
                <span class="summary-hof-num">${t.team_number}</span>
                <span class="summary-hof-name">${t.nickname}</span>
                <div class="past-award-chips">${chips}</div>
            </div>`);
        }
        $('summary-past-champs-list').innerHTML = rows.join('');
        champsEl.classList.remove('hidden');
    } else {
        champsEl.classList.add('hidden');
    }

    // ── Prestige row: Einstein Winners + Contenders ────────
    const einsteinWinnersEl  = $('summary-einstein-winners');
    const einsteinContsEl    = $('summary-einstein-contenders');
    const allContenders      = data.einstein_contenders || [];
    const einWinners         = allContenders.filter(t => t.einstein_winner);
    const einContenders      = allContenders.filter(t => !t.einstein_winner);

    if (einWinners.length > 0) {
        $('summary-einstein-winners-list').innerHTML = einWinners.map(t =>
            `<div class="prestige-entry">
                <span class="prestige-entry-num prestige-num-einstein">${t.team_number}</span>
                <span class="prestige-entry-name">${t.nickname}</span>
            </div>`
        ).join('');
        einsteinWinnersEl.classList.remove('hidden');
        prestigeRow.classList.remove('hidden');
    } else {
        if (einsteinWinnersEl) einsteinWinnersEl.classList.add('hidden');
    }

    if (einContenders.length > 0) {
        $('summary-einstein-contenders-list').innerHTML = einContenders.map(t =>
            `<div class="prestige-entry">
                <span class="prestige-entry-num prestige-num-einstein-contender">${t.team_number}</span>
                <span class="prestige-entry-name">${t.nickname}</span>
            </div>`
        ).join('');
        einsteinContsEl.classList.remove('hidden');
        prestigeRow.classList.remove('hidden');
    } else {
        if (einsteinContsEl) einsteinContsEl.classList.add('hidden');
    }

    // Championship divisions: hide the Award-Winning Teams card — season winners
    // and impact are already shown in the left card.
    awardsEl.classList.add('hidden');
}

/** Filter championship Season Winners & Impact rows by type */
function filterChampsAwards(type, btn) {
    $('champs-filter-bar').querySelectorAll('.past-awards-filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    $('summary-past-champs-list').querySelectorAll('[data-champs-type]').forEach(row => {
        row.style.display = (type === 'all' || row.dataset.champsType === type) ? '' : 'none';
    });
}

/** Lazy-load advancement data (point standings, awards, district rankings) */
let _loadingAdvancement = false;
async function loadSummaryAdvancement() {
    if (!currentEvent || !summaryData || _loadingAdvancement) return;
    _loadingAdvancement = true;
    const eventKey = currentEvent;
    try {
        const data = await API.eventAdvancement(eventKey);
        if (currentEvent !== eventKey || !summaryData) return;
        summaryData.advancement = data;
        renderAdvancement(data);
        autoCacheTab('summary', summaryData);
    } catch (err) {
        if (currentEvent !== eventKey) return;
        const isRateLimit = err && (err.status === 429 || /429|rate.?limit/i.test(err.message));
        const msg = isRateLimit
            ? 'Rate limited by API — retrying shortly\u2026'
            : 'Could not load advancement data.';
        $('summary-advancement-content').innerHTML = `<p class="empty" style="margin:.5rem 0;font-size:.82rem">${msg}</p>`;
        if (isRateLimit) setTimeout(() => { _loadingAdvancement = false; loadSummaryAdvancement(); }, 5000);
    } finally {
        _loadingAdvancement = false;
    }
}

function togglePrequalified() {
    _toggleCollapse('summary-prequalified-body', 'prequalified-toggle-icon');
}

/** Show teams at this event that are already qualified for Championship */
function renderPrequalifiedTeams() {
    const el = $('summary-prequalified');
    const content = $('summary-prequalified-content');
    if (!el || !content) return;

    // Only for FRC 2026+ non-championship events with loaded team data
    if (isFTCMode() || !teamsData || !teamsData.length || (currentEventYear && currentEventYear < 2026)
        || (summaryData && summaryData.is_championship)) {
        el.classList.add('hidden');
        return;
    }

    // Build lookup of team numbers at this event
    const eventTeamNums = new Set(teamsData.map(t => t.team_number));

    let prequalified = [];

    if (_regionalPoolAllTeams && _regionalPoolAllTeams.length) {
        // Primary: use global pool data (has all teams)
        prequalified = _regionalPoolAllTeams.filter(t =>
            t.qualifiedFirstCmp && eventTeamNums.has(t.teamNumber)
        );
    } else if (summaryData && summaryData.regional_pool && summaryData.regional_pool.length) {
        // Fallback: use summary's regional_pool (this event's teams only)
        prequalified = summaryData.regional_pool
            .filter(t => t.qualified)
            .map(t => ({
                teamNumber: t.team_number,
                totalPoints: t.total_points,
                qualifiedFirstCmpAwardName: t.qual_method || '',
                championshipStatus: t.status || '',
                qualifiedFirstCmp: true,
            }));
    }

    if (!prequalified.length) {
        el.classList.add('hidden');
        return;
    }

    // Sort: award-qualified first, then pool, by total points desc
    prequalified.sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0));

    const badge = $('prequalified-badge');
    if (badge) badge.textContent = `${prequalified.length} team${prequalified.length !== 1 ? 's' : ''}`;

    let html = '<div class="adv-qual-list">';
    prequalified.forEach(t => {
        const method = _rpQualMethod(t);
        let methodCls = 'adv-method-ranking'; // green — directly qualified
        if (method.startsWith('Pool')) {
            methodCls = 'adv-method-backup';  // amber — pool
        } else if (method.toLowerCase().includes('impact')) {
            methodCls = 'adv-method-impact';
        } else if (t.qualifiedFirstCmpAwardName) {
            methodCls = 'adv-method-award';
        }

        const teamObj = teamsData.find(et => et.team_number === t.teamNumber);
        const name = teamObj ? teamObj.nickname : (t.nameShort || '');

        html += '<div class="adv-qual-row">';
        html += `<span class="adv-team-num">${t.teamNumber}</span>`;
        html += `<span class="adv-team-name">${name}</span>`;
        html += '<span class="adv-right-group">';
        html += `<span class="adv-pts">${t.totalPoints != null ? t.totalPoints + ' pts' : ''}</span>`;
        html += `<span class="adv-method ${methodCls}">${method}</span>`;
        html += '</span>';
        html += '</div>';
    });
    html += '</div>';
    content.innerHTML = html;
    el.classList.remove('hidden');
}

function toggleAdvancement() {
    _toggleCollapse('summary-advancement-body', 'advancement-toggle-icon');
}

function renderAdvancement(data) {
    const el = $('summary-advancement');
    const content = $('summary-advancement-content');

    // Championship Division: only show the division winner, no points or awards
    if (summaryData && summaryData.is_championship) {
        const winners = (data.qualified_teams || []).filter(
            t => (t.method || '').toLowerCase().includes('winner')
        );
        if (!winners.length) {
            el.classList.add('hidden');
            return;
        }
        el.classList.remove('hidden');
        let html = '<div class="adv-section"><div class="adv-qual-list">';
        winners.forEach(t => {
            html += '<div class="adv-qual-row">';
            html += `<span class="adv-team-num">${t.team_number}</span>`;
            html += `<span class="adv-team-name">${t.nickname}</span>`;
            html += '<span class="adv-right-group">';
            html += `<span class="adv-method adv-method-ranking">Division Winner</span>`;
            html += '</span></div>';
        });
        html += '</div></div>';
        content.innerHTML = html;
        return;
    }

    const hasQualified = data.qualified_teams && data.qualified_teams.length > 0;
    const hasDistrict = data.district_rankings && data.district_rankings.length > 0;

    if (!hasQualified && !hasDistrict) {
        el.classList.add('hidden');
        return;
    }

    el.classList.remove('hidden');
    let html = '';

    // ── Direct Qualifications ───────────────────────────────
    if (hasQualified) {
        html += '<div class="adv-section">';
        html += '<div class="adv-qual-list">';
        data.qualified_teams.forEach(t => {
            const m = (t.method || '').toLowerCase();
            const methodCls = m.includes('impact') ? 'adv-method-impact'
                            : m.includes('backup') ? 'adv-method-backup'
                            : m.includes('award')  ? 'adv-method-award'
                            : 'adv-method-ranking';
            const awardsStr = (t.awards || []).filter(a => a !== 'Winner' && a !== 'Finalist').join(', ');
            html += '<div class="adv-qual-row">';
            html += `<span class="adv-team-num">${t.team_number}</span>`;
            html += `<span class="adv-team-name">${t.nickname}</span>`;
            html += '<span class="adv-right-group">';
            if (awardsStr) {
                html += `<span class="adv-awards-badge" title="${awardsStr}">${awardsStr}</span>`;
            }
            html += `<span class="adv-pts" title="Qual ${t.qual_points} · Alliance ${t.alliance_points} · Elim ${t.elim_points} · Award ${t.award_points}">${t.total_points} pts</span>`;
            html += `<span class="adv-method ${methodCls}">${t.method}</span>`;
            html += '</span>';
            html += '</div>';
        });
        html += '</div>';
        html += '</div>';
    }

    // ── District Rankings ───────────────────────────────────
    if (hasDistrict) {
        html += '<div class="adv-section">';
        html += `<h4 class="adv-section-title">${data.district_name || 'District'} Rankings</h4>`;
        html += _renderDistrictRankingsTable(data.district_rankings);
        html += '</div>';
    }

    content.innerHTML = html;
}

function _renderDistrictRankingsTable(rankings) {
    let html = '<div class="adv-table-wrap adv-table-district"><table class="adv-table">';
    html += '<thead><tr><th>Rank</th><th>Team</th><th>Points</th><th>Events</th></tr></thead>';
    html += '<tbody>';

    // Show top 25 + all teams at this event, with gap markers
    const topN = 25;
    const rows = rankings.filter(dr => dr.rank <= topN || dr.at_this_event);
    rows.sort((a, b) => a.rank - b.rank);

    let lastRank = 0;
    rows.forEach(dr => {
        if (dr.rank > lastRank + 1 && lastRank > 0) {
            html += '<tr class="adv-gap"><td colspan="4">···</td></tr>';
        }
        const cls = dr.at_this_event ? 'adv-row-here' : '';
        const star = dr.at_this_event ? ' <span class="adv-here-star">★</span>' : '';
        html += `<tr class="${cls}">`;
        html += `<td>${dr.rank}</td>`;
        html += `<td>${dr.team_number}${star}</td>`;
        html += `<td class="adv-col-total">${dr.point_total}</td>`;
        html += `<td>${dr.event_count}</td>`;
        html += '</tr>';
        lastRank = dr.rank;
    });

    html += '</tbody></table></div>';
    return html;
}

function _champBadge(entries, cls, icon, label) {
    const years = entries.map(y => typeof y === 'object' ? y.year : y).join(', ');
    const frontText = `${icon} ${label}: ${years}`;
    const hasPick = entries.some(y => typeof y === 'object' && y.pick);
    if (!hasPick) return `<span class="past-champ-badge ${cls}">${frontText}</span>`;

    // Single entry with pick → use flip interaction (consistent with award chips)
    if (entries.length === 1) {
        const y = entries[0];
        const alLabel = y.alliance ? `A${y.alliance} ` : '';
        return `<span class="past-champ-badge ${cls} pick-flip" onclick="this.classList.toggle('flipped')">`
             + `<span class="pick-flip-inner">`
             + `<span class="pick-flip-front">${frontText}</span>`
             + `<span class="pick-flip-back">${alLabel}${y.pick}</span>`
             + `</span></span>`;
    }

    // Multiple entries with picks → dropdown popover
    const detailRows = entries.map(y => {
        if (typeof y === 'object' && y.pick) {
            const a = y.alliance ? `<span class="pick-detail-alliance">A${y.alliance}</span>` : '';
            return `<div class="pick-detail-row">`
                 + `<span class="pick-detail-year">${y.year}</span>`
                 + `${a}<span class="pick-detail-pick">${y.pick}</span>`
                 + `</div>`;
        }
        return '';
    }).filter(Boolean).join('');
    return `<span class="past-champ-badge ${cls} has-pick-detail" onclick="togglePickDetail(event, this)">`
         + frontText
         + `<svg class="pick-detail-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"/></svg>`
         + `<div class="pick-detail-popover">${detailRows}</div>`
         + `</span>`;
}

function togglePickDetail(event, el) {
    event.stopPropagation();
    const wasOpen = el.classList.contains('open');
    document.querySelectorAll('.has-pick-detail.open').forEach(e => e.classList.remove('open'));
    if (!wasOpen) {
        el.classList.add('open');
        const pop = el.querySelector('.pick-detail-popover');
        if (pop) {
            const r = el.getBoundingClientRect();
            pop.style.top = (r.bottom + 6) + 'px';
            pop.style.right = (window.innerWidth - r.right) + 'px';
            pop.style.left = '';
            // If it overflows the right edge, flip to left-aligned
            requestAnimationFrame(() => {
                const pr = pop.getBoundingClientRect();
                if (pr.left < 8) {
                    pop.style.right = '';
                    pop.style.left = r.left + 'px';
                }
            });
        }
    }
}
document.addEventListener('click', () => {
    document.querySelectorAll('.has-pick-detail.open').forEach(e => e.classList.remove('open'));
});

function renderPastEventChampions(champions) {
    // Sort by most recent year (descending) — teams who were most recently here appear first
    const sorted = [...champions].sort((a, b) => {
        const latestA = Math.max(
            ...(a.years_won.map(y => y.year)),
            ...(a.years_finalist.map(y => y.year)),
            0
        );
        const latestB = Math.max(
            ...(b.years_won.map(y => y.year)),
            ...(b.years_finalist.map(y => y.year)),
            0
        );
        return latestB - latestA || a.team_number - b.team_number;
    });
    $('summary-past-champs-list').innerHTML = sorted.map(t => {
        const badges = [];
        if (t.years_won.length)
            badges.push(_champBadge(t.years_won, 'past-champ-winner', '\u{1F3C6}', 'Winner'));
        if (t.years_finalist.length)
            badges.push(_champBadge(t.years_finalist, 'past-champ-finalist', '\u{1F948}', 'Finalist'));
        return `<div class="summary-hof-team">
            <span class="summary-hof-num">${t.team_number}</span>
            <span class="summary-hof-name">${t.nickname}</span>
            <span class="past-champ-badges">${badges.join(' ')}</span>
        </div>`;
    }).join('');
}

var currentAwardFilter = 'all';  // var: read by event_select.js

function filterPastAwards(filter, btn) {
    currentAwardFilter = filter;
    const body = $('summary-past-awards-body');
    if (body) body.querySelectorAll('.past-awards-filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    // Use data from the active season
    let awards;
    if (isFTCMode()) {
        awards = summaryData?.ftc_past_season_awards;
    } else if (currentAwardSeason === 'current') {
        awards = summaryData?.season_awards;
    } else {
        awards = summaryData?.past_season_awards;
    }
    if (awards) renderPastSeasonAwards(awards);
}

function renderPastSeasonAwards(awards) {

    const filtered = currentAwardFilter === 'all'
        ? awards
        : awards.map(t => ({
            ...t,
            // 'impact' filter also matches 'inspire' (FTC equivalent)
            awards: t.awards.filter(a => a.type === currentAwardFilter
                || (currentAwardFilter === 'impact' && a.type === 'inspire')
                || (currentAwardFilter === 'inspire' && a.type === 'impact')),
        })).filter(t => t.awards.length > 0);

    if (filtered.length === 0) {
        $('summary-past-awards-list').innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">No teams match this filter.</p>';
        return;
    }

    // Sort by most recent award year descending; tie-break by team number
    const sorted = [...filtered].sort((a, b) => {
        const latestYear = tm => Math.max(0, ...tm.awards.map(aw => parseInt(aw.event_key, 10) || 0));
        return latestYear(b) - latestYear(a) || a.team_number - b.team_number;
    });

    $('summary-past-awards-list').innerHTML = sorted.map(t => {
        const chips = t.awards.map(a => {
            const icon = a.type === 'winner' ? '\u{1F3C6}' : a.type === 'finalist' ? '\u{1F948}' : '\u{2B50}';
            const cls = `past-award-chip-${a.type}`;
            const label = a.type.charAt(0).toUpperCase() + a.type.slice(1);
            const front = `${icon} ${label} @ ${_esc(a.event_name)}`;
            if (a.pick) {
                const alLabel = a.alliance ? `A${a.alliance} ` : '';
                return `<span class="past-award-chip ${cls} pick-flip" onclick="this.classList.toggle('flipped')">`
                     + `<span class="pick-flip-inner">`
                     + `<span class="pick-flip-front">${front}</span>`
                     + `<span class="pick-flip-back">${alLabel}${a.pick}</span>`
                     + `</span></span>`;
            }
            return `<span class="past-award-chip ${cls}" title="${_esc(a.event_name)}">${front}</span>`;
        }).join('');
        return `<div class="summary-hof-team past-award-row">
            <span class="summary-hof-num">${t.team_number}</span>
            <span class="summary-hof-name">${t.nickname}</span>
            <div class="past-award-chips">${chips}</div>
        </div>`;
    }).join('');
}

async function refreshSummaryStats() {
    if (!currentEvent) return;
    const btn = document.querySelector('.summary-refresh-btn');
    if (btn) { btn.disabled = true; btn.textContent = '↻ Refreshing…'; }

    try {
        if (isFTCMode()) {
            // FTC: re-run the full summary load (stats are built client-side)
            summaryData = null;
            await loadSummary();
            return;
        }
        const data = await API.eventSummaryRefresh(currentEvent);
        if (data.top_scorers && summaryData) {
            summaryData.top_scorers = data.top_scorers;
            renderTopScorers(data.top_scorers);
        }
        if (data.high_scores && summaryData) {
            summaryData.high_scores = data.high_scores;
            renderHighScores(data.high_scores);
        }
    } catch (err) {
        showToast(`Error refreshing stats: ${err.message}`, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh Stats'; }
    }
}

function renderSummary(data) {
    $('summary-title').textContent = `Event Summary · ${currentEvent.toUpperCase()}`;
    show('summary-container');

    // Propagate is_championship to summaryData immediately so helper functions
    // (like renderPrequalifiedTeams) see it even before loadSummaryAwards fires.
    if (data.is_championship) {
        summaryData = summaryData || data;
        summaryData.is_championship = true;
    }

    // Demographics
    const d = data.demographics;
    if (!d) {
        $('summary-demographics').innerHTML = '<p class="empty">Demographics not available.</p>';
    } else {
    $('summary-demographics').innerHTML = `
        <div class="summary-stat-card">
            <div class="summary-stat-value">${d.total_teams}</div>
            <div class="summary-stat-label">Total Teams</div>
        </div>
        <div class="summary-stat-card">
            <div class="summary-stat-value">${d.rookie_pct}%</div>
            <div class="summary-stat-label">Rookie Teams <span class="summary-stat-sub">(${d.rookie_count})</span></div>
        </div>
        <div class="summary-stat-card">
            <div class="summary-stat-value">${d.veteran_pct}%</div>
            <div class="summary-stat-label">Veteran Teams <span class="summary-stat-sub">(${d.veteran_count})</span></div>
            <div class="summary-stat-sub">Avg team age: ${d.avg_team_age} yrs</div>
        </div>
        <div class="summary-stat-card">
            <div class="summary-stat-value">${d.foreign_pct}%</div>
            <div class="summary-stat-label">International Teams <span class="summary-stat-sub">(${d.foreign_count}${d.event_country ? ', non-' + d.event_country : ''})</span></div>
        </div>
        <div class="summary-stat-card">
            <div class="summary-stat-value">${d.country_count}</div>
            <div class="summary-stat-label">Countries</div>
            <div class="summary-stat-sub">${d.countries.join(', ')}</div>
        </div>`;
    }

    // Hall of Fame
    const hofEl = $('summary-hof');
    const prestigeRow = $('summary-prestige-row');
    if (data.hall_of_fame.length > 0) {
        $('summary-hof-list').innerHTML = [...data.hall_of_fame]
            .sort((a, b) => {
                const latestA = Math.max(0, ...(a.impact_years || []).map(Number).filter(Boolean));
                const latestB = Math.max(0, ...(b.impact_years || []).map(Number).filter(Boolean));
                return latestB - latestA || a.team_number - b.team_number;
            })
            .map(t => {
            const years = t.impact_years ? t.impact_years.join(', ') : '';
            return `<div class="prestige-entry">
                <span class="prestige-entry-num prestige-num-hof">${t.team_number}</span>
                <span class="prestige-entry-name">${t.nickname}</span>
                ${years ? `<span class="prestige-entry-year">${years}</span>` : ''}
            </div>`;
        }).join('');
        hofEl.classList.remove('hidden');
        prestigeRow.classList.remove('hidden');
    } else {
        hofEl.classList.add('hidden');
    }

    // Impact Award Finalists (FRC) / Inspire Winners (FTC)
    const impactEl = $('summary-impact');
    if (data.impact_finalists && data.impact_finalists.length > 0) {
        // Update section label based on program
        const impactLabel = impactEl.querySelector('.highlight-label');
        if (impactLabel) {
            impactLabel.textContent = isFTCMode() ? '⭐ Inspire Award Winners' : '⭐ Impact Award Finalists';
        }
        $('summary-impact-list').innerHTML = [...data.impact_finalists]
            .sort((a, b) => {
                const latestA = Math.max(0, ...(a.impact_years || []).map(Number).filter(Boolean));
                const latestB = Math.max(0, ...(b.impact_years || []).map(Number).filter(Boolean));
                return latestB - latestA || a.team_number - b.team_number;
            })
            .map(t => {
            const years = t.impact_years.join(', ');
            return `<div class="prestige-entry">
                <span class="prestige-entry-num prestige-num-impact">${t.team_number}</span>
                <span class="prestige-entry-name">${t.nickname}</span>
                ${years ? `<span class="prestige-entry-year">${years}</span>` : ''}
            </div>`;
        }).join('');
        impactEl.classList.remove('hidden');
        prestigeRow.classList.remove('hidden');
    } else {
        impactEl.classList.add('hidden');
    }
    // Hide row if both empty
    if (data.hall_of_fame.length === 0 && (!data.impact_finalists || data.impact_finalists.length === 0)) {
        prestigeRow.classList.add('hidden');
    }
    // Always hide Einstein prestige boxes for non-championship events
    if (!data.is_championship) {
        const ewEl = $('summary-einstein-winners');
        const ecEl = $('summary-einstein-contenders');
        if (ewEl) ewEl.classList.add('hidden');
        if (ecEl) ecEl.classList.add('hidden');
    }

    // Returning Event Champions & Finalists — lazy-load
    // (Championship divisions use a different payload — handled by _renderChampsSummaryAwards)
    const pastChampsEl = $('summary-past-champs');
    const pastAwardsEl = $('summary-past-awards');

    if (data.is_championship) {
        // Cached championship data — re-render directly
        _renderChampsSummaryAwards(data);
        const seasonToggleHideChamps = $('award-season-toggle');
        if (seasonToggleHideChamps) seasonToggleHideChamps.classList.add('hidden');
    } else if (isFTCMode()) {
        // FTC: Event Winners & Finalists above Prior Playoff Connections, full width
        const historyEl = $('summary-history');
        const container = historyEl?.parentNode;
        if (container && pastChampsEl) {
            container.insertBefore(pastChampsEl, historyEl);
            pastChampsEl.classList.add('ftc-full-width-card');
        }
        // FTC: show event winners & finalists if available (left card)
        if (data.ftc_event_champions && data.ftc_event_champions.length > 0) {
            pastChampsEl.querySelector('h3').textContent = 'Event Winners & Finalists';
            const champsFilterBar = $('champs-filter-bar');
            if (champsFilterBar) champsFilterBar.classList.add('hidden');
            // Sort by award weight: Inspire 1st > Winner > Finalist
            const _awardWeight = t => {
                const inspire1st = (t.years_inspire || []).filter(n => !/2nd/i.test(n));
                return (inspire1st.length ? 4 : 0)
                    + (t.years_won.length ? 2 : 0)
                    + (t.years_finalist.length ? 1 : 0);
            };
            const sorted = [...data.ftc_event_champions].sort((a, b) => _awardWeight(b) - _awardWeight(a));
            $('summary-past-champs-list').innerHTML = sorted.map(t => {
                const wonBadge = t.years_won.length ? '<span class="badge badge-winner">Winner</span>' : '';
                const finBadge = t.years_finalist.length ? '<span class="badge badge-finalist">Finalist</span>' : '';
                // Only highlight 1st-place Inspire (exclude 2nd place)
                const inspire1st = (t.years_inspire || []).filter(n => !/2nd/i.test(n));
                const inspireBadge = inspire1st.length ? '<span class="badge badge-inspire">Inspire</span>' : '';
                return '<div class="adv-qual-row">'
                    + '<span class="adv-team-num">' + t.team_number + '</span>'
                    + '<span class="adv-team-name">' + t.nickname + '</span>'
                    + '<span class="adv-right-group">' + inspireBadge + wonBadge + finBadge + '</span>'
                    + '</div>';
            }).join('');
            pastChampsEl.classList.remove('hidden');
        } else {
            pastChampsEl.classList.add('hidden');
        }

        // Hide FTC dynamic awards card if it exists (migrated to unified card)
        const ftcAwardsOld = $('summary-current-awards');
        if (ftcAwardsOld) ftcAwardsOld.classList.add('hidden');

        // FTC: Unified Award-Winning Teams card with season switcher
        // Reuse the same pastAwardsEl card that FRC uses — move to full-width above connections
        const historyEl2 = $('summary-history');
        const container2 = historyEl2?.parentNode;
        if (container2 && pastAwardsEl) {
            container2.insertBefore(pastAwardsEl, historyEl2);
            pastAwardsEl.classList.add('ftc-full-width-card');
        }
        const impactFilterBtn = pastAwardsEl.querySelector('[data-award-filter="impact"]');
        if (impactFilterBtn) impactFilterBtn.textContent = 'Inspire';
        pastAwardsEl.querySelector('h3').textContent = 'Award-Winning Teams';
        const ftcSeasonToggle = $('award-season-toggle');
        if (ftcSeasonToggle) {
            ftcSeasonToggle.classList.remove('hidden');
            const btns = ftcSeasonToggle.querySelectorAll('.award-season-btn');
            btns[0].textContent = String(currentEventYear);
            btns[1].textContent = String(data.ftc_past_season_year || (currentEventYear - 1));
        }
        const ftcFilterBar = pastAwardsEl.querySelector('.past-awards-filter-bar');
        if (ftcFilterBar) ftcFilterBar.classList.remove('hidden');

        // Store FTC season awards in summaryData so switchAwardSeason can find them
        if (data.ftc_season_awards && data.ftc_season_awards.length > 0) {
            // Convert FTC season awards to the same shape as FRC (past-award-chip format)
            summaryData.season_awards = data.ftc_season_awards;
        }
        if (data.ftc_past_season_awards && data.ftc_past_season_awards.length > 0) {
            summaryData.past_season_awards = data.ftc_past_season_awards;
        }

        // Default to current season tab
        currentAwardSeason = 'current';
        currentAwardFilter = 'all';
        if (ftcSeasonToggle) {
            ftcSeasonToggle.querySelectorAll('.award-season-btn').forEach(b =>
                b.classList.toggle('active', b.dataset.season === 'current'));
        }

        pastAwardsEl.classList.remove('hidden');
        if (summaryData.season_awards && summaryData.season_awards.length > 0) {
            renderPastSeasonAwards(summaryData.season_awards);
        } else if (summaryData.past_season_awards && summaryData.past_season_awards.length > 0) {
            // No current season awards — fall back to past
            currentAwardSeason = 'past';
            if (ftcSeasonToggle) ftcSeasonToggle.querySelectorAll('.award-season-btn').forEach(b =>
                b.classList.toggle('active', b.dataset.season === 'past'));
            renderPastSeasonAwards(summaryData.past_season_awards);
        } else if (!data.ftc_past_season_awards) {
            $('summary-past-awards-list').innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">Loading\u2026</p>';
            loadFtcPastAwards();
        } else {
            pastAwardsEl.classList.add('hidden');
        }
    } else {
        // FRC: restore past-champs and past-awards into pair-row
        const pairRow = document.querySelector('.summary-pair-row');
        if (pairRow && !pairRow.contains(pastChampsEl)) {
            pairRow.insertBefore(pastChampsEl, pairRow.firstChild);
        }
        if (pairRow && !pairRow.contains(pastAwardsEl)) {
            pairRow.appendChild(pastAwardsEl);
        }
        pastChampsEl.classList.remove('ftc-full-width-card');
        pastAwardsEl.classList.remove('ftc-full-width-card');
        // Reset titles in case we're switching from a champs to a regular event
        pastChampsEl.querySelector('h3').textContent = 'Returning Champions & Finalists';
        pastAwardsEl.querySelector('h3').textContent = 'Award-Winning Teams';
        const filterBar = pastAwardsEl.querySelector('.past-awards-filter-bar');
        if (filterBar) filterBar.classList.remove('hidden');
        // Reset "Inspire" back to "Impact" for FRC
        const impactBtn = pastAwardsEl.querySelector('[data-award-filter="impact"]');
        if (impactBtn) impactBtn.textContent = 'Impact';
        // Hide FTC awards card in FRC mode
        const ftcAwardsElHide = $('summary-current-awards');
        if (ftcAwardsElHide) ftcAwardsElHide.classList.add('hidden');
        const champsFilterBar = $('champs-filter-bar');
        if (champsFilterBar) champsFilterBar.classList.add('hidden');

        if (data.past_event_champions && data.past_event_champions.length > 0) {
            renderPastEventChampions(data.past_event_champions);
            pastChampsEl.classList.remove('hidden');
        } else if (!data.past_event_champions) {
            // Not yet fetched — keep hidden; loadSummaryAwards() will show it
            pastChampsEl.classList.add('hidden');
        } else {
            pastChampsEl.classList.add('hidden');
        }

        // FRC: Award-Winning Teams — season toggle (current year / previous year)
        // Only show the toggle for non-championship events. If is_championship is already
        // known (e.g. second render after loadSummaryAwards resolved), keep it hidden.
        const seasonToggle = $('award-season-toggle');
        if (seasonToggle && !summaryData.is_championship) {
            seasonToggle.classList.remove('hidden');
            const btns = seasonToggle.querySelectorAll('.award-season-btn');
            btns[0].textContent = String(currentEventYear);
            btns[1].textContent = String(currentEventYear - 1);
        }
        pastAwardsEl.querySelector('h3').textContent = 'Award-Winning Teams';
        const awardFilterBar = pastAwardsEl.querySelector('.past-awards-filter-bar');
        if (awardFilterBar) awardFilterBar.classList.remove('hidden');

        // Default to current season tab
        currentAwardSeason = 'current';
        currentAwardFilter = 'all';
        // Reset toggle button active states
        if (seasonToggle) {
            seasonToggle.querySelectorAll('.award-season-btn').forEach(b =>
                b.classList.toggle('active', b.dataset.season === 'current'));
        }

        if (data.season_awards && data.season_awards.length > 0) {
            renderPastSeasonAwards(data.season_awards);
            pastAwardsEl.classList.remove('hidden');
        } else if (!data.season_awards) {
            // Not yet fetched — keep hidden; loadSeasonAwards() will show it
            pastAwardsEl.classList.add('hidden');
            loadSeasonAwards();
        } else if (data.past_season_awards && data.past_season_awards.length > 0) {
            // No current season awards — fall back to past season tab
            currentAwardSeason = 'past';
            if (seasonToggle) seasonToggle.querySelectorAll('.award-season-btn').forEach(b =>
                b.classList.toggle('active', b.dataset.season === 'past'));
            renderPastSeasonAwards(data.past_season_awards);
            pastAwardsEl.classList.remove('hidden');
        } else if (!data.past_season_awards) {
            // Not yet fetched — keep hidden; loadSummaryAwards() will show it
            pastAwardsEl.classList.add('hidden');
        } else {
            pastAwardsEl.classList.add('hidden');
        }
    }

    // If awards haven't been loaded yet (undefined) or came back empty
    // (possibly due to a transient API failure), retry the fetch.
    // Skip for FTC — no past-event-champion / past-season-award API.
    const _noChamps = !data.is_championship && (!data.past_event_champions || data.past_event_champions.length === 0);
    const _noAwards = !data.is_championship && (!data.past_season_awards  || data.past_season_awards.length === 0);
    // For championship divisions, loadSummaryAwards fetches the champs-specific
    // payload (season_winners, einstein_contenders etc). Trigger it if not cached yet.
    const _noChampAwards = data.is_championship && !data.einstein_contenders;
    if ((_noChamps && _noAwards && !isFTCMode()) || _noChampAwards) {
        loadSummaryAwards();
    }

    // Pre-qualified teams (FRC only — cross-reference with regional pool)
    renderPrequalifiedTeams();

    // Advancement — lazy-load (only for completed events)
    const advEl = $('summary-advancement');
    if (currentEventStatus === 'completed' && !isFTCMode()) {
        advEl.classList.remove('hidden');
        if (data.advancement && (data.advancement.qualified_teams?.length || data.advancement.district_rankings?.length)) {
            renderAdvancement(data.advancement);
        } else if (!data.advancement) {
            $('summary-advancement-content').innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">Loading…</p>';
            loadSummaryAdvancement();
        } else {
            advEl.classList.add('hidden');
        }
    } else {
        advEl.classList.add('hidden');
    }

    // Prior connections — lazy-load on demand
    const histEl = $('summary-history');
    {
        histEl.classList.remove('hidden');
        if (data.connections && data.connections.length > 0) {
            // Connections came from cache — render immediately
            renderConnections(data.connections, 'all');
            document.querySelectorAll('.conn-filter-btn').forEach(b => b.classList.remove('active'));
            document.querySelector('.conn-filter-btn[data-conn-filter="all"]')?.classList.add('active');
        } else if (!data.connections) {
            // Not loaded yet — show placeholder, fetch in background
            $('summary-history-list').innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">Loading connections…</p>';
            loadSummaryConnections();
        } else {
            histEl.classList.add('hidden');
        }
    }

    // Top scorers
    renderTopScorers(data.top_scorers);

    // High scores (by match)
    renderHighScores(data.high_scores);
}

let currentConnFilter = 'all';
let currentConnSearch = '';
let currentConnSort = 'most';

function toggleSummarySection(type) {
    const bodyMap = {
        'past-champs': 'summary-past-champs-body',
        'past-awards': 'summary-past-awards-body',
    };
    const bodyId = bodyMap[type] || 'summary-past-awards-body';
    _toggleCollapse(bodyId, type + '-toggle-icon');
}

function toggleConnections() {
    _toggleCollapse('summary-history-body', 'conn-toggle-icon');
}

function filterConnections(filter, btn) {
    currentConnFilter = filter;
    document.querySelectorAll('.conn-filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    applyConnFilters();
}

function setConnSort(sort, btn) {
    currentConnSort = sort;
    document.querySelectorAll('.conn-sort-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    applyConnFilters();
}

function applyConnFilters() {
    currentConnSearch = ($('conn-team-search')?.value || '').trim();
    if (summaryData) renderConnections(summaryData.connections, currentConnFilter);
}

async function toggleConnRange(allTime) {
    if (!currentEvent || !summaryData) return;
    // Update toggle label styling (scoped to the summary connections card only)
    const card = $('summary-history');
    if (card) {
        const sides = card.querySelectorAll('.conn-range-side');
        if (sides.length === 2) {
            sides[0].classList.toggle('active', !allTime);
            sides[1].classList.toggle('active', allTime);
        }
    }
    const list = $('summary-history-list');

    try {
        let connections;
        if (allTime) {
            // Try cached all-time data first
            if (summaryData._connections_alltime) {
                connections = summaryData._connections_alltime;
            } else {
                list.innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">Loading connections…</p>';
                connections = await getActiveAPI().eventConnections(currentEvent, true);
                summaryData._connections_alltime = connections;
            }
        } else {
            // Past 3: use the original connections that came with the summary
            connections = summaryData._connections_past3 || summaryData.connections;
        }
        summaryData.connections = connections;
        applyConnFilters();
    } catch (err) {
        list.innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">Error loading connections.</p>';
    }
}

function toggleConnRow(el) {
    el.classList.toggle('expanded');
}

function renderConnections(connections, filter) {
    const search = currentConnSearch;

    let filtered = connections.filter(c => {
        // type filter
        if (filter === 'partners' && c.partnered_at.length === 0) return false;
        if (filter === 'opponents' && c.opponents_at.length === 0) return false;
        if (filter === 'winners' && !c.partnered_at.some(p => p.result === 'winner')) return false;
        if (filter === 'finalists' && !c.partnered_at.some(p => p.result === 'finalist')) return false;
        // team search
        if (search) {
            const q = search.toLowerCase();
            if (!String(c.team_a).includes(q) && !String(c.team_b).includes(q)
                && !c.team_a_name.toLowerCase().includes(q) && !c.team_b_name.toLowerCase().includes(q)) return false;
        }
        return true;
    });

    // Sort
    if (currentConnSort === 'recent') {
        filtered.sort((a, b) => {
            const ya = Math.max(...[...a.partnered_at, ...a.opponents_at].map(e => e.year));
            const yb = Math.max(...[...b.partnered_at, ...b.opponents_at].map(e => e.year));
            return yb - ya;
        });
    } else if (currentConnSort === 'oldest') {
        filtered.sort((a, b) => {
            const ya = Math.min(...[...a.partnered_at, ...a.opponents_at].map(e => e.year));
            const yb = Math.min(...[...b.partnered_at, ...b.opponents_at].map(e => e.year));
            return ya - yb;
        });
    } else {
        // 'most' — default: most total connections first
        filtered.sort((a, b) => (b.partnered_at.length + b.opponents_at.length) - (a.partnered_at.length + a.opponents_at.length));
    }

    if (filtered.length === 0) {
        $('summary-history-list').innerHTML = '<p class="empty" style="margin:.5rem 0;font-size:.82rem">No connections match this filter.</p>';
        return;
    }

    $('summary-history-list').innerHTML = filtered.map(c => {
        const partnerCount = c.partnered_at.length;
        const opponentCount = c.opponents_at.length;

        // Summary chips for the header
        const chips = [];
        const svgPartner = '<svg class="conn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 17a4 4 0 0 1-4 4H5a4 4 0 0 1-4-4 4 4 0 0 1 4-4h1"/><path d="M13 17a4 4 0 0 0 4 4h2a4 4 0 0 0 4-4 4 4 0 0 0-4-4h-1"/><path d="M7 13 5 3l4 2 3-2 3 2 4-2-2 10"/></svg>';
        const svgOpponent = '<svg class="conn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="M13 19l6-6"/><path d="M16 16l4 4"/><path d="M19 21l2-2"/><path d="M14.5 6.5 18 3h3v3l-3.5 3.5"/><path d="m5 14 4 4"/><path d="m7 17-2 2"/></svg>';
        if (partnerCount) chips.push(`<span class="conn-chip conn-chip-partner">${svgPartner} ${partnerCount}</span>`);
        if (opponentCount) chips.push(`<span class="conn-chip conn-chip-opponent">${svgOpponent} ${opponentCount}</span>`);

        // H2H record: calculate totals for header display
        let teamAHeader = `${c.team_a}`;
        let teamBHeader = `${c.team_b}`;
        let h2hLeaderTeam = null;
        if (c.opponents_at.length > 0) {
            const totalA = c.opponents_at.reduce((s, o) => s + (o.team_a_wins || 0), 0);
            const totalB = c.opponents_at.reduce((s, o) => s + (o.team_b_wins || 0), 0);
            const aLeads = totalA > totalB;
            const bLeads = totalB > totalA;
            teamAHeader = `${c.team_a}<span class="conn-h2h-wins${aLeads ? ' conn-h2h-wins-leader' : ''}">(<span class="conn-h2h-num">${totalA}</span>)</span>`;
            teamBHeader = `${c.team_b}<span class="conn-h2h-wins${bLeads ? ' conn-h2h-wins-leader' : ''}">(<span class="conn-h2h-num">${totalB}</span>)</span>`;
            if (aLeads) h2hLeaderTeam = c.team_a;
            else if (bLeads) h2hLeaderTeam = c.team_b;
        }

        // Detail lines (shown on expand) — two sections: Partners then Opponents
        let detailHtml = '';

        if (c.partnered_at.length > 0) {
            const partnerLines = c.partnered_at.map(p => {
                let resultBadge = '';
                let stagePill = '';
                if (p.result === 'winner') {
                    resultBadge = '<span class="conn-detail-result conn-result-winner">Winner</span>';
                } else if (p.result === 'finalist') {
                    resultBadge = '<span class="conn-detail-result conn-result-finalist">Finalist</span>';
                } else {
                    stagePill = `<span class="conn-detail-stage">${p.stage}</span>`;
                }
                return `<div class="conn-detail-line conn-line-partner">
                    <span class="conn-detail-event-year"><span class="conn-year-lbl">${p.year}</span><span class="conn-year-sep">·</span><span class="conn-evt-name">${p.event_name || p.event_key}</span></span>
                    ${stagePill}
                    ${resultBadge}
                </div>`;
            }).join('');
            detailHtml += `<div class="conn-section">
                <div class="conn-section-label">${svgPartner} Partners</div>
                ${partnerLines}
            </div>`;
        }

        if (c.opponents_at.length > 0) {
            const oppLines = c.opponents_at.map(o => {
                const stagePill = o.stage ? `<span class="conn-detail-stage">${o.stage}</span>` : '';
                let leaderPill = '';
                if (o.team_a_wins !== undefined && o.team_b_wins !== undefined) {
                    if (o.team_a_wins > o.team_b_wins) leaderPill = `<span class="conn-chip conn-chip-h2h-leader">${c.team_a}</span>`;
                    else if (o.team_b_wins > o.team_a_wins) leaderPill = `<span class="conn-chip conn-chip-h2h-leader">${c.team_b}</span>`;
                }
                return `<div class="conn-detail-line conn-line-opponent">
                    <span class="conn-detail-event-year"><span class="conn-year-lbl">${o.year}</span><span class="conn-year-sep">·</span><span class="conn-evt-name">${o.event_name || o.event_key}</span></span>
                    ${stagePill}${leaderPill}
                </div>`;
            }).join('');
            detailHtml += `<div class="conn-section">
                <div class="conn-section-label conn-section-label-opp">${svgOpponent} Opponents</div>
                ${oppLines}
            </div>`;
        }

        return `
        <div class="conn-row" onclick="toggleConnRow(this)">
            <div class="conn-row-header">
                <span class="conn-team has-tooltip">${teamAHeader}<span class="custom-tooltip">${c.team_a_name}</span></span>
                <span class="conn-vs">&amp;</span>
                <span class="conn-team has-tooltip">${teamBHeader}<span class="custom-tooltip">${c.team_b_name}</span></span>
                <span class="conn-chips">${chips.join('')}</span>
                <span class="conn-expand-icon">▸</span>
            </div>
            <div class="conn-row-details">${detailHtml}</div>
        </div>`;
    }).join('');
}

function renderTopScorers(scorers) {
    const el = $('summary-top-scorers');
    if (!scorers || scorers.length === 0) { if (el) el.classList.add('hidden'); return; }
    if (scorers.length > 0) {
        const medals = ['1st', '2nd', '3rd'];
        $('summary-top-list').innerHTML = scorers.map((s, i) => `
            <div class="summary-top-row">
                <span class="top-medal">${medals[i] || ''}</span>
                <span class="top-team-num">${s.team_number}</span>
                <span class="top-team-name">${s.nickname}</span>
                <span class="top-opr">OPR ${s.opr}</span>
                <span class="top-rank">${s.rank !== '-' ? `Rank #${s.rank}` : ''}</span>
            </div>`).join('');
        el.classList.remove('hidden');
    } else {
        el.classList.add('hidden');
    }
}

function renderHighScores(scores) {
    const el = $('summary-high-scores');
    if (!el) return;
    if (!scores || scores.length === 0) {
        el.classList.add('hidden');
        return;
    }
    const medals = ['1st', '2nd', '3rd'];
    $('summary-high-list').innerHTML = scores.map((s, i) => {
        const colorCls = s.color === 'red' ? 'high-score-red' : 'high-score-blue';
        const teamNums = s.teams.map(t => {
            const nick = (_timsCache[t.team_number]?.nickname) || t.nickname;
            return `<span class="high-score-team has-tooltip">${t.team_number}${nick ? `<span class="custom-tooltip">${nick}</span>` : ''}</span>`;
        }).join(', ');
        return `
            <div class="summary-high-row">
                <span class="top-medal">${medals[i] || ''}</span>
                <span class="high-score-val ${colorCls}">${s.score}</span>
                <span class="high-score-match">${s.match}</span>
                <span class="high-score-teams">${teamNums}</span>
            </div>`;
    }).join('');
    el.classList.remove('hidden');
}


