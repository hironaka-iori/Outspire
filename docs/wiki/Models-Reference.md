# Models Reference

## Core Models

### Year
**File:** `Core/Models/AcademicModels.swift`

```swift
struct Year: Codable {
    let W_YearID: String
    let W_Year: String
}
```

### ClassPeriod
**File:** `Core/Models/ClassPeriodsModels.swift`

```swift
struct ClassPeriod: Identifiable {
    let id: UUID
    let number: Int
    let startTime: Date
    let endTime: Date

    func isCurrentlyActive() -> Bool
    func currentProgressPercentage() -> CGFloat  // 0-1
    var timeRangeFormatted: String  // "h:mm-h:mm AM/PM"
}
```

### StudentInfo
**File:** `Core/Models/StudentInfo.swift`

```swift
struct StudentInfo {
    let entryYear: String     // e.g., "2023"
    let classNumber: Int      // 1-9
    let track: Track          // .ibdp (1-6) or .alevel (7-9)

    enum Track: String {
        case ibdp, alevel
    }

    init?(from code: String)  // Parses "20238123" or "s20238123"
}
```

### SchoolCalendar (DEAD CODE)
**File:** `Core/Models/SchoolCalendar.swift`

> **Dead code:** These types are not used anywhere in the app. The push worker uses its own TypeScript interfaces for the same data.

```swift
struct SchoolCalendar: Codable {
    let semesters: [Semester]
    let specialDays: [SpecialDay]
}

struct Semester: Codable {
    let start: String  // "YYYY-MM-DD"
    let end: String
}

struct SpecialDay: Codable {
    let date: String
    let type: String   // "exam", "event", "notice", "makeup"
    let track: String? // "ibdp", "alevel", or nil (all)
    let grade: String? // Grade filter

    func appliesTo(track: String, entryYear: String) -> Bool
}
```

### Club & Activity Models
**File:** `Core/Models/ClubAndActivityModels.swift`

```swift
struct Category: Codable, Identifiable {
    let C_CategoryID: String
    let C_Category: String
}

struct GroupInfo: Codable {
    // Chinese/English names, descriptions, founding time
}

struct Member: Codable {
    let StudentID: String
    let name: String
    let nickname: String?
    let contact: String?
    let isLeader: Bool
}

struct ActivityRecord: Codable, Identifiable {
    let theme: String
    let date: String
    let cDuration, aDuration, sDuration: String
    let reflection: String?
    let isConfirm: Bool
}

struct Reflection: Codable, Identifiable {
    let id: String
    let title: String
    let summary: String
    let content: String
    let createTime: String
    let c_lo1...c_lo8: String?  // Learning outcomes
}
```

**Dead models in this file** (declared but never used):
- `GroupInfoResponse` -- never instantiated
- `StatusResponse` -- never used

### ScheduledClass
**File:** `Core/Models/WidgetModels.swift`

```swift
struct ScheduledClass: Codable, Hashable, Identifiable {
    let periodNumber: Int      // also serves as id
    let className: String
    let roomNumber: String
    let teacherName: String
    let startTime: Date
    let endTime: Date
    let isSelfStudy: Bool
}

enum ScheduleBreakKind {
    case regular
    case lunch  // Between periods 4 and 5
}

enum WidgetClassStatus {
    case ongoing, ending, upcoming, break, event
    case completed, noClasses, notAuthenticated, holiday
}
```

## TSIMS V2 Models

### ApiResponse
**File:** `Core/Models/TSIMS/V2/ApiEnvelope.swift`

```swift
struct ApiResponse<T: Decodable>: Decodable {
    let resultType: ResultTypeValue  // "0" or 0 = success
    let message: String?
    let data: T?
    var isSuccess: Bool
}

struct Paged<T: Decodable>: Decodable {
    let totalCount: Int
    let list: [T]
}
```

### V2User
**File:** `Core/Models/TSIMS/V2/V2User.swift`

```swift
struct V2User: Codable {
    let userId: String?
    let userCode: String?
    let name: String?
    let role: String?
}
```

## Service-Specific Models

### V2ScoreItem
**File:** `Core/Services/TSIMS/ScoreServiceV2.swift`

```swift
struct V2ScoreItem: Decodable, Identifiable {
    let subject: String       // SubjectName
    let score1...score5: String?
    let ibScore1...ibScore5: String?
    // Normalizes "-" → "0", trims whitespace
}
```

### V2TimetableItem
**File:** `Core/Services/TSIMS/TimetableServiceV2.swift`

```swift
struct V2TimetableItem: Decodable {
    let day: String
    let period: Int
    let start: String
    let end: String
    let course: String
    let room: String
    let teacher: String
}
```

### V2Record / V2Reflection
**File:** `Core/Services/TSIMS/CASServiceV2.swift`

```swift
struct V2Record: Decodable {
    // Flexible decoder: Title/Theme, Date/ActivityDateStr
    // Durations: string or numeric CDuration/ADuration/SDuration
}

struct V2Reflection: Decodable {
    let id: String
    let title: String
    let summary: String
    let content: String
    let createTime: String
}
```

## Widget Models

### ClassActivityAttributes
**File:** `OutspireWidget/Shared/ClassActivityAttributes.swift`

```swift
struct ClassActivityAttributes: ActivityAttributes {
    let startDate: Date

    struct ContentState: Codable, Hashable {
        enum Phase: String, Codable {
            case upcoming, ongoing, ending, breakTime, event, done
        }
        let dayKey: String
        let phase: Phase
        let title: String
        let subtitle: String
        let rangeStart: Date
        let rangeEnd: Date
        let nextTitle: String?
        let sequence: Int
    }
}
```

### ClassInfo
**File:** `Core/Utils/ClassInfoParser.swift`

```swift
struct ClassInfo {
    let teacher: String?
    let subject: String?
    let room: String?
    let isSelfStudy: Bool
}
// Parsed from "teacher\nsubject\nroom" cell format
```
