import AVFoundation
import ExpoModulesCore
import Speech

/// The **Flow Session** — the Wispr-style "one hop, then unlimited" engine.
///
/// Architecture (v2 — fully native audio): the bootstrap (app foreground) activates
/// ONE audio session and starts ONE AVAudioEngine whose input tap runs for the whole
/// session. Keyboard toggles (Darwin) attach/detach an SFSpeechRecognizer request to
/// that already-running stream — the audio session is never reconfigured from the
/// background, which is what kept failing with OSStatus '!int'
/// (AVAudioSessionErrorCodeCannotInterruptOthers).
///
///   keyboard mic ──Darwin toggle──▶ this module: start/stop utterance natively
///   final text  ──App Group + Darwin result──▶ keyboard inserts at the cursor
///   status      ──App Group + Darwin status──▶ keyboard animates the mic
///   "utteranceFinal"/"flowStatus" events ──▶ JS (history + Live Activity text)
public class VibeflowFlowSessionModule: Module {
  private let appGroup = "group.com.vibeflow.dictation"
  static let toggleName = "com.vibeflow.flow.toggle"
  static let resultName = "com.vibeflow.flow.result"
  static let statusName = "com.vibeflow.flow.status"

  private var engine: AVAudioEngine?
  private var player: AVAudioPlayerNode?
  private var active = false

  // Per-utterance recognition riding the always-on input tap.
  private var recognizer: SFSpeechRecognizer?
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var utteranceActive = false
  private var lastTranscript = ""

  private var group: UserDefaults? { UserDefaults(suiteName: appGroup) }

  public func definition() -> ModuleDefinition {
    Name("VibeflowFlowSession")
    Events("recordToggle", "utteranceFinal", "flowStatus")

    OnCreate {
      self.registerDarwinObserver()
    }

    OnDestroy {
      self.teardownSession()
      CFNotificationCenterRemoveEveryObserver(
        CFNotificationCenterGetDarwinNotifyCenter(),
        Unmanaged.passUnretained(self).toOpaque()
      )
    }

    Function("isActive") { self.active }

    /// Start the session (call in the FOREGROUND): one audio activation, one engine,
    /// input tap running until the session ends.
    Function("start") { () -> Bool in
      if self.active { return true }
      do {
        try self.startEngine()
        self.active = true
        self.setFlag(true)
        // Engine capability marker: v2 = defers the keyboard hand-off to JS when
        // the flow_polish flag is set (so dictations can be AI-polished pre-insert).
        self.group?.set("2", forKey: "flow_engine_v")
        self.setStatus("ready")
        return true
      } catch {
        self.teardownSession()
        self.setStatus("error: \(error.localizedDescription)")
        return false
      }
    }

    Function("stop") {
      self.teardownSession()
    }

    /// Best-effort revival of the engine (e.g. after an interruption) — safe no-op
    /// when everything is already running.
    Function("reassert") {
      guard self.active else { return }
      if let engine = self.engine, engine.isRunning { return }
      try? self.startEngine()
    }

    Function("notifyResultReady") { Self.post(Self.resultName) }
    Function("notifyStatus") { Self.post(Self.statusName) }
  }

  // MARK: - Engine (session-long input stream + silent playback keep-alive)

  private func startEngine() throws {
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .default,
                            options: [.mixWithOthers, .defaultToSpeaker, .allowBluetooth])
    try session.setActive(true)

    engine?.stop()
    engine = nil

