"""Statbotics API async client — EPA (Expected Points Added) data.

Uses the public Statbotics REST API v3 (https://api.statbotics.io/docs).
No API key required.  Be nice to their servers — cache aggressively.
"""
from __future__ import annotations

import time
from typing import Any, Optional

import httpx

from .circuit_breaker import statbotics_breaker

STATBOTICS_BASE = "https://api.statbotics.io/v3"
CACHE_TTL = 300  # 5 minutes — same cadence as TBA cache


def _is_service_failure(exc: Exception) -> bool:
    """Only count 5xx responses and network errors — not 404/4xx — as breaker failures.

    Statbotics returns 404 for events it hasn't indexed yet; those are
    expected "no data" responses, not signs the service is down.
    """
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code >= 500
    return True


class StatboticsClient:
    """Thin async wrapper around Statbotics REST API with TTL cache."""

    def __init__(self) -> None:
        self._cache: dict[str, tuple[float, Any]] = {}
        self._http: Optional[httpx.AsyncClient] = None

    def _client(self) -> httpx.AsyncClient:
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(
                base_url=STATBOTICS_BASE,
                timeout=15.0,
            )
        return self._http

    async def get(self, endpoint: str, *, bypass_cache: bool = False) -> Any:
        now = time.time()
        if not bypass_cache and endpoint in self._cache:
            ts, data = self._cache[endpoint]
            if now - ts < CACHE_TTL:
                return data

        async def _do_request():
            resp = await self._client().get(endpoint)
            resp.raise_for_status()
            return resp.json()

        data = await statbotics_breaker.call(_do_request, is_failure=_is_service_failure)
        self._cache[endpoint] = (now, data)
        return data

    def clear_cache(self) -> None:
        self._cache.clear()

    # ── Convenience methods ─────────────────────────────────

    async def get_team_events_for_event(self, event_key: str) -> list[dict]:
        """Fetch EPA data for every team at an event.

        Returns a list of TeamEvent objects from Statbotics.
        """
        return await self.get(f"/team_events?event={event_key}")

    async def get_team_year(self, team_number: int, year: int) -> dict | None:
        """Fetch season-level EPA for a single team."""
        try:
            return await self.get(f"/team_year/{team_number}/{year}")
        except (httpx.HTTPStatusError, httpx.RequestError):
            return None

    async def get_event_matches(self, event_key: str) -> list[dict]:
        """Fetch all Statbotics match records for an event (includes predictions)."""
        try:
            return await self.get(f"/matches?event={event_key}&limit=500")
        except (httpx.HTTPStatusError, httpx.RequestError):
            return []

    async def get_season_high_scores(self, year: int, limit: int = 5) -> dict:
        """Return top match scores and top EPA teams for a season.

        Fetches red-sorted and blue-sorted matches from Statbotics,
        merges, dedupes, and returns the top *limit* along with top EPA teams.
        """
        import asyncio

        async def _fetch_season_data() -> tuple:
            """Fetch all three endpoints as a single circuit-breaker unit.

            The three parallel requests count as ONE logical operation so that
            a brief Statbotics outage doesn't increment the failure counter 3×.
            If all three fail (e.g. circuit was already open or service is
            completely down) we re-raise so the caller sees a real error and
            can fall back to stale cache rather than writing empty data.
            """
            async def _raw(endpoint: str) -> Any:
                resp = await self._client().get(endpoint)
                resp.raise_for_status()
                return resp.json()

            results = await asyncio.gather(
                _raw(f"/matches?year={year}&metric=red_score&ascending=false&limit={limit * 2}"),
                _raw(f"/matches?year={year}&metric=blue_score&ascending=false&limit={limit * 2}"),
                _raw(f"/team_years?year={year}&metric=epa&ascending=false&limit=50"),
                return_exceptions=True,
            )
            # If every sub-request failed, propagate so the circuit counts one
            # failure and the router falls back to stale data instead of caching
            # an empty payload.
            if all(isinstance(r, BaseException) for r in results):
                raise results[0]
            return results  # type: ignore[return-value]

        red_matches, blue_matches, epa_teams = await statbotics_breaker.call(
            _fetch_season_data, is_failure=_is_service_failure
        )

        # --- Merge match scores (pick best alliance per match) ---------------
        if isinstance(red_matches, BaseException):
            red_matches = []
        if isinstance(blue_matches, BaseException):
            blue_matches = []

        seen: dict[str, dict] = {}  # match_key -> best row
        for m in red_matches:
            key = m.get("key", "")
            result = m.get("result") or {}
            score = result.get("red_score") or 0
            # red_no_foul can be null in the API — fall back to raw score
            no_foul = result.get("red_no_foul")
            if no_foul is None:
                no_foul = score
            teams = [str(k).replace("frc", "") for k in (m.get("alliances", {}).get("red", {}).get("team_keys") or [])]
            event_key = m.get("event", "")
            row = {"key": key, "event_key": event_key, "score": score, "no_foul": no_foul, "teams": teams, "color": "red"}
            if key not in seen or no_foul > seen[key]["no_foul"]:
                seen[key] = row

        for m in blue_matches:
            key = m.get("key", "")
            result = m.get("result") or {}
            score = result.get("blue_score") or 0
            # blue_no_foul can be null in the API — fall back to raw score
            no_foul = result.get("blue_no_foul")
            if no_foul is None:
                no_foul = score
            teams = [str(k).replace("frc", "") for k in (m.get("alliances", {}).get("blue", {}).get("team_keys") or [])]
            event_key = m.get("event", "")
            row = {"key": key, "event_key": event_key, "score": score, "no_foul": no_foul, "teams": teams, "color": "blue"}
            if key not in seen or no_foul > seen[key]["no_foul"]:
                seen[key] = row

        top_matches = sorted(seen.values(), key=lambda r: r["no_foul"], reverse=True)[:limit]

        # --- EPA teams + name map ---------------------------------------------
        if isinstance(epa_teams, BaseException):
            epa_teams = []

        team_names: dict[str, str] = {}
        top_epa = []
        for idx, te in enumerate(epa_teams):
            team_num = te.get("team")
            name = te.get("name", "")
            if team_num:
                team_names[str(team_num)] = name
            if idx < limit:
                epa_block = te.get("epa") or {}
                total = epa_block.get("total_points", {})
                epa_val = round(total.get("mean", 0), 1)
                top_epa.append({"team": team_num, "name": name, "epa": epa_val})

        # Fill in missing names for match teams not in top-50 EPA (~2-5 calls, cached)
        missing = set()
        for m in top_matches:
            for t in m.get("teams", []):
                if t not in team_names:
                    missing.add(t)
        if missing:
            lookups = await asyncio.gather(
                *(self.get_team_year(int(t), year) for t in missing),
                return_exceptions=True,
            )
            for t_num, result in zip(missing, lookups):
                if isinstance(result, Exception) or result is None:
                    continue
                team_names[t_num] = result.get("name", "")

        return {"matches": top_matches, "epa_teams": top_epa, "team_names": team_names}

    async def get_most_wins(self, year: int, limit: int = 10) -> list[dict]:
        """Return top teams by win count for a season.

        Uses ``/team_years?metric=wins&ascending=false``.
        """
        raw = await self.get(
            f"/team_years?year={year}&metric=wins&ascending=false&limit={limit}"
        )
        results = []
        for te in raw if isinstance(raw, list) else []:
            record = te.get("record") or {}
            epa_block = te.get("epa") or {}
            total = epa_block.get("total_points", {})
            results.append({
                "team": te.get("team"),
                "name": te.get("name", ""),
                "country": te.get("country", ""),
                "state": te.get("state", ""),
                "wins": record.get("wins", 0),
                "losses": record.get("losses", 0),
                "ties": record.get("ties", 0),
                "count": record.get("count", 0),
                "winrate": round(record.get("winrate", 0), 4),
                "epa": round(total.get("mean", 0), 1),
            })
        return results


