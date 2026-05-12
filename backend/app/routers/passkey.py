"""Passkey (WebAuthn) endpoints — register and authenticate via platform authenticators.

Flow
----
Registration (after the user has already signed in via OTP once):
  1. POST /auth/passkey/register-options   → WebAuthn creation options (challenge)
  2. POST /auth/passkey/register           → verify + store credential in DB

Authentication (on future sign-ins):
  1. POST /auth/passkey/authenticate-options  → WebAuthn request options (challenge)
  2. POST /auth/passkey/authenticate          → verify credential, return Supabase session

Helpers:
  GET /auth/passkey/has-credential?email=…  → {has_passkey: bool}

Design notes
------------
• Challenges are stored in a short-lived in-memory dict (90-second TTL). This is
  appropriate for a single-process deployment; replace with Redis for multi-process.
• The Relying Party ID / origin is configured via env vars PASSKEY_RP_ID and
  PASSKEY_ORIGIN (defaults: "localhost" / "http://localhost:3000").
• After successful authentication we use the Supabase service key to call the
  GoTrue admin generate_link endpoint, then immediately exchange the token_hash
  server-side to obtain a full session, which is returned to the browser.
• All DB writes use the service-role key (bypasses RLS); users cannot write
  passkey_credentials directly.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import secrets
import time
from typing import Any

import httpx
from fastapi import APIRouter, Header, HTTPException, Query, status
from pydantic import BaseModel, EmailStr
from webauthn import (
    generate_registration_options,
    generate_authentication_options,
    verify_registration_response,
    verify_authentication_response,
    options_to_json,
)
from webauthn.helpers import (
    base64url_to_bytes,
    bytes_to_base64url,
)
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    UserVerificationRequirement,
    ResidentKeyRequirement,
    AuthenticatorAttachment,
    PublicKeyCredentialDescriptor,
)
from webauthn.helpers.exceptions import (
    InvalidCBORData,
    InvalidAuthenticationResponse,
)

from ..config import SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY

log = logging.getLogger(__name__)

router = APIRouter(prefix="/auth/passkey", tags=["passkey"])

# ── Config ───────────────────────────────────────────────────────────────
RP_NAME   = os.environ.get("PASSKEY_RP_NAME",   "Caster's Tool")
RP_ID     = os.environ.get("PASSKEY_RP_ID",     "localhost")
ORIGIN    = os.environ.get("PASSKEY_ORIGIN",    "http://localhost:3000")

# ── In-memory challenge store (TTL = 90 s) ───────────────────────────────
# {challenge_b64url: {"email": str, "user_id": str|None, "expires": float}}
_challenges: dict[str, dict] = {}
_CHALLENGE_TTL = 90.0


def _prune_challenges() -> None:
    now = time.monotonic()
    expired = [k for k, v in _challenges.items() if v["expires"] < now]
    for k in expired:
        del _challenges[k]


def _store_challenge(challenge_bytes: bytes, *, email: str, user_id: str | None = None) -> None:
    _prune_challenges()
    key = bytes_to_base64url(challenge_bytes)
    _challenges[key] = {
        "email":   email,
        "user_id": user_id,
        "expires": time.monotonic() + _CHALLENGE_TTL,
    }


def _pop_challenge(challenge_b64url: str) -> dict | None:
    _prune_challenges()
    entry = _challenges.pop(challenge_b64url, None)
    if entry is None:
        return None
    if entry["expires"] < time.monotonic():
        return None
    return entry


# ── Supabase helpers (service-role REST) ─────────────────────────────────
def _svc_headers() -> dict[str, str]:
    return {
        "apikey":        SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type":  "application/json",
    }

def _anon_headers() -> dict[str, str]:
    return {
        "apikey":       SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
    }


async def _get_user_by_email(email: str) -> dict | None:
    """Fetch a GoTrue user record by email using the admin API."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        return None
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{SUPABASE_URL}/auth/v1/admin/users",
            headers=_svc_headers(),
            params={"filter": f"email.eq.{email}", "page": 1, "per_page": 1},
        )
    if not resp.is_success:
        return None
    data = resp.json()
    users = data.get("users") or []
    return users[0] if users else None


async def _get_passkey_credentials(user_id: str) -> list[dict]:
    """Fetch all passkey credentials for a user (service-role direct query)."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        return []
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/passkey_credentials",
            headers={**_svc_headers(), "Prefer": "return=representation"},
            params={"user_id": f"eq.{user_id}", "select": "*"},
        )
    if not resp.is_success:
        log.warning("Failed to fetch passkey credentials for user %s: %s", user_id, resp.text)
        return []
    return resp.json()


async def _store_passkey_credential(
    *,
    user_id: str,
    credential_id: str,
    public_key: str,
    sign_count: int,
    aaguid: str | None,
    device_name: str | None,
) -> bool:
    """Insert a new passkey credential row via the service-role key."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        return False
    payload = {
        "user_id":       user_id,
        "credential_id": credential_id,
        "public_key":    public_key,
        "sign_count":    sign_count,
    }
    if aaguid:
        payload["aaguid"] = aaguid
    if device_name:
        payload["device_name"] = device_name

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{SUPABASE_URL}/rest/v1/passkey_credentials",
            headers={**_svc_headers(), "Prefer": "return=minimal"},
            json=payload,
        )
    if not resp.is_success:
        log.error("Failed to store passkey credential: %s", resp.text)
        return False
    return True


