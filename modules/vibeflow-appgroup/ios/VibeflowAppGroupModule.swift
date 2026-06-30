import ExpoModulesCore

/// Tiny native bridge that lets the JS app write into the **App Group** shared with
/// the keyboard extension. The keyboard reads these same keys (`latest_dictation`,
/// `history_json`, `snippets_json`) from `UserDefaults(suiteName:)`.
///
/// This is the only piece of the hand-off that must be native (it can't ride OTA),
/// but it's intentionally generic and stable — the *content* it stores is decided
/// in JS, so the hand-off behaviour stays OTA-updatable.
public class VibeflowAppGroupModule: Module {
  private let appGroup = "group.com.vibeflow.mobile"
  private var store: UserDefaults? { UserDefaults(suiteName: appGroup) }

  public func definition() -> ModuleDefinition {
    Name("VibeflowAppGroup")

    // Store a string (JSON or plain) under a key in the shared suite.
    Function("setItem") { (key: String, value: String) -> Void in
      self.store?.set(value, forKey: key)
    }

    // Read a string back (mainly for debugging / parity checks from JS).
    Function("getItem") { (key: String) -> String? in
      self.store?.string(forKey: key)
    }

    Function("removeItem") { (key: String) -> Void in
      self.store?.removeObject(forKey: key)
    }
  }
}
