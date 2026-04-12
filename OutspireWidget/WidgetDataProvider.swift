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
                periodNumber: 3, className: "Mathematics", roomNumber: "A108",
                teacherName: "Yu Song", startTime: Date(), endTime: Date().addingTimeInterval(2400),
                isSelfStudy: false
            ),
            upcomingClasses: [],
            eventName: nil
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (ClassWidgetEntry) -> Void) {
        completion(placeholder(in: context))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ClassWidgetEntry>) -> Void) {
        guard WidgetDataReader.readAuthState() else {
            let entry = ClassWidgetEntry(date: Date(), status: .notAuthenticated, currentClass: nil, upcomingClasses: [], eventName: nil)
            completion(Timeline(entries: [entry], policy: .atEnd))
            return
        }

        let holiday = WidgetDataReader.readHolidayMode()
        if holiday.enabled {
            let entry = ClassWidgetEntry(date: Date(), status: .holiday, currentClass: nil, upcomingClasses: [], eventName: nil)
            completion(Timeline(entries: [entry], policy: .atEnd))
            return
        }

        let timetable = WidgetDataReader.readTimetable()
        let schedule = buildTodaySchedule(from: timetable)

        if schedule.isEmpty {
            let entry = ClassWidgetEntry(date: Date(), status: .noClasses, currentClass: nil, upcomingClasses: [], eventName: nil)
            completion(Timeline(entries: [entry], policy: .atEnd))
            return
        }

        var entries: [ClassWidgetEntry] = []

        // Before first class
        if let first = schedule.first {
            entries.append(ClassWidgetEntry(
                date: first.startTime.addingTimeInterval(-1800),
                status: .upcoming,
                currentClass: first,
                upcomingClasses: Array(schedule.dropFirst()),
                eventName: nil
            ))
        }

        for (i, cls) in schedule.enumerated() {
            let upcoming = Array(schedule.dropFirst(i + 1))

            entries.append(ClassWidgetEntry(
                date: cls.startTime,
                status: .ongoing,
                currentClass: cls,
                upcomingClasses: upcoming,
                eventName: nil
            ))

            entries.append(ClassWidgetEntry(
                date: cls.endTime.addingTimeInterval(-300),
                status: .ending,
                currentClass: cls,
                upcomingClasses: upcoming,
                eventName: nil
            ))

            if let next = upcoming.first {
                entries.append(ClassWidgetEntry(
                    date: cls.endTime,
                    status: .break,
                    currentClass: next,
                    upcomingClasses: Array(upcoming.dropFirst()),
                    eventName: nil
                ))
            }
        }

        if let last = schedule.last {
            entries.append(ClassWidgetEntry(
                date: last.endTime,
                status: .completed,
                currentClass: nil,
                upcomingClasses: [],
                eventName: nil
            ))
        }

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
        let dayColumn = weekday - 1
        guard dayColumn >= 1, dayColumn <= 5 else { return [] }

        let periods = WidgetClassPeriods.today

        var result: [ScheduledClass] = []
        for row in 1 ..< timetable.count {
            guard dayColumn < timetable[row].count else { continue }
            let cellData = timetable[row][dayColumn]
            let trimmed = cellData.trimmingCharacters(in: .whitespacesAndNewlines)

            guard let period = periods.first(where: { $0.number == row }) else { continue }

            let components = cellData.components(separatedBy: "\n")
            let teacher = components.count > 0 ? components[0] : ""
            let rawSubject = components.count > 1 ? components[1] : ""
            let room = components.count > 2 ? components[2] : ""

            // Strip trailing class number like "(8)" from "Mathematics(8)"
            let subject = rawSubject.replacingOccurrences(
                of: "\\(\\d+\\)$", with: "", options: .regularExpression
            )

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