async def _update_sign_count(credential_id: str, new_count: int) -> None:
    """Bump sign_count and last_used_at after a successful authentication."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        return
    async with httpx.AsyncClient() as client:
        await client.patch(
            f"{SUPABASE_URL}/rest/v1/passkey_credentials",
            headers={**_svc_headers(), "Prefer": "return=minimal"},
            params={"credential_id": f"eq.{credential_id}"},
            json={"sign_count": new_count, "last_used_at": "now()"},
        )


async def _generate_supabase_session(email: str, user_id: str) -> dict:
    """
    Exchange a verified passkey authentication for a full Supabase session.

    Strategy:
      1. Call the GoTrue admin generate_link endpoint (type=magiclink) for the
         user's email to obtain a one-time token_hash.
      2. Immediately POST to /auth/v1/verify server-side (no redirect_to) to
         exchange the token_hash for a real session JSON.
      3. Return the session fields that the browser's Auth._sessionFromResponse
         knows how to handle.
    """
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY or not SUPABASE_ANON_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Auth service is not configured.",
        )

    async with httpx.AsyncClient(follow_redirects=False) as client:
        # Step 1: generate a magic-link token for the verified user
        gen_resp = await client.post(
            f"{SUPABASE_URL}/auth/v1/admin/generate_link",
            headers=_svc_headers(),
            json={"type": "magiclink", "email": email},
        )

    if not gen_resp.is_success:
        log.error("generate_link failed (%s): %s", gen_resp.status_code, gen_resp.text)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to generate authentication token.",
        )

    gen_data = gen_resp.json()
    # GoTrue returns the token hash under "hashed_token" (or nested in "properties")
    props = gen_data.get("properties") or gen_data
    token_hash = props.get("hashed_token") or props.get("token_hash")
    if not token_hash:
        log.error("generate_link response missing hashed_token: %s", gen_data)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Auth token missing from server response.",
        )

    # Step 2: verify the token_hash server-side to get a session
    async with httpx.AsyncClient(follow_redirects=False) as client:
        verify_resp = await client.post(
            f"{SUPABASE_URL}/auth/v1/verify",
            headers=_anon_headers(),
            json={"type": "magiclink", "token_hash": token_hash},
        )

    if not verify_resp.is_success:
        log.error("Server-side verify failed (%s): %s", verify_resp.status_code, verify_resp.text)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Session exchange failed.",
        )

    session_data = verify_resp.json()
    return session_data


# ── JWT bearer extraction ─────────────────────────────────────────────────
def _extract_user_id_from_token(authorization: str) -> str:
    """Decode (without verifying signature) the sub claim from a JWT."""
    try:
        parts = authorization.removeprefix("Bearer ").split(".")
        payload = json.loads(base64.b64decode(parts[1] + "=="))
        uid = payload.get("sub")
        if not uid:
            raise ValueError("no sub claim")
        return uid
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing Authorization token.",
        ) from exc


# ── Request / response models ─────────────────────────────────────────────
class RegisterOptionsRequest(BaseModel):
    email: EmailStr
    device_name: str | None = None   # optional hint e.g. "MacBook Pro"


class RegisterVerifyRequest(BaseModel):
    email: EmailStr
    credential: dict          # raw PublicKeyCredential JSON from browser
    device_name: str | None = None


class AuthOptionsRequest(BaseModel):
    email: EmailStr


class AuthVerifyRequest(BaseModel):
    email: EmailStr
    credential: dict          # raw PublicKeyCredential JSON from browser


# ── Endpoints ─────────────────────────────────────────────────────────────

@router.get("/has-credential")
async def has_credential(email: str = Query(..., min_length=3)) -> dict:
    """Return {has_passkey: bool} — lets the UI decide whether to offer passkey login."""
    user = await _get_user_by_email(email)
    if not user:
        return {"has_passkey": False}
    creds = await _get_passkey_credentials(user["id"])
    return {"has_passkey": len(creds) > 0}


@router.post("/register-options")
async def register_options(
    body: RegisterOptionsRequest,
    authorization: str = Header(...),
) -> dict:
    """
    Generate WebAuthn credential creation options for a signed-in user.
    Requires a valid Bearer token (the user must already be authenticated via OTP).
    """
    user_id = _extract_user_id_from_token(authorization)

    # Retrieve existing credentials so they can be excluded (prevent re-registration
    # of the same authenticator).
    existing = await _get_passkey_credentials(user_id)
    exclude_creds = [
        PublicKeyCredentialDescriptor(id=base64url_to_bytes(c["credential_id"]))
        for c in existing
    ]

    opts = generate_registration_options(
        rp_id=RP_ID,
        rp_name=RP_NAME,
        user_id=user_id.encode(),
        user_name=body.email,
        user_display_name=body.email,
        exclude_credentials=exclude_creds,
        authenticator_selection=AuthenticatorSelectionCriteria(
            authenticator_attachment=AuthenticatorAttachment.PLATFORM,
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
    )

    _store_challenge(opts.challenge, email=body.email, user_id=user_id)
    return json.loads(options_to_json(opts))


@router.post("/register")
async def register(
    body: RegisterVerifyRequest,
    authorization: str = Header(...),
) -> dict:
    """Verify the authenticator's registration response and persist the credential."""
    user_id = _extract_user_id_from_token(authorization)

    # Reconstruct the challenge bytes from the credential's clientDataJSON
    try:
        client_data = json.loads(
            base64.b64decode(body.credential["response"]["clientDataJSON"] + "==")
        )
        challenge_b64 = client_data.get("challenge", "")
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Malformed credential response.",
        )

    entry = _pop_challenge(challenge_b64)
    if entry is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Challenge expired or not found. Please try again.",
        )
    if entry.get("user_id") != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Challenge was issued for a different user.",
        )

    try:
        verification = verify_registration_response(
            credential=body.credential,
            expected_challenge=base64url_to_bytes(challenge_b64),
            expected_rp_id=RP_ID,
            expected_origin=ORIGIN,
            require_user_verification=False,
        )
    except (InvalidCBORData, InvalidAuthenticationResponse) as exc:
        log.warning("Registration verification failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Passkey registration could not be verified.",
        ) from exc

    cred_id = bytes_to_base64url(verification.credential_id)
    pub_key = bytes_to_base64url(verification.credential_public_key)
    aaguid  = str(verification.aaguid) if verification.aaguid else None

    stored = await _store_passkey_credential(
        user_id=user_id,
        credential_id=cred_id,
        public_key=pub_key,
        sign_count=verification.sign_count,
        aaguid=aaguid,
        device_name=body.device_name,
    )
    if not stored:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save passkey. Please try again.",
        )

    return {"ok": True, "credential_id": cred_id}


