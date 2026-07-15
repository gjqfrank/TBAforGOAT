/* ═══════════════════════════════════════════════════════════
   goatpredict.js — GoatPredict: 6907 prediction hub

   Computes team ratings (OPR via least-squares, EPA via a
   simplified statbotics-style EWMA), per-match win-probability
   predictions, and Monte-Carlo rank predictions for an event.

   Depends on: api.js (API), auth.js (Auth)
   Loaded as a classic <script> before app.js.
   Mounts into the #goatpredict-container element.
   ═══════════════════════════════════════════════════════════ */

const GoatPredict = (() => {
    'use strict';

    // ── Constants (statbotics V2 algorithm) ──────────────
    // Reference: https://www.statbotics.io/blog/epa
    const TEAM_NUM = 6907;                  // default team for event loading
    const YEAR     = 2026;                  // event year
    const K        = -5 / 8;                // win-probability logistic constant
                                             //   (= -1/1.6, derived from Elo's 400
                                             //    scale × 250/σ normalisation)
    const SCORE_SD_FALLBACK = 50;           // fallback std-dev if not enough data
    const SIM_ITERATIONS    = 500;          // Monte-Carlo iterations (browser perf)
    const RP_BASE_RATE      = 0.3;          // default RP-bonus probability fallback
    const OPR_LAMBDA        = 0.01;         // ridge regularisation for OPR
    const BASE_TIE_RATE     = 0.02;         // base tie probability in simulation
    const CLOSE_TIE_RATE    = 0.08;         // tie probability when alliances are close

    // ── State ──────────────────────────────────────────────
    let _mounted      = false;
    let _events       = [];
    let _currentEvent = null;
    let _allMatches   = [];     // every match at the event
    let _qualMatches  = [];     // qualification matches only
    let _teamData     = new Map();   // team_number -> aggregated stats
    let _epa          = new Map();   // team_number -> computed EPA
    let _opr          = new Map();   // team_number -> computed OPR
    let _predictions  = [];     // per-match prediction objects
    let _accuracy     = { correct: 0, total: 0 };
    let _scoreSD      = SCORE_SD_FALLBACK;
    let _simResults   = null;   // team_number -> simulation stats
    let _simRunning   = false;

    let _activeSubTab = 'ratings';     // 'ratings' | 'matches' | 'ranks'
    let _sortBy       = 'epa';          // ratings table sort key
    let _sortDir      = 'desc';         // 'asc' | 'desc'

    // ── Helpers ───────────────────────────────────────────
    function _esc(s) {
        if (s == null) return '';
        const d = document.createElement('div');
        d.textContent = String(s);
        return d.innerHTML;
    }

    function _$(id) { return document.getElementById(id); }

    // Number formatter (1 decimal, null-safe)
    function _f1(v) {
        if (v == null || v === '' || isNaN(v)) return '–';
        return Number(v).toFixed(1);
    }
    function _f2(v) {
        if (v == null || v === '' || isNaN(v)) return '–';
        return Number(v).toFixed(2);
    }
    function _pct(v) {
        if (v == null || isNaN(v)) return '–';
        return Math.round(v * 100) + '%';
    }
    function _int(v) {
        if (v == null || isNaN(v)) return '–';
        return Math.round(Number(v));
    }

    // ═══════════════════════════════════════════════════════
    // ALGORITHMS
    // ═══════════════════════════════════════════════════════

    // ── Gaussian elimination solver for Ax = b ────────────
    // A: n×n (array of arrays), b: length-n array.
    // Returns the solution vector x (or zeros if singular).
    function _solveLinearSystem(A, b) {
        const n = A.length;
        if (n === 0) return [];
        // Build augmented matrix [A | b]
        const M = A.map((row, i) => {
            const r = row.slice();
            r.push(b[i] || 0);
            return r;
        });

        for (let col = 0; col < n; col++) {
            // Partial pivoting — pick the row with the largest magnitude
            // in this column to improve numerical stability.
            let pivotRow = col;
            let maxVal = Math.abs(M[col][col]);
            for (let r = col + 1; r < n; r++) {
                const v = Math.abs(M[r][col]);
                if (v > maxVal) { maxVal = v; pivotRow = r; }
            }
            if (maxVal < 1e-12) continue;          // singular column, skip
            if (pivotRow !== col) {
                const tmp = M[col]; M[col] = M[pivotRow]; M[pivotRow] = tmp;
            }
            // Eliminate rows below the pivot
            for (let r = col + 1; r < n; r++) {
                const factor = M[r][col] / M[col][col];
                if (factor === 0) continue;
                for (let c = col; c <= n; c++) {
                    M[r][c] -= factor * M[col][c];
                }
            }
        }

        // Back-substitution
        const x = new Array(n).fill(0);
        for (let i = n - 1; i >= 0; i--) {
            let sum = M[i][n];
            for (let j = i + 1; j < n; j++) sum -= M[i][j] * x[j];
            const diag = M[i][i];
            x[i] = Math.abs(diag) < 1e-12 ? 0 : sum / diag;
        }
        return x;
    }

    // ── OPR (Offensive Power Rating) — least squares ──────
    // Solves (MᵀM + λI) x = Mᵀb where each alliance contributes
    // a row of 1s (3 teams) and an alliance score.
    function _computeOPR(qualMatches, teamIndex) {
        const n = teamIndex.size;
        const opr = new Map();
        if (n === 0 || !qualMatches.length) return opr;

        // MtM[i][j] = number of alliances that contain both teams i & j.
        // Mtb[i]   = sum of alliance scores for alliances containing team i.
        const MtM = Array.from({ length: n }, () => new Array(n).fill(0));
        const Mtb = new Array(n).fill(0);

        for (const m of qualMatches) {
            for (const side of ['red', 'blue']) {
                const alliance = m[side];
                const score = alliance?.score;
                if (score == null || score < 0) continue;       // only played alliances
                const teams = (alliance?.teams || [])
                    .map(t => t.team_number)
                    .filter(num => teamIndex.has(num));
                if (!teams.length) continue;
                for (const a of teams) {
                    const ia = teamIndex.get(a);
                    Mtb[ia] += score;
                    for (const b of teams) {
                        MtM[ia][teamIndex.get(b)] += 1;
                    }
                }
            }
        }

        // Ridge regularisation
        for (let i = 0; i < n; i++) MtM[i][i] += OPR_LAMBDA;

        const x = _solveLinearSystem(MtM, Mtb);
        teamIndex.forEach((idx, num) => opr.set(num, x[idx] || 0));
        return opr;
    }

    // ── statbotics percent_func(year, N) ──────────────────────
    // Exact replica of backend/src/models/epa/main.py:percent_func.
    // For year > 2015 (so for 2026): (2/3) * clip(0.3, 0.5, 0.5 - 0.2/6*(N-6)).
    //   N<=6 → 0.5, 6<N<12 ramps 0.5→0.3, N>=12 → 0.3, then ×2/3.
    // This is the EWMA "learning rate" per team, based on that team's own
    // match count (each team tracks its own N — see update_team in main.py).
    function _epaPercent(N) {
        const raw = Math.min(0.5, Math.max(0.3, 0.5 - (0.2 / 6) * (N - 6)));
        return (2 / 3) * raw;
    }

    // ── EPA (Expected Points Added) — statbotics V2 ───────
    //
    // Two paths (mirrors the statbotics repo's two EPA modes):
    //
    //   1. Teams WITH statbotics-published EPA (apiEPA from /team_events):
    //      Use it verbatim. The API returns `epa.total_points.mean`, which is
    //      exactly the output of statbotics' full pipeline (init from
    //      historical priors + EWMA over every match played this season). It
    //      already accounts for all matches at this event, so replaying them
    //      would double-count. This is "完全复刻 statbotics repo 算法" for
    //      teams that statbotics itself has indexed.
    //
    //   2. Teams WITHOUT statbotics data (custom / off-season events like
    //      "Sanya" that statbotics has not indexed): compute from scratch
    //      using the exact same per-match update rule as the repo:
    //
    //        percent      = percent_func(year, N_team)         [main.py]
    //        attrib       = old_epa + alliance_err / 3         [breakdown.py:
    //                       post_process_attrib → attrib = epa + err,
    //                       err = my_err / num_teams]
    //        new_epa      = (1-percent)*old + percent*attrib    [math.py:
    //                       EPARating.add_obs EWMA, weight=1 for quals]
    //        ⟹ new_epa   = old_epa + percent * (alliance_err / 3)
    //
    //      where alliance_err = score - sum(team EPAs), N_team is this
    //      team's match count, and margin_func returns 0 for 2026 (no
    //      opponent-error weighting). ELIM_WEIGHT (1/3) only applies to
    //      playoff matches — we process quals only, so weight = 1.
    //
    //      Initial prior: statbotics seeds each team from historical EPA via
    //      year_mean/num_teams + year_sd*z_score (init.py). For events
    //      statbotics has no data on, there is no usable prior; we fall back
    //      to this event's own average alliance score / 3, which mimics the
    //      repo's Week-1 mean initialization (constants.py: NORM_MEAN=1500,
    //      but here the year_mean baseline is unknown).
    function _computeEPA(qualMatches, teamData) {
        const epa = new Map();

        // ── Path 1: teams with statbotics-published EPA ──
        let withApiEpa = 0, totalTeams = 0;
        teamData.forEach((d, num) => {
            totalTeams++;
            if (typeof d.apiEPA === 'number' && d.apiEPA > 0) withApiEpa++;
        });

        if (withApiEpa > totalTeams * 0.5) {
            // Statbotics has indexed this event — use its EPA verbatim
            // (it IS the output of the full repo pipeline).
            teamData.forEach((d, num) => {
                epa.set(num, typeof d.apiEPA === 'number' ? d.apiEPA : 0);
            });
            return epa;
        }

        // ── Path 2: from-scratch using the repo's per-match update rule ──
        const played0 = qualMatches.filter(m => {
            const rs = m.red?.score, bs = m.blue?.score;
            return rs != null && bs != null && rs >= 0 && bs >= 0;
        });

        // Initial prior ≈ event's mean alliance score / 3 (Week-1 baseline).
        let initEPA = 0;
        if (played0.length) {
            let sum = 0, n = 0;
            for (const m of played0) {
                for (const side of ['red', 'blue']) {
                    const s = m[side]?.score;
                    if (s != null && s >= 0) { sum += s; n++; }
                }
            }
            initEPA = n > 0 ? (sum / n) / 3 : 0;
        }

        const matchCount = new Map();
        teamData.forEach((d, num) => {
            epa.set(num, initEPA);
            matchCount.set(num, 0);
        });

        // Chronological order — quals sort by match_number (fallback time)
        const played = played0.slice().sort((a, b) => _matchOrder(a) - _matchOrder(b));

        for (const m of played) {
            const redAlliance = m.red;
            const blueAlliance = m.blue;
            if (!redAlliance || !blueAlliance) continue;

            const redScore  = redAlliance.score;
            const blueScore = blueAlliance.score;

            const redTeams = (redAlliance.teams || [])
                .map(t => t.team_number)
                .filter(num => epa.has(num));
            const blueTeams = (blueAlliance.teams || [])
                .map(t => t.team_number)
                .filter(num => epa.has(num));
            if (!redTeams.length || !blueTeams.length) continue;

            const redEPA  = redTeams.reduce((s, n) => s + (epa.get(n) || 0), 0);
            const blueEPA = blueTeams.reduce((s, n) => s + (epa.get(n) || 0), 0);

            // Alliance-level surprise factor (my_err in main.py)
            const redError  = redScore  - redEPA;
            const blueError = blueScore - blueEPA;

            // num_teams = 3 for a standard FRC alliance. post_process_attrib
            // divides the alliance error by num_teams before adding to epa.
            // margin_func(2026, *) = 0 → no opponent-error term.
            const redErrPerTeam  = redError  / redTeams.length;
            const blueErrPerTeam = blueError / blueTeams.length;

            // EWMA update — each team uses its OWN match count for percent.
            // new = (1-percent)*old + percent*(old + err/num_teams)
            //     = old + percent * (err/num_teams)
            for (const n of redTeams) {
                const N = (matchCount.get(n) || 0) + 1;
                matchCount.set(n, N);
                const percent = _epaPercent(N);
                const cur = epa.get(n) || 0;
                epa.set(n, (1 - percent) * cur + percent * (cur + redErrPerTeam));
            }
            for (const n of blueTeams) {
                const N = (matchCount.get(n) || 0) + 1;
                matchCount.set(n, N);
                const percent = _epaPercent(N);
                const cur = epa.get(n) || 0;
                epa.set(n, (1 - percent) * cur + percent * (cur + blueErrPerTeam));
            }
        }
        return epa;
    }

    // Match chronological order key
    function _matchOrder(m) {
        if (m.match_number != null) return m.match_number;
        if (m.time != null) return m.time;
        return 0;
    }

    // ── Score standard deviation (from played qual matches) ─
    function _computeScoreSD(qualMatches) {
        const scores = [];
        for (const m of qualMatches) {
            for (const side of ['red', 'blue']) {
                const s = m[side]?.score;
                if (s != null && s >= 0) scores.push(s);
            }
        }
        if (scores.length < 2) return SCORE_SD_FALLBACK;
        const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
        const variance = scores.reduce((s, v) => s + (v - mean) * (v - mean), 0) / scores.length;
        const sd = Math.sqrt(variance);
        return sd > 0 ? sd : SCORE_SD_FALLBACK;
    }

    // ── Match Prediction ──────────────────────────────────
    // winProb (red) = 1 / (1 + 10^(K * (redEPA - blueEPA) / scoreSD))
    function _winProb(redEPA, blueEPA, scoreSD) {
        const sd = scoreSD > 0 ? scoreSD : SCORE_SD_FALLBACK;
        return 1 / (1 + Math.pow(10, K * (redEPA - blueEPA) / sd));
    }

    function _computePredictions(qualMatches, epa, scoreSD) {
        const predictions = [];
        let correct = 0, total = 0;

        const ordered = qualMatches.slice().sort((a, b) => _matchOrder(a) - _matchOrder(b));

        for (const m of ordered) {
            const redTeams = (m.red?.teams || []).map(t => t.team_number);
            const blueTeams = (m.blue?.teams || []).map(t => t.team_number);
            const redEPA = redTeams.reduce((s, n) => s + (epa.get(n) || 0), 0);
            const blueEPA = blueTeams.reduce((s, n) => s + (epa.get(n) || 0), 0);

            const wp = _winProb(redEPA, blueEPA, scoreSD);
            // Predicted scores = alliance EPA sum (foul factor unavailable)
            const redPred = redEPA;
            const bluePred = blueEPA;

            const rs = m.red?.score, bs = m.blue?.score;
            const played = rs != null && bs != null && rs >= 0 && bs >= 0;

            let actual = null, predCorrect = null, predWinner = null;
            if (redEPA > blueEPA) predWinner = 'red';
            else if (blueEPA > redEPA) predWinner = 'blue';
            else predWinner = 'tie';

            if (played) {
                const actualWinner = rs > bs ? 'red' : (bs > rs ? 'blue' : 'tie');
                actual = { red: rs, blue: bs, winner: actualWinner };
                predCorrect = predWinner === actualWinner;
                total++;
                if (predCorrect) correct++;
            }

            predictions.push({
                key:        m.key || m.match_key,
                label:      (m.label || m.key || '').replace(/^Qualification\s*/i, 'Qual '),
                comp_level: m.comp_level,
                redTeams, blueTeams,
                redEPA, blueEPA,
                winProb:    wp,
                redPred, bluePred,
                played, actual, predWinner, predCorrect,
            });
        }
        return { predictions, accuracy: { correct, total } };
    }

    // ── Percentile helper (linear interpolation) ──────────
    function _percentile(sortedArr, p) {
        if (!sortedArr.length) return 0;
        if (sortedArr.length === 1) return sortedArr[0];
        const idx = (p / 100) * (sortedArr.length - 1);
        const lo = Math.floor(idx), hi = Math.ceil(idx);
        if (lo === hi) return sortedArr[lo];
        return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
    }

    // ── Rank Prediction — Monte Carlo simulation ──────────
    // For each iteration, project RP totals through unplayed qual
    // matches, then rank teams. Aggregates mean/p5/p50/p95 + P(rank=1).
    function _runSimulation(qualMatches, epa, teamData, scoreSD) {
        const teams = [...teamData.keys()];
        const sd = scoreSD > 0 ? scoreSD : SCORE_SD_FALLBACK;

        const isPlayed = m => {
            const rs = m.red?.score, bs = m.blue?.score;
            return rs != null && bs != null && rs >= 0 && bs >= 0;
        };
        const unplayed = qualMatches.filter(m => !isPlayed(m)).sort((a, b) => _matchOrder(a) - _matchOrder(b));

        // Pre-compute per-match win probabilities for unplayed matches.
        const unplayedInfo = unplayed.map(m => {
            const redTeams = (m.red?.teams || []).map(t => t.team_number).filter(n => epa.has(n));
            const blueTeams = (m.blue?.teams || []).map(t => t.team_number).filter(n => epa.has(n));
            const redEPA = redTeams.reduce((s, n) => s + (epa.get(n) || 0), 0);
            const blueEPA = blueTeams.reduce((s, n) => s + (epa.get(n) || 0), 0);
            return {
                redTeams, blueTeams, redEPA, blueEPA,
                winProb: _winProb(redEPA, blueEPA, sd),
            };
        });

        // Current RP totals (from played matches). Use the team's reported
        // avg_rp × matches played when available; otherwise estimate from W-L-T.
        const baseRP = {};
        for (const num of teams) {
            const d = teamData.get(num);
            const mp = d.matchesPlayed || 0;
            if (d.avgRp != null && mp > 0) {
                baseRP[num] = d.avgRp * mp;
            } else {
                baseRP[num] = 2 * (d.wins || 0) + (d.ties || 0);
            }
        }

        // Event-specific bonus RP rate, estimated from teams' avg_rp.
        const bonusBase = _estimateBonusRate(teamData);
        // Average alliance EPA — used to scale bonus probability by strength.
        const allAllianceEpas = unplayedInfo.map(i => (i.redEPA + i.blueEPA) / 2).filter(v => v > 0);
        const meanAllianceEPA = allAllianceEpas.length
            ? allAllianceEpas.reduce((a, b) => a + b, 0) / allAllianceEpas.length
            : 1;

        const rankSamples = {};
        const rpSamples = {};
        for (const num of teams) { rankSamples[num] = []; rpSamples[num] = []; }

        // Tiebreaker: avg_rp (plus tiny random jitter to vary ties per iteration)
        const tiebreak = num => (teamData.get(num).avgRp || 0) + Math.random() * 1e-3;

        for (let it = 0; it < SIM_ITERATIONS; it++) {
            const rp = Object.assign({}, baseRP);

            for (const info of unplayedInfo) {
                // Draw outcome — carve out a small tie probability.
                const diff = Math.abs(info.redEPA - info.blueEPA);
                const tieProb = diff < sd * 0.15 ? CLOSE_TIE_RATE : BASE_TIE_RATE;
                const r = Math.random();
                let outcome;
                if (r < tieProb) outcome = 'tie';
                else if (r < tieProb + (1 - tieProb) * info.winProb) outcome = 'red';
                else outcome = 'blue';

                const redBase = outcome === 'red' ? 2 : (outcome === 'tie' ? 1 : 0);
                const blueBase = outcome === 'blue' ? 2 : (outcome === 'tie' ? 1 : 0);

                // Strength-scaled bonus RP: winners scale up (cap 0.85),
                // losers scale down (floor 0.05). This models that stronger
                // alliances more often achieve the bonus RP objectives.
                const winEPA  = outcome === 'red' ? info.redEPA  : info.blueEPA;
                const loseEPA = outcome === 'red' ? info.blueEPA : info.redEPA;
                const winStrength  = winEPA  / Math.max(1, meanAllianceEPA);
                const loseStrength = loseEPA / Math.max(1, meanAllianceEPA);
                const winBonusProb  = Math.min(0.85, Math.max(0.05, bonusBase * winStrength));
                const loseBonusProb = Math.min(0.85, Math.max(0.05, bonusBase * loseStrength * 0.6));

                let redBonus, blueBonus;
                if (outcome === 'red') {
                    redBonus  = _drawBonus(winBonusProb)  + _drawBonus(winBonusProb);
                    blueBonus = _drawBonus(loseBonusProb) + _drawBonus(loseBonusProb);
                } else if (outcome === 'blue') {
                    redBonus  = _drawBonus(loseBonusProb) + _drawBonus(loseBonusProb);
                    blueBonus = _drawBonus(winBonusProb)  + _drawBonus(winBonusProb);
                } else { // tie — both at base rate
                    redBonus  = _drawBonus(bonusBase) + _drawBonus(bonusBase);
                    blueBonus = _drawBonus(bonusBase) + _drawBonus(bonusBase);
                }

                for (const n of info.redTeams) rp[n] = (rp[n] || 0) + redBase + redBonus;
                for (const n of info.blueTeams) rp[n] = (rp[n] || 0) + blueBase + blueBonus;
            }

            // Rank teams: RP desc, then tiebreak desc.
            const arr = teams.map(n => ({ num: n, rp: rp[n] || 0, tb: tiebreak(n) }));
            arr.sort((a, b) => b.rp - a.rp || b.tb - a.tb);
            arr.forEach((t, i) => {
                rankSamples[t.num].push(i + 1);
                rpSamples[t.num].push(t.rp);
            });
        }

        // Aggregate per-team stats.
        const results = {};
        for (const num of teams) {
            const ranks = rankSamples[num].slice().sort((a, b) => a - b);
            const rps = rpSamples[num];
            results[num] = {
                meanRank: ranks.length ? ranks.reduce((a, b) => a + b, 0) / ranks.length : null,
                p5:  _percentile(ranks, 5),
                p50: _percentile(ranks, 50),
                p95: _percentile(ranks, 95),
                p1:  ranks.length ? ranks.filter(r => r === 1).length / ranks.length : 0,
                meanRP: rps.length ? rps.reduce((a, b) => a + b, 0) / rps.length : null,
            };
        }
        return results;
    }

    // Draw a single RP bonus (Bernoulli at given probability, default RP_BASE_RATE).
    function _drawBonus(prob) {
        const p = (typeof prob === 'number') ? prob : RP_BASE_RATE;
        return Math.random() < p ? 1 : 0;
    }

    // ── Event-specific bonus RP rate estimation ────────────
    // From each team's avg_rp and W-L-T, back out the per-match bonus
    // RP achievement rate:  avg_rp ≈ 2×winRate + 2×bonusRate
    // (win = 2 RP, each of 2 bonus RPs worth 1 when achieved).
    // Returns a value in [0, 1]; falls back to RP_BASE_RATE with no data.
    function _estimateBonusRate(teamData) {
        let total = 0, count = 0;
        teamData.forEach((d) => {
            const wlt = (d.wins || 0) + (d.losses || 0) + (d.ties || 0);
            if (wlt < 1 || d.avgRp == null) return;
            const winRate = ((d.wins || 0) + 0.5 * (d.ties || 0)) / wlt;
            // bonusRate per match (0..2 bonus RPs), halved to per-bonus
            const perBonus = Math.max(0, Math.min(1, (d.avgRp - 2 * winRate) / 2));
            total += perBonus;
            count++;
        });
        return count > 0 ? total / count : RP_BASE_RATE;
    }

    // ═══════════════════════════════════════════════════════
    // DATA BUILDING
    // ═══════════════════════════════════════════════════════

    // Filter to qualification matches (comp_level === 'qm').
    // Falls back to all matches if no comp_level is populated.
    function _filterQual(matches) {
        let quals = matches.filter(m => m.comp_level === 'qm');
        if (!quals.length) {
            // No explicit qual tags — treat unknown-level matches as quals,
            // but exclude obvious playoff levels.
            quals = matches.filter(m => !m.comp_level || !['qf', 'sf', 'f'].includes(m.comp_level));
        }
        return quals;
    }

    // Aggregate per-team stats from qual matches.
    function _buildTeamData(qualMatches) {
        const map = new Map();
        const upsert = (t) => {
            if (!t || t.team_number == null) return;
            if (!map.has(t.team_number)) {
                map.set(t.team_number, {
                    team_number: t.team_number,
                    nickname:    t.nickname || '',
                    apiEPA:      typeof t.epa === 'number' ? t.epa : null,
                    apiOPR:      typeof t.opr === 'number' ? t.opr : null,
                    rank:        t.rank ?? null,
                    wins:        t.wins ?? 0,
                    losses:      t.losses ?? 0,
                    ties:        t.ties ?? 0,
                    avgRp:       typeof t.avg_rp === 'number' ? t.avg_rp : null,
                    matchesPlayed: 0,
                });
            }
        };

        for (const m of qualMatches) {
            for (const side of ['red', 'blue']) {
                const alliance = m[side];
                if (!alliance?.teams) continue;
                alliance.teams.forEach(upsert);
            }
        }

        // Count qual matches actually played per team.
        for (const m of qualMatches) {
            const rs = m.red?.score, bs = m.blue?.score;
            if (rs == null || bs == null || rs < 0 || bs < 0) continue;
            for (const side of ['red', 'blue']) {
                for (const t of (m[side]?.teams || [])) {
                    const d = map.get(t.team_number);
                    if (d) d.matchesPlayed++;
                }
            }
        }
        return map;
    }

    // Build team_number → index map (sorted for stable OPR matrices).
    function _buildTeamIndex(teamData) {
        const idx = new Map();
        [...teamData.keys()].sort((a, b) => a - b).forEach((num, i) => idx.set(num, i));
        return idx;
    }

    // Run the full compute pipeline for the current event.
    function _computeAll() {
        _teamData = _buildTeamData(_qualMatches);
        const teamIndex = _buildTeamIndex(_teamData);

        _opr = _computeOPR(_qualMatches, teamIndex);
        _epa = _computeEPA(_qualMatches, _teamData);
        _scoreSD = _computeScoreSD(_qualMatches);
        const out = _computePredictions(_qualMatches, _epa, _scoreSD);
        _predictions = out.predictions;
        _accuracy = out.accuracy;
        _simResults = null;     // invalidate previous simulation
    }

    // ═══════════════════════════════════════════════════════
    // LIFECYCLE
    // ═══════════════════════════════════════════════════════

    function mount() {
        if (_mounted) { refresh(); return; }
        _mounted = true;
        _renderShell();
        _loadEvents();
    }

    function unmount() { _mounted = false; }

    function refresh() {
        if (!_mounted) return;
        if (_currentEvent) _onEventSelect(_currentEvent);
    }

    // ── Shell render ───────────────────────────────────────
    function _renderShell() {
        const c = _$('goatpredict-container');
        if (!c) return;
        c.innerHTML = `
          <div class="goatpredict-shell">
            <div class="gp-topbar">
              <select id="gp-event-sel" class="gp-select" onchange="GoatPredict._onEventSelect(this.value)">
                <option value="">Loading events…</option>
              </select>
              <button class="gp-btn gp-btn-refresh" onclick="GoatPredict.refresh()" title="Refresh">↻</button>
            </div>

            <div class="gp-subtabs">
              <button class="gp-subtab active" data-subtab="ratings" onclick="GoatPredict._onSubTabClick('ratings')">Team Ratings</button>
              <button class="gp-subtab" data-subtab="matches" onclick="GoatPredict._onSubTabClick('matches')">Match Predictions</button>
              <button class="gp-subtab" data-subtab="ranks" onclick="GoatPredict._onSubTabClick('ranks')">Rank Predictions</button>
            </div>

            <div id="gp-ratings-view">
              <p class="gp-loading">Loading…</p>
            </div>
            <div id="gp-matches-view" class="hidden">
              <p class="gp-loading">Loading…</p>
            </div>
            <div id="gp-ranks-view" class="hidden">
              <p class="gp-loading">Loading…</p>
            </div>
          </div>`;
    }

    // ── Data loading ───────────────────────────────────────
    async function _loadEvents() {
        const sel = _$('gp-event-sel');
        try {
            const stats = await API.teamStats(TEAM_NUM, YEAR);
            _events = stats?.events_this_year || [];
            if (!_events.length) {
                if (sel) sel.innerHTML = `<option value="">No events found for ${TEAM_NUM} in ${YEAR}</option>`;
                _renderAll();
                return;
            }
            const globalEv = (typeof currentEvent !== 'undefined') ? currentEvent : null;
            const defaultKey = (globalEv && _events.some(e => e.event_key === globalEv))
                ? globalEv : _events[0].event_key;
            if (sel) {
                sel.innerHTML = _events.map(e =>
                    `<option value="${e.event_key}"${e.event_key === defaultKey ? ' selected' : ''}>${_esc(e.event_name || e.event_key)}</option>`
                ).join('');
            }
            await _onEventSelect(defaultKey);
        } catch (e) {
            if (sel) sel.innerHTML = `<option value="">Error: ${_esc(e.message)}</option>`;
            _setViewError(`Error loading events: ${_esc(e.message)}`);
        }
    }

    async function _onEventSelect(eventKey) {
        if (!eventKey) return;
        _currentEvent = eventKey;
        // Sync the global currentEvent so shared helpers target the right event.
        if (typeof currentEvent !== 'undefined') currentEvent = eventKey;

        _allMatches  = [];
        _qualMatches = [];
        _teamData    = new Map();
        _epa         = new Map();
        _opr         = new Map();
        _predictions = [];
        _accuracy    = { correct: 0, total: 0 };
        _simResults  = null;

        _setViewLoading('Loading matches…');

        try {
            const data = await API.allMatches(eventKey);
            _allMatches = data?.matches || [];
            _qualMatches = _filterQual(_allMatches);

            if (!_qualMatches.length) {
                _setViewError('No qualification matches found for this event yet.');
                return;
            }

            _computeAll();
            _renderAll();
        } catch (e) {
            _setViewError(`Error loading matches: ${_esc(e.message)}`);
        }
    }

    function _onSubTabClick(tabName) {
        _activeSubTab = tabName;
        const ratings = _$('gp-ratings-view');
        const matches = _$('gp-matches-view');
        const ranks   = _$('gp-ranks-view');
        document.querySelectorAll('.gp-subtab').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.subtab === tabName);
        });
        if (ratings) ratings.classList.toggle('hidden', tabName !== 'ratings');
        if (matches) matches.classList.toggle('hidden', tabName !== 'matches');
        if (ranks)   ranks.classList.toggle('hidden', tabName !== 'ranks');
        // Lazily render the active view.
        if (tabName === 'ratings') _renderRatings();
        else if (tabName === 'matches') _renderMatches();
        else if (tabName === 'ranks') _renderRanks();
    }

    // ═══════════════════════════════════════════════════════
    // RENDERING
    // ═══════════════════════════════════════════════════════

    function _setViewLoading(msg) {
        const map = { ratings: 'gp-ratings-view', matches: 'gp-matches-view', ranks: 'gp-ranks-view' };
        for (const id of Object.values(map)) {
            const el = _$(id);
            if (el) el.innerHTML = `<p class="gp-loading">${_esc(msg)}</p>`;
        }
    }

    function _setViewError(msg) {
        const map = { ratings: 'gp-ratings-view', matches: 'gp-matches-view', ranks: 'gp-ranks-view' };
        for (const id of Object.values(map)) {
            const el = _$(id);
            if (el) el.innerHTML = `<p class="gp-empty">${msg}</p>`;
        }
    }

    function _renderAll() {
        _renderRatings();
        _renderMatches();
        _renderRanks();
    }

    // ── Team Ratings view ─────────────────────────────────
    const SORT_ACCESSORS = {
        team_number: d => d.team_number,
        nickname:    d => (d.nickname || '').toLowerCase(),
        epa:         d => (d.computedEPA ?? -Infinity),
        apiEPA:      d => (d.apiEPA ?? -Infinity),
        opr:         d => (d.computedOPR ?? -Infinity),
        apiOPR:      d => (d.apiOPR ?? -Infinity),
        rank:        d => (d.rank ?? Infinity),
        wlt:         d => (d.wins * 2 + d.ties),
        avgRp:       d => (d.avgRp ?? -Infinity),
        matches:     d => d.matchesPlayed,
    };

    function _onSortBy(key) {
        if (_sortBy === key) {
            _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            _sortBy = key;
            _sortDir = (key === 'nickname' || key === 'team_number') ? 'asc' : 'desc';
        }
        _renderRatings();
    }

    function _renderRatings() {
        const el = _$('gp-ratings-view');
        if (!el) return;
        if (!_teamData.size) {
            el.innerHTML = '<p class="gp-empty">No team data available.</p>';
            return;
        }

        const rows = [..._teamData.values()].map(d => ({
            ...d,
            computedEPA: _epa.get(d.team_number),
            computedOPR: _opr.get(d.team_number),
        }));

        const accessor = SORT_ACCESSORS[_sortBy] || SORT_ACCESSORS.epa;
        const dir = _sortDir === 'asc' ? 1 : -1;
        rows.sort((a, b) => {
            const av = accessor(a), bv = accessor(b);
            if (av < bv) return -1 * dir;
            if (av > bv) return 1 * dir;
            return a.team_number - b.team_number;
        });

        const headerCell = (key, label, extra = '') => {
            const arrow = _sortBy === key ? (_sortDir === 'asc' ? ' ▲' : ' ▼') : '';
            return `<th class="gp-th gp-th-sortable" onclick="GoatPredict._onSortBy('${key}')" ${extra}>${_esc(label)}${arrow}</th>`;
        };

        el.innerHTML = `
          <div class="gp-panel">
            <h3 class="gp-panel-title">Team Ratings <span class="gp-panel-sub">${rows.length} teams · EPA from statbotics (or local V2 for custom events) · OPR via least-squares</span></h3>
            <div class="gp-table-wrap">
              <table class="gp-table">
                <thead>
                  <tr>
                    ${headerCell('team_number', 'Team #')}
                    ${headerCell('nickname',    'Nickname')}
                    ${headerCell('epa',         'EPA')}
                    ${headerCell('apiEPA',      'API EPA')}
                    ${headerCell('opr',         'OPR')}
                    ${headerCell('apiOPR',      'API OPR')}
                    ${headerCell('rank',        'Rank')}
                    ${headerCell('wlt',         'W-L-T')}
                    ${headerCell('avgRp',       'Avg RP')}
                    ${headerCell('matches',     'MP')}
                  </tr>
                </thead>
                <tbody>
                  ${rows.map(r => {
                      const isGoat = r.team_number === TEAM_NUM;
                      return `<tr class="gp-row${isGoat ? ' gp-row-goat' : ''}">
                          <td class="gp-team-num">${r.team_number}</td>
                          <td class="gp-nick">${_esc(r.nickname || '—')}</td>
                          <td class="gp-num gp-epa">${_f1(r.computedEPA)}</td>
                          <td class="gp-num gp-epa-api">${_f1(r.apiEPA)}</td>
                          <td class="gp-num gp-opr">${_f1(r.computedOPR)}</td>
                          <td class="gp-num gp-opr-api">${_f1(r.apiOPR)}</td>
                          <td class="gp-num">${r.rank ?? '–'}</td>
                          <td class="gp-num">${r.wins || 0}-${r.losses || 0}-${r.ties || 0}</td>
                          <td class="gp-num">${_f2(r.avgRp)}</td>
                          <td class="gp-num">${r.matchesPlayed}</td>
                      </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>`;
    }

    // ── Match Predictions view ────────────────────────────
    function _renderMatches() {
        const el = _$('gp-matches-view');
        if (!el) return;
        if (!_predictions.length) {
            el.innerHTML = '<p class="gp-empty">No qualification matches to predict.</p>';
            return;
        }

        const correct = _accuracy.correct, total = _accuracy.total;
        const accPct = total > 0 ? Math.round(correct / total * 100) + '%' : '—';
        const unplayed = _predictions.filter(p => !p.played).length;

        el.innerHTML = `
          <div class="gp-panel">
            <h3 class="gp-panel-title">Match Predictions
              <span class="gp-panel-sub">${_predictions.length} qual matches · ${unplayed} unplayed · accuracy ${correct}/${total} (${accPct})</span>
            </h3>
            <div class="gp-match-list">
              ${_predictions.map(_renderMatchCard).join('')}
            </div>
          </div>`;
    }

    function _renderMatchCard(p) {
        const redPct  = Math.round(p.winProb * 100);
        const bluePct = 100 - redPct;
        const favSide = p.winProb >= 0.5 ? 'red' : 'blue';

        let actualHtml = '';
        if (p.played && p.actual) {
            const ok = p.predCorrect;
            const badge = ok
                ? '<span class="gp-badge gp-badge-ok">✓ correct</span>'
                : '<span class="gp-badge gp-badge-bad">✗ wrong</span>';
            actualHtml = `
                <div class="gp-match-actual">
                  <span class="gp-actual-lbl">Actual:</span>
                  <span class="gp-actual-red">${p.actual.red}</span>
                  <span class="gp-actual-sep">–</span>
                  <span class="gp-actual-blue">${p.actual.blue}</span>
                  ${badge}
                </div>`;
        } else {
            actualHtml = '<div class="gp-match-actual"><span class="gp-actual-lbl gp-future">Upcoming</span></div>';
        }

        return `
          <div class="gp-match-card">
            <div class="gp-match-head">
              <span class="gp-match-label">${_esc(p.label)}</span>
              ${p.played ? '<span class="gp-tag gp-tag-played">played</span>' : '<span class="gp-tag gp-tag-future">scheduled</span>'}
            </div>
            <div class="gp-match-body">
              <div class="gp-alliance gp-alliance-red">
                <span class="gp-alliance-teams">${p.redTeams.join(' · ') || '—'}</span>
                <span class="gp-alliance-epa">EPA ${_f1(p.redEPA)}</span>
                <span class="gp-alliance-pred">Pred ${_f1(p.redPred)}</span>
              </div>
              <div class="gp-probbar">
                <div class="gp-probbar-red"  style="width:${redPct}%"><span>${redPct}%</span></div>
                <div class="gp-probbar-blue" style="width:${bluePct}%"><span>${bluePct}%</span></div>
              </div>
              <div class="gp-alliance gp-alliance-blue">
                <span class="gp-alliance-teams">${p.blueTeams.join(' · ') || '—'}</span>
                <span class="gp-alliance-epa">EPA ${_f1(p.blueEPA)}</span>
                <span class="gp-alliance-pred">Pred ${_f1(p.bluePred)}</span>
              </div>
            </div>
            ${actualHtml}
            <div class="gp-match-foot">Favoured: <strong class="gp-fav-${favSide}">${favSide.toUpperCase()}</strong></div>
          </div>`;
    }

    // ── Rank Predictions view ─────────────────────────────
    function _renderRanks() {
        const el = _$('gp-ranks-view');
        if (!el) return;

        if (_simRunning) {
            el.innerHTML = '<p class="gp-loading">Running simulation…</p>';
            return;
        }

        if (!_teamData.size) {
            el.innerHTML = '<p class="gp-empty">Load an event to run rank predictions.</p>';
            return;
        }

        if (!_simResults) {
            el.innerHTML = `
              <div class="gp-panel">
                <h3 class="gp-panel-title">Rank Predictions</h3>
                <p class="gp-empty">Run a ${SIM_ITERATIONS}-iteration Monte-Carlo simulation over the remaining qualification matches.</p>
                <button class="gp-btn gp-btn-primary" onclick="GoatPredict._onRunSim()">Run Simulation</button>
              </div>`;
            return;
        }

        const rows = [..._teamData.values()].map(d => {
            const s = _simResults[d.team_number] || {};
            return { ...d, sim: s };
        });
        rows.sort((a, b) => {
            const am = a.sim.meanRank ?? Infinity;
            const bm = b.sim.meanRank ?? Infinity;
            if (am !== bm) return am - bm;
            return a.team_number - b.team_number;
        });

        const unplayed = _predictions.filter(p => !p.played).length;

        el.innerHTML = `
          <div class="gp-panel">
            <h3 class="gp-panel-title">Rank Predictions
              <span class="gp-panel-sub">${SIM_ITERATIONS} iterations · ${unplayed} unplayed quals</span>
            </h3>
            <button class="gp-btn gp-btn-primary" onclick="GoatPredict._onRunSim()">Re-run Simulation</button>
            <div class="gp-table-wrap">
              <table class="gp-table">
                <thead>
                  <tr>
                    <th class="gp-th">Team #</th>
                    <th class="gp-th">Nickname</th>
                    <th class="gp-th">Current Rank</th>
                    <th class="gp-th">Mean Pred Rank</th>
                    <th class="gp-th">P5</th>
                    <th class="gp-th">P50</th>
                    <th class="gp-th">P95</th>
                    <th class="gp-th">P(Rank=1)</th>
                    <th class="gp-th">Mean RP</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows.map(r => {
                      const isGoat = r.team_number === TEAM_NUM;
                      return `<tr class="gp-row${isGoat ? ' gp-row-goat' : ''}">
                          <td class="gp-team-num">${r.team_number}</td>
                          <td class="gp-nick">${_esc(r.nickname || '—')}</td>
                          <td class="gp-num">${r.rank ?? '–'}</td>
                          <td class="gp-num gp-rank-mean">${_f1(r.sim.meanRank)}</td>
                          <td class="gp-num">${_int(r.sim.p5)}</td>
                          <td class="gp-num">${_int(r.sim.p50)}</td>
                          <td class="gp-num">${_int(r.sim.p95)}</td>
                          <td class="gp-num">${_pct(r.sim.p1)}</td>
                          <td class="gp-num">${_f2(r.sim.meanRP)}</td>
                      </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>`;
    }

    // ── Run simulation (async to allow loading indicator) ─
    function _onRunSim() {
        if (_simRunning) return;
        if (!_qualMatches.length || !_teamData.size) return;

        _simRunning = true;
        const el = _$('gp-ranks-view');
        if (el) el.innerHTML = `<p class="gp-loading">Running ${SIM_ITERATIONS}-iteration simulation…</p>`;

        // Yield to the event loop so the loading state paints before the
        // (synchronous) compute-heavy simulation blocks the main thread.
        setTimeout(() => {
            try {
                _simResults = _runSimulation(_qualMatches, _epa, _teamData, _scoreSD);
            } catch (e) {
                console.error('[GoatPredict] Simulation failed:', e);
                _simResults = null;
            } finally {
                _simRunning = false;
                _renderRanks();
            }
        }, 30);
    }

    // ── Public API ─────────────────────────────────────────
    return {
        mount,
        unmount,
        refresh,
        _onEventSelect,
        _onSubTabClick,
        _onSortBy,
        _onRunSim,
    };
})();
