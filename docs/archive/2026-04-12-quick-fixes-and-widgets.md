# Quick Fixes + Widget Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship SecureStore hardening, @MainActor concurrency fixes, DateFormatter optimization, then build the new Widget extension with Small and Medium widgets using the approved v3 design.

**Architecture:** Quick fixes are independent file edits. Widget work adds a new OutspireWidget extension target that reads timetable data from App Group UserDefaults (written by main app). Widget uses pre-scheduled timeline entries at exact class transition times. No server dependency — works fully offline with cached data.

**Tech Stack:** SwiftUI, WidgetKit, App Groups, ActivityKit (attributes only — UI in next plan)

**Spec:** `docs/superpowers/specs/2026-04-12-live-activity-widget-redesign.md`

---

## File Map

### Quick Fixes (modify only)

| File | Change |
|---|---|
| `Outspire/Core/Utils/SecureStore.swift` | Add `kSecAttrAccessible` to all queries |
| `Outspire/Core/Services/TSIMS/AuthServiceV2.swift` | Add `@MainActor` |
| `Outspire/Core/Services/NotificationManager.swift` | Add `@MainActor` |
| `Outspire/Core/Services/URLSchemeHandler.swift` | Add `@MainActor` |
| `Outspire/Features/Map/Utils/RegionCheck.swift` | Add `@MainActor` |
| `Outspire/Features/Main/Utilities/GradientManager.swift` | Add `@MainActor` |
| `Outspire/Features/SchoolArrangement/ViewModels/SchoolArrangementViewModel.swift` | Add `@MainActor` |
| `Outspire/Features/SchoolArrangement/ViewModels/LunchMenuViewModel.swift` | Add `@MainActor` |
| `Outspire/Features/Account/ViewModels/AccountV2ViewModel.swift` | Add `@MainActor` |
| `Outspire/Features/CAS/Views/ReflectionsView.swift` | Fix DateFormatter allocation in sort |
| `Outspire/OutspireApp.swift` | Add `@MainActor` to SettingsManager |

### Shared Models (create in main app, used by both targets)

| File | Purpose |
|---|---|
| `Outspire/Core/Models/StudentInfo.swift` | Parse userCode → entryYear, classNumber, track |
| `Outspire/Core/Models/SchoolCalendar.swift` | Codable model for calendar JSON |
| `Outspire/Core/Models/WidgetModels.swift` | ScheduledClass, WidgetState, WidgetEntry shared types |

### Main App — Widget Data Sharing

| File | Purpose |
|---|---|
| `Outspire/Core/Services/WidgetDataManager.swift` | Write timetable + state to App Group UserDefaults |
| `Outspire/Outspire.entitlements` | Re-add App Group |

### Widget Extension Target — `OutspireWidget/`

| File | Purpose |
|---|---|
| `OutspireWidget/OutspireWidgetBundle.swift` | @main WidgetBundle registering all widgets |
| `OutspireWidget/SmallClassWidget.swift` | Small widget with Now/Next AppIntent config |
| `OutspireWidget/MediumTimelineWidget.swift` | Medium timeline widget |
| `OutspireWidget/WidgetDataProvider.swift` | Read App Group, generate timeline entries |
| `OutspireWidget/Views/WidgetTypography.swift` | 3-style typography system (Number/Title/Caption) |
| `OutspireWidget/Views/SmallWidgetView.swift` | Small widget SwiftUI view |
| `OutspireWidget/Views/MediumWidgetView.swift` | Medium widget SwiftUI view |
| `OutspireWidget/Views/SubjectColors.swift` | Subject → color mapping (extracted from ModernScheduleRow) |
| `OutspireWidget/OutspireWidget.entitlements` | App Group for widget extension |

### Integration (modify existing)

| File | Change |
|---|---|
| `Outspire/Features/Academic/ViewModels/ClasstableViewModel.swift` | Call WidgetDataManager on timetable update |
| `Outspire/Features/Settings/Views/SettingsNotificationsView.swift` | Add Live Activity toggle |
| `Outspire/Features/Main/Views/OnboardingView.swift` | Add Live Activity permission page |

---

## Task 1: SecureStore Hardening

**Files:**
- Modify: `Outspire/Core/Utils/SecureStore.swift`

- [ ] **Step 1: Add kSecAttrAccessible to all keychain operations**

```swift
import Foundation
import Security

enum SecureStore {
    private static let service = "dev.wrye.outspire"

    static func set(_ value: String, for key: String) {
        guard let data = value.data(using: .utf8) else { return }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]

        // Delete existing
        SecItemDelete(query as CFDictionary)

        var addQuery = query
        addQuery[kSecValueData as String] = data
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        _ = SecItemAdd(addQuery as CFDictionary, nil)
    }

    static func get(_ key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: kCFBooleanTrue!,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func remove(_ key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]
        SecItemDelete(query as CFDictionary)
    }
}
```

Note: `kSecAttrAccessible` only needs to be set on `SecItemAdd`, not on queries/deletes. Existing items stored without it will still be readable — new items get the protection.

- [ ] **Step 2: Build to verify**

Run: `xcodebuild -project Outspire.xcodeproj -scheme Outspire -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | grep "error:" | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add Outspire/Core/Utils/SecureStore.swift
git commit -m "fix: add kSecAttrAccessibleWhenUnlockedThisDeviceOnly to SecureStore"
```

---

## Task 2: Add @MainActor to ObservableObject Classes

