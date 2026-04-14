# Live Activity Research and Architecture Spec

**Date:** 2026-04-13  
**Status:** Proposed replacement for the self-driven `TimelineView` approach  
**Scope:** Outspire iOS app, Live Activity widget extension, Cloudflare Worker push pipeline

---

## 1. Executive Summary

The current `self-driven` Live Activity design is the wrong abstraction for ActivityKit.

The core mistake is treating the Live Activity view like a normal Widget timeline and expecting `TimelineView` to reliably advance business state on the Lock Screen. Apple's documentation draws a much harder line:

- Standard widgets are timeline-driven.
- Live Activities are **not** timeline-driven.
- Live Activity state is supposed to change when the app calls `activity.update(...)` or when APNs sends an ActivityKit `event: "update"` push.

This explains the field behavior already observed in Outspire testing:

- duplicate Live Activities when local start and Worker push-to-start both happen
- countdown text updates while the rest of the UI does not switch to break / next class
- stale state after a class boundary unless the app is opened again
- very little real-world improvement over the no-APNs path

The recommended architecture is a **single-owner hybrid push architecture**:

1. Keep server-driven push updates as the source of truth for unattended state transitions.
2. Restore per-activity `pushTokenUpdates` handling in the app.
3. Keep `pushToStartToken` registration for remote start.
4. Ensure only one side owns the start for a given device/day:
   - if the app already started a local Live Activity, the Worker must not also send push-to-start
   - if the Worker push-started the activity, the app must adopt it and upload the new update token instead of starting another one
5. Treat `TimelineView` as cosmetic only:
   - good for progress rings or bars
   - not acceptable as the mechanism that decides whether the UI is in `ongoing`, `ending`, `break`, `upcoming`, or `done`

---

## 2. Questions This Research Answered

1. Can a Live Activity reliably self-advance through a full school day using only `TimelineView` and a schedule array?
2. What does Apple actually require for push-to-start, update pushes, `stale-date`, and dismissal?
3. Why did Outspire get duplicate Live Activities after reinstall/login?
4. Why did break state and class transitions fail to appear on the Lock Screen?
5. What architecture best preserves the unattended "shows up in the morning and keeps updating" experience?

---

## 3. Current Outspire Implementations

### 3.1 Original Worker-driven design

The earlier design in `docs/apns-push-worker.md` assumed:

- app registers both `pushStartToken` and per-activity `pushUpdateToken`
- Worker sends one `start` push plus multiple `update` pushes and an `end`
- current state lives in ActivityKit `content-state`
- app reattaches to existing activities on launch and re-observes `pushTokenUpdates`

This model was directionally aligned with Apple's docs, but the weak point was operational:

- when a Live Activity was push-started while the app was not already active, the app still needed to receive and upload that new activity's update token
- if that token never reached the Worker, subsequent update pushes failed

### 3.2 Current self-driven design

The current code switched to a different model:

- `ClassActivityManager` only observes `pushToStartTokenUpdates`
- registration payload only includes `pushStartToken`
- Worker now only needs a `start` push
- `ContentState` stores the full day's classes
- widget UI derives current phase by comparing `Date()` against the schedule inside `TimelineView(.periodic)`

Relevant files:

- `Outspire/Features/LiveActivity/ClassActivityManager.swift`
- `Outspire/Features/LiveActivity/ClassActivityAttributes.swift`
- `OutspireWidget/OutspireWidgetLiveActivity.swift`
- `worker/src/index.ts`
- `docs/superpowers/specs/2026-04-13-self-driven-live-activity.md`

### 3.3 Why the current version fails in practice

The current version assumes three things that are not safe:

1. `TimelineView` will re-evaluate often enough on the Lock Screen to drive phase changes.
2. The Lock Screen will recompute view body at class boundaries, not just timer text.
3. A full-day schedule in `content-state` is enough to replace push updates.

The Apple documentation and field reports do not support those assumptions.

---

## 4. Apple Official Documentation: What Is Actually Guaranteed

### 4.1 Live Activities are not widget timelines

