import AVFoundation
import ExpoModulesCore

/// The **Flow Session** — the Wispr-style "one hop, then unlimited" engine.
///
/// After the first keyboard→app round-trip, the app starts a session that keeps it
/// alive in the background (UIBackgroundModes=audio + a silent looping player), so
/// the keyboard's mic can start/stop recordings *without ever leaving the host app*:
///
///   keyboard mic tap ──Darwin "…flow.toggle"──▶ app (this module → JS event)
///                                               JS starts/stops dictation
///   app writes result ◀─App Group─  JS calls notifyResultReady()
///   keyboard inserts  ◀─Darwin "…flow.result"─┘
///
/// Darwin notifications are the only IPC that works keyboard↔app across processes;
/// they carry no payload, so the actual text rides in the App Group.
public class VibeflowFlowSessionModule: Module {
  private let appGroup = "group.com.vibeflow.mobile"
  static let toggleName = "com.vibeflow.flow.toggle"
  static let resultName = "com.vibeflow.flow.result"

  private var engine: AVAudioEngine?
  private var player: AVAudioPlayerNode?
  private var active = false

  public func definition() -> ModuleDefinition {
    Name("VibeflowFlowSession")
    Events("recordToggle")

    OnCreate {
      self.registerToggleObserver()
    }

    OnDestroy {
      self.teardownSession()
      CFNotificationCenterRemoveEveryObserver(
        CFNotificationCenterGetDarwinNotifyCenter(),
        Unmanaged.passUnretained(self).toOpaque()
      )
    }

    Function("isActive") { self.active }

    /// Start the session: activate a playAndRecord audio session and loop silence
    /// so iOS keeps us running in the background between utterances.
    Function("start") { () -> Bool in
      if self.active { return true }
      do {
        try self.startKeepAlive()
        self.active = true
        self.setFlag(true)
        return true
      } catch {
        self.teardownSession()
        return false
      }
    }

    Function("stop") {
      self.teardownSession()
    }

    /// Re-assert the audio session + keep-alive after a dictation ends (the speech
    /// library may reconfigure/deactivate the shared session when it stops).
    Function("reassert") {
      guard self.active else { return }
      try? self.startKeepAlive()
    }

    /// Tell the keyboard a fresh result is waiting in the App Group.
    Function("notifyResultReady") {
      CFNotificationCenterPostNotification(
        CFNotificationCenterGetDarwinNotifyCenter(),
        CFNotificationName(Self.resultName as CFString),
        nil, nil, true
      )
    }
  }

  // MARK: - Keep-alive (silent loop keeps the audio session — and the app — alive)

  private func startKeepAlive() throws {
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .default,
                            options: [.mixWithOthers, .defaultToSpeaker, .allowBluetooth])
    try session.setActive(true)

    // Rebuild the engine if it stopped (e.g. the speech lib reset the session).
    if let engine = self.engine, engine.isRunning { return }
    self.engine?.stop()

    let engine = AVAudioEngine()
    let player = AVAudioPlayerNode()
    engine.attach(player)
    guard let format = AVAudioFormat(standardFormatWithSampleRate: 8000, channels: 1),
          let silence = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 8000) else {
      throw NSError(domain: "VibeflowFlowSession", code: 1)
    }
    silence.frameLength = 8000 // 1s of zeros
    engine.connect(player, to: engine.mainMixerNode, format: format)
    engine.mainMixerNode.outputVolume = 0
    engine.prepare()
    try engine.start()
    player.scheduleBuffer(silence, at: nil, options: .loops)
    player.play()
    self.engine = engine
    self.player = player
  }

  private func teardownSession() {
    player?.stop()
    engine?.stop()
    player = nil
    engine = nil
    active = false
    setFlag(false)
  }

  private func setFlag(_ on: Bool) {
    UserDefaults(suiteName: appGroup)?.set(on ? "true" : "false", forKey: "flow_session_active")
  }

  // MARK: - Darwin IPC (keyboard → app)

  private func registerToggleObserver() {
    let center = CFNotificationCenterGetDarwinNotifyCenter()
    let observer = Unmanaged.passUnretained(self).toOpaque()
    CFNotificationCenterAddObserver(center, observer, { _, observer, _, _, _ in
      guard let observer = observer else { return }
      let module = Unmanaged<VibeflowFlowSessionModule>.fromOpaque(observer).takeUnretainedValue()
      DispatchQueue.main.async {
        module.sendEvent("recordToggle", [:])
      }
    }, Self.toggleName as CFString, nil, .deliverImmediately)
  }
}
