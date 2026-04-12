import ActivityKit
import SwiftUI
import WidgetKit

// MARK: - Color Helpers

private func stateColor(for state: ClassActivityAttributes.ContentState) -> Color {
    switch state.status {
    case .ongoing:
        return SubjectColors.color(for: state.className)
    case .ending:
        return .orange
    case .upcoming:
        return .green
    case .break:
        return SubjectColors.color(for: state.nextClassName ?? state.className)
    case .event:
        return .purple
    }
}

private func countdownColor(for state: ClassActivityAttributes.ContentState) -> Color {
    switch state.status {
    case .ongoing:
        return .white
    case .ending:
        return .orange
    case .upcoming, .break, .event:
        return .white.opacity(0.4)
    }
}

private func progressGradient(for state: ClassActivityAttributes.ContentState) -> LinearGradient {
    let color = stateColor(for: state)
    switch state.status {
    case .ongoing, .ending, .event:
        return LinearGradient(colors: [color, color.opacity(0.6)], startPoint: .leading, endPoint: .trailing)
    case .upcoming, .break:
        return LinearGradient(colors: [.clear], startPoint: .leading, endPoint: .trailing)
    }
}

private func countdownLabel(for status: ClassActivityAttributes.ContentState.Status) -> String {
    switch status {
    case .ongoing, .ending:
        return "ENDS IN"
    case .upcoming, .break:
        return "STARTS IN"
    case .event:
        return "TODAY"
    }
}

private func progress(for state: ClassActivityAttributes.ContentState, at date: Date) -> Double {
    let total = state.periodEnd.timeIntervalSince(state.periodStart)
    guard total > 0 else { return 0 }
    let elapsed = date.timeIntervalSince(state.periodStart)
    return min(max(elapsed / total, 0), 1)
}

// MARK: - Lock Screen View

private struct LockScreenView: View {
    let state: ClassActivityAttributes.ContentState

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)

            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(state.className)
                        .font(WidgetFont.title())
                        .tracking(-0.2)
                        .foregroundStyle(stateColor(for: state))
                        .lineLimit(1)

                    Text(subtitle)
                        .font(WidgetFont.caption())
                        .tracking(0.5)
                        .foregroundStyle(.white.opacity(0.4))
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 2) {
                    Text(countdownLabel(for: state.status))
                        .font(WidgetFont.caption())
                        .tracking(0.5)
                        .foregroundStyle(.white.opacity(0.4))
                        .textCase(.uppercase)

                    Text(timerInterval: state.periodStart ... state.periodEnd, countsDown: true)
                        .font(WidgetFont.number())
                        .tracking(-1)
                        .foregroundStyle(countdownColor(for: state))
                        .monospacedDigit()
                        .frame(width: 90, alignment: .trailing)
                }
            }

            Spacer(minLength: 0)

            // Progress bar
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(.white.opacity(0.08))
                        .frame(height: 3)

                    TimelineView(.periodic(from: .now, by: 10)) { timeline in
                        let prog = progress(for: state, at: timeline.date)
                        Capsule()
                            .fill(progressGradient(for: state))
                            .frame(width: geo.size.width * prog, height: 3)
                    }
                }
            }
            .frame(height: 3)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
    }

    private var subtitle: String {
        switch state.status {
        case .break:
            return state.nextClassName.map { "Next: \($0)" } ?? ""
        default:
            return state.roomNumber.isEmpty ? "" : state.roomNumber
        }
    }
}

// MARK: - Dynamic Island Views

private struct CompactLeadingView: View {
    let state: ClassActivityAttributes.ContentState

    var body: some View {
        TimelineView(.periodic(from: .now, by: 10)) { timeline in
            ProgressRing(
                progress: progress(for: state, at: timeline.date),
                color: stateColor(for: state),
                lineWidth: 2,
                size: 18
            )
        }
    }
}

private struct CompactTrailingView: View {
    let state: ClassActivityAttributes.ContentState

    var body: some View {
        Text(timerInterval: state.periodStart ... state.periodEnd, countsDown: true)
            .font(WidgetFont.number(size: 15))
            .tracking(-0.5)
            .foregroundStyle(stateColor(for: state))
            .monospacedDigit()
            .frame(width: 52, alignment: .trailing)
    }
}

private struct MinimalView: View {
    let state: ClassActivityAttributes.ContentState

    var body: some View {
        TimelineView(.periodic(from: .now, by: 10)) { timeline in
            ProgressRing(
                progress: progress(for: state, at: timeline.date),
                color: stateColor(for: state),
                lineWidth: 2,
                size: 18
            )
        }
    }
}

// MARK: - Widget Configuration

struct OutspireWidgetLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ClassActivityAttributes.self) { context in
            LockScreenView(state: context.state)
                .activityBackgroundTint(Color(red: 0.11, green: 0.11, blue: 0.12))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(context.state.className)
                            .font(WidgetFont.title(size: 16))
                            .tracking(-0.2)
                            .foregroundStyle(.white)
                            .lineLimit(1)

                        if !context.state.roomNumber.isEmpty {
                            Text(context.state.roomNumber)
                                .font(WidgetFont.caption())
                                .tracking(0.5)
                                .foregroundStyle(.white.opacity(0.4))
                        }
                    }
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(countdownLabel(for: context.state.status))
                            .font(WidgetFont.caption())
                            .tracking(0.5)
                            .foregroundStyle(.white.opacity(0.4))
                            .textCase(.uppercase)

                        Text(timerInterval: context.state.periodStart ... context.state.periodEnd, countsDown: true)
                            .font(WidgetFont.number(size: 28))
                            .tracking(-1)
                            .foregroundStyle(stateColor(for: context.state))
                            .monospacedDigit()
                    }
                    .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule()
                                .fill(.white.opacity(0.08))
                                .frame(height: 3)

                            TimelineView(.periodic(from: .now, by: 10)) { timeline in
                                let prog = progress(for: context.state, at: timeline.date)
                                Capsule()
                                    .fill(progressGradient(for: context.state))
                                    .frame(width: geo.size.width * prog, height: 3)
                            }
                        }
                    }
                    .frame(height: 3)
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                CompactLeadingView(state: context.state)
            } compactTrailing: {
                CompactTrailingView(state: context.state)
            } minimal: {
                MinimalView(state: context.state)
            }
            .widgetURL(URL(string: "outspire://today"))
        }
    }
}
