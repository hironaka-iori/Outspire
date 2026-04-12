import ActivityKit
import Foundation
import OSLog

@MainActor
final class ClassActivityManager: ObservableObject {
    static let shared = ClassActivityManager()

    @Published private(set) var isActivityRunning = false
    private var currentActivity: Activity<ClassActivityAttributes>?
    private var lastPushStartToken: String?
    private var lastPushUpdateToken: String?

    private init() {
        // Observe pushToStartToken on launch (for remote start capability)
        if #available(iOS 17.2, *) {
            Task {
                for await token in Activity<ClassActivityAttributes>.pushToStartTokenUpdates {
                    let tokenString = token.map { String(format: "%02x", $0) }.joined()
                    Log.app.debug("LA pushToStart token: \(tokenString.prefix(20))...")
                    self.lastPushStartToken = tokenString
                }
            }
        }
    }

    var isEnabled: Bool {
        UserDefaults.standard.bool(forKey: "liveActivityEnabled")
    }

    var isSupported: Bool {
        ActivityAuthorizationInfo().areActivitiesEnabled
    }

    // MARK: - Start

    func startActivity(schedule: [ScheduledClass], skipEnabledCheck: Bool = false) {
        guard skipEnabledCheck || isEnabled, isSupported, !schedule.isEmpty else { return }
        guard currentActivity == nil else {
            Log.app.debug("Live Activity already running, updating instead")
            updateForCurrentState(schedule: schedule)
            return
        }

        let now = Date()
        guard let firstClass = schedule.first(where: { $0.endTime > now }) else { return }

        let isBeforeClass = now < firstClass.startTime
        let nextAfterFirst = schedule.first(where: { $0.startTime > firstClass.startTime })

        let initialState = ClassActivityAttributes.ContentState(
            className: firstClass.className,
            roomNumber: firstClass.roomNumber,
            status: isBeforeClass ? .upcoming : .ongoing,
            periodStart: firstClass.startTime,
            periodEnd: firstClass.endTime,
            nextClassName: nextAfterFirst?.className
        )

        let attributes = ClassActivityAttributes(startDate: now)
        let content = ActivityContent(state: initialState, staleDate: nil)

        do {
            currentActivity = try Activity.request(
                attributes: attributes,
                content: content,
                pushType: .token
            )
            isActivityRunning = true
            Log.app.info("Live Activity started for \(firstClass.className)")

            // Observe push token and register with CF Worker
            if let activity = currentActivity {
                Task {
                    for await token in activity.pushTokenUpdates {
                        let tokenString = token.map { String(format: "%02x", $0) }.joined()
                        Log.app.debug("LA push update token: \(tokenString.prefix(20))...")
                        self.lastPushUpdateToken = tokenString
                        self.registerWithWorkerIfReady(timetable: schedule.map { _ in [[String]]() }.first ?? [])
                    }
                }
            }

            // Also observe pushToStartToken for remote start
            if #available(iOS 17.2, *) {
                Task {
                    for await token in Activity<ClassActivityAttributes>.pushToStartTokenUpdates {
                        let tokenString = token.map { String(format: "%02x", $0) }.joined()
                        Log.app.debug("LA pushToStart token: \(tokenString.prefix(20))...")
                        self.lastPushStartToken = tokenString
                    }
                }
            }
        } catch {
            Log.app.error("Failed to start Live Activity: \(error.localizedDescription)")
        }
    }

    // MARK: - Worker Registration

    func registerWithWorker(timetable: [[String]]) {
        guard let startToken = lastPushStartToken,
              let updateToken = lastPushUpdateToken,
              let userCode = AuthServiceV2.shared.user?.userCode,
              let studentInfo = StudentInfo(userCode: userCode)
        else {
            Log.app.debug("Not ready to register with worker (missing tokens or user info)")
            return
        }

        PushRegistrationService.register(
            pushStartToken: startToken,
            pushUpdateToken: updateToken,
            studentInfo: studentInfo,
            timetable: timetable
        )
    }

    private func registerWithWorkerIfReady(timetable: [[String]]) {
        guard lastPushStartToken != nil, lastPushUpdateToken != nil else { return }
        registerWithWorker(timetable: timetable)
    }

    // MARK: - Update

    func updateForCurrentState(schedule: [ScheduledClass]) {
        guard let activity = currentActivity else { return }

        let now = Date()

        // Find current or next class
        let currentClass = schedule.first(where: { $0.startTime <= now && $0.endTime > now })
        let nextClass = schedule.first(where: { $0.startTime > now })

        let state: ClassActivityAttributes.ContentState

        if let current = currentClass {
            let remaining = current.endTime.timeIntervalSince(now)
            let nextAfter = schedule.first(where: { $0.startTime > current.startTime })
            state = ClassActivityAttributes.ContentState(
                className: current.className,
                roomNumber: current.roomNumber,
                status: remaining <= 300 ? .ending : .ongoing,
                periodStart: current.startTime,
                periodEnd: current.endTime,
                nextClassName: nextAfter?.className
            )
        } else if let next = nextClass {
            let nextAfterNext = schedule.first(where: { $0.startTime > next.startTime })
            state = ClassActivityAttributes.ContentState(
                className: next.className,
                roomNumber: next.roomNumber,
                status: .upcoming,
                periodStart: next.startTime,
                periodEnd: next.endTime,
                nextClassName: nextAfterNext?.className
            )
        } else {
            // All classes done
            endActivity()
            return
        }

        Task {
            await activity.update(ActivityContent(state: state, staleDate: nil))
        }
    }

    // MARK: - End

    func endActivity() {
        guard let activity = currentActivity else { return }

        Task {
            await activity.end(nil, dismissalPolicy: .after(Date().addingTimeInterval(900)))
            Log.app.info("Live Activity ended")
        }

        currentActivity = nil
        isActivityRunning = false
    }

    // MARK: - End all (cleanup)

    func endAllActivities() {
        Task {
            for activity in Activity<ClassActivityAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }
        currentActivity = nil
        isActivityRunning = false
    }
}
