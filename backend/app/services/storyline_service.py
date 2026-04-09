"""AI Broadcast Storylines — assembles rich team dossiers and calls Anthropic LLM."""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import date
from typing import Any, Optional

from ..config import ANTHROPIC_API_KEY

log = logging.getLogger(__name__)

# ── In-memory caches ────────────────────────────────────────
# Storyline: key → (timestamp, storyline_text, match_count)
_cache: dict[str, tuple[float, str, int | None]] = {}
_CACHE_TTL = 7200  # 2 hours (fallback when match count unchanged)

# Team dossier: (team_key, event_key) → (timestamp, dossier_dict)
_dossier_cache: dict[str, tuple[float, dict]] = {}
_DOSSIER_TTL = 300  # 5 minutes — short-lived but avoids rebuild on rapid requests

# ── Anthropic client (lazy) ─────────────────────────────────
_anthropic_client = None


def _get_client():
    global _anthropic_client
    if _anthropic_client is None:
        import anthropic
        _anthropic_client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
    return _anthropic_client


def is_available() -> bool:
    """Return True if the Anthropic API key is configured."""
    return bool(ANTHROPIC_API_KEY)


# ── System prompts ──────────────────────────────────────────
_MATCH_SYSTEM_PROMPT = (
    "You are a veteran FIRST Robotics Competition broadcast commentator. "
    "Write 2-3 punchy sentences a play-by-play host can read straight off a teleprompter. "
    "HARD LIMIT: 80 words maximum — count carefully. "
    "Structure: Sentence 1 sets up tension or context (rivalry, underdog, stakes). "
    "Sentence 2 delivers the payoff (what to watch for, why it matters right now). "
    "An optional short sentence 3 can spotlight an alliance partner with a compelling story. "
    "Try to mention at least one non-captain team per alliance when there is a good angle. "
    "Prioritize the NARRATIVE HINTS section — those are pre-computed insights about "
    "improvement trajectories, award progressions, banner droughts, and underdog stories. "
    "Weave them into a story, don't just list stats. "
    "Also consider: rivalry between specific teams on the field, redemption arcs, "
    "rookie underdogs vs veterans, blue-banner pedigree clashes, or upset potential. "
    "FIRST award hierarchy context: "
    "Blue Banners (event wins + Impact Award) are the pinnacle. "
    "Engineering Inspiration is one step below Impact — a team that has won EI "
    "but not Impact is on the brink of reaching the top. "
    "Robot awards (Industrial Design, Innovation in Control, Quality, Creativity) "
    "show technical merit but are a lower tier. "
    "A team that wins awards but has never won a blue banner is noteworthy. "
    "A team whose last banner was many years ago is chasing past glory. "
    "Style rules: "
    "- Use ONLY facts from the dossier — never invent statistics or records. "
    "- Never quote raw OPR or EPA numbers. Use relative language instead "
    "(e.g. 'the event's top scorer', 'a defensive specialist'). "
    "- Name teams by number AND nickname (e.g. '4481 Team Rembrandts'). "
    "- No generic filler — every clause must carry specific information. "
    "BANNED WORDS AND PHRASES (never use these): "
    "'powerhouse', 'flawless', 'proving', 'showcasing', 'demonstrating', "
    "'impressive experience', 'translates across', 'at the highest levels', "
    "'completing the prestigious', 'coveted progression', 'technical excellence', "
    "'championship aspirations', 'making a statement'. "
    "Write like a sports journalist — concrete details, not hype. "
    "- Do NOT parrot narrative hints verbatim — use the insight but rephrase naturally. "
    "- If a team's record includes losses, acknowledge it honestly. "
    "- No hashtags."
)

_TEAM_SYSTEM_PROMPT = (
    "You are a veteran FIRST Robotics Competition broadcast commentator. "
    "Write exactly 2 punchy sentences a play-by-play host can read straight off a teleprompter. "
    "Keep the total under 60 words — short enough to read in one breath per sentence. "
    "Structure: Sentence 1 sets up who this team is and what's at stake for them. "
    "Sentence 2 delivers insight — what they've done at this event and why it matters. "
    "Prioritize the NARRATIVE HINTS section — those are pre-computed insights about "
    "improvement trajectories, award progressions, banner droughts, and underdog stories. "
    "Weave them into a story, don't just list stats. "
    "Also consider: narrative arcs (comeback, dynasty, underdog), specific award legacy, "
    "or local-favorite energy. "
    "FIRST award hierarchy context: "
    "Blue Banners (event wins + Impact Award) are the pinnacle. "
    "Engineering Inspiration is one step below Impact — a team chasing their first "
    "Impact after winning EI is a compelling story. "
    "Robot awards (Industrial Design, Innovation in Control, Quality, Creativity) "
    "show technical merit but are a lower tier. "
    "A team winning awards but never a blue banner, or whose last banner was years ago, "
    "is noteworthy — use that tension. "
    "Style rules: "
    "- Use ONLY facts from the dossier — never invent statistics or records. "
    "- Never quote raw OPR or EPA numbers. Use relative language instead. "
    "- Name the team by number AND nickname. "
    "- No generic filler — every clause must carry specific information. "
    "BANNED WORDS AND PHRASES (never use these): "
    "'powerhouse', 'flawless', 'proving', 'showcasing', 'demonstrating', "
    "'impressive experience', 'translates across', 'at the highest levels', "
    "'completing the prestigious', 'coveted progression', 'technical excellence', "
    "'championship aspirations', 'making a statement'. "
    "Write like a sports journalist — concrete details, not hype. "
    "- Do NOT parrot narrative hints verbatim — use the insight but rephrase naturally. "
    "- If a team's record includes losses, acknowledge it honestly. "
    "- No hashtags."
)


