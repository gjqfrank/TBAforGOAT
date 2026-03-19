"""Centralised error classification and user-friendly HTTP error responses.

All routers should use ``raise_api_error(e)`` instead of constructing
raw ``HTTPException`` objects — this ensures every error the frontend
receives has a meaningful, non-empty ``detail`` field and an appropriate
HTTP status code.
"""
from __future__ import annotations

import httpx
from fastapi import HTTPException

from .circuit_breaker import CircuitOpenError


# ── User-friendly messages by upstream source ───────────────
_SOURCE_LABELS = {
    "thebluealliance.com": "The Blue Alliance (TBA)",
    "frc-api.firstinspires.org": "FRC Events API",
    "api.statbotics.io": "Statbotics",
    "api.gatool.org": "GATool",
}


def _identify_source(exc: Exception) -> str:
    """Try to identify the upstream API from an httpx exception."""
    url = ""
    try:
        if isinstance(exc, httpx.HTTPStatusError):
            url = str(exc.request.url)
        elif isinstance(exc, httpx.RequestError):
            url = str(exc.request.url)
    except RuntimeError:
        pass
    for domain, label in _SOURCE_LABELS.items():
        if domain in url:
            return label
    return "the upstream data source"


def raise_api_error(exc: Exception, *, fallback_detail: str = "") -> None:
    """Translate *exc* into an ``HTTPException`` with a clear message.

    Call this from router ``except`` blocks instead of
    ``raise HTTPException(status_code=400, detail=str(e))``.
    """
    # Circuit breaker tripped → 503
    if isinstance(exc, CircuitOpenError):
        raise HTTPException(
            status_code=503,
            detail=str(exc),
        )

    # Upstream returned an HTTP error
    if isinstance(exc, httpx.HTTPStatusError):
        source = _identify_source(exc)
        status = exc.response.status_code

        if status == 404:
            raise HTTPException(
                status_code=404,
                detail=f"Resource not found on {source}. The event key or team number may be invalid.",
            )
        if status == 401 or status == 403:
            raise HTTPException(
                status_code=502,
                detail=f"Authentication error with {source}. The server's API key may be invalid or expired.",
            )
        if status == 429:
            raise HTTPException(
                status_code=429,
                detail=f"{source} rate limit reached. Please wait a moment and try again.",
            )
        if 500 <= status < 600:
            raise HTTPException(
                status_code=502,
                detail=f"{source} is currently experiencing issues (HTTP {status}). Please try again shortly.",
            )

        raise HTTPException(
            status_code=502,
            detail=f"{source} returned an error (HTTP {status}). Please try again.",
        )

    # Network-level failures (DNS, connection refused, etc.)
    if isinstance(exc, httpx.TimeoutException):
        source = _identify_source(exc)
        raise HTTPException(
            status_code=504,
            detail=f"Request to {source} timed out. The service may be slow or unreachable.",
        )

    if isinstance(exc, httpx.RequestError):
        source = _identify_source(exc)
        raise HTTPException(
            status_code=502,
            detail=f"Could not connect to {source}. The service may be down.",
        )

    # asyncio timeout (global request timeout)
    import asyncio
    if isinstance(exc, asyncio.TimeoutError):
        raise HTTPException(
            status_code=504,
            detail="The request took too long to complete. The upstream data sources may be slow — please try again.",
        )

    # ValueError / validation errors → 400 with the message
    if isinstance(exc, (ValueError, TypeError, KeyError)):
        detail = str(exc) or fallback_detail or "Invalid request parameters."
        raise HTTPException(status_code=400, detail=detail)

    # Catch-all
    detail = fallback_detail or "An unexpected error occurred while fetching data. Please try again."
    raise HTTPException(status_code=500, detail=detail)
