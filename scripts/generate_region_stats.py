    #!/usr/bin/env python3
"""
One-time generator: build region_stats.json with pre-computed facts per region/district.

Regions are defined by the event's resolved region (same logic as event_service.py):
  - US district events -> district display_name (e.g. "FIRST in Michigan")
  - US non-district events -> state-based region (e.g. "Pacific", "Texas")
  - International events -> country (e.g. "Türkiye", "Israel")

Teams are attributed to the region where they compete most often.

Usage:
    python scripts/generate_region_stats.py
"""
from __future__ import annotations

import asyncio
import json
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend.app.services.tba_client import get_tba_client
from backend.app.services.frc_client import get_frc_client

# ── Same region resolution as event_service.py ──────────────
_REGION_MAP = {
    "New England": {"NH", "MA", "CT", "RI", "VT", "ME"},
    "New York": {"NY"},
    "Mid-Atlantic": {"NJ", "PA", "DE"},
    "Chesapeake": {"VA", "MD", "DC"},
    "North Carolina": {"NC"},
    "South Carolina": {"SC"},
    "Georgia": {"GA"},
    "Southeast": {"FL", "AL", "MS", "TN", "KY", "WV", "LA", "AR"},
    "Indiana": {"IN"},
    "Michigan": {"MI"},
    "Midwest": {"OH", "IL", "MN", "IA", "MO", "ND", "SD", "NE", "KS"},
    "Wisconsin": {"WI"},
    "Texas": {"TX"},
    "Mountain": {"MT", "WY", "CO", "NM", "AZ", "UT", "ID", "NV"},
    "California": {"CA"},
    "Pacific Northwest": {"WA", "OR"},
    "Pacific": {"HI", "AK"},
}

_COUNTRY_LABELS = (
    "Türkiye", "Israel", "Canada", "China", "Australia", "Brazil", "Mexico",
    "Chinese Taipei", "India", "Japan", "Chile", "Colombia", "Egypt", "Poland",
    "Dominican Republic", "Paraguay", "Morocco", "United Kingdom", "Netherlands",
    "Croatia", "Romania", "Kazakhstan", "France", "Germany", "Switzerland",
    "Argentina", "South Korea", "Czech Republic", "Denmark", "Ethiopia",
    "Finland", "Georgia", "Hungary", "Indonesia", "Ireland", "Italy",
    "Jordan", "Kenya", "Lebanon", "Lithuania", "Malaysia", "Malta",
    "New Zealand", "Nigeria", "Norway", "Pakistan", "Peru", "Philippines",
    "Portugal", "Puerto Rico", "Qatar", "Rwanda", "Saudi Arabia", "Singapore",
    "Slovakia", "Slovenia", "South Africa", "Spain", "Sweden", "Taiwan",
    "Thailand", "Tunisia", "Ukraine", "United Arab Emirates", "Vietnam",
    "Kosovo", "Bosnia and Herzegovina", "Serbia", "Montenegro",
    "North Macedonia", "Albania", "Ecuador", "Bolivia", "Guatemala",
    "Honduras", "Nicaragua", "Costa Rica", "Panama", "Cuba", "Bahrain",
    "Oman", "Kuwait", "Korea",
)

_EXCLUDE_TYPES = {99, 100, -1}

# Championship-level event types are located in a host city but do NOT belong
# to that city's local region.  They are analysed separately for CMP stats.
_CHAMPIONSHIP_TYPES = {3, 4, 6}  # CMP Division, CMP Finals, Festival of Champions

# Pre-district regions that transitioned to a district system.
_REGION_MERGE = {
    "Israel": "FIRST Israel",
    "Texas": "FIRST In Texas",
    "California": "FIRST California",
    "Wisconsin": "FIRST Wisconsin",
    "Indiana": "FIRST Indiana Robotics",
    "Michigan": "FIRST in Michigan",
    "North Carolina": "FIRST North Carolina",
    "South Carolina": "FIRST South Carolina",
    "Georgia": "Peachtree",
    "Chesapeake": "FIRST Chesapeake",
    "Mid-Atlantic": "FIRST Mid-Atlantic",
}

