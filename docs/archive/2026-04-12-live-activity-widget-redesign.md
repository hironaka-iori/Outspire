# Live Activity & Widget Redesign — Design Spec

**Date**: 2026-04-12
**Status**: Draft
**Scope**: Live Activities, Widgets (Small/Medium), CF Worker push service, school calendar system

---

## 1. Overview

Rebuild Live Activities and Widgets for Outspire from scratch with a completely new UI. The system delivers class schedule information to the Lock Screen, Dynamic Island, and Home Screen widgets — fully automated with zero daily user interaction after initial setup.

### Goals

- Context-aware Live Activity that transitions between class states automatically
- Clean, minimal UI with strict 3-style typography system
- Server-side push via Cloudflare Worker for Live Activity state updates without opening the app
- Automatic Chinese holiday/makeup-day detection via `holiday-cn`
- School-specific calendar (exams, events) via GitHub-hosted JSON
- Track (IBDP/A-Level) and grade-level aware filtering

### Non-Goals

- Large (weekly grid) widget — only Small and Medium
- Push notification for non-schedule content (announcements, grades)
- User accounts or authentication on the server side
- Complex server infrastructure (the Worker is the only backend component)

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────┐
│  Outspire App                                         │
│                                                       │
│  On login / timetable change:                         │
│    1. Parse userCode → entryYear + track              │
│    2. Register pushToStartToken                       │
│    3. POST /register to CF Worker:                    │
│       { pushStartToken, pushUpdateToken,              │
│         track, entryYear, weekSchedule }              │
│                                                       │
│  On Holiday Mode toggle:                              │
│    POST /pause { token, resumeDate? }                 │
│                                                       │
│  Shared data (App Group UserDefaults):                │
│    → Widget reads timetable + auth state + calendar   │
└──────────────────────────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────────┐
│  CF Worker (outspire-push.*.workers.dev)              │
│                                                       │
│  KV Store:                                            │
│    key: pushStartToken                                │
│    value: { pushUpdateToken, track, entryYear,        │
│             weekSchedule, paused, resumeDate }        │
│    TTL: 30 days                                       │
│                                                       │
│  Cron — daily 6:50 AM (pre-schedule):                 │
│    1. Fetch holiday-cn CDN → national holidays        │
│    2. Fetch GitHub raw → school calendar JSON          │
│    3. For each registered token:                      │
│       a. Is today a holiday/weekend/out-of-semester?   │
│       b. Is user paused?                              │
│       c. Does a specialDay cancel classes for this     │
│          user's track + entryYear?                     │
│       d. If classes today → compute push times         │
│          from weekSchedule for this weekday            │
│       e. Store push schedule in KV                     │
│                                                       │
│  Cron — every minute:                                 │
│    1. Re-fetch GitHub raw (handles same-day updates)   │
│    2. Check if any scheduled push is due               │
│    3. If specialDay added today → send end/update      │
│    4. Send APNs push (start / update / end)            │
│                                                       │
│  POST /register → store token + schedule in KV         │
│  POST /pause → mark token as paused                   │
│  POST /resume → clear pause flag                      │
└──────────────────────────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────────┐
│  APNs                                                 │
│    → pushToStart: start Live Activity (iOS 17.2+)     │
│    → update: change ContentState (class transitions)  │
│    → end: dismiss Live Activity                       │
└──────────────────────────────────────────────────────┘
```

### Data Flow — Daily Lifecycle

```
6:50  Worker cron → check holiday-cn + school calendar
      → today is normal school day for this user

7:45  Worker sends pushToStart →
      Device: Live Activity appears
      "Mathematics · starts in 30 min"
      Countdown: Text(timerInterval:countsDown:true)

8:15  Worker sends update →
      "Mathematics" + countdown to 8:55
      Progress bar fills over 40 min

8:50  Worker sends update →
      State changes to "ending" (orange tint, <5min)

8:55  Worker sends update →
      "Break · English Literature in 10 min"
      Countdown to 9:05

9:05  Worker sends update →
      "English Literature" + countdown to 9:45
      ... continues for each period ...

16:30 Worker sends end →
      Live Activity dismissed (after 15 min grace period)
```

---

## 3. User Code Parsing

```
userCode: "20238123"
           ││││││││
           ││││││└┘── seat number (23)
           │││││└──── class number (1) → 1-6: IBDP, 7-9: A-Level
           ││││└───── ignored
           └┘┘┘────── entry year (2023)
```

```swift
struct StudentInfo {
    let entryYear: String  // "2023"
    let classNumber: Int   // 1
    let track: Track       // .ibdp

