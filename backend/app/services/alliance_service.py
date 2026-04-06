"""Alliance selection analysis & partnership-history checker."""
from __future__ import annotations

import asyncio
from .tba_client import get_tba_client
from .frc_client import get_frc_client
from .statbotics_client import get_epa_map

# Concurrency limit for outbound API calls within this module
_API_SEMAPHORE = asyncio.Semaphore(10)


async def _safe(coro):
    try:
        async with _API_SEMAPHORE:
            return await coro
    except Exception:
        return None


# Map TBA playoff levels to readable labels (traditional bracket)
_PLAYOFF_LABELS = {
    "f": "Finals",
    "sf": "Semifinals",
    "qf": "Quarterfinals",
    "ef": "Round 1",
}

# Double-elimination bracket (2023+): set_number → (round, bracket)
_DOUBLE_ELIM_MAP = {
    1: (1, "Upper"), 2: (1, "Upper"), 3: (1, "Upper"), 4: (1, "Upper"),
    5: (2, "Lower"), 6: (2, "Lower"), 7: (2, "Upper"), 8: (2, "Upper"),
    9: (3, "Lower"), 10: (3, "Lower"),
    11: (4, "Upper"), 12: (4, "Lower"),
    13: (5, "Lower"),
}

# Round 4+ in upper = Semis, Round 5 in lower = Semis
_DOUBLE_ELIM_ROUND_LABELS = {
    1: "Round 1", 2: "Round 2", 3: "Round 3",
    4: "Semis", 5: "Semis",
}


def _resolve_double_elim_label_frc(playoff_matches: list[dict], alliance_picks: list[str]) -> str | None:
    """Find the highest double-elim round an alliance played using FRC API data."""
    pick_numbers = {int(tk.replace("frc", "")) for tk in alliance_picks}
    best_round = -1
    best_bracket = ""
    for m in playoff_matches:
        mn = m.get("matchNumber", 0)
        desc = (m.get("description") or "").lower()
        match_teams = {t.get("teamNumber", 0) for t in m.get("teams", [])}
        if not pick_numbers & match_teams:
            continue
        # Finals detection — made it past semis
        if "final" in desc and "semi" not in desc:
            return None  # handled separately as Finalist / Winner
        if mn in _DOUBLE_ELIM_MAP:
            rnd, bracket = _DOUBLE_ELIM_MAP[mn]
            if rnd > best_round:
                best_round = rnd
                best_bracket = bracket
    if best_round < 0:
        return None
    stage = _DOUBLE_ELIM_ROUND_LABELS.get(best_round, f"Round {best_round}")
    return f"{stage} ({best_bracket})"