_COUNTRY_NORMALIZE = {
    "turkey": "Türkiye", "türkiye": "Türkiye", "turkiye": "Türkiye",
}

# Canadian province codes / full names → district (where one exists).
# Provinces without a district fall through to the generic "Canada" bucket.
_CANADA_PROVINCE_DISTRICT = {
    "ON": "FIRST Canada - Ontario",
    "Ontario": "FIRST Canada - Ontario",
}


def _norm(c: str) -> str:
    return _COUNTRY_NORMALIZE.get(c.lower().strip(), c)


def _resolve_event_region(ev: dict) -> str:
    district = ev.get("district")
    country = _norm(ev.get("country", "") or "")
    state_prov = ev.get("state_prov", "") or ""
    if district and district.get("abbreviation"):
        return district.get("display_name") or district["abbreviation"].upper()
    if country and country not in ("USA", ""):
        # Canadian events: route by province if a district mapping exists
        if "Canada" in country or "canada" in country.lower():
            dist = _CANADA_PROVINCE_DISTRICT.get(state_prov)
            if dist:
                return dist
            return "Canada"
        for label in _COUNTRY_LABELS:
            if label.lower() in country.lower() or country.lower() in label.lower():
                return _REGION_MERGE.get(label, label)
        return country
    for region, states in _REGION_MAP.items():
        if state_prov in states:
            return _REGION_MERGE.get(region, region)
    return "Other"


async def _safe(coro):
    try:
        return await coro
    except Exception:
        return None


