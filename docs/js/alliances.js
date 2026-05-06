/* ═══════════════════════════════════════════════════════════
   alliances.js — extracted from app.js

   Loaded as a classic <script> *before* app.js. Top-level
   declarations live in the shared global declarative
   environment, so cross-file references work as before.
   Section: 3. ALLIANCE SELECTION
   ═══════════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════════════
// 3. ALLIANCE SELECTION
// ═══════════════════════════════════════════════════════════

/** Wrap a flat FTC alliance array into the object shape renderAlliances expects. */
function _wrapFtcAlliances(data) {
    const wrapped = {
        alliances: data.map(a => ({
            number: a.number,
            name: a.name,
            teams: (a.pick_numbers || []).map(num => ({
                team_key: `ftc${num}`,
                team_number: num,
                nickname: '',
                avatar: null,
                opr: 0,
                epa: null,
                rank: '-',
                wins: 0, losses: 0, ties: 0,
                country: '',
                rookie_year: null,
            })),
            combined_opr: 0,
            combined_epa: null,
            playoff_result: null,
            playoff_type: null,
            playoff_record: null,
        })),
        partnerships: [],
        max_combined_opr: 0,
    };
    if (teamsData) {
        const nameMap = new Map(teamsData.map(t => [t.team_number, t]));
        wrapped.alliances.forEach(a => {
            a.teams.forEach(t => {
                const td = nameMap.get(t.team_number);
                if (td) {
                    t.nickname = td.nickname || '';
                    t.opr = td.opr || 0;
                    t.avatar = td.avatar || null;
                    t.rank = td.rank || '-';
                    t.wins = td.wins || 0;
                    t.losses = td.losses || 0;
                    t.ties = td.ties || 0;
                    t.country = td.country || '';
                    t.rookie_year = td.rookie_year || null;
                }
            });
            a.combined_opr = a.teams.reduce((s, t) => s + (parseFloat(t.opr) || 0), 0);
        });
        wrapped.max_combined_opr = Math.max(...wrapped.alliances.map(a => a.combined_opr), 0);
    }
    // Patch any remaining missing avatars from the FTC avatar map
    if (_ftcAvatarMap && _ftcAvatarMap.size > 0) {
        wrapped.alliances.forEach(a => a.teams.forEach(t => {
            if (!t.avatar) { const url = _ftcAvatarMap.get(t.team_number); if (url) t.avatar = url; }
        }));
    }
    return wrapped;
}

async function loadAlliances() {
    if (!currentEvent) return;
    hide('alliance-empty');
    hideInlineError('alliance-error');
    showSkeleton('alliance-loading', 'alliance-loading-status', 'Fetching alliance selections\u2026');
    try {
        setLoadingStatus('alliance-loading-status', isFTCMode() ? 'Loading alliance selections\u2026' : 'Loading partnerships & EPA data\u2026');
        const data = await getActiveAPI().alliances(currentEvent);

        // FTC returns a flat array; normalise to the object shape FRC uses
        if (isFTCMode()) {
            if (!data || !Array.isArray(data) || data.length === 0) {
                hideSkeleton('alliance-loading');
                showInlineError('alliance-error', 'Alliance selections are not available for this event yet.', loadAlliances);
                return;
            }
            allianceData = _wrapFtcAlliances(data);
        } else {
            allianceData = data;
        }

        hideSkeleton('alliance-loading');
        renderAlliances(allianceData);
        fadeIn('alliance-grid');
        autoCacheTab('alliances', allianceData);
        updateTabDots();
    } catch (err) {
        hideSkeleton('alliance-loading');
        const msg = err && err.message ? err.message : 'An unknown error occurred.';
        showInlineError('alliance-error', `Failed to load alliances: ${msg}`, loadAlliances);
    }
}

function toggleAllianceAvatars(on) {
    allianceShowAvatars = on;
    if (allianceData) renderAlliances(allianceData);
}
function toggleAllianceEpa(on) {
    allianceShowEpa = on;
    if (allianceData) renderAlliances(allianceData);
}
function toggleAlliancePlayoff(on) {
    allianceShowPlayoff = on;
    if (allianceData) renderAlliances(allianceData);
}
function toggleAllianceAttrs(on) {
    allianceShowAttrs = on;
    if (allianceData) renderAlliances(allianceData);
}