# ── Safe fetch wrapper ──────────────────────────────────────
async def _safe(coro, default=None):
    try:
        return await coro
    except Exception:
        return default


# ── Dossier assembly ────────────────────────────────────────
async def _build_team_dossier(team_key: str, event_key: str, year: int) -> dict:
    """Assemble a rich context dossier for a single team (with short-lived cache)."""
    # Check dossier cache (avoids ~8 TBA calls per team on rapid requests)
    dossier_key = f"{team_key}:{event_key}"
    now = time.time()
    if dossier_key in _dossier_cache:
        ts, cached_dossier = _dossier_cache[dossier_key]
        if now - ts < _DOSSIER_TTL:
            return cached_dossier

    dossier = await _build_team_dossier_uncached(team_key, event_key, year)
    _dossier_cache[dossier_key] = (now, dossier)
    return dossier


async def _build_team_dossier_uncached(team_key: str, event_key: str, year: int) -> dict:
    """Assemble a rich context dossier for a single team."""
    from .tba_client import get_tba_client
    from .statbotics_client import get_statbotics_client

    tba = get_tba_client()
    team_num = int(team_key.replace("frc", ""))

    # Parallel fetch all data sources
    (
        team_info,
        all_awards,
        season_awards,
        season_statuses,
        all_events_simple,
        event_info,
        event_teams_list,
    ) = await asyncio.gather(
        tba.get_team(team_key),
        _safe(tba.get_team_awards(team_key), []),
        _safe(tba.get_team_awards_year(team_key, year), []),
        _safe(tba.get_team_events_statuses(team_key, year), {}),
        _safe(tba.get_team_events_simple(team_key), []),
        _safe(tba.get_event(event_key), {}),
        _safe(tba.get_event_teams(event_key), []),
    )

    # Try EPA from Statbotics (non-critical)
    sb = get_statbotics_client()
    epa_data = await _safe(sb.get(f"/team_year/{team_num}/{year}"))

    # Build event type lookup for award classification
    event_type_map: dict[str, int] = {}
    event_name_map: dict[str, str] = {}
    if all_events_simple:
        for ev in all_events_simple:
            event_type_map[ev["key"]] = ev.get("event_type", -1)
            event_name_map[ev["key"]] = ev.get("name", ev["key"])

    # Process awards
    BLUE_BANNER_TYPES = {0, 1, 3}
    OFFSEASON_TYPES = {99, 100, -1}
    blue_banner_count = 0
    blue_banner_years: list[int] = []
    event_winner_years: list[int] = []  # type 1 (non-offseason, non-Einstein)
    hof_years = []
    impact_finalist_years = []
    einstein_win_years = []
    chairmans_years = []
    ei_years: list[int] = []           # Engineering Inspiration wins
    ras_years: list[int] = []          # Rookie All-Star (10) / Rising All-Star (83) wins

    if all_awards:
        for aw in all_awards:
            aw_type = aw.get("award_type")
            aw_event = aw.get("event_key", "")
            ev_type = event_type_map.get(aw_event, -1)
            aw_year = aw.get("year")

            if aw_type in BLUE_BANNER_TYPES and ev_type not in OFFSEASON_TYPES:
                blue_banner_count += 1
                if aw_year:
                    blue_banner_years.append(aw_year)

            # Event Winner at regional/district (not Einstein)
            if aw_type == 1 and ev_type not in OFFSEASON_TYPES and ev_type != 4:
                if aw_year:
                    event_winner_years.append(aw_year)
            # HoF = Chairman's/Impact winner at CMP Finals
            if aw_type == 0 and ev_type == 4:
                hof_years.append(aw_year)
            # Impact finalist at CMP
            if aw_type == 69 and ev_type == 4:
                impact_finalist_years.append(aw_year)
            # Einstein winner
            if aw_type == 1 and ev_type == 4:
                einstein_win_years.append(aw_year)
            # Chairman's/Impact wins at any level
            if aw_type == 0:
                chairmans_years.append(aw_year)
            # Engineering Inspiration
            if aw_type == 9 and ev_type not in OFFSEASON_TYPES:
                if aw_year:
                    ei_years.append(aw_year)
            # Rookie All-Star (10) / Rising All-Star (83)
            if aw_type in {10, 83} and ev_type not in OFFSEASON_TYPES:
                if aw_year:
                    ras_years.append(aw_year)

    # Season awards at OTHER events this year — categorized
    _EI_TYPE = 9
    _IMPACT_TYPE = 0
    # Robot performance awards (basic tier)
    _ROBOT_AWARD_TYPES = {16, 17, 20, 21, 29}
    # Industrial Design=16, Quality=17, Creativity=20,
    # Engineering Excellence=21, Innovation in Control=29
    season_award_names = []
    season_award_tiers: list[str] = []  # "impact", "ei", "robot", "other"
    if season_awards:
        for aw in season_awards:
            aw_event = aw.get("event_key", "")
            if aw_event != event_key:
                aw_name = aw.get("name", "")
                aw_type = aw.get("award_type")
                ev_name = event_name_map.get(aw_event, aw_event)
                season_award_names.append(f"{aw_name} at {ev_name}")
                if aw_type == _IMPACT_TYPE:
                    season_award_tiers.append("impact")
                elif aw_type == _EI_TYPE:
                    season_award_tiers.append("ei")
                elif aw_type in _ROBOT_AWARD_TYPES:
                    season_award_tiers.append("robot")
                else:
                    season_award_tiers.append("other")

    # This-event awards
    this_event_awards: list[str] = []
    if season_awards:
        for aw in season_awards:
            if aw.get("event_key") == event_key:
                this_event_awards.append(aw.get("name", ""))

    # Season results at other events
    season_results = []
    if isinstance(season_statuses, dict):
        for ek, st in season_statuses.items():
            if ek == event_key or not isinstance(st, dict):
                continue
            ev_name = event_name_map.get(ek, ek)
            qual = st.get("qual")
            playoff = st.get("playoff")
            qual_rank = (qual.get("ranking", {}).get("rank", "?")) if qual else "?"
            qual_record = qual.get("ranking", {}).get("record", {}) if qual else {}
            wlt = f'{qual_record.get("wins", 0)}-{qual_record.get("losses", 0)}-{qual_record.get("ties", 0)}' if qual_record else "?"
            po_status = ""
            if playoff:
                level = playoff.get("level", "")
                status = playoff.get("status", "")
                if status == "won" and level == "f":
                    po_status = "Event Winner"
                elif level == "f":
                    po_status = "Finalist"
                elif level == "sf":
                    po_status = "Semifinalist"
                else:
                    po_status = f"Eliminated in {level}"
            season_results.append({
                "event": ev_name,
                "rank": qual_rank,
                "record": wlt,
                "playoff": po_status,
            })

    # This-event status
    this_status = season_statuses.get(event_key, {}) if isinstance(season_statuses, dict) else {}
    this_qual = this_status.get("qual") if this_status else None
    this_rank = (this_qual.get("ranking", {}).get("rank", "?")) if this_qual else "?"
    this_record = this_qual.get("ranking", {}).get("record", {}) if this_qual else {}
    this_wlt = f'{this_record.get("wins", 0)}-{this_record.get("losses", 0)}-{this_record.get("ties", 0)}' if this_record else "?"

    # Cross-check record with actual match scores (TBA ranking records
    # can be stale or wrong — verify against played match data)
    try:
        matches = await _safe(tba.get_team_event_matches(team_key, event_key), [])
        if matches:
            w, l, t = 0, 0, 0
            for mt in matches:
                if mt.get("comp_level") != "qm":
                    continue
                red = mt.get("alliances", {}).get("red", {})
                blue = mt.get("alliances", {}).get("blue", {})
                in_red = team_key in (red.get("team_keys") or [])
                my_score = red.get("score", -1) if in_red else blue.get("score", -1)
                opp_score = blue.get("score", -1) if in_red else red.get("score", -1)
                if my_score < 0 or opp_score < 0:
                    continue  # unplayed match
                if my_score > opp_score:
                    w += 1
                elif my_score < opp_score:
                    l += 1
                else:
                    t += 1
            if w + l + t > 0:
                this_wlt = f"{w}-{l}-{t}"
    except Exception:
        pass  # keep ranking-based record as fallback

    # Alliance info at this event
    alliance_info = this_status.get("alliance") if this_status else None
    alliance_str = ""
    if alliance_info:
        pick_labels = ['Captain', '1st Pick', '2nd Pick', '3rd Pick', 'Backup']
        pick_idx = alliance_info.get("pick", 0)
        a_num = alliance_info.get("number")
        role = pick_labels[pick_idx] if pick_idx < len(pick_labels) else "Member"
        alliance_str = f"Alliance {a_num} {role}" if a_num else role

    # EPA
    epa_val = None
    if epa_data and isinstance(epa_data, dict):
        epa_obj = epa_data.get("epa", epa_data.get("epa_end"))
        if isinstance(epa_obj, dict):
            epa_val = epa_obj.get("total_points", {}).get("mean")
        elif isinstance(epa_obj, (int, float)):
            epa_val = epa_obj

    rookie_year = team_info.get("rookie_year") if team_info else None
    team_age = (year - rookie_year) if rookie_year else None

    # Travel history — how many times they've competed in this event's country/city
    event_country = (event_info.get("country") or "") if event_info else ""
    event_city = (event_info.get("city") or "") if event_info else ""
    team_country = team_info.get("country", "") if team_info else ""
    is_international = bool(team_country and event_country and team_country != event_country)

    visits_to_event_country = 0
    visit_years_in_country: list[int] = []
    if all_events_simple and event_country:
        for ev in all_events_simple:
            ev_type = ev.get("event_type", -1)
            if ev_type in {99, 100, -1}:  # skip offseason
                continue
            if ev.get("country") == event_country:
                visits_to_event_country += 1
                ev_year = ev.get("year")
                if ev_year:
                    visit_years_in_country.append(ev_year)
    first_year_in_country = min(visit_years_in_country) if visit_years_in_country else None
    first_time_in_country = (first_year_in_country == year) if first_year_in_country else False
    seasons_in_country = len(set(visit_years_in_country))

    # Home country FRC presence — does the team's country host any events?
    home_events_ever = 0
    if all_events_simple and team_country:
        for ev in all_events_simple:
            if ev.get("country") == team_country and ev.get("event_type", -1) not in {99, 100, -1}:
                home_events_ever += 1
    home_country_has_events = home_events_ever > 0

    # How many teams from the same country are at this event?
    countrymates_at_event = 0
    if event_teams_list and team_country:
        for t in event_teams_list:
            if t.get("country") == team_country:
                countrymates_at_event += 1
    # Subtract self
    if countrymates_at_event > 0:
        countrymates_at_event -= 1
    # ── Award progression milestones ──
    first_ei_year = min(ei_years) if ei_years else None
    first_impact_year = min(chairmans_years) if chairmans_years else None
    first_ras_year = min(ras_years) if ras_years else None

    ei_to_impact_seasons = (first_impact_year - first_ei_year) if (first_ei_year and first_impact_year) else None
    rookie_to_impact_seasons = (first_impact_year - rookie_year) if (rookie_year and first_impact_year) else None
    ras_to_impact_seasons = (first_impact_year - first_ras_year) if (first_ras_year and first_impact_year) else None
    seasons_since_ei_no_impact = (year - first_ei_year) if (first_ei_year and not first_impact_year) else None
    return {
        "team_number": team_num,
        "nickname": team_info.get("nickname", "") if team_info else "",
        "city": team_info.get("city", "") if team_info else "",
        "state_prov": team_info.get("state_prov", "") if team_info else "",
        "country": team_info.get("country", "") if team_info else "",
        "rookie_year": rookie_year,
        "team_age": team_age,
        "blue_banners": blue_banner_count,
        "blue_banner_years": sorted(set(blue_banner_years)),
        "is_hof": len(hof_years) > 0,
        "hof_years": sorted(set(hof_years)),
        "impact_finalist_years": sorted(set(impact_finalist_years)),
        "einstein_win_years": sorted(set(einstein_win_years)),
        "chairmans_impact_wins": len(set(chairmans_years)),
        "event_winner_years": sorted(set(event_winner_years)),
        "event_winner_count": len(set(event_winner_years)),
        "ei_wins": sorted(set(ei_years)),
        "ras_wins": sorted(set(ras_years)),
        "first_ei_year": first_ei_year,
        "first_impact_year": first_impact_year,
        "first_ras_year": first_ras_year,
        "ei_to_impact_seasons": ei_to_impact_seasons,
        "rookie_to_impact_seasons": rookie_to_impact_seasons,
        "ras_to_impact_seasons": ras_to_impact_seasons,
        "seasons_since_ei_no_impact": seasons_since_ei_no_impact,
        "epa": epa_val,
        "this_event_rank": this_rank,
        "this_event_record": this_wlt,
        "this_event_awards": this_event_awards,
        "alliance_role": alliance_str,
        "season_results": season_results,
        "season_awards_other_events": season_award_names,
        "current_year": year,
        # Travel context
        "event_country": event_country,
        "event_city": event_city,
        "is_international": is_international,
        "visits_to_event_country": visits_to_event_country,
        "seasons_in_country": seasons_in_country,
        "first_time_in_country": first_time_in_country,
        "first_year_in_country": first_year_in_country,
        "home_country_has_events": home_country_has_events,
        "countrymates_at_event": countrymates_at_event,
    }