async def generate():
    client = get_tba_client()
    BATCH = 25
    FIRST_YEAR, CURRENT_YEAR = 1992, 2026

    # ── Phase 1 ───────────────────────────────────────────────
    print("Phase 1: Fetching events for all years...")
    all_events: list[dict] = []
    year_events: dict[int, list] = {}
    for year in range(FIRST_YEAR, CURRENT_YEAR + 1):
        raw = await client.get_events_by_year(year)
        official = [e for e in raw if e.get("event_type", -1) not in _EXCLUDE_TYPES]
        year_events[year] = official
        all_events.extend(official)
        print(f"  {year}: {len(official)} events")

    # ── Phase 2: Group events by region ───────────────────────
    print("\nPhase 2: Grouping events by region...")
    region_events: dict[str, list[dict]] = defaultdict(list)
    for ev in all_events:
        # Championship events are located in a host city but don't belong to
        # that city's local region — they are analysed separately in Phase 4.
        if ev.get("event_type") in _CHAMPIONSHIP_TYPES:
            continue
        region_events[_resolve_event_region(ev)].append(ev)
    print(f"  Found {len(region_events)} distinct regions")

    region_meta: dict[str, dict] = {}
    for region, evs in region_events.items():
        years = sorted({int(e["key"][:4]) for e in evs})
        # Prefer non-cancelled events for first_event display
        non_cancelled = [e for e in evs if not (e.get("name", "") or "").lstrip().startswith("*")]
        pool = non_cancelled if non_cancelled else evs
        first_ev = min(pool, key=lambda e: e.get("start_date", "9999"))
        region_meta[region] = {
            "first_event_year": int(first_ev["key"][:4]),
            "first_event_name": first_ev.get("name", first_ev["key"]),
            "active_years": years,
            "total_events": len(evs),
        }

    # ── Phase 3: Fetch team rosters (5 recent seasons) ────────
    print("\nPhase 3: Fetching team rosters (last 5 seasons)...")
    SAMPLE_YEARS = list(range(2022, CURRENT_YEAR + 1))

    team_info: dict[str, dict] = {}
    team_region_counts: dict[str, Counter] = defaultdict(Counter)
    region_visitors_raw: dict[str, Counter] = defaultdict(Counter)

    for year in SAMPLE_YEARS:
        evs = year_events.get(year, [])
        results = await asyncio.gather(
            *[_safe(client.get_event_teams_full(e["key"])) for e in evs]
        )
        for ev, teams in zip(evs, results):
            if not teams:
                continue
            # Skip championship events — attendees of CMP aren't visitors
            # to the host city's local region.
            if ev.get("event_type") in _CHAMPIONSHIP_TYPES:
                continue
            region = _resolve_event_region(ev)
            ev_country = _norm(ev.get("country", "") or "")
            for t in teams:
                tk = t["key"]
                tc = _norm(t.get("country", "") or "")
                if tk not in team_info:
                    team_info[tk] = {
                        "team_number": t.get("team_number"),
                        "nickname": t.get("nickname", ""),
                        "country": tc,
                        "state_prov": t.get("state_prov", ""),
                    }
                team_region_counts[tk][region] += 1
                if ev_country and tc and tc != ev_country:
                    region_visitors_raw[region][tk] += 1
        print(f"  {year}: done ({len(evs)} events)")

    # Resolve home region = most-attended region
    team_home: dict[str, str] = {
        tk: counts.most_common(1)[0][0] for tk, counts in team_region_counts.items()
    }
    region_team_count = Counter(team_home.values())

    # ── Phase 3b: Active teams for CURRENT calendar year ──────
    # "Active" = team from a region registered at ANY event in the current year
    import datetime
    ACTIVE_YEAR = datetime.date.today().year  # 2026
    print(f"\nPhase 3b: Resolving {ACTIVE_YEAR} active team counts...")
    # 2026 events are already fetched in Phase 3 — collect team keys from that year
    active_team_keys: set[str] = set()
    active_year_evs = year_events.get(ACTIVE_YEAR, [])
    active_results = await asyncio.gather(
        *[_safe(client.get_event_teams(e["key"])) for e in active_year_evs]
    )
    for teams in active_results:
        if teams:
            for t in teams:
                active_team_keys.add(t["key"])
    print(f"  {ACTIVE_YEAR} events: {len(active_year_evs)}, "
          f"active teams: {len(active_team_keys)}")

    print(f"  Unique teams (5yr sample): {len(team_info)}")

    # ── Phase 3c: Official FIRST district team counts ─────────
    print(f"\nPhase 3c: Fetching official FIRST district team counts...")
    official_team_counts: dict[str, int] = {}  # district display_name → count
    try:
        frc = get_frc_client()
        districts = await frc.get(f"/{ACTIVE_YEAR}/districts")
        for d in districts.get("districts", []):
            code = d["code"]
            name = d["name"]
            teams_data = await _safe(frc.get(f"/{ACTIVE_YEAR}/teams?districtCode={code}&page=1"))
            if teams_data and "teamCountTotal" in teams_data:
                official_team_counts[name] = teams_data["teamCountTotal"]
                print(f"  {name}: {teams_data['teamCountTotal']} teams (official)")
    except Exception as e:
        print(f"  Warning: Could not fetch FIRST district counts: {e}")

    # ── Phase 4: Championship analysis ────────────────────────
    print("\nPhase 4: Championship awards & Einstein...")
    champ_keys = [e["key"] for e in all_events if e.get("event_type") in (3, 4)]
    # Einstein/CMP Finals only meaningful from 2001+ (divisions introduced);
    # pre-2001 had no divisions so every attendee would incorrectly count.
    einstein_keys = [e["key"] for e in all_events
                     if e.get("event_type") == 4 and int(e["key"][:4]) >= 2001]
    print(f"  CMP events: {len(champ_keys)}, Einstein: {len(einstein_keys)}")

    hof_by_team: dict[str, list[int]] = defaultdict(list)
    impact_fin_by_team: dict[str, list[int]] = defaultdict(list)

    print("  Fetching CMP awards...")
    for i in range(0, len(champ_keys), BATCH):
        batch = champ_keys[i:i + BATCH]
        results = await asyncio.gather(
            *[_safe(client.get(f"/event/{ek}/awards")) for ek in batch]
        )
        for ek, awards in zip(batch, results):
            if not awards:
                continue
            yr = int(ek[:4])
            for a in awards:
                at = a.get("award_type")
                for r in a.get("recipient_list", []):
                    tk = r.get("team_key")
                    if not tk:
                        continue
                    if at == 0:
                        hof_by_team[tk].append(yr)
                    elif at == 69:
                        impact_fin_by_team[tk].append(yr)

    einstein_winner_by_team: dict[str, list[int]] = defaultdict(list)
    print("  Fetching Einstein/Championship awards (winners)...")
    # For winners, include ALL event_type==4 (pre-2001 single CMP + post-2001 Einstein)
    all_cmp_finals_keys = [e["key"] for e in all_events if e.get("event_type") == 4]
    einstein_award_results = await asyncio.gather(
        *[_safe(client.get(f"/event/{ek}/awards")) for ek in all_cmp_finals_keys]
    )
    for ek, awards in zip(all_cmp_finals_keys, einstein_award_results):
        if not awards:
            continue
        yr = int(ek[:4])
        for a in awards:
            if a.get("award_type") == 1:  # Winner
                for r in a.get("recipient_list", []):
                    tk = r.get("team_key")
                    if tk:
                        einstein_winner_by_team[tk].append(yr)

    # ── Phase 4b: Resolve CMP division for each Einstein winner ─
    # Build a map of (team_key, year) → division short name from CMP Division
    # event rosters (event_type=3).
    print("  Resolving Einstein winners' CMP divisions...")
    div_events = [e for e in all_events if e.get("event_type") == 3]
    # Only fetch rosters for years where we have Einstein winners
    winner_years = set()
    for yrs in einstein_winner_by_team.values():
        winner_years.update(yrs)
    div_events_needed = [e for e in div_events if int(e["key"][:4]) in winner_years]
    div_roster_results = await asyncio.gather(
        *[_safe(client.get(f"/event/{e['key']}/teams/keys")) for e in div_events_needed]
    )
    team_year_division: dict[tuple[str, int], str] = {}  # (team_key, year) → division
    for ev, roster in zip(div_events_needed, div_roster_results):
        if not roster:
            continue
        yr = int(ev["key"][:4])
        # Extract short division name: "Archimedes Division" → "Archimedes"
        div_name = (ev.get("name") or ev["key"]).replace(" Division", "")
        for tk in roster:
            if isinstance(tk, str):
                team_year_division[(tk, yr)] = div_name
    print(f"  Division mappings: {len(team_year_division)}")

    einstein_by_team: dict[str, list[int]] = defaultdict(list)
    print("  Collecting Einstein teams from division winning alliances + match data...")
    # Einstein alliances have 3-4 teams but only 3 play per match.  The 4th
    # member (backup) never appears in match data.  Meanwhile, the Einstein
    # *roster* on TBA also includes award-only recipients (Impact, Dean's List)
    # who were never part of a playing alliance.
    #
    # Correct approach: union of
    #   1) Division winning alliance picks (event_type=3, status=="won") — all
    #      members, including backups who didn't play.
    #   2) Einstein match data — catches any edge cases and older years where
    #      alliance data may be missing.
    #   3) Einstein roster fallback — for very old events with neither.

    # 1) Division winning alliances → team→year
    print("    Fetching division winning alliances...")
    div_alliance_results = await asyncio.gather(
        *[_safe(client.get(f"/event/{e['key']}/alliances")) for e in div_events]
    )
    for ev, alliances in zip(div_events, div_alliance_results):
        if not alliances:
            continue
        yr = int(ev["key"][:4])
        if yr < 2001:
            continue  # pre-division era
        for a in alliances:
            if a.get("status", {}).get("status") == "won":
                for tk in a.get("picks", []):
                    if isinstance(tk, str):
                        einstein_by_team[tk].append(yr)

    # 2) Einstein match data — supplement with any teams that played
    print("    Fetching Einstein match data...")
    match_results = await asyncio.gather(
        *[_safe(client.get(f"/event/{ek}/matches/simple")) for ek in einstein_keys]
    )
    # Also fetch rosters as fallback for years without match or alliance data
    roster_results = await asyncio.gather(
        *[_safe(client.get(f"/event/{ek}/teams/simple")) for ek in einstein_keys]
    )
    for ek, matches, roster in zip(einstein_keys, match_results, roster_results):
        yr = int(ek[:4])
        teams_in_matches: set[str] = set()
        if matches:
            for m in matches:
                for color in ("red", "blue"):
                    teams_in_matches.update(
                        m.get("alliances", {}).get(color, {}).get("team_keys", [])
                    )
        if teams_in_matches:
            for tk in teams_in_matches:
                einstein_by_team[tk].append(yr)
        elif not any(yr in yrs for yrs in einstein_by_team.values()) and roster:
            # 3) Fallback for older events with no match data AND no alliance data.
            #    SKIP current year — TBA lists unassigned championship-eligible
            #    teams on the Einstein roster before divisions are set, which
            #    would incorrectly inflate the Einstein count.
            if yr >= ACTIVE_YEAR:
                continue
            for t in roster:
                einstein_by_team[t["key"]].append(yr)

    # Deduplicate years per team
    for tk in einstein_by_team:
        einstein_by_team[tk] = sorted(set(einstein_by_team[tk]))

    print(f"  HoF: {len(hof_by_team)}, Impact fin: {len(impact_fin_by_team)}, "
          f"Einstein winners: {len(einstein_winner_by_team)}, Einstein: {len(einstein_by_team)}")

    # ── Phase 5: Fetch missing team info ──────────────────────
    print("\nPhase 5: Fetching additional team info...")
    needed = set(hof_by_team) | set(impact_fin_by_team) | set(einstein_by_team) | set(einstein_winner_by_team)
    missing = [tk for tk in needed if tk not in team_info]
    print(f"  Missing: {len(missing)}")
    for i in range(0, len(missing), BATCH):
        batch = missing[i:i + BATCH]
        results = await asyncio.gather(
            *[_safe(client.get(f"/team/{tk}")) for tk in batch]
        )
        for tk, info in zip(batch, results):
            if info:
                team_info[tk] = {
                    "team_number": info.get("team_number"),
                    "nickname": info.get("nickname", ""),
                    "country": _norm(info.get("country", "") or ""),
                    "state_prov": info.get("state_prov", ""),
                }

    def _true_home(tk: str) -> str:
        """Resolve a team's home region from their TBA-registered address,
        NOT from which events they attend (avoids crediting visitors)."""
        inf = team_info.get(tk, {})
        c = inf.get("country", "")
        sp = inf.get("state_prov", "")
        result = None
        # International team → match by country label
        if c and c not in ("USA", ""):
            # Canadian teams: route by province if a district exists
            if "Canada" in c or "canada" in c.lower():
                dist = _CANADA_PROVINCE_DISTRICT.get(sp)
                if dist:
                    return dist
                return "Canada"
            for lab in _COUNTRY_LABELS:
                if lab.lower() in c.lower() or c.lower() in lab.lower():
                    result = lab
                    break
            if result is None:
                result = c
        # US team → check if their state belongs to a district first
        elif sp:
            home = team_home.get(tk)
            if home and home.startswith("FIRST"):
                result = home
            else:
                for reg, sts in _REGION_MAP.items():
                    if sp in sts:
                        result = reg
                        break
        if result is None:
            result = team_home.get(tk, "Other")
        # Apply merge mapping (e.g. "Israel" → "FIRST Israel")
        return _REGION_MERGE.get(result, result)

    # ── Phase 6: Map achievements to regions ──────────────────
    print("\nPhase 6: Mapping achievements to home regions...")
    build = lambda: defaultdict(list)
    r_hof, r_imp, r_ein, r_ein_win = build(), build(), build(), build()

    for tk, yrs in hof_by_team.items():
        reg = _true_home(tk)
        inf = team_info.get(tk, {})
        r_hof[reg].append({
            "team_number": inf.get("team_number", int(tk[3:])),
            "nickname": inf.get("nickname", ""),
            "years": sorted(set(yrs)),
        })

    for tk, yrs in impact_fin_by_team.items():
        reg = _true_home(tk)
        inf = team_info.get(tk, {})
        r_imp[reg].append({
            "team_number": inf.get("team_number", int(tk[3:])),
            "nickname": inf.get("nickname", ""),
            "years": sorted(set(yrs)),
        })

    for tk, yrs in einstein_by_team.items():
        reg = _true_home(tk)
        inf = team_info.get(tk, {})
        r_ein[reg].append({
            "team_number": inf.get("team_number", int(tk[3:])),
            "nickname": inf.get("nickname", ""),
            "years": sorted(set(yrs)),
        })

    for tk, yrs in einstein_winner_by_team.items():
        reg = _true_home(tk)
        inf = team_info.get(tk, {})
        wins = []
        for y in sorted(set(yrs)):
            div = team_year_division.get((tk, y), "")
            wins.append({"year": y, "division": div})
        r_ein_win[reg].append({
            "team_number": inf.get("team_number", int(tk[3:])),
            "nickname": inf.get("nickname", ""),
            "years": sorted(set(yrs)),
            "wins": wins,
        })

    # ── Phase 7: International visitors ───────────────────────
    print("\nPhase 7: Top international visitors...")
    r_vis: dict[str, list] = {}
    for region, counts in region_visitors_raw.items():
        # Include all visitors with more than 1 appearance
        multi = [(tk, cnt) for tk, cnt in counts.most_common() if cnt > 1]
        items = []
        for tk, cnt in multi:
            inf = team_info.get(tk, {})
            items.append({
                "team_number": inf.get("team_number", int(tk[3:])),
                "nickname": inf.get("nickname", ""),
                "country": inf.get("country", ""),
                "appearances": cnt,
            })
        if items:
            r_vis[region] = items

    # ── Phase 7b: Resolve active teams per region ──────────────
    # Use _true_home (team's registered country/state) instead of team_home
    # (most-attended event region) to avoid inflating counts with visitors.
    print(f"\nPhase 7b: Resolving {len(active_team_keys)} active {ACTIVE_YEAR} teams to home regions...")

    # Ensure team_info is populated for every active team
    active_missing = [tk for tk in active_team_keys if tk not in team_info]
    if active_missing:
        print(f"  Fetching info for {len(active_missing)} active teams not yet in team_info...")
        for i in range(0, len(active_missing), BATCH):
            batch = active_missing[i:i + BATCH]
            results = await asyncio.gather(
                *[_safe(client.get(f"/team/{tk}")) for tk in batch]
            )
            for tk, info in zip(batch, results):
                if info:
                    team_info[tk] = {
                        "team_number": info.get("team_number"),
                        "nickname": info.get("nickname", ""),
                        "country": _norm(info.get("country", "") or ""),
                        "state_prov": info.get("state_prov", ""),
                    }

    current_season_by_region: Counter = Counter()
    for tk in active_team_keys:
        current_season_by_region[_true_home(tk)] += 1

    # ── Phase 8: Assemble ─────────────────────────────────────
    print("\nPhase 8: Assembling...")
    output = {}
    for rn in sorted(region_events):
        m = region_meta[rn]
        hof = sorted(r_hof.get(rn, []), key=lambda x: x.get("team_number", 0))
        imp = sorted(r_imp.get(rn, []), key=lambda x: x.get("team_number", 0))
        ein = sorted(r_ein.get(rn, []),
                     key=lambda x: (-len(x.get("years", [])), x.get("team_number", 0)))
        ein_win = sorted(r_ein_win.get(rn, []),
                         key=lambda x: (-len(x.get("years", [])), x.get("team_number", 0)))
        output[rn] = {
            "first_event_year": m["first_event_year"],
            "first_event_name": m["first_event_name"],
            "active_years": m["active_years"],
            "total_events": m["total_events"],
            "team_count": region_team_count.get(rn, 0),
            "current_season_teams": current_season_by_region.get(rn, 0),
            "active_year": ACTIVE_YEAR,
            "hof_teams": hof,
            "hof_count": len(hof),
            "impact_finalists": imp,
            "impact_count": len(imp),
            "einstein_winners": ein_win,
            "einstein_winner_count": len(ein_win),
            "einstein_teams": ein[:25],
            "einstein_count": len(ein),
            "top_international_visitors": r_vis.get(rn, []),
        }
        if rn in official_team_counts:
            output[rn]["official_team_count"] = official_team_counts[rn]

    # ── Phase 8b: Merge pre-district regions into districts ───
    # Regions that transitioned from regionals to a district system
    # get their pre-district event history folded into the district entry.
    _MERGE_INTO = {
        "Israel": "FIRST Israel",
        "Texas": "FIRST In Texas",
        "California": "FIRST California",
        "Wisconsin": "FIRST Wisconsin",
        "Indiana": "FIRST Indiana Robotics",
        "Michigan": "FIRST in Michigan",
        "North Carolina": "FIRST North Carolina",
        "South Carolina": "FIRST South Carolina",
        "Georgia": "Peachtree",
        "Chesapeake": "FIRST Chesapeake",
        "Mid-Atlantic": "FIRST Mid-Atlantic",
    }
    _DROP = {"San Jose"}  # one-off region with 0 teams

    for src, dst in _MERGE_INTO.items():
        if src not in output or dst not in output:
            continue
        s, d = output[src], output[dst]
        print(f"  Merging '{src}' → '{dst}'")

        # Merge first event (take the earlier)
        if (s["first_event_year"] or 9999) < (d["first_event_year"] or 9999):
            d["first_event_year"] = s["first_event_year"]
            d["first_event_name"] = s["first_event_name"]

        # Merge active years + event counts
        d["active_years"] = sorted(set(d["active_years"]) | set(s["active_years"]))
        d["total_events"] += s["total_events"]
        d["team_count"] += s["team_count"]
        d["current_season_teams"] = d.get("current_season_teams", 0) + s.get("current_season_teams", 0)

        # Merge achievement lists (deduplicate by team_number)
        def _merge_list(dst_list, src_list, sort_key):
            seen = {t["team_number"] for t in dst_list}
            for t in src_list:
                if t["team_number"] not in seen:
                    dst_list.append(t)
                    seen.add(t["team_number"])
                else:
                    # Merge years for same team
                    for existing in dst_list:
                        if existing["team_number"] == t["team_number"]:
                            existing["years"] = sorted(set(existing.get("years", [])
                                                           + t.get("years", [])))
                            break
            return sorted(dst_list, key=sort_key)

        d["hof_teams"] = _merge_list(d["hof_teams"], s["hof_teams"],
                                      lambda x: x.get("team_number", 0))
        d["hof_count"] = len(d["hof_teams"])

        d["impact_finalists"] = _merge_list(d["impact_finalists"], s["impact_finalists"],
                                             lambda x: x.get("team_number", 0))
        d["impact_count"] = len(d["impact_finalists"])

        # Merge einstein_winners with wins[] sub-lists
        def _merge_winners(dst_list, src_list, sort_key):
            seen = {t["team_number"]: t for t in dst_list}
            for t in src_list:
                tn = t["team_number"]
                if tn not in seen:
                    dst_list.append(t)
                    seen[tn] = t
                else:
                    existing = seen[tn]
                    existing["years"] = sorted(set(existing.get("years", [])
                                                   + t.get("years", [])))
                    # Merge wins lists, dedup by year
                    ew = {w["year"]: w for w in existing.get("wins", [])}
                    for w in t.get("wins", []):
                        if w["year"] not in ew:
                            ew[w["year"]] = w
                    existing["wins"] = sorted(ew.values(), key=lambda w: w["year"])
            return sorted(dst_list, key=sort_key)

        d["einstein_winners"] = _merge_winners(
            list(d.get("einstein_winners", [])), s.get("einstein_winners", []),
            lambda x: (-len(x.get("years", [])), x.get("team_number", 0)))
        d["einstein_winner_count"] = len(d["einstein_winners"])

        all_ein = list(d.get("einstein_teams", []))
        _merge_list(all_ein, s.get("einstein_teams", []),
                    lambda x: (-len(x.get("years", [])), x.get("team_number", 0)))
        d["einstein_teams"] = all_ein[:25]
        d["einstein_count"] = max(d.get("einstein_count", 0),
                                  len(all_ein))  # true count

        # Merge visitors – combine counts for same team, keep all with appearances > 1
        dst_vis = d.get("top_international_visitors", [])
        src_vis = s.get("top_international_visitors", [])
        by_num = {v["team_number"]: v for v in dst_vis}
        for v in src_vis:
            tn = v["team_number"]
            if tn in by_num:
                by_num[tn]["appearances"] += v["appearances"]
            else:
                by_num[tn] = dict(v)
        merged = sorted(by_num.values(),
                        key=lambda x: (-x["appearances"], x["team_number"]))
        d["top_international_visitors"] = [v for v in merged if v["appearances"] > 1]

        del output[src]

    for drop in _DROP:
        output.pop(drop, None)

    # ── Phase 8c: Inclusive country stats ─────────────────────
    # Some countries have a district coexisting with regionals.
    # The "Canada" entry should include Ontario history so that a
    # caster at a BC or QC regional sees all of Canada's FRC history.
    _INCLUSIVE = {
        "Canada": "FIRST Canada - Ontario",
    }
    for parent, child in _INCLUSIVE.items():
        if parent not in output or child not in output:
            continue
        p, c = output[parent], output[child]
        print(f"  Including '{child}' stats in '{parent}'")

        if (c["first_event_year"] or 9999) < (p["first_event_year"] or 9999):
            p["first_event_year"] = c["first_event_year"]
            p["first_event_name"] = c["first_event_name"]

        p["active_years"] = sorted(set(p["active_years"]) | set(c["active_years"]))
        p["total_events"] += c["total_events"]
        p["team_count"] += c["team_count"]
        p["current_season_teams"] = p.get("current_season_teams", 0) + c.get("current_season_teams", 0)

        def _copy_merge(dst_list, src_list, sort_key):
            """Merge src into dst (copies, no mutation of src), dedup by team_number."""
            import copy
            dst_list = [copy.deepcopy(t) for t in dst_list]
            seen = {t["team_number"]: t for t in dst_list}
            for t in src_list:
                tn = t["team_number"]
                if tn not in seen:
                    dst_list.append(copy.deepcopy(t))
                    seen[tn] = dst_list[-1]
                else:
                    existing = seen[tn]
                    existing["years"] = sorted(set(existing.get("years", []) + t.get("years", [])))
                    if "wins" in t:
                        ew = {w["year"]: w for w in existing.get("wins", [])}
                        for w in t.get("wins", []):
                            if w["year"] not in ew:
                                ew[w["year"]] = w
                        existing["wins"] = sorted(ew.values(), key=lambda w: w["year"])
            return sorted(dst_list, key=sort_key)

        p["hof_teams"] = _copy_merge(p["hof_teams"], c["hof_teams"],
                                      lambda x: x.get("team_number", 0))
        p["hof_count"] = len(p["hof_teams"])

        p["impact_finalists"] = _copy_merge(p["impact_finalists"], c["impact_finalists"],
                                             lambda x: x.get("team_number", 0))
        p["impact_count"] = len(p["impact_finalists"])

        p["einstein_winners"] = _copy_merge(
            p.get("einstein_winners", []), c.get("einstein_winners", []),
            lambda x: (-len(x.get("years", [])), x.get("team_number", 0)))
        p["einstein_winner_count"] = len(p["einstein_winners"])

        all_ein = _copy_merge(
            p.get("einstein_teams", []), c.get("einstein_teams", []),
            lambda x: (-len(x.get("years", [])), x.get("team_number", 0)))
        p["einstein_teams"] = all_ein[:25]
        p["einstein_count"] = max(p.get("einstein_count", 0), len(all_ein))

        # Merge visitors
        by_num = {v["team_number"]: dict(v) for v in p.get("top_international_visitors", [])}
        for v in c.get("top_international_visitors", []):
            tn = v["team_number"]
            if tn in by_num:
                by_num[tn]["appearances"] += v["appearances"]
            else:
                by_num[tn] = dict(v)
        merged_vis = sorted(by_num.values(), key=lambda x: (-x["appearances"], x["team_number"]))
        p["top_international_visitors"] = [v for v in merged_vis if v["appearances"] > 1]

    print(f"  Final regions: {len(output)}")

    out_path = Path(__file__).resolve().parent.parent / "docs" / "data" / "region_stats.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\nDone! -> {out_path}")
    print(f"Regions: {len(output)}")
    for name, d in sorted(output.items(), key=lambda x: -x[1]["team_count"]):
        print(f"  {name}: {d['team_count']} teams, {d['total_events']} events, "
              f"{d['hof_count']} HoF, {d['einstein_count']} Einstein")


if __name__ == "__main__":
    t0 = time.time()
    asyncio.run(generate())
    print(f"\nTotal: {time.time() - t0:.1f}s")