**Files:**
- Modify: `Outspire/OutspireApp.swift` (SettingsManager)
- Modify: `Outspire/Core/Services/TSIMS/AuthServiceV2.swift`
- Modify: `Outspire/Core/Services/NotificationManager.swift`
- Modify: `Outspire/Core/Services/URLSchemeHandler.swift`
- Modify: `Outspire/Features/Map/Utils/RegionCheck.swift`
- Modify: `Outspire/Features/Main/Utilities/GradientManager.swift`
- Modify: `Outspire/Features/SchoolArrangement/ViewModels/SchoolArrangementViewModel.swift`
- Modify: `Outspire/Features/SchoolArrangement/ViewModels/LunchMenuViewModel.swift`
- Modify: `Outspire/Features/Account/ViewModels/AccountV2ViewModel.swift`

- [ ] **Step 1: Add @MainActor to each class declaration**

For each file listed above, add `@MainActor` before the class declaration. The classes that already have it (`ConnectivityManager`, `SessionService` — deleted, `ClubInfoViewModel`, `ReflectionsViewModel`) should be skipped.

Pattern for each file — change:
```swift
class SomeViewModel: ObservableObject {
```
to:
```swift
@MainActor
class SomeViewModel: ObservableObject {
```

Specific changes:

**OutspireApp.swift** — `SettingsManager`:
```swift
@MainActor
class SettingsManager: ObservableObject {
    @Published var showSettingsSheet = false
}
```

**AuthServiceV2.swift**:
```swift
@MainActor
final class AuthServiceV2: ObservableObject {
```

**NotificationManager.swift**:
```swift
@MainActor
class NotificationManager: ObservableObject {
```

**URLSchemeHandler.swift**:
```swift
@MainActor
class URLSchemeHandler: ObservableObject {
```

**RegionCheck.swift**:
```swift
@MainActor
class RegionChecker: ObservableObject {
```

**GradientManager.swift**:
```swift
@MainActor
class GradientManager: ObservableObject {
```

**SchoolArrangementViewModel.swift**:
```swift
@MainActor
class SchoolArrangementViewModel: ObservableObject {
```

**LunchMenuViewModel.swift**:
```swift
@MainActor
class LunchMenuViewModel: ObservableObject {
```

**AccountV2ViewModel.swift**:
```swift
@MainActor
class AccountV2ViewModel: ObservableObject {
```

- [ ] **Step 2: Build and fix any resulting compiler errors**

Run: `xcodebuild -project Outspire.xcodeproj -scheme Outspire -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | grep "error:" | head -30`

Common fixes needed:
- `DispatchQueue.main.async` inside `@MainActor` methods becomes unnecessary — remove the dispatch wrapper and call directly. The `@MainActor` annotation guarantees main thread.
- Closures passed to `URLSession.dataTask` callbacks need `Task { @MainActor in ... }` or `await MainActor.run { ... }` instead of `DispatchQueue.main.async`.
- `nonisolated` may be needed on `deinit` or protocol conformance methods.

- [ ] **Step 3: Build passes**

Run: `xcodebuild ... build 2>&1 | tail -3`
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix: add @MainActor to ObservableObject classes for concurrency safety"
```

---

## Task 3: DateFormatter Optimization in ReflectionsView

**Files:**
- Modify: `Outspire/Features/CAS/Views/ReflectionsView.swift`

- [ ] **Step 1: Replace per-comparison DateFormatter allocation with static formatters**

In `ReflectionsView.swift` around line 300-315, find the sort closure and replace:

```swift
// OLD — allocates 2 DateFormatters per comparison (O(N log N) times)
).sorted { a, b in
    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd HH:mm:ss"
    let g = DateFormatter(); g.dateFormat = "yyyy-MM-dd"
    let da = f.date(from: a.C_Date) ?? g.date(from: a.C_Date) ?? Date.distantPast
    let db = f.date(from: b.C_Date) ?? g.date(from: b.C_Date) ?? Date.distantPast
    return sortDescending ? (da > db) : (da < db)
}
```

with:

```swift
// NEW — static formatters, allocated once
).sorted { a, b in
    let da = ReflectionDateParser.parse(a.C_Date)
    let db = ReflectionDateParser.parse(b.C_Date)
    return sortDescending ? (da > db) : (da < db)
}
```

Add at the bottom of the file (or in the same `ReflectionsSection` struct):

```swift
private enum ReflectionDateParser {
    private static let fullFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return f
    }()

    private static let dateOnlyFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func parse(_ dateString: String) -> Date {
        fullFormatter.date(from: dateString)
            ?? dateOnlyFormatter.date(from: dateString)
            ?? .distantPast
    }
}
```

- [ ] **Step 2: Build to verify**

Run: `xcodebuild -project Outspire.xcodeproj -scheme Outspire -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | grep "error:" | head -10`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add Outspire/Features/CAS/Views/ReflectionsView.swift
git commit -m "perf: use static DateFormatters in ReflectionsView sort"
```

---

## Task 4: Shared Models — StudentInfo + SchoolCalendar

**Files:**
- Create: `Outspire/Core/Models/StudentInfo.swift`
- Create: `Outspire/Core/Models/SchoolCalendar.swift`

- [ ] **Step 1: Create StudentInfo model**

