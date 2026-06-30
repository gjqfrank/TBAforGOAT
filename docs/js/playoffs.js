/* ═══════════════════════════════════════════════════════════
   playoffs.js — extracted from app.js

   Loaded as a classic <script> *before* app.js. Top-level
   declarations live in the shared global declarative
   environment, so cross-file references work as before.
   Section: 2. PLAYOFFS
   ═══════════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════════════
// 2. PLAYOFFS
// ═══════════════════════════════════════════════════════════
async function loadPlayoffs() {
    if (!currentEvent) return;
    hideInlineError('playoff-error');
    try {
        setLoadingStatus('playoff-loading-status', 'Fetching playoff matches\u2026');
        const data = await getActiveAPI().playoffMatches(currentEvent);
        playoffData = data.matches;
        hideSkeleton('playoff-loading');
        if (!playoffData?.length) {
            const el = $('playoff-empty');
            if (el) {
                el.textContent = currentEventStatus === 'upcoming'
                    ? 'The playoff schedule for this event has not been published yet.'
                    : 'No playoff data available for this event.';
                el.classList.remove('hidden');
            }
            return;
        }
        hide('playoff-empty');
        renderBracketTree();
        fadeIn('playoff-bracket');
        updateTabDots();
    } catch (err) {
        hideSkeleton('playoff-loading');
        showInlineError('playoff-error', `Failed to load playoffs: ${err.message}`, loadPlayoffs);
    }
}

// ── Playoff auto-refresh ──────────────────────────────────
function startPlayoffRefresh() {
    stopPlayoffRefresh();
    if (currentEventStatus !== 'ongoing') return;
    // Realtime handles live updates — no setInterval needed.
}

function stopPlayoffRefresh() {
    if (playoffRefreshTimer) {
        clearInterval(playoffRefreshTimer);
        playoffRefreshTimer = null;
    }
}

async function playoffAutoRefresh() {
    if (!currentEvent) { stopPlayoffRefresh(); return; }
    try {
        const data = await getActiveAPI().playoffMatches(currentEvent);
        if (!data?.matches?.length || currentEvent !== data.event_key) return;
        playoffData = data.matches;
        if (renderedTabs.playoff) {
            renderBracketTree();
        }
    } catch (_) { /* silently ignore */ }
}

/* ── FRC Double-Elimination Bracket Tree ─────────────────── */

// Upper bracket structure: sets that merge
// [pair] → winner
const UPPER_R1_PAIRS = [[1, 2], [3, 4]]; // → sets 7, 8
const UPPER_R2_PAIR  = [7, 8];           // → set 11

// Lower bracket structure
const LOWER_R2_SETS  = [5, 6];         // L(R1) play-in
const LOWER_R3_SETS  = [9, 10];        // W(R2L) vs L(R2U)
const LOWER_R3_PAIR  = [9, 10];        // → set 12
const LOWER_R5_SET   = 13;             // W(12) vs L(11)

// Descriptions for each set
const SET_DESCRIPTIONS = {
    1: '#1 vs #8', 2: '#4 vs #5', 3: '#2 vs #7', 4: '#3 vs #6',
    5: 'L1 vs L2', 6: 'L3 vs L4',
    7: 'W1 vs W2', 8: 'W3 vs W4',
    9: 'W5 vs L8', 10: 'W6 vs L7',
    11: 'W7 vs W8', 12: 'W9 vs W10', 13: 'W12 vs L11',
    'f': 'W11 vs W13'
};