Apple's ActivityKit overview and "Displaying live data with Live Activities" documentation explicitly distinguish Live Activities from standard widgets:

- widgets use the timeline mechanism
- Live Activities use WidgetKit and SwiftUI for presentation, but their data changes through ActivityKit updates or ActivityKit push notifications

Practical meaning for Outspire:

- `TimelineView` can exist inside the SwiftUI view tree
- but it is not the supported system for progressing Live Activity business state
- `Text(timerInterval:)` is appropriate for a live countdown
- the transition from `Math` to `Break` to `English` still needs a real state update path

### 4.2 Dynamic state changes are supposed to come from `update(...)` or APNs

Apple provides the supported update mechanisms:

- local: `activity.update(...)`
- remote: ActivityKit push with `event: "update"`

Apple also documents that:

- the encoded `content-state` must fit within 4 KB
- updates are ignored after the activity is already ended
- the system animates view transitions when the content state changes

Practical meaning for Outspire:

- if the displayed class name, subtitle, break label, or range changes, that change should come from a new `content-state`
- cosmetic countdown movement may stay local

### 4.3 Push-to-start payload requirements

For pre-iOS 18 push-to-start, Apple's push-notification documentation requires:

- `event: "start"`
- `attributes-type`
- `attributes`
- `content-state`
- `alert`

This matters for Outspire because the Worker should keep treating `alert` as required for compatibility, and any future payload refactor must not accidentally drop it.

### 4.4 Push-to-start token versus update token

Apple distinguishes two token families:

- `pushToStartToken` / `pushToStartTokenUpdates`
  - global capability to remotely start a new Live Activity
  - available on iOS 17.2+
- `pushToken` / `pushTokenUpdates`
  - per-activity token used to remotely update or end an already running Live Activity
  - can change over time and should be re-uploaded when it changes

Practical meaning for Outspire:

- registering only `pushStartToken` can never solve the full unattended update problem
- each actual activity instance still needs its own update token

### 4.5 What happens after a push start

Apple's "Starting and updating Live Activities with ActivityKit push notifications" documentation states that when the system receives an ActivityKit push notification that starts a Live Activity, the system starts the Live Activity, launches the app, and gives it background runtime to download required assets.

That is the official basis for the recommended token recovery path:

1. Worker sends push-to-start
2. system creates the activity
3. app is launched in the background
4. app observes `pushTokenUpdates` for that new activity
5. app sends the update token to the Worker
6. Worker can then continue with `update` and `end`

This path is officially intended. The problem is not that the model is unsupported. The problem is that it has edge cases in the field and therefore needs a resilient implementation.

### 4.6 `stale-date` and dismissal are not the same thing

Apple distinguishes:

- `stale-date`
  - content is considered outdated
  - it does not by itself remove the Live Activity
- `end`
  - actually ends the activity
- `ActivityUIDismissalPolicy.after(date)`
  - the system removes an ended Live Activity at the specified time, but within a four-hour maximum window

Practical meaning for Outspire:

- using `stale-date` as a substitute for a real `end` is incorrect
- if end pushes fail, users can be left with a stale or dimmed activity
- that is exactly why update-token reliability matters

### 4.7 Activity duration constraints

Apple documents Live Activities as experiences that run for several hours, and developer-facing guidance and forums consistently reference an approximately 8-hour active duration plus up to 4 additional hours on the Lock Screen after ending or becoming stale.

Practical meaning for Outspire:

- a full school day is near the upper bound
- the schedule should not depend on a long chain of local recomputations to stay correct
- the app and Worker should assume the system may end or de-prioritize a long-running activity

### 4.8 iOS 18 note: `input-push-token`

Apple's newer push documentation includes `input-push-token: 1` for start payloads on iOS 18+ so a newly started activity can more directly participate in the push-update flow.

Practical meaning for Outspire:

- this is useful as a forward-looking enhancement
- it does not remove the need for robust token-observation code for iOS 17.2+ behavior

---

## 5. Community Implementation Experience

