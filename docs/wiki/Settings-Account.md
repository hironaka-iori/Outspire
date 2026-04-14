# Settings & Account

## Settings View

`Features/Settings/Views/SettingsView.swift` is the main settings hub.

### Sections

**Profile Header** (`ProfileHeaderView.swift`)
- Shows avatar, name, student code, role when authenticated
- Sign-in prompt when not authenticated

**General Settings** (`SettingsGeneralView.swift`)
- Hide academic scores toggle
- Show Monday class toggle
- Show seconds in long countdown toggle
- Show countdown for future classes toggle
- Debug network logging toggle

**Gradient Settings** (`GradientSettingsView.swift`)
- Global gradient toggle (apply same gradient to all views)
- Per-view gradient customization
- Color picker integration
- Speed, noise, transition speed sliders
- Preset selection (Ocean, Aurora, Lavandula, etc.)

**Notification Settings** (`SettingsNotificationsView.swift`)
- Class reminder toggle
- Notification permission status display
- Opens system Settings if permissions denied

**About** (`AboutView.swift`)
- App version and build number
- Environment info (TestFlight, App Store, Simulator)
- Third-party licenses link
- Cache management (via `CacheStatusView`)

**Licenses** (`LicenseView.swift`)
- Displays third-party license text from bundled resource

## Account View

`Features/Account/Views/AccountV2View.swift`

### Not Authenticated State
- Student code field (auto-prefills last used code)
- Password field (secure entry)
- Login button with loading indicator
- FocusState for keyboard navigation (code → password → done)

### Authenticated State
- Profile display: avatar, name, code, role
- Logout button with confirmation dialog
- Animated transition between states (opacity + scale)

### AccountV2ViewModel
- Thin wrapper observing `AuthServiceV2.shared`
- Prefills last used code from UserDefaults
- Posts auth status notifications on login/logout
- Clears sensitive fields after successful login

## Settings Items

`SettingsItemView.swift` provides a reusable row component:
- Icon with colored badge background
- Title text
- Optional detail/chevron

## Configuration Persistence

All settings are backed by `UserDefaults` through the `Configuration` enum:

| Setting | Key | Default |
|---------|-----|---------|
| `hideAcademicScore` | `hideAcademicScore` | `false` |
| `showMondayClass` | `showMondayClass` | `true` |
| `showSecondsInLongCountdown` | `showSecondsInLongCountdown` | `false` |
| `showCountdownForFutureClasses` | `showCountdownForFutureClasses` | `false` |
| `isHolidayMode` | `isHolidayMode` | `false` |
| `holidayHasEndDate` | `holidayHasEndDate` | `false` |
| `holidayEndDate` | `holidayEndDate` | now + 1 day |
| `debugNetworkLogging` | `debugNetworkLogging` | `true` |
| `selectedDayOverride` | `selectedDayOverride` | nil (-1) |
| `setAsToday` | `setAsToday` | `false` |

Holiday mode changes post `.holidayModeDidChange` notification and update widget data.