```swift
// Outspire/Core/Models/StudentInfo.swift
import Foundation

struct StudentInfo {
    let entryYear: String
    let classNumber: Int
    let track: Track

    enum Track: String, Codable {
        case ibdp, alevel
    }

    /// Parse WFLA student code: "20238123" → entry year 2023, class 1, IBDP
    /// Format: [4 digits year][1 ignored][1 class number][2 seat number]
    init?(userCode: String) {
        guard userCode.count >= 6 else { return nil }
        self.entryYear = String(userCode.prefix(4))
        let classIndex = userCode.index(userCode.startIndex, offsetBy: 5)
        guard let num = Int(String(userCode[classIndex])), num >= 1, num <= 9 else { return nil }
        self.classNumber = num
        self.track = num >= 7 ? .alevel : .ibdp
    }
}
```

- [ ] **Step 2: Create SchoolCalendar model**

```swift
// Outspire/Core/Models/SchoolCalendar.swift
import Foundation

struct SchoolCalendar: Codable {
    let school: String
    let academicYear: String
    let semesters: [Semester]
    let specialDays: [SpecialDay]

    struct Semester: Codable {
        let start: String // "YYYY-MM-DD"
        let end: String
    }

    struct SpecialDay: Codable {
        let date: String // "YYYY-MM-DD"
        let type: String // "exam", "event", "notice", "makeup"
        let name: String
        let cancelsClasses: Bool
        let track: String // "all", "ibdp", "alevel"
        let grades: [String] // ["all"] or ["2023", "2024"]
        let followsWeekday: Int? // 1=Mon..5=Fri, for makeup days

        func appliesTo(track userTrack: StudentInfo.Track, entryYear: String) -> Bool {
            let trackMatch = (track == "all" || track == userTrack.rawValue)
            let gradeMatch = grades.contains("all") || grades.contains(entryYear)
            return trackMatch && gradeMatch
        }
    }

    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    func isInSemester(_ date: Date) -> Bool {
        let dateStr = Self.dateFormatter.string(from: date)
        return semesters.contains { dateStr >= $0.start && dateStr <= $0.end }
    }

    func specialDay(for date: Date, track: StudentInfo.Track, entryYear: String) -> SpecialDay? {
        let dateStr = Self.dateFormatter.string(from: date)
        return specialDays.first { $0.date == dateStr && $0.appliesTo(track: track, entryYear: entryYear) }
    }
}
```

- [ ] **Step 3: Build to verify**

Run: `xcodebuild ... build 2>&1 | grep "error:" | head -10`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add Outspire/Core/Models/StudentInfo.swift Outspire/Core/Models/SchoolCalendar.swift
git commit -m "feat: add StudentInfo and SchoolCalendar models"
```

---

## Task 5: Widget Data Models + WidgetDataManager

**Files:**
- Create: `Outspire/Core/Models/WidgetModels.swift`
- Create: `Outspire/Core/Services/WidgetDataManager.swift`
- Modify: `Outspire/Outspire.entitlements`

- [ ] **Step 1: Re-enable App Group entitlement**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.security.application-groups</key>
	<array>
		<string>group.dev.wrye.Outspire</string>
	</array>
</dict>
</plist>
```

- [ ] **Step 2: Create WidgetModels**

```swift
// Outspire/Core/Models/WidgetModels.swift
import Foundation

struct ScheduledClass: Codable, Hashable, Identifiable {
    var id: Int { periodNumber }
    let periodNumber: Int
    let className: String
    let roomNumber: String
    let teacherName: String
    let startTime: Date
    let endTime: Date
    let isSelfStudy: Bool
}

enum WidgetClassStatus: String, Codable {
    case ongoing
    case ending    // <5 min remaining
    case upcoming  // before first class
    case `break`
    case event
    case completed
    case noClasses
    case notAuthenticated
    case holiday
}
```

- [ ] **Step 3: Create WidgetDataManager**

```swift
// Outspire/Core/Services/WidgetDataManager.swift
import Foundation
import WidgetKit

enum WidgetDataManager {
    private static let suiteName = "group.dev.wrye.Outspire"

    private static var shared: UserDefaults? {
        UserDefaults(suiteName: suiteName)
    }

    // MARK: - Write (main app)

    static func updateTimetable(_ timetable: [[String]]) {
        guard let data = try? JSONEncoder().encode(timetable) else { return }
        shared?.set(data, forKey: "widgetTimetable")
        WidgetCenter.shared.reloadAllTimelines()
    }

    static func updateAuthState(_ isAuthenticated: Bool) {
        shared?.set(isAuthenticated, forKey: "widgetAuthState")
        WidgetCenter.shared.reloadAllTimelines()
    }

    static func updateHolidayMode(enabled: Bool, hasEndDate: Bool, endDate: Date) {
        shared?.set(enabled, forKey: "widgetHolidayMode")
        shared?.set(hasEndDate, forKey: "widgetHolidayHasEndDate")
        shared?.set(endDate, forKey: "widgetHolidayEndDate")
        WidgetCenter.shared.reloadAllTimelines()
    }

    static func updateStudentInfo(track: String, entryYear: String) {
        shared?.set(track, forKey: "widgetTrack")
        shared?.set(entryYear, forKey: "widgetEntryYear")
    }

    static func clearAll() {
        let keys = ["widgetTimetable", "widgetAuthState", "widgetHolidayMode",
                     "widgetHolidayHasEndDate", "widgetHolidayEndDate",
                     "widgetTrack", "widgetEntryYear"]
        keys.forEach { shared?.removeObject(forKey: $0) }
        WidgetCenter.shared.reloadAllTimelines()
    }

    // MARK: - Read (widget extension)

    static func readTimetable() -> [[String]] {
        guard let data = shared?.data(forKey: "widgetTimetable"),
              let timetable = try? JSONDecoder().decode([[String]].self, from: data)
        else { return [] }
        return timetable
    }

    static func readAuthState() -> Bool {
        shared?.bool(forKey: "widgetAuthState") ?? false
    }

    static func readHolidayMode() -> (enabled: Bool, hasEndDate: Bool, endDate: Date) {
        let enabled = shared?.bool(forKey: "widgetHolidayMode") ?? false
        let hasEndDate = shared?.bool(forKey: "widgetHolidayHasEndDate") ?? false
        let endDate = shared?.object(forKey: "widgetHolidayEndDate") as? Date ?? Date()
        return (enabled, hasEndDate, endDate)
    }
}
```

