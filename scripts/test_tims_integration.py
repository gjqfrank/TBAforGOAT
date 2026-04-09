#!/usr/bin/env python3
"""
TIMS Integration Test Suite
Tests the full CRUD cycle for TIMS overrides, including:
- PUT (create + update) with all fields
- Merge behavior (only sent fields update)
- Audit logging (history)
- Reset to defaults (DELETE)
- Global visibility (edited data persists, not overwritten by FIRST defaults)
"""
import asyncio
import json
import sys
import time
import httpx

BASE = "http://localhost:8000/api"
TEST_TEAM = "frc8725"  # Use a real team that exists in Supabase teams table
DEVICE_ID = "test-device-integration"

PASS = 0
FAIL = 0


def report(name, ok, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  ✅ {name}")
    else:
        FAIL += 1
        print(f"  ❌ {name}: {detail}")


async def main():
    global PASS, FAIL
    async with httpx.AsyncClient(base_url=BASE, timeout=30) as c:

        # ════════════════════════════════════════════════════
        # 0. Cleanup — delete any leftover test data
        # ════════════════════════════════════════════════════
        print("\n🧹 Cleanup...")
        await c.delete(f"/teams/{TEST_TEAM}/tims-overrides")

        # ════════════════════════════════════════════════════
        # 1. GET — should return empty when no overrides
        # ════════════════════════════════════════════════════
        print("\n📖 Test 1: GET empty overrides")
        r = await c.get(f"/teams/{TEST_TEAM}/tims-overrides")
        report("Returns 200", r.status_code == 200)
        report("Returns empty dict", r.json() == {} or r.json() == [])

        # ════════════════════════════════════════════════════
        # 2. PUT — create with ALL fields
        # ════════════════════════════════════════════════════
        print("\n✏️  Test 2: PUT (create) with all fields")
        full_payload = {
            "author_device_id": DEVICE_ID,
            "author_name": "Test Caster",
            "author_event_key": "2026test",
            "custom_nickname": "Test Bot",
            "custom_organization": "Test Academy",
            "custom_location": "Houston, TX",
            "custom_robot_name": "Testinator",
            "custom_motto": "Test all the things",
            "custom_top_sponsors": "Sponsor1, Sponsor2",
            "custom_pronunciation": "test-bot",
            "custom_number_display": "99-999",
            "custom_hardware": json.dumps(["turret", "swerve"]),
            "custom_auto_strategy": json.dumps(["center rush"]),
            "custom_teleop_strategy": json.dumps(["mid take", "corner park"]),
        }
        r = await c.put(f"/teams/{TEST_TEAM}/tims-overrides", json=full_payload)
        report("PUT returns 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
        data = r.json()
        report("custom_nickname saved", data.get("custom_nickname") == "Test Bot")
        report("custom_hardware saved", data.get("custom_hardware") == json.dumps(["turret", "swerve"]))
        report("custom_auto_strategy saved", data.get("custom_auto_strategy") == json.dumps(["center rush"]))
        report("custom_teleop_strategy saved", data.get("custom_teleop_strategy") == json.dumps(["mid take", "corner park"]))
        report("custom_robot_name saved", data.get("custom_robot_name") == "Testinator")
        report("custom_pronunciation saved", data.get("custom_pronunciation") == "test-bot")
        report("custom_number_display saved", data.get("custom_number_display") == "99-999")
        report("custom_location saved", data.get("custom_location") == "Houston, TX")
        report("custom_organization saved", data.get("custom_organization") == "Test Academy")
        report("custom_top_sponsors saved", data.get("custom_top_sponsors") == "Sponsor1, Sponsor2")
        report("custom_motto saved", data.get("custom_motto") == "Test all the things")
        report("author_name saved", data.get("author_name") == "Test Caster")
        report("author_event_key saved", data.get("author_event_key") == "2026test")
        report("is_deleted is False", data.get("is_deleted") == False)

        # ════════════════════════════════════════════════════
        # 3. GET — verify data persists
        # ════════════════════════════════════════════════════
        print("\n📖 Test 3: GET after create")
        r = await c.get(f"/teams/{TEST_TEAM}/tims-overrides")
        data = r.json()
        report("GET returns full data", data.get("custom_nickname") == "Test Bot")
        report("Hardware persists", data.get("custom_hardware") == json.dumps(["turret", "swerve"]))
        report("Strategy persists", data.get("custom_auto_strategy") == json.dumps(["center rush"]))

        # ════════════════════════════════════════════════════
        # 4. PUT — partial update (merge test)
        # ════════════════════════════════════════════════════
        print("\n🔀 Test 4: PUT partial update (only nickname + hardware)")
        partial = {
            "author_device_id": DEVICE_ID,
            "author_name": "Another Caster",
            "author_event_key": "2026test2",
            "custom_nickname": "Updated Bot",
            "custom_hardware": json.dumps(["turret", "swerve", "flywheel"]),
        }
        r = await c.put(f"/teams/{TEST_TEAM}/tims-overrides", json=partial)
        data = r.json()
        report("Nickname updated", data.get("custom_nickname") == "Updated Bot")
        report("Hardware updated", data.get("custom_hardware") == json.dumps(["turret", "swerve", "flywheel"]))
        report("Robot name preserved (not sent)", data.get("custom_robot_name") == "Testinator",
               f"got {data.get('custom_robot_name')}")
        report("Strategy preserved (not sent)", data.get("custom_auto_strategy") == json.dumps(["center rush"]),
               f"got {data.get('custom_auto_strategy')}")
        report("Location preserved (not sent)", data.get("custom_location") == "Houston, TX",
               f"got {data.get('custom_location')}")
        report("Author name updated", data.get("author_name") == "Another Caster")
        report("Author event updated", data.get("author_event_key") == "2026test2")

        # ════════════════════════════════════════════════════
        # 5. History — verify audit trail
        # ════════════════════════════════════════════════════
        print("\n📜 Test 5: History / audit trail")
        r = await c.get(f"/teams/{TEST_TEAM}/tims-overrides/history")
        history = r.json()
        report("History has 2+ entries", len(history) >= 2, f"got {len(history)}")
        if history:
            latest = history[0]
            report("Latest has author_name", latest.get("author_name") == "Another Caster")
            report("Latest has author_event_key", latest.get("author_event_key") == "2026test2")
            report("Latest has snapshot dict", isinstance(latest.get("snapshot"), dict))
            report("Snapshot has hardware", "custom_hardware" in (latest.get("snapshot") or {}))
            report("Latest has created_at", "created_at" in latest)

        # ════════════════════════════════════════════════════
        # 6. PUT with null — clear a field
        # ════════════════════════════════════════════════════
        print("\n🧹 Test 6: PUT with null to clear a field")
        clear = {
            "author_device_id": DEVICE_ID,
            "custom_motto": None,
        }
        r = await c.put(f"/teams/{TEST_TEAM}/tims-overrides", json=clear)
        data = r.json()
        report("Motto cleared", data.get("custom_motto") is None, f"got {data.get('custom_motto')}")
        report("Nickname still present", data.get("custom_nickname") == "Updated Bot")

        # ════════════════════════════════════════════════════
        # 7. DELETE — reset to defaults
        # ════════════════════════════════════════════════════
        print("\n🗑️  Test 7: DELETE (reset to FIRST defaults)")
        r = await c.delete(f"/teams/{TEST_TEAM}/tims-overrides")
        report("DELETE returns 200", r.status_code == 200, f"got {r.status_code}")

        # GET should now return empty
        r = await c.get(f"/teams/{TEST_TEAM}/tims-overrides")
        report("GET after DELETE returns empty", r.json() == {} or r.json() == [])

        # ════════════════════════════════════════════════════
        # 8. History survives delete
        # ════════════════════════════════════════════════════
        print("\n📜 Test 8: History preserved after DELETE")
        r = await c.get(f"/teams/{TEST_TEAM}/tims-overrides/history")
        history = r.json()
        report("History still has entries", len(history) >= 2, f"got {len(history)}")

        # ════════════════════════════════════════════════════
        # 9. PUT after DELETE — re-create
        # ════════════════════════════════════════════════════
        print("\n♻️  Test 9: PUT after DELETE (re-create)")
        recreate = {
            "author_device_id": DEVICE_ID,
            "author_name": "Restored Caster",
            "custom_nickname": "Phoenix Bot",
            "custom_hardware": json.dumps(["arm"]),
        }
        r = await c.put(f"/teams/{TEST_TEAM}/tims-overrides", json=recreate)
        data = r.json()
        report("Re-create succeeds", r.status_code == 200)
        report("New nickname set", data.get("custom_nickname") == "Phoenix Bot")
        report("Old data gone (robot_name)", data.get("custom_robot_name") is None,
               f"got {data.get('custom_robot_name')}")

        # ════════════════════════════════════════════════════
        # Final cleanup
        # ════════════════════════════════════════════════════
        await c.delete(f"/teams/{TEST_TEAM}/tims-overrides")

    # ── Results ──────────────────────────────────────────
    print(f"\n{'='*50}")
    print(f"Results: {PASS} passed, {FAIL} failed out of {PASS + FAIL}")
    print(f"{'='*50}")
    return FAIL == 0


if __name__ == "__main__":
    ok = asyncio.run(main())
    sys.exit(0 if ok else 1)
