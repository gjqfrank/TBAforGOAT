"""Auth endpoints — user-facing authentication via Supabase.

Uses the anon key (NOT the service-role key) so that Supabase enforces
its own auth rules.  The service-role key must never be used for
operations that could be triggered by an end user.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, EmailStr
from supabase import acreate_client, AsyncClient

from ..config import SUPABASE_URL, SUPABASE_ANON_KEY

log = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


# ── Anon-key client (lazy singleton) ────────────────────────────────────
# Separate from the service-role singleton in supabase_client.py.
# This client has user-level permissions only.
_anon_client: AsyncClient | None = None


async def _get_anon_client() -> AsyncClient:
    global _anon_client
    if _anon_client is None:
        if not SUPABASE_URL or not SUPABASE_ANON_KEY:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Auth service is not configured.",
            )
        _anon_client = await acreate_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    return _anon_client


# ── Request / Response models ────────────────────────────────────────────

class PasswordLoginRequest(BaseModel):
    email: EmailStr
    password: str


class SessionResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user_id: str
    email: str


# ── Endpoint ─────────────────────────────────────────────────────────────

@router.post(
    "/password-login",
    response_model=SessionResponse,
    summary="Sign in with email and password",
    description=(
        "Standard Supabase email+password authentication. "
        "Returns a session on success. Use the access_token as a Bearer "
        "token for subsequent authenticated requests."
    ),
)
async def password_login(body: PasswordLoginRequest) -> SessionResponse:
    """Authenticate a user with email and password via Supabase."""
    client = await _get_anon_client()

    try:
        response = await client.auth.sign_in_with_password(
            {"email": body.email, "password": body.password}
        )
    except Exception as exc:
        # Log the raw error server-side for debugging, but never echo it
        # back to the client — it may contain internal Supabase detail.
        log.warning("Password login failed for %s: %s", body.email, exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        ) from None

    session = getattr(response, "session", None)
    user = getattr(response, "user", None)

    if session is None or user is None:
        # Supabase returned 200 but no session — treat as failure.
        log.warning("Password login: no session returned for %s", body.email)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication failed. Please try again.",
        )

    return SessionResponse(
        access_token=session.access_token,
        refresh_token=session.refresh_token,
        token_type="bearer",
        expires_in=session.expires_in,
        user_id=str(user.id),
        email=user.email or "",
    )