- [ ] **Step 4: Wire WidgetDataManager into ClasstableViewModel**

In `Outspire/Features/Academic/ViewModels/ClasstableViewModel.swift`, add a call after timetable updates. In the `cacheTimetable` method, after `self.lastUpdateTime = Date()`:

```swift
// Share with widget
WidgetDataManager.updateTimetable(timetable)
```

- [ ] **Step 5: Wire WidgetDataManager into auth and holiday state changes**

In `Outspire/OutspireApp.swift`, in the `.onChange(of: scenePhase)` handler after `AuthServiceV2.shared.onAppForegrounded()`:

```swift
// Sync auth state to widget
WidgetDataManager.updateAuthState(AuthServiceV2.shared.isAuthenticated)
```

In `Outspire/Configurations.swift`, in the `isHolidayMode` setter, after the notification post:

```swift
WidgetDataManager.updateHolidayMode(
    enabled: newValue,
    hasEndDate: Configuration.holidayHasEndDate,
    endDate: Configuration.holidayEndDate
)
```

- [ ] **Step 6: Build to verify**

Run: `xcodebuild ... build 2>&1 | grep "error:" | head -10`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add Outspire/Core/Models/WidgetModels.swift Outspire/Core/Services/WidgetDataManager.swift Outspire/Outspire.entitlements Outspire/Features/Academic/ViewModels/ClasstableViewModel.swift Outspire/OutspireApp.swift Outspire/Configurations.swift
git commit -m "feat: add WidgetDataManager and App Group data sharing"
```

---

## Task 6: Create Widget Extension Target

**Files:**
- Create: `OutspireWidget/` directory with entitlements
- Create: `OutspireWidget/OutspireWidgetBundle.swift`
- Xcode project configuration

- [ ] **Step 1: Create widget extension directory and entitlements**

```bash
mkdir -p OutspireWidget
```

Create `OutspireWidget/OutspireWidget.entitlements`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.security.application-groups</key>
	<array>
		<string>group.dev.wrye.Outspire</string>
	</array>
</dict>
</plist>
```

- [ ] **Step 2: Create WidgetBundle**

```swift
// OutspireWidget/OutspireWidgetBundle.swift
import SwiftUI
import WidgetKit

@main
struct OutspireWidgetBundle: WidgetBundle {
    var body: some Widget {
        SmallClassWidget()
        MediumTimelineWidget()
    }
}
```

- [ ] **Step 3: Add Widget Extension target in Xcode**

