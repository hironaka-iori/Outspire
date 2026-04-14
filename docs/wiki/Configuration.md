# Configuration

## Configurations.swift

Central configuration enum with feature flags and server URLs, backed by UserDefaults.

### Server URLs

| Property | Value | Purpose |
|----------|-------|---------|
| `tsimsV2BaseURL` | `http://101.227.232.33:8001` | TSIMS v2 API server |

### Display Settings

| Property | Type | Default | Notes |
|----------|------|---------|-------|
| `hideAcademicScore` | Bool | false | Hides scores tab/section |
| `showMondayClass` | Bool | true | Show Monday in timetable |
| `showSecondsInLongCountdown` | Bool | false | Seconds display in countdown |
| `showCountdownForFutureClasses` | Bool | false | Show countdown for non-current classes |
| `selectedDayOverride` | Int? | nil | Override displayed weekday (stored as -1 for nil) |
| `setAsToday` | Bool | false | Treat override day as current day |
| `lastAppLaunchDate` | Date? | nil | Day-change detection |

### Holiday Mode

| Property | Type | Default | Notes |
|----------|------|---------|-------|
| `isHolidayMode` | Bool | false | Posts `.holidayModeDidChange`, updates widget |
| `holidayHasEndDate` | Bool | false | Whether end date is set |
| `holidayEndDate` | Date | now + 1 day | Holiday end date |

### LLM

| Property | Value |
|----------|-------|
| `llmModel` | `grok/grok-3-latest` |

### Debug

| Property | Type | Default |
|----------|------|---------|
| `debugNetworkLogging` | Bool | true |

## Configurations.local.swift

Git-ignored file containing secrets. Copy from `Configurations.local.swift.example`:

```swift
extension Configuration {
    static var llmApiKey: String { "YOUR_API_KEY" }
    static var llmBaseURL: String { "https://api.endpoint.com/v1" }
    static var pushWorkerAuthSecret: String { "YOUR_PUSH_WORKER_SECRET" }
}
```

### Secrets

| Property | Purpose |
|----------|---------|
| `llmApiKey` | API key for Grok LLM service |
| `llmBaseURL` | LLM API endpoint URL |
| `pushWorkerAuthSecret` | Shared secret for push worker auth (x-auth-secret header) |

## App Identifiers

| Identifier | Value |
|------------|-------|
| Bundle ID | `dev.wrye.Outspire` |
| App Group | `group.dev.wrye.Outspire` |
| Keychain service | `dev.wrye.outspire` |
| OSLog subsystem | `dev.wrye.Outspire` |
| URL scheme | `outspire://` |
| Universal link domain | `outspire.wrye.dev` |
| Push worker domain | `outspire-apns.wrye.dev` |

## Notifications

Global `Notification.Name` constants used across the app:

| Notification | Posted By | Purpose |
|-------------|-----------|---------|
| `.authStateDidChange` | AuthServiceV2 | Auth state changed |
| `.holidayModeDidChange` | Configuration | Holiday mode toggled |
| `.authenticationStatusChanged` | AccountV2ViewModel | Login/logout completed |
| `.tsimsV2Unauthorized` | TSIMSClientV2 | Session expired, needs reauth |
| `.tsimsV2ReauthFailed` | AuthServiceV2 | Reauthentication failed |

## Environment Detection

`ReceiptChecker` identifies the runtime environment:

| Environment | Detection |
|-------------|-----------|
| Simulator | `#if targetEnvironment(simulator)` |
| TestFlight | Sandbox receipt + no embedded provision |
| App Store | Not simulator, not sandbox, no provision |
| Debug | Embedded mobileprovision present |

## Logging

`Log` enum provides OSLog loggers with subsystem `dev.wrye.Outspire`:

| Logger | Category | Usage |
|--------|----------|-------|
| `Log.app` | "App" | General app events |
| `Log.net` | "Network" | Network requests/responses |
| `Log.auth` | "Auth" | Authentication events |
| `Log.widget` | "Widget" | Widget-related events |
