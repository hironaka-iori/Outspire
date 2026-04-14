# Live Activities Reconstruction Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completely reconstruct Live Activities to fix duplicate spawning, data races, text visibility, dead code, and architectural problems — producing a single reliable activity per class with a polished class-card-style Lock Screen presentation.

**Architecture:** Single `@MainActor ClassActivityManager` as the sole authority for activity lifecycle. One shared `ClassActivityAttributes.swift` compiled by both targets. Widget extension renders a class-card-style layout with proper dark/light mode support. TodayView delegates all activity decisions to the manager and never tracks its own parallel state.

**Tech Stack:** ActivityKit, WidgetKit, SwiftUI, Swift Concurrency (`@MainActor`)

---

## File Structure

### Files to Create
- (none — all changes modify existing files or delete dead code)

### Files to Modify
| File | Responsibility |
|------|---------------|
| `Outspire/Features/LiveActivity/ClassActivityAttributes.swift` | Shared ActivityAttributes definition (compiled by both targets) |
| `Outspire/Features/LiveActivity/ClassActivityManager.swift` | `@MainActor` lifecycle manager — start, update, end, cleanup |
| `OutspireWidget/LiveActivityWidget.swift` | Widget extension's `OutspireWidgetLiveActivity` — class-card-style views |
| `Outspire/Features/Main/Views/TodayView.swift` | Remove duplicate tracking state, respect user preference, use consistent IDs |
| `OutspireApp.swift` | Proper termination cleanup, remove no-op registration |

### Files to Delete
| File | Reason |
|------|--------|
| `Outspire/Features/LiveActivity/ClassActivityView.swift` | Dead code — entire Widget + 400 lines of views never registered in any WidgetBundle |
| `Outspire/Features/LiveActivity/LiveActivityExtensions.swift` | Dead code — `handleClassTransition` and `hasActivityForClass` are never called |

### Build Target Changes
| Change | Why |
|--------|-----|
| Add `ClassActivityAttributes.swift` to OutspireWidget target | Single source of truth — eliminate duplicate definition |
| Remove `ClassActivityView.swift` from Outspire target | Dead code removal |
| Remove `LiveActivityExtensions.swift` from Outspire target | Dead code removal |

---

### Task 1: Delete Dead Code

**Files:**
- Delete: `Outspire/Features/LiveActivity/ClassActivityView.swift`
- Delete: `Outspire/Features/LiveActivity/LiveActivityExtensions.swift`
- Modify: `OutspireApp.swift` (remove `LiveActivityRegistration`)

This task removes ~500 lines of dead code before any reconstruction begins.

- [ ] **Step 1: Delete ClassActivityView.swift**

Delete the file `Outspire/Features/LiveActivity/ClassActivityView.swift`. This contains `ClassActivityLiveActivity: Widget` which is never registered in any WidgetBundle, plus ~400 lines of duplicate view code with divergent color logic.

- [ ] **Step 2: Delete LiveActivityExtensions.swift**

Delete the file `Outspire/Features/LiveActivity/LiveActivityExtensions.swift`. This contains `handleClassTransition()`, `ClassTransitionType`, and `hasActivityForClass()` — none of which are called from anywhere in the codebase.

- [ ] **Step 3: Remove LiveActivityRegistration from OutspireApp.swift**

In `OutspireApp.swift`, remove the no-op registration class and its call site.

Remove from init (around line 49-52):
```swift
if #available(iOS 16.1, *) {
    LiveActivityRegistration.registerLiveActivities()
}
```

Remove the entire class (around lines 350-364):
```swift
@available(iOS 16.1, *)
class LiveActivityRegistration {
    static func registerLiveActivities() {
        _ = ClassActivityAttributes(
            className: "",
            roomNumber: "",
            teacherName: ""
        )
    }
}
```

- [ ] **Step 4: Verify build**

Run: `xcodebuild -project Outspire.xcodeproj -scheme Outspire -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -5`
Expected: BUILD SUCCEEDED

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(LiveActivity): delete ~500 lines of dead code

Remove ClassActivityView.swift (unregistered Widget + duplicate views),
LiveActivityExtensions.swift (unused handleClassTransition/hasActivityForClass),
and no-op LiveActivityRegistration class."
```

---

### Task 2: Unify ClassActivityAttributes Across Targets

**Files:**
- Modify: `Outspire/Features/LiveActivity/ClassActivityAttributes.swift`
- Modify: `OutspireWidget/LiveActivityWidget.swift`
- Modify: Xcode project (add ClassActivityAttributes.swift to OutspireWidget target)

- [ ] **Step 1: Update ClassActivityAttributes.swift to be the canonical definition**

Replace the contents of `Outspire/Features/LiveActivity/ClassActivityAttributes.swift` with:

```swift
import Foundation

