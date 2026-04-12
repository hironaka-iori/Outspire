# APNs Push Worker Architecture

Server-driven Live Activity updates via Cloudflare Workers + APNs.

## Overview

The app registers device push tokens and class schedules with a Cloudflare Worker (`outspire-apns.wrye.dev`). The Worker runs a per-minute cron job that determines which pushes to send based on time-of-day, school calendar, and holidays — then delivers them via APNs to start, update, and end Live Activities.

## Components

### iOS Client

| File | Role |
|------|------|
| `Core/Services/PushRegistrationService.swift` | Sends device registration, pause, resume, and unregister requests to the Worker |
| `Features/LiveActivity/ClassActivityManager.swift` | Observes `pushToStartTokenUpdates` and `pushTokenUpdates`, triggers registration when both tokens are available |
| `Core/Services/TSIMS/AuthServiceV2.swift` | Calls `unregister()` + `endAllActivities()` on logout to clean up |

### Cloudflare Worker (`worker/`)

| File | Role |
|------|------|
| `src/index.ts` | HTTP endpoints + cron handler + decision logic |
| `src/apns.ts` | APNs JWT (ES256) auth + push delivery via Web Crypto API |
| `wrangler.toml` | KV namespace, cron triggers, env vars |

## Device Identity

Each device generates a stable UUID on first launch, stored in Keychain (`SecureStore` key: `push_device_id`). This ID is used as the KV key (`reg:{deviceId}`), so re-registrations (token refresh, app restart) overwrite the same record instead of creating garbage entries.

## API Endpoints

All endpoints accept `POST` with JSON body.

| Endpoint | Body | Effect |
|----------|------|--------|
| `/register` | `{ deviceId, pushStartToken, pushUpdateToken, track, entryYear, schedule }` | Creates/overwrites device registration (30-day TTL) |
| `/unregister` | `{ deviceId }` | Deletes registration from KV |
| `/pause` | `{ deviceId, resumeDate? }` | Pauses push delivery; auto-resumes on `resumeDate` |
| `/resume` | `{ deviceId }` | Resumes push delivery |
| `/health` | — | Returns `{ ok: true, time }` |

## Cron Decision Logic (every minute)

For each registered device:

1. **Pause check** — skip if paused (auto-resume if `resumeDate` reached)
2. **School calendar** — fetch from GitHub (`calendar/{year}.json`), check semester range and special days (cancellations, makeup days with `followsWeekday`)
3. **Holiday-cn** — check Chinese statutory holidays/workdays
4. **Weekend** — skip Saturday/Sunday unless makeup day
5. **Build push schedule** — generate start/update/end events with timestamps
6. **Fire due pushes** — match events against current CST minute

## Push Schedule per Day

| Time | Event | Content State |
|------|-------|---------------|
| 30min before first class | `start` | First class, status: `upcoming` |
| Class start time | `update` | Current class, status: `ongoing` |
| 5min before class end | `update` | Current class, status: `ending` |
| Class end time | `update` | Next class, status: `break` |
| Last class end time | `end` | Dismisses Live Activity after 15min |

## Logout / Account Switch

`AuthServiceV2.clearSession()` (called on both successful and failed logout) triggers:
1. `ClassActivityManager.shared.endAllActivities()` — immediately ends any running Live Activity
2. `PushRegistrationService.unregister()` — tells Worker to delete this device's registration

On re-login, the same `deviceId` is reused, so the new account's schedule overwrites cleanly.

## Optimistic Auth

On cold launch, if the device has a saved user + Keychain credentials, `AuthServiceV2` immediately sets `isAuthenticated = true` before the network verify completes. This lets the UI show cached timetable data instantly instead of flashing the sign-in prompt. If background verification fails, it attempts reauth; only marks `isAuthenticated = false` if reauth also fails.

## Environment Secrets (Wrangler)

Set via `wrangler secret put`:
- `APNS_KEY_ID` — Apple Push key ID
- `APNS_TEAM_ID` — Apple Developer Team ID
- `APNS_PRIVATE_KEY` — `.p8` key contents (PEM)

## Registration Deduplication

`ClassActivityManager` tracks a `hasRegistered` flag that prevents duplicate `/register` calls within a single token lifecycle. Registration only fires when:
- Both `pushStartToken` and `pushUpdateToken` are available
- A valid timetable has been set via `setTimetable(_:)`
- User info (track, entry year) is available

The flag resets when either token changes or when `setTimetable` is called with new data. The `pushToStartTokenUpdates` stream is observed exactly once in `init` (not duplicated in `startActivity`).

## Known Limitations

- No APNs 410 (invalid token) cleanup — stale tokens sit in KV until 30-day expiry
- Worker `scheduled` handler has a pre-existing TypeScript type mismatch (`ScheduledEvent` vs `ScheduledController`) that doesn't affect runtime
