"""GATool API async client — fetches community-edited team data from gatool.org."""
from __future__ import annotations

import time
from typing import Any, Optional

import httpx

from .circuit_breaker import gatool_breaker

GATOOL_BASE = "https://api.gatool.org"
CACHE_TTL = 300  # 5 minutes — cloud data doesn't change as often


class GAToolClient:
    """Async wrapper for the public GATool REST API."""

    def __init__(self) -> None:
        self._cache: dict[str, tuple[float, Any]] = {}
        self._http: Optional[httpx.AsyncClient] = None

    def _client(self) -> httpx.AsyncClient:
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(
                base_url=GATOOL_BASE,
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
            # 204 No Content — return None so callers can handle gracefully
            if resp.status_code == 204 or not resp.content:
                return None
            return resp.json()

        data = await gatool_breaker.call(_do_request)
        self._cache[endpoint] = (now, data)
        return data

    def clear_cache(self) -> None:
        self._cache.clear()

    async def get_event_community_updates(
        self, year: int, event_code: str
    ) -> dict[int, dict]:
        """Fetch community updates for all teams at an event.

        Returns a dict keyed by team number with the updates payload.
        """
        try:
            raw = await self.get(f"/v3/{year}/communityUpdates/{event_code}")
        except httpx.HTTPStatusError:
            return {}

        if not isinstance(raw, list):
            return {}

        result: dict[int, dict] = {}
        for entry in raw:
            try:
                num = int(entry.get("teamNumber", 0))
            except (ValueError, TypeError):
                continue
            if num and "updates" in entry:
                result[num] = entry["updates"]
        return result


# ── Singleton ───────────────────────────────────────────────
_instance: Optional[GAToolClient] = None


def get_gatool_client() -> GAToolClient:
    global _instance
    if _instance is None:
        _instance = GAToolClient()
    return _instance
