"""FRC Caster's Tool — FastAPI application."""
import asyncio
import logging
import os
import time
from collections import defaultdict
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pathlib import Path
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from .config import TRUSTED_API_KEYS
from .routers import events, matches, alliances, teams, storylines
from .routers import ftc_events, ftc_matches, ftc_alliances
from .routers import sync, snapshot

log = logging.getLogger(__name__)


# ── Lifespan: start/stop background ingestion workers ──────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start background ingestion workers on startup, cancel on shutdown."""
    tasks: list[asyncio.Task] = []

    # Only start workers when Supabase is configured
    supabase_url = os.environ.get("SUPABASE_URL", "")
    disable_workers = os.environ.get("DISABLE_WORKERS", "")
    if supabase_url and not disable_workers:
        from .workers.match_poller import run_match_poller
        from .workers.event_sync import run_event_sync
        from .workers.ftc_event_sync import run_ftc_event_sync
        from .workers.ftc_match_poller import run_ftc_match_poller

        tasks.append(asyncio.create_task(run_event_sync(), name="event-sync"))
        tasks.append(asyncio.create_task(run_match_poller(), name="match-poller"))
        tasks.append(asyncio.create_task(run_ftc_event_sync(), name="ftc-event-sync"))
        tasks.append(asyncio.create_task(run_ftc_match_poller(), name="ftc-match-poller"))
        log.info("Ingestion workers started (%d tasks)", len(tasks))
    else:
        log.info("SUPABASE_URL not set — ingestion workers disabled")

    yield

    # Graceful shutdown
    for t in tasks:
        t.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
        log.info("Ingestion workers stopped")

    # Close Supabase client if it was initialized
    if supabase_url:
        try:
            from .services.supabase_client import close_supabase
            await close_supabase()
        except Exception:
            pass


app = FastAPI(title="FRC Caster's Tool", version="1.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[
        "Retry-After",
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-RateLimit-Reset",
    ],
)

# ── Rate-limiter middleware (in-memory, per-IP) ─────────────
_RATE_WINDOW = 60          # seconds
_RATE_LIMIT_GENERAL = 200  # requests per window for normal endpoints (raised: BFF cache hits are cheap)
_RATE_LIMIT_HEAVY = 40     # requests per window for heavy endpoints (raised: most are cached)

# Trusted consumers get higher ceilings but aren't unlimited
_RATE_LIMIT_TRUSTED_GENERAL = 600   # raised from 300
_RATE_LIMIT_TRUSTED_HEAVY = 300     # raised from 60

# Endpoints that fan out to many upstream calls
_HEAVY_PATTERNS = {
    "/summary/connections", "/summary/awards", "/history",
    "/world-record", "/alliances/", "/storylines/",
}
# Paths that are exempt from rate limiting
_RATE_EXEMPT_PATHS = {"/api/health", "/api/status"}

_rate_buckets_general: dict[str, list[float]] = defaultdict(list)
_rate_buckets_heavy: dict[str, list[float]] = defaultdict(list)


def _is_heavy(path: str) -> bool:
    return any(p in path for p in _HEAVY_PATTERNS)


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not request.url.path.startswith("/api/"):
            return await call_next(request)

        # Skip rate limiting for health checks and CORS preflight
        if request.method == "OPTIONS" or request.url.path in _RATE_EXEMPT_PATHS:
            return await call_next(request)

        # Trusted API consumers get elevated limits (keyed by API key)
        api_key = request.headers.get("X-API-Key", "")
        trusted = api_key and api_key in TRUSTED_API_KEYS

        if api_key and not trusted:
            log.warning(
                "Unrecognized API key from %s: %s…",
                request.client.host if request.client else "unknown",
                api_key[:8],
            )

        client_ip = request.client.host if request.client else "unknown"
        key = f"trusted:{api_key}" if trusted else client_ip

        now = time.time()
        cutoff = now - _RATE_WINDOW
        heavy = _is_heavy(request.url.path)

        limit_general = _RATE_LIMIT_TRUSTED_GENERAL if trusted else _RATE_LIMIT_GENERAL
        limit_heavy = _RATE_LIMIT_TRUSTED_HEAVY if trusted else _RATE_LIMIT_HEAVY

        # Prune old entries in both buckets
        _rate_buckets_general[key] = [t for t in _rate_buckets_general[key] if t > cutoff]
        _rate_buckets_heavy[key] = [t for t in _rate_buckets_heavy[key] if t > cutoff]

        bucket = _rate_buckets_heavy[key] if heavy else _rate_buckets_general[key]
        limit = limit_heavy if heavy else limit_general
        bucket_name = "heavy" if heavy else "general"

        if len(bucket) >= limit:
            retry_after = max(1, int(bucket[0] + _RATE_WINDOW - now) + 1)
            log.warning(
                "Rate limit hit: client=%s trusted=%s bucket=%s limit=%d "
                "path=%s retry_after=%ds",
                key, trusted, bucket_name, limit, request.url.path,
                retry_after,
            )
            return JSONResponse(
                status_code=429,
                content={
                    "detail": "Too many requests — please slow down and try again in a moment.",
                    "retry_after": retry_after,
                    "limit": limit,
                    "bucket": bucket_name,
                },
                headers={
                    "Retry-After": str(retry_after),
                    "X-RateLimit-Limit": str(limit),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(retry_after),
                },
            )

        bucket.append(now)
        remaining = max(0, limit - len(bucket))
        reset = max(1, int(bucket[0] + _RATE_WINDOW - now))

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        response.headers["X-RateLimit-Reset"] = str(reset)
        return response