This section intentionally separates what Apple explicitly guarantees from what developers repeatedly report in the field.

### 5.1 `pushToStartTokenUpdates` and push-start setup are easy to get wrong

Apple Developer Forum threads around iOS 17.2 rollout show repeated reports of:

- no `pushToStartToken` being emitted
- setup working on some devices and not others
- confusion around entitlement/configuration requirements

Takeaway:

- token observation must begin as early as possible in app lifetime
- logs need to record whether token observers actually started and whether values were uploaded
- registration must be idempotent and retryable

### 5.2 Backend-started activities can still have token-hand-off fragility

Developers on the Apple forums report that when a Live Activity is started from the backend, the follow-up update token path can be inconsistent in real-world scenarios, especially around:

- fresh installs
- permission/consent flow after remote start
- app not being foregrounded recently

This does not invalidate the official architecture. It means the implementation must tolerate failures in the token hand-off.

Takeaway:

- the Worker should not assume update-token upload succeeded just because a start push succeeded
- a device/day should remain recoverable when the app is opened later

### 5.3 Mixing local start and push-to-start creates duplicates by design

This is not a special Outspire bug. It follows directly from ActivityKit's model:

- local `Activity.request(...)` creates a Live Activity
- push-to-start also creates a Live Activity
- they are separate activities unless the app/server deliberately avoids triggering both paths for the same day/device

Takeaway:

- dedup must be an explicit product and backend rule
- "restore first, then maybe start" is mandatory in the app
- "do not send push-start once the device already owns today's activity" is mandatory in the Worker

### 5.4 Lock Screen rendering is system-controlled

Developers repeatedly report behavior where:

- timer text remains live
- local app-initiated updates can appear delayed or ignored in some contexts
- after certain push-driven flows, subsequent local updates behave differently than expected

Takeaway:

- use the supported content-update path
- keep state transitions coarse and explicit
- do not build a correctness-critical architecture on periodic lock-screen recomputation

### 5.5 Interactive actions do not rescue the architecture

Forum discussions around interactive Live Activities show that even when buttons or intents are involved, correctness still depends on updates reaching the app process and targeting the correct activity. Interaction support does not remove the need for a clean ownership model.

Takeaway:

- Outspire should solve lifecycle and token correctness first
- interactivity, if added later, should build on top of the same single-owner activity model

---

## 6. Root Cause Analysis for the Observed Outspire Bugs

### 6.1 Duplicate Live Activities after reinstall/login

Observed behavior:

- install new build on iPad
- log in
- two Live Activities appear

Root cause:

- the app can locally call `Activity.request(..., pushType: .token)`
- the Worker can also send a push-to-start for the same day
- there is no day/device ownership rule preventing both

### 6.2 No break screen, no transition after countdown ends

Observed behavior:

- countdown reaches zero
- class / break UI does not actually transition

Root cause:

- the current `ContentState` does not contain the current phase snapshot
- the widget derives phase from the schedule array using `TimelineView`
- the countdown text can keep moving, but the system is not obligated to re-run the state computation exactly when the phase boundary occurs

### 6.3 Opening the app is required before the Live Activity looks correct again

Observed behavior:

- user must open Outspire
- delete old activity or let the app reconcile
- leave the app
- then a newer-looking activity appears

Root cause:

- app foreground work is currently doing the reconciliation that the background push-update path should have done
- with no valid update token path, only foreground execution can correct the displayed state

### 6.4 APNs currently provides little value over offline behavior

Observed behavior:

- online flow feels similar to offline flow

Root cause:

- APNs currently helps with appearance of a `start`
- it does not reliably drive the day forward because the update path was removed

---

## 7. Decision

Outspire should abandon the self-driven `TimelineView` architecture and move back to a push-updated architecture, but with a stricter ownership model and stronger recovery paths.

The new design goal is:

> A device has at most one class Live Activity per day, and the state shown on the Lock Screen is derived from explicit `content-state` updates, not from periodic recomputation of a full-day schedule.

---

## 8. Proposed Target Architecture

