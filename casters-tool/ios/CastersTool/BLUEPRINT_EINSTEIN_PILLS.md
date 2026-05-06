# Einstein & First-Einstein Pills — iOS Blueprint

> **Purpose**: When displaying PbP team cards at Championship events (divisions and Einstein Finals), show contextual pedigree pills for teams with Einstein history. This extends the existing "First Playoffs / First Finals" pill system documented in HANDOFF.md §7c.13.

---

## 1. The Three Pills

| Pill | Text | Style | Appears when |
|---|---|---|---|
| **First Einstein** | `"First Einstein"` or `"First Einstein (R)"` | Cyan | Team is on Einstein Finals and this is their first-ever Einstein appearance |
| **Einstein Winner** | `"Einstein Winner"` | Gold/amber | Team has previously won Einstein Finals (any year) |
| **Returning Einstein** | `"Returning Einstein"` | Indigo | Team competed on Einstein last year but has not won it; shown on division events only |

**Priority rule**: Einstein-family pills always take precedence. When any Einstein pill is shown, standard "First Playoffs" / "First Finals" pills are suppressed for that team.

---

## 2. Data Sources

### Source A — `playoff-firsts` endpoint (already fetched)

The existing `GET /api/matches/{event_key}/playoff-firsts` response now includes a `first_einstein` field:

```json
{
  "254": {
    "first_playoff":  false,
    "first_finals":   true,
    "first_einstein": false,
    "rookie":         false
  },
  "9998": {
    "first_playoff":  true,
    "first_finals":   true,
    "first_einstein": true,
    "rookie":         true
  }
}
```

`first_einstein` is `true` only when the event is Einstein Finals (`event_type == 4`) AND the team has never previously appeared on Einstein. This is the **First Einstein** pill source.

### Source B — `summary.einstein_contenders` (already in store)

The event summary (already loaded into `store.summaryAwards`) contains an `einstein_contenders` array for Championship events:

```json
{
  "einstein_contenders": [
    { "team_number": 254,  "nickname": "The Cheesy Poofs", "einstein_winner": true  },
    { "team_number": 1678, "nickname": "Citrus Circuits",  "einstein_winner": false }
  ]
}
```

A team is in this array if:
- They competed on Einstein in the immediately preceding year (`year - 1`), **OR**
- They have ever won Einstein (all-time winners are always included)

`einstein_winner: true` → **Einstein Winner** pill  
`einstein_winner: false` (and on a division event) → **Returning Einstein** pill

---

## 3. Event Type Context

The pills behave differently based on where the match is being shown. Use `allianceData.isEinstein` and `allianceData.isChampionship` flags already available in the store (or derive from `event_type`).

| Context | `isEinstein` | `isChampDiv` | Pills available |
|---|---|---|---|
| Regular event | false | false | None of the three |
| Championship division | false | true | Einstein Winner, Returning Einstein |
| Einstein Finals | true | false | First Einstein, Einstein Winner |

> On Einstein Finals itself, **do not** show "Returning Einstein" — every team there is technically a returning contender, making it meaningless. Only "Einstein Winner" (for past winners) and "First Einstein" (for first-timers) apply.

---

## 4. Updated Swift Models

### 4a. PlayoffFirstData (update existing)

```swift
struct PlayoffFirstData: Codable {
    let firstPlayoff:  Bool
    let firstFinals:   Bool
    let firstEinstein: Bool   // NEW
    let rookie:        Bool

    enum CodingKeys: String, CodingKey {
        case firstPlayoff  = "first_playoff"
        case firstFinals   = "first_finals"
        case firstEinstein = "first_einstein"
        case rookie
    }
}
```

### 4b. EinsteinContender (new — decoded from summaryAwards)

```swift
struct EinsteinContender: Codable {
    let teamNumber:    Int
    let nickname:      String
    let einsteinWinner: Bool

    enum CodingKeys: String, CodingKey {
        case teamNumber    = "team_number"
        case nickname
        case einsteinWinner = "einstein_winner"
    }
}
```

### 4c. SummaryAwards additions (update existing)

```swift
struct SummaryAwards: Codable {
    // ... existing fields ...
    let einsteinContenders: [EinsteinContender]?

    enum CodingKeys: String, CodingKey {
        // ... existing keys ...
        case einsteinContenders = "einstein_contenders"
    }
}
```

---

## 5. BroadcastStore / PbP View Additions

Build an `einsteinContenderMap` once when summary awards load, keyed by `team_number` for O(1) lookup during render:

```swift
// Derived from store.summaryAwards.einsteinContenders
// Computed property or set whenever summaryAwards is updated
var einsteinContenderMap: [Int: EinsteinContender] {
    Dictionary(
        uniqueKeysWithValues: (summaryAwards?.einsteinContenders ?? [])
            .map { ($0.teamNumber, $0) }
    )
}
```

---

## 6. Pill View

