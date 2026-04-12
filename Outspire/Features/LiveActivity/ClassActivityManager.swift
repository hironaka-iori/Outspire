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

    /// The full timetable grid, kept so we can register with the Worker
    /// whenever tokens arrive (which may happen after startActivity returns).
    private var currentTimetable: [[String]] = []

    /// Whether we already sent a register request for the current token pair.
    /// Reset when either token changes.
    private var hasRegistered = false

    private init() {
        // Observe pushToStartToken once — this single Task lives for the
        // entire app lifetime and covers both local and remote LA start.
        if #available(iOS 17.2, *) {
            Task {
                for await token in Activity<ClassActivityAttributes>.pushToStartTokenUpdates {
                    let tokenString = token.map { String(format: "%02x", $0) }.joined()
                    Log.app.debug("LA pushToStart token: \(tokenString.prefix(20))...")
                    if self.lastPushStartToken != tokenString {
                        self.lastPushStartToken = tokenString
                        self.hasRegistered = false
                        self.registerIfReady()
                    }
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

    func startActivity(schedule: [ScheduledClass], timetable: [[String]] = [], skipEnabledCheck: Bool = false) {
        guard skipEnabledCheck || isEnabled, isSupported, !schedule.isEmpty else { return }

        // Store timetable for Worker registration
        if !timetable.isEmpty {
            currentTimetable = timetable
        }

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

            // Observe push update token (per-activity, so start a new Task each time)
            if let activity = currentActivity {
                Task {
                    for await token in activity.pushTokenUpdates {
                        let tokenString = token.map { String(format: "%02x", $0) }.joined()
                        Log.app.debug("LA push update token: \(tokenString.prefix(20))...")
                        if self.lastPushUpdateToken != tokenString {
                            self.lastPushUpdateToken = tokenString
                            self.hasRegistered = false
                            self.registerIfReady()
                        }
                    }
                }
            }
            // pushToStartToken is already observed in init — no duplicate needed
        } catch {
            Log.app.error("Failed to start Live Activity: \(error.localizedDescription)")
        }
    }

    // MARK: - Worker Registration

    /// Called externally when the timetable data becomes available
    /// (e.g. after fetch completes, which may be after startActivity).
    func setTimetable(_ timetable: [[String]]) {
        guard !timetable.isEmpty else { return }
        currentTimetable = timetable
        // Timetable changed — allow a fresh registration
        hasRegistered = false
        registerIfReady()
    }

    private var retryCount = 0
    private static let maxRetries = 2

    private func registerIfReady() {
        guard !hasRegistered,
              let startToken = lastPushStartToken,
              let updateToken = lastPushUpdateToken,
              !currentTimetable.isEmpty,
              let userCode = AuthServiceV2.shared.user?.userCode,
              let studentInfo = StudentInfo(userCode: userCode)
        else { return }

        let timetable = currentTimetable
        PushRegistrationService.register(
            pushStartToken: startToken,
            pushUpdateToken: updateToken,
            studentInfo: studentInfo,
            timetable: timetable
        ) { [weak self] success in
            DispatchQueue.main.async {
                guard let self else { return }
                if success {
                    self.hasRegistered = true
                    self.retryCount = 0
                    Log.app.info("Registered with push worker (deviceId: \(PushRegistrationService.deviceId.prefix(8))...)")
                } else if self.retryCount < Self.maxRetries {
                    self.retryCount += 1
                    Log.app.warning("Push worker registration failed, retrying (\(self.retryCount)/\(Self.maxRetries))...")
                    DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
                        self.registerIfReady()
                    }
                } else {
                    Log.app.error("Push worker registration failed after \(Self.maxRetries) retries")
                }
            }
        }
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
            let previousClass = schedule.last(where: { $0.endTime <= now })
            let gap = previousClass.map { next.startTime.timeIntervalSince($0.endTime) } ?? 0
            let isLunchBreak = gap > 1800
            let isBreak = previousClass != nil

            if isBreak {
                state = ClassActivityAttributes.ContentState(
                    className: isLunchBreak ? "Lunch Break" : "Break",
                    roomNumber: "",
                    status: .break,
                    periodStart: previousClass!.endTime,
                    periodEnd: next.startTime,
                    nextClassName: next.className
                )
            } else {
                state = ClassActivityAttributes.ContentState(
                    className: next.className,
                    roomNumber: next.roomNumber,
                    status: .upcoming,
                    periodStart: next.startTime,
                    periodEnd: next.endTime,
                    nextClassName: nil
                )
            }
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
        currentTimetable = []
        hasRegistered = false
    }
}
