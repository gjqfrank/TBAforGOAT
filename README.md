# Caster's Tool v2.0

A real-time companion app for **FIRST Robotics Competition (FRC)** and **FIRST Tech Challenge (FTC)** broadcasters, commentators, and the FIRST community. Surfaces team stats, alliance breakdowns, playoff brackets, play-by-play data, AI-generated broadcast storylines, live caster notes, and historical context — all at a glance.

Built by **Gürsel & [Team 9020](https://www.thebluealliance.com/team/9020)** for the community.

---

## What's New in v2.0

v2.0 is a ground-up architectural rebuild. The app moves from a polling-only REST cache to an **offline-first Supabase backbone** with background workers, Realtime WebSocket push, and persistent caster collaboration tools.

### Architecture

| Component | v1.x | v2.0 |
|-----------|------|------|
| **Data layer** | In-memory TTL caches _(lost on restart)_ | Supabase Postgres _(persistent, 14 tables)_ |
| **Data freshness** | Client polls backend on tab switch | Background workers sync every 5s/120s + Realtime WebSocket push |
| **Concurrency** | Single-threaded request handlers | Serialized merge lock + deadlock retry (3× exponential backoff) |
| **Fault tolerance** | None — 5xx = blank data | Circuit breaker (3-strike, 30s cooldown) on every external call |
| **Auth** | None | Email OTP via Supabase GoTrue, account request flow |
| **Caster notes** | None | Persistent notes per event, synced via Realtime |
| **TIMS overrides** | None | Context-menu editor for team metadata (tags, robot names, playstyle) |
| **Battle Station** | None | Live broadcast note timeline with macro deck |
| **AI Storylines** | In-memory only | Cached in Supabase `storyline_cache`, deduped inflight |
| **FTC support** | Basic | Full workers, season awards, team avatars |
| **Frontend cache** | IndexedDB only | IndexedDB + delta-sync from Supabase (`POST /api/sync`) |
| **Security** | Open | Row-Level Security (RLS), trusted API keys, input validation |

### New Features

- **Supabase-backed persistence** — 14-table schema with delta-sync triggers, JSONB merge functions, and partial indexes
- **Background workers** — `event_sync` (120s) and `match_poller` (5s) for FRC; mirrored `ftc_event_sync` and `ftc_match_poller` for FTC
- **Realtime WebSocket** — `event_teams` and `matches` push updates to the frontend via `postgres_changes` (no polling)
- **Circuit breaker** — 3-strike threshold with 30s cooldown on TBA, FRC Events, Statbotics, and Supabase clients
- **Deadlock prevention** — `asyncio.Lock` serializes `merge_event_teams_batch`; `_retry_on_deadlock` handles Postgres 40P01 with exponential backoff
- **Email OTP login** — Magic-link + OTP-first auth via Supabase GoTrue, glassmorphic account popover
- **Account requests** — Self-service request form with auto-populated display names
- **TIMS Override Editor** — Context menu + tabbed modal for robot names, tags, playstyle, hardware notes (with history tracking)
- **Caster Notes** — Persistent per-event notes with CRUD, Supabase Realtime sync
- **Battle Station** — Top-level tab with spine timeline, pill navigation, macro deck, alliance-colored bubbles, and mobile responsive layout
- **Global Notes Panel** — Floating glassmorphic panel with search, team auto-complete, and categorized tabs
- **AI Storyline caching** — Supabase `storyline_cache` table with event-aware invalidation and inflight deduplication
- **Row-Level Security** — Migration 13 locks down all tables with RLS policies
- **FTC improvements** — Full worker sync, season awards, team avatars (parsed from FIRST CSS), proper FTC mode styling
- **Score Breakdown 2026** — Full REBUILT game support with per-robot spotlight and match history
- **Regional Advancement Pool** — v3.2 FIRST FRC Events API integration for official Championship qualification data
- **Pre-computed region stats** — `region_stats.json` covering 1992–2026 (HoF, Einstein, Impact, international visitors)
- **World record footer** — Season high score display
- **Team comparison** — Up to 6-team EPA breakdown comparison
- **Collapsible sections** — Show/Hide toggle pills on all Summary and Events panels
- **Dark/light theme** — Full theme support across all components including FTC mode
- **Mobile responsive** — All tabs, panels, and Battle Station adapt to small screens

### Bug Fixes (v2.0)

- Fixed 8 FTC/production bugs (avatar routes, alliance upsert null, stale summary)
- Fixed FTC mode CSS leaking into tabs, context menus, compare buttons, and notes panel
- Fixed regional pool showing stale 2025 year when switching FTC → FRC
- Fixed mobile pill overflow for long event names
- Fixed spotlight match history clipping at 14+ matches
- Added null-state guards across 6 crash-prone code paths (prevents white-screen on missing data)
- Deadlock-free concurrent worker syncs (validated with 4-event stress test)

---

## Features

| Tab | Description |
|-----|-------------|
| **Events** | Season event picker with region/week filters, search, manual entry, and saved events |
| **History** | Full event lineage: past winners, finalists, awards timeline back to 1992. Region facts and district stats |
| **Rankings** | Live rankings with record, OPR, and Statbotics EPA. Top 8 highlighted. Real-time updates via WebSocket |
| **Summary** | Event demographics, HoF teams, Impact finalists, connections graph, top scorers, advancement panel |
| **Play by Play** | Match-by-match view with per-team stats, Statbotics delta, streak badges, inline comparison, connections |
| **Breakdown** | Detailed score breakdowns per match with per-robot spotlight (supports 2025 REEFSCAPE + 2026 REBUILT) |
| **Alliances** | Alliance selection cards with first-time-partner detection and partnership history |
| **Playoffs** | Double-elimination bracket visualization (2023+ format) with live scores |
| **Team Lookup** | Full team profile: awards, banners, HoF status, season achievements, head-to-head history |
| **AI Storylines** | LLM-powered broadcast narratives from award history, travel, trajectory, and team dossiers |
| **Battle Station** | Live broadcast note timeline with macro deck, alliance-colored bubbles, and pill navigation |
| **FTC Mode** | Full FTC support: events, teams, matches, alliances, season awards, and team lookup |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Frontend (SPA)                                              │
│  docs/index.html + 10 JS modules (~14k lines)               │
│  IndexedDB cache · Supabase Realtime WebSocket               │
│  Auth (OTP) · TIMS Editor · Battle Station · Global Notes    │
└───────────────────┬───────────────────┬──────────────────────┘
                    │ REST / JSON       │ WebSocket (postgres_changes)
┌───────────────────▼───────────────────▼──────────────────────┐
│  Backend (FastAPI + Uvicorn)                                 │
│  Async throughout — httpx + asyncio.gather                   │
│  Delta-sync endpoint (POST /api/sync)                        │
│  Payload cache · In-memory TTL · Disk snapshots              │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐     │
│  │  Background Workers (asyncio tasks in lifespan)     │     │
│  │  event_sync (120s) · match_poller (5s)              │     │
│  │  ftc_event_sync · ftc_match_poller                  │     │
│  │  Serialized merges · Circuit breaker · Retry logic  │     │
│  └─────────────────────────────────────────────────────┘     │
└──┬──────────┬──────────┬──────────┬──────────┬───────────────┘
   │          │          │          │          │
┌──▼───┐  ┌──▼──────┐ ┌─▼──────┐ ┌─▼──────┐ ┌─▼──────────────┐
│ TBA  │  │FRC Evts │ │Statbot │ │FTC Evts│ │ Supabase       │
│ API  │  │API v3.2 │ │ics    │ │API     │ │ Postgres + Auth│
└──────┘  └─────────┘ └────────┘ └────────┘ └────────────────┘
                                               │
                                    ┌──────────▼──────────┐
                                    │  Anthropic Claude   │
                                    │  (AI Storylines)    │
                                    └─────────────────────┘
```

### Data Pipeline

```
External APIs ──→ Background Workers ──→ Supabase Postgres
                      │                       │
                      │ merge_event_teams      │ Realtime
                      │ (serialized + retry)   │ (WebSocket push)
                      │                       │
                      └── Circuit Breaker ──→ Frontend SPA
                          (3-strike, 30s)     (IndexedDB + live UI)
```

### Supabase Schema (14 tables)

| Table | Purpose |
|-------|---------|
| `events` | Event metadata (name, dates, status, region, raw_data) |
| `teams` | Team profiles (number, nickname, competition_type) |
| `event_teams` | Junction table with JSONB `raw_data` (OPR, EPA, rank, record) |
| `matches` | Match results with alliances and scores |
| `team_avatars` | Base64-encoded team avatars by year |
| `season_records` | Per-season team records and stats |
| `event_summary_cache` | Cached event summaries (demographics, awards) |
| `regional_pool` | Championship qualification rankings |
| `tims_overrides` | TIMS editor overrides (robot names, tags, playstyle) |
| `tims_overrides_history` | Audit trail for TIMS changes |
| `caster_notes` | Persistent per-event caster notes |
| `notes` | Legacy notes table |
| `storyline_cache` | AI storyline cache with event-aware invalidation |
| `account_requests` | User account request queue |

### Resilience Architecture

| Layer | Mechanism | Details |
|-------|-----------|---------|
| **Merge serialization** | `asyncio.Lock` | Prevents concurrent `merge_event_teams_batch` calls from deadlocking |
| **Deadlock retry** | Exponential backoff | 3 attempts, 200ms base, detects Postgres 40P01 |
| **Circuit breaker** | 3-strike threshold | 30s cooldown after 3 consecutive 5xx errors per service |
| **Realtime reconnect** | Auto-resubscribe | Detects CHANNEL_ERROR/TIMED_OUT, fires reconciliation callbacks |
| **Delta sync** | `POST /api/sync` | LWW merge with `updated_at` timestamps for offline-to-online sync |

### Caching Strategy

| Layer | Mechanism | TTL |
|-------|-----------|-----|
| Backend — TBA responses | In-memory dict | 300s |
| Backend — FRC API responses | In-memory dict | 120s |
| Backend — AI Storylines | Supabase `storyline_cache` | 7200s |
| Backend — Event snapshots | JSON on disk (`data/saved_events/`) | Permanent |
| Backend — Payload cache | In-memory per-endpoint | 60s |
| Frontend — Full event data | IndexedDB (`casters-tool-cache`) | Session-persistent |
| Frontend — Delta sync | `updated_at` watermarks | Incremental |

---

## Data Sources

- **[The Blue Alliance (TBA)](https://www.thebluealliance.com)** — Event lists, team info, rankings, OPRs, matches, alliances, awards, media
- **[FIRST FRC Events API (v3.0 + v3.2)](https://frc-events.firstinspires.org/services/API)** — Score breakdowns, per-robot performance, school names, avatars, regional advancement pool
- **[FIRST FTC Events API](https://ftc-events.firstinspires.org/services/API)** — FTC events, teams, matches, alliances, awards
- **[Statbotics](https://www.statbotics.io)** — EPA ratings and match win predictions
- **[FTCScout](https://api.ftcscout.org)** — FTC OPR data and team statistics
- **[GATool](https://gatool.org)** — Community-sourced team updates and sponsor data
- **[Anthropic Claude](https://www.anthropic.com)** — AI-powered broadcast storyline generation (optional)

---

## Prerequisites

- **Python 3.10+**
- A **[TBA API key](https://www.thebluealliance.com/account)** (required)
- A **[Supabase](https://supabase.com) project** with service-role key (required for v2.0)
- A **FIRST FRC Events API token** (optional — enables score breakdowns, per-robot stats)
- A **FIRST FTC Events API token** (optional — enables FTC data)
- An **[Anthropic API key](https://console.anthropic.com/)** (optional — enables AI storylines)

---

## Setup

### 1. Clone & install

```bash
git clone https://github.com/kleium/casters-tool.git
cd casters-tool
pip install -r requirements.txt
```

### 2. Configure environment

Create a `.env` file in the project root:

```env
TBA_API_KEY=your_tba_api_key
FRC_EVENTS_API_TOKEN=your_base64_token
FTC_EVENTS_API_TOKEN=your_base64_token
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key
ANTHROPIC_API_KEY=your_anthropic_key
TRUSTED_API_KEYS=your_api_key_for_sync
```

| Variable | Required | Description |
|----------|----------|-------------|
| `TBA_API_KEY` | **Yes** | The Blue Alliance read API key |
| `SUPABASE_URL` | **Yes** | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | **Yes** | Supabase service-role key (bypasses RLS) |
| `FRC_EVENTS_API_TOKEN` | No | Base64 `username:authkey` for FIRST FRC Events API |
| `FTC_EVENTS_API_TOKEN` | No | Base64 `username:authkey` for FIRST FTC Events API |
| `ANTHROPIC_API_KEY` | No | Anthropic API key for AI storylines |
| `TRUSTED_API_KEYS` | No | Comma-separated keys for authenticated sync endpoints |

### 3. Run migrations

Apply the Supabase schema (14 migrations):

```bash
supabase db push
```

Or apply manually via the Supabase SQL editor — migrations are in `supabase/migrations/`.

### 4. Start the server

```bash
python run.py
```

The app starts at **http://localhost:8000** with hot-reload. Background workers begin syncing immediately.

---

## Project Structure

```
casters-tool/
├── run.py                              # Entry point (Uvicorn, port 8000)
├── requirements.txt                    # Python dependencies
├── .env                                # API keys (not committed)
├── package.json                        # Node config (Tailwind CSS build)
├── tailwind.config.js                  # Tailwind configuration
│
├── backend/
│   └── app/
│       ├── main.py                     # FastAPI app, CORS, lifespan workers
│       ├── config.py                   # Environment variable loading
│       ├── routers/
│       │   ├── events.py               # /api/events/* (FRC)
│       │   ├── teams.py                # /api/teams/*
│       │   ├── matches.py              # /api/matches/*
│       │   ├── alliances.py            # /api/alliances/*
│       │   ├── storylines.py           # /api/storylines/*
│       │   ├── sync.py                 # POST /api/sync (delta sync)
│       │   ├── snapshot.py             # Event snapshot management
│       │   ├── ftc_events.py           # /api/ftc/events/*
│       │   ├── ftc_matches.py          # /api/ftc/matches/*
│       │   └── ftc_alliances.py        # /api/ftc/alliances/*
│       ├── services/
│       │   ├── supabase_client.py      # Async Supabase client (merge lock, retry, circuit breaker)
│       │   ├── tba_client.py           # TBA API client
│       │   ├── frc_client.py           # FIRST FRC Events API client
│       │   ├── ftc_client.py           # FIRST FTC Events API client
│       │   ├── statbotics_client.py    # Statbotics API client
│       │   ├── ftcscout_client.py      # FTCScout API client
│       │   ├── gatool_client.py        # GATool API client
│       │   ├── circuit_breaker.py      # Generic circuit breaker
│       │   ├── event_service.py        # Event listing, info, team stats
│       │   ├── team_service.py         # Team profiles, achievements, H2H
│       │   ├── alliance_service.py     # Alliance stats, partnership history
│       │   ├── summary_service.py      # Demographics, connections, top scorers
│       │   ├── storyline_service.py    # AI dossier + LLM generation
│       │   ├── region_service.py       # Region facts, event lineage
│       │   ├── cache_service.py        # Disk snapshot persistence
│       │   ├── payload_cache.py        # In-memory endpoint cache
│       │   ├── ingestion_service.py    # Data ingestion helpers
│       │   ├── avatar_cache.py         # Team avatar management
│       │   ├── world_record_service.py # Season high score tracking
│       │   ├── inflight.py             # Inflight deduplication
│       │   └── error_utils.py          # Error formatting utilities
│       └── workers/
│           ├── event_sync.py           # FRC event sync (120s loop)
│           ├── match_poller.py         # FRC match poller (5s loop)
│           ├── ftc_event_sync.py       # FTC event sync
│           ├── ftc_match_poller.py     # FTC match poller
│           └── schemas.py              # Pydantic validation models
│
├── docs/                               # Frontend (served as static files)
│   ├── index.html                      # SPA shell
│   ├── about.html                      # About / Guide page
│   ├── css/
│   │   ├── tailwind.css                # Compiled Tailwind output
│   │   ├── input.css                   # Tailwind source
│   │   └── styles.css                  # Legacy stylesheet
│   ├── js/
│   │   ├── app.js                      # Main UI controller (~11k lines)
│   │   ├── api.js                      # FRC API wrapper
│   │   ├── ftc-api.js                  # FTC API wrapper
│   │   ├── db.js                       # IndexedDB client
│   │   ├── sync.js                     # Delta-sync client
│   │   ├── realtime.js                 # Supabase Realtime manager
│   │   ├── auth.js                     # OTP auth module
│   │   ├── editor.js                   # TIMS Override Editor
│   │   ├── global_notes.js             # Global Notes Panel
│   │   ├── notes_service.js            # Caster Notes CRUD
│   │   └── battle_station.js           # Battle Station timeline
│   └── data/
│       ├── region_stats.json           # Pre-computed region stats (1992–2026)
│       └── season_2026.json            # Cached season event list
│
├── data/saved_events/                  # Disk-persisted event snapshots
│
├── scripts/
│   ├── generate_region_stats.py        # Rebuild region_stats.json
│   ├── generate_ftc_season.py          # Generate FTC season data
│   ├── stress_test_workers.py          # Worker concurrency stress test
│   ├── test_realtime_flow.py           # Realtime data flow validation
│   ├── benchmark_event_flow.py         # Full caster flow benchmark
│   ├── benchmark_production.py         # Production load test
│   └── build_input_css.py              # CSS build helper
│
└── supabase/
    └── migrations/                     # 14 SQL migrations (00–13)
        ├── 00_initial_schema.sql       # Core tables (events, teams, event_teams, matches)
        ├── 05_merge_raw_data.sql       # merge_event_teams_batch Postgres function
        ├── 12_realtime_event_teams_matches.sql  # Realtime publication + REPLICA IDENTITY
        └── 13_rls_production.sql       # Row-Level Security policies
```

---

## API Reference

All endpoints return JSON. The backend serves both the API and the static frontend.

### Core Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/status` | API connectivity (TBA, FRC, FTC, Supabase) |
| `POST` | `/api/sync` | Delta sync — send `updated_at` watermarks, receive changed rows |

### Events — `/api/events`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/season/{year}` | List events for a season |
| `GET` | `/{event_key}/info` | Event metadata |
| `GET` | `/{event_key}/teams` | Teams with rank, record, OPR, EPA, avatar |
| `GET` | `/{event_key}/summary` | Demographics, HoF, Impact, top scorers |
| `GET` | `/{event_key}/summary/connections` | Prior playoff connections |
| `GET` | `/{event_key}/compare` | Compare 2–6 teams |
| `GET` | `/{event_key}/history` | Full event history with awards timeline |

### Teams — `/api/teams`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/{team_number}/stats` | Full team profile |
| `GET` | `/head-to-head/{a}/{b}` | Playoff head-to-head |

### Matches — `/api/matches`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/{event_key}/all` | All matches with per-team stats |
| `GET` | `/{event_key}/scores` | Lightweight score-only fetch |
| `GET` | `/{event_key}/playoffs` | Playoff matches with bracket mapping |
| `GET` | `/match/{match_key}/breakdown` | Score breakdown for a single match |
| `GET` | `/team-perf/{event_key}/{team}` | Per-match robot performance |

### FTC — `/api/ftc`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/events/season/{year}` | FTC events for a season |
| `GET` | `/events/{event_key}/teams` | FTC teams at event |
| `GET` | `/matches/{event_key}/all` | FTC matches |
| `GET` | `/alliances/{event_key}` | FTC alliances |

### Storylines — `/api/storylines`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/status` | Check if AI is available |
| `POST` | `/generate` | Generate broadcast-ready storyline |

---

## Development

Hot-reload is enabled — backend changes restart automatically, frontend changes are picked up on refresh.

### Build CSS

```bash
npx tailwindcss -i docs/css/input.css -o docs/css/tailwind.css --watch
```

### Run benchmarks

```bash
python scripts/benchmark_event_flow.py    # Full caster flow
python scripts/stress_test_workers.py     # Worker concurrency
python scripts/test_realtime_flow.py      # Realtime pipeline
```

### Key design decisions

- **Fully async**: All API calls use `httpx.AsyncClient` with `asyncio.gather` for parallel fetching
- **Offline-first**: Supabase as persistent store, IndexedDB for client cache, delta-sync for reconnection
- **Game-year aware**: Score breakdown parsing detects the season and applies correct field mappings
- **Serialized merges**: `asyncio.Lock` prevents deadlocks when workers merge overlapping team data concurrently
- **Circuit breakers**: Every external API client has a circuit breaker to prevent cascading failures
- **RLS by default**: All Supabase tables have Row-Level Security policies (migration 13)

---

## License

This project is intended for use by the FIRST Robotics Competition community.