function renderAlliances(data) {
    const { alliances, partnerships, max_combined_opr } = data;
    if (!alliances.length) {
        $('alliance-grid').innerHTML = '<p class="empty">Alliance selection has not occurred yet.</p>';
        return;
    }

    // Show toolbar once data is loaded
    const tb = $('alliance-toolbar');
    if (tb) tb.classList.remove('hidden');

    // Use pick_label from the backend (already correct for championship vs regular events)
    // Championship: Captain / 1st Pick / 2nd Pick / 3rd Pick — no backups
    // Regular events: Captain / 1st Pick / 2nd Pick / Backup (for emergency replacements)
    const getRoleLabel = (t) => t.pick_label || '';

    // Compute event-average OPR and EPA for highlighting
    const allOPRs = alliances.flatMap(a => a.teams.map(t => parseFloat(t.opr))).filter(v => !isNaN(v));
    allOPRs.sort((a, b) => a - b);
    const avgEventOPR = allOPRs.length > 0 ? allOPRs.reduce((s, v) => s + v, 0) / allOPRs.length : 0;
    const p75EventOPR = allOPRs.length > 0 ? allOPRs[Math.floor(allOPRs.length * 0.75)] : 0;
    const allEPAs = alliances.flatMap(a => a.teams.map(t => parseFloat(t.epa))).filter(v => !isNaN(v));
    allEPAs.sort((a, b) => a - b);
    const avgEventEPA = allEPAs.length > 0 ? allEPAs.reduce((s, v) => s + v, 0) / allEPAs.length : 0;
    const p75EventEPA = allEPAs.length > 0 ? allEPAs[Math.floor(allEPAs.length * 0.75)] : 0;

    $('alliance-grid').innerHTML = alliances.map(a => {
        const strengthPct = max_combined_opr ? Math.round((a.combined_opr / max_combined_opr) * 100) : 0;

        // Playoff ribbon (conditional)
        let ribbonHtml = '';
        let cardCls = '';
        if (allianceShowPlayoff && a.playoff_result) {
            const ribbonCls = a.playoff_type ? `ribbon-${a.playoff_type}` : '';
            ribbonHtml = `<span class="playoff-ribbon ${ribbonCls}">${a.playoff_type === 'winner' ? '🏆 ' : ''}${a.playoff_result}${a.playoff_record ? ` (${a.playoff_record})` : ''}</span>`;
            cardCls = a.playoff_type ? 'alliance-' + a.playoff_type : '';
        }

        // Combined stats
        const epaHtml = allianceShowEpa
            ? `<span class="combined-epa">Σ EPA ${a.combined_epa != null ? a.combined_epa : '\u2013'}</span>`
            : '';
        const epaDetailHtml = allianceShowEpa
            ? `<div class="alliance-epa-detail-row">`
              + `<span class="combined-epa-detail">Auto ${a.combined_epa_auto != null ? a.combined_epa_auto : '\u2013'}</span>`
              + `<span class="combined-epa-detail">Teleop ${a.combined_epa_teleop != null ? a.combined_epa_teleop : '\u2013'}</span>`
              + `<span class="combined-epa-detail">Endgame ${a.combined_epa_endgame != null ? a.combined_epa_endgame : '\u2013'}</span>`
              + `</div>`
            : '';

        // Collect all partnerships for this alliance into a summary section
        const partnerSummary = [];
        const seen = new Set();
        a.teams.forEach((t) => {
            a.teams.forEach((other) => {
                if (t.team_key === other.team_key) return;
                const pairKey = [t.team_key, other.team_key].sort().join('+');
                if (seen.has(pairKey)) return;
                seen.add(pairKey);
                const p = partnerships[pairKey]
                         || partnerships[`${t.team_key}+${other.team_key}`]
                         || partnerships[`${other.team_key}+${t.team_key}`];
                if (p && p.history && p.history.length > 0) {
                    const tooltipRows = p.history.map(h =>
                        `<div class="tip-row">${h.year} &mdash; ${h.event_name.replace(/</g, '&lt;')}</div>`
                    ).join('');
                    partnerSummary.push(`<span class="badge returning has-tooltip">⟳ ${t.team_number} + ${other.team_number} (${p.history.length}×)<span class="custom-tooltip">${tooltipRows}</span></span>`);
                }
            });
        });

        return `
        <div class="alliance-card ${cardCls}">
            <div class="alliance-header">
                <div class="alliance-header-left">
                    <h3>${a.name || 'Alliance ' + a.number}</h3>
                    ${ribbonHtml}
                </div>
                <div class="alliance-header-stats">
                    <div class="alliance-header-stats-row-1">
                        <span class="combined-opr">Σ OPR ${typeof a.combined_opr === 'number' ? a.combined_opr.toFixed(2) : a.combined_opr}</span>
                        ${epaHtml}
                    </div>
                    ${epaDetailHtml}
                </div>
            </div>
            <div class="alliance-strength-bar"><div class="alliance-strength-fill" style="width:${strengthPct}%"></div></div>
            <div class="alliance-teams-list">
                ${a.teams.map((t, idx) => {
                    const avatarHtml = allianceShowAvatars
                        ? (t.avatar
                            ? `<img class="alliance-team-avatar" src="${t.avatar}" alt="">`
                            : `<div class="alliance-team-avatar-placeholder">${isFTCMode() ? 'FTC' : 'FRC'}</div>`)
                        : '';

                    const isIntl = highlightForeign && t.country && eventCountry && t.country !== eventCountry;
                    const isRookie = highlightRookie && t.rookie_year && currentEventYear && t.rookie_year >= currentEventYear;

                    const oprVal = parseFloat(t.opr);
                    const oprCls = !isNaN(oprVal) && oprVal >= p75EventOPR ? ' opr-top25' : (!isNaN(oprVal) && oprVal > avgEventOPR ? ' opr-above-avg' : '');

                    const epaVal = parseFloat(t.epa);
                    const epaCls = !isNaN(epaVal) && epaVal >= p75EventEPA ? ' epa-top25' : (!isNaN(epaVal) && epaVal > avgEventEPA ? ' epa-above-avg' : '');
                    const teamEpaHtml = allianceShowEpa
                        ? `<span class="stat-epa${epaCls}">EPA ${t.epa != null ? t.epa : '\u2013'}</span>`
                        : '';

                    return `
                    <div class="alliance-team-row${isIntl ? ' foreign-team-row' : ''}${isRookie ? ' rookie-team-row' : ''}${/captain/i.test(t.pick_label || '') ? ' alliance-team-captain' : ''}" data-country="${t.country || ''}" data-rookie-year="${t.rookie_year || ''}" data-role="${(t.pick_label || '').toLowerCase().replace(/\s+/g, '-')}">
                        <span class="team-role">${getRoleLabel(t)}</span>
                        ${avatarHtml}
                        <span class="team-num has-tooltip">${_renderTeamNum(t)}${(_timsCache[t.team_number]?.nickname || t.nickname) ? `<span class="custom-tooltip">${_timsCache[t.team_number]?.nickname || t.nickname}</span>` : ''}</span>
                        ${allianceShowAttrs ? _renderBdTags(t.team_number) : ''}
                        ${allianceShowNames ? `<span class="team-nick">${_timsCache[t.team_number]?.nickname || t.nickname || ''}</span>` : ''}
                        <div class="team-stats-mini">
                            <span${Number(t.rank) >= 1 && Number(t.rank) <= 8 ? ' class="rank-top8"' : ''}>Rank ${t.rank}</span>
                            <span>${t.wins}-${t.losses}-${t.ties}</span>
                            <span class="stat-opr${oprCls}">OPR ${t.opr}</span>
                            ${teamEpaHtml}
                        </div>
                    </div>`;
                }).join('')}
            </div>
            ${partnerSummary.length ? `<div class="alliance-partners-row">${partnerSummary.join('')}</div>` : ''}
        </div>`;
    }).join('');
}


