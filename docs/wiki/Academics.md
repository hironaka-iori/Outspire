# Academics

## Timetable

### ClasstableViewModel

`Features/Academic/ViewModels/ClasstableViewModel.swift` manages the timetable data lifecycle:

**Data Model:**
- Years: `[Year]` (academic year list with `W_YearID` and `W_Year`)
- Timetable: `[[String]]` -- 2D grid where `timetable[period][day]` contains `"teacher\nsubject\nroom"` or empty string
- Selected year: Persisted to UserDefaults

**Cache Strategy:**
- 1-day TTL for timetable data
- Falls back to stale cached data during network failures
- `ignoreTTL` parameter for forced refresh
- Validates cache timestamps against `CacheManager` durations

**Loading Flow:**
1. Check cache validity
2. If valid, use cached data
3. If stale, fetch from `TimetableServiceV2`
4. Build 2D grid from API response items (period-indexed)
5. Cache result + trigger side effects

**Side Effects on Timetable Load:**
- Schedule class reminders via `NotificationManager`
- Update widget data via `WidgetDataManager`
- Register with push worker via `PushRegistrationService`
- Start/update Live Activity via `ClassActivityManager`

**Upcoming Class Detection:**
- Uses `ClassPeriodsManager` for current/next period lookup
- Supports day overrides and holiday mode
- Timer-based transition detection (10-second interval)
- Distinguishes real day (for Live Activity) from effective day (for display)

### ModernClasstableView

`Features/Academic/Views/ModernClasstableView.swift` renders the timetable:

- Day picker (Mon-Fri) with "Today" button for quick reset
- Timeline view with color-coded period cards
- Subject colors via keyword matching + DJB2 hash fallback
- Tap card → detail sheet with teacher, room, time info
- Active period shows progress bar
- Past periods have reduced opacity
- Spring animations on day change

## Scores

### ScoreViewModel

`Features/Academic/ViewModels/ScoreViewModel.swift` manages academic grades:

**Biometric Protection:**
- Uses `LAContext` for Face/Touch ID before revealing scores
- Scores hidden by default; user must authenticate to view
- `Configuration.hideAcademicScore` global toggle

**Data Model:**
- Terms: `[Term]` -- academic terms within a year
- Scores: `[ExamScore]` with up to 5 score/IB-score pairs per subject
- `termsWithData` set tracks which terms actually have scores

**Cache Strategy:**
- 5-minute TTL per term
- Debounced auto-save via Combine publishers

**Empty State Logic:**
Contextual messages based on term status:
- Future term → "Scores not yet available"
- Past enrollment → "No scores found for this term"
- Default → "No data yet"

### ScoreView

`Features/Academic/Views/ScoreView.swift` displays grades:

**View States:**
1. `NotAuthenticated` -- Shows sign-in prompt
2. `AuthenticationRequired` -- Biometric challenge
3. `MainContent` -- Term selector + score list

**UI Features:**
- Horizontal term selector with center anchoring
- Staggered entry animation (delay per score card)
- `SubjectScoreCard` with expandable detail and average score pill
- Color-coded levels: A* → F with distinct colors
- Pull-to-refresh resets animations for fresh entry

## Class Periods

`ClassPeriodsManager` defines the hardcoded 9-period school day:

| Period | Time (UTC+8) |
|--------|-------------|
| 1 | 8:15 - 8:55 |
| 2 | 9:00 - 9:45 |
| 3 | 9:55 - 10:35 |
| 4 | 10:45 - 11:25 |
| 5 | 12:30 - 13:10 |
| 6 | 13:20 - 14:00 |
| 7 | 14:10 - 14:50 |
| 8 | 15:00 - 15:40 |
| 9 | 15:50 - 16:30 |

- Weekdays (Mon-Fri): 9 periods
- Weekends: 0 periods
- Lunch break: Between periods 4 and 5 (11:25 - 12:30)

### ClassPeriod Methods

- `isCurrentlyActive()` -- Checks if current time is within period
- `currentProgressPercentage()` -- Returns 0-1 progress through active period
- `timeRangeFormatted` -- "h:mm-h:mm AM/PM" display

## Year Options

`TimetableServiceV2.fetchYearOptions()` scrapes the timetable page HTML:
- GETs `/Stu/Timetable/Index`
- Uses SwiftSoup to parse `<select id="YearId">` options
- Detects login redirects (checks for "/home/login" in URL or body)
- Returns `[YearOption]` with id and name
