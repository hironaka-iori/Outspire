# Widget & Live Activities

## Overview

The `OutspireWidget` target provides two widget types bundled in `OutspireWidgetBundle`:

1. **SmallClassWidget** -- Home screen widget showing current/upcoming class
2. **OutspireWidgetLiveActivity** -- Lock screen + Dynamic Island class tracking

Both read data from the main app via App Group UserDefaults (`group.dev.wrye.Outspire`).

## Data Flow

```
Main App                          Widget Extension
─────────                         ────────────────
ClasstableViewModel               WidgetDataReader
  → WidgetDataManager               → readTimetable()
    → App Group UserDefaults         → readAuthState()
      (group.dev.wrye.Outspire)      → readHolidayMode()
                                         │
                                   ClassWidgetProvider
                                     → NormalizedScheduleBuilder
                                         │
                                   SmallWidgetView / LiveActivity
```

### Data Written by Main App

| Key | Type | Written By |
|-----|------|------------|
| Timetable | `[[String]]` (JSON) | `WidgetDataManager.updateTimetable()` |
| Auth state | `Bool` | `WidgetDataManager.updateAuthState()` |
| Holiday mode | `Bool` + optional end date | `WidgetDataManager.updateHolidayMode()` |
| Student info | Track, entry year | `WidgetDataManager.updateStudentInfo()` |

After each write, `WidgetCenter.reloadAllTimelines()` is called to trigger widget refresh.

## Small Widget

### ClassWidgetProvider (Timeline Provider)

Generates timeline entries for each schedule transition:

1. **Before first class** (30 min before) -- Status: `upcoming`
2. **Class start** -- Status: `ongoing`
3. **5 min before end** -- Status: `ending`
4. **Class end** -- Status: `break` (with next class info)
5. **Schedule complete** -- Status: `completed`

**Timeline Policy:**
- `.atEnd` when schedule has active entries (refreshes at exact transition times)
- `.after(nextMorning())` for completed/no-class states (refreshes at 7:30 AM)

**Guard checks:**
- Not authenticated → `.notAuthenticated` entry
- Holiday mode → `.holiday` entry
- Weekend → `.noClasses` entry
- Empty timetable → `.noClasses` entry

### SmallWidgetView

Renders different layouts based on `WidgetClassStatus`:

| Status | Display |
|--------|---------|
| `.notAuthenticated` | Gray "OUTSPIRE / Sign In" |
| `.holiday` | Warm gradient "HOLIDAY / No Classes" |
| `.noClasses` / `.completed` | Gray "TODAY / No Classes" |
| `.ongoing` / `.ending` | Class card with countdown timer and room |
| `.upcoming` | Next class card with countdown to start |
| `.break` | Break/lunch card showing next class |
| `.event` | Purple event card |

**Rendering Mode Adaptation:**
- Full color mode: Gradient backgrounds via `SubjectColors.gradient()`
- Other modes: Transparent backgrounds with adapted foreground colors

**Timer Integration:**
- Ongoing: `timerInterval: startTime...endTime` (counts down to end)
- Upcoming: `timerInterval: now...startTime` (counts down to start)

## Live Activity

### ClassActivityAttributes

ActivityKit data model shared between main app and widget extension:

**Immutable attributes:**
- `startDate`: When activity was started

**Mutable ContentState:**
- `dayKey`: ISO-8601 date string
- `phase`: upcoming / ongoing / ending / breakTime / event / done
- `title`: Class name or status text
- `subtitle`: Teacher, room, or status detail
- `rangeStart` / `rangeEnd`: Time bounds for current phase
- `nextTitle`: Optional next class name (for break phases)
- `sequence`: Monotonic counter for state ordering

### ClassActivityManager

Singleton managing Live Activity lifecycle:

**Lifecycle:**
1. **Start** -- When classes exist, 30 min before first class
2. **Update** -- On phase transitions (period start, ending, break, done)
3. **End** -- When all classes are done or holiday mode enabled

**State Computation:**
Computes phase at given time by checking each scheduled class:
- Before first class → `upcoming`
- During class → `ongoing`
- 5 min before class end → `ending`
- Between classes → `breakTime`
- After last class → `done`

**Push Token Management:**
- Observes `pushToStartToken` updates (iOS 17.2+)
- Observes `pushTokenUpdates` for each active activity
- Uploads tokens to `PushRegistrationService`
- Clears `lastPushUpdateToken` when activities end

**Reconciliation:**
On app launch, restores existing activities from `Activity.activities` and re-observes their push token updates.

**Sequence Tracking:**
Uses a monotonic `sequence` counter to prevent duplicate state updates and ensure proper ordering.

### OutspireWidgetLiveActivity

Renders Live Activity across multiple contexts:

**Lock Screen:**
- Compact 2-line display: title/subtitle + countdown timer
- `TimeProgressBar` using native `ProgressView(timerInterval:)` for battery-efficient progress

**Dynamic Island Expanded:**
- Leading: title + subtitle
- Trailing: countdown timer
- Bottom: linear progress bar

**Dynamic Island Compact:**
- Leading: circular `ProgressRing` (updates every 30s)
- Trailing: countdown timer text

**Dynamic Island Minimal:**
- Circular `ProgressRing` only

**Stale View:**
- "Schedule Complete" message when phase is `.done`

**Phase-Based Styling:**

| Phase | Color | Countdown Label |
|-------|-------|----------------|
| ongoing / ending | Subject color or orange | "ENDS IN" |
| upcoming / breakTime | Green | "STARTS IN" |
| event | Purple | "TODAY" |
| done | Gray | "DONE" |

### TimeProgressBar

Uses ActivityKit's native `ProgressView(timerInterval:countsDown:)` instead of manual `TimelineView` computation. This renders progress on the OS level without draining battery through periodic view recomputation.

## Subject Colors (Widget)

`SubjectColors` maps subject names to colors via keyword matching:

| Subject Keywords | Color |
|-----------------|-------|
| math, mathematics | Blue |
| english, language, literature, GP, ESL | Green |
| physics, science | Orange |
| chemistry, chem | Pink |
| biology, bio | Teal |
| further math | Mint |
| PE, sports | Yellow |
| economics | Brown |
| arts, art, TOK | Cyan |
| chinese, mandarin | Indigo |
| history, geography | Gray |

Unknown subjects get a deterministic color via DJB2 hash (ensures consistent color per subject name).

## Widget Periods

`WidgetClassPeriods` hardcodes the 9-period schedule for the widget extension (same times as `ClassPeriodsManager` in main app):

| Period | Start | End |
|--------|-------|-----|
| 1 | 8:15 | 8:55 |
| 2 | 9:00 | 9:45 |
| 3 | 9:55 | 10:35 |
| 4 | 10:45 | 11:25 |
| 5 | 12:30 | 13:10 |
| 6 | 13:20 | 14:00 |
| 7 | 14:10 | 14:50 |
| 8 | 15:00 | 15:40 |
| 9 | 15:50 | 16:30 |

## Schedule Parsing

`NormalizedScheduleBuilder` (in `WidgetSharedModels.swift`) converts the 2D timetable grid into `[ScheduledClass]`:

1. Determines weekday index (Mon=0, Fri=4, weekend=-1)
2. Finds last non-empty period to determine schedule cutoff
3. Parses each cell: `"teacher\nsubject\nroom"` format
4. Strips regex suffix `\(\d+\)$` from subjects (e.g., "Math(1)" → "Math")
5. Detects self-study (empty cells or "self-study" text)
6. Assigns period times from `WidgetClassPeriods`

Timezone: UTC+8 (`TimeZone(secondsFromGMT: 8 * 60 * 60)`)
