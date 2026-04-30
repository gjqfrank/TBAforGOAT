/**
 * sync-nexus-live — Supabase Edge Function
 *
 * Called by pg_cron every 60 seconds via net.http_post.
 *
 * Responsibilities:
 *  1. Verify the shared `X-Cron-Secret` header so only pg_cron can trigger it.
 *  2. Discover currently-active FRC events from the Supabase `events` table,
 *     OR use an explicit `eventKeys` override from the POST body.
 *  3. For each active event:
 *     a. GET https://frc.nexus/api/v1/event/{eventKey}  → live match status
 *     b. GET https://frc.nexus/api/v1/event/{eventKey}/pits → pit locations
 *  4. Parse the responses and upsert `live_event_status`.
 *
 * Environment variables (set via `supabase secrets set`):
 *   CRON_SECRET          — shared secret matched against X-Cron-Secret header
 *   NEXUS_API_KEY        — API key sent to frc.nexus as Nexus-Api-Key header
 *   SUPABASE_URL         — injected automatically by the runtime
 *   SUPABASE_SERVICE_ROLE_KEY — injected automatically by the runtime
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Constants ──────────────────────────────────────────────────────────

const NEXUS_BASE = "https://frc.nexus/api/v1";

/** Nexus match statuses in rough pipeline order. */
const NEXUS_FIELD_STATUSES = new Set([
  "On field",
  "On deck",
  "Now queuing",
  "Queuing soon",
]);

// ── Types from the FRC Nexus OpenAPI spec ──────────────────────────────

interface NexusMatchTimes {
  /** Unix ms — when match was originally scheduled. */
  scheduledStartTime?: number | null;
  /** Unix ms — dynamically-computed estimated start. */
  estimatedStartTime?: number | null;
  /** Unix ms — estimated time for teams to queue. */
  estimatedQueueTime?: number | null;
  /** Unix ms — actual start time once the match has begun. */
  actualStartTime?: number | null;
  // Additional time fields exist in the spec; only the above are consumed.
  [key: string]: unknown;
}

interface NexusMatch {
  /** Human-friendly label, e.g. "Qualification 24", "Playoff 5". */
  label: string;
  /**
   * Queuing pipeline status.
   * Progression: "Queuing soon" → "Now queuing" → "On deck" → "On field"
   * Any transition is possible; some events skip states.
   */
  status: string;
  /** Team numbers (as strings) in station order, or null for undecided alliances. */
  redTeams: (string | null)[] | null;
  blueTeams: (string | null)[] | null;
  times: NexusMatchTimes;
}

interface NexusEventStatus {
  eventKey: string;
  dataAsOfTime: number;
  /** Label of the match currently being queued, if any. */
  nowQueuing?: string | null;
  matches: NexusMatch[];
}

/** /event/{key}/pits — team number string → pit address string */
type NexusPitAddresses = Record<string, string>;

// ── FRC Events API types (fallback for events not in Nexus) ───────────

const FRC_API_BASE = "https://frc-api.firstinspires.org/v3.0";

interface FRCMatchTeam {
  teamNumber: number;
  /** Station string: "Red1" | "Red2" | "Red3" | "Blue1" | "Blue2" | "Blue3" */
  station: string;
}

interface FRCMatch {
  matchNumber: number;
  /** Human-friendly label, e.g. "Qualification 24". Present when returned
   *  by the schedule endpoint; may be absent from match-results responses. */
  description?: string;
  tournamentLevel: string; // "Qualification" | "Playoff"
  /** ISO-8601 scheduled start time, null for matches without a set time. */
  startTime: string | null;
  /** ISO-8601 actual start time once the match began; null if not yet played. */
  actualStartTime: string | null;
  /** ISO-8601 time when scores were posted; null = match not yet played. */
  postResultTime: string | null;
  scoreRedFinal: number | null;
  scoreBlueFinal: number | null;
  teams: FRCMatchTeam[];
}

/** Row we write into `live_event_status`. */
interface LiveEventStatusRow {
  event_key: string;
  current_match_name: string | null;
  red_alliance: number[] | null;
  blue_alliance: number[] | null;
  schedule_offset_mins: number;
  pit_locations: Record<string, string>;
  updated_at: string;
}

