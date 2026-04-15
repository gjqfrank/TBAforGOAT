"""FIRST FRC Events API v3 async client with in-memory caching."""
from __future__ import annotations

import base64
import time
from typing import Any, Optional

import httpx

from ..config import FRC_EVENTS_API_TOKEN
from .circuit_breaker import frc_breaker

FRC_BASE = "https://frc-api.firstinspires.org/v3.0"
FRC_BASE_V32 = "https://frc-api.firstinspires.org/v3.2"
CACHE_TTL = 120  # seconds – fresher than TBA for live events

# Public credentials for the Regional Pool page (embedded in the
# frc-events.firstinspires.org frontend bundle).
_RA_AUTH = base64.b64encode(
    b"FRC_RegionalPool:F2057EBA-2E07-40C4-A1A3-D66CDFCA6326"
).decode()


class FRCClient:
    """Thin async wrapper around the official FIRST FRC Events REST API."""

    def __init__(self) -> None:
        self.headers = {
            "Authorization": f"Basic {FRC_EVENTS_API_TOKEN}",
            "Accept": "application/json",
        }
        self._cache: dict[str, tuple[float, Any]] = {}
        self._http: Optional[httpx.AsyncClient] = None
        self._http_v32: Optional[httpx.AsyncClient] = None

    def _client(self) -> httpx.AsyncClient:
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(
                base_url=FRC_BASE,
                headers=self.headers,
                timeout=30.0,
            )
        return self._http

    def _client_v32(self) -> httpx.AsyncClient:
        """v3.2 client using the Regional Pool credentials."""
        if self._http_v32 is None or self._http_v32.is_closed:
            self._http_v32 = httpx.AsyncClient(
                base_url=FRC_BASE_V32,
                headers={
                    "Authorization": f"Basic {_RA_AUTH}",
                    "Accept": "application/json",
                },
                timeout=30.0,
            )
        return self._http_v32

    async def get(self, endpoint: str, *, bypass_cache: bool = False,
                  ttl_override: float | None = None) -> Any:
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

        data = await frc_breaker.call(_do_request)
        self._cache[endpoint] = (now, data)
        return data

    def clear_cache(self) -> None:
        self._cache.clear()

    # ── Score Details ────────────────────────────────────
    async def get_scores(
        self, season: int, event_code: str, level: str = "Qualification",
        match_number: int | None = None,
        *, bypass_cache: bool = False,
    ) -> list[dict]:
        """Return MatchScores array from the score details endpoint."""
        url = f"/{season}/scores/{event_code}/{level}"
        if match_number is not None:
            url += f"?matchNumber={match_number}"
        data = await self.get(url, bypass_cache=bypass_cache)
        return data.get("MatchScores", [])

    # ── Match Results ────────────────────────────────────
    async def get_matches(
        self, season: int, event_code: str,
        level: str | None = None,
        team_number: int | None = None,
        *, bypass_cache: bool = False,
    ) -> list[dict]:
        """Return Matches array from the match results endpoint."""
        url = f"/{season}/matches/{event_code}"
        params = []
        if level:
            params.append(f"tournamentLevel={level}")
        if team_number is not None:
            params.append(f"teamNumber={team_number}")
        if params:
            url += "?" + "&".join(params)
        data = await self.get(url, bypass_cache=bypass_cache)
        return data.get("Matches", [])

    # ── Rankings ─────────────────────────────────────────
    RANKINGS_TTL = 15  # seconds — short TTL for near-instant ranking updates

    async def get_rankings(
        self, season: int, event_code: str,
    ) -> list[dict]:
        """Return Rankings array from the FRC Events API (real-time from FIRST).

        Uses a 15s cache TTL (vs 120s default) so rankings feel near-instant
        without hammering the API on every poll.
        """
        data = await self.get(
            f"/{season}/rankings/{event_code}",
            ttl_override=self.RANKINGS_TTL,
        )
        return data.get("Rankings", [])

    # ── Events ───────────────────────────────────────────
    async def get_events(self, season: int) -> list[dict]:
        data = await self.get(f"/{season}/events")
        return data.get("Events", [])

    # ── Teams ────────────────────────────────────────────
    async def get_event_teams(
        self, season: int, event_code: str,
    ) -> list[dict]:
        """Return teams at an event with organization/school info."""
        data = await self.get(f"/{season}/teams?eventCode={event_code}")
        return data.get("teams", [])

    # ── Regional Advancement Pool (v3.2) ─────────────────
    REGIONAL_POOL_TTL = 300  # 5 min — data changes infrequently

    async def get_regional_pool(self, season: int) -> list[dict]:
        """Qualified regional teams from the advancement pool.

        Paginates through the v3.2 teamdetail endpoint and returns only
        teams that have qualified for the Championship.
        """
        cache_key = f"v32:/{season}/rankings/regional/teamdetail:qualified"
        now = time.time()
        if cache_key in self._cache:
            ts, data = self._cache[cache_key]
            if now - ts < self.REGIONAL_POOL_TTL:
                return data

        async def _do_request():
            qualified: list[dict] = []
            page = 1
            while True:
                url = f"/{season}/rankings/regional/teamdetail?page={page}"
                resp = await self._client_v32().get(url)
                resp.raise_for_status()
                data = resp.json()
                teams = data.get("teams", [])
                qualified.extend(t for t in teams if t.get("qualifiedFirstCmp"))
                page_total = data.get("pageTotal", 1)
                if page >= page_total:
                    break
                page += 1
            return qualified

        teams = await frc_breaker.call(_do_request)
        self._cache[cache_key] = (now, teams)
        return teams

    async def get_regional_pool_event(
        self, season: int, event_code: str,
    ) -> dict:
        """Per-event regional advancement detail."""
        endpoint = f"/{season}/rankings/regional/eventdetail/{event_code}"
        now = time.time()
        cache_key = f"v32:{endpoint}"
        if cache_key in self._cache:
            ts, data = self._cache[cache_key]
            if now - ts < self.REGIONAL_POOL_TTL:
                return data

        async def _do_request():
            resp = await self._client_v32().get(endpoint)
            resp.raise_for_status()
            return resp.json()

        data = await frc_breaker.call(_do_request)
        self._cache[cache_key] = (now, data)
        return data


# ── Singleton ───────────────────────────────────────────────
_client: Optional[FRCClient] = None


def get_frc_client() -> FRCClient:
    global _client
    if _client is None:
        _client = FRCClient()
    return _client