function renderBracketTree() {
    if (!playoffData || !playoffData.length) {
        $('playoff-bracket').innerHTML = '<p class="empty">No playoff matches found.</p>';
        return;
    }

    // Index matches by set_number; keep latest replay per set
    const bySet = {};
    const finals = [];
    playoffData.forEach(m => {
        if (m.bracket === 'final') {
            finals.push(m);
        } else {
            const s = m.set_number;
            if (!bySet[s] || m.match_number > bySet[s].match_number) bySet[s] = m;
        }
    });
    // Index finals by match_number so we can render all of them
    const finalsByNum = {};
    finals.forEach(m => { finalsByNum[m.match_number] = m; });
    // If no finals exist yet, ensure a placeholder slot for Final 1
    const finalNums = Object.keys(finalsByNum).map(Number).sort((a, b) => a - b);
    if (!finalNums.length) finalNums.push(1);

    // Build team_number -> nickname map from loaded teamsData
    const _nickMap = {};
    if (teamsData) teamsData.forEach(t => { if (t.nickname) _nickMap[t.team_number] = t.nickname; });
    const _teamSpan = (num) => {
        const nick = _nickMap[num];
        return nick
            ? `<span class="has-tooltip bkt-team-num">${num}<span class="custom-tooltip">${nick}</span></span>`
            : `<span class="bkt-team-num">${num}</span>`;
    };
    const _teamsHtml = (nums) => nums.map(_teamSpan).join(' · ');

    // Render helpers
    const slot = (setNum, label) => {
        let m;
        if (typeof setNum === 'string' && setNum.startsWith('f')) {
            m = finalsByNum[parseInt(setNum.substring(1), 10)];
        } else {
            m = bySet[setNum];
        }
        const desc = SET_DESCRIPTIONS[setNum] || '';
        if (!m) {
            return `<div class="bkt-slot bkt-tbd">
                        <div class="bkt-slot-header">${label}</div>
                        <div class="bkt-slot-body"><span class="bkt-tbd-text">TBD</span></div>
                        ${desc ? `<div class="bkt-slot-desc">${desc}</div>` : ''}
                    </div>`;
        }
        const redWon  = m.winning_alliance === 'red';
        const blueWon = m.winning_alliance === 'blue';
        const upcoming = m.red.score < 0 && m.blue.score < 0;
        const redLost = blueWon;
        const blueLost = redWon;
        const replay = m.match_number > 1 ? ` <span class="bkt-replay">R${m.match_number}</span>` : '';
        // For Einstein: show division name instead of seed number
        const _seedLabel = (num) => {
            if (!num) return '';
            if (allianceData && allianceData.is_einstein && allianceData.division_names && allianceData.division_names[num]) {
                return `<span class="bkt-seed bkt-seed-div">${allianceData.division_names[num]}</span>`;
            }
            return `<span class="bkt-seed">#${num}</span>`;
        };
        const redSeed  = m.red.alliance_number  ? _seedLabel(m.red.alliance_number)  : '';
        const blueSeed = m.blue.alliance_number ? _seedLabel(m.blue.alliance_number) : '';
        return `<div class="bkt-slot ${upcoming ? 'bkt-upcoming' : ''} ${redWon || blueWon ? 'bkt-decided' : ''}">
                    <div class="bkt-slot-header">${label}${replay}</div>
                    <div class="bkt-row bkt-red ${redWon ? 'bkt-won' : ''}${redLost ? ' bkt-lost' : ''}">
                        ${redSeed}
                        <span class="bkt-teams">${_teamsHtml(m.red.team_numbers)}</span>
                        <span class="bkt-score">${upcoming ? '–' : m.red.score}</span>
                    </div>
                    <div class="bkt-row bkt-blue ${blueWon ? 'bkt-won' : ''}${blueLost ? ' bkt-lost' : ''}">
                        ${blueSeed}
                        <span class="bkt-teams">${_teamsHtml(m.blue.team_numbers)}</span>
                        <span class="bkt-score">${upcoming ? '–' : m.blue.score}</span>
                    </div>
                    ${desc ? `<div class="bkt-slot-desc">${desc}</div>` : ''}
                </div>`;
    };

    $('playoff-bracket').innerHTML = `
        <div class="bracket-grid">
            <!-- ── Round headers ─────────────────── -->
            <div class="bg-corner"></div>
            <div class="bg-rnd-hdr">Round 1</div>
            <div class="bg-rnd-hdr">Round 2</div>
            <div class="bg-rnd-hdr">Round 3</div>
            <div class="bg-rnd-hdr">Round 4</div>
            <div class="bg-rnd-hdr">Round 5</div>
            <div class="bg-rnd-hdr bg-rnd-hdr-final">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                Finals
            </div>

            <!-- ── Upper bracket row ─────────────── -->
            <div class="bg-side-label bg-upper-label">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>
                Upper
            </div>
            <div class="bg-cell bg-cell-upper">
                ${slot(1, 'M1')}${slot(2, 'M2')}${slot(3, 'M3')}${slot(4, 'M4')}
            </div>
            <div class="bg-cell bg-cell-upper">
                ${slot(7, 'M7')}${slot(8, 'M8')}
            </div>
            <div class="bg-cell bg-cell-upper bg-cell-empty"></div>
            <div class="bg-cell bg-cell-upper">
                ${slot(11, 'M11')}
            </div>
            <div class="bg-cell bg-cell-upper bg-cell-empty"></div>
            <div class="bg-cell bg-cell-final">
                ${finalNums.map(n => slot('f' + n, 'Final ' + n)).join('')}
            </div>

            <!-- ── Lower bracket row ─────────────── -->
            <div class="bg-side-label bg-lower-label">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                Lower
            </div>
            <div class="bg-cell bg-cell-lower bg-cell-empty"></div>
            <div class="bg-cell bg-cell-lower">
                ${slot(5, 'M5')}${slot(6, 'M6')}
            </div>
            <div class="bg-cell bg-cell-lower">
                ${slot(9, 'M9')}${slot(10, 'M10')}
            </div>
            <div class="bg-cell bg-cell-lower">
                ${slot(12, 'M12')}
            </div>
            <div class="bg-cell bg-cell-lower">
                ${slot(13, 'M13')}
            </div>
            <!-- Finals column already spans into this row -->
        </div>
        ${_buildMobileBracket(slot, finalNums)}
    `;

    // Append scroll-to-finals button to tab-playoff (outside the scroll container)
    let arrowWrapper = document.getElementById('bracket-scroll-wrapper');
    if (!arrowWrapper) {
        arrowWrapper = document.createElement('div');
        arrowWrapper.id = 'bracket-scroll-wrapper';
        arrowWrapper.className = 'bracket-scroll-arrow-wrapper';
        arrowWrapper.innerHTML = `<button class="bracket-scroll-arrow" id="bracket-scroll-finals" onclick="scrollBracketToFinals()" title="Scroll to Finals">
                Finals
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>`;
        $('tab-playoff').appendChild(arrowWrapper);
    }

    // Set up scroll-based visibility for the arrow
    _setupBracketScrollArrow();
}