### 8.1 High-level model

Use a **single-owner hybrid push architecture**:

- Worker remains responsible for unattended morning start and scheduled phase changes.
- App remains responsible for:
  - token observation
  - deduplication
  - adoption of existing activities
  - fallback local correction while foregrounded

### 8.2 Ownership rules

For each `deviceId + schoolDay`, exactly one of these paths may create the activity:

#### Path A: Worker-owned start

- Worker sends push-to-start before first class
- system creates activity
- app is background-launched
- app observes new `pushTokenUpdates`
- app uploads update token
- Worker sends later `update` and `end` pushes

#### Path B: App-owned start

- user opens app before Worker start time
- app restores existing activities first
- if no current activity exists for today, app may locally request one
- app immediately observes `pushTokenUpdates` for that activity and uploads the update token
- Worker marks today's `start` push as consumed/cancelled for this device and only schedules subsequent `update` and `end`

These paths are mutually exclusive for a given day/device.

### 8.3 Content-state should become a current snapshot again

Recommended `ContentState` shape:

```swift
struct ContentState: Codable, Hashable {
    enum Phase: String, Codable {
        case upcoming
        case ongoing
        case ending
        case `break`
        case event
        case done
    }

    var dayKey: String
    var phase: Phase
    var title: String
    var subtitle: String
    var rangeStart: Date
    var rangeEnd: Date
    var nextTitle: String?
    var sequence: Int
}
```

Notes:

- `sequence` is monotonic and helps ignore stale updates.
- `dayKey` prevents accidental reuse across days.
- a full schedule array may still be included for debugging or recovery, but rendering correctness must not depend on it.

### 8.3.1 Shared schedule normalization rules

Outspire should stop letting Widget, Live Activity, and TodayView each infer schedule semantics differently.

Before any widget timeline or Live Activity snapshot is generated, the app and Worker should normalize the raw timetable into one shared semantic schedule.

Required rules:

1. **Interior empty periods are real self-study periods.**
   - If a period between two scheduled teaching periods is empty, it should be represented as a class-like item with subject `Self-Study`.
   - It should appear in Widget and Live Activity just like another class period, with its real bell start/end range.

2. **Trailing empty periods after the last real scheduled period are omitted.**
   - If the final one or more periods of the day are empty, they are not shown as `Self-Study`.
   - Product meaning: the student simply has fewer periods that day.
   - This matches the expectation that "last period empty" means "school day ends earlier", not "display a fake self-study class".

3. **Lunch break must be determined by school semantics, not by a generic gap threshold.**
   - The current `gap > 1800` heuristic is too weak and can misclassify an ordinary break as lunch.
   - Lunch should be identified by the known midday bell boundary, currently the gap between period 5 end and period 6 start in `WidgetClassPeriods`.
   - If school periods change in the future, lunch should still be derived from named bell slots, not an arbitrary duration cutoff.

4. **Ordinary breaks are explicit break states between adjacent scheduled periods.**
   - Example: period 1 -> period 2 gap is `Break`, not `Lunch Break`.
   - This remains true even if the gap is unusually long because of a temporary timetable anomaly, unless the period calendar explicitly marks it as lunch.

5. **Self-study is a class-state, not a break-state.**
   - The title should be `Self-Study`.
   - It should count as a real current period for countdown purposes.
   - It should not be swallowed by `filter { !$0.isSelfStudy }` in the widget pipeline.

6. **Break and lunch only exist between two normalized periods.**
   - No "break" before the first period.
   - No "break" after the final normalized period of the day.
   - After the final normalized period ends, the state becomes `done` and then later `end` / `stale` / dismissed according to ActivityKit lifecycle.

Implementation implication:

- extract a single normalization layer shared by TodayView, Home Screen widget, and Live Activity generation
- stop duplicating this logic in `WidgetDataProvider.swift`, `ClasstableViewModel`, and `OutspireWidgetLiveActivity.swift`
- treat the current widget behavior of filtering out self-study periods as incorrect for the target product behavior