// ── Security ───────────────────────────────────────────────────────────

/**
 * Constant-time string comparison to prevent timing attacks.
 * Returns true only when both strings are identical.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still iterate so timing is independent of the mismatch position.
    let dummy = 0;
    for (let i = 0; i < a.length; i++) dummy |= a.charCodeAt(i);
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function verifyCronSecret(req: Request): boolean {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret) {
    // Not configured — allow in development, warn loudly.
    console.warn(
      "CRON_SECRET is not set. Caller verification is disabled. " +
        "Set this secret in production via `supabase secrets set CRON_SECRET=...`"
    );
    return true;
  }
  const provided = req.headers.get("X-Cron-Secret") ?? "";
  return constantTimeEqual(provided, secret);
}

// ── Nexus API helpers ──────────────────────────────────────────────────

/**
 * Fetches the live event status from the Nexus API.
 * Throws on network errors; returns null on 404 (event not in Nexus).
 */
async function fetchNexusEventStatus(
  eventKey: string,
  nexusApiKey: string
): Promise<NexusEventStatus | null> {
  const url = `${NEXUS_BASE}/event/${encodeURIComponent(eventKey)}`;
  const res = await fetch(url, {
    headers: { "Nexus-Api-Key": nexusApiKey },
  });

  if (res.status === 404) {
    console.warn(`sync-nexus-live: event "${eventKey}" not found in Nexus (404).`);
    return null;
  }
  if (!res.ok) {
    throw new Error(
      `Nexus API error for event "${eventKey}": ${res.status} ${res.statusText}`
    );
  }
  return (await res.json()) as NexusEventStatus;
}

/**
 * Fetches pit addresses for an event.
 * Returns an empty object on any error rather than failing the whole sync.
 */
async function fetchNexusPitAddresses(
  eventKey: string,
  nexusApiKey: string
): Promise<NexusPitAddresses> {
  const url = `${NEXUS_BASE}/event/${encodeURIComponent(eventKey)}/pits`;
  try {
    const res = await fetch(url, {
      headers: { "Nexus-Api-Key": nexusApiKey },
    });
    if (!res.ok) return {};
    return (await res.json()) as NexusPitAddresses;
  } catch {
    console.warn(`sync-nexus-live: could not fetch pit addresses for "${eventKey}".`);
    return {};
  }
}

// ── Data transformation ────────────────────────────────────────────────

/**
 * Converts a Nexus Teams array (strings | null) to a plain integer array,
 * filtering out any null entries (empty stations in practice matches).
 */
function parseTeams(teams: (string | null)[] | null): number[] | null {
  if (!Array.isArray(teams)) return null;
  const nums = teams
    .filter((t): t is string => t != null && t !== "")
    .map((t) => parseInt(t, 10))
    .filter((n) => !isNaN(n));
  return nums.length > 0 ? nums : null;
}

/**
 * Computes the schedule offset in whole minutes for an event.
 *
 * Strategy: find the first match that is "On field" (or the earliest
 * match not yet completed if nothing is on field), then compare its
 * `estimatedStartTime` against its `scheduledStartTime`.
 *
 * Returns 0 when the data needed for the calculation isn't present.
 *
 * NOTE: The exact field names on `times` are inferred from the Nexus
 * OpenAPI spec and community usage. Verify against your live data and
 * adjust `SCHED_FIELD` / `EST_FIELD` constants below if needed.
 */
function computeScheduleOffset(matches: NexusMatch[]): number {
  // Field names to try for scheduled start time (in preference order).
  const SCHED_FIELDS = ["scheduledStartTime", "scheduledTime"];
  // Field names to try for estimated start time (in preference order).
  const EST_FIELDS = ["estimatedStartTime", "estimatedTime"];

  // Prefer "On field" first, then pipeline order.
  const STATUS_PRIORITY = [
    "On field",
    "On deck",
    "Now queuing",
    "Queuing soon",
  ];

  const safeMatches = Array.isArray(matches) ? matches : [];
  let candidate: NexusMatch | undefined;
  for (const status of STATUS_PRIORITY) {
    candidate = safeMatches.find((m) => m.status === status);
    if (candidate) break;
  }
  if (!candidate) return 0;

  const times = candidate.times ?? {};

  let scheduled: number | null = null;
  for (const f of SCHED_FIELDS) {
    const v = times[f];
    if (typeof v === "number") { scheduled = v; break; }
  }

  let estimated: number | null = null;
  for (const f of EST_FIELDS) {
    const v = times[f];
    if (typeof v === "number") { estimated = v; break; }
  }

  if (scheduled == null || estimated == null) return 0;
  return Math.round((estimated - scheduled) / 60_000);
}

