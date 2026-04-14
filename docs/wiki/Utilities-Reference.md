# Utilities Reference

## ClassInfoParser
**File:** `Core/Utils/ClassInfoParser.swift`

Parses timetable cell data in `"teacher\nsubject\nroom"` format:

```swift
struct ClassInfo {
    let teacher: String?
    let subject: String?
    let room: String?
    let isSelfStudy: Bool
}

ClassInfoParser.parse("Mr. Smith\nMathematics\nRoom 201")
// → ClassInfo(teacher: "Mr. Smith", subject: "Mathematics", room: "Room 201", isSelfStudy: false)

ClassInfoParser.parse("")
// → ClassInfo(subject: "Self-Study", isSelfStudy: true)
```

Handles `<br>` tags and newlines. Detects "self-study" / "self study" (case-insensitive).

## ClassPeriodsManager
**File:** `Core/Models/ClassPeriodsModels.swift`

Singleton managing the 9-period school day schedule (UTC+8):

| Method | Description |
|--------|-------------|
| `getCurrentOrNextPeriod()` | Current active or next upcoming period |
| `getMaxPeriodsByWeekday(weekday:)` | 9 for weekdays, 0 for weekends |
| `getPeriod(number:)` | Get specific period by number |

Supports effective date override for testing/preview.

## NormalizedScheduleBuilder
**File:** `Core/Models/WidgetModels.swift`

Static utility for converting 2D timetable grid to typed schedule:

| Method | Description |
|--------|-------------|
| `buildDaySchedule(timetable:dayIndex:)` | Convert grid column to `[ScheduledClass]` |
| `weekdayIndex(for:)` | Date → 0-4 (Mon-Fri) or -1 (weekend) |
| `dayKey(for:)` | Date → "YYYY-MM-DD" in school timezone |

Uses `schoolTimeZone = TimeZone(secondsFromGMT: 8 * 60 * 60)`.

## SecureStore
**File:** `Core/Utils/SecureStore.swift`

Minimal Keychain wrapper (service: `dev.wrye.outspire`):

| Method | Description |
|--------|-------------|
| `set(value:for:)` | Store UTF-8 string (`.whenUnlockedThisDeviceOnly`) |
| `get(key:)` | Retrieve string or nil |
| `remove(key:)` | Delete entry |

## DisclaimerManager
**File:** `Core/Utils/DisclaimerManager.swift`

Tracks whether AI suggestion disclaimers have been shown:

| Property | Description |
|----------|-------------|
| `hasShownReflectionSuggestionDisclaimer` | Reflection AI warning shown |
| `hasShownRecordSuggestionDisclaimer` | Record AI warning shown |

Static text: `fullDisclaimerText` and `shortDisclaimerText` for AI entertainment-only warnings.

## AnimationManager
**File:** `Core/Utils/Helpers/AnimationManager.swift`

Tracks first launch and per-view animation states:

| Property/Method | Description |
|-----------------|-------------|
| `isFirstLaunch` | Checks UserDefaults "hasLaunchedBefore" |
| `markAppLaunched()` | Set first launch flag |
| `hasAnimated(viewId:)` | Check if view has played entry animation |
| `markAnimated(viewId:)` | Record animation played |
| `resetAnimationFlags()` | Clear all (for testing/logout) |

### UIDevice Extensions

- `isSmallScreen` -- width/height <= 375 (iPhone SE, 8)
- `isIpad` -- `userInterfaceIdiom == .pad`

## CaptchaRecognizer (DEAD CODE)
**File:** `Core/Utils/Helpers/CaptchaRecognizer.swift`

> **Dead code:** Not referenced by any other file. Was used for legacy TSIMS v1 login captcha; the V2 auth flow doesn't use captchas.

Vision framework OCR with multiple preprocessing strategies (basic, contrastEnhanced, binarized, combined). No longer called anywhere.

## ReceiptChecker
**File:** `Core/Utils/ReceiptChecker.swift`

Runtime environment detection:

| Property | Description |
|----------|-------------|
| `isSimulator` | `#if targetEnvironment(simulator)` |
| `isTestFlight` | Sandbox receipt + no embedded provision |
| `isAppStore` | Not simulator, not sandbox, no provision |

## Log
**File:** `Core/Utils/Log.swift`

OSLog loggers with subsystem `dev.wrye.Outspire`:

| Logger | Category |
|--------|----------|
| `Log.app` | "App" |
| `Log.net` | "Network" |
| `Log.auth` | "Auth" |
| `Log.widget` | "Widget" |

## GradientManager
**File:** `Features/Main/Utilities/GradientManager.swift`

Dynamic gradient state management:

| Method | Description |
|--------|-------------|
| `updateGradientForContext(context:colorScheme:)` | Apply context-specific gradient |
| `updateGradientForView(viewType:colorScheme:)` | Apply view-specific saved gradient |
| `updateGlobalGradient()` | Apply global gradient to all views |

See [Design System](Design-System.md) for full gradient documentation.

## HapticManager
**File:** `UI/Components/HapticManager.swift`

Centralized haptic feedback:

| Method | Feedback |
|--------|----------|
| `playImpact(.light/.medium/.heavy)` | UIImpactFeedbackGenerator |
| `playNotification(.success/.warning/.error)` | UINotificationFeedbackGenerator |
| `playSelection()` | UISelectionFeedbackGenerator |
| `playButtonTap()` | Light impact |
| `playToggle()` | Medium impact |
| `playDelete()` | Error notification |
| `playNavigation()` | Selection feedback |

## ImageCache
**File:** `Features/SchoolArrangement/Models/SchoolArrangementModels.swift`

NSCache-based image caching:
- 100-item limit, 50MB cost limit
- Deduplicates concurrent downloads
- Clears on memory warning