### 8.4 `TimelineView` usage policy

Allowed:

- progress bar fill
- visual countdown-adjacent decoration
- non-critical animation polish

Not allowed:

- choosing which class is active
- deciding whether the user is on break
- deciding whether the Live Activity should now say "Next: English"

### 8.5 Worker data model changes

Worker registration should again store both token types when available:

- `pushStartToken`
- latest `pushUpdateToken`
- `currentActivityId`
- `currentDayKey`
- `startOwner` = `worker` or `app`
- `lastSequence`
- `pendingStart` / `startConsumed`

Suggested new or revised endpoints:

- `POST /register`
  - stable device identity, schedule, `pushStartToken`
- `POST /activity-token`
  - `deviceId`, `dayKey`, `activityId`, `pushUpdateToken`, `owner`
- `POST /activity-started`
  - optional explicit "local activity already exists" signal so the Worker cancels pending start pushes
- `POST /activity-ended`
  - optional cleanup signal when local reconciliation ends the activity

### 8.6 App responsibilities

`ClassActivityManager` should:

1. Observe `Activity<ClassActivityAttributes>.pushToStartTokenUpdates` at app launch.
2. Restore `Activity.activities` at app launch and scene activation.
3. For every adopted or newly created activity, observe `pushTokenUpdates`.
4. Upload token changes idempotently.
5. Before starting locally:
   - scan existing activities
   - adopt today's existing activity if present
   - end duplicates if more than one exists
6. If app locally starts an activity:
   - upload update token
   - notify Worker that today's start was consumed
7. If all classes are done while app is foregrounded:
   - end locally
   - tell Worker so it stops targeting that activity

### 8.7 Reliability rules

#### Rule 1: treat start success and update-token success as separate events

Worker must track:

- `startPushDeliveredMaybe`
- `updateTokenReceived`

Never assume the second happened because the first did.

#### Rule 2: make token uploads idempotent

- same token can be sent multiple times safely
- newer token replaces older token
- worker should invalidate old tokens on replacement

#### Rule 3: stale updates must be rejected

- each update carries `sequence`
- app and Worker only accept newer sequence values

#### Rule 4: one activity per day per device

- app aggressively ends duplicates on restore
- Worker refuses to schedule a second `start` for a device/day already marked active

---

## 9. Why This Architecture Is Better Than the Self-Driven One

### 9.1 It matches Apple's model

Apple's supported update path is content-state mutation through ActivityKit or ActivityKit push. The proposed architecture uses exactly that.

### 9.2 It preserves the unattended morning experience

The self-driven approach tried to solve unattended updates by removing update pushes entirely. That broke correctness. The proposed architecture keeps unattended behavior but restores the real update path.

### 9.3 It solves duplicates explicitly

The current architecture has no first-class start owner. The proposed design does.

### 9.4 It degrades more predictably

If token hand-off fails:

- the Live Activity can still appear from push-start
- opening the app later can repair the token path
- the failure is visible and diagnosable in logs

That is a better failure mode than "the UI looked like it should self-drive, but it silently froze."

---

## 10. Migration Plan

### Phase 1: document and instrument

- add structured logs for:
  - push-to-start token received
  - activity restored
  - local start requested
  - push update token received
  - update token uploaded
  - duplicate activities ended
  - worker start cancelled for today

### Phase 2: revert self-driven schema

- change `ContentState` back to a snapshot model
- remove correctness-critical `TimelineView` phase derivation
- keep only cosmetic timeline usage

### Phase 3: restore update-token flow

- bring back `pushTokenUpdates`
- upload per-activity update token again
- worker stores and rotates latest update token

### Phase 4: add explicit start ownership

- add device/day ownership fields in Worker storage
- add endpoint for local-start claim or activity-token upsert
- cancel pending remote start when app already owns today's activity

### Phase 5: add recovery and reconciliation

- on every foreground activation:
  - restore activities
  - end duplicates
  - verify today's owner/state with Worker if network is available

### Phase 6: only then revisit polish