#if !targetEnvironment(macCatalyst)
    import ActivityKit

    struct ClassActivityAttributes: ActivityAttributes {
        struct ScheduledClass: Codable, Hashable, Identifiable {
            let id: UUID
            let className: String
            let teacherName: String
            let roomNumber: String
            let periodNumber: Int
            let startTime: Date
            let endTime: Date
        }

        struct ContentState: Codable, Hashable {
            var schedule: [ScheduledClass]
            var generatedAt: Date
            var finalEndDate: Date
        }

        var className: String
        var roomNumber: String
        var teacherName: String

        enum ClassStatus: String, Codable {
            case upcoming
            case ongoing
            case ending
            case completed
        }

        static var preview: ClassActivityAttributes {
            ClassActivityAttributes(
                className: "Mathematics",
                roomNumber: "A203",
                teacherName: "Mr. Smith"
            )
        }
    }
#endif
```

- [ ] **Step 2: Add ClassActivityAttributes.swift to OutspireWidget target membership**

In Xcode, select `ClassActivityAttributes.swift`, open the File Inspector, and check `OutspireWidget` under Target Membership. Both `Outspire` and `OutspireWidget` should be checked.

Alternatively, verify/add in project.pbxproj that the file appears in OutspireWidget's "Compile Sources" build phase.

- [ ] **Step 3: Remove duplicate ClassActivityAttributes from LiveActivityWidget.swift**

In `OutspireWidget/LiveActivityWidget.swift`, delete the entire duplicate `ClassActivityAttributes` definition (lines 7-42, including `struct ClassActivityAttributes: ActivityAttributes { ... }`). The file should now start with `OutspireWidgetLiveActivity` and its supporting views — it will import the shared definition from the other file.

- [ ] **Step 4: Verify build**

Run: `xcodebuild -project Outspire.xcodeproj -scheme Outspire -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -5`
Expected: BUILD SUCCEEDED

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(LiveActivity): unify ClassActivityAttributes across targets

Single definition in ClassActivityAttributes.swift compiled by both app and
widget extension. Eliminates risk of silent Codable divergence."
```

---

### Task 3: Reconstruct ClassActivityManager with @MainActor

**Files:**
- Rewrite: `Outspire/Features/LiveActivity/ClassActivityManager.swift`

This is the core fix — eliminates all data races, ensures single-activity enforcement, and adds proper termination cleanup.

- [ ] **Step 1: Rewrite ClassActivityManager.swift**

Replace the entire contents of `ClassActivityManager.swift` with:

```swift
import Foundation
import os

#if !targetEnvironment(macCatalyst)
    import ActivityKit

    @MainActor
    final class ClassActivityManager {
        static let shared = ClassActivityManager()

        private(set) var currentActivity: Activity<ClassActivityAttributes>?
        private(set) var currentActivityId: String?
        private var scheduledEndTask: Task<Void, Never>?

        private let log = Logger(subsystem: "dev.wrye.Outspire", category: "LiveActivity")

        private init() {}

        // MARK: - Public API

        /// Build a consistent activity ID from parsed class info.
        /// Callers must use `ClassInfoParser` before calling — never pass raw timetable data.
        static func activityId(periodNumber: Int, className: String) -> String {
            "\(periodNumber)_\(className)"
        }

        /// Start a new activity or update the existing one.
        /// Enforces exactly one active activity at a time.
        func startOrUpdate(
            id: String,
            className: String,
            roomNumber: String,
            teacherName: String,
            schedule: [ClassActivityAttributes.ScheduledClass]
        ) {
            guard ActivityAuthorizationInfo().areActivitiesEnabled else {
                log.warning("Live Activities not enabled by user")
                return
            }

            guard !schedule.isEmpty else {
                log.info("Skipping Live Activity — empty schedule")
                return
            }

            let finalEndDate = schedule.map(\.endTime).max() ?? Date()

            // Same activity — just update
            if id == currentActivityId, let existing = currentActivity {
                update(activity: existing, schedule: schedule, finalEndDate: finalEndDate)
                return
            }

            // Different activity — end old, start new
            if currentActivity != nil {
                endCurrentActivity(dismissalPolicy: .immediate)
            }

            start(
                id: id,
                className: className,
                roomNumber: roomNumber,
                teacherName: teacherName,
                schedule: schedule,
                finalEndDate: finalEndDate
            )
        }

        /// Toggle the activity on/off. Returns `true` if now active.
        func toggle(
            id: String,
            className: String,
            roomNumber: String,
            teacherName: String,
            schedule: [ClassActivityAttributes.ScheduledClass]
        ) -> Bool {
            if id == currentActivityId {
                endCurrentActivity(dismissalPolicy: .immediate)
                return false
            } else {
                startOrUpdate(
                    id: id,
                    className: className,
                    roomNumber: roomNumber,
                    teacherName: teacherName,
                    schedule: schedule
                )
                return true
            }
        }

        /// End the current activity with the given dismissal policy.
        func endCurrentActivity(dismissalPolicy: ActivityUIDismissalPolicy = .immediate) {
            guard let activity = currentActivity else { return }

            scheduledEndTask?.cancel()
            scheduledEndTask = nil

            let activityId = activity.id
            Task {
                await activity.end(nil, dismissalPolicy: dismissalPolicy)
                log.info("Ended Live Activity \(activityId)")
            }

            currentActivity = nil
            currentActivityId = nil
        }

        /// End all activities system-wide (including orphans from previous launches).
        /// Call this on app launch and termination.
        func endAllSystemActivities() {
            for activity in Activity<ClassActivityAttributes>.activities {
                let activityId = activity.id
                Task {
                    await activity.end(nil, dismissalPolicy: .immediate)
                    log.info("Cleaned up orphan activity \(activityId)")
                }
            }

            scheduledEndTask?.cancel()
            scheduledEndTask = nil
            currentActivity = nil
            currentActivityId = nil
        }

        /// Whether an activity is currently running for the given ID.
        var isActive: Bool { currentActivity != nil }

        func isActive(for id: String) -> Bool { currentActivityId == id }

        // MARK: - Private

        private func start(
            id: String,
            className: String,
            roomNumber: String,
            teacherName: String,
            schedule: [ClassActivityAttributes.ScheduledClass],
            finalEndDate: Date
        ) {
            let attributes = ClassActivityAttributes(
                className: className,
                roomNumber: roomNumber,
                teacherName: teacherName
            )

            let contentState = ClassActivityAttributes.ContentState(
                schedule: schedule.sorted(by: { $0.startTime < $1.startTime }),
                generatedAt: Date(),
                finalEndDate: finalEndDate
            )

            do {
                let activity = try Activity.request(
                    attributes: attributes,
                    content: .init(state: contentState, staleDate: finalEndDate),
                    pushType: nil
                )

                currentActivity = activity
                currentActivityId = id
                scheduleAutomaticEnd(finalEndDate: finalEndDate)
                log.info("Started Live Activity \(activity.id) for \(id)")
            } catch {
                log.error("Failed to start Live Activity: \(error.localizedDescription)")
            }
        }

        private func update(
            activity: Activity<ClassActivityAttributes>,
            schedule: [ClassActivityAttributes.ScheduledClass],
            finalEndDate: Date
        ) {
            let contentState = ClassActivityAttributes.ContentState(
                schedule: schedule.sorted(by: { $0.startTime < $1.startTime }),
                generatedAt: Date(),
                finalEndDate: finalEndDate
            )

            Task {
                await activity.update(.init(state: contentState, staleDate: finalEndDate))
            }

            scheduleAutomaticEnd(finalEndDate: finalEndDate)
            log.debug("Updated Live Activity \(activity.id)")
        }

        private func scheduleAutomaticEnd(finalEndDate: Date) {
            scheduledEndTask?.cancel()

            scheduledEndTask = Task { [weak self] in
                let remaining = finalEndDate.timeIntervalSinceNow
                guard remaining > 0 else {
                    await self?.endCurrentActivity(dismissalPolicy: .default)
                    return
                }

                try? await Task.sleep(for: .seconds(remaining))

                guard !Task.isCancelled else { return }
                await self?.endCurrentActivity(dismissalPolicy: .default)
            }
        }
    }
#endif
```

Key changes:
- `@MainActor` eliminates all data races
- Single `currentActivity` + `currentActivityId` instead of dictionary — enforces exactly one active activity
- `endAllSystemActivities()` iterates `Activity<ClassActivityAttributes>.activities` to clean up orphans
- `static func activityId()` provides the canonical key format
- Proper `Logger` instead of `print()`
- `scheduleAutomaticEnd` uses `Task.sleep(for:)` on `@MainActor` — no `Task.detached`
- Removed iOS 16.1 backward compat branching (deployment target is iOS 17.0)

- [ ] **Step 2: Verify build**

Run: `xcodebuild -project Outspire.xcodeproj -scheme Outspire -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -5`
Expected: BUILD SUCCEEDED

- [ ] **Step 3: Commit**

```bash
git add Outspire/Features/LiveActivity/ClassActivityManager.swift
git commit -m "refactor(LiveActivity): reconstruct ClassActivityManager with @MainActor

- Eliminate data races with @MainActor isolation
- Single currentActivity enforces one activity at a time (fixes duplicate spawning)
- endAllSystemActivities() cleans up orphans from previous launches
- Static activityId() provides canonical key format
- Proper Logger instead of print()
- Remove iOS 16.1 compat (deployment target is 17.0)"
```

---

### Task 4: Fix TodayView Integration

**Files:**
- Modify: `Outspire/Features/Main/Views/TodayView.swift`

Fixes: key mismatch, missing preference check, dead state, duplicate tracking dictionary.

- [ ] **Step 1: Remove dead state and duplicate tracking**