def _format_team_dossier(d: dict) -> str:
    """Format a team dossier dict into human-readable text for the LLM."""
    lines = [f"Team {d['team_number']} — {d['nickname']}"]

    # Identity
    cur_year = d.get("current_year", date.today().year)
    lines.append(f"  Current season: {cur_year}")
    location_parts = [p for p in [d.get("city"), d.get("state_prov"), d.get("country")] if p]
    if location_parts:
        lines.append(f"  From: {', '.join(location_parts)}")
    if d.get("rookie_year"):
        lines.append(f"  Rookie year: {d['rookie_year']} ({d.get('team_age', '?')} seasons)")

    # Prestige — banners with recency context
    banner_count = d.get("blue_banners", 0)
    banner_years = d.get("blue_banner_years", [])
    if banner_count:
        last_banner = max(banner_years) if banner_years else None
        drought = (cur_year - last_banner) if last_banner else None
        banner_line = f"  Blue Banners: {banner_count}"
        if banner_years:
            banner_line += f" (years: {', '.join(str(y) for y in banner_years)})"
        if drought and drought >= 3:
            banner_line += f" — last banner {drought} seasons ago"
        lines.append(banner_line)
    else:
        lines.append("  Blue Banners: 0 — has never won a blue banner")

    if d.get("is_hof"):
        lines.append(f"  Hall of Fame inductee (years: {', '.join(str(y) for y in d['hof_years'])})")
    if d.get("impact_finalist_years"):
        lines.append(f"  Impact Award finalist at Championships: {', '.join(str(y) for y in d['impact_finalist_years'])}")
    if d.get("einstein_win_years"):
        lines.append(f"  Einstein/Championship winner: {', '.join(str(y) for y in d['einstein_win_years'])}")
    if d.get("chairmans_impact_wins") and d["chairmans_impact_wins"] > 0:
        lines.append(f"  Chairman's/Impact Award wins (all levels): {d['chairmans_impact_wins']}")
    if d.get("event_winner_count") and d["event_winner_count"] > 0:
        lines.append(f"  Event Winner (competition): {d['event_winner_count']} (years: {', '.join(str(y) for y in d.get('event_winner_years', []))})")
    if d.get("ei_wins"):
        lines.append(f"  Engineering Inspiration Award wins: {len(d['ei_wins'])} (years: {', '.join(str(y) for y in d['ei_wins'])})")
    if d.get("ras_wins"):
        lines.append(f"  Rookie All-Star / Rising All-Star: {', '.join(str(y) for y in d['ras_wins'])}")


    # This event
    if d.get("this_event_rank") and d["this_event_rank"] != "?":
        lines.append(f"  Rank at this event: {d['this_event_rank']} (record: {d.get('this_event_record', '?')})")
    if d.get("this_event_awards"):
        lines.append(f"  Awards at this event: {', '.join(d['this_event_awards'])}")
    if d.get("alliance_role"):
        lines.append(f"  Playoff role: {d['alliance_role']}")
    if d.get("epa") is not None:
        lines.append(f"  Season EPA: {d['epa']:.1f}")

    # Season results with trajectory
    if d.get("season_results"):
        lines.append("  Season results (other events):")
        for sr in d["season_results"]:
            po = f" → {sr['playoff']}" if sr.get("playoff") else ""
            lines.append(f"    - {sr['event']}: Rank {sr['rank']} ({sr['record']}){po}")

    # Season awards at other events
    if d.get("season_awards_other_events"):
        lines.append("  Awards won this season (other events):")
        for a in d["season_awards_other_events"]:
            lines.append(f"    - {a}")

    # Travel context
    event_country = d.get("event_country", "")
    team_country = d.get("country", "")
    is_intl = d.get("is_international", False)
    visits = d.get("visits_to_event_country", 0)
    seasons_visited = d.get("seasons_in_country", 0)
    first_time = d.get("first_time_in_country", False)
    home_has_events = d.get("home_country_has_events", True)
    countrymates = d.get("countrymates_at_event", 0)
    if is_intl:
        if first_time:
            lines.append(f"  Travel: First time competing in {event_country} (home country: {team_country})")
        elif seasons_visited > 1:
            first_yr = d.get("first_year_in_country")
            lines.append(f"  Travel: Has competed in {event_country} in {seasons_visited} seasons ({visits} events) since {first_yr} (home country: {team_country})")
    if team_country and not home_has_events:
        lines.append(f"  Home country ({team_country}): No FRC events — must always travel abroad to compete")

    # ── Computed narrative hints ─────────────────────────
    hints = []

    # Classify team profile: competition vs culture vs both
    event_wins = d.get("event_winner_count", 0)
    einstein_wins = len(d.get("einstein_win_years", []))
    impact_count = d.get("chairmans_impact_wins", 0)
    ei = d.get("ei_wins", [])
    ras = d.get("ras_wins", [])
    is_hof = d.get("is_hof", False)
    first_ei = d.get("first_ei_year")
    first_impact = d.get("first_impact_year")
    first_ras = d.get("first_ras_year")
    ei_to_impact = d.get("ei_to_impact_seasons")
    rookie_to_impact = d.get("rookie_to_impact_seasons")
    ras_to_impact = d.get("ras_to_impact_seasons")
    seasons_chasing = d.get("seasons_since_ei_no_impact")
    team_age = d.get("team_age", 99)

    has_competition = event_wins > 0 or einstein_wins > 0
    has_culture = impact_count > 0 or len(ei) > 0

    # Team profile — the LLM should pick the most relevant angle
    if has_competition and has_culture:
        parts = []
        if einstein_wins:
            parts.append(f"{einstein_wins}x Einstein champion")
        if event_wins:
            parts.append(f"{event_wins}x event winner")
        if is_hof:
            parts.append("Hall of Fame")
        elif impact_count:
            parts.append(f"{impact_count}x Impact")
        elif ei:
            parts.append(f"{len(ei)}x EI")
        hints.append(f"Dual identity: {' + '.join(parts)} — excels on the field AND in culture")
    elif has_competition and not has_culture:
        parts = []
        if einstein_wins:
            parts.append(f"{einstein_wins}x Einstein champion")
        if event_wins:
            parts.append(f"{event_wins}x event winner")
        hints.append(f"Competition-focused: {' + '.join(parts)}, no major culture awards")
    elif has_culture and not has_competition:
        parts = []
        if is_hof:
            parts.append("Hall of Fame")
        elif impact_count:
            parts.append(f"{impact_count}x Impact")
        if ei:
            parts.append(f"{len(ei)}x EI")
        if banner_count == 0:
            hints.append(f"Culture-focused: {' + '.join(parts)}, 0 event wins in {team_age} seasons")
        else:
            hints.append(f"Culture-focused: {' + '.join(parts)}")

    # Season trajectory: rank progression across events
    all_results = list(d.get("season_results", []))
    this_rank = d.get("this_event_rank")
    if this_rank and this_rank != "?":
        all_results_with_current = all_results + [{"rank": this_rank, "event": "this event"}]
    else:
        all_results_with_current = all_results
    if len(all_results_with_current) >= 2:
        ranks = [int(r["rank"]) for r in all_results_with_current if str(r.get("rank", "?")).isdigit()]
        if len(ranks) >= 2:
            if ranks[-1] < ranks[0]:
                hints.append(f"Rank trend: {ranks[0]}→{ranks[-1]} (improving)")
            elif ranks[-1] > ranks[0]:
                hints.append(f"Rank trend: {ranks[0]}→{ranks[-1]} (declining)")

    # Playoff progression across events
    playoff_levels = {"Eliminated in qf": 1, "Eliminated in sf": 2, "Semifinalist": 2,
                      "Finalist": 3, "Event Winner": 4}
    po_results = [(sr, playoff_levels.get(sr.get("playoff", ""), 0))
                  for sr in all_results if sr.get("playoff")]
    if len(po_results) >= 2:
        levels = [lv for _, lv in po_results]
        if levels[-1] > levels[0]:
            first_po = po_results[0][0]["playoff"]
            last_po = po_results[-1][0]["playoff"]
            hints.append(f"Playoff arc: {first_po}→{last_po}")

    # Banner drought
    has_awards = bool(d.get("season_awards_other_events") or d.get("this_event_awards")
                      or ei or impact_count)
    if banner_count == 0 and has_awards and team_age >= 3:
        hints.append(f"0 blue banners in {team_age} seasons despite winning awards")
    elif banner_count > 0 and banner_years:
        drought = cur_year - max(banner_years)
        if drought >= 4:
            hints.append(f"Last blue banner: {max(banner_years)} ({drought} seasons ago)")

    # Award progression milestones — only surface when contextually interesting
    # Skip EI→Impact progression noise for teams with Einstein/HoF (those are bigger stories)
    is_elite = is_hof or einstein_wins > 0
    if ras and first_ras:
        hints.append(f"Rookie All-Star / Rising All-Star: {first_ras}")
    if ei_to_impact is not None and not is_elite:
        hints.append(f"EI→Impact: {ei_to_impact} seasons (EI {first_ei}, Impact {first_impact})")
    elif ei and impact_count == 0 and seasons_chasing:
        hints.append(f"EI winner ({', '.join(str(y) for y in ei)}), no Impact yet — {seasons_chasing} seasons")
    if rookie_to_impact is not None and not is_elite:
        hints.append(f"Rookie→Impact: {rookie_to_impact} seasons (rookie {d.get('rookie_year')}, Impact {first_impact})")
    if ras_to_impact is not None and not is_elite:
        hints.append(f"RAS→Impact: {ras_to_impact} seasons")

    # Rookie/young team
    if team_age and team_age <= 2 and banner_count > 0:
        hints.append(f"{banner_count} blue banner(s) in {team_age} season(s)")
    if team_age and team_age <= 2 and this_rank and str(this_rank).isdigit() and int(this_rank) <= 8:
        hints.append(f"Rookie/2nd-year, ranked #{this_rank} at this event")

    # Travel data points — only push as hints when genuinely notable;
    # routine travel info is already in the dossier body for the LLM to use contextually.
    if is_intl and first_time:
        hints.append(f"First time in {event_country} (from {team_country})")

    if hints:
        lines.append("  NARRATIVE HINTS (data points — synthesize into natural story, do not read verbatim):")
        for h in hints:
            lines.append(f"    • {h}")

    return "\n".join(lines)