async def get_alliances_with_stats(event_key: str) -> dict:
    """Alliances + per-team qual stats + first-time-partner flags."""
    client = get_tba_client()
    frc = get_frc_client()

    year = int(event_key[:4]) if event_key[:4].isdigit() else 2026
    event_code = event_key[4:]

    alliances_raw, rankings, oprs, teams_list, frc_teams_raw, epa_data, frc_playoff_matches = await asyncio.gather(
        client.get_event_alliances(event_key),
        _safe(client.get_event_rankings(event_key)),
        _safe(client.get_event_oprs(event_key)),
        _safe(client.get_event_teams(event_key)),
        _safe(frc.get_event_teams(year, event_code)),
        _safe(get_epa_map(event_key)),
        _safe(frc.get_matches(year, event_code.upper(), level="Playoff")) if year >= 2023 else asyncio.sleep(0),
    )
    if not isinstance(frc_playoff_matches, list):
        frc_playoff_matches = None
    if epa_data is None:
        epa_data = {}

    if not alliances_raw:
        return {"alliances": [], "partnerships": {}}

    # ── Lookups ─────────────────────────────────────────────
    name_map: dict[str, str] = {}
    country_map: dict[str, str] = {}
    school_map: dict[str, str] = {}
    rookie_year_map: dict[str, int | None] = {}
    if teams_list:
        for t in teams_list:
            name_map[t["key"]] = t.get("nickname", "")
            country_map[t["key"]] = t.get("country", "")
            school_map[t["key"]] = t.get("school_name", "")
            rookie_year_map[t["key"]] = t.get("rookie_year")

    # FRC Events API school/org names (preferred)
    frc_org_map: dict[int, str] = {}
    if frc_teams_raw:
        for ft in frc_teams_raw:
            num = ft.get("teamNumber")
            org = ft.get("schoolName") or ft.get("nameShort") or ""
            if num and org:
                frc_org_map[num] = org

    rank_map: dict[str, dict] = {}
    if rankings and rankings.get("rankings"):
        for r in rankings["rankings"]:
            rank_map[r["team_key"]] = r

    opr_map: dict[str, dict] = {}
    if oprs:
        for tk in oprs.get("oprs", {}):
            epa_info = epa_data.get(tk, {})
            opr_map[tk] = {
                "opr": round(oprs["oprs"].get(tk, 0), 2),
                "epa": epa_info.get("epa"),
                "epa_auto": epa_info.get("epa_auto"),
                "epa_teleop": epa_info.get("epa_teleop"),
                "epa_endgame": epa_info.get("epa_endgame"),
            }

    # ── Fetch avatars for all alliance teams (cached) ───────
    from .avatar_cache import get_avatars

    all_alliance_keys: list[str] = []
    for a in alliances_raw:
        all_alliance_keys.extend(a.get("picks", []))

    avatar_map = await get_avatars(all_alliance_keys, year)

    # ── Pick labels ───────────────────────────────────────
    _pick_labels = ['Captain', '1st Pick', '2nd Pick', '3rd Pick', 'Backup']

    # ── Build alliance cards ────────────────────────────────
    alliances = []
    for idx, alliance in enumerate(alliances_raw):
        picks = alliance.get("picks", [])
        backup_in = (alliance.get("backup") or {}).get("in")
        team_details = []
        for pick_idx, tk in enumerate(picks):
            r = rank_map.get(tk, {})
            rec = r.get("record", {})
            o = opr_map.get(tk, {"opr": 0, "epa": None, "epa_auto": None, "epa_teleop": None, "epa_endgame": None})
            tnum = int(tk.replace("frc", ""))

            if tk == backup_in:
                pick_label = 'Backup'
            else:
                pick_label = _pick_labels[pick_idx] if pick_idx < len(_pick_labels) else ''

            team_details.append(
                {
                    "team_key": tk,
                    "team_number": tnum,
                    "nickname": name_map.get(tk, ""),
                    "country": country_map.get(tk, ""),
                    "school_name": frc_org_map.get(tnum, "") or school_map.get(tk, ""),
                    "rookie_year": rookie_year_map.get(tk),
                    "avatar": avatar_map.get(tk),
                    "pick_label": pick_label,
                    "rank": r.get("rank", "-"),
                    "wins": rec.get("wins", 0),
                    "losses": rec.get("losses", 0),
                    "ties": rec.get("ties", 0),
                    "opr": o["opr"],
                    "epa": o["epa"],
                    "epa_auto": o["epa_auto"],
                    "epa_teleop": o["epa_teleop"],
                    "epa_endgame": o["epa_endgame"],
                }
            )

        # ── Playoff result from TBA status ──────────────────
        status = alliance.get("status") or {}
        playoff_status = status.get("status", "")  # "won", "eliminated", "playing", ""
        playoff_level = status.get("level", "")
        playoff_record = status.get("record") or {}
        pw = playoff_record.get("wins", 0)
        pl = playoff_record.get("losses", 0)

        # For double-elim events (2023+), resolve actual round from FRC playoff data
        de_label = None
        if year >= 2023 and playoff_level == "sf" and frc_playoff_matches:
            de_label = _resolve_double_elim_label_frc(frc_playoff_matches, picks)

        if playoff_status == "won":
            result_label = "Event Winner"
            result_type = "winner"
        elif playoff_status == "eliminated" and playoff_level == "f":
            result_label = "Finalist"
            result_type = "finalist"
        elif playoff_status == "eliminated":
            if de_label:
                result_label = f"Eliminated in {de_label}"
            else:
                result_label = f"Eliminated in {_PLAYOFF_LABELS.get(playoff_level, playoff_level)}"
            result_type = "eliminated"
        elif playoff_status == "playing":
            if de_label:
                result_label = f"Playing — {de_label}"
            else:
                result_label = f"Playing — {_PLAYOFF_LABELS.get(playoff_level, playoff_level)}"
            result_type = "playing"
        else:
            result_label = ""
            result_type = ""

        # Combined stats
        combined_opr = round(sum(t["opr"] for t in team_details), 2)
        _epa_vals = [t["epa"] for t in team_details if t["epa"] is not None]
        combined_epa = round(sum(_epa_vals), 2) if _epa_vals else None
        _epa_auto_vals = [t["epa_auto"] for t in team_details if t["epa_auto"] is not None]
        combined_epa_auto = round(sum(_epa_auto_vals), 2) if _epa_auto_vals else None
        _epa_teleop_vals = [t["epa_teleop"] for t in team_details if t["epa_teleop"] is not None]
        combined_epa_teleop = round(sum(_epa_teleop_vals), 2) if _epa_teleop_vals else None
        _epa_endgame_vals = [t["epa_endgame"] for t in team_details if t["epa_endgame"] is not None]
        combined_epa_endgame = round(sum(_epa_endgame_vals), 2) if _epa_endgame_vals else None

        alliances.append(
            {
                "number": idx + 1,
                "name": alliance.get("name", f"Alliance {idx + 1}"),
                "teams": team_details,
                "picks": picks,
                "combined_opr": combined_opr,
                "combined_epa": combined_epa,
                "combined_epa_auto": combined_epa_auto,
                "combined_epa_teleop": combined_epa_teleop,
                "combined_epa_endgame": combined_epa_endgame,
                "playoff_result": result_label,
                "playoff_type": result_type,
                "playoff_record": f"{pw}-{pl}" if (pw or pl) else "",
            }
        )

    # ── Compute max OPR for strength bar ────────────────────
    max_opr = max((a["combined_opr"] for a in alliances), default=1) or 1

    # ── Partnership history ─────────────────────────────────
    partnerships = await _check_all_partnerships(alliances_raw, event_key)

    return {
        "alliances": alliances,
        "partnerships": partnerships,
        "max_combined_opr": max_opr,
    }