# ── Singleton ───────────────────────────────────────────────
_instance: Optional[StatboticsClient] = None


def get_statbotics_client() -> StatboticsClient:
    global _instance
    if _instance is None:
        _instance = StatboticsClient()
    return _instance


# ── Helper: build an EPA lookup map for an event ────────────
async def get_epa_map(event_key: str) -> dict[str, dict]:
    """Return ``{team_key: {epa, epa_auto, epa_teleop, epa_endgame}}`` for an event.

    team_key is in TBA ``frcNNNN`` format.
    Falls back to empty dicts gracefully.
    """
    sb = get_statbotics_client()
    try:
        team_events = await sb.get_team_events_for_event(event_key)
    except Exception:
        return {}

    epa_map: dict[str, dict] = {}
    for te in team_events:
        team_num = te.get("team")
        epa_block = te.get("epa") or {}
        total = epa_block.get("total_points", {})
        breakdown = epa_block.get("breakdown") or {}

        epa_map[f"frc{team_num}"] = {
            "epa": round(total.get("mean", 0), 2),
            "epa_auto": round(breakdown.get("auto_points", 0), 2),
            "epa_teleop": round(breakdown.get("teleop_points", 0), 2),
            "epa_endgame": round(breakdown.get("endgame_points", 0), 2),
        }

    return epa_map


# ── Helper: build a match prediction map for an event ───────
async def get_match_predictions(event_key: str) -> dict[str, dict]:
    """Return ``{match_key: {winner, red_win_prob, red_score, blue_score}}``
    for every match at an event.

    match_key is in TBA format (e.g. ``2024cabe_qm1``).
    Falls back to an empty dict on error.
    """
    sb = get_statbotics_client()
    try:
        matches = await sb.get_event_matches(event_key)
    except Exception:
        return {}

    pred_map: dict[str, dict] = {}
    for m in matches:
        key = m.get("key", "")
        pred = m.get("pred") or {}
        if not pred:
            continue

        red_win = pred.get("red_win_prob")
        pred_map[key] = {
            "winner": pred.get("winner", ""),
            "red_win_prob": round(red_win, 3) if red_win is not None else None,
            "red_score": round(pred.get("red_score", 0), 1),
            "blue_score": round(pred.get("blue_score", 0), 1),
        }

    return pred_map
