# Project Structure

## Targets

| Target | Min iOS | Purpose |
|--------|---------|---------|
| `Outspire` | 17.0 | Main app |
| `OutspireWidget` | 18.2 | Widget extension (small widget + Live Activity) |
| `OutspireTests` | 17.0 | Unit tests |
| `OutspireUITests` | 17.0 | UI tests |

## Directory Layout

```
Outspire/
  Outspire/
    OutspireApp.swift              # App entry point, delegate, lifecycle
    Configurations.swift           # Feature flags, server URLs, UserDefaults prefs
    Configurations.local.swift     # Git-ignored secrets (API keys, push secret)
    Core/
      Models/
        AcademicModels.swift       # Year struct
        ClassPeriodsModels.swift   # ClassPeriod, ClassPeriodsManager (9-period schedule)
        ClubAndActivityModels.swift# Category, GroupInfo, Member, ActivityRecord, Reflection
        SchoolCalendar.swift       # DEAD CODE: Not used in app (push worker has own TS interfaces)
        StudentInfo.swift          # StudentInfo parser (track, entry year, class number)
        WidgetModels.swift         # ScheduledClass, NormalizedScheduleBuilder, WidgetClassStatus
        TSIMS/V2/
          ApiEnvelope.swift        # ApiResponse<T>, ResultTypeValue, Paged<T>
          V2User.swift             # V2User model
      Services/
        CacheManager.swift         # UserDefaults cache with TTL and cleanup
        ConnectivityManager.swift  # NWPathMonitor + server health checks
        LLMService.swift           # Grok-based CAS suggestion engine
        NetworkError.swift         # Error enum
        NotificationManager.swift  # Local notification scheduling
        PushRegistrationService.swift # Push worker registration/deduplication
        URLSchemeHandler.swift     # Deep linking (outspire://, universal links)
        WidgetDataManager.swift    # App Group data writer for widget
        TSIMS/
          AuthServiceV2.swift      # Cookie auth, session keep-alive, reauth
          CASServiceV2.swift       # Club activities and reflections
          HomeServiceV2.swift      # DEAD CODE: fetchMenu() never called
          ScoreServiceV2.swift     # Academic scores
          TimetableServiceV2.swift # Timetable + HTML year scraping
          TSIMSClientV2.swift      # Low-level HTTP client with retry
      Utils/
        ClassInfoParser.swift      # Parses "teacher\nsubject\nroom" cell format
        DisclaimerManager.swift    # AI suggestion disclaimer tracking
        Log.swift                  # OSLog loggers (app, net, auth)
        ReceiptChecker.swift       # Environment detection (TestFlight, App Store, simulator)
        SecureStore.swift          # Keychain wrapper
        Helpers/
          AnimationManager.swift   # First-launch and view animation tracking
          CaptchaRecognizer.swift  # DEAD CODE: Legacy captcha OCR, unused since V2 migration
      Views/
        CacheStatusView.swift      # Debug cache health display
        ConnectivityAlertModifier.swift # No-internet alert
    Features/
      Academic/
        ViewModels/
          ClasstableViewModel.swift  # Timetable data, caching, Live Activity triggers
          ScoreViewModel.swift       # Grades with biometric auth, term selection
        Views/
          ModernClasstableView.swift # Color-coded daily schedule
          ScoreView.swift            # Protected score display with animations
      Account/
        ViewModels/AccountV2ViewModel.swift # Login/logout state
        Views/AccountV2View.swift          # Auth form UI
      CAS/
        ViewModels/
          AddRecordViewModel.swift       # Activity record form + LLM suggestions
          AddReflectionViewModel.swift   # Reflection form + learning outcomes + LLM
          ClubActivitiesViewModel.swift  # Activity list + CRUD
          ClubInfoViewModel.swift        # Club browsing + join/exit
          ReflectionsViewModel.swift     # Reflection list + delete
        Views/
          AddRecordSheet.swift           # Record creation modal
          AddReflectionSheet.swift       # Reflection creation modal
          ClubActivitiesView.swift       # Activity list with search
          ClubInfoView.swift             # Club browser with categories
          LearningOutcomeExplanationRow.swift # LO icon + explanation
          ReflectionCardView.swift       # Compact reflection card
          ReflectionDetailView.swift     # Full reflection viewer
          ReflectionsView.swift          # Reflection list
      LiveActivity/
        ClassActivityAttributes.swift    # ActivityKit data model
        ClassActivityManager.swift       # Live Activity lifecycle manager
        LiveActivityDebugView.swift      # Debug test scenarios (#if DEBUG)
      Main/
        Extensions/
          EnvironmentValues+Today.swift  # Custom setAsToday environment key
        Utilities/
          AppGradients.swift             # Platform-conditional gradient presets
          ColorfulXPresets.swift          # ColorfulX ↔ SwiftUI color helpers
          GradientManager.swift          # Dynamic context-aware gradient state
          TodayViewHelpers.swift         # Weekday name, weekend check, date format
          ViewType.swift                 # Navigation destination enum
        Views/
          TodayView.swift                # Main dashboard hub
          RootTabView.swift              # Tab bar (iOS 26/18/legacy branches)
          NavSplitView.swift             # DEAD CODE: Replaced by RootTabView, never instantiated
          OnboardingView.swift           # Multi-page first-run flow
          ExtraView.swift                # Explore tab quick links
          HelpView.swift                 # DEAD CODE: Empty stub, only referenced from dead NavSplitView
          ScheduleSettingsSheet.swift    # Day override + holiday mode
          Cards/
            Cards.swift                  # NoClass, Weekend, Holiday, Summary cards
            ClassSummaryCard.swift       # Upcoming/current class card
            UnifiedScheduleCard.swift    # Full day schedule with real-time progress
          Components/
            CircularProgressView.swift
            ColorExtensions.swift
            InfoRow.swift
            ScheduleRow.swift
            TodayHeaderView.swift
            TodayMainContentView.swift
            UpcomingClassSkeletonView.swift
      Map/
        Utils/
          ChinaCoordinateConvertion.swift # WGS84 ↔ GCJ-02 conversion
          RegionCheck.swift              # China region detection
        View/MapView.swift               # Campus map with boundary polygon
      SchoolArrangement/
        Models/
          LunchMenuModels.swift
          SchoolArrangementModels.swift
        Utils/PDFGenerator.swift
        ViewModels/
          LunchMenuViewModel.swift
          SchoolArrangementViewModel.swift
        Views/
          Components/ (section views, empty state, skeleton, UI components)
          EnhancedPDFViewer.swift
          LunchMenuView.swift
          SchoolArrangementDetailView.swift
          SchoolArrangementView.swift
          UnifiedPDFPreview.swift
      Settings/
        Views/
          AboutView.swift
          GradientSettingsView.swift
          LicenseView.swift
          ProfileHeaderView.swift
          SettingsGeneralView.swift
          SettingsItemView.swift
          SettingsNotificationsView.swift
          SettingsView.swift
    UI/
      Components/
        ActivitySkeletonView.swift   # CAS activity loading skeleton
        CASBadge.swift               # C/A/S type badge
        ErrorView.swift              # Error state with retry
        GlassmorphicComponents.swift # Card modifiers (glass, rich, elevated)
        HapticManager.swift          # Centralized haptic feedback
        LoadingView.swift            # Generic loading indicator
        Typography.swift             # Font presets (hero, card, body, etc.)
      Extensions/
        View+Shimmering.swift        # Skeleton shimmer animation
      Theme/
        AppBackground.swift          # Dark/light background colors
        DesignTokens.swift           # Spacing, radius, shadow, color tokens
  OutspireWidget/
    AppIntent.swift                  # Widget configuration intent
    OutspireWidget.swift             # Small widget definition + provider
    OutspireWidgetBundle.swift       # Widget bundle entry point
    OutspireWidgetLiveActivity.swift # Live Activity + Dynamic Island
    WidgetDataProvider.swift         # Timeline provider logic
    Shared/
      ClassActivityAttributes.swift  # ActivityKit attributes (shared with main app)
      WidgetClassPeriods.swift       # Hardcoded 9-period schedule for widget
      WidgetDataReader.swift         # App Group UserDefaults reader
      WidgetSharedModels.swift       # ScheduledClass, NormalizedScheduleBuilder
    Views/
      ProgressRing.swift             # Circular progress for Dynamic Island
      SmallWidgetView.swift          # Small widget rendering
      SubjectColors.swift            # Subject → color mapping
      WidgetTypography.swift         # Widget font presets
  OutspireTests/
    CacheManagerTests.swift
    NotificationManagerTests.swift
    OutspireTests.swift              # Swift Testing placeholder
    TSIMSClientV2Tests.swift
  OutspireUITests/
    OutspireUITests.swift
    OutspireUITestsLaunchTests.swift
```

## SPM Dependencies

| Package | Purpose |
|---------|---------|
| SwiftSoup | HTML parsing (TSIMS profile/timetable scraping) |
| Toasts (swiftui-toasts) | Toast notifications |
| ColorfulX | Animated gradient backgrounds |
| SwiftOpenAI | LLM API client for CAS suggestions |

## Tooling

| Tool | Config File | Purpose |
|------|-------------|---------|
| SwiftLint | `.swiftlint.yml` | Code style enforcement |
| SwiftFormat | `.swiftformat` | Automatic formatting |
| Xcode | `Outspire.xcodeproj` | Build system |
