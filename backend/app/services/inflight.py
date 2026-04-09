"""In-flight request coalescing (single-flight pattern).

Prevents the "thundering herd" problem: when N concurrent callers request
the same expensive resource (e.g., TBA API after a cache miss), only ONE
request actually fires.  The other N-1 callers await the same Future.

Usage::

    from .inflight import coalesce

    async def get_teams(event_key: str) -> list[dict]:
        return await coalesce(f"teams:{event_key}", _fetch_teams, event_key)

    async def _fetch_teams(event_key: str) -> list[dict]:
        ...  # expensive upstream call

The first caller creates a Future and starts the coroutine.  Subsequent
callers with the same *key* receive the same Future and wait.  Once the
coroutine completes (or raises), the Future is resolved for everyone and
then removed from the map so a fresh call can happen next time.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable

log = logging.getLogger(__name__)

# Map of in-flight keys → Future.  Each entry lives only as long as the
# underlying coroutine is running.
_inflight: dict[str, asyncio.Future] = {}


async def coalesce(
    key: str,
    fn: Callable[..., Awaitable[Any]],
    *args: Any,
    **kwargs: Any,
) -> Any:
    """Deduplicate concurrent calls to *fn* that share the same *key*.

    If no in-flight request exists for *key*, start one.  Otherwise,
    piggy-back on the existing request and return its result.
    """
    existing = _inflight.get(key)
    if existing is not None:
        log.debug("Coalescing onto in-flight request: %s", key)
        return await existing

    loop = asyncio.get_running_loop()
    future: asyncio.Future = loop.create_future()
    _inflight[key] = future

    try:
        result = await fn(*args, **kwargs)
        future.set_result(result)
        return result
    except BaseException as exc:
        future.set_exception(exc)
        raise
    finally:
        _inflight.pop(key, None)