    enum Track: String, Codable {
        case ibdp, alevel
    }

    init?(userCode: String) {
        guard userCode.count >= 6 else { return nil }
        self.entryYear = String(userCode.prefix(4))
        let classIndex = userCode.index(userCode.startIndex, offsetBy: 5)
        guard let num = Int(String(userCode[classIndex])) else { return nil }
        self.classNumber = num
        self.track = num >= 7 ? .alevel : .ibdp
    }
}
```

---

## 4. School Calendar JSON

**Location**: `calendar/2026.json` in the Outspire GitHub repository

**Fetched by CF Worker via**: `https://raw.githubusercontent.com/Computerization/Outspire/main/calendar/2026.json`

```json
{
  "school": "WFLA",
  "academicYear": "2025-2026",
  "semesters": [
    { "start": "2025-09-01", "end": "2026-01-17" },
    { "start": "2026-02-17", "end": "2026-06-30" }
  ],
  "specialDays": [
    {
      "date": "2026-01-12",
      "type": "exam",
      "name": "Final Exams",
      "cancelsClasses": true,
      "track": "all",
      "grades": ["all"]
    },
    {
      "date": "2026-05-02",
      "type": "exam",
      "name": "IB Exams",
      "cancelsClasses": true,
      "track": "ibdp",
      "grades": ["2023"]
    },
    {
      "date": "2026-05-10",
      "type": "exam",
      "name": "A-Level Exams",
      "cancelsClasses": true,
      "track": "alevel",
      "grades": ["2023"]
    },
    {
      "date": "2026-03-15",
      "type": "event",
      "name": "College Fair",
      "cancelsClasses": false,
      "track": "all",
      "grades": ["2023", "2024"]
    },
    {
      "date": "2026-04-20",
      "type": "event",
      "name": "Sports Day",
      "cancelsClasses": true,
      "track": "all",
      "grades": ["all"]
    },
    {
      "date": "2026-04-26",
      "type": "makeup",
      "name": "调休补班",
      "cancelsClasses": false,
      "track": "all",
      "grades": ["all"],
      "followsWeekday": 3
    }
  ]
}
```

### Field Definitions

| Field | Type | Description |
|---|---|---|
| `date` | `"YYYY-MM-DD"` | Date of the event |
| `type` | `"exam" \| "event" \| "notice"` | Category |
| `name` | `string` | Display name shown in Widget/LA |
| `cancelsClasses` | `bool` | `true` = no class push; `false` = normal classes + info banner |
| `track` | `"all" \| "ibdp" \| "alevel"` | Which curriculum track |
| `grades` | `["all"]` or `["2023", "2024"]` | Entry years affected |
| `followsWeekday` | `int` (1=Mon..5=Fri), optional | For `type: "makeup"`: which weekday's schedule to use |

### Matching Logic

An event applies to a user when **both** conditions are true:
- `track == "all"` OR `track == user.track`
- `grades` contains `"all"` OR `grades` contains `user.entryYear`

---

## 5. CF Worker Decision Logic

Each minute, before sending any push, the Worker evaluates:

```
1. Is today outside all semester date ranges?
   → YES: skip (vacation)

2. Does holiday-cn say today isOffDay?
   → YES: skip (national holiday)

3. Does holiday-cn say today is NOT isOffDay but IS listed?
   → This is a 调休补班 day → treat as a school day.
     Note: the government announcement specifies which weekday's
     schedule to follow (e.g., "Saturday follows Wednesday schedule").
     holiday-cn does not encode this mapping. For v1, use the
     school calendar JSON to specify: add the 调休 date as a
     specialDay with type "makeup" and a "followsWeekday" field.
     Fallback: if no mapping, use the user's Monday schedule.

4. Is there a specialDay matching this user (track + grade)?
   → cancelsClasses == true? → skip class pushes,
     send one push with event name for Widget display
   → cancelsClasses == false? → normal class pushes,
     include event name as supplementary info

5. Is user paused (manual Holiday Mode)?
   → YES and (no resumeDate or resumeDate > today): skip
   → YES and resumeDate <= today: auto-resume, clear pause

6. Is today a weekend (Sat/Sun) and not a 调休 day?
   → YES: skip

7. Normal school day → look up user's weekSchedule
   for today's weekday, generate push times
```

---

## 6. Live Activity Design

### ActivityAttributes

