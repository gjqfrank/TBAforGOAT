#!/usr/bin/env node
/* ───────────────────────────────────────────────────────────────────
 * benchmark_pbp_render.js — v3 PBP render benchmark
 *
 *   Simulates a Supabase-Realtime burst: 50 score-update payloads/sec
 *   for 10 seconds (= 500 renders) against two renderers:
 *
 *     • legacy : element.innerHTML = `<huge template literal>`
 *     • v3     : score-only diff → patch two textNodes
 *
 *   …in two profiles:
 *
 *     • FRC : 3-team alliances, 13 stat fields/team, timeline burst
 *     • FTC : 2-team alliances, 8  stat fields/team, smaller payload
 *
 *   Output: average / p50 / p95 / p99 render time (ms) and total wall time.
 *
 * Usage:
 *   npm i --save-dev jsdom
 *   node scripts/benchmark_pbp_render.js
 *   node scripts/benchmark_pbp_render.js --rate 100 --secs 5 --profile frc
 * ─────────────────────────────────────────────────────────────────── */
'use strict';

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch {
    console.error('✗ jsdom missing.  Install with:  npm i --save-dev jsdom');
    process.exit(1);
}

// ── CLI ──────────────────────────────────────────────────────────────
const argv = require('node:util').parseArgs({
    options: {
        rate:    { type: 'string', default: '50' },   // updates/sec
        secs:    { type: 'string', default: '10' },   // duration
        profile: { type: 'string', default: 'both' }, // frc | ftc | both
        warmup:  { type: 'string', default: '50' },   // warmup renders
    },
}).values;

const RATE     = parseInt(argv.rate,   10);
const SECS     = parseInt(argv.secs,   10);
const TOTAL    = RATE * SECS;
const WARMUP   = parseInt(argv.warmup, 10);
const PROFILES = argv.profile === 'both' ? ['frc', 'ftc'] : [argv.profile];

// ── Synthetic match payload generators ───────────────────────────────
function makeTeam(num, profile) {
    const base = {
        team_number: num,
        nickname: `Team ${num} Robotics`,
        city: 'Houston', state_prov: 'TX', country: 'USA',
        rookie_year: 2010 + (num % 15),
        wins: (num * 7) % 13, losses: (num * 3) % 11, ties: 0,
        opr: 25 + (num % 40), epa: 30 + (num % 35),
        avg_rp: ((num * 0.13) % 4).toFixed(2),
    };
    if (profile === 'frc') {
        return Object.assign(base, {
            auto_points: 12 + (num % 20),
            teleop_points: 45 + (num % 60),
            endgame_points: 8 + (num % 15),
            fouls: num % 4,
            tech_fouls: num % 2,
            climb_attempts: num % 3,
            ranking_points: ((num * 0.21) % 4).toFixed(2),
            disqualifications: 0,
            yellow_cards: 0,
        });
    }
    // ftc — smaller stat payload
    return Object.assign(base, {
        auto_points: 8 + (num % 15),
        teleop_points: 25 + (num % 40),
        endgame_points: 5 + (num % 10),
    });
}

function makeMatch(profile, tickIdx) {
    const teamsPerSide = profile === 'frc' ? 3 : 2;
    const red  = Array.from({ length: teamsPerSide }, (_, i) => makeTeam(100 + i + tickIdx, profile));
    const blue = Array.from({ length: teamsPerSide }, (_, i) => makeTeam(200 + i + tickIdx, profile));
    return {
        key: `evt_qm${42 + (tickIdx % 5)}`,
        comp_level: 'qm',
        match_number: 42 + (tickIdx % 5),
        winning_alliance: tickIdx % 2 ? 'red' : 'blue',
        red:  { score: 80 + tickIdx % 50, alliance_number: null, teams: red  },
        blue: { score: 75 + tickIdx % 50, alliance_number: null, teams: blue },
    };
}

// ── DOM setup ────────────────────────────────────────────────────────
const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <div id="pbp-arena"></div>
    <div id="pbp-footer"></div>
