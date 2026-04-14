# Dead Code

Legacy and unused code identified in the codebase as of 2026-04-14. These files/symbols compile but are never referenced at runtime.

## Dead Files

| File | Reason | Safe to Delete |
|------|--------|---------------|
| `Core/Utils/Helpers/CaptchaRecognizer.swift` | Legacy TSIMS v1 captcha OCR. V2 auth has no captcha. Zero references. | Yes |
| `Core/Services/TSIMS/HomeServiceV2.swift` | `fetchMenu()` is never called. Entire file unused. | Yes |
| `Core/Models/SchoolCalendar.swift` | SchoolCalendar/Semester/SpecialDay are not used in app code. Push worker has its own TS interfaces. | Yes |
| `Features/Main/Views/NavSplitView.swift` | Never instantiated. `OutspireApp.swift` uses `RootTabView()`. Replaced during tab bar migration. | Yes |
| `Features/Main/Views/HelpView.swift` | Empty stub. Only referenced from dead `NavSplitView`. | Yes |

## Dead Models

In `Core/Models/ClubAndActivityModels.swift`:

| Model | Reason |
|-------|--------|
| `GroupInfoResponse` | Declared but never instantiated or decoded anywhere |
| `StatusResponse` | Declared but never used anywhere |

## Dead Code in Live Files

### ViewType.swift

| Item | Reason |
|------|--------|
| `.help` case | Only used from dead `NavSplitView` |
| `static func fromLink(_:)` | Never called anywhere |
| `init?(fromLink:)` extension | Duplicate of above, also never called |

Note: `.notSignedIn`, `.weekend`, `.holiday` cases look unused for navigation but ARE used by `GradientManager` for gradient context mapping. Do not remove those.

## How This Happened

The project migrated from:
- **Legacy PHP backend** (`SessionService`, `NetworkService`, PHPSESSID cookies) to TSIMS v2 (`AuthServiceV2`, `TSIMSClientV2`)
- **NavigationSplitView** (`NavSplitView`) to tab-based navigation (`RootTabView`)
- **Captcha-based login** to direct cookie auth

The old code was left in place during migration but never cleaned up. The legacy PHP backend references (`SessionService`, `NetworkService`, `PHPSESSID`, `useNewTSIMS`, `baseURL`) were successfully removed -- only these remnants remain.

## Verification Method

Each item was verified by grepping for all references across all `.swift` files in the project. A file/symbol is marked dead only if it has zero references outside its own definition file.
