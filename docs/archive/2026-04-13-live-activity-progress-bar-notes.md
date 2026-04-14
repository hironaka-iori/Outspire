# Live Activity Progress Bar Notes

## Summary

Outspire's Live Activity now uses a time-based `ProgressView` for the linear
progress bar on the lock screen and Dynamic Island expanded presentation.

This change is intentionally narrow:

- It does not change the layout, spacing, padding, or typography.
- It does not change the Live Activity state model.
- It does not change how phase transitions are triggered.

Only the fill behavior of the linear progress bar changed.

## Why

The previous implementation used:

- `Text(timerInterval: ...)` for the countdown text
- `TimelineView(.periodic)` plus manual width calculation for the progress bar

That meant the countdown used system-managed time rendering, but the bar still
depended on periodic view recomputation.

For Live Activities, that is a weaker model than using the system's
time-interval-driven progress rendering directly.

## Current behavior

The current implementation is split intentionally:

- Countdown text:
  - Uses `Text(timerInterval: rangeStart ... rangeEnd, countsDown: true)`
- Linear progress bar on lock screen and expanded Dynamic Island:
  - Uses `ProgressView(timerInterval: rangeStart ... rangeEnd, countsDown: false)`
- Compact/minimal circular progress:
  - Still uses the existing manual progress calculation to avoid visual drift

## Important boundary

The progress bar is cosmetic within the current phase.

It is **not** the source of truth for Live Activity state transitions.

The following still require app-driven or push-driven state updates:

- class -> ending
- class -> break
- break -> next class
- lunch -> next class
- final class -> done

In other words:

- the bar can advance automatically within `rangeStart ... rangeEnd`
- phase changes must still come from `Activity.update(...)` or ActivityKit push

## Files

- `OutspireWidget/OutspireWidgetLiveActivity.swift`