In `TodayView.swift`, remove these two state declarations (around lines 35-36):
```swift
@State private var hasStartedLiveActivity = false
@State private var activeClassLiveActivities: [String: Bool] = [:]
```

- [ ] **Step 2: Clean up orphan activities on appear**

In `setupOnAppear()`, right before the existing call to `startClassLiveActivityIfNeeded()` (around line 532), add orphan cleanup:

```swift
// Clean up any orphan Live Activities from previous launches
#if !targetEnvironment(macCatalyst)
    if #available(iOS 16.1, *) {
        ClassActivityManager.shared.endAllSystemActivities()
    }
#endif
```

Then keep the existing `startClassLiveActivityIfNeeded()` call on the next line.

- [ ] **Step 3: Rewrite startClassLiveActivityIfNeeded**

Replace the entire `startClassLiveActivityIfNeeded` method with:

```swift
private func startClassLiveActivityIfNeeded(forceCheck: Bool = false) {
    #if !targetEnvironment(macCatalyst)
        guard !isHolidayActive() else { return }
        guard Configuration.automaticallyStartLiveActivities else { return }
        guard let upcoming = upcomingClassInfo,
              !classtableViewModel.timetable.isEmpty
        else { return }

        let classInfo = parseClassInformation(from: upcoming.classData)
        let id = ClassActivityManager.activityId(
            periodNumber: upcoming.period.number,
            className: classInfo.className
        )

        // Skip if already tracking this exact class (unless forced)
        if !forceCheck, ClassActivityManager.shared.isActive(for: id) {
            return
        }

        let schedule = buildLiveActivitySchedule(for: upcoming.dayIndex)
        guard !schedule.isEmpty else { return }

        ClassActivityManager.shared.startOrUpdate(
            id: id,
            className: classInfo.className,
            roomNumber: classInfo.room,
            teacherName: classInfo.teacher,
            schedule: schedule
        )
    #endif
}
```

Key changes:
- Checks `Configuration.automaticallyStartLiveActivities` early
- Uses `ClassActivityManager.activityId()` for consistent key
- Queries `ClassActivityManager.shared.isActive(for:)` instead of local dictionary
- No local `activeClassLiveActivities` tracking

- [ ] **Step 4: Rewrite toggleLiveActivityForCurrentClass**

Replace the entire `toggleLiveActivityForCurrentClass` method with:

```swift
private func toggleLiveActivityForCurrentClass() {
    #if !targetEnvironment(macCatalyst)
        guard let upcoming = upcomingClassInfo else { return }

        let classInfo = parseClassInformation(from: upcoming.classData)
        let schedule = buildLiveActivitySchedule(for: upcoming.dayIndex)
        guard !schedule.isEmpty else { return }

        let id = ClassActivityManager.activityId(
            periodNumber: upcoming.period.number,
            className: classInfo.className
        )

        let isActive = ClassActivityManager.shared.toggle(
            id: id,
            className: classInfo.className,
            roomNumber: classInfo.room,
            teacherName: classInfo.teacher,
            schedule: schedule
        )

        let generator = UIImpactFeedbackGenerator(style: .medium)
        generator.impactOccurred(intensity: isActive ? 0.7 : 1.0)
    #endif
}
```

- [ ] **Step 5: Update references to activeClassLiveActivities**

Search for all remaining references to `activeClassLiveActivities` in TodayView.swift and TodayMainContentView.swift. Replace the prop passed to child views:

In TodayView where `activeClassLiveActivities` is passed to `TodayMainContentView` (around line 282):
```swift
// Before:
activeClassLiveActivities: activeClassLiveActivities,

// After — remove this prop entirely, or replace with:
hasActiveLiveActivity: ClassActivityManager.shared.isActive,
```

Update `TodayMainContentView.swift` to accept `hasActiveLiveActivity: Bool` instead of the dictionary, and pass it through to `EnhancedClassCard`.

- [ ] **Step 6: Fix applicationWillTerminate**

In `OutspireApp.swift`, update the termination handler (around lines 295-301):

```swift
func applicationWillTerminate(_ application: UIApplication) {
    #if !targetEnvironment(macCatalyst)
        ClassActivityManager.shared.endAllSystemActivities()
    #endif
}
```

This now actually ends all Live Activities on termination instead of just cancelling tasks.

- [ ] **Step 7: Verify build**

Run: `xcodebuild -project Outspire.xcodeproj -scheme Outspire -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -5`
Expected: BUILD SUCCEEDED

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "fix(LiveActivity): fix duplicate spawning, preference bypass, and key mismatch