This step must be done in Xcode:
1. File → New → Target → Widget Extension
2. Product name: `OutspireWidget`
3. Bundle ID: `dev.wrye.Outspire.OutspireWidget`
4. Uncheck "Include Live Activity" (we'll add it in the next plan)
5. Uncheck "Include Configuration App Intent"
6. Deployment target: iOS 17.0
7. Add App Group `group.dev.wrye.Outspire` in Signing & Capabilities
8. Delete the auto-generated template files (we'll write our own)
9. Ensure the shared model files (`WidgetModels.swift`, `WidgetDataManager.swift`, `ClassPeriodsModels.swift`) are added to BOTH the main app and widget extension targets

- [ ] **Step 4: Commit project file changes**

```bash
git add OutspireWidget/ Outspire.xcodeproj/
git commit -m "feat: add OutspireWidget extension target"
```

---

## Task 7: Widget Typography + Subject Colors

**Files:**
- Create: `OutspireWidget/Views/WidgetTypography.swift`
- Create: `OutspireWidget/Views/SubjectColors.swift`

- [ ] **Step 1: Create the 3-style typography system**

```swift
// OutspireWidget/Views/WidgetTypography.swift
import SwiftUI

enum WidgetFont {
    /// Style A — countdown digits
    /// Base: 32px / Semibold / tabular-nums / -1pt tracking
    static func number(size: CGFloat = 32) -> Font {
        .system(size: size, weight: .semibold, design: .rounded)
            .monospacedDigit()
    }

    /// Style B — class/event name
    /// Base: 17px / Bold / -0.2pt tracking
    static func title(size: CGFloat = 17) -> Font {
        .system(size: size, weight: .bold, design: .rounded)
    }

    /// Style C — labels, rooms, time ranges
    /// Base: 11px / Semibold / 0.5pt tracking
    static func caption(size: CGFloat = 11) -> Font {
        .system(size: size, weight: .semibold, design: .rounded)
    }
}

extension View {
    func numberStyle(size: CGFloat = 32) -> some View {
        self.font(WidgetFont.number(size: size))
            .tracking(-1)
    }

    func titleStyle(size: CGFloat = 17) -> some View {
        self.font(WidgetFont.title(size: size))
            .tracking(-0.2)
    }

    func captionStyle(size: CGFloat = 11) -> some View {
        self.font(WidgetFont.caption(size: size))
            .tracking(0.5)
    }
}
```

- [ ] **Step 2: Extract subject color mapping**

```swift
// OutspireWidget/Views/SubjectColors.swift
import SwiftUI

enum SubjectColors {
    static func color(for subject: String) -> Color {
        let subjectLower = subject.lowercased()

        let colors: [(Color, [String])] = [
            (.blue.opacity(0.8), ["math", "mathematics", "maths"]),
            (.green.opacity(0.8), ["english", "language", "literature", "general paper", "esl"]),
            (.orange.opacity(0.8), ["physics", "science"]),
            (.pink.opacity(0.8), ["chemistry", "chem"]),
            (.teal.opacity(0.8), ["biology", "bio"]),
            (.mint.opacity(0.8), ["further math", "maths further"]),
            (.yellow.opacity(0.8), ["体育", "pe", "sports", "p.e"]),
            (.brown.opacity(0.8), ["economics", "econ"]),
            (.cyan.opacity(0.8), ["arts", "art", "tok"]),
            (.indigo.opacity(0.8), ["chinese", "mandarin", "语文"]),
            (.gray.opacity(0.8), ["history", "历史", "geography", "geo", "政治"]),
        ]

        for (color, keywords) in colors {
            if keywords.contains(where: { subjectLower.contains($0) }) { return color }
        }

        // Deterministic hash fallback
        var djb2: UInt64 = 5381
        for byte in subjectLower.utf8 {
            djb2 = djb2 &* 33 &+ UInt64(byte)
        }
        let hue = Double(djb2 % 12) / 12.0
        return Color(hue: hue, saturation: 0.7, brightness: 0.9)
    }

    /// Darker variant for gradient end
    static func darkerColor(for subject: String) -> Color {
        color(for: subject).opacity(0.6)
    }

    /// Gradient for small widget backgrounds
    static func gradient(for subject: String) -> LinearGradient {
        LinearGradient(
            colors: [color(for: subject), darkerColor(for: subject)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}
```

- [ ] **Step 3: Build to verify**

Run: `xcodebuild -project Outspire.xcodeproj -scheme OutspireWidget -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | grep "error:" | head -10`
Expected: No errors (or widget target may need the main widget files first — if so, continue to next task)

- [ ] **Step 4: Commit**

```bash
git add OutspireWidget/Views/
git commit -m "feat: add widget typography system and subject colors"
```

---

## Task 8: Widget Data Provider + Timeline Generation

**Files:**
- Create: `OutspireWidget/WidgetDataProvider.swift`

- [ ] **Step 1: Create the timeline provider that reads App Group data**

```swift
// OutspireWidget/WidgetDataProvider.swift
import Foundation
import WidgetKit

struct ClassWidgetEntry: TimelineEntry {
    let date: Date
    let status: WidgetClassStatus
    let currentClass: ScheduledClass?
    let upcomingClasses: [ScheduledClass]
    let eventName: String?
}

struct ClassWidgetProvider: TimelineProvider {
    typealias Entry = ClassWidgetEntry

    func placeholder(in context: Context) -> ClassWidgetEntry {
        ClassWidgetEntry(
            date: Date(),
            status: .ongoing,
            currentClass: ScheduledClass(
                periodNumber: 3, className: "Mathematics", roomNumber: "301",
                teacherName: "Mr. Wang", startTime: Date(), endTime: Date().addingTimeInterval(2400),
                isSelfStudy: false
            ),
            upcomingClasses: [],
            eventName: nil,
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (ClassWidgetEntry) -> Void) {
        completion(placeholder(in: context))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ClassWidgetEntry>) -> Void) {
        guard WidgetDataManager.readAuthState() else {
            let entry = ClassWidgetEntry(date: Date(), status: .notAuthenticated, currentClass: nil, upcomingClasses: [], eventName: nil, displayMode: .now)
            completion(Timeline(entries: [entry], policy: .atEnd))
            return
        }

        let holiday = WidgetDataManager.readHolidayMode()
        if holiday.enabled {
            let entry = ClassWidgetEntry(date: Date(), status: .holiday, currentClass: nil, upcomingClasses: [], eventName: nil, displayMode: .now)
            completion(Timeline(entries: [entry], policy: .atEnd))
            return
        }

        let timetable = WidgetDataManager.readTimetable()
        let schedule = buildTodaySchedule(from: timetable)

        if schedule.isEmpty {
            let entry = ClassWidgetEntry(date: Date(), status: .noClasses, currentClass: nil, upcomingClasses: [], eventName: nil, displayMode: .now)
            completion(Timeline(entries: [entry], policy: .atEnd))
            return
        }

        var entries: [ClassWidgetEntry] = []

        // Before first class
        if let first = schedule.first {
            entries.append(ClassWidgetEntry(
                date: first.startTime.addingTimeInterval(-1800), // 30 min before
                status: .upcoming,
                currentClass: first,
                upcomingClasses: Array(schedule.dropFirst()),
                eventName: nil,
                ))
        }

        for (i, cls) in schedule.enumerated() {
            let upcoming = Array(schedule.dropFirst(i + 1))

            // Class starts
            entries.append(ClassWidgetEntry(
                date: cls.startTime,
                status: .ongoing,
                currentClass: cls,
                upcomingClasses: upcoming,
                eventName: nil,
                ))

            // 5 min before end
            entries.append(ClassWidgetEntry(
                date: cls.endTime.addingTimeInterval(-300),
                status: .ending,
                currentClass: cls,
                upcomingClasses: upcoming,
                eventName: nil,
                ))

            // Break after class
            if let next = upcoming.first {
                entries.append(ClassWidgetEntry(
                    date: cls.endTime,
                    status: .break,
                    currentClass: next,
                    upcomingClasses: Array(upcoming.dropFirst()),
                    eventName: nil,
                        ))
            }
        }

        // After last class
        if let last = schedule.last {
            entries.append(ClassWidgetEntry(
                date: last.endTime,
                status: .completed,
                currentClass: nil,
                upcomingClasses: [],
                eventName: nil,
                ))
        }

        // Filter out past entries, keep at least one
        let now = Date()
        var filtered = entries.filter { $0.date >= now }
        if filtered.isEmpty, let last = entries.last {
            filtered = [last]
        }

        completion(Timeline(entries: filtered, policy: .atEnd))
    }

    private func buildTodaySchedule(from timetable: [[String]]) -> [ScheduledClass] {
        guard !timetable.isEmpty else { return [] }

        let calendar = Calendar.current
        let weekday = calendar.component(.weekday, from: Date())
        // 1=Sun, 2=Mon, ..., 7=Sat → column index: Mon=1, Tue=2, ..., Fri=5
        let dayColumn = weekday - 1 // 2→1, 3→2, ..., 6→5
        guard dayColumn >= 1, dayColumn <= 5 else { return [] } // Weekend

        let periods = ClassPeriodsManager.shared.classPeriods

        var result: [ScheduledClass] = []
        for row in 1 ..< timetable.count {
            guard dayColumn < timetable[row].count else { continue }
            let cellData = timetable[row][dayColumn]
            let trimmed = cellData.trimmingCharacters(in: .whitespacesAndNewlines)

            guard let period = periods.first(where: { $0.number == row }) else { continue }

            let components = cellData.components(separatedBy: "\n")
            let teacher = components.count > 0 ? components[0] : ""
            let subject = components.count > 1 ? components[1] : ""
            let room = components.count > 2 ? components[2] : ""

            result.append(ScheduledClass(
                periodNumber: row,
                className: subject.isEmpty ? "Self-Study" : subject,
                roomNumber: room,
                teacherName: teacher,
                startTime: period.startTime,
                endTime: period.endTime,
                isSelfStudy: trimmed.isEmpty
            ))
        }

        return result.filter { !$0.isSelfStudy }
    }
}
```

- [ ] **Step 2: Build to verify**

Expected: Compiles (may need placeholder Widget structs from next tasks)

- [ ] **Step 3: Commit**

```bash
git add OutspireWidget/WidgetDataProvider.swift
git commit -m "feat: add widget data provider with timeline generation"
```

---

## Task 9: Small Widget View + Configuration

**Files:**
- Create: `OutspireWidget/Views/SmallWidgetView.swift`
- Create: `OutspireWidget/SmallClassWidget.swift`

- [ ] **Step 1: Create the Small Widget view**

```swift
// OutspireWidget/Views/SmallWidgetView.swift
import SwiftUI
import WidgetKit

struct SmallWidgetView: View {
    let entry: ClassWidgetEntry

    var body: some View {
        switch entry.status {
        case .notAuthenticated:
            smallPlaceholder(label: "OUTSPIRE", message: "Sign In", gradient: grayGradient)
        case .holiday:
            smallPlaceholder(label: "HOLIDAY", message: "No Classes", gradient: warmGradient)
        case .noClasses, .completed:
            smallPlaceholder(label: "TODAY", message: "No Classes", gradient: grayGradient)
        case .ongoing, .ending:
            ongoingView
        case .upcoming, .break:
            upcomingView
        case .event:
            smallPlaceholder(label: "TODAY", message: entry.eventName ?? "Event", gradient: purpleGradient)
        }
    }

    private var ongoingView: some View {
        ZStack {
            if let cls = entry.currentClass {
                SubjectColors.gradient(for: cls.className)
            } else {
                grayGradient
            }

            VStack(alignment: .leading, spacing: 0) {
                Text("NOW")
                    .captionStyle()
                    .foregroundStyle(.white.opacity(0.7))
                    .textCase(.uppercase)

                if let cls = entry.currentClass {
                    Text(cls.className)
                        .titleStyle(size: 20)
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .padding(.top, 2)
                }

                Spacer()

                if let cls = entry.currentClass {
                    Text(timerInterval: cls.startTime...cls.endTime, countsDown: true)
                        .numberStyle(size: 34)
                        .foregroundStyle(.white)
                        .tracking(-1.5)

                    Text(cls.roomNumber.isEmpty ? " " : cls.roomNumber)
                        .captionStyle()
                        .foregroundStyle(.white.opacity(0.55))
                        .padding(.top, 4)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
        }
    }

    private var upcomingView: some View {
        ZStack {
            if let cls = entry.currentClass {
                SubjectColors.gradient(for: cls.className)
            } else {
                grayGradient
            }

            VStack(alignment: .leading, spacing: 0) {
                Text("NEXT")
                    .captionStyle()
                    .foregroundStyle(.white.opacity(0.7))
                    .textCase(.uppercase)

                if let cls = entry.currentClass {
                    Text(cls.className)
                        .titleStyle(size: 20)
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .padding(.top, 2)
                }

                Spacer()

                if let cls = entry.currentClass {
                    let minutesUntil = max(0, Int(cls.startTime.timeIntervalSince(entry.date) / 60))
                    Text("\(minutesUntil)")
                        .numberStyle(size: 34)
                        .foregroundStyle(.white)
                        .tracking(-1.5)
                    + Text(" min")
                        .titleStyle(size: 20)
                        .foregroundStyle(.white)

                    Text(cls.roomNumber.isEmpty ? " " : cls.roomNumber)
                        .captionStyle()
                        .foregroundStyle(.white.opacity(0.55))
                        .padding(.top, 4)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
        }
    }

    private func smallPlaceholder(label: String, message: String, gradient: LinearGradient) -> some View {
        ZStack {
            gradient

            VStack(alignment: .leading, spacing: 0) {
                Text(label)
                    .captionStyle()
                    .foregroundStyle(.white.opacity(0.7))
                    .textCase(.uppercase)

                Spacer()

                Text(message)
                    .titleStyle(size: 20)
                    .foregroundStyle(.white)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
        }
    }

    private var grayGradient: LinearGradient {
        LinearGradient(colors: [Color.gray.opacity(0.5), Color.gray.opacity(0.3)], startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    private var warmGradient: LinearGradient {
        LinearGradient(colors: [Color.orange.opacity(0.6), Color.orange.opacity(0.4)], startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    private var purpleGradient: LinearGradient {
        LinearGradient(colors: [Color.purple.opacity(0.6), Color.purple.opacity(0.4)], startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}
```

- [ ] **Step 2: Create the Small Widget definition**

```swift
// OutspireWidget/SmallClassWidget.swift
import SwiftUI
import WidgetKit

struct SmallClassWidget: Widget {
    let kind = "SmallClassWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ClassWidgetProvider()) { entry in
            SmallWidgetView(entry: entry)
                .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Class")
        .description("Current or upcoming class countdown")
        .supportedFamilies([.systemSmall])
    }
}
```

- [ ] **Step 3: Build widget target**

Run: `xcodebuild -project Outspire.xcodeproj -scheme OutspireWidget -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | grep "error:" | head -10`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add OutspireWidget/Views/SmallWidgetView.swift OutspireWidget/SmallClassWidget.swift
git commit -m "feat: add small class widget with gradient backgrounds"
```

---

## Task 10: Medium Widget View

**Files:**
- Create: `OutspireWidget/Views/MediumWidgetView.swift`
- Create: `OutspireWidget/MediumTimelineWidget.swift`

- [ ] **Step 1: Create the Medium Widget view (timeline layout)**

```swift
// OutspireWidget/Views/MediumWidgetView.swift
import SwiftUI
import WidgetKit

struct MediumWidgetView: View {
    let entry: ClassWidgetEntry

    var body: some View {
        switch entry.status {
        case .notAuthenticated:
            mediumPlaceholder("Sign in to see your schedule")
        case .holiday:
            mediumPlaceholder("Holiday — enjoy your day off!")
        case .noClasses, .completed:
            mediumPlaceholder("No more classes today")
        default:
            timelineView
        }
    }

    private var timelineView: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("TODAY")
                        .captionStyle()
                        .foregroundStyle(.white.opacity(0.55))
                        .textCase(.uppercase)

                    Text(dayString)
                        .captionStyle()
                        .foregroundStyle(.white.opacity(0.4))
                }

                Spacer()

                if let cls = entry.currentClass, entry.status == .ongoing || entry.status == .ending {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(timerInterval: cls.startTime...cls.endTime, countsDown: true)
                            .numberStyle(size: 20)
                            .foregroundStyle(SubjectColors.color(for: cls.className))
                            .tracking(-0.5)

                        Text("REMAINING")
                            .captionStyle()
                            .foregroundStyle(.white.opacity(0.4))
                    }
                }
            }

            Spacer(minLength: 8)

            // Timeline
            VStack(alignment: .leading, spacing: 0) {
                if let current = entry.currentClass {
                    timelineRow(cls: current, isActive: true)
                }

                ForEach(entry.upcomingClasses.prefix(2)) { cls in
                    timelineSeparator()
                    timelineRow(cls: cls, isActive: false)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func timelineRow(cls: ScheduledClass, isActive: Bool) -> some View {
        HStack(spacing: 10) {
            Circle()
                .fill(SubjectColors.color(for: cls.className))
                .frame(width: isActive ? 8 : 6, height: isActive ? 8 : 6)
                .shadow(color: isActive ? SubjectColors.color(for: cls.className).opacity(0.6) : .clear,
                        radius: isActive ? 4 : 0)

            Text(cls.className)
                .titleStyle(size: 14)
                .foregroundStyle(isActive ? SubjectColors.color(for: cls.className) : .white.opacity(0.45))
                .lineLimit(1)

            Spacer()

            Text(timeRange(cls))
                .captionStyle()
                .foregroundStyle(.white.opacity(0.4))
        }
        .padding(.vertical, 5)
    }

    private func timelineSeparator() -> some View {
        Rectangle()
            .fill(.white.opacity(0.06))
            .frame(width: 2, height: 5)
            .padding(.leading, 2)
    }

    private func timeRange(_ cls: ScheduledClass) -> String {
        let f = Self.timeFormatter
        return "\(f.string(from: cls.startTime)) – \(f.string(from: cls.endTime))"
    }

    private static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "H:mm"
        return f
    }()

    private var dayString: String {
        let f = DateFormatter()
        f.dateFormat = "EEEE"
        let classCount = (entry.currentClass != nil ? 1 : 0) + entry.upcomingClasses.count
        return "\(f.string(from: entry.date)) · \(classCount) classes"
    }

    private func mediumPlaceholder(_ message: String) -> some View {
        VStack {
            Spacer()
            Text(message)
                .titleStyle(size: 15)
                .foregroundStyle(.white.opacity(0.5))
                .multilineTextAlignment(.center)
            Spacer()
        }
        .frame(maxWidth: .infinity)
        .padding(16)
    }
}
```

- [ ] **Step 2: Create the Medium Widget definition**

```swift
// OutspireWidget/MediumTimelineWidget.swift
import SwiftUI
import WidgetKit