/* ── Bracket scroll-to-finals arrow ──────────────────────── */
function scrollBracketToFinals() {
    const container = $('playoff-bracket');
    if (!container) return;
    container.scrollTo({ left: container.scrollWidth, behavior: 'smooth' });
}

function _setupBracketScrollArrow() {
    const container = $('playoff-bracket');
    const arrow = $('bracket-scroll-finals');
    if (!container || !arrow) return;
    const wrapper = arrow.parentElement;

    const updateArrow = () => {
        const atEnd = container.scrollLeft + container.clientWidth >= container.scrollWidth - 20;
        const needsScroll = container.scrollWidth > container.clientWidth + 20;
        const shouldHide = atEnd || !needsScroll;
        arrow.classList.toggle('hidden', shouldHide);
        if (wrapper) wrapper.classList.toggle('hidden', shouldHide);
    };
    updateArrow();
    container.addEventListener('scroll', updateArrow, { passive: true });
    // Also update on resize
    new ResizeObserver(updateArrow).observe(container);

    // ── Parent-match highlighting on hover ─────────────────
    _setupBracketHover();
}

/* FRC double-elim bracket parent map: match → its feeder matches */
const _BKT_PARENTS = {
    7: [1, 2],   8: [3, 4],          // Upper R2 from Upper R1
    5: [1, 2],   6: [3, 4],          // Lower R2 from losers of Upper R1
    9: [5, 8],   10: [6, 7],         // Lower R3: W5 vs L8, W6 vs L7
    11: [7, 8],                       // Upper R4
    12: [9, 10],                      // Lower R4
    13: [11, 12],                     // Lower R5
    'f1': [11, 13],                   // Final from upper winner + lower winner
};