```swift
struct ClassActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var className: String       // "Mathematics" or "Lunch Break"
        var roomNumber: String      // "301" or ""
        var status: Status          // .ongoing, .ending, .upcoming, .break, .event
        var periodStart: Date       // for progress bar
        var periodEnd: Date         // for countdown target
        var nextClassName: String?  // shown during breaks

        enum Status: String, Codable {
            case ongoing    // in class, subject color
            case ending     // <5min left, orange
            case upcoming   // before first class, green
            case `break`    // between classes, dim countdown
            case event      // exam/sports day, purple
        }
    }

    // Static attributes (set once at start, don't count toward update size)
    var startDate: Date  // LA start time
}
```

**Size budget**: ContentState is ~200 bytes. Well under 4KB limit.

### Visual Design — Lock Screen

Strict 3 text styles only (SF Pro Rounded):

| Style | Spec | Usage |
|---|---|---|
| **A — Number** | 32px / Semibold (600) / tabular-nums / -1px tracking | Countdown digits |
| **B — Title** | 17px / Bold (700) / -0.2px tracking | Class/event name |
| **C — Caption** | 11px / Semibold (600) / 0.5px tracking | Labels, room, time ranges |

**Layout (all states)**:

```
┌─────────────────────────────────────────┐
│ [Title: class name]      [Caption: ENDS IN] │
│ [Caption: Room 301]      [Number: 12:38]    │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░  (3px progress)   │
└─────────────────────────────────────────┘
```

**Color by state**:

| State | Title color | Number color | Progress gradient |
|---|---|---|---|
| ongoing | subject color | white | subject color → darker variant |
| ending (<5min) | orange | orange | orange → dark orange |
| upcoming | green | dim (40% white) | empty |
| break | green (next class) | dim (40% white) | empty |
| event | purple | dim (40% white) | purple → dark purple |

**Subject colors** reuse `ModernScheduleRow.subjectColor(for:)` from the app.

### Dynamic Island — Compact

```
┌───────────────────────────────────┐
│ (progress ring) Math    12:38     │
└───────────────────────────────────┘
```

