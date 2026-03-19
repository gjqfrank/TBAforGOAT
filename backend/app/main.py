"""FRC Caster's Tool — FastAPI application."""
import asyncio
import logging
import time
from collections import defaultdict
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pathlib import Path
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from .config import TRUSTED_API_KEYS
from .routers import events, matches, alliances, teams

log = logging.getLogger(__name__)

app = FastAPI(title="FRC Caster's Tool", version="1.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Rate-limiter middleware (in-memory, per-IP) ─────────────
_RATE_WINDOW = 60          # seconds
_RATE_LIMIT_GENERAL = 60   # requests per window for normal endpoints
_RATE_LIMIT_HEAVY = 10     # requests per window for heavy endpoints

# Trusted consumers get higher ceilings but aren't unlimited
_RATE_LIMIT_TRUSTED_GENERAL = 300
_RATE_LIMIT_TRUSTED_HEAVY = 60

# Endpoints that fan out to many upstream calls
_HEAVY_PATTERNS = {
    "/summary/connections", "/summary/awards", "/history",
    "/world-record", "/alliances/",
}
_rate_buckets_general: dict[str, list[float]] = defaultdict(list)
_rate_buckets_heavy: dict[str, list[float]] = defaultdict(list)


def _is_heavy(path: str) -> bool:
    return any(p in path for p in _HEAVY_PATTERNS)


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not request.url.path.startswith("/api/"):
            return await call_next(request)

        # Trusted API consumers get elevated limits (keyed by API key)
        api_key = request.headers.get("X-API-Key", "")
        trusted = api_key and api_key in TRUSTED_API_KEYS

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

        if heavy:
            if len(_rate_buckets_heavy[key]) >= limit_heavy:
                return JSONResponse(
                    status_code=429,
                    content={
                        "detail": "Too many requests — please slow down and try again in a moment."
                    },
                )
            _rate_buckets_heavy[key].append(now)
        else:
            if len(_rate_buckets_general[key]) >= limit_general:
                return JSONResponse(
                    status_code=429,
                    content={
                        "detail": "Too many requests — please slow down and try again in a moment."
                    },
                )
            _rate_buckets_general[key].append(now)

        return await call_next(request)


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
    from .services.statbotics_client import get_statbotics_client
    from .services.circuit_breaker import tba_breaker, frc_breaker, statbotics_breaker, gatool_breaker

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

    tba_ok, frc_ok, sb_ok = await asyncio.gather(check_tba(), check_frc(), check_statbotics())
    return {
        "tba": tba_ok,
        "frc": frc_ok,
        "statbotics": sb_ok,
        "circuit_breakers": {
            "tba": tba_breaker.state.value,
            "frc": frc_breaker.state.value,
            "statbotics": statbotics_breaker.state.value,
            "gatool": gatool_breaker.state.value,
        },
    }