@router.post("/authenticate-options")
async def authenticate_options(body: AuthOptionsRequest) -> dict:
    """
    Generate WebAuthn assertion options for a sign-in attempt.
    Returns allowCredentials populated with the user's known passkeys.
    If the email has no registered passkeys, returns {has_passkey: false}.
    """
    user = await _get_user_by_email(body.email)
    if not user:
        return {"has_passkey": False}

    existing = await _get_passkey_credentials(user["id"])
    if not existing:
        return {"has_passkey": False}

    allow_creds = [
        PublicKeyCredentialDescriptor(id=base64url_to_bytes(c["credential_id"]))
        for c in existing
    ]

    opts = generate_authentication_options(
        rp_id=RP_ID,
        allow_credentials=allow_creds,
        user_verification=UserVerificationRequirement.PREFERRED,
    )

    _store_challenge(opts.challenge, email=body.email, user_id=user["id"])
    return {"has_passkey": True, **json.loads(options_to_json(opts))}


@router.post("/authenticate")
async def authenticate(body: AuthVerifyRequest) -> dict:
    """
    Verify a WebAuthn assertion and, on success, return a Supabase session.
    The session JSON is compatible with Auth._sessionFromResponse in auth.js.
    """
    # Reconstruct challenge from the credential's clientDataJSON
    try:
        client_data = json.loads(
            base64.b64decode(body.credential["response"]["clientDataJSON"] + "==")
        )
        challenge_b64 = client_data.get("challenge", "")
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Malformed credential response.",
        )

    entry = _pop_challenge(challenge_b64)
    if entry is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Challenge expired or not found. Please start the sign-in again.",
        )

    user_id = entry.get("user_id")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid challenge.")

    # Look up the specific credential being asserted
    cred_id_from_response = body.credential.get("id") or body.credential.get("rawId", "")
    all_creds = await _get_passkey_credentials(user_id)
    matched = next((c for c in all_creds if c["credential_id"] == cred_id_from_response), None)
    if matched is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Passkey not recognized.",
        )

    try:
        verification = verify_authentication_response(
            credential=body.credential,
            expected_challenge=base64url_to_bytes(challenge_b64),
            expected_rp_id=RP_ID,
            expected_origin=ORIGIN,
            credential_public_key=base64url_to_bytes(matched["public_key"]),
            credential_current_sign_count=matched["sign_count"],
            require_user_verification=False,
        )
    except (InvalidCBORData, InvalidAuthenticationResponse) as exc:
        log.warning("Passkey authentication failed for user %s: %s", user_id, exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Passkey verification failed.",
        ) from exc

    # Update sign count to defend against replay attacks
    await _update_sign_count(matched["credential_id"], verification.new_sign_count)

    # Exchange the verified identity for a Supabase session
    session_data = await _generate_supabase_session(body.email, user_id)
    return session_data
