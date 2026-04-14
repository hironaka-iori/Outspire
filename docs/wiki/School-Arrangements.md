# School Arrangements & Lunch Menus

## School Arrangements

Weekly school arrangements (announcements, schedules, notices) published by the school administration.

### Data Model

```
SchoolArrangementItem
  ├── id, title, publishDate, url
  ├── weekNumbers: [String]
  └── isExpanded: Bool

SchoolArrangementDetail
  ├── id, title, publishDate
  ├── imageUrls: [String]
  └── content: String

ArrangementGroup
  ├── title, items: [SchoolArrangementItem]
  └── isExpanded: Bool
```

### SchoolArrangementViewModel

- Fetches paginated list from TSIMS v2 API
- Parses HTML content for images and text
- Groups arrangements by title
- Downloads images with `ImageCache` (NSCache, 100-item / 50MB limit)
- Generates PDFs from arrangement content
- Deduplicates in-flight image download tasks

### Views

- **SchoolArrangementView** -- List of arrangement groups with expand/collapse
- **SchoolArrangementDetailView** -- Full arrangement with images and content
- **EnhancedPDFViewer** -- PDF rendering with zoom/pan
- **UnifiedPDFPreview** -- Share-ready PDF preview

### Components

- `ArrangementSectionViews` -- Section rendering with proper formatting
- `EmptyStateView` -- "No arrangements found" placeholder
- `SchoolArrangementSkeletonView` -- Loading skeleton with shimmer
- `UIComponents` -- Shared arrangement UI elements

## Lunch Menus

Similar architecture to School Arrangements but for dining hall menus.

### Data Model

```
LunchMenuItem → LunchMenuDetail → LunchMenuGroup
```

Same pattern: paginated list → detail with images → grouped display.

### LunchMenuViewModel

- Fetches menu items from TSIMS v2
- Same image caching and PDF generation as arrangements
- Groups by title for organized display

### LunchMenuView

- List of menu groups
- Detail view with images
- PDF export capability

## PDF Generation

`PDFGenerator` (`Features/SchoolArrangement/Utils/PDFGenerator.swift`) converts arrangement/menu content to PDF format for sharing via the system share sheet.

## Image Caching

`ImageCache` provides in-memory image caching:
- NSCache with 100-item limit and 50MB cost limit
- Deduplicates concurrent downloads for the same URL
- Clears on memory warning notification
- Used by both arrangements and lunch menu views
