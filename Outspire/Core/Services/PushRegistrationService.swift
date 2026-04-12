import Foundation
import OSLog

/// Sends push tokens and schedule data to the CF Worker for Live Activity push delivery.
enum PushRegistrationService {
    private static let workerBaseURL = "https://outspire-apns.wrye.dev"
    private static let deviceIdKey = "push_device_id"

    /// Stable per-device identifier stored in Keychain. Survives app reinstalls.
    static var deviceId: String {
        if let existing = SecureStore.get(deviceIdKey) {
            return existing
        }
        let newId = UUID().uuidString
        SecureStore.set(newId, for: deviceIdKey)
        return newId
    }

    struct RegisterPayload: Encodable {
        let deviceId: String
        let pushStartToken: String
        let pushUpdateToken: String
        let track: String
        let entryYear: String
        let schedule: [String: [Period]]

        struct Period: Encodable {
            let start: String
            let end: String
            let name: String
            let room: String
        }
    }

    static func register(
        pushStartToken: String,
        pushUpdateToken: String,
        studentInfo: StudentInfo,
        timetable: [[String]]
    ) {
        let schedule = buildWeekSchedule(from: timetable)

        let payload = RegisterPayload(
            deviceId: deviceId,
            pushStartToken: pushStartToken,
            pushUpdateToken: pushUpdateToken,
            track: studentInfo.track.rawValue,
            entryYear: studentInfo.entryYear,
            schedule: schedule
        )

        post(endpoint: "/register", body: payload)
    }

    static func pause(resumeDate: String? = nil) {
        struct Body: Encodable {
            let deviceId: String
            let resumeDate: String?
        }
        post(endpoint: "/pause", body: Body(deviceId: deviceId, resumeDate: resumeDate))
    }

    static func resume() {
        struct Body: Encodable {
            let deviceId: String
        }
        post(endpoint: "/resume", body: Body(deviceId: deviceId))
    }

    /// Remove this device's registration from the Worker (logout / account switch).
    static func unregister() {
        struct Body: Encodable {
            let deviceId: String
        }
        post(endpoint: "/unregister", body: Body(deviceId: deviceId))
    }

    // MARK: - Private

    private static func post<T: Encodable>(endpoint: String, body: T) {
        guard let url = URL(string: workerBaseURL + endpoint) else { return }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 10

        do {
            request.httpBody = try JSONEncoder().encode(body)
        } catch {
            Log.net.error("Failed to encode push registration: \(error.localizedDescription)")
            return
        }

        URLSession.shared.dataTask(with: request) { _, response, error in
            if let error {
                Log.net.error("Push registration failed: \(error.localizedDescription)")
                return
            }
            if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                Log.net.info("Push registration successful for \(endpoint)")
            } else {
                Log.net.warning("Push registration returned non-200")
            }
        }.resume()
    }

    /// Convert the app's 2D timetable grid into a weekday-keyed schedule
    /// matching the CF Worker's expected format.
    private static func buildWeekSchedule(
        from timetable: [[String]]
    ) -> [String: [RegisterPayload.Period]] {
        guard !timetable.isEmpty else { return [:] }

        let periods = ClassPeriodsManager.shared.classPeriods
        let timeFormatter = DateFormatter()
        timeFormatter.dateFormat = "HH:mm"

        var result: [String: [RegisterPayload.Period]] = [:]

        for dayColumn in 1 ... 5 {
            var dayPeriods: [RegisterPayload.Period] = []

            for row in 1 ..< timetable.count {
                guard dayColumn < timetable[row].count else { continue }
                let cellData = timetable[row][dayColumn]
                let trimmed = cellData.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty else { continue }

                guard let period = periods.first(where: { $0.number == row }) else { continue }

                let components = cellData.components(separatedBy: "\n")
                let subject = components.count > 1 ? components[1] : components[0]
                let room = components.count > 2 ? components[2] : ""

                dayPeriods.append(RegisterPayload.Period(
                    start: timeFormatter.string(from: period.startTime),
                    end: timeFormatter.string(from: period.endTime),
                    name: subject,
                    room: room
                ))
            }

            result[String(dayColumn)] = dayPeriods
        }

        return result
    }
}
