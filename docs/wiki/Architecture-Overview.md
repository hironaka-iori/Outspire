# Architecture Overview

## Pattern: Feature-Based MVVM

Outspire follows a feature-based MVVM architecture where each feature module contains its own `Views/` and `ViewModels/` subdirectories. Shared infrastructure lives in `Core/` and `UI/`.

```
                    ┌──────────────┐
                    │  OutspireApp  │  SwiftUI App + AppDelegate
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │RootTabView│ │NavSplitV │ │Onboarding│   Navigation layer
        └────┬─────┘ └────┬─────┘ └──────────┘
             │            │
    ┌────────┼────────────┼────────┐
    ▼        ▼            ▼        ▼
 TodayView  Academic    CAS     Explore        Feature views
    │        │           │         │
    ▼        ▼           ▼         ▼
 ViewModels  ViewModels  ViewModels              @Observable/@ObservableObject
    │        │           │
    ▼        ▼           ▼
 Core Services (AuthServiceV2, TSIMSClientV2, CacheManager, ...)
    │
    ▼
 TSIMS v2 Server (HTTP API)
```

## Singleton Services

All major services are singletons accessed via `.shared`:

| Service | Purpose |
|---------|---------|
| `AuthServiceV2` | Authentication, session management, reauthentication |
| `TSIMSClientV2` | Low-level HTTP client with automatic retry |
| `CASServiceV2` | CAS activities and reflections |
| `ScoreServiceV2` | Academic scores |
| `TimetableServiceV2` | Timetable and year options |
| `HomeServiceV2` | Menu structure (DEAD CODE -- never called) |
| `CacheManager` | UserDefaults-based caching with TTL |
| `ConnectivityManager` | Network monitoring + server health |
| `ClassPeriodsManager` | Hardcoded 9-period school schedule |
| `ClassActivityManager` | Live Activity lifecycle |
| `NotificationManager` | Local notification scheduling |
| `URLSchemeHandler` | Deep linking state |
| `PushRegistrationService` | Push worker communication |
| `DisclaimerManager` | AI disclaimer state |
| `AnimationManager` | First-launch and animation tracking |
| `HapticManager` | Centralized haptic feedback |

## Data Flow

### Read Path

```
View → ViewModel → Service → TSIMSClientV2 → TSIMS Server
                                    │
                              (on 401/302/HTML)
                                    │
                              AuthServiceV2.refreshSessionIfNeeded()
                                    │
                              (retry original request)
```

### Write Path (Widget)

```
ClasstableViewModel.loadTimetable()
    → WidgetDataManager.updateTimetable()
        → App Group UserDefaults (group.dev.wrye.Outspire)
            → WidgetDataReader.readTimetable() (widget process)
                → ClassWidgetProvider.getTimeline()
```

### Write Path (Live Activity)

```
ClasstableViewModel.onChange(timetable)
    → ClassActivityManager.setTimetable()
        → startLiveActivityIfNeeded()
            → Activity<ClassActivityAttributes>.request()
    → PushRegistrationService.register()
        → Cloudflare Worker
            → APNs push updates
```

## State Management

- **@Published properties** on `@MainActor` singletons drive UI reactivity
- **UserDefaults** for persistent preferences (`Configuration` enum)
- **Keychain** (`SecureStore`) for credentials
- **App Group UserDefaults** for widget data sharing
- **In-memory caches** on services (e.g., `CASServiceV2.groupDetailsCache`)

## Platform Branching

The app supports multiple iOS versions with conditional compilation:

| Feature | iOS 26+ | iOS 18+ | iOS 17 (Legacy) |
|---------|---------|---------|-----------------|
| Tab bar | Liquid Glass + `.sidebarAdaptable` | `Tab()` API | `TabItem` |
| Card styling | `.glassEffect()` | Material + shadows | Same as iOS 18 |
| Scroll edges | `.applyScrollEdgeEffect()` | N/A | N/A |
| Animations | `.breathe` | `.breathe` | `.pulse` fallback |

Mac Catalyst is partially supported with simplified gradients (no ColorfulX) and keyboard navigation in onboarding.

## Error Recovery

The architecture emphasizes resilience:

1. **Automatic reauthentication** -- TSIMSClientV2 detects 401/302/HTML responses and triggers AuthServiceV2.refreshSessionIfNeeded() before retrying
2. **Optimistic auth** -- On cold launch, saved credentials = immediate `isAuthenticated = true`; background verify follows
3. **Stale cache fallback** -- ViewModels serve expired cache data during network failures
4. **Push tombstone** -- Failed unregister persisted and retried on next launch
5. **Registration deduplication** -- SHA256 fingerprint prevents redundant push registrations within 12 hours
