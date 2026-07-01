import ActivityKit
import ExpoModulesCore

/// Starts / updates / ends the VibeFlow Flow Session Live Activity (Dynamic Island)
/// from JS. No-ops gracefully on iOS < 16.2 or if Live Activities are disabled.
public class VibeflowLiveActivityModule: Module {
    public func definition() -> ModuleDefinition {
        Name("VibeflowLiveActivity")

        // Whether the user has Live Activities enabled for this app.
        Function("isAvailable") { () -> Bool in
            if #available(iOS 16.2, *) {
                return ActivityAuthorizationInfo().areActivitiesEnabled
            }
            return false
        }

        // Start (or no-op if one is already running). Returns the activity id.
        Function("start") { (status: String) -> String? in
            if #available(iOS 16.2, *) {
                guard ActivityAuthorizationInfo().areActivitiesEnabled else { return nil }
                if let existing = Activity<VibeFlowActivityAttributes>.activities.first {
                    return existing.id
                }
                let attributes = VibeFlowActivityAttributes(startedAt: Date().timeIntervalSince1970)
                let state = VibeFlowActivityAttributes.ContentState(status: status, transcript: "")
                do {
                    let activity = try Activity.request(
                        attributes: attributes,
                        content: .init(state: state, staleDate: nil)
                    )
                    return activity.id
                } catch {
                    return nil
                }
            }
            return nil
        }

        AsyncFunction("update") { (status: String, transcript: String) in
            if #available(iOS 16.2, *) {
                let state = VibeFlowActivityAttributes.ContentState(status: status, transcript: transcript)
                for activity in Activity<VibeFlowActivityAttributes>.activities {
                    await activity.update(.init(state: state, staleDate: nil))
                }
            }
        }

        AsyncFunction("stop") {
            if #available(iOS 16.2, *) {
                for activity in Activity<VibeFlowActivityAttributes>.activities {
                    await activity.end(nil, dismissalPolicy: .immediate)
                }
            }
        }
    }
}