async def _assemble_match_dossier(event_key: str, match_key: str) -> str:
    """Build a complete text dossier for a match."""
    from .tba_client import get_tba_client

    tba = get_tba_client()
    match_data = await tba.get_match(match_key)
    if not match_data:
        return ""

    year = int(event_key[:4])
    red_keys = match_data.get("alliances", {}).get("red", {}).get("team_keys", [])
    blue_keys = match_data.get("alliances", {}).get("blue", {}).get("team_keys", [])
    all_keys = red_keys + blue_keys

    # Build all dossiers in parallel
    dossiers = await asyncio.gather(
        *[_build_team_dossier(tk, event_key, year) for tk in all_keys]
    )

    # Match context
    comp_level = match_data.get("comp_level", "qm")
    match_num = match_data.get("match_number", "?")
    set_num = match_data.get("set_number", 1)

    level_names = {"qm": "Qualification", "sf": "Semifinal", "f": "Final", "ef": "Eighth-Final", "qf": "Quarterfinal"}
    level_label = level_names.get(comp_level, comp_level.upper())
    if comp_level == "qm":
        match_label = f"{level_label} Match {match_num}"
    else:
        match_label = f"{level_label} {set_num} Match {match_num}"

    parts = [f"Match: {match_label}", ""]

    parts.append("RED ALLIANCE:")
    for i, tk in enumerate(red_keys):
        if i < len(dossiers):
            parts.append(_format_team_dossier(dossiers[i]))
            parts.append("")

    parts.append("BLUE ALLIANCE:")
    for i, tk in enumerate(blue_keys):
        idx = len(red_keys) + i
        if idx < len(dossiers):
            parts.append(_format_team_dossier(dossiers[idx]))
            parts.append("")

    return "\n".join(parts)