struct MediumTimelineWidget: Widget {
    let kind = "MediumTimelineWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ClassWidgetProvider()) { entry in
            MediumWidgetView(entry: entry)
                .containerBackground(Color(red: 0.11, green: 0.11, blue: 0.12), for: .widget)
        }
        .configurationDisplayName("Today's Schedule")
        .description("Timeline view of today's classes")
        .supportedFamilies([.systemMedium])
    }
}
```

- [ ] **Step 3: Build both targets**

Run:
```bash
xcodebuild -project Outspire.xcodeproj -scheme OutspireWidget -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | grep "error:" | head -10
xcodebuild -project Outspire.xcodeproj -scheme Outspire -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | grep "error:" | head -10
```
Expected: Both succeed

- [ ] **Step 4: Commit**

```bash
git add OutspireWidget/Views/MediumWidgetView.swift OutspireWidget/MediumTimelineWidget.swift
git commit -m "feat: add medium timeline widget"
```

---

## Task 11: Onboarding — Live Activity Permission Page

**Files:**
- Modify: `Outspire/Features/Main/Views/OnboardingView.swift`

- [ ] **Step 1: Add Live Activity page type and onboarding page**

In `OnboardingPageType` enum, add:
```swift
case liveActivityPermission
```

In the `pages` array in `OnboardingView`, insert before the last page ("You're All Set!"):
```swift
OnboardingPage(
    title: "Live Schedule",
    description: "Get real-time class countdowns on your Lock Screen. Automatically starts before your first class and disappears after school.",
    imageName: "clock.badge.checkmark",
    imageColor: .cyan,
    pageType: .liveActivityPermission
),
```

- [ ] **Step 2: Add handling in handleNextAction and pageView**

In `handleNextAction()`, add a case for `.liveActivityPermission`:
```swift
case .liveActivityPermission:
    // Store user's choice and move on
    UserDefaults.standard.set(true, forKey: "liveActivityEnabled")
    withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
        currentPage += 1
    }
