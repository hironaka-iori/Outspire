# Live Activity UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Live Activity Lock Screen and Dynamic Island views using the approved v3 design, with ClassActivityAttributes and a local ClassActivityManager for starting/stopping from within the app.

**Architecture:** ClassActivityAttributes shared between main app and widget extension. Live Activity views in the widget extension. ClassActivityManager in the main app handles local start/stop/update. Push-based updates (CF Worker) will be added in Plan 3.

**Tech Stack:** ActivityKit, SwiftUI, WidgetKit

**Spec:** `docs/superpowers/specs/2026-04-12-live-activity-widget-redesign.md` — Sections 6, 8

---

## File Map

| File | Target | Purpose |
|---|---|---|
| `OutspireWidget/Shared/ClassActivityAttributes.swift` | Widget Extension | ActivityAttributes + ContentState definition |
| `OutspireWidget/OutspireWidgetLiveActivity.swift` | Widget Extension | Replace template with Lock Screen + Dynamic Island views |
| `OutspireWidget/Views/ProgressRing.swift` | Widget Extension | Circular progress ring for Dynamic Island compact/minimal |
| `Outspire/Features/LiveActivity/ClassActivityManager.swift` | Main App | Start/stop/update Live Activity locally |

---

## Task 1: ClassActivityAttributes

**Files:**
- Create: `OutspireWidget/Shared/ClassActivityAttributes.swift`

- [ ] **Step 1: Create the ActivityAttributes model**

```swift
// OutspireWidget/Shared/ClassActivityAttributes.swift
import ActivityKit
import Foundation

struct ClassActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var className: String
        var roomNumber: String
        var status: Status
        var periodStart: Date
        var periodEnd: Date
        var nextClassName: String?

        enum Status: String, Codable {
            case ongoing
            case ending
            case upcoming
            case `break`
            case event
        }
    }

    var startDate: Date
}
```

- [ ] **Step 2: Commit**

---

## Task 2: Live Activity Views — Lock Screen + Dynamic Island

**Files:**
- Modify: `OutspireWidget/OutspireWidgetLiveActivity.swift` (replace template)
- Create: `OutspireWidget/Views/ProgressRing.swift`

- [ ] **Step 1: Create ProgressRing view for Dynamic Island**

```swift
// OutspireWidget/Views/ProgressRing.swift
import SwiftUI

struct ProgressRing: View {
    let progress: Double
    let color: Color
    let lineWidth: CGFloat
    let size: CGFloat

    init(progress: Double, color: Color, lineWidth: CGFloat = 2.5, size: CGFloat = 24) {
        self.progress = progress
        self.color = color
        self.lineWidth = lineWidth
        self.size = size
    }

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.white.opacity(0.1), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: CGFloat(min(progress, 1.0)))
                .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .frame(width: size, height: size)
    }
}
```

- [ ] **Step 2: Replace OutspireWidgetLiveActivity.swift with full implementation**

Complete Lock Screen view with:
- Left: class name (Title style) + room (Caption style)
- Right: countdown label (Caption) + countdown timer (Number style)
- Bottom: 3px gradient progress bar
- Color determined by status (ongoing=subject, ending=orange, upcoming=green, break=dim, event=purple)

Dynamic Island views:
- Compact leading: ProgressRing + abbreviated class name
- Compact trailing: countdown timer
- Minimal: ProgressRing only
- Expanded: same layout as Lock Screen with room + teacher

- [ ] **Step 3: Build both targets**
- [ ] **Step 4: Commit**

---

## Task 3: ClassActivityManager — Local Start/Stop

**Files:**
- Create: `Outspire/Features/LiveActivity/ClassActivityManager.swift`

- [ ] **Step 1: Create manager for local Live Activity lifecycle**

The manager:
- Checks if LA is enabled (UserDefaults "liveActivityEnabled")
- Checks ActivityAuthorizationInfo().areActivitiesEnabled
- Can start a LA with initial ContentState
- Can update state (class transitions)
- Can end the LA with dismissal policy
- Observes pushToStartToken updates (for future CF Worker registration)

- [ ] **Step 2: Build and verify**
- [ ] **Step 3: Commit**

---

## Task 4: Wire ClassActivityManager into app lifecycle

**Files:**
- Modify: `Outspire/OutspireApp.swift`
- Modify: `Outspire/Features/Main/Views/TodayView.swift`

- [ ] **Step 1: Initialize manager on app launch**
- [ ] **Step 2: Add "Start Live Activity" button to TodayView (temporary, for testing)**
- [ ] **Step 3: Build and test**
- [ ] **Step 4: Commit**

---

## Task 5: Final build verification

- [ ] **Step 1: Build both targets**
- [ ] **Step 2: Test Live Activity on simulator**
