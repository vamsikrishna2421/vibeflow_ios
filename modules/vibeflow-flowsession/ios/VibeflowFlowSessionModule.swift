import AVFoundation
import Accelerate
import ExpoModulesCore
import Network
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

  private var engine: AVAudioEngine?
  private var player: AVAudioPlayerNode?
  private var active = false
  /// Connectivity, for the server→on-device fallback. Written on the monitor's queue,
  /// read on main when a segment starts — a stale bool only mis-picks one segment's mode.
  private let pathMonitor = NWPathMonitor()
  private var isOnline = true

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
  /// The ~52s proactive cap. iOS suspends a BACKGROUNDED audio session at ~60s — a hard
  /// platform limit no AVAudioSession config avoids (proven: builds 1.0.24–1.0.27 all
  /// died at ~60s regardless of category/graph; iOS only grants an uncapped RECORDING
  /// assertion to a session started while genuinely foreground, which our momentary
  /// bootstrap hop can't be). So instead of losing the tail when iOS pulls the plug
  /// mid-utterance, we FINALIZE at ~52s while we still have CPU — every spoken word is
  /// delivered — then tear the session down so the keyboard's next mic tap re-hops for a
  /// fresh window. Net: reliable dictate-in-place up to ~52s per stretch, one tap to
  /// continue, nothing ever lost.
  private var sessionDeadlineTimer: Timer?
  private let sessionMaxSeconds: TimeInterval = 52
  /// Requests being retired: the audio tap may be mid-`append` with a raw pointer,
  /// so the last strong reference must never be dropped at the exact swap moment.
  /// Held ~1s past retirement, then released.
  private var retiredRequests: [SFSpeechAudioBufferRecognitionRequest] = []
  /// Voice-activity probe (written by the render thread, read by the rotation
  /// timer). A single aligned Double: a torn read is not possible on arm64 and a
  /// slightly stale value only shifts rotation by one 0.5s tick — acceptable.
  private var lastVoiceAt: CFAbsoluteTime = CFAbsoluteTimeGetCurrent()

  // Rotation tuning. The whole dictation is capped at ~52s (sessionMaxSeconds), which is
  // UNDER Apple's ~60s per-request limit — so we want ONE continuous recognition request
  // per window, never a mid-utterance rotation. Chopping into short segments restarts the
  // recognizer and loses language-model context across the seam (visible as mis-recognized
  // words at boundaries), so these are set above the 52s cap: the proactive cap ends the
  // utterance before rotation can ever trigger. The 58s hard cap is only a safety valve if
  // the proactive stop is somehow delayed, and still stays under the ~60s recognizer limit.
  // The live panel still updates continuously (interim results), and the local text pipeline
  // runs one-shot on the full transcript at stop — cleaner punctuation than per-chunk.
  private let minSegmentSeconds: TimeInterval = 55
  private let hardCapSeconds: TimeInterval = 58
  private let quietGapSeconds: TimeInterval = 0.6

  /// Full running transcript for the keyboard's live recording panel: already-streamed
  /// segments (`liveDelivered`) + the current un-streamed tail (`joinedTranscript`).
  /// `flow_partial` only holds the tail (it resets each rotation), so the panel reads
  /// this instead to show the whole dictation growing. Published throttled via CFPreferences.
  private var liveDelivered = ""
  private var lastLivePublish: CFAbsoluteTime = 0

  private var group: UserDefaults? { UserDefaults(suiteName: appGroup) }

  /// Publish to the App Group via CFPreferences — the cross-process-reliable path the
  /// keyboard reads with CFPreferencesCopyAppValue (plain UserDefaults writes from this
  /// process aren't always visible to that read, so live text/countdown need this).
  private func publishCF(_ value: String, forKey key: String) {
    CFPreferencesSetAppValue(key as CFString, value as CFString, appGroup as CFString)
    CFPreferencesAppSynchronize(appGroup as CFString)
  }

  public func definition() -> ModuleDefinition {
    Name("VibeflowFlowSession")
    Events("recordToggle", "utteranceFinal", "flowStatus")

    OnCreate {
      self.registerDarwinObserver()
      self.pathMonitor.pathUpdateHandler = { [weak self] path in
        self?.isOnline = (path.status == .satisfied)
      }
      self.pathMonitor.start(queue: DispatchQueue(label: "com.vibeflow.flow.net"))
    }

    OnDestroy {
      self.teardownSession()
      self.pathMonitor.cancel()
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
    startSessionDeadline()
  }

  /// Arm the ~52s proactive cap (see `sessionMaxSeconds`). Also publishes the deadline
  /// to the App Group so the keyboard can surface a countdown. Runs on main.
  private func startSessionDeadline() {
    DispatchQueue.main.async {
      self.sessionDeadlineTimer?.invalidate()
      let deadlineMs = (Date().timeIntervalSince1970 + self.sessionMaxSeconds) * 1000
      self.group?.set(String(deadlineMs), forKey: "flow_session_deadline_ts")
      self.publishCF(String(deadlineMs), forKey: "flow_session_deadline_ts")
      self.publishCF("", forKey: "flow_live_full")  // clear last session's transcript
      self.sessionDeadlineTimer = Timer.scheduledTimer(withTimeInterval: self.sessionMaxSeconds,
                                                       repeats: false) { [weak self] _ in
        self?.proactiveCap()
      }
    }
  }

  /// The ~52s window is up. Finalize NOW so every recognized word is delivered before
  /// iOS suspends us at ~60s, then release the session cleanly (a few seconds later, to
  /// let the stop finalize + deliver) so `flow_session_active` flips false and the
  /// keyboard re-hops for a fresh window on the next mic tap.
  private func proactiveCap() {
    flog("~52s proactive cap — finalizing before iOS ~60s suspension")
    if utteranceActive && !stopping { stopUtterance() }
    DispatchQueue.main.asyncAfter(deadline: .now() + 3.5) { [weak self] in
      guard let self, self.active else { return }
      self.teardownSession()
    }
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
    DispatchQueue.main.async {
      self.sessionDeadlineTimer?.invalidate()
      self.sessionDeadlineTimer = nil
      self.group?.removeObject(forKey: "flow_session_deadline_ts")
      self.publishCF("", forKey: "flow_session_deadline_ts")
    }
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
    liveDelivered = ""
    segmentTexts = [:]
    endedSegments = []
    utteranceSeqs = []
    fastFails = 0
    startSegment()
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
    // Server (online) recognition is the DEFAULT — Apple's larger, more accurate model
    // (the same backend Apple's own keyboard mic uses). Fall back to the on-device model
    // ONLY when the user chose "On-device only" in Settings (flow_on_device == "true"),
    // or when there's no network to reach Apple's servers.
    let onDeviceRequested = group?.string(forKey: "flow_on_device") == "true"
    if (onDeviceRequested || !isOnline), recognizer.supportsOnDeviceRecognition {
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
        if let text {
          self.segmentTexts[seq] = text
          self.group?.set(self.joinedTranscript(), forKey: "flow_partial")
          // Full live transcript for the keyboard panel (throttled to ~8Hz).
          let now = CFAbsoluteTimeGetCurrent()
          if now - self.lastLivePublish > 0.12 {
            self.lastLivePublish = now
            let full = (self.liveDelivered + " " + self.joinedTranscript())
              .trimmingCharacters(in: .whitespaces)
            self.publishCF(full, forKey: "flow_live_full")
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
    // Stream this segment's final text to the keyboard NOW (mid-utterance) so long
    // dictations insert continuously and can never be stranded if iOS suspends the
    // background app after "stop". Cleared so the final stop-join won't re-send it.
    if !stopping, let segText = segmentTexts[seq], !segText.isEmpty {
      segmentTexts[seq] = nil
      if !liveDelivered.isEmpty { liveDelivered += " " }
      liveDelivered += segText  // keep the full transcript growing for the live panel
      flog("stream segment \(seq) len=\(segText.count)")
      deliverUtterance(segText, live: true)
    }
    if stopping {
      if endedSegments.isSuperset(of: utteranceSeqs) {
        let joined = joinedTranscript()
        finishUtterance(with: joined.isEmpty ? nil : joined)
      }
      return
    }
    guard seq == currentSeq else { return } // an older segment finalising — done
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
    setStatus("processing")
    request?.endAudio()
    flog("stopUtterance — segments=\(utteranceSeqs.count) ended=\(endedSegments.count); 2.5s watchdog armed")
    // Safety net: if the segments don't all finalise promptly, ship what we already
    // have — the utterance must NEVER hang in "processing".
    let gen = utteranceGen
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
      guard let self, self.utteranceActive, self.utteranceGen == gen else { return }
      self.flog("stop watchdog fired — force-finishing")
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
    // Deliver the final chunk — everything not already streamed mid-utterance.
    deliverUtterance(text, live: false)
  }

  /// Hand ONE chunk of recognised text to JS (which runs the local pipeline and pings
  /// the keyboard). `live:true` = a segment streamed WHILE still recording (status stays
  /// "listening"); `live:false` = the final chunk on stop (status → processing). If JS
  /// hasn't claimed the chunk within 8s, deliver the raw text so nothing is EVER lost.
  /// Streaming (live) chunks are how long dictations survive: they insert continuously
  /// as they're recognised, so iOS suspending the app after "stop" can't strand them.
  private func deliverUtterance(_ text: String, live: Bool) {
    if !live { setStatus("processing") }
    let utteranceId = String(Int(Date().timeIntervalSince1970 * 1000))
    group?.set(utteranceId, forKey: "flow_utterance_id")
    sendEvent("utteranceFinal", ["text": text, "id": utteranceId])
    flog("deliver chunk live=\(live) id=\(utteranceId) len=\(text.count)")
    let raw = text
    let gen = utteranceGen
    DispatchQueue.main.asyncAfter(deadline: .now() + 8) {
      // A claim for this chunk OR any later one proves JS received (and owns) it.
      let claim = Int(self.group?.string(forKey: "flow_claim_id") ?? "") ?? 0
      if claim >= (Int(utteranceId) ?? Int.max) { return } // JS alive
      // JS never claimed → deliver raw so the dictation is not lost.
      self.group?.set(raw, forKey: "latest_dictation")
      self.group?.set(String(Date().timeIntervalSince1970 * 1000), forKey: "latest_dictation_ts")
      self.group?.set(utteranceId, forKey: "flow_fallback_done")
      if !live, self.utteranceGen == gen,
         self.group?.string(forKey: "kbd_flow_status") == "processing" {
        self.setStatus("inserted") // status is still ours — close the loop
      }
      Self.post(Self.resultName)
      self.flog("fallback delivered raw id=\(utteranceId)")
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
    flog("status → \(status)")
  }

  /// Lightweight diagnostic log — filter Console.app on "VibeFlow.flow" to trace the
  /// flow-session lifecycle on-device (there's no local iOS simulator for this flow).
  private func flog(_ msg: String) { NSLog("[VibeFlow.flow] %@", msg) }

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