```

In `pageView(for:)`, add:
```swift
case .liveActivityPermission:
    standardPageView(for: page)
```

The "Skip" behavior is handled by the existing close/skip button which moves to the next page without enabling the setting. Add a default:
```swift
// In init or onAppear, ensure default is false
// UserDefaults.standard.register(defaults: ["liveActivityEnabled": false])
```

- [ ] **Step 3: Build and verify**

Expected: No errors. Onboarding now has 7 pages instead of 6.

- [ ] **Step 4: Commit**

```bash
git add Outspire/Features/Main/Views/OnboardingView.swift
git commit -m "feat: add Live Activity permission page to onboarding"
```

---

## Task 12: Settings — Live Activity Toggle

**Files:**
- Modify: `Outspire/Features/Settings/Views/SettingsNotificationsView.swift`

- [ ] **Step 1: Add Live Activity toggle to Settings > Notifications**

In `SettingsNotificationsView`, add a new section:

```swift
Section {
    Toggle(isOn: Binding(
        get: { UserDefaults.standard.bool(forKey: "liveActivityEnabled") },
        set: { UserDefaults.standard.set($0, forKey: "liveActivityEnabled") }
    )) {
        Label("Live Activity", systemImage: "clock.badge.checkmark")
    }
} header: {
    Text("Lock Screen")
} footer: {
    Text("Show class countdown on your Lock Screen and Dynamic Island. Starts automatically before your first class.")
        .font(.footnote)
        .foregroundColor(.secondary)
}
```

- [ ] **Step 2: Build and verify**

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add Outspire/Features/Settings/Views/SettingsNotificationsView.swift
git commit -m "feat: add Live Activity toggle to notification settings"
```

