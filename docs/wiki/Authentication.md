# Authentication

## Overview

Outspire uses TSIMS v2 cookie-based authentication exclusively. The legacy PHP backend (`SessionService`) has been fully replaced by `AuthServiceV2`.

## Login Flow

`AuthServiceV2.login(code:password:)` performs a 3-step process:

1. **Seed session cookie** -- `GET /Home/Login?ReturnUrl=%2F` sets `.AspNetCore.Session` cookie
2. **Submit credentials** -- `POST /Home/Login` with form-encoded `code` + `password`
3. **Verify session** -- `GET /Home/GetMenu` with JSON accept headers confirms authenticated session

On success:
- User profile fetched via HTML scraping of `/Home/StudentInfo`
- Credentials stored in Keychain (`SecureStore`)
- User object persisted to UserDefaults
- `isAuthenticated` set to `true`
- `.authStateDidChange` notification posted

## Session Lifecycle

TSIMS v2 sessions expire after approximately 30 minutes. AuthServiceV2 manages this with:

- **Keep-alive timer** -- 20-minute repeating timer calls `refreshSessionIfNeeded()` to refresh cookies before expiry
- **Automatic reauthentication** -- If session is detected as expired (via API call failure), stored Keychain credentials are used to re-login transparently
- **Reauthentication triggers**:
  - TSIMSClientV2 detects 401 status, 302 redirect, or HTML content-type response
  - Posts `.tsimsV2Unauthorized` notification
  - AuthServiceV2 listens and attempts reauth
  - Posts `.tsimsV2ReauthFailed` if credentials missing or login fails

## Optimistic Auth

On cold launch, if both a saved user and Keychain credentials exist, `AuthServiceV2` immediately sets `isAuthenticated = true` before network verification completes. This lets the UI show cached timetable data instantly instead of flashing the sign-in prompt. Background verification runs concurrently; `isAuthenticated` only reverts to `false` if reauth also fails.

## Install Detection

AuthServiceV2 detects app reinstallation by comparing markers in UserDefaults and Keychain:
- UserDefaults marker is cleared on reinstall (app sandbox is wiped)
- Keychain marker persists across installs
- Mismatch triggers credential clearing to prevent stale auth from a previous install

## Logout

`AuthServiceV2.logout()` → `clearSession()`:
1. POST /Home/logout to server
2. Delete all cookies from `HTTPCookieStorage.shared`
3. Reset `URLSession` (new session with clean cookie jar)
4. Clear UserDefaults auth state + user object
5. Delete Keychain credentials
6. End all Live Activities (`ClassActivityManager.endAllActivities()`)
7. Unregister from push worker (`PushRegistrationService.unregister()`)
8. Update widget auth state

## Profile Scraping

`fetchProfile()` uses SwiftSoup to parse `/Home/StudentInfo` HTML:
- Looks for `input[name=UserCode]` and `input[name=UserId]`
- Falls back to table cell parsing for name/code
- Tries `FirstName`/`LastName` input fields
- Extracts student info (entry year, track, class number) via `StudentInfo` parser

## Student Identity

`StudentInfo` parses user codes like `20238123` or `s20238123`:
- **Entry year**: First 4 digits (e.g., `2023`)
- **Class number**: 5th digit (values 1-9)
- **Track**: IBDP (classes 1-6) or ALEVEL (classes 7-9)

## Credential Storage

| Data | Storage | Access |
|------|---------|--------|
| Username/password | Keychain (`SecureStore`) | `.whenUnlockedThisDeviceOnly` |
| Last used code | UserDefaults | Auto-prefill on login form |
| User object (V2User) | UserDefaults (JSON) | Quick access without network |
| Session cookies | HTTPCookieStorage | Automatic with URLSession |
