# Caching

## CacheManager

`Core/Services/CacheManager.swift` provides UserDefaults-based caching with TTL (time-to-live) expiration.

### Cache Durations

| Data Type | TTL | Key Pattern |
|-----------|-----|-------------|
| Years (academic year list) | 1 day (86400s) | `cachedYears` |
| Terms | 5 minutes (300s) | `cachedTerms_{yearId}` |
| Club groups | 5 minutes (300s) | `cachedClubGroups` |
| School arrangements | 24 hours | `cachedArrangements` |
| Timetables | 1 day | `cachedTimetable_{yearId}` |
| Scores | 5 minutes | `cachedScores_{yearId}_{termId}` |
| Activities | 5 minutes | `cachedActivities_{groupId}` |

Each cached item has a corresponding timestamp key (e.g., `cachedYearsTimestamp`).

### Cache Operations

**Read with TTL check:**
```swift
CacheManager.getCachedData(forKey:) -> Data?
CacheManager.isCacheValid(timestampKey:duration:) -> Bool
```

**Write:**
```swift
CacheManager.cacheData(_:forKey:timestampKey:)
```

**Targeted clearing:**
- `clearClasstableCache()` -- Years, timetable, timestamp data
- `clearAcademicScoresCache()` -- Score data for all years/terms
- `clearClubActivitiesCache()` -- Activity records
- `clearArrangementsCache()` -- School arrangements
- `clearAllCache()` -- Everything (preserves `hideAcademicScore` setting)

**Refresh notifications:**
`refreshCache(type:)` posts notifications to trigger ViewModel refreshes:
- `CacheType.classtable` / `.academicScores` / `.clubActivities` / `.schoolArrangements`

### Automatic Cleanup

`scheduleAutomaticCleanup()` sets up a daily timer that:
1. `cleanupOutdatedCache()` -- Removes entries with expired timestamps
2. `cleanupPatternBasedCaches()` -- Handles timetable/score/activity caches with prefix patterns
3. `cleanupOrphanedCacheEntries()` -- Removes cache data without timestamp counterparts

### Cache Health

`CacheHealth` enum rates overall cache status:

| Rating | Condition |
|--------|-----------|
| Excellent | All caches valid |
| Good | Most caches valid |
| Fair | Some caches expired |
| Poor | Most caches expired |
| None | No cached data |

### CacheStatusView

`Core/Views/CacheStatusView.swift` provides a debug view showing:
- Overall cache health with color indicator
- Estimated cache size (via ByteCountFormatter)
- Per-component validity and last update timestamps
- Buttons: Refresh All, Clean Outdated, Clear specific types, Clear All

## ViewModel Cache Patterns

ViewModels implement their own cache logic on top of CacheManager:

### ClasstableViewModel
- 1-day TTL with `ignoreTTL` parameter for forced refresh
- Falls back to stale cached data during network failures
- Stores `[[String]]` 2D grid in UserDefaults

### ScoreViewModel
- 5-minute TTL per term
- `termsWithData` set tracks which terms have been fetched
- Debounced auto-save via Combine publishers

### ClubActivitiesViewModel
- Per-group activity cache (300s TTL)
- In-memory group list cache

### CASServiceV2
- In-memory `groupDetailsCache` dictionary
- Keyed by both `Id` and `GroupNo` for dual-path lookup

## Image Cache

`ImageCache` (in SchoolArrangement models) provides NSCache-based image caching:
- 100-item limit, 50MB cost limit
- Deduplicates concurrent downloads for the same URL
- Clears on `UIApplication.didReceiveMemoryWarningNotification`