function _setupBracketHover() {
    const container = $('playoff-bracket');
    if (!container) return;

    // Build a map from set_number/label → DOM element
    const slotEls = container.querySelectorAll('.bkt-slot');
    const slotMap = {};
    slotEls.forEach(el => {
        const header = el.querySelector('.bkt-slot-header');
        if (!header) return;
        const text = header.textContent.trim();
        // Parse "M1", "M7", "Final 1" etc.
        const mMatch = text.match(/^M(\d+)/);
        const fMatch = text.match(/^Final\s*(\d+)/i);
        if (mMatch) slotMap[parseInt(mMatch[1])] = el;
        else if (fMatch) slotMap['f' + fMatch[1]] = el;
    });

    slotEls.forEach(el => {
        el.addEventListener('mouseenter', () => {
            const header = el.querySelector('.bkt-slot-header');
            if (!header) return;
            const text = header.textContent.trim();
            const mMatch = text.match(/^M(\d+)/);
            const fMatch = text.match(/^Final\s*(\d+)/i);
            const key = mMatch ? parseInt(mMatch[1]) : (fMatch ? 'f' + fMatch[1] : null);
            if (key == null) return;

            // Collect direct parent matches only (not grandparents)
            const parents = new Set();
            const direct = _BKT_PARENTS[key];
            if (direct) direct.forEach(p => parents.add(p));

            if (parents.size === 0) return;

            // Dim all slots, highlight parents
            slotEls.forEach(s => {
                const h = s.querySelector('.bkt-slot-header');
                if (!h) return;
                const t = h.textContent.trim();
                const mm = t.match(/^M(\d+)/);
                const fm = t.match(/^Final\s*(\d+)/i);
                const sk = mm ? parseInt(mm[1]) : (fm ? 'f' + fm[1] : null);
                if (sk === key) return; // don't modify the hovered slot
                if (parents.has(sk)) {
                    s.classList.add('bkt-highlight-parent');
                    s.classList.remove('bkt-dim');
                } else {
                    s.classList.add('bkt-dim');
                    s.classList.remove('bkt-highlight-parent');
                }
            });
        });

        el.addEventListener('mouseleave', () => {
            slotEls.forEach(s => {
                s.classList.remove('bkt-highlight-parent', 'bkt-dim');
            });
        });
    });
}

/* ── Mobile bracket: vertical stacked rounds ────────────── */
function _buildMobileBracket(slot, finalNums) {
    const rounds = [
        {
            label: 'Round 1',
            tag: 'upper', tagLabel: 'Upper',
            matches: [[1,'M1'],[2,'M2'],[3,'M3'],[4,'M4']],
        },
        {
            label: 'Round 2',
            tag: 'mixed',
            sections: [
                { tag: 'upper', tagLabel: 'Upper', matches: [[7,'M7'],[8,'M8']] },
                { tag: 'lower', tagLabel: 'Lower', matches: [[5,'M5'],[6,'M6']] },
            ],
        },
        {
            label: 'Round 3',
            tag: 'lower', tagLabel: 'Lower',
            matches: [[9,'M9'],[10,'M10']],
        },
        {
            label: 'Round 4',
            tag: 'mixed',
            sections: [
                { tag: 'upper', tagLabel: 'Upper', matches: [[11,'M11']] },
                { tag: 'lower', tagLabel: 'Lower', matches: [[12,'M12']] },
            ],
        },
        {
            label: 'Round 5',
            tag: 'lower', tagLabel: 'Lower',
            matches: [[13,'M13']],
        },
        {
            label: 'Finals',
            tag: 'final',
            matches: finalNums.map(n => ['f' + n, 'Final ' + n]),
            isFinal: true,
        },
    ];

    const chevron = '<svg class="bkt-m-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>';

    return `<div class="bracket-mobile">${rounds.map(r => {
        const hdrCls = r.isFinal ? ' bkt-m-round-hdr-final' : '';
        let bodyHtml = '';
        if (r.sections) {
            bodyHtml = r.sections.map(s => {
                const tag = `<span class="bkt-m-bracket-tag bkt-m-tag-${s.tag}">${s.tagLabel}</span>`;
                return tag + s.matches.map(([set, lbl]) => slot(set, lbl)).join('');
            }).join('');
        } else {
            const tag = r.tagLabel ? `<span class="bkt-m-bracket-tag bkt-m-tag-${r.tag}">${r.tagLabel}</span>` : '';
            bodyHtml = tag + r.matches.map(([set, lbl]) => slot(set, lbl)).join('');
        }
        return `<div class="bkt-m-round">
            <div class="bkt-m-round-hdr${hdrCls}" onclick="this.parentElement.classList.toggle('collapsed')">
                <span>${r.label}</span>
                ${chevron}
            </div>
            <div class="bkt-m-round-body">${bodyHtml}</div>
        </div>`;
    }).join('')}</div>`;
}