```swift
struct PlayoffFirstBadge: View {
    let firsts: PlayoffFirstData?
    let einsteinContender: EinsteinContender?
    let isEinstein: Bool    // true when this is the Einstein Finals event
    let isChampDiv: Bool    // true when this is a CMP division event

    var body: some View {
        HStack(spacing: 4) {
            // ── Einstein family (highest priority) ────────────
            if let ec = einsteinContender, ec.einsteinWinner {
                // Past Einstein winner — show on both division and Einstein Finals
                EinsteinPill(label: "Einstein Winner", style: .winner)
            } else if isEinstein, let f = firsts, f.firstEinstein {
                // First-ever Einstein appearance — Einstein Finals only
                EinsteinPill(
                    label: f.rookie ? "First Einstein (R)" : "First Einstein",
                    style: .firstTimer
                )
            } else if isChampDiv, let ec = einsteinContender, !ec.einsteinWinner {
                // Returning Einstein contender — division events only
                EinsteinPill(label: "Returning Einstein", style: .contender)
            }
            // ── Standard first-time badges (suppressed if any Einstein pill shown) ─
            else if let f = firsts {
                if f.firstFinals {
                    StandardFirstPill(label: "First Finals", color: .purple)
                } else if f.firstPlayoff {
                    StandardFirstPill(
                        label: f.rookie ? "First Playoffs (R)" : "First Playoffs",
                        color: .indigo
                    )
                }
            }
        }
    }
}

enum EinsteinPillStyle {
    case winner       // gold
    case firstTimer   // cyan
    case contender    // indigo
}

struct EinsteinPill: View {
    let label: String
    let style: EinsteinPillStyle

    private var foreground: Color {
        switch style {
        case .winner:    .init(red: 0.96, green: 0.62, blue: 0.04)  // #f59e0b
        case .firstTimer:.init(red: 0.02, green: 0.71, blue: 0.83)  // #06b6d4
        case .contender: .indigo
        }
    }
    private var background: Color {
        switch style {
        case .winner:    .init(red: 0.92, green: 0.70, blue: 0.03).opacity(0.18)
        case .firstTimer:.init(red: 0.02, green: 0.71, blue: 0.83).opacity(0.15)
        case .contender: Color.indigo.opacity(0.15)
        }
    }
    private var border: Color {
        switch style {
        case .winner:    .init(red: 0.92, green: 0.70, blue: 0.03).opacity(0.45)
        case .firstTimer:.init(red: 0.02, green: 0.71, blue: 0.83).opacity(0.40)
        case .contender: Color.indigo.opacity(0.40)
        }
    }

    var body: some View {
        Text(label)
            .font(.caption2.bold())
            .foregroundStyle(foreground)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(background, in: Capsule())
            .overlay(Capsule().strokeBorder(border, lineWidth: 1))
    }
}

struct StandardFirstPill: View {
    let label: String
    let color: Color

    var body: some View {
        Text(label)
            .font(.caption2.bold())
            .foregroundStyle(.white)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(color, in: Capsule())
    }
}
```

---

## 7. Call Site in PbP Team Card

```swift
// Inside the team card view, where PlayoffFirstBadge was already placed:
PlayoffFirstBadge(
    firsts:             playoffFirsts[team.teamNumber],
    einsteinContender:  store.einsteinContenderMap[team.teamNumber],
    isEinstein:         store.currentEventIsEinstein,
    isChampDiv:         store.currentEventIsChampDiv
)
```

The `einsteinContenderMap` is always empty for non-championship events (the backend does not include `einstein_contenders` in non-championship summary payloads), so no guard is needed.

---

## 8. When to Show / Load

| Badge type | Load trigger | Guard |
|---|---|---|
| "First Einstein" / "First Playoffs" / "First Finals" | On first playoff match navigation, call `fetchPlayoffFirsts` (already cached after first call) | `compLevel != "qm"` |
| "Einstein Winner" / "Returning Einstein" | Available immediately from `store.summaryAwards` | `isChampDiv \|\| isEinstein` |

No additional network calls required — both data sources are already fetched by the time a playoff match is displayed.

---

## 9. Where Pills Also Appear (Non-PbP)

| Surface | What to show |
|---|---|
| **Team Lookup** prestige badges row | "⭐ Einstein Winner" badge (static, from `/api/teams/{num}/stats` — `is_einstein_winner: true`) — already in LOOKUP.md §3b; no change needed |
| **Summary tab** — Prestige Row | "Einstein Winners" highlight card (teams with `einstein_winner: true` from `einstein_contenders`) — already handled by the Summary blueprint |
| **Region History** — Einstein section | Separate from pills; uses its own data shape — see BLUEPRINT_REGION_HISTORY.md |

The three PbP pills described in this document are **PbP-only**. The Team Lookup prestige badge is a separate, always-visible badge on the lookup sheet and is already wired.

---

## 10. Files to Create / Modify

| File | Action |
|---|---|
| `PlayoffFirstBadge.swift` | **Modify** — add `EinsteinPill`, `EinsteinPillStyle`, `StandardFirstPill`; update `PlayoffFirstBadge` body |
| `PlayoffFirstData.swift` (or wherever the model lives) | **Modify** — add `firstEinstein: Bool` field |
| `SummaryAwards.swift` | **Modify** — add `einsteinContenders: [EinsteinContender]?` |
| `EinsteinContender.swift` | **Create** — or nest inside `SummaryAwards.swift` |
| `BroadcastStore.swift` | **Modify** — add `einsteinContenderMap` computed property |
| PbP team card call site | **Modify** — pass `einsteinContender` and context flags into `PlayoffFirstBadge` |