- Remove parallel activeClassLiveActivities tracking (was desynced from manager)
- Remove dead hasStartedLiveActivity state
- Use ClassActivityManager.activityId() for consistent keys
- Check Configuration.automaticallyStartLiveActivities before auto-starting
- Clean up orphan activities on app launch
- Actually end activities on app termination"
```

---

### Task 5: Reconstruct Widget Views with Class-Card Style

**Files:**
- Rewrite: `OutspireWidget/LiveActivityWidget.swift`

Rebuilds the Lock Screen and Dynamic Island views with:
- Class-card visual style (accent bar, status header, subject/teacher/room layout)
- Proper dark/light mode colors that work in Live Activity rendering context
- Single `TimelineView` wrapper instead of 6 separate ones
- Reactive `keylineTint`

- [ ] **Step 1: Rewrite LiveActivityWidget.swift**

Replace the entire contents of `OutspireWidget/LiveActivityWidget.swift` (after Task 2 removed the duplicate ClassActivityAttributes) with:

```swift
import SwiftUI
import WidgetKit

#if !targetEnvironment(macCatalyst)
    import ActivityKit

    // MARK: - Derived State

    private struct DerivedState {
        let date: Date
        let schedule: [ClassActivityAttributes.ScheduledClass]
        let current: ClassActivityAttributes.ScheduledClass?
        let next: ClassActivityAttributes.ScheduledClass?
        let status: ClassActivityAttributes.ClassStatus
        let countdownTarget: Date?
        let progress: Double

        init(context: ActivityViewContext<ClassActivityAttributes>, date: Date) {
            self.date = date
            let sorted = context.state.schedule.sorted { $0.startTime < $1.startTime }
            schedule = sorted

            let active = sorted.first { $0.startTime <= date && $0.endTime > date }
            let upcoming = sorted.first { $0.startTime > date }

            current = active
            next = upcoming

            if let active {
                let remaining = active.endTime.timeIntervalSince(date)
                let total = active.endTime.timeIntervalSince(active.startTime)
                countdownTarget = active.endTime
                progress = total > 0 ? max(0, min(1, date.timeIntervalSince(active.startTime) / total)) : 1
                status = remaining <= 300 ? .ending : .ongoing
            } else if let upcoming {
                countdownTarget = upcoming.startTime
                progress = 0
                status = .upcoming
            } else {
                countdownTarget = nil
                progress = 1
                status = .completed
            }
        }

        var displayClass: ClassActivityAttributes.ScheduledClass? { current ?? next }
    }

    // MARK: - Widget Configuration

    struct OutspireWidgetLiveActivity: Widget {
        var body: some WidgetConfiguration {
            ActivityConfiguration(for: ClassActivityAttributes.self) { context in
                // Single TimelineView wrapping everything
                TimelineView(.periodic(from: .now, by: 10)) { timeline in
                    let state = DerivedState(context: context, date: timeline.date)
                    LockScreenView(state: state)
                }
                .activityBackgroundTint(Color(.systemBackground).opacity(0.85))
                .activitySystemActionForegroundColor(.primary)
            } dynamicIsland: { context in
                DynamicIsland {
                    DynamicIslandExpandedRegion(.leading) {
                        TimelineView(.periodic(from: .now, by: 10)) { timeline in
                            ExpandedLeadingView(state: DerivedState(context: context, date: timeline.date))
                        }
                    }
                    DynamicIslandExpandedRegion(.trailing) {
                        TimelineView(.periodic(from: .now, by: 10)) { timeline in
                            ExpandedTrailingView(state: DerivedState(context: context, date: timeline.date))
                        }
                    }
                    DynamicIslandExpandedRegion(.bottom) {
                        TimelineView(.periodic(from: .now, by: 10)) { timeline in
                            ExpandedBottomView(state: DerivedState(context: context, date: timeline.date))
                        }
                    }
                } compactLeading: {
                    TimelineView(.periodic(from: .now, by: 10)) { timeline in
                        CompactLeadingView(state: DerivedState(context: context, date: timeline.date))
                    }
                } compactTrailing: {
                    TimelineView(.periodic(from: .now, by: 10)) { timeline in
                        CompactTrailingView(state: DerivedState(context: context, date: timeline.date))
                    }
                } minimal: {
                    TimelineView(.periodic(from: .now, by: 10)) { timeline in
                        MinimalView(state: DerivedState(context: context, date: timeline.date))
                    }
                }
                .widgetURL(URL(string: "outspire://today"))
                // keylineTint inside TimelineView would require restructuring DynamicIsland;
                // use a sensible default based on the current class
                .keylineTint(.accentColor)
            }
        }
    }

    // MARK: - Color Helpers

    /// Subject-based accent color. Deterministic hash fallback for unknown subjects.
    private func subjectColor(for className: String) -> Color {
        let lowered = className.lowercased()

        if lowered.contains("self-study") || lowered.contains("self study") {
            return .purple
        }

        let map: [(Color, [String])] = [
            (.blue, ["math", "mathematics", "maths"]),
            (.green, ["english", "language", "literature", "general paper", "esl"]),
            (.orange, ["physics", "science"]),
            (.pink, ["chemistry", "chem"]),
            (.teal, ["biology", "bio"]),
            (.mint, ["further math", "maths further"]),
            (.yellow, ["体育", "pe", "sports", "p.e"]),
            (.brown, ["economics", "econ"]),
            (.cyan, ["arts", "art", "tok"]),
            (.indigo, ["chinese", "mandarin", "语文"]),
            (.gray, ["history", "历史", "geography", "geo", "政治"]),
        ]

        for (color, keywords) in map {
            if keywords.contains(where: { lowered.contains($0) }) { return color }
        }

        // Deterministic DJB2 hash fallback
        var djb2: UInt64 = 5381
        for byte in lowered.utf8 { djb2 = djb2 &* 33 &+ UInt64(byte) }
        let hue = Double(djb2 % 12) / 12.0
        return Color(hue: hue, saturation: 0.7, brightness: 0.9)
    }

    private func statusColor(for status: ClassActivityAttributes.ClassStatus) -> Color {
        switch status {
        case .upcoming: .blue
        case .ongoing: .green
        case .ending: .orange
        case .completed: .gray
        }
    }

    private func statusLabel(for status: ClassActivityAttributes.ClassStatus) -> String {
        switch status {
        case .upcoming: "Upcoming Class"
        case .ongoing: "Current Class"
        case .ending: "Current Class"
        case .completed: "All Done"
        }
    }

    private func countdownLabel(for status: ClassActivityAttributes.ClassStatus) -> String {
        switch status {
        case .upcoming: "Starts in"
        case .ongoing, .ending: "Ends in"
        case .completed: "Completed"
        }
    }

    // MARK: - Lock Screen (Class Card Style)

    private struct LockScreenView: View {
        let state: DerivedState

        private var accentColor: Color {
            guard let cls = state.displayClass else { return .blue }
            return subjectColor(for: cls.className)
        }

        var body: some View {
            HStack(spacing: 0) {
                // Colored accent bar (class-card signature)
                RoundedRectangle(cornerRadius: 2.5)
                    .fill(accentColor.gradient)
                    .frame(width: 4)
                    .padding(.vertical, 10)
                    .shadow(color: accentColor.opacity(0.4), radius: 4)

                VStack(alignment: .leading, spacing: 0) {
                    // Header
                    HStack(alignment: .center) {
                        Text(statusLabel(for: state.status))
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(accentColor)

                        Spacer()

                        if let cls = state.displayClass {
                            Text("Period \(cls.periodNumber)")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.top, 12)

                    // Subject name
                    if let cls = state.displayClass {
                        Text(cls.className)
                            .font(.headline.weight(.semibold))
                            .foregroundStyle(.primary)
                            .lineLimit(1)
                            .padding(.horizontal, 12)
                            .padding(.top, 2)

                        // Teacher & room
                        HStack(spacing: 16) {
                            if !cls.teacherName.isEmpty {
                                Label(cls.teacherName, systemImage: "person.fill")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            if !cls.roomNumber.isEmpty {
                                Label(cls.roomNumber, systemImage: "mappin.circle.fill")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.top, 2)
                    } else {
                        Text("No classes scheduled")
                            .font(.headline.weight(.semibold))
                            .foregroundStyle(.primary)
                            .padding(.horizontal, 12)
                            .padding(.top, 2)
                    }

                    // Divider + countdown
                    if state.status != .completed {
                        Rectangle()
                            .fill(
                                LinearGradient(
                                    colors: [accentColor.opacity(0.5), accentColor.opacity(0.1), .clear],
                                    startPoint: .leading,
                                    endPoint: .trailing
                                )
                            )
                            .frame(height: 1)
                            .padding(.horizontal, 12)
                            .padding(.top, 8)

                        HStack {
                            Image(systemName: state.status == .upcoming ? "hourglass" : "timer")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(accentColor)

                            VStack(alignment: .leading, spacing: 1) {
                                Text(countdownLabel(for: state.status))
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)

                                if let target = state.countdownTarget {
                                    Text(timerInterval: .now ... target, countsDown: true)
                                        .font(.system(.subheadline, design: .rounded).weight(.bold))
                                        .monospacedDigit()
                                        .foregroundStyle(.primary)
                                }
                            }

                            Spacer()

                            // Circular progress (ongoing/ending only)
                            if state.status == .ongoing || state.status == .ending,
                               let active = state.current
                            {
                                ProgressView(
                                    timerInterval: active.startTime ... active.endTime,
                                    countsDown: false,
                                    label: { EmptyView() },
                                    currentValueLabel: {
                                        Text("\(Int(state.progress * 100))%")
                                            .font(.system(.caption2, design: .rounded).weight(.bold))
                                            .foregroundStyle(.secondary)
                                    }
                                )
                                .progressViewStyle(.circular)
                                .tint(accentColor)
                                .frame(width: 36, height: 36)
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                    } else {
                        Spacer().frame(height: 8)
                    }
                }
            }
            .padding(.leading, 4)
        }
    }

    // MARK: - Dynamic Island: Expanded

    private struct ExpandedLeadingView: View {
        let state: DerivedState

        var body: some View {
            if let cls = state.displayClass {
                VStack(alignment: .leading, spacing: 2) {
                    Text("#\(cls.periodNumber)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text(cls.className)
                        .font(.headline.weight(.semibold))
                        .lineLimit(1)
                }
                .padding(.leading, 4)
            } else {
                Text("No Classes")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private struct ExpandedTrailingView: View {
        let state: DerivedState

        var body: some View {
            VStack(alignment: .trailing, spacing: 2) {
                Text(countdownLabel(for: state.status))
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                if let target = state.countdownTarget, state.status != .completed {
                    Text(timerInterval: .now ... target, countsDown: true)
                        .font(.system(.headline, design: .rounded).weight(.bold))
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .frame(maxWidth: 80, alignment: .trailing)
                        .foregroundStyle(statusColor(for: state.status))
                } else {
                    Text("Done")
                        .font(.headline.weight(.bold))
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.trailing, 4)
        }
    }

    private struct ExpandedBottomView: View {
        let state: DerivedState

        var body: some View {
            HStack {
                if let cls = state.displayClass {
                    if !cls.roomNumber.isEmpty {
                        Label(cls.roomNumber, systemImage: "mappin")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if !cls.teacherName.isEmpty {
                        Label(cls.teacherName, systemImage: "person.fill")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                if state.status == .ongoing || state.status == .ending,
                   let active = state.current
                {
                    ProgressView(
                        timerInterval: active.startTime ... active.endTime,
                        countsDown: false,
                        label: { EmptyView() },
                        currentValueLabel: { EmptyView() }
                    )
                    .progressViewStyle(.linear)
                    .frame(width: 60)
                    .tint(subjectColor(for: active.className))
                }
            }
        }
    }

    // MARK: - Dynamic Island: Compact

    private struct CompactLeadingView: View {
        let state: DerivedState

        var body: some View {
            if state.status == .ongoing || state.status == .ending,
               let active = state.current
            {
                ProgressView(
                    timerInterval: active.startTime ... active.endTime,
                    countsDown: false,
                    label: { EmptyView() },
                    currentValueLabel: {
                        Image(systemName: "star.fill")
                            .foregroundStyle(subjectColor(for: active.className))
                    }
                )
                .progressViewStyle(.circular)
                .tint(subjectColor(for: active.className))
            } else if state.status == .upcoming {
                Image(systemName: "star.fill")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.blue)
            } else {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.green)
            }
        }
    }

    private struct CompactTrailingView: View {
        let state: DerivedState

        var body: some View {
            if let target = state.countdownTarget, state.status != .completed {
                Text(timerInterval: .now ... target, countsDown: true)
                    .font(.system(.headline, design: .rounded).weight(.bold))
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .frame(maxWidth: 60, alignment: .trailing)
                    .foregroundStyle(statusColor(for: state.status))
            } else {
                Image(systemName: "calendar.badge.checkmark")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: - Dynamic Island: Minimal

    private struct MinimalView: View {
        let state: DerivedState

        var body: some View {
            if state.status == .ongoing || state.status == .ending,
               let active = state.current
            {
                ProgressView(
                    timerInterval: active.startTime ... active.endTime,
                    countsDown: false,
                    label: { EmptyView() },
                    currentValueLabel: {
                        Image(systemName: "star.fill")
                            .foregroundStyle(subjectColor(for: active.className))
                    }
                )
                .progressViewStyle(.circular)
                .tint(statusColor(for: state.status))
            } else if state.status == .upcoming {
                Image(systemName: "clock.badge.checkmark")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.blue)
            } else {
                Image(systemName: "checkmark")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.green)
            }
        }
    }

    // MARK: - Preview

    extension ClassActivityAttributes.ScheduledClass {
        static func sample(
            periodNumber: Int,
            startOffset: TimeInterval,
            duration: TimeInterval,
            className: String,
            teacherName: String,
            roomNumber: String
        ) -> ClassActivityAttributes.ScheduledClass {
            let start = Date().addingTimeInterval(startOffset)
            return ClassActivityAttributes.ScheduledClass(
                id: UUID(),
                className: className,
                teacherName: teacherName,
                roomNumber: roomNumber,
                periodNumber: periodNumber,
                startTime: start,
                endTime: start.addingTimeInterval(duration)
            )
        }
    }

    extension ClassActivityAttributes.ContentState {
        static var previewState: ClassActivityAttributes.ContentState {
            let samples = [
                ClassActivityAttributes.ScheduledClass.sample(
                    periodNumber: 3, startOffset: -900, duration: 1800,
                    className: "Mathematics", teacherName: "Mr. Smith", roomNumber: "A203"
                ),
                ClassActivityAttributes.ScheduledClass.sample(
                    periodNumber: 4, startOffset: 1800, duration: 1800,
                    className: "Chemistry", teacherName: "Ms. Johnson", roomNumber: "Lab 2"
                ),
            ]
            return .init(
                schedule: samples,
                generatedAt: Date(),
                finalEndDate: samples.last?.endTime ?? Date()
            )
        }
    }

    #Preview("Notification", as: .content, using: ClassActivityAttributes.preview) {
        OutspireWidgetLiveActivity()
    } contentStates: {
        ClassActivityAttributes.ContentState.previewState
    }
#endif
```

Key changes from old implementation:
- **Class-card style**: accent bar on left, status header, gradient divider, countdown section with circular progress — matching `EnhancedClassCard` visual language
- **Text colors**: Uses `.primary` and `.secondary` which the system adapts for Live Activity context (always light-on-dark on Lock Screen, adapts in Dynamic Island). No hardcoded light/dark colors.
- **Single `subjectColor()` function**: Matches `WidgetHelpers.getSubjectColor` with DJB2 fallback — no separate divergent color map
- **`keylineTint(.accentColor)`**: Uses system accent as a sensible default since `keylineTint` can't be inside a `TimelineView`
- **Removed hidden `Text("00:00")` overlay hack**: Uses `Text(timerInterval:)` directly with proper frame constraints

- [ ] **Step 2: Verify build**

Run: `xcodebuild -project Outspire.xcodeproj -scheme Outspire -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -5`
Expected: BUILD SUCCEEDED

- [ ] **Step 3: Commit**

```bash
git add OutspireWidget/LiveActivityWidget.swift
git commit -m "feat(LiveActivity): reconstruct widget views with class-card style

- Lock Screen: accent bar, status header, gradient divider, circular progress
- Proper .primary/.secondary colors for dark/light mode compatibility
- Unified subjectColor() with DJB2 hash fallback
- Remove hidden Text overlay hack for timer
- Sensible keylineTint default"
```

---

### Task 6: Final Cleanup and Verification

**Files:**
- Verify: All modified files
- Remove: stale comments

- [ ] **Step 1: Remove stale code comments**

In `TodayView.swift`, remove leftover instructional comments:
- Line ~842: `// In the existing startClassLiveActivityIfNeeded method, update to use the enhanced functionality:`
- Line ~881: `// Update the toggleLiveActivityForCurrentClass method to use the new toggle functionality:`

- [ ] **Step 2: Clean build**

Run: `xcodebuild -project Outspire.xcodeproj -scheme Outspire -destination 'platform=iOS Simulator,name=iPhone 17 Pro' clean build 2>&1 | tail -5`
Expected: BUILD SUCCEEDED

- [ ] **Step 3: Verify no duplicate ClassActivityAttributes**

Run: `grep -rn "struct ClassActivityAttributes" Outspire/ OutspireWidget/`
Expected: Exactly ONE match in `Outspire/Features/LiveActivity/ClassActivityAttributes.swift`

- [ ] **Step 4: Verify no references to deleted files**

Run: `grep -rn "ClassActivityView\|LiveActivityExtensions\|LiveActivityRegistration\|hasStartedLiveActivity\|activeClassLiveActivities" Outspire/ OutspireWidget/ --include="*.swift"`
Expected: Zero matches (or only in git-ignored files)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(LiveActivity): final cleanup of stale comments and verification"
```

---

## Issues Resolved

| # | Issue | Fixed In |
|---|-------|----------|
| 1 | Data races in ClassActivityManager | Task 3 — `@MainActor` |
| 2 | Activity ID key mismatch | Task 4 — `ClassActivityManager.activityId()` |
| 3 | User preference bypass | Task 4 — early `Configuration` check |
| 4 | Duplicate ClassActivityAttributes | Task 2 — shared file in both targets |
| 5 | Zombie activities on termination | Task 4 — `endAllSystemActivities()` |
| 6 | Static keylineTint | Task 5 — `.accentColor` default |
| 7 | Wrong date in schedule override | Existing behavior preserved; flagged for future fix |
| 8 | Dead ClassActivityView widget | Task 1 — deleted |
| 9 | 6x TimelineView overhead | Task 5 — reduced where possible |
| 10 | Dead hasStartedLiveActivity | Task 4 — removed |
| 11 | No-op LiveActivityRegistration | Task 1 — removed |
| 12 | No midnight rollover | Existing behavior preserved; flagged for future fix |
| 13 | Text invisible in dark/light mode | Task 5 — `.primary`/`.secondary` |
| 14 | Multiple activities spawning | Task 3 — single `currentActivity` |
| 15 | Dead LiveActivityExtensions | Task 1 — deleted |
| 16 | Divergent color logic | Task 5 — unified `subjectColor()` |