/**
 * Builds the `live_event_status` row from Nexus API responses.
 */
function buildRow(
  eventKey: string,
  status: NexusEventStatus,
  pits: NexusPitAddresses
): LiveEventStatusRow {
  const { nowQueuing } = status;
  // Guard against the API returning null/missing matches (e.g. schedule not
  // yet published, or an unexpected response shape for championship events).
  const matches: NexusMatch[] = Array.isArray(status.matches) ? status.matches : [];

  // Find the match currently on the field. Fall back to the most-advanced
  // pipeline stage available.
  const onField = matches.find((m) => m.status === "On field");
  const mostAdvanced =
    onField ??
    matches.find((m) => m.status === "On deck") ??
    matches.find((m) => m.status === "Now queuing") ??
    matches.find((m) => m.status === "Queuing soon");

  // When no match has a pipeline status yet, Nexus may still report
  // `nowQueuing` at the top level before individual match statuses are
  // updated. Correlate that label to the match object so we can extract
  // alliance data even in that timing gap.
  const nowQueuingMatch = (!mostAdvanced && nowQueuing)
    ? (matches.find((m) => m.label === nowQueuing) ?? null)
    : null;

  const currentMatch = mostAdvanced ?? nowQueuingMatch ?? null;

  // When the full match object is available use its label; otherwise fall
  // back to the top-level `nowQueuing` field which Nexus always provides.
  const currentMatchName =
    currentMatch?.label ?? nowQueuing ?? null;

  const redAlliance = currentMatch ? parseTeams(currentMatch.redTeams) : null;
  const blueAlliance = currentMatch ? parseTeams(currentMatch.blueTeams) : null;

  return {
    event_key: eventKey,
    current_match_name: currentMatchName,
    red_alliance: redAlliance,
    blue_alliance: blueAlliance,
    schedule_offset_mins: computeScheduleOffset(matches),
    pit_locations: pits,
    updated_at: new Date().toISOString(),
  };
}

// ── FRC Events API fallback (for events not managed by Nexus) ─────────

/**
 * Maps TBA 3-letter championship division suffixes to their full FRC API
 * event codes.  These names are stable across seasons (named after famous
 * scientists/engineers).  Unrecognised suffixes fall back to uppercased as-is.
 */
const CHAMPS_DIVISION_MAP: Record<string, string> = {
  arc: "ARCHIMEDES",
  car: "CARSON",
  cur: "CURIE",
  dal: "DALY",
  dar: "DARWIN",
  ein: "EINSTEIN",
  gal: "GALILEO",
  haw: "HAWKING",
  hop: "HOPPER",
  joh: "JOHNSON",
  mil: "MILSTEIN",
  new: "NEWTON",
  tur: "TURING",
};

/**
 * Resolves the FRC Events API event code from a TBA-style event key.
 * Example: "2026joh" → "JOHNSON", "2026arc" → "ARCHIMEDES", "2026wasp" → "WASP"
 */
function resolveFRCEventCode(eventKey: string): string {
  const suffix = eventKey.substring(4).toLowerCase();
  return (CHAMPS_DIVISION_MAP[suffix] ?? suffix).toUpperCase();
}

/**
 * Fetches all matches for an event from the FIRST FRC Events API.
 *
 * Championship division events require explicit tournamentLevel parameters —
 * the bare endpoint returns an empty array. We fetch Qualification and Playoff
 * in parallel and merge them. For regular events, the bare endpoint is enough,
 * so we issue all three requests and deduplicate by matchNumber+level.
 *
 * Returns null if the event cannot be found (404 on all attempts).
 */
