import ActivityKit
import Foundation

/// Duplicate of `targets/widget/Attributes.swift` — MUST stay identical (ActivityKit
/// matches the app and widget by this exact type; Expo can't share one file across
/// both targets).
public struct VibeFlowActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable & Hashable {
        public var status: String
        public var transcript: String

        public init(status: String, transcript: String) {
            self.status = status
            self.transcript = transcript
        }
    }

    public var startedAt: Double

    public init(startedAt: Double) {
        self.startedAt = startedAt
    }
}
