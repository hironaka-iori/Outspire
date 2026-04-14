# Networking

## TSIMSClientV2

The low-level HTTP client (`Core/Services/TSIMS/TSIMSClientV2.swift`) is a singleton that wraps `URLSession` with cookie handling and automatic reauthentication.

### Configuration

| Setting | Value |
|---------|-------|
| Timeout | 15 seconds |
| Cookie handling | Enabled (HTTPCookieStorage.shared) |
| Content-Type (POST) | `application/x-www-form-urlencoded; charset=UTF-8` |
| User-Agent | iPhone Safari string |
| Accept | `application/json, text/javascript, */*; q=0.01` |
| X-Requested-With | `XMLHttpRequest` |

### Methods

**Async (preferred):**
- `postFormAsync<T>(path:params:)` -- POST with form-encoded body, returns `ApiResponse<T>`
- `getJSONAsync<T>(path:queryParams:)` -- GET with URL query parameters, returns `ApiResponse<T>`

**Callback-based (legacy):**
- `postForm<T>(path:params:completion:)` -- Same as async with callback
- `postFormRaw(path:params:completion:)` -- Returns raw `Data`
- `getJSON<T>(path:queryParams:completion:)` -- GET with callback

### Reauthentication Flow

TSIMSClientV2 detects unauthorized responses and retries automatically:

```
Request → Server
  ├── 200 + JSON → Decode ApiResponse<T> → Return
  ├── 401 status → Trigger reauth → Retry once
  ├── 302 redirect → Trigger reauth → Retry once
  └── 200 + text/html → Login page redirect → Trigger reauth → Retry once
           │
           ▼
  AuthServiceV2.refreshSessionIfNeeded()
           │
    ┌──────┴──────┐
    ▼             ▼
  Success       Failure
    │             │
  Retry req   Post .tsimsV2Unauthorized
    │           Return .unauthorized
    ▼
  Return response
```

### Logging

Uses `Log.net` (OSLog). Debug builds include:
- Request body preview (first 200 chars)
- Cookie names for the request URL
- Response status code, content-type, data size

## API Envelope

All TSIMS v2 API responses use the `ApiResponse<T>` envelope:

```swift
struct ApiResponse<T: Decodable>: Decodable {
    let resultType: ResultTypeValue  // "0" or 0 = success
    let message: String?
    let data: T?
}
```

`ResultTypeValue` supports both string and integer success indicators:
- `"0"` (string) = success
- `0` (int) = success

### Paginated Responses

```swift
struct Paged<T: Decodable>: Decodable {
    let totalCount: Int
    let list: [T]
}
```

## Server URLs

| Server | URL | Purpose |
|--------|-----|---------|
| TSIMS v2 | `http://101.227.232.33:8001` | Main API server |
| Push Worker | `https://outspire-apns.wrye.dev` | APNs push relay |
| Universal Links | `https://outspire.wrye.dev` | Deep link domain |

## Network Error Types

```swift
enum NetworkError: Error {
    case invalidURL
    case noData
    case decodingError(Error)
    case requestFailed(Error)
    case serverError(Int)
    case unauthorized
}
```

## Connectivity Monitoring

`ConnectivityManager` provides network state tracking:

- **NWPathMonitor** on background queue for local network status
- **Server probe** -- HEAD request to TSIMS v2 base URL every 5 minutes
- **Alert suppression** during onboarding (prevents "no internet" alert from interrupting setup)
- **Automatic refresh** when network becomes available after being offline

### ConnectivityAlertModifier

A `ViewModifier` applied at the app level that shows a system alert when `showNoInternetAlert` is true.
