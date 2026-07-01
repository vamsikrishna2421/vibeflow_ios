import ActivityKit
import Foundation

/// The shape of the VibeFlow "Flow Session" Live Activity.
///
/// NOTE: this file is duplicated verbatim in
/// `modules/vibeflow-liveactivity/ios/Attributes.swift`. ActivityKit matches the
/// app (which calls `Activity.request`) and this widget by this exact type, and
/// Expo can't share one Swift file across both targets — so the two copies MUST
/// stay identical.
public struct VibeFlowActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable & Hashable {
        /// Short status line, e.g. "Listening…" or "Formatting…".
        public var status: String
        /// The live transcript so far (may be empty).
        public var transcript: String

        public init(status: String, transcript: String) {
            self.status = status
            self.transcript = transcript
        }
    }

    /// When the session started (epoch seconds) — lets the UI show elapsed time.
    public var startedAt: Double

    public init(startedAt: Double) {
        self.startedAt = startedAt
    }
}