app.add_middleware(RateLimitMiddleware)


# ── Global request timeout middleware ───────────────────────
_REQUEST_TIMEOUT = 90  # seconds — hard cap on any single API request


class TimeoutMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not request.url.path.startswith("/api/"):
            return await call_next(request)
        try:
            return await asyncio.wait_for(call_next(request), timeout=_REQUEST_TIMEOUT)
        except asyncio.TimeoutError:
            log.warning("Request timed out: %s %s", request.method, request.url.path)
            return JSONResponse(
                status_code=504,
                content={
                    "detail": "The request took too long to complete. The upstream data sources may be slow — please try again."
                },
            )


app.add_middleware(TimeoutMiddleware)

# ── API routers ─────────────────────────────────────────────
app.include_router(events.router, prefix="/api/events", tags=["Events"])
app.include_router(matches.router, prefix="/api/matches", tags=["Matches"])
app.include_router(alliances.router, prefix="/api/alliances", tags=["Alliances"])
app.include_router(teams.router, prefix="/api/teams", tags=["Teams"])

app.include_router(storylines.router, prefix="/api/storylines", tags=["Storylines"])

# ── FTC API routers ─────────────────────────────────────────
app.include_router(ftc_events.router, prefix="/api/ftc/events", tags=["FTC Events"])
app.include_router(ftc_matches.router, prefix="/api/ftc/matches", tags=["FTC Matches"])
app.include_router(ftc_alliances.router, prefix="/api/ftc/alliances", tags=["FTC Alliances"])

# ── Sync endpoint ───────────────────────────────────────────
app.include_router(sync.router, prefix="/api/sync", tags=["Sync"])

# ── Snapshot endpoint ───────────────────────────────────────
app.include_router(snapshot.router, prefix="/api/events", tags=["Snapshot"])

# ── No-cache middleware for JS/CSS (prevents stale browser cache) ───
class NoCacheStaticMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        if request.url.path.endswith(('.js', '.css', '.json')):
            response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
            response.headers['Pragma'] = 'no-cache'
            response.headers['Expires'] = '0'
        return response

app.add_middleware(NoCacheStaticMiddleware)

# ── Serve frontend ──────────────────────────────────────────
frontend_dir = Path(__file__).resolve().parent.parent.parent / "docs"
app.mount("/css", StaticFiles(directory=str(frontend_dir / "css")), name="css")
app.mount("/js", StaticFiles(directory=str(frontend_dir / "js")), name="js")
app.mount("/data", StaticFiles(directory=str(frontend_dir / "data")), name="data")


@app.get("/")
async def serve_frontend():
    return FileResponse(str(frontend_dir / "index.html"))


@app.get("/about")
async def serve_about():
    return FileResponse(str(frontend_dir / "about.html"))


@app.get("/favicon.svg")
async def serve_favicon():
    return FileResponse(str(frontend_dir / "favicon.svg"), media_type="image/svg+xml")


@app.get("/api/health")
async def health_check():
    return {"status": "ok"}


@app.get("/api/status")
async def api_status():
    """Check connectivity to TBA, FIRST FRC Events, and Statbotics APIs.
    Also reports circuit breaker status for each upstream service."""
    import asyncio
    from .services.tba_client import get_tba_client
    from .services.frc_client import get_frc_client
    from .services.ftc_client import get_ftc_client
    from .services.statbotics_client import get_statbotics_client
    from .services.circuit_breaker import tba_breaker, frc_breaker, ftc_breaker, statbotics_breaker, gatool_breaker

    async def check_tba():
        try:
            client = get_tba_client()
            resp = await client._client().get("/status")
            return resp.status_code == 200
        except Exception:
            return False

    async def check_frc():
        try:
            client = get_frc_client()
            # A lightweight call - just fetch current season
            resp = await client._client().get("/")
            return resp.status_code == 200
        except Exception:
            return False

    async def check_statbotics():
        try:
            client = get_statbotics_client()
            resp = await client._client().get("/")
            return resp.status_code == 200
        except Exception:
            return False

    async def check_ftc():
        try:
            client = get_ftc_client()
            resp = await client._client().get("/v2.0")
            return resp.status_code == 200
        except Exception:
            return False

    tba_ok, frc_ok, sb_ok, ftc_ok = await asyncio.gather(
        check_tba(), check_frc(), check_statbotics(), check_ftc()
    )
    return {
        "tba": tba_ok,
        "frc": frc_ok,
        "ftc": ftc_ok,
        "statbotics": sb_ok,
        "circuit_breakers": {
            "tba": tba_breaker.state.value,
            "frc": frc_breaker.state.value,
            "ftc": ftc_breaker.state.value,
            "statbotics": statbotics_breaker.state.value,
            "gatool": gatool_breaker.state.value,
        },
    }