- Leading: circular progress ring (subject color, clockwise from 12 o'clock)
- Center: abbreviated class name (Caption style, 55% white)
- Trailing: countdown (Number style scaled to 15px, subject color)

### Dynamic Island — Minimal

Just the circular progress ring with subject color.

### Dynamic Island — Expanded

Same layout as Lock Screen but scaled down:
- Title: 16px
- Number: 28px
- Adds room + teacher in Caption under title

### Live Activity Lifecycle

| Time | Trigger | Action |
|---|---|---|
| 30 min before first class | CF Worker pushToStart | LA appears with "upcoming" state |
| Class starts | CF Worker push update | Switch to "ongoing" + countdown to end |
| 5 min before class ends | CF Worker push update | Switch to "ending" (orange) |
| Class ends | CF Worker push update | Switch to "break" + next class preview |
| Next class starts | CF Worker push update | Switch to "ongoing" |
| Last class ends | CF Worker push end | LA dismissed after 15 min |
| Midnight (if still alive) | System | LA expires via staleDate |

---

## 7. Widget Design

### Small Widget (170x170)

**Two variants** (user picks in widget edit):

**A — "Now" widget**: current class + countdown
**B — "Next" widget**: next class + relative time

**Visual**: Gradient background matching subject color. All text white.

```
┌─────────────────┐
│ [C] NOW          │
│ [B] Math         │
│                  │
│ [A] 12:38        │
│ [C] Room 301     │
└─────────────────┘
```

- Background: `linear-gradient(145deg, subjectColor, darkerVariant)`
- All text: white at varying opacities (100%, 70%, 55%)
- "Next" variant shows relative time: `23 min` instead of countdown

**States**:
- Not authenticated → gray gradient + "Sign in to Outspire"
- No classes today → muted gradient + "No Classes"
- Holiday → warm gradient + holiday name
- Event (cancelsClasses) → purple gradient + event name

### Medium Widget (364x170)

**Dark background** (`#1c1c1e`). Today's timeline.

```
┌──────────────────────────────────────┐
│ [C] TODAY              [A] 12:38     │
│ [C] Wednesday · 4 cls  [C] Remaining │
│                                      │
│ (●) [B] Mathematics    [C] 9:45-10:25│
│  │                                   │
│ (○) [B] English Lit    [C] 10:40-11:20│
│  │                                   │
│ (○) [B] Physics        [C] 13:00-13:40│
└──────────────────────────────────────┘
```

- Active class: glowing dot (subject color + shadow), Title in subject color
- Future classes: muted dot, Title at 45% white
- Past classes: not shown (scrolled off)
- Shows up to 3 upcoming classes

**Event banner** (when `cancelsClasses: false`):
```
│ 📌 College Fair today                │
```
Shown as a single Caption line above the timeline.

### Widget Data Source

Widgets use **App Group UserDefaults** (not push):
- Main app writes timetable + calendar data to shared UserDefaults on every fetch
- Widget TimelineProvider reads from shared UserDefaults
- Timeline entries pre-scheduled for the whole day (every class transition)
- `WidgetCenter.shared.reloadTimelines(ofKind:)` called when app updates data

Widget does NOT depend on CF Worker. It works fully offline with cached data.

### Widget Timeline Strategy

```swift
func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> ()) {
    let shared = UserDefaults(suiteName: "group.dev.wrye.Outspire")!
    let schedule = shared.todaySchedule  // decoded [ScheduledClass]
    let calendar = shared.schoolCalendar // decoded SchoolCalendar

    var entries: [WidgetEntry] = []

    // Generate an entry for each state transition
    for (i, cls) in schedule.enumerated() {
        // Class start
        entries.append(WidgetEntry(date: cls.startTime, state: .ongoing(cls), upcoming: Array(schedule.dropFirst(i+1))))
        // 5 min before end
        entries.append(WidgetEntry(date: cls.endTime.addingTimeInterval(-300), state: .ending(cls), upcoming: Array(schedule.dropFirst(i+1))))
        // Class end (break)
        if i + 1 < schedule.count {
            entries.append(WidgetEntry(date: cls.endTime, state: .break(next: schedule[i+1]), upcoming: Array(schedule.dropFirst(i+1))))
        }
    }

    // After last class
    if let last = schedule.last {
        entries.append(WidgetEntry(date: last.endTime, state: .completed))
    }

    let timeline = Timeline(entries: entries, policy: .atEnd)
    completion(timeline)
}
```

This gives the widget **exact transition times** without consuming refresh budget.

---

## 8. Onboarding Integration

Add a new page to the existing OnboardingView (after notification permission, before "You're All Set"):

```swift
OnboardingPage(
    title: "Live Schedule",
    description: "Get real-time class countdowns on your Lock Screen. Automatically starts before your first class and disappears after school.",
    imageName: "clock.badge.checkmark",
    imageColor: .cyan,
    pageType: .liveActivityPermission
)
```

**Behavior**:
- "Enable" → register pushToStartToken, set `liveActivityEnabled = true` in UserDefaults
- "Skip" → don't register, set `liveActivityEnabled = false`
- Can be changed later in Settings > Notifications

**Post-onboarding**: When user logs in for the first time and timetable is fetched, if LA is enabled, app sends `/register` to CF Worker.

---

## 9. App Group & Data Sharing

**App Group ID**: `group.dev.wrye.Outspire` (re-enable in entitlements for both main app and widget extension)

### Shared UserDefaults Keys

| Key | Type | Writer | Reader |
|---|---|---|---|
| `widgetTimetable` | `Data` (encoded `[[String]]`) | Main app | Widget |
| `widgetAuthState` | `Bool` | Main app | Widget |
| `widgetHolidayMode` | `Bool` | Main app | Widget |
| `widgetSchoolCalendar` | `Data` (encoded calendar) | Main app | Widget |
| `widgetTrack` | `String` | Main app | Widget |
| `widgetEntryYear` | `String` | Main app | Widget |

### When to Sync

- **On login**: write all keys + call `WidgetCenter.shared.reloadAllTimelines()`
- **On timetable fetch**: write `widgetTimetable` + reload
- **On Holiday Mode toggle**: write `widgetHolidayMode` + reload
- **On logout**: clear all keys + reload
- **On app foreground**: refresh if stale (>24h)

---

## 10. Widget Extension Target

**New target**: `OutspireWidget` (Widget Extension)

**Deployment target**: iOS 17.0 (matches main app)

**Contains**:
- `OutspireWidgetBundle.swift` — registers all widgets
- `SmallClassWidget.swift` — small widget (Now/Next variants via AppIntent config)
- `MediumTimelineWidget.swift` — medium timeline widget
- `WidgetDataProvider.swift` — reads App Group UserDefaults, generates timeline entries
- `WidgetViews/` — shared view components
- `ClassActivityLiveActivity.swift` — Live Activity UI (Lock Screen + Dynamic Island)

**Main app contains**:
- `Features/LiveActivity/ClassActivityAttributes.swift` — shared ActivityAttributes
- `Features/LiveActivity/ClassActivityManager.swift` — start/stop/register logic
- `Core/Services/WidgetDataManager.swift` — writes to App Group UserDefaults

---

## 11. CF Worker Implementation

**Stack**: Cloudflare Worker + KV + Cron Triggers

**Secrets**:
- `APNS_KEY_ID` — APNs Auth Key ID
- `APNS_TEAM_ID` — Apple Developer Team ID
- `APNS_PRIVATE_KEY` — .p8 key content

**KV Namespace**: `OUTSPIRE_PUSH`

### Endpoints

**`POST /register`**
```json
{
  "pushStartToken": "hex...",
  "pushUpdateToken": "hex...",
  "track": "alevel",
  "entryYear": "2023",
  "schedule": {
    "1": [{"start":"08:15","end":"08:55","name":"Math","room":"301"}, ...],
    "2": [{"start":"08:15","end":"08:55","name":"English","room":"205"}, ...],
    "3": [...],
    "4": [...],
    "5": [...]
  }
}
```
Key in KV: `token:{pushStartToken}`, TTL: 30 days.

**`POST /pause`**
```json
{
  "pushStartToken": "hex...",
  "resumeDate": "2026-01-20"
}
```

**`POST /resume`**
```json
{
  "pushStartToken": "hex..."
}
```

### Cron Schedule

| Schedule | Action |
|---|---|
| `50 22 * * *` (6:50 AM CST = 22:50 UTC) | Pre-compute daily push schedule for all tokens |
| `* * * * *` (every minute) | Execute due pushes + re-check GitHub calendar for same-day changes |

### APNs Payload Examples

**Start Live Activity**:
```json
{
  "aps": {
    "timestamp": 1681234567,
    "event": "start",
    "content-state": {
      "className": "Mathematics",
      "roomNumber": "301",
      "status": "upcoming",
      "periodStart": 1681234567,
      "periodEnd": 1681236967,
      "nextClassName": null
    },
    "attributes-type": "ClassActivityAttributes",
    "attributes": {
      "startDate": 1681234567
    }
  }
}
```

**Update**:
```json
{
  "aps": {
    "timestamp": 1681236967,
    "event": "update",
    "content-state": {
      "className": "Mathematics",
      "roomNumber": "301",
      "status": "ongoing",
      "periodStart": 1681236967,
      "periodEnd": 1681239367,
      "nextClassName": "English Literature"
    }
  }
}
```

**End**:
```json
{
  "aps": {
    "timestamp": 1681270000,
    "event": "end",
    "dismissal-date": 1681270900
  }
}
```

---

## 12. Edge Cases

| Scenario | Behavior |
|---|---|
| User opens app at 2 AM | Widget refreshes, Live Activity NOT started (too early) |
| Device reboots during school | LA restores (iOS 16.2+), Worker continues sending pushes on schedule |
| No internet all day | Widget works (local cache), LA won't receive push updates but countdown continues on last state |
| User changes timetable | App sends new `/register`, Worker updates KV immediately |
| Mid-day calendar update (exam added today) | Worker re-fetches GitHub JSON every minute, detects change, sends LA end + Widget update |
| 调休 Saturday (makeup class) | holiday-cn marks as `isOffDay: false`, Worker treats as school day using Saturday's mapped weekday schedule |
| Holiday Mode manually toggled | App sends `/pause` to Worker, Widget reads local `widgetHolidayMode` |
| pushStartToken expires/rotates | App observes `Activity<T>.pushToStartTokenUpdates`, re-sends to Worker |
| User not opened app in 30+ days | KV TTL expires, no pushes sent, Widget shows stale data with "Open Outspire to refresh" |

---

## 13. Independence of Widget and Live Activity

Widgets and Live Activities are **fully independent**:

| Setting | Widget | Live Activity |
|---|---|---|
| LA enabled, Widget added | Works | Works |
| LA disabled, Widget added | Works | Not started |
| LA enabled, no Widget | No widget shown | Works via push |
| Both disabled | Nothing | Nothing |

Widget relies only on App Group UserDefaults (local cache). Live Activity relies on CF Worker push. Neither depends on the other.

---

## 14. Visual Reference

The approved UI mockup is at: `/Users/alanye/Downloads/outspire-redesign-v3.html`

Key design decisions captured in the mockup:
- SF Pro Rounded font family throughout
- Strict 3 text styles (Number / Title / Caption) with size scaling by context
- Small widgets use subject-color gradient backgrounds with white text
- Live Activity and Dynamic Island use dark translucent backgrounds with colored text
- Progress bars use gradient fills (subject color → darker variant), 3px height
- Break/lunch states use dimmed countdown (40% white) to convey "not urgent"
- No decorative elements — only class name, countdown, progress bar, and room number