</body></html>`, { pretendToBeVisual: true });
global.window   = dom.window;
global.document = dom.window.document;

// ── Renderers ────────────────────────────────────────────────────────

/** LEGACY: rebuild the whole arena via innerHTML on every update. */
function renderLegacy(m) {
    const arena = document.getElementById('pbp-arena');
    const teamCard = (t) => `
        <div class="pbp-team" data-team="${t.team_number}">
            <div class="pbp-team-num">${t.team_number}</div>
            <div class="pbp-team-name">${t.nickname}</div>
            <div class="pbp-team-loc">${t.city}, ${t.state_prov}, ${t.country}</div>
            <div class="pbp-stats">
                <span>OPR ${t.opr}</span><span>EPA ${t.epa}</span>
                <span>W-L ${t.wins}-${t.losses}</span><span>RP ${t.avg_rp}</span>
                ${t.auto_points    != null ? `<span>Auto ${t.auto_points}</span>`       : ''}
                ${t.teleop_points  != null ? `<span>Tele ${t.teleop_points}</span>`     : ''}
                ${t.endgame_points != null ? `<span>End ${t.endgame_points}</span>`     : ''}
                ${t.fouls          != null ? `<span>F ${t.fouls}</span>`                : ''}
                ${t.tech_fouls     != null ? `<span>TF ${t.tech_fouls}</span>`          : ''}
                ${t.climb_attempts != null ? `<span>Climb ${t.climb_attempts}</span>`   : ''}
            </div>
        </div>`;
    const side = (s, cls, won) => `
        <div class="pbp-alliance ${cls} ${won ? 'pbp-alliance-won' : ''}">
            <div class="pbp-alliance-header">
                <span class="pbp-alliance-title">${cls === 'red-side' ? 'Red' : 'Blue'} Alliance</span>
                <span class="pbp-alliance-score">${s.score}</span>
            </div>
            <div class="pbp-team-cards">${s.teams.map(teamCard).join('')}</div>
        </div>`;
    arena.innerHTML =
        side(m.red,  'red-side',  m.winning_alliance === 'red')  +
        side(m.blue, 'blue-side', m.winning_alliance === 'blue');
}

/** V3: detect score-only deltas, patch two textNodes; otherwise full rebuild. */
let _v3LastMatch = null;
function renderV3(m) {
    const arena = document.getElementById('pbp-arena');
    const last = _v3LastMatch;

    // Fast path: only scores / winner changed → patch text nodes
    const sameShape = last
        && last.key === m.key
        && last.red.teams.length  === m.red.teams.length
        && last.blue.teams.length === m.blue.teams.length
        && last.red.teams.every((t, i)  => t.team_number === m.red.teams[i].team_number)
        && last.blue.teams.every((t, i) => t.team_number === m.blue.teams[i].team_number);

    if (sameShape) {
        const redScore  = arena.querySelector('.red-side  .pbp-alliance-score');
        const blueScore = arena.querySelector('.blue-side .pbp-alliance-score');
        if (redScore  && redScore.firstChild)  redScore.firstChild.data  = String(m.red.score);
        if (blueScore && blueScore.firstChild) blueScore.firstChild.data = String(m.blue.score);
        // Toggle winner class without rebuilding markup
        arena.querySelector('.red-side') .classList.toggle('pbp-alliance-won', m.winning_alliance === 'red');
        arena.querySelector('.blue-side').classList.toggle('pbp-alliance-won', m.winning_alliance === 'blue');
        _v3LastMatch = m;
        return;
    }

    // Slow path identical to legacy
    renderLegacy(m);
    _v3LastMatch = m;
}

/** V3 + SHELL: mount alliance/header/score skeleton once; slow path
 *  patches text/classes and only swaps `.pbp-team-cards` children.
 *  Mirrors the production refactor in renderPbpMatch. */
let _v3sLastSig = null;
let _v3sShellMounted = false;
const SHELL = `
    <div class="pbp-alliance red-side">
        <div class="pbp-alliance-header">
            <span class="pbp-alliance-title"></span>
            <div class="pbp-score-group">
                <span class="pbp-winner-label hidden">WINNER</span>
                <span class="pbp-alliance-score">–</span>
            </div>
        </div>
        <div class="pbp-team-cards"></div>
    </div>
    <div class="pbp-alliance blue-side">
        <div class="pbp-alliance-header">
            <div class="pbp-score-group">
                <span class="pbp-alliance-score">–</span>
                <span class="pbp-winner-label hidden">WINNER</span>
            </div>
            <span class="pbp-alliance-title"></span>
        </div>
        <div class="pbp-team-cards"></div>
    </div>`;

function _v3sSig(m) {
    return [
        m.key,
        ...m.red.teams.map(t => t.team_number),
        ...m.blue.teams.map(t => t.team_number),
    ].join('|');
}

function renderV3Shell(m) {
    const arena = document.getElementById('pbp-arena');
    if (!_v3sShellMounted) { arena.innerHTML = SHELL; _v3sShellMounted = true; }

    const sig = _v3sSig(m);
    const redSide  = arena.querySelector('.red-side');
    const blueSide = arena.querySelector('.blue-side');
    const redScore  = redSide .querySelector('.pbp-alliance-score');
    const blueScore = blueSide.querySelector('.pbp-alliance-score');

    // Score / winner are always patched as text-only
    redScore.textContent  = String(m.red.score);
    blueScore.textContent = String(m.blue.score);
    redSide .classList.toggle('pbp-alliance-won', m.winning_alliance === 'red');
    blueSide.classList.toggle('pbp-alliance-won', m.winning_alliance === 'blue');
    redSide .querySelector('.pbp-winner-label').classList.toggle('hidden', m.winning_alliance !== 'red');
    blueSide.querySelector('.pbp-winner-label').classList.toggle('hidden', m.winning_alliance !== 'blue');

    if (sig !== _v3sLastSig) {
        // Team set changed — repaint cards and titles
        redSide .querySelector('.pbp-alliance-title').textContent = 'Red Alliance';
        blueSide.querySelector('.pbp-alliance-title').textContent = 'Blue Alliance';
        redSide .querySelector('.pbp-team-cards').innerHTML = m.red .teams.map(teamCardHtml).join('');
        blueSide.querySelector('.pbp-team-cards').innerHTML = m.blue.teams.map(teamCardHtml).join('');
        _v3sLastSig = sig;
    }
}

function teamCardHtml(t) {
    return `<div class="pbp-team" data-team="${t.team_number}">
        <div class="pbp-team-num">${t.team_number}</div>
        <div class="pbp-team-name">${t.nickname}</div>
        <div class="pbp-team-loc">${t.city}, ${t.state_prov}, ${t.country}</div>
        <div class="pbp-stats">
            <span>OPR ${t.opr}</span><span>EPA ${t.epa}</span>
            <span>W-L ${t.wins}-${t.losses}</span><span>RP ${t.avg_rp}</span>
            ${t.auto_points    != null ? `<span>Auto ${t.auto_points}</span>`     : ''}
            ${t.teleop_points  != null ? `<span>Tele ${t.teleop_points}</span>`   : ''}
            ${t.endgame_points != null ? `<span>End ${t.endgame_points}</span>`   : ''}
            ${t.fouls          != null ? `<span>F ${t.fouls}</span>`              : ''}
            ${t.tech_fouls     != null ? `<span>TF ${t.tech_fouls}</span>`        : ''}
            ${t.climb_attempts != null ? `<span>Climb ${t.climb_attempts}</span>` : ''}
        </div>
    </div>`;
}

// ── Benchmark loop ───────────────────────────────────────────────────
function bench(label, render, profile, mode) {
    _v3LastMatch = null;
    _v3sLastSig = null;
    _v3sShellMounted = false;
    document.getElementById('pbp-arena').innerHTML = '';

    // For score-only mode keep the same teams every tick; for slow-path
    // mode rotate teams every tick to invalidate the fast-path signature.
    const tickSeed = (i) => mode === 'scores' ? 0 : i;

    // Warmup (excluded from stats)
    for (let i = 0; i < WARMUP; i++) render(makeMatch(profile, tickSeed(i)));

    const samples = new Float64Array(TOTAL);
    const wallStart = performance.now();
    for (let i = 0; i < TOTAL; i++) {
        const m = makeMatch(profile, tickSeed(i));
        // Always vary the score so score-only mode actually exercises score updates
        m.red.score  += (i % 7);
        m.blue.score += (i % 5);
        const t0 = performance.now();
        render(m);
        samples[i] = performance.now() - t0;
    }
    const wallMs = performance.now() - wallStart;

    samples.sort();
    const sum = samples.reduce((a, b) => a + b, 0);
    return {
        label, profile, mode,
        renders: TOTAL,
        avg_ms: sum / TOTAL,
        p50_ms: samples[Math.floor(TOTAL * 0.50)],
        p95_ms: samples[Math.floor(TOTAL * 0.95)],
        p99_ms: samples[Math.floor(TOTAL * 0.99)],
        max_ms: samples[TOTAL - 1],
        wall_ms: wallMs,
    };
}

// ── Run ──────────────────────────────────────────────────────────────
function fmt(n) { return n.toFixed(3).padStart(8); }

console.log(`\nPBP render benchmark — ${RATE} updates/sec × ${SECS}s = ${TOTAL} renders/run (warmup ${WARMUP})`);
console.log(`modes: scores (same teams, score ticks) | shape (rotating teams, full rebuild)\n`);
console.log('mode    profile  renderer    avg(ms)   p50(ms)   p95(ms)   p99(ms)   max(ms)   wall(ms)');
console.log('──────  ───────  ─────────  ────────  ────────  ────────  ────────  ────────  ────────');

const renderers = [
    ['legacy',   renderLegacy],
    ['v3',       renderV3],
    ['v3-shell', renderV3Shell],
];
const results = [];
for (const mode of ['scores', 'shape']) {
    for (const profile of PROFILES) {
        for (const [label, fn] of renderers) {
            const r = bench(label, fn, profile, mode);
            results.push(r);
            console.log(
                `${mode.padEnd(6)}  ${profile.padEnd(7)}  ${label.padEnd(9)}  ` +
                `${fmt(r.avg_ms)}  ${fmt(r.p50_ms)}  ${fmt(r.p95_ms)}  ` +
                `${fmt(r.p99_ms)}  ${fmt(r.max_ms)}  ${r.wall_ms.toFixed(1).padStart(8)}`
            );
        }
    }
    console.log('');
}

// Speedup summary
for (const mode of ['scores', 'shape']) {
    for (const profile of PROFILES) {
        const leg = results.find(r => r.mode === mode && r.profile === profile && r.label === 'legacy');
        const v3s = results.find(r => r.mode === mode && r.profile === profile && r.label === 'v3-shell');
        if (leg && v3s) {
            const sp = leg.avg_ms / v3s.avg_ms;
            console.log(`[${mode}] ${profile.toUpperCase()}: v3-shell is ${sp.toFixed(1)}× faster ` +
                        `(${leg.avg_ms.toFixed(3)}ms → ${v3s.avg_ms.toFixed(3)}ms avg, ` +
                        `p99 ${leg.p99_ms.toFixed(3)}ms → ${v3s.p99_ms.toFixed(3)}ms)`);
        }
    }
}

// Budget check: at 50/sec we have 20ms per frame
const FRAME_BUDGET = 1000 / RATE;
const overruns = results.filter(r => r.p95_ms > FRAME_BUDGET);
if (overruns.length) {
    console.log(`\n⚠  p95 exceeds frame budget (${FRAME_BUDGET}ms) for: ` +
                overruns.map(r => `${r.mode}/${r.profile}/${r.label}`).join(', '));
}
console.log('');