---

## Task 13: School Calendar JSON

**Files:**
- Create: `calendar/2026.json`

- [ ] **Step 1: Create initial school calendar file**

```json
{
  "school": "WFLA",
  "academicYear": "2025-2026",
  "semesters": [
    { "start": "2025-09-01", "end": "2026-01-17" },
    { "start": "2026-02-17", "end": "2026-06-30" }
  ],
  "specialDays": []
}
```

- [ ] **Step 2: Commit**

```bash
git add calendar/
git commit -m "feat: add school calendar JSON for widget/worker consumption"
```

---

## Task 14: Final Build Verification

- [ ] **Step 1: Build both targets**

```bash
xcodebuild -project Outspire.xcodeproj -scheme Outspire -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -3
xcodebuild -project Outspire.xcodeproj -scheme OutspireWidget -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -3
```

Expected: Both `** BUILD SUCCEEDED **`

- [ ] **Step 2: Run on simulator and verify widget appears in gallery**

1. Build and run the main app on simulator
2. Long-press Home Screen → "+" → search "Outspire"
3. Verify both Small and Medium widgets appear
4. Add both to Home Screen
5. Small widget should show placeholder (not signed in)
6. Sign in → widgets should update

- [ ] **Step 3: Final commit if any fixes needed**

---

## Next Plans

After this plan is complete:

1. **Plan 2: Live Activity UI + ActivityKit Integration** — ClassActivityAttributes, Lock Screen/Dynamic Island views, ClassActivityManager, local start/stop from app
2. **Plan 3: CF Worker + Push Integration** — Cloudflare Worker, APNs JWT signing, cron scheduling, `/register` endpoint, push token registration from app