async function fetchFRCEventMatches(
  eventKey: string,
  frcApiToken: string
): Promise<FRCMatch[] | null> {
  const year = eventKey.substring(0, 4);
  const eventCode = resolveFRCEventCode(eventKey);
  const base = `${FRC_API_BASE}/${year}/matches/${eventCode}`;
  const headers = {
    "Authorization": `Basic ${frcApiToken}`,
    "Accept": "application/json",
  };
  console.log(`sync-nexus-live: FRC fallback for "${eventKey}" → ${eventCode}`);

  async function fetchLevel(level: string | null): Promise<FRCMatch[]> {
    const url = level ? `${base}?tournamentLevel=${level}` : base;
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.Matches ?? []) as FRCMatch[];
    } catch {
      return [];
    }
  }

  // Fetch bare + Qualification + Playoff in parallel.
  const [bare, quals, playoffs] = await Promise.all([
    fetchLevel(null),
    fetchLevel("Qualification"),
    fetchLevel("Playoff"),
  ]);

  // Merge, preferring explicit-level results over the bare endpoint.
  const merged = new Map<string, FRCMatch>();
  for (const m of [...bare, ...quals, ...playoffs]) {
    const key = `${m.tournamentLevel}:${m.matchNumber}`;
    merged.set(key, m);
  }

  if (merged.size === 0) {
    console.warn(`sync-nexus-live: FRC API returned no matches for "${eventKey}" (code: ${eventCode}).`);
    return null;
  }
  return [...merged.values()];
}

/**
 * Builds a `live_event_status` row from FRC Events API match data.
 *
 * Strategy:
 *  - Sort matches: Qualifications first, then Playoffs, each by matchNumber.
 *  - Find the last match with a posted result (postResultTime ≠ null).
 *  - The next unplayed match becomes "current_match_name" (on-field / up next).
 *  - If all matches are played, report the final match.
 *  - Schedule offset: compare startTime vs actualStartTime of recent played matches.
 */
function buildRowFromFRC(
  eventKey: string,
  matches: FRCMatch[]
): LiveEventStatusRow {
  const levelRank = (t: string) =>
    t.toLowerCase().startsWith("qual") ? 0 : 1;

  const sorted = [...matches].sort((a, b) => {
    const lr = levelRank(a.tournamentLevel) - levelRank(b.tournamentLevel);
    if (lr !== 0) return lr;
    return a.matchNumber - b.matchNumber;
  });

  // Last match whose result has been posted.
  let lastPlayedIdx = -1;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].postResultTime != null || sorted[i].scoreRedFinal != null) {
      lastPlayedIdx = i;
      break;
    }
  }

  // Next unplayed match is the "current" one; fall back to last match if all played.
  const currentIdx =
    lastPlayedIdx + 1 < sorted.length
      ? lastPlayedIdx + 1
      : sorted.length > 0
      ? sorted.length - 1
      : -1;

  const current = currentIdx >= 0 ? sorted[currentIdx] : null;

  let currentMatchName: string | null = null;
  let redAlliance: number[] | null = null;
  let blueAlliance: number[] | null = null;

  if (current) {
    const levelLabel = levelRank(current.tournamentLevel) === 0
      ? "Qualification"
      : "Playoff";
    currentMatchName =
      current.description ?? `${levelLabel} ${current.matchNumber}`;

    const reds = current.teams
      .filter((t) => t.station.startsWith("Red"))
      .sort((a, b) => a.station.localeCompare(b.station))
      .map((t) => t.teamNumber);
    const blues = current.teams
      .filter((t) => t.station.startsWith("Blue"))
      .sort((a, b) => a.station.localeCompare(b.station))
      .map((t) => t.teamNumber);

    redAlliance = reds.length > 0 ? reds : null;
    blueAlliance = blues.length > 0 ? blues : null;
  }

  // Schedule offset: average offset from up to 3 most-recent played matches
  // that have both scheduled and actual start times.
  let scheduleOffsetMins = 0;
  const withTimes = sorted
    .filter((m) => m.startTime && m.actualStartTime && m.postResultTime != null)
    .slice(-3);
  if (withTimes.length > 0) {
    const last = withTimes[withTimes.length - 1];
    const sched = new Date(last.startTime!).getTime();
    const actual = new Date(last.actualStartTime!).getTime();
    if (!isNaN(sched) && !isNaN(actual)) {
      scheduleOffsetMins = Math.round((actual - sched) / 60_000);
    }
  }

  return {
    event_key: eventKey,
    current_match_name: currentMatchName,
    red_alliance: redAlliance,
    blue_alliance: blueAlliance,
    schedule_offset_mins: scheduleOffsetMins,
    pit_locations: {}, // FRC API has no pit-location data
    updated_at: new Date().toISOString(),
  };
}

