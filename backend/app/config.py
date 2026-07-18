# config.py

import os
from dotenv import load_dotenv

load_dotenv()

# Blue Alliance API Key Configuration
# Set via environment variable TBA_API_KEY (loaded from .env locally)
BLUE_ALLIANCE_API_KEY = os.environ.get("TBA_API_KEY")
if not BLUE_ALLIANCE_API_KEY:
    raise ValueError(
        "TBA_API_KEY environment variable is not set. "
        "Create a .env file with TBA_API_KEY=your_key"
    )

# Trusted API keys — comma-separated list of keys that bypass rate limiting.
# Set via environment variable TRUSTED_API_KEYS (e.g. "key1,key2")
TRUSTED_API_KEYS: set[str] = {
    k.strip()
    for k in os.environ.get("TRUSTED_API_KEYS", "").split(",")
    if k.strip()
}

# FIRST FRC Events API Token (Base64-encoded "username:authkey")
# Set via environment variable FRC_EVENTS_API_TOKEN
FRC_EVENTS_API_TOKEN = os.environ.get("FRC_EVENTS_API_TOKEN", "")

# Anthropic API Key for AI Storylines (optional)
# Set via environment variable ANTHROPIC_API_KEY
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

# Supabase Configuration (Phase 1.2 — Offline-First BFF)
# SUPABASE_URL: Project URL (e.g. "https://xyz.supabase.co")
# SUPABASE_SERVICE_KEY: Service-role key — bypasses RLS, server-side only
# SUPABASE_ANON_KEY: Public anon key — used for user-facing auth flows only
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")

# ── GOATScout (Team 6907) sync credentials ──────────────────
# Used by goatscout_sync.py to authenticate against auth.team6907.org
# and pull prescout data into the local goatscout_data table.
# All optional — sync is disabled when email/password/event_id are missing.
GOATSCOUT_EMAIL = os.environ.get("GOATSCOUT_EMAIL", "")
GOATSCOUT_PASSWORD = os.environ.get("GOATSCOUT_PASSWORD", "")
# GOATSCOUT_EVENT_MAP is a JSON string: {"<event_key>": "<goatscout event uuid>"}
# Allows one TBAforGOAT event to map to one GOATScout event id.
GOATSCOUT_EVENT_MAP = os.environ.get("GOATSCOUT_EVENT_MAP", "{}")
# Sync interval in seconds (default: 30 minutes). Set to 0 to disable the
# background task entirely (the /api/goatscout/{event_key}/sync-prescout
# endpoint still works for manual triggers).
GOATSCOUT_SYNC_INTERVAL = int(os.environ.get("GOATSCOUT_SYNC_INTERVAL", "1800"))