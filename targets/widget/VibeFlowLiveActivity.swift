import ActivityKit
import SwiftUI
import WidgetKit

/// Brand purple used across the Live Activity.
private let brand = Color(red: 0.486, green: 0.361, blue: 1.0)

/// The Flow Session Live Activity: a lock-screen/banner card plus the Dynamic
/// Island presentations. Shown while VibeFlow is capturing your voice.
struct VibeFlowLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: VibeFlowActivityAttributes.self) { context in
            // Lock screen / banner
            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(brand.opacity(0.25)).frame(width: 40, height: 40)
                    Image(systemName: "waveform").foregroundColor(brand)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("VibeFlow").font(.headline).foregroundColor(.white)
                    Text(context.state.status).font(.caption).foregroundColor(.white.opacity(0.7))
                }
                Spacer()
                Image(systemName: "mic.fill").foregroundColor(brand)
            }
            .padding()
            .activityBackgroundTint(Color.black.opacity(0.85))
            .activitySystemActionForegroundColor(.white)

        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "waveform").foregroundColor(brand)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Image(systemName: "mic.fill").foregroundColor(brand)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.state.status).font(.caption).foregroundColor(.white)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if !context.state.transcript.isEmpty {
                        Text(context.state.transcript)
                            .font(.footnote)
                            .foregroundColor(.white.opacity(0.85))
                            .lineLimit(2)
                    }
                }
            } compactLeading: {
                Image(systemName: "waveform").foregroundColor(brand)
            } compactTrailing: {
                Image(systemName: "mic.fill").foregroundColor(brand)
            } minimal: {
                Image(systemName: "waveform").foregroundColor(brand)
            }
            .keylineTint(brand)
        }
    }
}

@main
struct VibeFlowWidgetBundle: WidgetBundle {
    var body: some Widget {
        VibeFlowLiveActivity()
    }
}