# ── Partnership history helpers ─────────────────────────────


async def _check_all_partnerships(
    alliances_raw: list[dict], event_key: str
) -> dict:
    """For every pair of alliance partners, check if they shared an
    alliance at a *prior* event across all seasons they've participated in."""
    client = get_tba_client()

    # Collect every team across all alliances
    all_teams: set[str] = set()
    for a in alliances_raw:
        all_teams.update(a.get("picks", []))

    # 1) Fetch years participated for each team
    async def _years_for(tk: str):
        data = await _safe(client.get_team_years_participated(tk))
        return (tk, data or [])

    year_results = await asyncio.gather(*[_years_for(tk) for tk in all_teams])
    team_years: dict[str, list[int]] = {tk: yrs for tk, yrs in year_results}

    # 2) Fetch each team's events for every year they participated
    async def _events_for(tk: str, y: int):
        data = await _safe(client.get_team_events(tk, y))
        return (tk, y, data or [])

    tasks = []
    for tk in all_teams:
        for y in team_years.get(tk, []):
            tasks.append(_events_for(tk, y))
    results = await asyncio.gather(*tasks)

    team_events: dict[str, set[str]] = {}
    for tk, _y, events in results:
        if tk not in team_events:
            team_events[tk] = set()
        for ev in events:
            team_events[tk].add(ev["key"])

    # 3) Identify all common events we'll need alliance data for
    events_to_fetch: set[str] = set()
    for a in alliances_raw:
        picks = a.get("picks", [])
        for i in range(len(picks)):
            for j in range(i + 1, len(picks)):
                common = (
                    team_events.get(picks[i], set())
                    & team_events.get(picks[j], set())
                ) - {event_key}
                events_to_fetch.update(common)

    # 4) Batch-fetch alliance data AND event info for those events
    async def _alliances_for(ek: str):
        data = await _safe(client.get_event_alliances(ek))
        return (ek, data)

    async def _event_info(ek: str):
        data = await _safe(client.get_event(ek))
        return (ek, data)

    alliance_results, event_info_results = await asyncio.gather(
        asyncio.gather(*[_alliances_for(ek) for ek in events_to_fetch]),
        asyncio.gather(*[_event_info(ek) for ek in events_to_fetch]),
    )
    alliance_cache: dict[str, list] = {
        ek: data for ek, data in alliance_results if data
    }
    event_name_cache: dict[str, str] = {
        ek: (info.get("name", ek) if info else ek)
        for ek, info in event_info_results
    }

    # 5) Check each pair
    partnerships: dict[str, dict] = {}
    for a in alliances_raw:
        picks = a.get("picks", [])
        for i in range(len(picks)):
            for j in range(i + 1, len(picks)):
                ta, tb = picks[i], picks[j]
                pair_key = f"{ta}+{tb}"
                common = (
                    team_events.get(ta, set())
                    & team_events.get(tb, set())
                ) - {event_key}

                history = []
                for ek in common:
                    for al in alliance_cache.get(ek, []):
                        ps = al.get("picks", [])
                        if ta in ps and tb in ps:
                            history.append(
                                {
                                    "event_key": ek,
                                    "event_name": event_name_cache.get(ek, ek),
                                    "year": int(ek[:4]),
                                    "alliance_name": al.get("name", ""),
                                }
                            )

                history.sort(key=lambda h: h["event_key"], reverse=True)

                partnerships[pair_key] = {
                    "first_time": len(history) == 0,
                    "history": history,
                }

    return partnerships
