"""Disk-backed cache for expensive computed payloads.

Stores JSON files in CACHE_DIR with a configurable TTL.  Used for:

- Event summaries (demographics, HoF, scorers, high scores)
- Event summary awards (past champions, past season awards)
- Season high scores (Statbotics data)

Each entry is a JSON object with a ``_ts`` timestamp.  Reads check age
against the supplied TTL.
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any, Optional

from .cache_service import CACHE_DIR

log = logging.getLogger(__name__)


def _path(prefix: str, key: str) -> Path:
    return CACHE_DIR / f"{prefix}_{key}.json"


def read_payload(prefix: str, key: str, ttl: float) -> Optional[dict]:
    """Return cached payload if fresh, else None."""
    p = _path(prefix, key)
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        age = time.time() - data.get("_ts", 0)
        if age <= ttl:
            return data
    except Exception:
        pass
    return None


def write_payload(prefix: str, key: str, payload: dict) -> None:
    """Write payload to disk with current timestamp."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    payload["_ts"] = time.time()
    _path(prefix, key).write_text(
        json.dumps(payload, separators=(",", ":")), encoding="utf-8",
    )


def invalidate(prefix: str, key: str) -> None:
    """Delete a cached payload."""
    p = _path(prefix, key)
    p.unlink(missing_ok=True)
