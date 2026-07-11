#!/usr/bin/env python3
"""Set a Supabase user's role (and name) in their user_metadata.

Uses the Supabase Admin API (service-role key) to update an existing
user's raw_user_meta_data. This is the only reliable way to change
metadata on an already-created user — the Supabase Dashboard has no
UI for editing user_metadata after creation, and the SQL Editor's
default role lacks UPDATE privileges on auth.users.

USAGE
-----
    export SUPABASE_URL=https://your-project.supabase.co
    export SUPABASE_SERVICE_KEY=eyJ...   (Project Settings → API → service_role)
    python3 scripts/set_user_role.py <email> <role> [name]

    # Examples
    python3 scripts/set_user_role.py alice@example.com scouter "Alice"
    python3 scripts/set_user_role.py bob@example.com admin   "Bob"
    python3 scripts/set_user_role.py alice@example.com volunteer   # demote

NOTES
-----
- The service_role key bypasses RLS. NEVER commit it or expose it to
  the browser. Only run this script locally.
- Existing user_metadata is preserved and merged (only `role` and
  `name` are overwritten).
- The affected user must sign out and back in to receive a new JWT
  carrying the updated metadata.
"""
from __future__ import annotations

import json
import os
import sys

import requests


def die(msg: str, code: int = 1) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(code)


def find_user_by_email(base: str, headers: dict, email: str) -> dict | None:
    """Page through admin list-users to find the user with this email."""
    page = 1
    per_page = 1000
    while True:
        r = requests.get(
            f"{base}/auth/v1/admin/users",
            headers=headers,
            params={"page": page, "per_page": per_page},
            timeout=30,
        )
        if r.status_code != 200:
            die(f"list-users failed: HTTP {r.status_code} — {r.text}")
        body = r.json()
        users = body.get("users", []) or []
        if not users:
            return None
        for u in users:
            if (u.get("email") or "").lower() == email.lower():
                return u
        if len(users) < per_page:
            return None
        page += 1


def update_user(base: str, headers: dict, uid: str, new_meta: dict) -> dict:
    r = requests.put(
        f"{base}/auth/v1/admin/users/{uid}",
        headers=headers,
        json={"user_metadata": new_meta},
        timeout=30,
    )
    if r.status_code != 200:
        die(f"update-user failed: HTTP {r.status_code} — {r.text}")
    return r.json()


def main() -> None:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        die(
            "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in the "
            "environment. Get the service_role key from Supabase Dashboard "
            "→ Project Settings → API → service_role key."
        )

    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(0)

    email = sys.argv[1]
    role = sys.argv[2]
    name = sys.argv[3] if len(sys.argv) > 3 else None

    valid_roles = {"volunteer", "third_party", "admin", "scouter"}
    if role not in valid_roles:
        die(f"role must be one of {sorted(valid_roles)}, got: {role}")

    headers = {
        "Authorization": f"Bearer {key}",
        "apikey": key,
        "Content-Type": "application/json",
    }

    print(f"Looking up user by email: {email} ...")
    user = find_user_by_email(url, headers, email)
    if not user:
        die(f"No user found with email {email}. Create the user first in "
            "Supabase Dashboard → Authentication → Users → Add user.")

    uid = user.get("id")
    old_meta = user.get("user_metadata") or {}
    print(f"Found user: id={uid}  email={user.get('email')}")
    print(f"  current user_metadata: {json.dumps(old_meta, ensure_ascii=False)}")

    new_meta = dict(old_meta)
    new_meta["role"] = role
    if name is not None:
        new_meta["name"] = name

    print(f"  new user_metadata:      {json.dumps(new_meta, ensure_ascii=False)}")
    print("Updating ...")
    updated = update_user(url, headers, uid, new_meta)
    final_meta = updated.get("user_metadata") or {}
    print(
        f"\nDone. user_metadata is now: "
        f"{json.dumps(final_meta, ensure_ascii=False)}"
    )
    print(
        "\nIMPORTANT: the user must sign out and sign back in to receive a "
        "new JWT carrying the updated role."
    )


if __name__ == "__main__":
    main()
