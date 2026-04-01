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

# FIRST FTC Events API Token (Base64-encoded "username:authkey")
# Set via environment variable FTC_EVENTS_API_TOKEN
FTC_EVENTS_API_TOKEN = os.environ.get("FTC_EVENTS_API_TOKEN", "")

# Anthropic API Key for AI Storylines (optional)
# Set via environment variable ANTHROPIC_API_KEY
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")