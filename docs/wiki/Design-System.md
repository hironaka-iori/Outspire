# Design System

## Design Tokens

`UI/Theme/DesignTokens.swift` defines the app's design language.

### Spacing (`AppSpace`)

| Token | Value | Usage |
|-------|-------|-------|
| `xxs` | 4pt | Tight spacing |
| `xs` | 8pt | Small gaps |
| `sm` | 12pt | Standard spacing |
| `md` | 16pt | Section spacing |
| `lg` | 20pt | Large spacing |
| `xl` | 24pt | Extra large |
| `xxl` | 32pt | Maximum spacing |
| `cardPadding` | 20pt | Internal card padding |
| `cardSpacing` | 16pt | Between cards |

### Radius (`AppRadius`)

| Token | Value |
|-------|-------|
| `sm` | 8pt |
| `md` | 14pt |
| `lg` | 18pt |
| `xl` | 22pt |

### Shadows (`AppShadow`)

| Type | Radius | Usage |
|------|--------|-------|
| Edge | 2pt | Crisp card edges (opacity varies by color scheme) |
| Ambient | 12pt | Soft depth |
| Elevated | 16pt | Strong emphasis |

### Colors (`AppColor`)

- `brand` -- Custom "BrandTint" from asset catalog
- Rich dark surfaces (blue-black tones, not flat gray):
  - `richDarkBg`: RGB(0.06, 0.06, 0.09)
  - `richDarkSurface`: RGB(0.10, 0.10, 0.14)
  - `richDarkElevated`: RGB(0.14, 0.14, 0.18)

## Typography

`UI/Components/Typography.swift` defines font presets:

| Preset | Font | Weight | Design |
|--------|------|--------|--------|
| `heroTitle` | .largeTitle | Bold | Default |
| `cardTitle` | .title3 | Bold | Rounded |
| `sectionTitle` | .headline | Bold | Default |
| `title` | .title2 | Bold | Default |
| `subtitle` | .subheadline | Medium | Default |
| `label` | .subheadline | Medium | Default |
| `body` | .body | Regular | Default |
| `bodyBold` | .body | Semibold | Default |
| `monoBody` | .body | Regular | Monospaced |
| `meta` | .footnote | Regular | Default |
| `caption` | .caption | Regular | Default |
| `micro` | .caption2 | Regular | Default |

## Glassmorphic Components

`UI/Components/GlassmorphicComponents.swift` provides card styling modifiers:

### `.glassmorphicCard()`
- iOS 26+: `.glassEffect(.regular, in: shape)`
- Fallback: `ultraThinMaterial` background with rounded corners

### `.glassmorphicPaddedCard(padding:)`
- Same as card with configurable internal padding

### `.glassmorphicRichCard()`
- Deep shadows (edge + ambient) with top highlight
- iOS 26+: Glass effect with depth shadow
- Fallback: Dual-shadow system for visual weight

### `.glassmorphicElevatedCard(tint:)`
- Tinted background with strong depth + colored glow shadow
- Creates visual "floating" effect

### `.glassmorphicColoredRichCard(colors:)`
- Gradient fill with top highlight + dual shadows
- Used for branded or status-specific cards

## Card Button Style

`PressableCardStyle` provides interactive feedback:
- Scale: 0.95 on press
- Opacity: 0.92 on press
- 3D rotation effect on press
- Haptic feedback via `HapticManager`

## Gradient System

### GradientManager

`Features/Main/Utilities/GradientManager.swift` manages dynamic gradients:

**Published properties:**
- `gradientColors: [Color]`
- `gradientSpeed: Double`
- `gradientNoise: Double`
- `gradientTransitionSpeed: Double`

**Contexts** (`GradientContext`):
- `normal` -- Default app gradient
- `notSignedIn` -- Gray/muted
- `weekend` -- Warm yellow/orange
- `holiday` -- Red/orange
- `afterSchool` -- Cool blue
- `inClass(subject)` -- Subject-specific gradient
- `upcomingClass(subject)` -- Lighter subject gradient
- `inSelfStudy` -- Purple tones
- `upcomingSelfStudy` -- Light purple

**Subject-Specific Gradients:**
Generated from class cell data by:
1. Parse `"teacher\nsubject\nroom"` to extract subject name
2. Get base color from `ModernScheduleRow.subjectColor(for:)`
3. Create 4-color gradient: white, lighter variant, base, darker variant

**Persistence:**
- Per-view settings stored as `ViewGradientSettings` (Codable) in UserDefaults
- Global settings toggle applies one gradient to all views
- Settings include hex color strings for serialization

### AppGradients

Platform-conditional presets:

- **iOS**: Uses ColorfulX presets (Ocean, Aurora, Lavandula, Sunset, Winter, Sunrise, Autumn)
- **Mac Catalyst**: Fallback to simple `[Color]` arrays (no ColorfulX)

Semantic presets for each `GradientContext` (inClass, upcomingClass, selfStudy, etc.)

## Background

`UI/Theme/AppBackground.swift`:
- Dark mode: `AppColor.richDarkBg` (deep blue-black)
- Light mode: `.systemGroupedBackground`

## Animations

### Staggered Entry

`staggeredEntry(index:animate:)` from `DesignTokens.swift`:
- Each element enters with 0.08s delay multiplied by index
- Spring animation with bouncy response
- Applied to card lists for cascading appearance

### Shimmer

`View+Shimmering.swift`:
- LinearGradient (clear → white 20% → clear) moving left to right
- Screen blend mode
- 1.2s animation loop
- Used on skeleton loading views

### Scroll Edge Effect

`.applyScrollEdgeEffect()`: iOS 26+ soft dissolve at scroll edges

## Haptics

`HapticManager` centralized feedback:
- Impact: light, medium, heavy
- Notification: success, warning, error
- Selection: picker changes
- Convenience: `playButtonTap()`, `playToggle()`, `playDelete()`, `playNavigation()`

## Widget Typography

`OutspireWidget/Views/WidgetTypography.swift`:
- Numbers: 32px semibold, monospaced digits, -1 tracking
- Titles: 17px bold, -0.2 tracking
- Captions: 11px semibold, +0.5 tracking

All use rounded system font design for friendly appearance.
