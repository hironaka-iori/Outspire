# Testing

## Test Targets

| Target | Framework | Purpose |
|--------|-----------|---------|
| `OutspireTests` | XCTest + Swift Testing | Unit tests |
| `OutspireUITests` | XCTest | UI tests + launch performance |

## Unit Tests

### CacheManagerTests

Tests for `CacheManager` cache operations and expiration:

- `test_clearClasstableCache_removesExpectedKeys()` -- Verifies clearing timetable cache removes years, timetable data, and timestamps
- `test_cleanupOutdatedCache_removesExpired()` -- Sets all timestamps to past, verifies cleanup removes stale entries
- `test_getOutdatedCacheCount_countsExpired()` -- Validates expired cache counting (defensive: asserts > 0, not exact count)

### NotificationManagerTests

Smoke tests for notification and Keychain operations:

- `testCentralizedNotificationManagement()` -- Calls `handleNotificationSettingsChange()` and `handleAppBecameActive()` to verify no crashes
- `testSecureStore_set_get_remove()` -- Tests Keychain CRUD: set → get → remove → get(nil)

### TSIMSClientV2Tests

Tests for the TSIMS API client:

- `test_getJSONAsync_success()` -- Happy path: mock 200 + JSON → decode `ApiResponse<TestData>`
- `test_getJSONAsync_unauthorized_status()` -- HTTP 401 → throws `NetworkError.unauthorized`
- `test_getJSONAsync_unauthorized_html()` -- HTTP 200 + `text/html` content-type → throws `NetworkError.unauthorized` (login redirect detection)

### OutspireTests

Placeholder file using Swift Testing framework (`import Testing`). Single empty `@Test` method.

## UI Tests

### OutspireUITests

- `testExample()` -- Empty placeholder, launches app
- `testLaunchPerformance()` -- Measures app launch time with `XCTApplicationLaunchMetric`

### OutspireUITestsLaunchTests

- `testLaunch()` -- Launches app, captures screenshot as "Launch Screen" attachment
- `runsForEachTargetApplicationUIConfiguration = true` -- Captures for all device configurations

## Mock Pattern

Both `NotificationManagerTests` and `TSIMSClientV2Tests` use a custom `URLProtocol` subclass for network mocking:

```swift
class MockURLProtocol: URLProtocol {
    static var responseData: Data?
    static var responseStatusCode: Int = 200
    static var responseHeaders: [String: String] = [:]
    static var error: Error?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        // Return mock response or error
    }
}
```

The mock is injected via a custom `URLSession` configuration:
```swift
let config = URLSessionConfiguration.ephemeral
config.protocolClasses = [MockURLProtocol.self]
TSIMSClientV2.shared.setSession(URLSession(configuration: config))  // #if DEBUG only
```

## Build & Test Commands

```bash
# Build for simulator
xcodebuild -project Outspire.xcodeproj -scheme Outspire \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build

# Run all tests
xcodebuild -project Outspire.xcodeproj -scheme Outspire \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -enableCodeCoverage YES test
```

## Test Coverage

Current test coverage focuses on:
- Cache management correctness
- Keychain operations
- API client JSON decoding and error handling
- App launch performance

Areas without dedicated tests (tested via integration/manual):
- ViewModel business logic
- View rendering
- Deep linking
- Live Activity lifecycle
- Push registration
