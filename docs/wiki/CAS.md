# CAS (Creativity, Activity, Service)

## Overview

CAS is the IB program's experiential learning framework. Outspire provides full CAS management: browsing clubs, recording activities, writing reflections, and tracking learning outcomes. The feature includes AI-powered suggestions via LLM integration.

## Club Browsing

### ClubInfoViewModel

Manages club discovery and membership:

- **6 static categories**: Sports, Service, Arts, Life, Academic, Personal
- Fetches full group list from `CASServiceV2.fetchGroupList()`
- Caches group details for enriched display (description, instructor, founding year)
- Join/exit groups with membership status tracking
- HTML description parsing via SwiftSoup (strips `<a>` tags)
- URL scheme integration: handles pending club ID from `outspire://club/{id}`

### ClubInfoView

- Category selector with horizontal scroll
- Club list with search
- Detail display: name (Chinese/English), description, members
- Join options: Regular member vs. Project participant
- Share button for club details

## Activity Records

### AddRecordViewModel

Form state management for new activity records:

**Fields:**
- Club (group) selector
- Date, title, description (>=80 words required)
- Duration breakdown: Creativity + Activity + Service hours (max 10h each, total > 0)

**Form Persistence:**
- In-memory static cache survives sheet dismissal
- Debounced auto-save via Combine publishers

**LLM Integration:**
- Two-stage disclaimer (first-time warning → post-suggestion confirmation)
- Generates title + description based on past records and club name
- Stores original values for revert capability
- Uses `LLMService.suggestCasRecord()`

### ClubActivitiesViewModel

Activity list management:

- Per-group activity cache (300s TTL)
- Copy to clipboard (title, reflection, or all)
- Delete with confirmation
- Group ID resolution: maps string `GroupNo` → numeric `Id` for API calls
- Search filter on title and reflection text

### ClubActivitiesView

- Group selector dropdown
- Activity cards showing: theme, date, CAS badges (C/A/S durations), reflection preview
- Context menu: copy, delete
- URL scheme: handles `navigateToAddActivity` to auto-open sheet
- Loading skeleton with shimmer animation

## Reflections

### AddReflectionViewModel

Form state for new reflections:

**Fields:**
- Club selector, title, summary (<=100 chars, or <=50 for group 92)
- Content (>=500 chars, or >=150 for group 92)
- 8 learning outcome toggles

**Learning Outcomes:**
1. Awareness (lightbulb icon)
2. Challenge (flame)
3. Initiative (arrow.up.right)
4. Collaboration (person.2)
5. Commitment (heart)
6. Global Value (globe)
7. Ethics (scale.3d)
8. Skills (wrench)

**Special Group 92:**
"Conversation" type with relaxed limits (50-char summary, 150-char content). Uses `suggestConversationReflection()` for shorter 200-240 word AI output.

**LLM Integration:**
- Generates full reflection (title, summary, content) addressing selected learning outcomes
- `LLMService.suggestReflectionOutline()` for structure
- `LLMService.suggestFullReflection()` for complete 550+ word reflection
- Supports "conversational" mode for building upon existing content

### ReflectionsViewModel

Reflection list management:
- Groups reflections by club
- Client-side search on title/summary/content
- Delete with two-step confirmation

### ReflectionDetailView

Full-screen viewer:
- Title, date, summary, content sections
- Learning outcome icons with explanations
- Copy menu (title, summary, content, or all)

### ReflectionCardView

Compact list card:
- Title, date, learning outcome icons, 2-line summary
- Tap → detail sheet
- Context menu for copy/delete

## LLM Service

`Core/Services/LLMService.swift` uses SwiftOpenAI with the Grok-3 model:

### Endpoints

| Method | Purpose | Min Output |
|--------|---------|------------|
| `suggestCasRecord()` | Activity title + description | 90 words |
| `suggestReflectionOutline()` | Structured outline | title + summary + content |
| `suggestFullReflection()` | Complete reflection | 550 words |
| `suggestConversationReflection()` | Short conversation record | 200-240 words |

### Configuration

- Model: `grok/grok-3-latest` (configurable via `Configuration.llmModel`)
- API key and base URL from `Configurations.local.swift`
- Strict JSON schema validation via `JSONSchemaResponseFormat`

### System Prompts

Prompts emphasize:
- IB CAS learning outcomes without explicit naming
- Three depth progressions: concrete → reflective → abstract
- Personal growth and critical thinking
- Uses past 3 records as writing style examples

## CASServiceV2

Backend service for CAS operations:

### API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `fetchGroupList()` | GET /Stu/Cas/GetGroupList | All groups (paginated) |
| `fetchMyGroups()` | GET /Stu/Cas/GetMyGroup | Student's joined groups |
| `fetchRecords()` | GET /Stu/Cas/GetRecordList | Activity records for group |
| `fetchReflections()` | GET /Stu/Cas/GetReflectionList | Reflections for group |
| `deleteReflection()` | DELETE /Stu/Cas/DeleteReflection | Remove reflection |
| `deleteRecord()` | DELETE /Stu/Cas/DeleteRecord | Remove activity record |
| `isGroupLeader()` | GET /Stu/Cas/GetGroupLeader | Check leadership status |
| `joinGroup()` | POST /Stu/Cas/JoinGroup | Join group |
| `exitGroup()` | POST /Stu/Cas/ExitGroup | Leave group |
| `fetchEvaluateData()` | GET /Stu/Cas/GetEvaluateData | Scores and evaluation |

### V2Record Flexibility

The `V2Record` decoder handles inconsistent API responses:
- Title may be `Title` or `Theme`
- Date may be `Date` or `ActivityDateStr`
- Durations may be strings or numbers (`CDuration`/`ADuration`/`SDuration`)
- Computes `Hours` total if not provided by API

### In-Memory Cache

`groupDetailsCache` stores `V2GroupListItem` by both `Id` and `GroupNo` for fast lookups during ID resolution.

## Disclaimer Management

`DisclaimerManager` tracks whether AI suggestion disclaimers have been shown:
- `hasShownReflectionSuggestionDisclaimer`
- `hasShownRecordSuggestionDisclaimer`

Disclaimer text warns that AI is for entertainment only, not academic work. Shown once per session type, persisted to UserDefaults.
