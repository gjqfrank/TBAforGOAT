"""FTC Scout GraphQL API client — OPR, QuickStats, world records, match scores."""
from __future__ import annotations

import logging
import time
from typing import Any

import httpx

from .circuit_breaker import get_breaker, CircuitOpenError

log = logging.getLogger(__name__)

FTCSCOUT_URL = "https://api.ftcscout.org/graphql"
CACHE_TTL = 300        # 5 min for team-level stats
EVENT_CACHE_TTL = 120  # 2 min for event queries
WR_CACHE_TTL = 600     # 10 min for world record
_MAX_CACHE_ENTRIES = 500  # cap to prevent unbounded growth

ftcscout_breaker = get_breaker("FTC Scout", failure_threshold=5, recovery_timeout=60)


class FTCScoutClient:
    """Async GraphQL client for api.ftcscout.org."""

    def __init__(self) -> None:
        self._http: httpx.AsyncClient | None = None
        self._cache: dict[str, tuple[float, Any]] = {}

    def _get_http(self) -> httpx.AsyncClient:
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(timeout=httpx.Timeout(15.0))
        return self._http

    def _get_cached(self, key: str, ttl: float) -> Any | None:
        entry = self._cache.get(key)
        if entry and (time.monotonic() - entry[0]) < ttl:
            return entry[1]
        return None

    def _set_cache(self, key: str, value: Any) -> None:
        self._cache[key] = (time.monotonic(), value)

    def _evict_cache(self) -> None:
        """Remove expired entries; if still over cap, drop oldest."""
        now = time.monotonic()
        expired = [k for k, (ts, _) in self._cache.items() if now - ts >= max(CACHE_TTL, WR_CACHE_TTL)]
        for k in expired:
            del self._cache[k]
        if len(self._cache) > _MAX_CACHE_ENTRIES:
            by_age = sorted(self._cache, key=lambda k: self._cache[k][0])
            for k in by_age[: len(self._cache) - _MAX_CACHE_ENTRIES]:
                del self._cache[k]

    async def _query(self, query: str, variables: dict | None = None) -> dict:
        """Execute a GraphQL query through the circuit breaker."""
        self._evict_cache()
        http = self._get_http()
        payload: dict[str, Any] = {"query": query}
        if variables:
            payload["variables"] = variables

        async def _do_request():
            resp = await http.post(
                FTCSCOUT_URL,
                json=payload,
                headers={"content-type": "application/json"},
            )
            resp.raise_for_status()
            return resp.json()

        body = await ftcscout_breaker.call(_do_request)
        if "errors" in body and body["errors"]:
            log.warning("FTC Scout GraphQL errors: %s", body["errors"])
        return body.get("data", {})

    # ── Event team stats (OPR, averages) ────────────────────

    async def get_event_team_stats(self, season: int, event_code: str) -> list[dict]:
        """Fetch team event participation with OPR/avg stats for 2025 DECODE season.

        Returns a list of dicts: {teamNumber, rank, rp, wins, losses, ties,
        qualMatchesPlayed, opr_total, opr_auto, opr_dc, avg_total, avg_auto, avg_dc,
        quickStats: {tot, auto, dc, count}}.
        """
        cache_key = f"event_stats:{season}:{event_code}"
        cached = self._get_cached(cache_key, EVENT_CACHE_TTL)
        if cached is not None:
            return cached

        # Build inline fragments for each season's stats type
        _stat_frag = """
                  rank rp tb1 wins losses ties qualMatchesPlayed
                  opr { autoPoints dcPoints totalPoints totalPointsNp }
                  avg { autoPoints dcPoints totalPoints totalPointsNp }
                  max { autoPoints dcPoints totalPoints }
                  min { autoPoints dcPoints totalPoints }
                  dev { autoPoints dcPoints totalPoints }
        """
        query = f"""
        query ($season: Int!, $code: String!) {{
          eventByCode(season: $season, code: $code) {{
            teams {{
              teamNumber
              stats {{
                ... on TeamEventStats2025 {{{_stat_frag}}}
                ... on TeamEventStats2024 {{{_stat_frag}}}
              }}
              team {{
                number name
                quickStats(season: $season) {{
                  tot {{ value rank }}
                  auto {{ value rank }}
                  dc {{ value rank }}
                  count
                }}
              }}
            }}
          }}
        }}
        """
        data = await self._query(query, {"season": season, "code": event_code})
        event = data.get("eventByCode")
        if not event or not event.get("teams"):
            self._set_cache(cache_key, [])
            return []

        results: list[dict] = []
        for tep in event["teams"]:
            stats = tep.get("stats") or {}
            team = tep.get("team") or {}
            qs = team.get("quickStats") or {}

            row: dict[str, Any] = {
                "team_number": tep.get("teamNumber"),
                "rank": stats.get("rank"),
                "rp": stats.get("rp"),
                "tb1": stats.get("tb1"),
                "wins": stats.get("wins", 0),
                "losses": stats.get("losses", 0),
                "ties": stats.get("ties", 0),
                "qual_matches_played": stats.get("qualMatchesPlayed", 0),
            }

            # OPR data
            opr = stats.get("opr") or {}
            row["opr_total"] = opr.get("totalPoints")
            row["opr_auto"] = opr.get("autoPoints")
            row["opr_dc"] = opr.get("dcPoints")
            row["opr_np"] = opr.get("totalPointsNp")

            # Averages
            avg = stats.get("avg") or {}
            row["avg_total"] = avg.get("totalPoints")
            row["avg_auto"] = avg.get("autoPoints")
            row["avg_dc"] = avg.get("dcPoints")
            row["avg_np"] = avg.get("totalPointsNp")

            # Max scores
            mx = stats.get("max") or {}
            row["max_total"] = mx.get("totalPoints")
            row["max_auto"] = mx.get("autoPoints")
            row["max_dc"] = mx.get("dcPoints")

            # Min scores
            mn = stats.get("min") or {}
            row["min_total"] = mn.get("totalPoints")

            # Std deviation
            dv = stats.get("dev") or {}
            row["dev_total"] = dv.get("totalPoints")

            # QuickStats (global ranking across all FTC teams)
            row["quick_stats"] = {
                "tot": qs.get("tot"),
                "auto": qs.get("auto"),
                "dc": qs.get("dc"),
                "count": qs.get("count"),
            }

            results.append(row)

        self._set_cache(cache_key, results)
        return results

    # ── World record ────────────────────────────────────────

    async def get_world_record(self, season: int) -> dict | None:
        """Fetch the traditional (alliance) world record match for a season."""
        cache_key = f"wr:{season}"
        cached = self._get_cached(cache_key, WR_CACHE_TTL)
        if cached is not None:
            return cached

        query = """
        query ($season: Int!) {
          tradWorldRecord(season: $season) {
            season eventCode id hasBeenPlayed
            tournamentLevel series matchNum
            scores {
              ... on MatchScores2025 {
                red { autoPoints dcPoints totalPoints minorsCommitted majorsCommitted }
                blue { autoPoints dcPoints totalPoints minorsCommitted majorsCommitted }
              }
              ... on MatchScores2024 {
                red { autoPoints dcPoints totalPoints minorsCommitted majorsCommitted }
                blue { autoPoints dcPoints totalPoints minorsCommitted majorsCommitted }
              }
            }
            teams {
              station teamNumber
              team { number name }
            }
          }
        }
        """
        data = await self._query(query, {"season": season})
        wr = data.get("tradWorldRecord")
        if not wr:
            self._set_cache(cache_key, None)
            return None

        scores = wr.get("scores") or {}
        red = scores.get("red") or {}
        blue = scores.get("blue") or {}
        red_total = red.get("totalPoints", 0)
        blue_total = blue.get("totalPoints", 0)
        winning_score = max(red_total, blue_total)
        winning_alliance = "red" if red_total >= blue_total else "blue"

        teams = wr.get("teams", [])
        # Group by station: station starts with "One"/"Two" for each alliance
        # FTC Scout uses numbered stations, not Red1/Blue1
        # Teams list has 4 entries for traditional matches
        red_teams = []
        blue_teams = []
        for i, t in enumerate(teams):
            team_info = {"number": t.get("teamNumber"), "name": (t.get("team") or {}).get("name", "")}
            # First half = red (or alliance), second half = blue
            if i < len(teams) // 2:
                red_teams.append(team_info)
            else:
                blue_teams.append(team_info)

        # Build flat team name list for frontend compatibility
        all_team_names = [t["name"] for t in red_teams + blue_teams if t.get("name")]

        event_code = wr.get("eventCode", "")
        level_str = wr.get("tournamentLevel", "")
        match_num = wr.get("matchNum", 0)
        match_label = f"{level_str} {match_num}" if level_str else f"Match {match_num}"

        result = {
            "season": wr.get("season"),
            "event_code": event_code,
            "event_key": f"{season}ftc{event_code}".lower(),
            "event_name": event_code,  # FTC Scout doesn't include event name in wr query
            "match": match_label,
            "match_id": wr.get("id"),
            "level": level_str,
            "match_number": match_num,
            "score": winning_score,
            "winning_alliance": winning_alliance,
            "red_score": red_total,
            "blue_score": blue_total,
            "red_auto": red.get("autoPoints", 0),
            "blue_auto": blue.get("autoPoints", 0),
            "red_dc": red.get("dcPoints", 0),
            "blue_dc": blue.get("dcPoints", 0),
            "teams": all_team_names,
            "red_teams": red_teams,
            "blue_teams": blue_teams,
        }
        self._set_cache(cache_key, result)
        return result

    # ── Team quick stats (global OPR-like ranking) ──────────

    async def get_team_quick_stats(self, team_number: int, season: int) -> dict | None:
        """Fetch a single team's QuickStats for a season."""
        cache_key = f"qstats:{season}:{team_number}"
        cached = self._get_cached(cache_key, CACHE_TTL)
        if cached is not None:
            return cached

        query = """
        query ($num: Int!) {
          teamByNumber(number: $num) {
            number name schoolName
            location { city state country }
            rookieYear
            quickStats(season: %d) {
              tot { value rank }
              auto { value rank }
              dc { value rank }
              count
            }
          }
        }
        """ % season
        data = await self._query(query, {"num": team_number})
        team = data.get("teamByNumber")
        if not team:
            self._set_cache(cache_key, None)
            return None

        qs = team.get("quickStats") or {}
        result = {
            "team_number": team.get("number"),
            "name": team.get("name", ""),
            "school_name": team.get("schoolName", ""),
            "location": team.get("location"),
            "rookie_year": team.get("rookieYear"),
            "quick_stats": {
                "tot": qs.get("tot"),
                "auto": qs.get("auto"),
                "dc": qs.get("dc"),
                "count": qs.get("count"),
            },
        }
        self._set_cache(cache_key, result)
        return result

    async def get_team_opr_history(self, team_number: int, current_season: int) -> list[dict]:
        """Fetch OPR across multiple seasons for a team."""
        cache_key = f"opr_history:{team_number}:{current_season}"
        cached = self._get_cached(cache_key, CACHE_TTL)
        if cached is not None:
            return cached

        # Query quickStats across all seasons back to 2019
        results = []
        tasks = []
        seasons = list(range(2019, current_season + 1))
        for s in seasons:
            tasks.append(self.get_team_quick_stats(team_number, s))

        import asyncio
        stats_list = await asyncio.gather(*tasks, return_exceptions=True)
        for s, stats in zip(seasons, stats_list):
            if isinstance(stats, Exception) or not stats:
                continue
            qs = (stats or {}).get("quick_stats", {})
            tot = qs.get("tot") or {}
            if tot.get("value") is not None:
                results.append({
                    "season": s,
                    "opr_total": round(tot["value"], 2),
                    "opr_auto": round((qs.get("auto") or {}).get("value", 0), 2),
                    "opr_dc": round((qs.get("dc") or {}).get("value", 0), 2),
                    "rank": tot.get("rank"),
                    "count": qs.get("count"),
                })
        self._set_cache(cache_key, results)
        return results

    # ── Event match scores (detailed breakdown) ─────────────

    async def get_event_matches(self, season: int, event_code: str) -> list[dict]:
        """Fetch all matches for an event with scores from FTC Scout."""
        cache_key = f"matches:{season}:{event_code}"
        cached = self._get_cached(cache_key, EVENT_CACHE_TTL)
        if cached is not None:
            return cached

        query = """
        query ($season: Int!, $code: String!) {
          eventByCode(season: $season, code: $code) {
            hasMatches
            teamMatches {
              match {
                id hasBeenPlayed
                tournamentLevel series matchNum
                scheduledStartTime actualStartTime
                scores {
                  ... on MatchScores2025 {
                    red {
                      autoPoints dcPoints totalPoints
                      autoLeavePoints autoArtifactPoints autoPatternPoints
                      dcBasePoints dcArtifactPoints dcDepotPoints dcPatternPoints
                      minorsCommitted majorsCommitted minorsByOpp majorsByOpp
                      movementRp goalRp patternRp
                    }
                    blue {
                      autoPoints dcPoints totalPoints
                      autoLeavePoints autoArtifactPoints autoPatternPoints
                      dcBasePoints dcArtifactPoints dcDepotPoints dcPatternPoints
                      minorsCommitted majorsCommitted minorsByOpp majorsByOpp
                      movementRp goalRp patternRp
                    }
                  }
                }
                teams {
                  station teamNumber
                  team { number name }
                }
              }
            }
          }
        }
        """
        data = await self._query(query, {"season": season, "code": event_code})
        event = data.get("eventByCode")
        if not event:
            self._set_cache(cache_key, [])
            return []

        # Deduplicate matches (teamMatches has one entry per team per match)
        seen: set[int] = set()
        results: list[dict] = []
        for tm in event.get("teamMatches") or []:
            match = tm.get("match")
            if not match:
                continue
            mid = match.get("id")
            if mid in seen:
                continue
            seen.add(mid)
            results.append(match)

        self._set_cache(cache_key, results)
        return results

    async def close(self) -> None:
        if self._http and not self._http.is_closed:
            await self._http.aclose()


# Singleton
_client: FTCScoutClient | None = None


def get_ftcscout_client() -> FTCScoutClient:
    global _client
    if _client is None:
        _client = FTCScoutClient()
    return _client