async def _assemble_team_dossier(event_key: str, team_number: int) -> str:
    """Build a complete text dossier for a single team deep dive."""
    year = int(event_key[:4])
    team_key = f"frc{team_number}"
    dossier = await _build_team_dossier(team_key, event_key, year)
    return _format_team_dossier(dossier)


# ── Main entry point ────────────────────────────────────────
async def generate_storyline(
    mode: str,
    event_key: str,
    match_key: Optional[str] = None,
    team_number: Optional[int] = None,
) -> dict:
    """Generate an AI storyline. Returns {"storyline": str, "cached": bool}."""
    from .inflight import coalesce

    if not is_available():
        raise RuntimeError("Anthropic API key not configured")

    # Cache key
    if mode == "match" and match_key:
        cache_key = f"match:{match_key}"
    elif mode == "team" and team_number:
        cache_key = f"team:{event_key}:{team_number}"
    else:
        raise ValueError("Invalid mode or missing parameters")

    # Coalesce concurrent identical requests
    return await coalesce(
        f"storyline:{cache_key}",
        _generate_storyline_inner,
        cache_key, mode, event_key, match_key, team_number,
    )


async def _get_event_match_count(event_key: str) -> int | None:
    """Get current match count for event-aware invalidation."""
    try:
        from .tba_client import get_tba_client
        tba = get_tba_client()
        matches = await _safe(tba.get_event_matches(event_key), [])
        if matches:
            return sum(1 for m in matches if m.get("actual_time") is not None)
    except Exception:
        pass
    return None


