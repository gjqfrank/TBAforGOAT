# iOS Client — Supabase Data Contract
## Nexus Live Event Status

This document describes the two Supabase tables the iOS client needs to read for
the live broadcast dashboard. All data is maintained entirely by the backend —
no calls to Nexus or any external API are needed from the client.

---

## 1. Realtime Subscription — `live_event_status`

This is the primary live table. The backend polls Nexus every 60 seconds and
upserts one row per active event. Subscribe to it via Supabase Realtime to
receive updates over WebSocket the instant a match changes.

**Supabase project URL:** `https://qytovurlcjrpvlbmkyip.supabase.co`  
**Auth:** anonymous (RLS allows public read; no JWT needed for SELECT)

### Schema

| Column | Type | Description |
|---|---|---|
| `event_key` | `text` (PK) | FRC event key, e.g. `"2026cmptx"` |
| `current_match_name` | `text` | Human label of the match currently on the field: `"Qualification 1"`, `"Playoff 5"`, `"Final 1"`. `null` if no match is active. |
| `red_alliance` | `integer[]` | Team numbers on the red alliance, station order. `null` if undecided (early playoff rounds). |
| `blue_alliance` | `integer[]` | Team numbers on the blue alliance, station order. `null` if undecided. |
| `schedule_offset_mins` | `integer` | How far the event is running from its published schedule. **Negative = behind, positive = ahead.** Use this to adjust all `scheduled_time` values from the `matches` table into live estimates. |
| `pit_locations` | `jsonb` | Map of team number string → pit address string. `{}` when Nexus has no pit data for the event. See §3. |
| `updated_at` | `timestamptz` | UTC timestamp of the last backend poll. Use this to detect stale data. |

### Example row (live)

```json
{
  "event_key": "2026cmptx",
  "current_match_name": "Qualification 24",
  "red_alliance": [254, 1678, 971],
  "blue_alliance": [148, 2056, 3538],
  "schedule_offset_mins": -3,
  "pit_locations": {
    "254":  "A1",
    "1678": "A2",
    "971":  "B7"
  },
  "updated_at": "2026-04-30T14:22:05.000Z"
}
```

### Realtime channel pattern

Subscribe to the single row for your event key using a filtered channel:

```
channel: postgres_changes
schema: public
table: live_event_status
filter: event_key=eq.2026cmptx
event: UPDATE
```

On each UPDATE payload, the full new row is delivered (the table uses
`REPLICA IDENTITY FULL`), so no follow-up REST fetch is required.

---

## 2. Current Match

`current_match_name` is the match **physically on the field right now**.

- During qualifications it looks like `"Qualification 24"` (or `"Qualification 24 Replay"`).
- During playoffs it looks like `"Playoff 5"` or `"Final 1"`.
- `null` means the event is between matches or not yet started.

The `red_alliance` / `blue_alliance` integer arrays match this match.
Team keys in the `matches` table use the `"frc1234"` prefix format; strip
`"frc"` to compare against these integers.

---

## 3. Next Match — Scheduled Time

The `matches` table holds the full schedule for every event, sourced from
The Blue Alliance. Query it to find a team's next unplayed match and its
scheduled start time, then apply `schedule_offset_mins` to get the live estimate.

### Relevant columns

| Column | Type | Notes |
|---|---|---|
| `match_key` | `text` (PK) | e.g. `"2026cmptx_qm25"` |
| `event_key` | `text` | Foreign key to `events` |
| `comp_level` | `text` | `"qm"` / `"sf"` / `"f"` |
| `match_number` | `integer` | Match number within comp level |
| `status` | `text` | `"upcoming"` / `"completed"` |
| `scheduled_time` | `timestamptz` | Published schedule time (UTC) |
| `alliances` | `jsonb` | See shape below |

### `alliances` JSONB shape

```json
{
  "red":  { "team_keys": ["frc254", "frc1678", "frc971"],  "score": null },
  "blue": { "team_keys": ["frc148", "frc2056", "frc3538"], "score": null }
}
```

`score` is `null` before the match is played.

### Computing the live estimate

```
estimated_start = scheduled_time + schedule_offset_mins (as minutes)
```

A value of `-3` means the event is 3 minutes behind schedule; show
`scheduled_time - 3 minutes` as the estimated queue/start time.

### Suggested query pattern

To find team 254's next match at event `2026cmptx`:

1. Query `matches` where `event_key = '2026cmptx'` AND `status = 'upcoming'`
   AND `alliances->>'red'` contains `'frc254'` OR `alliances->>'blue'` contains `'frc254'`
2. Order by `scheduled_time ASC`, take the first row.
3. Read `schedule_offset_mins` from `live_event_status` (already in memory
   from the Realtime subscription) and add it to `scheduled_time`.

---

## 4. Pit Locations

`pit_locations` is a flat JSON object. Keys are team number **strings**,
values are pit address strings (arbitrary — set by the event's Nexus admin).

```json
{
  "254":  "A1",
  "1678": "A2",
  "4911": "C12"
}
```

- An empty object `{}` means Nexus has no pit data configured for this event.
- Addresses are free-form (e.g. `"A1"`, `"Row B, Pit 12"`). Do not parse them.
- This map is refreshed with the rest of the row every 60 seconds.

To look up a team: `pit_locations[String(teamNumber)]`

---

## 5. Data Freshness & Staleness Detection

- The backend polls every **60 seconds**. Maximum data age is ~60 s under normal conditions.
- Check `updated_at` — if it is more than **5 minutes** in the past, treat the
  data as stale and show a degraded-mode indicator in the UI.
- When `current_match_name` is `null` and `updated_at` is recent, the event
  is genuinely between matches (not a backend failure).

---

## 6. No-Event State

When no event is active (off-season, between events), the table will simply
have no row for the requested `event_key`. Handle a `null` / missing row
gracefully — show an "Event not live" empty state.
