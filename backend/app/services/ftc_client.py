"""FIRST FTC Events API v2.0 async client with in-memory caching.

Docs: https://ftc-events.firstinspires.org/api-docs/index.html
Auth: Basic <base64(username:authkey)>
"""
from __future__ import annotations

import asyncio
import time
from typing import Any, Optional

import httpx

from ..config import FTC_EVENTS_API_TOKEN
from .circuit_breaker import ftc_breaker

FTC_BASE = "https://ftc-api.firstinspires.org/v2.0"
CACHE_TTL = 120  # seconds


class FTCClient:
    """Thin async wrapper around the official FIRST FTC Events REST API."""

    def __init__(self) -> None:
        self.headers = {
            "Authorization": f"Basic {FTC_EVENTS_API_TOKEN}",
            "Accept": "application/json",
        }
        self._cache: dict[str, tuple[float, Any]] = {}
        self._http: Optional[httpx.AsyncClient] = None

    def _client(self) -> httpx.AsyncClient:
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(
                base_url=FTC_BASE,
                headers=self.headers,
                timeout=30.0,
            )
        return self._http

    async def get(
        self,
        endpoint: str,
        *,
        bypass_cache: bool = False,
        ttl_override: float | None = None,
        bypass_breaker: bool = False,
    ) -> Any:
        now = time.time()
        ttl = ttl_override if ttl_override is not None else CACHE_TTL
        if not bypass_cache and endpoint in self._cache:
            ts, data = self._cache[endpoint]
            if now - ts < ttl:
                return data

        async def _do_request():
            resp = await self._client().get(endpoint)
            resp.raise_for_status()
            return resp.json()

        if bypass_breaker:
            data = await _do_request()
        else:
            data = await ftc_breaker.call(_do_request)
        self._cache[endpoint] = (now, data)
        return data

    def clear_cache(self) -> None:
        self._cache.clear()

    def clear_cache_for(self, *endpoints: str) -> None:
        for ep in endpoints:
            self._cache.pop(ep, None)

    # ── Season Summary ──────────────────────────────────
    async def get_season_summary(self, season: int) -> dict:
        """High-level season info: gameName, teamCount, eventCount, etc."""
        return await self.get(f"/{season}")

    # ── Events ──────────────────────────────────────────
    async def get_events(self, season: int) -> list[dict]:
        data = await self.get(f"/{season}/events")
        return data.get("events", [])

    async def get_team_events(self, season: int, team_number: int) -> list[dict]:
        """Return all events a team is attending/attended in a season."""
        data = await self.get(f"/{season}/events?teamNumber={team_number}")
        return data.get("events", [])

    async def get_event(self, season: int, event_code: str) -> dict | None:
        """Single event details by code."""
        data = await self.get(f"/{season}/events?eventCode={event_code}")
        events = data.get("events", [])
        return events[0] if events else None

    # ── Teams ───────────────────────────────────────────
    async def get_teams(
        self,
        season: int,
        *,
        event_code: str | None = None,
        team_number: int | None = None,
        page: int = 1,
    ) -> dict:
        """Return teams data (paginated). Accepts optional event or team filter."""
        url = f"/{season}/teams"
        params: list[str] = []
        if event_code:
            params.append(f"eventCode={event_code}")
        if team_number:
            params.append(f"teamNumber={team_number}")
        params.append(f"page={page}")
        if params:
            url += "?" + "&".join(params)
        return await self.get(url)

    async def get_event_teams(self, season: int, event_code: str) -> list[dict]:
        """Return all teams at an event (handles pagination)."""
        all_teams: list[dict] = []
        page = 1
        while True:
            data = await self.get_teams(season, event_code=event_code, page=page)
            teams = data.get("teams", [])
            all_teams.extend(teams)
            if page >= data.get("pageTotal", 1):
                break
            page += 1
        return all_teams

    async def get_team_info(self, season: int, team_number: int) -> dict | None:
        """Single team details."""
        data = await self.get_teams(season, team_number=team_number)
        teams = data.get("teams", [])
        return teams[0] if teams else None

    # ── Rankings ────────────────────────────────────────
    RANKINGS_TTL = 15  # fast refresh during events

    async def get_rankings(self, season: int, event_code: str) -> list[dict]:
        data = await self.get(
            f"/{season}/rankings/{event_code}",
            ttl_override=self.RANKINGS_TTL,
        )
        return data.get("rankings", [])

    # ── Matches / Schedule ──────────────────────────────
    async def get_schedule_hybrid(
        self,
        season: int,
        event_code: str,
        level: str = "qual",
    ) -> list[dict]:
        """Hybrid schedule (results for played, schedule for upcoming)."""
        data = await self.get(
            f"/{season}/schedule/{event_code}/{level}/hybrid"
        )
        return data.get("schedule", [])

    async def get_matches(
        self,
        season: int,
        event_code: str,
        *,
        level: str | None = None,
        team_number: int | None = None,
    ) -> list[dict]:
        """Match results."""
        url = f"/{season}/matches/{event_code}"
        params: list[str] = []
        if level:
            params.append(f"tournamentLevel={level}")
        if team_number is not None:
            params.append(f"teamNumber={team_number}")
        if params:
            url += "?" + "&".join(params)
        data = await self.get(url)
        return data.get("matches", [])

    # ── Score Details ───────────────────────────────────
    async def get_scores(
        self,
        season: int,
        event_code: str,
        level: str = "qual",
        *,
        match_number: int | None = None,
    ) -> list[dict]:
        """Detailed score breakdown per match."""
        url = f"/{season}/scores/{event_code}/{level}"
        if match_number is not None:
            url += f"?matchNumber={match_number}"
        data = await self.get(url)
        return data.get("matchScores", [])

    # ── Alliances ───────────────────────────────────────
    async def get_alliances(self, season: int, event_code: str) -> list[dict]:
        data = await self.get(f"/{season}/alliances/{event_code}")
        return data.get("alliances", [])

    async def get_alliance_selection(self, season: int, event_code: str) -> list[dict]:
        data = await self.get(f"/{season}/alliances/{event_code}/selection")
        return data.get("selections", [])

    # ── Awards ──────────────────────────────────────────
    async def get_event_awards(self, season: int, event_code: str) -> list[dict]:
        data = await self.get(f"/{season}/awards/{event_code}")
        return data.get("awards", [])

    async def get_team_awards(
        self, season: int, team_number: int, event_code: str | None = None,
    ) -> list[dict]:
        url = f"/{season}/awards/{team_number}"
        if event_code:
            url += f"?eventCode={event_code}"
        data = await self.get(url)
        return data.get("awards", [])

    # ── Avatars ──────────────────────────────────────────
    async def get_team_avatar(self, season: int, team_number: int) -> str | None:
        """Return base64-encoded PNG avatar for a team, or None."""
        cache_key = f"avatar:{season}:{team_number}"
        now = time.time()
        if cache_key in self._cache:
            ts, data = self._cache[cache_key]
            if now - ts < CACHE_TTL:
                return data if data else None
        try:
            data = await self.get(
                f"/{season}/avatars?teamNumber={team_number}",
                bypass_breaker=True,
            )
            teams = data.get("teams", [])
            if teams and teams[0].get("encodedAvatar"):
                avatar = f"data:image/png;base64,{teams[0]['encodedAvatar']}"
                self._cache[cache_key] = (now, avatar)
                return avatar
        except Exception:
            pass
        self._cache[cache_key] = (now, "")
        return None

    # ── Advancement ─────────────────────────────────────
    async def get_advancement(self, season: int, event_code: str) -> dict:
        return await self.get(f"/{season}/advancement/{event_code}")

    # ── Leagues ─────────────────────────────────────────
    async def get_leagues(self, season: int, region_code: str | None = None) -> list[dict]:
        url = f"/{season}/leagues"
        if region_code:
            url += f"?regionCode={region_code}"
        data = await self.get(url)
        return data.get("leagues", [])


# ── Singleton ───────────────────────────────────────────────
_client: Optional[FTCClient] = None


def get_ftc_client() -> FTCClient:
    global _client
    if _client is None:
        _client = FTCClient()
    return _client