async def _load_from_supabase(cache_key: str) -> tuple[str, int | None] | None:
    """Try to load a cached storyline from Supabase."""
    try:
        from .supabase_client import get_supabase
        sb = await get_supabase()
        resp = await sb.table("storyline_cache").select(
            "storyline, match_count, created_at"
        ).eq("cache_key", cache_key).execute()
        if resp.data:
            row = resp.data[0]
            return (row["storyline"], row.get("match_count"))
    except Exception as e:
        log.debug("Supabase storyline load failed for %s: %s", cache_key, e)
    return None


async def _save_to_supabase(cache_key: str, event_key: str, storyline: str,
                            match_count: int | None) -> None:
    """Persist a storyline to Supabase (fire-and-forget)."""
    try:
        from .supabase_client import get_supabase
        sb = await get_supabase()
        await sb.table("storyline_cache").upsert({
            "cache_key": cache_key,
            "event_key": event_key,
            "storyline": storyline,
            "match_count": match_count,
        }, on_conflict="cache_key").execute()
    except Exception as e:
        log.debug("Supabase storyline save failed for %s: %s", cache_key, e)


async def _generate_storyline_inner(
    cache_key: str,
    mode: str,
    event_key: str,
    match_key: Optional[str],
    team_number: Optional[int],
) -> dict:
    """Core generation logic — called via inflight coalescing."""
    now = time.time()

    # ── Layer 1: In-memory cache with event-aware invalidation ──
    if cache_key in _cache:
        ts, text, cached_match_count = _cache[cache_key]
        age = now - ts
        if age < _CACHE_TTL:
            # For team storylines, check if match count changed (new results)
            if mode == "team" and age > 300:  # re-check after 5 min
                current_count = await _get_event_match_count(event_key)
                if current_count is not None and cached_match_count is not None:
                    if current_count != cached_match_count:
                        log.info("Storyline cache invalidated for %s: match count %s→%s",
                                 cache_key, cached_match_count, current_count)
                    else:
                        return {"storyline": text, "cached": True}
                else:
                    return {"storyline": text, "cached": True}
            else:
                return {"storyline": text, "cached": True}

    # ── Layer 2: Supabase persistent cache ──
    sb_hit = await _load_from_supabase(cache_key)
    if sb_hit:
        sb_text, sb_match_count = sb_hit
        # Check if event state changed
        current_count = await _get_event_match_count(event_key)
        if sb_match_count is not None and current_count == sb_match_count:
            # Still valid — promote to memory cache
            _cache[cache_key] = (now, sb_text, sb_match_count)
            return {"storyline": sb_text, "cached": True}
        # Otherwise, stale — regenerate

    # ── Layer 3: Generate fresh ──
    match_count = await _get_event_match_count(event_key)

    if mode == "match":
        dossier = await _assemble_match_dossier(event_key, match_key)
        system_prompt = _MATCH_SYSTEM_PROMPT
    else:
        dossier = await _assemble_team_dossier(event_key, team_number)
        system_prompt = _TEAM_SYSTEM_PROMPT

    if not dossier:
        return {"storyline": "No data available for this storyline.", "cached": False}

    # Call LLM
    client = _get_client()
    user_msg = (
        f"Generate a storyline based on this dossier:\n\n{dossier}\n\n"
        "IMPORTANT REMINDER: Do not use the words 'powerhouse', 'proving', "
        "'showcasing', 'demonstrating', or 'statement'. "
        "Write like a newspaper beat reporter — factual and vivid."
    )
    try:
        response = await client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=500,
            system=system_prompt,
            messages=[{"role": "user", "content": user_msg}],
        )
        storyline = response.content[0].text.strip()

        # ── Cost/usage logging ──
        usage = getattr(response, "usage", None)
        if usage:
            in_tok = getattr(usage, "input_tokens", 0)
            out_tok = getattr(usage, "output_tokens", 0)
            log.info("Storyline LLM usage [%s]: %d input + %d output tokens "
                     "(mode=%s, event=%s)", cache_key, in_tok, out_tok,
                     mode, event_key)
    except Exception as e:
        log.error("Anthropic API error: %s", e)
        raise RuntimeError(f"AI service error: {e}")

    # ── Populate caches ──
    _cache[cache_key] = (now, storyline, match_count)
    # Fire-and-forget Supabase persist
    asyncio.create_task(_save_to_supabase(cache_key, event_key, storyline, match_count))

    return {"storyline": storyline, "cached": False}
