import AVFoundation
import Accelerate
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
/// Long utterances (v3): Apple's recognizer enforces a ~60s cap per REQUEST — past
/// it the task errors out, and the old design then nulled `request`, silently
/// dropping every later audio buffer (a 2–3 min dictation lost its tail and hung as
/// "processing"). An utterance is now a CHAIN of segments: we rotate to a fresh
/// request at a natural speech pause (and always before the cap), immediately chain
/// a new segment if one dies early, and stitch the segment texts together on stop.
///
/// Threading (v3.1, review-hardened): recognition callbacks arrive on private
/// queues, the tap runs on the audio render thread, and Expo functions run off-main
/// — so ALL utterance state (segmentTexts/tasks/endedSegments/gen) is mutated on
/// main only; recognizers are retained per segment (a task does NOT retain its
/// recognizer); retiring requests are kept alive briefly so the tap can never
/// append into a freed object; and `utteranceGen` fences every stale callback,
/// including the 8s raw-delivery fallback.
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
  static let partialName = "com.vibeflow.flow.partial"
  // SFSpeech partials fire many times/sec; throttle the cross-process ping so the
  // keyboard's live tail-line updates smoothly without a wakeup per partial.
  private var lastPartialPostTs: TimeInterval = 0

  private var engine: AVAudioEngine?
  private var player: AVAudioPlayerNode?
  private var active = false

  // Per-utterance recognition riding the always-on input tap, as a chain of
  // segments (see header). All of this state is owned by the MAIN thread.
  private var utteranceActive = false
  private var stopping = false
  private var utteranceGen = 0
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var tasks: [Int: SFSpeechRecognitionTask] = [:]
  /// A recognition task does NOT retain its recognizer — if the recognizer
  /// deallocates, the task dies (kAFAssistantErrorDomain "canceled"). Retain one
  /// per segment until that segment ends.
  private var recognizers: [Int: SFSpeechRecognizer] = [:]
  private var segmentTexts: [Int: String] = [:]
  private var endedSegments: Set<Int> = []
  private var utteranceSeqs: Set<Int> = []
  private var segmentSeq = 0
  private var currentSeq = 0
  private var segmentStartedAt = Date()
  private var fastFails = 0
  private var rotateTimer: Timer?
  /// A stop-tap is in flight and the user already tapped again: start the next
  /// utterance as soon as this one finishes (instead of swallowing the tap).
  private var pendingStart = false
  /// Liveness beacon: while the session is up, `flow_heartbeat_ts` is refreshed
  /// every 2s so the KEYBOARD can tell a live session from stale App Group flags
  /// left behind by a force-quit/jetsam kill (which previously made the mic
  /// pretend to record into a dead process).
  private var heartbeatTimer: Timer?
  /// Requests being retired: the audio tap may be mid-`append` with a raw pointer,
  /// so the last strong reference must never be dropped at the exact swap moment.
  /// Held ~1s past retirement, then released.
  private var retiredRequests: [SFSpeechAudioBufferRecognitionRequest] = []
  /// Voice-activity probe (written by the render thread, read by the rotation
  /// timer). A single aligned Double: a torn read is not possible on arm64 and a
  /// slightly stale value only shifts rotation by one 0.5s tick — acceptable.
  private var lastVoiceAt: CFAbsoluteTime = CFAbsoluteTimeGetCurrent()

  // Whether the founder's experimental "continuous" mode is on (Settings → Recognition).
  private var continuousOn: Bool { group?.string(forKey: "flow_continuous") == "true" }

  // Segment-rotation cadence.
  // • NON-continuous: 45s chunk = ONE segment (threshold 60s > the 45s cap, so rotation
  //   never arms → no seam; "don't break it into two parts").
  // • CONTINUOUS: the utterance NEVER ends at a fixed cap. Segments rotate ~every 30–50s
  //   at a natural pause (zero audio gap — see rotateSegment), and each rotated-out
  //   segment is delivered as a chunk. So words stream into the field seamlessly with no
  //   dropped audio and the mic never leaves "listening".
  // CONTINUOUS cadence tuned to match the single-recording timing that tested CLEAN on
  // device (1.0.69): rotate ~every 45–58s at a natural pause, NOT every 30–50s. Fewer,
  // later handoffs = fewer boundaries to drop a word AND fewer of the heavy per-chunk
  // deliveries (curation + insert + history sync) the founder flagged as the CPU suspect.
  private var minSegmentSeconds: TimeInterval { continuousOn ? 45 : 60 }
  private var hardCapSeconds: TimeInterval { continuousOn ? 58 : 60 }
  private let quietGapSeconds: TimeInterval = 0.6
  // Total session cap (NON-continuous only): auto-stop the mic after ~45s; the keyboard
  // draws a matching countdown line off `flow_session_deadline_ts`. (The 120s diagnostic
  // in 1.0.69 confirmed a single recording survives past 60s; reverted to 45 for prod.)
  private let sessionMaxSeconds: TimeInterval = 45
  private var capTimer: Timer?

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
    // The session-long tap: buffers flow into whichever segment request is live.
    // Also probes voice activity (peak magnitude) so rotation can pick a pause.
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
      guard let self else { return }
      self.request?.append(buffer)
      if let data = buffer.floatChannelData?.pointee {
        var peak: Float = 0
        vDSP_maxmgv(data, 1, &peak, vDSP_Length(buffer.frameLength))
        if peak > 0.02 { self.lastVoiceAt = CFAbsoluteTimeGetCurrent() }
      }
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
    startHeartbeat()
  }

  /// Liveness beacon (see `heartbeatTimer`): refreshed every 2s while the session
  /// runs, so the keyboard can distinguish a live session from stale flags after a
  /// force-quit. Timer lives on the main run loop regardless of the calling thread.
  private func startHeartbeat() {
    DispatchQueue.main.async {
      self.heartbeatTimer?.invalidate()
      self.beat()
      self.heartbeatTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
        self?.beat()
      }
    }
  }

  private func beat() {
    group?.set(String(Date().timeIntervalSince1970 * 1000), forKey: "flow_heartbeat_ts")
  }

  private func stopHeartbeat() {
    DispatchQueue.main.async {
      self.heartbeatTimer?.invalidate()
      self.heartbeatTimer = nil
    }
  }

  private func teardownSession() {
    // Utterance state is main-owned; Expo may call stop()/OnDestroy off-main.
    // Deliver whatever was already recognised instead of discarding it — a session
    // ended mid-dictation (Live Activity "End", JS reload) must not eat minutes of
    // speech. Self is captured STRONGLY so the rescue still runs if the module is
    // being deallocated (OnDestroy during a JS reload).
    let deliver = {
      let joined = self.joinedTranscript()
      self.finishUtterance(with: joined.isEmpty ? nil : joined)
    }
    if Thread.isMainThread { deliver() } else { DispatchQueue.main.async(execute: deliver) }
    stopHeartbeat()
    player?.stop()
    engine?.inputNode.removeTap(onBus: 0)
    engine?.stop()
    player = nil
    engine = nil
    active = false
    setFlag(false)
  }

  // MARK: - Utterances (a chain of recognition segments on the running stream)

  private func handleToggle() {
    // Also let JS know (Live Activity text etc.) — but recognition runs HERE.
    sendEvent("recordToggle", [:])
    if utteranceActive {
      if stopping {
        // Second tap while the previous stop is finalising: queue the next
        // utterance instead of re-stopping (used to silently need a third tap).
        pendingStart = true
      } else {
        stopUtterance()
      }
    } else {
      startUtterance()
    }
  }

  private func startUtterance() {
    // Continuous roll-over can find the engine momentarily stopped after an iOS audio
    // hiccup between chunks; try to revive it once before giving up so a transient stall
    // doesn't drop the chain to idle. No-op when already running; scoped to continuous
    // mode so the proven single-dictation path is untouched.
    if active, engine?.isRunning != true, group?.string(forKey: "flow_continuous") == "true" {
      try? startEngine()
    }
    guard active, engine?.isRunning == true else {
      setStatus("error: session not running — tap the mic again to restart")
      teardownSession()
      return
    }
    guard makeRecognizer()?.isAvailable == true else {
      setStatus("error: speech recognizer unavailable")
      return
    }
    utteranceGen += 1
    utteranceActive = true
    stopping = false
    segmentTexts = [:]
    endedSegments = []
    utteranceSeqs = []
    fastFails = 0
    group?.set("", forKey: "flow_partial") // fresh tail-line per utterance/chunk
    startSegment()
    capTimer?.invalidate()
    capTimer = nil
    if continuousOn {
      // No fixed cap — the utterance runs continuously; segment rotation delivers each
      // chunk at a natural pause (zero audio gap). No deadline → the keyboard hides the
      // countdown line entirely for a Wispr-style limitless feel.
      group?.set("", forKey: "flow_session_deadline_ts")
    } else {
      // ~45s cap (proven single-chunk path): publish the deadline for the keyboard's
      // countdown line + auto-stop the mic.
      let deadlineMs = (Date().timeIntervalSince1970 + sessionMaxSeconds) * 1000
      group?.set(String(deadlineMs), forKey: "flow_session_deadline_ts")
      capTimer = Timer.scheduledTimer(withTimeInterval: sessionMaxSeconds, repeats: false) { [weak self] _ in
        guard let self, self.utteranceActive, !self.stopping else { return }
        self.stopUtterance()
      }
    }
    setStatus("listening")
  }

  private func makeRecognizer() -> SFSpeechRecognizer? {
    let lang = group?.string(forKey: "kbd_language") ?? "en-US"
    return SFSpeechRecognizer(locale: Locale(identifier: lang)) ?? SFSpeechRecognizer()
  }

  /// Begin ONE recognition segment on the always-running tap. Long utterances chain
  /// several; `currentSeq` marks the live one and `gen` fences stale callbacks.
  private func startSegment() {
    guard utteranceActive else { return }
    guard let recognizer = makeRecognizer(), recognizer.isAvailable else {
      let joined = joinedTranscript()
      finishUtterance(with: joined.isEmpty ? nil : joined)
      return
    }
    segmentSeq += 1
    let seq = segmentSeq
    let gen = utteranceGen
    currentSeq = seq
    utteranceSeqs.insert(seq)
    segmentStartedAt = Date()
    lastVoiceAt = CFAbsoluteTimeGetCurrent()
    recognizers[seq] = recognizer // must outlive its task (tasks don't retain it)

    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    if #available(iOS 16, *) { request.addsPunctuation = true }
    // Honor the app's privacy setting (Settings → On-device only) whenever the
    // locale's on-device model exists. Rotation makes on-device viable for long
    // dictation, so the "voice never leaves the phone" promise holds here too.
    if group?.string(forKey: "flow_on_device") != "false",
       recognizer.supportsOnDeviceRecognition {
      request.requiresOnDeviceRecognition = true
    }
    // Bias recognition toward the user's vocabulary (name, job title, custom terms)
    // shared from the app via the App Group — same list that feeds the keyboard's
    // dictionary, so names/jargon aren't misheard while dictating anywhere.
    if let json = group?.string(forKey: "kbd_learned_words"),
       let data = json.data(using: .utf8),
       let words = try? JSONDecoder().decode([String].self, from: data) {
      let bias = Array(words.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }.prefix(100))
      if !bias.isEmpty { request.contextualStrings = bias }
    }
    retireCurrentRequest() // EVERY swap path must retire (self-heal chains included)
    self.request = request // the tap feeds THIS request from the next buffer on

    tasks[seq] = recognizer.recognitionTask(with: request) { [weak self] result, error in
      // Arrives on a private queue. Snapshot, then do ALL state work on main —
      // segmentTexts/tasks are main-owned (Swift Dictionary is not thread-safe,
      // and two segments' tasks run concurrently during every rotation).
      let text = result?.bestTranscription.formattedString
      let isFinal = result?.isFinal ?? false
      let failed = error != nil
      DispatchQueue.main.async { [weak self] in
        guard let self, self.utteranceGen == gen else { return } // stale utterance
        // Store NON-EMPTY text only. On-device SFSpeech emits an EMPTY final once a
        // segment's buffer is closed (rotation/stop); `if let text` alone let that ""
        // clobber a good partial, so the earlier segment's words vanished and only the
        // last segment survived ("the middle went missing"). Empty carries no info.
        if let text, !text.trimmingCharacters(in: .whitespaces).isEmpty {
          self.segmentTexts[seq] = text
          self.group?.set(self.joinedTranscript(), forKey: "flow_partial")
          // Live signal to the keyboard's tail-line (throttled — see lastPartialPostTs).
          let now = ProcessInfo.processInfo.systemUptime
          if now - self.lastPartialPostTs >= 0.1 {
            self.lastPartialPostTs = now
            Self.post(Self.partialName)
          }
        }
        if isFinal || failed {
          self.segmentEnded(seq, gen: gen)
        }
      }
    }

    scheduleRotation(for: seq, gen: gen)
  }

  /// From MIN_SEGMENT onward, watch for a ≥quietGap pause and rotate there; rotate
  /// unconditionally at the hard cap so no request ever reaches the ~60s limit.
  private func scheduleRotation(for seq: Int, gen: Int) {
    rotateTimer?.invalidate()
    rotateTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] timer in
      guard let self, self.utteranceActive, !self.stopping,
            self.utteranceGen == gen, self.currentSeq == seq else {
        timer.invalidate()
        return
      }
      let age = Date().timeIntervalSince(self.segmentStartedAt)
      guard age >= self.minSegmentSeconds else { return }
      let quiet = CFAbsoluteTimeGetCurrent() - self.lastVoiceAt >= self.quietGapSeconds
      if quiet || age >= self.hardCapSeconds {
        timer.invalidate()
        self.rotateSegment()
      }
    }
  }

  /// Swap in a fresh request (the tap starts feeding it immediately — zero dropped
  /// audio), then end the old one so its task finalises; its polished final text
  /// lands in `segmentTexts` via the seq captured in its handler. The old request
  /// stays retained by its still-running task, so the swap can't deallocate it
  /// under the tap.
  private func rotateSegment() {
    guard utteranceActive, !stopping else { return }
    let oldRequest = request
    startSegment()
    oldRequest?.endAudio()
  }

  /// A segment's task concluded (isFinal and/or error — possibly both, hence the
  /// endedSegments guard). While stopping, we wait (bounded by the stop watchdog)
  /// for EVERY segment to finalise so the stitched text includes each segment's
  /// corrected final rather than a stale partial. Mid-utterance, a dead live
  /// segment self-heals by chaining a new one so later speech keeps being
  /// recognised.
  private func segmentEnded(_ seq: Int, gen: Int) {
    guard utteranceActive, utteranceGen == gen, !endedSegments.contains(seq) else { return }
    endedSegments.insert(seq)
    tasks[seq] = nil
    recognizers[seq] = nil
    if stopping {
      if endedSegments.isSuperset(of: utteranceSeqs) {
        let joined = joinedTranscript()
        finishUtterance(with: joined.isEmpty ? nil : joined)
      }
      return
    }
    guard seq == currentSeq else {
      // An older (rotated-out) segment just finalised. In CONTINUOUS mode this is a
      // chunk boundary: deliver its finished words to the field NOW and prune it, so
      // the running transcript (tail-line) only shows the not-yet-inserted words. The
      // utterance keeps going on the new segment — audio never gaps, mic stays listening.
      if continuousOn, let chunk = segmentTexts[seq],
         !chunk.trimmingCharacters(in: .whitespaces).isEmpty {
        deliverChunk(chunk)
        segmentTexts[seq] = nil
        group?.set(joinedTranscript(), forKey: "flow_partial")
      }
      return // an older segment finalising — done
    }
    // Guard against a wedged recognizer (e.g. model missing): three consecutive
    // instant, textless deaths → deliver what we have instead of looping forever.
    let lived = Date().timeIntervalSince(segmentStartedAt)
    let gotText = !(segmentTexts[seq] ?? "").isEmpty
    if lived < 1.5 && !gotText {
      fastFails += 1
      if fastFails >= 3 {
        let joined = joinedTranscript()
        finishUtterance(with: joined.isEmpty ? nil : joined)
        return
      }
    } else {
      fastFails = 0
    }
    startSegment()
  }

  private func stopUtterance() {
    guard utteranceActive else { return }
    stopping = true
    rotateTimer?.invalidate()
    capTimer?.invalidate()
    capTimer = nil
    group?.set("", forKey: "flow_session_deadline_ts")
    setStatus("processing")
    request?.endAudio()
    // Safety net: if the segments don't all finalise promptly, ship what we already
    // have — the utterance must NEVER hang in "processing".
    let gen = utteranceGen
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
      guard let self, self.utteranceActive, self.utteranceGen == gen else { return }
      let joined = self.joinedTranscript()
      self.finishUtterance(with: joined.isEmpty ? nil : joined)
    }
  }

  /// Retire the current request WITHOUT dropping its last strong reference — the
  /// audio tap may be mid-`append` with a raw pointer to it. Held ~1s, then freed.
  /// Called on main only.
  private func retireCurrentRequest() {
    guard let retiring = request else { return }
    retiredRequests.append(retiring)
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
      self?.retiredRequests.removeAll { $0 === retiring }
    }
  }

  /// The stitched text of every segment so far, in dictation order.
  private func joinedTranscript() -> String {
    segmentTexts
      .sorted { $0.key < $1.key }
      .map { $0.value.trimmingCharacters(in: .whitespaces) }
      .filter { !$0.isEmpty }
      .joined(separator: " ")
  }

  /// Deliver ONE finished segment mid-stream (continuous mode) WITHOUT ending the
  /// utterance. Hands the text to JS exactly like a final (same `utteranceFinal` event →
  /// curation → keyboard insert), but crucially does NOT `setStatus("processing")`, so the
  /// mic stays "listening" (red) — no green success flash between chunks. Mirrors
  /// finishUtterance's 8s native fallback so a chunk is never lost if JS is asleep.
  private func deliverChunk(_ text: String) {
    let chunkId = String(Int(Date().timeIntervalSince1970 * 1000))
    group?.set(chunkId, forKey: "flow_utterance_id")
    sendEvent("utteranceFinal", ["text": text, "id": chunkId])
    let raw = text
    DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
      guard let self else { return }
      // A claim for this chunk OR any later one proves JS received (and delivered) it.
      let claim = Int(self.group?.string(forKey: "flow_claim_id") ?? "") ?? 0
      if claim >= (Int(chunkId) ?? Int.max) { return }
      // JS never claimed → deliver raw so the chunk is not lost.
      self.group?.set(raw, forKey: "latest_dictation")
      self.group?.set(String(Date().timeIntervalSince1970 * 1000), forKey: "latest_dictation_ts")
      self.group?.set(chunkId, forKey: "flow_fallback_done")
      Self.post(Self.resultName)
    }
  }

  private func finishUtterance(with text: String?) {
    guard utteranceActive else { return }
    utteranceActive = false
    stopping = false
    // Fence off EVERY callback captured with the old gen (stragglers would
    // otherwise repopulate the cleared state / rewrite flow_partial).
    utteranceGen += 1
    rotateTimer?.invalidate()
    rotateTimer = nil
    for (_, task) in tasks { task.cancel() }
    tasks = [:]
    recognizers = [:]
    retireCurrentRequest()
    request = nil
    segmentTexts = [:]
    endedSegments = []
    utteranceSeqs = []

    defer {
      // A stop→start double-tap queued the next utterance — begin it now instead
      // of swallowing the tap (which used to need a third tap).
      if pendingStart {
        pendingStart = false
        if active, engine?.isRunning == true { startUtterance() }
      }
    }

    guard let text, !text.isEmpty else {
      setStatus("error: Didn’t catch that — tap 🎤 and try again")
      return
    }

    // Always defer delivery to JS: it runs the local text pipeline (the Android
    // TextCuration port — spoken punctuation, fillers, caps… free and instant) and
    // optionally the AI structuring pass, then writes + pings the keyboard.
    // Fallback: if JS hasn't claimed the utterance in 8s, deliver the raw text so
    // nothing is EVER lost — even if the JS runtime died (reload/crash) or a newer
    // utterance already started. Fences: the claim id (JS alive → it owns
    // delivery) gates everything; utteranceGen additionally gates the SHARED
    // status string, which belongs to the newest utterance. Self is captured
    // STRONGLY so the rescue survives module teardown (JS reload mid-dictation).
    setStatus("processing")
    let utteranceId = String(Int(Date().timeIntervalSince1970 * 1000))
    group?.set(utteranceId, forKey: "flow_utterance_id")
    sendEvent("utteranceFinal", ["text": text, "id": utteranceId])
    let raw = text
    let gen = utteranceGen
    DispatchQueue.main.asyncAfter(deadline: .now() + 8) {
      // Claim ids are ms-epoch and JS receives events in order, so a claim for
      // this utterance OR ANY LATER one proves JS received (and owns) this one.
      // (Equality alone broke back-to-back dictations: B's claim overwrote the
      // shared slot and A's fallback then re-inserted A raw.)
      let claim = Int(self.group?.string(forKey: "flow_claim_id") ?? "") ?? 0
      if claim >= (Int(utteranceId) ?? Int.max) { return } // JS alive
      // JS never claimed → deliver raw so the dictation is not lost. Mark the
      // utterance as fallback-delivered so a late JS pass won't double-insert.
      self.group?.set(raw, forKey: "latest_dictation")
      self.group?.set(String(Date().timeIntervalSince1970 * 1000), forKey: "latest_dictation_ts")
      self.group?.set(utteranceId, forKey: "flow_fallback_done")
      if self.utteranceGen == gen,
         self.group?.string(forKey: "kbd_flow_status") == "processing" {
        self.setStatus("inserted") // status is still ours — close the loop
      }
      Self.post(Self.resultName)
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