    let engine = AVAudioEngine()
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else {
      throw NSError(domain: "VibeflowFlowSession", code: 2,
                    userInfo: [NSLocalizedDescriptionKey: "microphone busy"])
    }
    // The session-long tap: buffers flow into whichever utterance request is live.
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
      self?.request?.append(buffer)
    }

    // Silent playback loop — keeps iOS treating us as an active audio app between
    // utterances (recording alone can be reclaimed more aggressively).
    let player = AVAudioPlayerNode()
    engine.attach(player)
    if let silentFormat = AVAudioFormat(standardFormatWithSampleRate: 8000, channels: 1),
       let silence = AVAudioPCMBuffer(pcmFormat: silentFormat, frameCapacity: 8000) {
      silence.frameLength = 8000
      engine.connect(player, to: engine.mainMixerNode, format: silentFormat)
      engine.mainMixerNode.outputVolume = 0
      engine.prepare()
      try engine.start()
      player.scheduleBuffer(silence, at: nil, options: .loops)
      player.play()
    } else {
      engine.prepare()
      try engine.start()
    }
    self.engine = engine
    self.player = player
  }

  private func teardownSession() {
    finishUtterance(with: nil)
    player?.stop()
    engine?.inputNode.removeTap(onBus: 0)
    engine?.stop()
    player = nil
    engine = nil
    active = false
    setFlag(false)
  }

  // MARK: - Utterances (attach/detach recognition to the running stream)

  private func handleToggle() {
    // Also let JS know (Live Activity text etc.) — but recognition runs HERE.
    sendEvent("recordToggle", [:])
    if utteranceActive { stopUtterance() } else { startUtterance() }
  }

  private func startUtterance() {
    guard active, engine?.isRunning == true else {
      setStatus("error: session not running — tap the mic again to restart")
      teardownSession()
      return
    }
    let lang = group?.string(forKey: "kbd_language") ?? "en-US"
    recognizer = SFSpeechRecognizer(locale: Locale(identifier: lang)) ?? SFSpeechRecognizer()
    guard let recognizer, recognizer.isAvailable else {
      setStatus("error: speech recognizer unavailable")
      return
    }
    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    if #available(iOS 16, *) { request.addsPunctuation = true }
    // Bias recognition toward the user's vocabulary (name, job title, custom terms)
    // shared from the app via the App Group — the same list that feeds the keyboard's
    // dictionary. Brings the in-app mic's contextualStrings priming to the keyboard's
    // native Flow-Session path so names/jargon aren't misheard while dictating anywhere.
    if let json = group?.string(forKey: "kbd_learned_words"),
       let data = json.data(using: .utf8),
       let words = try? JSONDecoder().decode([String].self, from: data) {
      let bias = Array(words.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }.prefix(100))
      if !bias.isEmpty { request.contextualStrings = bias }
    }
    lastTranscript = ""
    self.request = request
    utteranceActive = true
    setStatus("listening")

    task = recognizer.recognitionTask(with: request) { [weak self] result, error in
      guard let self else { return }
      if let result {
        self.lastTranscript = result.bestTranscription.formattedString
        self.group?.set(self.lastTranscript, forKey: "flow_partial")
        if result.isFinal, self.utteranceActive {
          self.finishUtterance(with: self.lastTranscript)
        }
      }
      if error != nil, self.utteranceActive {
        // Recognizer bailed (timeout/no-speech/cancel): salvage what we have.
        self.finishUtterance(with: self.lastTranscript.isEmpty ? nil : self.lastTranscript)
      }
    }
  }

  private func stopUtterance() {
    guard utteranceActive else { return }
    setStatus("processing")
    request?.endAudio()
    // Safety net: if no isFinal arrives promptly, ship the best transcript we have.
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
      guard let self, self.utteranceActive else { return }
      self.finishUtterance(with: self.lastTranscript.isEmpty ? nil : self.lastTranscript)
    }
  }

  private func finishUtterance(with text: String?) {
    guard utteranceActive else { return }
    utteranceActive = false
    task?.cancel()
    task = nil
    request = nil

    guard let text, !text.isEmpty else {
      setStatus("error: Didn’t catch that — tap 🎤 and try again")
      return
    }

    // Always defer delivery to JS: it runs the local text pipeline (the Android
    // TextCuration port — spoken punctuation, fillers, caps… free and instant) and
    // optionally the AI structuring pass, then writes + pings the keyboard.
    // Fallback: if JS hasn't delivered in 8s, insert the raw text so nothing is lost.
    setStatus("processing")
    sendEvent("utteranceFinal", ["text": text])
    let raw = text
    DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
      guard let self else { return }
      if self.group?.string(forKey: "kbd_flow_status") == "processing" {
        self.group?.set(raw, forKey: "latest_dictation")
        self.group?.set(String(Date().timeIntervalSince1970 * 1000), forKey: "latest_dictation_ts")
        self.setStatus("inserted")
        Self.post(Self.resultName)
      }
    }
  }

  // MARK: - Plumbing

  private func setFlag(_ on: Bool) {
    group?.set(on ? "true" : "false", forKey: "flow_session_active")
  }

  private func setStatus(_ status: String) {
    group?.set(status, forKey: "kbd_flow_status")
    Self.post(Self.statusName)
    sendEvent("flowStatus", ["status": status])
  }

  private static func post(_ name: String) {
    CFNotificationCenterPostNotification(
      CFNotificationCenterGetDarwinNotifyCenter(),
      CFNotificationName(name as CFString),
      nil, nil, true
    )
  }

  private func registerDarwinObserver() {
    let center = CFNotificationCenterGetDarwinNotifyCenter()
    let observer = Unmanaged.passUnretained(self).toOpaque()
    CFNotificationCenterAddObserver(center, observer, { _, observer, _, _, _ in
      guard let observer = observer else { return }
      let module = Unmanaged<VibeflowFlowSessionModule>.fromOpaque(observer).takeUnretainedValue()
      DispatchQueue.main.async {
        module.handleToggle()
      }
    }, Self.toggleName as CFString, nil, .deliverImmediately)
  }
}
