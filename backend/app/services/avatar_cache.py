"""Team avatar cache — eliminates 32-64 TBA media calls per alliance load.

Avatars are cached per-year in a single JSON file on disk.  During event
ingestion (or on the first alliance request), all team avatars are fetched
in parallel and stored.  Subsequent requests read from the cache file.
"""
from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Optional

from .cache_service import CACHE_DIR
from .tba_client import get_tba_client
from .frc_client import get_frc_client

log = logging.getLogger(__name__)

# Concurrency limit for TBA media calls
_FETCH_SEM = asyncio.Semaphore(12)


def _cache_path(year: int) -> Path:
    return CACHE_DIR / f"avatars_{year}.json"


def _load_cache(year: int) -> dict[str, Optional[str]]:
    """Load the avatar cache for a year.  Returns {team_key: data_uri|None}."""
    p = _cache_path(year)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_cache(year: int, data: dict[str, Optional[str]]) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    _cache_path(year).write_text(
        json.dumps(data, separators=(",", ":")), encoding="utf-8",
    )


async def _fetch_one(tba, team_key: str, year: int) -> tuple[str, Optional[str]]:
    """Fetch a single team's avatar from TBA."""
    async with _FETCH_SEM:
        try:
            media = await tba.get_team_media(team_key, year)
        except Exception:
            return (team_key, None)
    if media:
        for item in media:
            if item.get("type") == "avatar":
                b64 = (item.get("details") or {}).get("base64Image")
                if b64:
                    return (team_key, f"data:image/png;base64,{b64}")
    return (team_key, None)


async def _fetch_frc_avatars(
    team_keys: list[str], year: int,
) -> dict[str, str]:
    """Fetch avatars from the FRC Events API for teams TBA didn't cover."""
    frc = get_frc_client()
    result: dict[str, str] = {}
    for tk in team_keys:
        num = tk.replace("frc", "")
        try:
            async with _FETCH_SEM:
                data = await frc.get(f"{year}/avatars?teamNumber={num}")
        except Exception:
            continue
        teams = data.get("teams") or []
        if teams:
            b64 = teams[0].get("encodedAvatar")
            if b64:
                result[tk] = f"data:image/png;base64,{b64}"
    if result:
        log.info("FRC API avatar fallback: found %d/%d", len(result), len(team_keys))
    return result


async def get_avatars(team_keys: list[str], year: int) -> dict[str, str]:
    """Return ``{team_key: data_uri}`` for every team that has an avatar.

    Reads from disk cache first; any missing keys are fetched from TBA
    in parallel and the cache is updated.
    """
    if not team_keys:
        return {}

    cache = _load_cache(year)

    # Partition into cached vs. uncached
    result: dict[str, str] = {}
    missing: list[str] = []
    for tk in team_keys:
        if tk in cache:
            if cache[tk]:  # has an avatar
                result[tk] = cache[tk]
        else:
            missing.append(tk)

    if not missing:
        return result

    # Fetch missing avatars from TBA
    tba = get_tba_client()
    fetched = await asyncio.gather(*[_fetch_one(tba, tk, year) for tk in missing])

    for tk, uri in fetched:
        cache[tk] = uri          # persist even None (means "no avatar")
        if uri:
            result[tk] = uri

    # Fallback: try FRC Events API for teams TBA didn't have
    still_missing = [tk for tk in missing if cache.get(tk) is None]
    if still_missing:
        frc_found = await _fetch_frc_avatars(still_missing, year)
        for tk, uri in frc_found.items():
            cache[tk] = uri
            result[tk] = uri

    _save_cache(year, cache)
    log.info("Avatar cache updated: %d fetched, %d total for %d",
             len(missing), len(cache), year)

    return result


def get_avatars_from_cache(team_keys: list[str], year: int) -> dict[str, str]:
    """Return avatars that are already in the disk cache (no network I/O).

    This is O(1) — a dictionary lookup per key — and never blocks on TBA.
    Use for the critical request path; pair with a background prefetch_avatars()
    to warm the cache for subsequent requests.
    """
    if not team_keys:
        return {}
    cache = _load_cache(year)
    return {tk: cache[tk] for tk in team_keys if cache.get(tk)}


async def prefetch_avatars(team_keys: list[str], year: int) -> None:
    """Pre-warm the avatar cache during ingestion (fire-and-forget)."""
    await get_avatars(team_keys, year)