- lock screen layout
- countdown styling
- subtle progress animation
- optional event-day variants

---

## 11. Test Matrix

### 11.1 Core lifecycle

- fresh install, no existing activity, app opened before school start
- fresh install, app not opened, Worker push-start path only
- app killed overnight, Worker push-start in the morning
- app re-opened after Worker already started the activity
- local start then Worker's original start minute arrives

Expected:

- exactly one activity
- no duplicate after login or reinstall

### 11.2 Token flow

- local start emits update token and uploads it
- push-started activity emits update token during background launch
- rotated update token replaces previous token in Worker
- Worker update succeeds after token upload
- Worker update is skipped or deferred if token upload never happened

### 11.3 Phase transitions

- upcoming -> ongoing
- ongoing -> ending
- ending -> break
- break -> ongoing
- final class -> end

Expected:

- title, subtitle, countdown range, and accent state all change from explicit content updates

### 11.4 Recovery

- user manually dismisses one of two duplicates from an old broken build
- app opens later and reconciles
- Worker still has stale token
- app uploads fresh token and future updates recover

### 11.5 Edge cases

- holiday / no-classes day
- makeup weekday
- login/logout/account switch
- iPad and iPhone behavior
- app installed but Live Activities disabled
- update token never arrives after push start

---

## 12. Open Questions

1. What is the minimum supported OS mix for Outspire users?
   - If iOS 18 adoption is already high enough, `input-push-token: 1` deserves early evaluation.

2. Should Outspire continue to locally start when the app is open, or should all starts be server-owned once registration exists?
   - The safer long-term model is probably "Worker owns unattended start; app only local-starts when there is no valid server registration."

3. How much reconciliation should the Worker do after mid-day login?
   - For example, should `/register` immediately schedule a same-minute catch-up start or next update?

---

## 13. Recommended Product Decision

Adopt the hybrid architecture and remove the current self-driven approach from the roadmap.

Specifically:

- do not ship `TimelineView` as the source of truth for class transitions
- do restore push updates as the correctness path
- do add explicit single-owner start semantics
- do treat token hand-off after push-start as a recoverable, instrumented reliability problem

This keeps the original product goal intact:

- the Live Activity can appear even if the user did not open the app that morning
- the content can still progress through the school day correctly
- opening the app later repairs the system rather than being the only way it ever works

---

## 14. Source Notes

### Apple official documentation

- ActivityKit overview  
  https://developer.apple.com/documentation/activitykit/

- Displaying live data with Live Activities  
  https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities

- Starting and updating Live Activities with ActivityKit push notifications  
  https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications

- `Activity.update(...)`  
  https://developer.apple.com/documentation/activitykit/activity/update%28_%3A%29

- `pushToStartTokenUpdates`  
  https://developer.apple.com/documentation/activitykit/activity/pushtostarttokenupdates

- `pushToken` / `pushTokenUpdates`  
  https://developer.apple.com/documentation/activitykit/activity/pushtoken

- `ActivityUIDismissalPolicy.after(_:)`  
  https://developer.apple.com/documentation/activitykit/activityuidismissalpolicy/after(_:)

### Community implementation reports and forum threads

- Issue starting Live Activities with ActivityKit push notifications  
  https://developer.apple.com/forums/thread/741939

- Get update token from backend-started Live Activity / consent-related forum discussions  
  Apple Developer Forums APNS + Widgets & Live Activities tag pages, 2025 discussions

- Local updates to Live Activities ignored after push update  
  https://developer.apple.com/forums/thread/814198

- Can Live Activities be updated via App Intents without push notification?  
  https://developer.apple.com/forums/thread/735382

### Outspire internal references

- `docs/apns-push-worker.md`
- `docs/superpowers/specs/2026-04-12-live-activity-widget-redesign.md`
- `docs/superpowers/specs/2026-04-13-self-driven-live-activity.md`
- `Outspire/Features/LiveActivity/ClassActivityManager.swift`
- `OutspireWidget/OutspireWidgetLiveActivity.swift`
- `worker/src/index.ts`