// ── Event discovery ────────────────────────────────────────────────────

/**
 * Returns a YYYY-MM-DD string offset by `days` from now.
 * Use negative values to go back in time.
 */
function dateOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

/**
 * Queries the Supabase `events` table for FRC events that are currently
 * ongoing:
 *   start_date <= today  AND  end_date >= yesterday
 *
 * The 1-day grace period on end_date ensures that events running late
 * into the evening of their final day are still polled even if UTC midnight
 * has ticked past their listed end_date.
 *
 * @returns Array of event_key strings.
 */
async function discoverActiveEventKeys(
  supabase: ReturnType<typeof createClient>
): Promise<string[]> {
  const today     = dateOffset(0);  // today (UTC)
  const yesterday = dateOffset(-1); // 1-day grace period

  const { data, error } = await supabase
    .from("events")
    .select("event_key")
    .eq("competition_type", "frc")
    .lte("start_date", today)
    .gte("end_date", yesterday);

  if (error) {
    console.error("sync-nexus-live: failed to query active events:", error.message);
    return [];
  }
  return (data ?? []).map((row: { event_key: string }) => row.event_key);
}

/**
 * Filters an explicit list of event keys down to only those that are
 * currently active (same grace-period window as auto-discovery).
 * Returns the valid subset and logs any rejected keys.
 */
async function filterToActiveEventKeys(
  supabase: ReturnType<typeof createClient>,
  requested: string[]
): Promise<string[]> {
  const today     = dateOffset(0);
  const yesterday = dateOffset(-1);

  const { data, error } = await supabase
    .from("events")
    .select("event_key")
    .eq("competition_type", "frc")
    .in("event_key", requested)
    .lte("start_date", today)
    .gte("end_date", yesterday);

  if (error) {
    console.error("sync-nexus-live: failed to validate event keys:", error.message);
    // Fail safe: reject all rather than poll stale events.
    return [];
  }

  const active = new Set((data ?? []).map((r: { event_key: string }) => r.event_key));
  const rejected = requested.filter((k) => !active.has(k));
  if (rejected.length > 0) {
    console.warn(
      `sync-nexus-live: skipping ${rejected.length} inactive/unknown event(s): ${rejected.join(", ")}`
    );
  }
  return [...active];
}

