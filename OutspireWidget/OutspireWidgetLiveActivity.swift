import ActivityKit
import SwiftUI
import WidgetKit

// MARK: - Helpers

private func stateColor(for state: ClassActivityAttributes.ContentState) -> Color {
    switch state.status {
    case .ongoing: SubjectColors.color(for: state.className)
    case .ending: .orange
    case .upcoming: .green
    case .break: SubjectColors.color(for: state.nextClassName ?? state.className)
    case .event: .purple
    }
}

private func countdownColor(for state: ClassActivityAttributes.ContentState) -> Color {
    switch state.status {
    case .ongoing: .white
    case .ending: .orange
    case .upcoming, .break, .event: .white.opacity(0.4)
    }
}

private func countdownLabel(for status: ClassActivityAttributes.ContentState.Status) -> String {
    switch status {
    case .ongoing, .ending: "ENDS IN"
    case .upcoming, .break: "STARTS IN"
    case .event: "TODAY"
    }
}

private func progress(for state: ClassActivityAttributes.ContentState, at date: Date) -> Double {
    let total = state.periodEnd.timeIntervalSince(state.periodStart)
    guard total > 0 else { return 0 }
    return min(max(date.timeIntervalSince(state.periodStart) / total, 0), 1)
}

// MARK: - Progress Bar

private struct ProgressBar: View {
    let state: ClassActivityAttributes.ContentState

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(.white.opacity(0.08))

                TimelineView(.periodic(from: .now, by: 10)) { timeline in
                    let p = progress(for: state, at: timeline.date)
                    if p > 0 {
                        Capsule()
                            .fill(LinearGradient(
                                colors: [stateColor(for: state), stateColor(for: state).opacity(0.5)],
                                startPoint: .leading, endPoint: .trailing
                            ))
                            .frame(width: max(geo.size.width * p, 3))
                    }
                }
            }
        }
        .frame(height: 3)
    }
}

// MARK: - Lock Screen

private struct LockScreenView: View {
    let state: ClassActivityAttributes.ContentState

    var body: some View {
        VStack(spacing: 12) {
            HStack {
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

                Spacer(minLength: 16)

                VStack(alignment: .trailing, spacing: 2) {
                    Text(countdownLabel(for: state.status))
                        .font(WidgetFont.caption())
                        .tracking(0.5)
                        .foregroundStyle(.white.opacity(0.4))

                    Text(timerInterval: state.periodStart ... state.periodEnd, countsDown: true)
                        .font(WidgetFont.number())
                        .tracking(-1)
                        .foregroundStyle(countdownColor(for: state))
                        .monospacedDigit()
                }
            }

            ProgressBar(state: state)
        }
        .padding(16)
    }

    private var subtitle: String {
        if case .break = state.status {
            return state.nextClassName.map { "Next: \($0)" } ?? ""
        }
        return state.roomNumber.isEmpty ? "" : state.roomNumber
    }
}

// MARK: - Widget

struct OutspireWidgetLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ClassActivityAttributes.self) { context in
            LockScreenView(state: context.state)
                .activityBackgroundTint(Color(red: 0.11, green: 0.11, blue: 0.12))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 8) {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(context.state.className)
                                    .font(WidgetFont.title(size: 15))
                                    .tracking(-0.2)
                                    .foregroundStyle(.white)
                                    .lineLimit(1)

                                if !context.state.roomNumber.isEmpty {
                                    Text(context.state.roomNumber)
                                        .font(WidgetFont.caption(size: 10))
                                        .tracking(0.5)
                                        .foregroundStyle(.white.opacity(0.4))
                                }
                            }

                            Spacer(minLength: 12)

                            VStack(alignment: .trailing, spacing: 2) {
                                Text(countdownLabel(for: context.state.status))
                                    .font(WidgetFont.caption(size: 10))
                                    .tracking(0.5)
                                    .foregroundStyle(.white.opacity(0.4))

                                Text(timerInterval: context.state.periodStart ... context.state.periodEnd, countsDown: true)
                                    .font(WidgetFont.number(size: 24))
                                    .tracking(-1)
                                    .foregroundStyle(stateColor(for: context.state))
                                    .monospacedDigit()
                            }
                        }

                        ProgressBar(state: context.state)
                    }
                }
            } compactLeading: {
                TimelineView(.periodic(from: .now, by: 10)) { timeline in
                    ProgressRing(
                        progress: progress(for: context.state, at: timeline.date),
                        color: stateColor(for: context.state),
                        lineWidth: 2,
                        size: 12
                    )
                }
            } compactTrailing: {
                Text(timerInterval: context.state.periodStart ... context.state.periodEnd, countsDown: true)
                    .font(WidgetFont.number(size: 13))
                    .tracking(-0.5)
                    .foregroundStyle(stateColor(for: context.state))
                    .monospacedDigit()
            } minimal: {
                TimelineView(.periodic(from: .now, by: 10)) { timeline in
                    ProgressRing(
                        progress: progress(for: context.state, at: timeline.date),
                        color: stateColor(for: context.state),
                        lineWidth: 2,
                        size: 12
                    )
                }
            }
            .widgetURL(URL(string: "outspire://today"))
        }
    }
}
