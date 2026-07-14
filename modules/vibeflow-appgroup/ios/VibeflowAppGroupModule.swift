import ExpoModulesCore

/// Tiny native bridge that lets the JS app write into the **App Group** shared with
/// the keyboard extension. The keyboard reads these same keys (`latest_dictation`,
/// `history_json`, `snippets_json`) from `UserDefaults(suiteName:)`.
///
/// This is the only piece of the hand-off that must be native (it can't ride OTA),
/// but it's intentionally generic and stable — the *content* it stores is decided
/// in JS, so the hand-off behaviour stays OTA-updatable.
public class VibeflowAppGroupModule: Module {
  private let appGroup = "group.com.vibeflow.dictation"
  private var store: UserDefaults? { UserDefaults(suiteName: appGroup) }
  /// Only these small, time-critical keys are flushed to CFPreferences on write (the keyboard
  /// reads them LIVE cross-process during a flow session). Everything else stays
  /// UserDefaults-only: forcing a whole-domain CFPreferences sync on every bulk write
  /// (history_json, bigrams) from the backgrounded app is exactly the kind of sustained
  /// disk-IO load that helped jetsam it — and the keyboard reads those keys lazily anyway.
  private static let urgentKeys: Set<String> = [
    "latest_dictation", "latest_dictation_ts", "kbd_flow_status",
    "flow_claim_id", "flow_fallback_done", "flow_utterance_id",
  ]

  public func definition() -> ModuleDefinition {
    Name("VibeflowAppGroup")

    // Store a string (JSON or plain) under a key in the shared suite. Write BOTH channels:
    // UserDefaults for same-process readers, and CFPreferences so the keyboard extension
    // (a DIFFERENT process) reliably sees the value via CFPreferencesCopyAppValue. A plain
    // UserDefaults(suiteName:) write from this process is not always visible to that
    // cross-process read — which stranded dictations (they showed in the live panel, which
    // uses CFPreferences, but latest_dictation went only through UserDefaults and never
    // reached the text field).
    Function("setItem") { (key: String, value: String) -> Void in
      self.store?.set(value, forKey: key)
      // Only the small live-delivery keys pay for a CFPreferences flush (cross-process
      // visibility to the keyboard). Bulk keys stay UserDefaults-only — see urgentKeys.
      if Self.urgentKeys.contains(key) {
        CFPreferencesSetAppValue(key as CFString, value as CFString, self.appGroup as CFString)
        CFPreferencesAppSynchronize(self.appGroup as CFString)
      }
    }

    // Read a string back. Uses CFPreferences with a forced sync so we always get
    // the CURRENT cross-process value (the keyboard extension writes flags like
    // kbd_full_access from another process; plain UserDefaults can read a stale cache).
    Function("getItem") { (key: String) -> String? in
      CFPreferencesAppSynchronize(self.appGroup as CFString)
      if let v = CFPreferencesCopyAppValue(key as CFString, self.appGroup as CFString) as? String {
        return v
      }
      return self.store?.string(forKey: key)
    }

    Function("removeItem") { (key: String) -> Void in
      self.store?.removeObject(forKey: key)
      CFPreferencesSetAppValue(key as CFString, nil, self.appGroup as CFString)
      CFPreferencesAppSynchronize(self.appGroup as CFString)
    }
  }
}