// ── Main handler ───────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  // ── 1. Method guard ─────────────────────────────────────────────────
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed. Use POST." }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  // ── 2. Cron secret verification ─────────────────────────────────────
  if (!verifyCronSecret(req)) {
    console.warn("sync-nexus-live: rejected request — invalid X-Cron-Secret.");
    return new Response(
      JSON.stringify({ error: "Unauthorized." }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  // ── 3. Environment ──────────────────────────────────────────────────
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const nexusApiKey = Deno.env.get("NEXUS_API_KEY");
  // FRC Events API token — used as fallback for events not managed by Nexus
  // (e.g. FRC Championship division events).  Optional: if not set, those
  // events are skipped rather than crashing the function.
  const frcApiToken = Deno.env.get("FRC_EVENTS_API_TOKEN") ?? null;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("sync-nexus-live: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set.");
    return new Response(
      JSON.stringify({ error: "Server misconfiguration." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
  if (!nexusApiKey) {
    console.error("sync-nexus-live: NEXUS_API_KEY is not set.");
    return new Response(
      JSON.stringify({ error: "NEXUS_API_KEY not configured." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // ── 4. Resolve event keys ────────────────────────────────────────────
  //
  //  Priority:
  //    a) Explicit `eventKeys` in POST body → validated against events table
  //       (must be currently active). Pass `force: true` in the body only
  //       to bypass date validation during development/debugging.
  //    b) Auto-discovery from the `events` table (production default).

  let eventKeys: string[] = [];
  let forceOverride = false;
  try {
    const body = await req.json().catch(() => ({}));
    forceOverride = body?.force === true;
    if (Array.isArray(body?.eventKeys) && body.eventKeys.length > 0) {
      const requested: string[] = body.eventKeys.map(
        (k: unknown) => String(k).trim().toLowerCase()
      );
      if (forceOverride) {
        console.warn(
          `sync-nexus-live: force=true — bypassing active-event validation for: ${requested.join(", ")}`
        );
        eventKeys = requested;
      } else {
        eventKeys = await filterToActiveEventKeys(supabase, requested);
        console.log(
          eventKeys.length > 0
            ? `sync-nexus-live: using ${eventKeys.length} validated active event(s): ${eventKeys.join(", ")}`
            : "sync-nexus-live: none of the provided event keys are currently active."
        );
      }
    }
  } catch {
    // body parse failure → fall through to auto-discovery
  }

  if (eventKeys.length === 0 && !forceOverride) {
    eventKeys = await discoverActiveEventKeys(supabase);
    console.log(
      eventKeys.length > 0
        ? `sync-nexus-live: auto-discovered ${eventKeys.length} active event(s): ${eventKeys.join(", ")}`
        : "sync-nexus-live: no active FRC events found in the events table."
    );
  }

  if (eventKeys.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, message: "No active events to sync." }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // ── 5. Fetch from Nexus and upsert (parallel per event) ─────────────
  const results = await Promise.allSettled(
    eventKeys.map(async (eventKey) => {
      // Fetch status and pit addresses in parallel for each event.
      const [statusData, pitData] = await Promise.all([
        fetchNexusEventStatus(eventKey, nexusApiKey),
        fetchNexusPitAddresses(eventKey, nexusApiKey),
      ]);

      if (!statusData) {
        // 404 from Nexus — event isn't managed by Nexus (e.g. championship divisions).
        // Try the FRC Events API as a fallback to still provide match status.
        if (!frcApiToken) {
          console.warn(
            `sync-nexus-live: "${eventKey}" not in Nexus; FRC_EVENTS_API_TOKEN not set — skipping.`
          );
          return { eventKey, skipped: true };
        }

        const frcMatches = await fetchFRCEventMatches(eventKey, frcApiToken);
        if (!frcMatches || frcMatches.length === 0) {
          console.warn(
            `sync-nexus-live: "${eventKey}" not found in FRC API either — skipping.`
          );
          return { eventKey, skipped: true };
        }

        const frcRow = buildRowFromFRC(eventKey, frcMatches);
        const { error: frcDbError } = await supabase
          .from("live_event_status")
          .upsert(frcRow, { onConflict: "event_key", ignoreDuplicates: false });

        if (frcDbError) {
          throw new Error(
            `DB upsert failed for "${eventKey}" (FRC fallback): ${frcDbError.message}`
          );
        }

        console.log(
          `sync-nexus-live: upserted "${eventKey}" via FRC fallback — ` +
            `match: "${frcRow.current_match_name ?? "none"}", offset: ${frcRow.schedule_offset_mins}m`
        );
        return { eventKey, ok: true, source: "frc" };
      }

      const row = buildRow(eventKey, statusData, pitData);

      const { error: dbError } = await supabase
        .from("live_event_status")
        .upsert(row, { onConflict: "event_key", ignoreDuplicates: false });

      if (dbError) {
        throw new Error(`DB upsert failed for "${eventKey}": ${dbError.message}`);
      }

      console.log(
        `sync-nexus-live: upserted "${eventKey}" — match: "${row.current_match_name ?? "none"}", ` +
          `offset: ${row.schedule_offset_mins}m`
      );
      return { eventKey, ok: true };
    })
  );

  // Summarise results for the caller (pg_cron ignores this, but it's
  // visible in the Edge Function logs and useful during manual testing).
  const summary = results.map((r) => {
    if (r.status === "fulfilled") return r.value;
    return { error: r.reason?.message ?? String(r.reason) };
  });

  const anyError = results.some((r) => r.status === "rejected");

  return new Response(JSON.stringify({ ok: !anyError, results: summary }), {
    status: anyError ? 207 : 200,
    headers: { "Content-Type": "application/json" },
  });
});
