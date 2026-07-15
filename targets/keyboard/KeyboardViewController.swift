import UIKit
import Speech
import AVFoundation

/// A key that gives instant press feedback by swapping its background on highlight
/// (UIButton toggles `isHighlighted` during touch), so typing feels responsive
/// without rebuilding anything.
final class KeyButton: UIButton {
    var baseColor: UIColor = .clear { didSet { backgroundColor = baseColor } }
    var pressedColor: UIColor = .clear
    override var isHighlighted: Bool {
        didSet { backgroundColor = isHighlighted ? pressedColor : baseColor }
    }
}

/// Container that forgives imprecise taps: a touch landing in the gutter between
/// keys is routed to the NEAREST key instead of being dropped — the same behaviour
/// that makes Apple/Google keyboards feel effortless.
final class GapForgivingStack: UIStackView {
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let hit = super.hitTest(point, with: event)
        if hit is KeyButton { return hit }
        if let nearest = nearestKey(to: point) { return nearest }
        return hit
    }

    private func nearestKey(to point: CGPoint) -> KeyButton? {
        var best: (key: KeyButton, dist: CGFloat)?
        func walk(_ view: UIView) {
            for sub in view.subviews {
                if let key = sub as? KeyButton, !key.isHidden, key.alpha > 0.01, key.window != nil {
                    let frame = key.convert(key.bounds, to: self)
                    let dx = max(frame.minX - point.x, 0, point.x - frame.maxX)
                    let dy = max(frame.minY - point.y, 0, point.y - frame.maxY)
                    let d = dx * dx + dy * dy
                    if best == nil || d < best!.dist { best = (key, d) }
                } else {
                    walk(sub)
                }
            }
        }
        walk(self)
        // Only claim touches within ~12pt of a key's edge (covers all gutters,
        // never steals wildly distant touches).
        guard let best, best.dist <= 144 else { return nil }
        return best.key
    }
}

/// Full-screen recording panel shown over the keys while dictating. A live waveform fills
/// the strip, a red STOP button sits where the mic is (tap it to end), and the whole key
/// area becomes the transcript streaming in. The free tier caps each stretch at ~45s
/// (`windowSeconds`), shown as a countdown ring; unlimited dictation is the separate paid
/// cloud tier. The host app publishes `flow_live_full` (the growing transcript) to the App
/// Group; the keyboard feeds it in via `render(transcript:)`. The waveform self-animates on
/// a display link.
final class RecordingPanelView: UIView {
    var onStop: (() -> Void)?
    /// Total dictation window in seconds (matches the host's `sessionMaxSeconds`), for the ring.
    private let windowSeconds: Double = 45

    private let brand  = UIColor(red: 0.486, green: 0.361, blue: 1.0, alpha: 1)
    private let amber  = UIColor(red: 1.0, green: 0.69, blue: 0.13, alpha: 1)
    private let danger = UIColor(red: 1.0, green: 0.30, blue: 0.30, alpha: 1)

    private let waveBox = UIView()
    private var bars: [CALayer] = []
    private let timerButton = UIButton(type: .custom)
    private let numLabel = UILabel()
    private let glyphLabel = UILabel()
    private let ringTrack = CAShapeLayer()
    private let ringProg = CAShapeLayer()
    private let bodyBox = UIView()
    private let tagLabel = UILabel()
    private let textView = UITextView()   // scrollable so long dictations auto-scroll to the newest text

    private var link: CADisplayLink?
    private var isDark = true
    private var accent: UIColor = .white
    private var stopped = false
    private var level: CGFloat = 0        // eased waveform amplitude (0…1)
    private var targetLevel: CGFloat = 0  // latest real mic level from the app

    override init(frame: CGRect) { super.init(frame: frame); build() }
    required init?(coder: NSCoder) { fatalError("init(coder:) not used") }

    private func build() {
        layer.cornerRadius = 13
        clipsToBounds = true
        translatesAutoresizingMaskIntoConstraints = false

        waveBox.translatesAutoresizingMaskIntoConstraints = false
        waveBox.layer.cornerRadius = 12
        addSubview(waveBox)

        timerButton.translatesAutoresizingMaskIntoConstraints = false
        timerButton.layer.cornerRadius = 16
        timerButton.backgroundColor = danger
        timerButton.addTarget(self, action: #selector(stopTapped), for: .touchUpInside)
        numLabel.translatesAutoresizingMaskIntoConstraints = false
        numLabel.font = .systemFont(ofSize: 20, weight: .heavy)
        numLabel.textColor = .white
        numLabel.text = "45"   // initial value; render() overwrites with the live countdown (matches windowSeconds)
        glyphLabel.translatesAutoresizingMaskIntoConstraints = false
        glyphLabel.font = .systemFont(ofSize: 17, weight: .bold)
        glyphLabel.textColor = .white
        glyphLabel.text = "▶"
        glyphLabel.isHidden = true
        timerButton.addSubview(numLabel)
        timerButton.addSubview(glyphLabel)
        for l in [ringTrack, ringProg] {
            l.fillColor = UIColor.clear.cgColor
            l.lineWidth = 3.5
            l.lineCap = .round
            layer.addSublayer(l) // added to panel layer; positioned over the button
        }
        ringProg.strokeColor = UIColor.white.cgColor
        addSubview(timerButton)

        bodyBox.translatesAutoresizingMaskIntoConstraints = false
        bodyBox.layer.cornerRadius = 12
        bodyBox.clipsToBounds = true
        addSubview(bodyBox)

        tagLabel.translatesAutoresizingMaskIntoConstraints = false
        tagLabel.font = .systemFont(ofSize: 11, weight: .bold)
        tagLabel.text = "DICTATING"
        bodyBox.addSubview(tagLabel)

        textView.translatesAutoresizingMaskIntoConstraints = false
        textView.font = .systemFont(ofSize: 18, weight: .regular)
        textView.isEditable = false
        textView.isSelectable = false
        textView.isScrollEnabled = true
        textView.showsVerticalScrollIndicator = true
        textView.backgroundColor = .clear
        textView.textContainerInset = .zero
        textView.textContainer.lineFragmentPadding = 0
        bodyBox.addSubview(textView)

        NSLayoutConstraint.activate([
            waveBox.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 8),
            waveBox.topAnchor.constraint(equalTo: topAnchor, constant: 8),
            waveBox.heightAnchor.constraint(equalToConstant: 46),
            waveBox.trailingAnchor.constraint(equalTo: timerButton.leadingAnchor, constant: -8),

            timerButton.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -8),
            timerButton.topAnchor.constraint(equalTo: topAnchor, constant: 8),
            timerButton.widthAnchor.constraint(equalToConstant: 58),
            timerButton.heightAnchor.constraint(equalToConstant: 46),
            numLabel.centerXAnchor.constraint(equalTo: timerButton.centerXAnchor),
            numLabel.centerYAnchor.constraint(equalTo: timerButton.centerYAnchor),
            glyphLabel.centerXAnchor.constraint(equalTo: timerButton.centerXAnchor),
            glyphLabel.centerYAnchor.constraint(equalTo: timerButton.centerYAnchor),

            bodyBox.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 8),
            bodyBox.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -8),
            bodyBox.topAnchor.constraint(equalTo: waveBox.bottomAnchor, constant: 8),
            bodyBox.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -8),

            tagLabel.leadingAnchor.constraint(equalTo: bodyBox.leadingAnchor, constant: 15),
            tagLabel.topAnchor.constraint(equalTo: bodyBox.topAnchor, constant: 12),
            textView.leadingAnchor.constraint(equalTo: bodyBox.leadingAnchor, constant: 15),
            textView.trailingAnchor.constraint(equalTo: bodyBox.trailingAnchor, constant: -15),
            textView.topAnchor.constraint(equalTo: tagLabel.bottomAnchor, constant: 6),
            textView.bottomAnchor.constraint(equalTo: bodyBox.bottomAnchor, constant: -10),
        ])

        // waveform bars
        for _ in 0..<26 {
            let b = CALayer()
            b.cornerRadius = 1.5
            b.backgroundColor = brand.cgColor
            waveBox.layer.addSublayer(b)
            bars.append(b)
        }
    }

    @objc private func stopTapped() { onStop?() }

    /// Apply theme + kick off the waveform; call when the panel appears.
    func show(isDark: Bool) {
        self.isDark = isDark
        stopped = false
        waveBox.backgroundColor = isDark ? UIColor(white: 1, alpha: 0.05) : UIColor(white: 0, alpha: 0.05)
        bodyBox.backgroundColor = isDark ? UIColor(white: 1, alpha: 0.035) : UIColor(white: 0, alpha: 0.03)
        tagLabel.textColor = isDark ? UIColor(white: 1, alpha: 0.28) : UIColor(white: 0, alpha: 0.24)
        textView.textColor = isDark ? .white : .black
        ringTrack.strokeColor = (isDark ? UIColor(white: 1, alpha: 0.2) : UIColor(white: 0, alpha: 0.14)).cgColor
        if link == nil {
            let dl = CADisplayLink(target: self, selector: #selector(tick))
            dl.preferredFramesPerSecond = 30
            dl.add(to: .main, forMode: .common)
            link = dl
        }
    }

    func hide() { link?.invalidate(); link = nil }
    deinit { link?.invalidate() }

    // CADisplayLink retains its target; drop it when we leave the window so the
    // keyboard VC can deallocate cleanly (no lingering tick, no retain cycle).
    override func willMove(toWindow newWindow: UIWindow?) {
        super.willMove(toWindow: newWindow)
        if newWindow == nil { hide() }
    }

    /// Feed the live data (called ~8Hz by the keyboard). `remaining` is the ~45s countdown
    /// (the keyboard tier caps each stretch before iOS's background CPU limit); at ≤0 the panel
    /// flips to the "SAVED · TAP ▶ TO CONTINUE" rest state. `level` drives the real waveform.
    func render(remaining: Double, transcript: String, level: CGFloat) {
        targetLevel = max(0, min(1, level))
        let clamped = max(0, remaining)
        stopped = clamped <= 0.2
        accent = clamped > 15 ? brand : (clamped > 5 ? amber : danger)

        if stopped {
            numLabel.isHidden = true; glyphLabel.isHidden = false
            glyphLabel.text = "▶"
            timerButton.backgroundColor = brand
            ringProg.strokeEnd = 0
            tagLabel.text = "SAVED · TAP ▶ TO CONTINUE"
            tagLabel.textColor = isDark ? UIColor(white: 1, alpha: 0.28) : UIColor(white: 0, alpha: 0.24)
        } else {
            numLabel.isHidden = false; glyphLabel.isHidden = true
            numLabel.text = String(Int(ceil(clamped)))
            timerButton.backgroundColor = danger
            ringProg.strokeColor = accent.cgColor
            ringProg.strokeEnd = CGFloat(min(1, clamped / windowSeconds))
            tagLabel.text = clamped > 5 ? "DICTATING" : "FINISH YOUR SENTENCE"
            tagLabel.textColor = clamped > 5 ? (isDark ? UIColor(white: 1, alpha: 0.28) : UIColor(white: 0, alpha: 0.24)) : accent
        }

        let shown = transcript.isEmpty && !stopped ? "Listening…" : transcript
        if textView.text != shown {
            textView.text = shown
            // Auto-scroll to the newest text at the bottom so long dictations stay visible.
            textView.layoutIfNeeded()
            let maxOffset = max(0, textView.contentSize.height - textView.bounds.height)
            textView.setContentOffset(CGPoint(x: 0, y: maxOffset), animated: false)
        }
        textView.alpha = (transcript.isEmpty && !stopped) ? 0.4 : 1
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        // ring hugs the rounded-rect timer button (outset a few pt); drains via strokeEnd
        let rect = timerButton.frame.insetBy(dx: -4, dy: -4)
        let path = UIBezierPath(roundedRect: rect, cornerRadius: 19).cgPath
        ringTrack.path = path; ringProg.path = path
        // waveform bars laid across waveBox
        let n = bars.count
        guard n > 0, waveBox.bounds.width > 0 else { return }
        let gap: CGFloat = 3, bw: CGFloat = 3
        let totalW = CGFloat(n) * bw + CGFloat(n - 1) * gap
        var x = (waveBox.bounds.width - totalW) / 2
        for b in bars {
            b.frame = CGRect(x: x, y: waveBox.bounds.midY - 3, width: bw, height: 6)
            x += bw + gap
        }
    }

    private var t: CGFloat = 0
    @objc private func tick() {
        t += 0.6
        level += (targetLevel - level) * 0.25   // ease toward the latest real mic level
        CATransaction.begin(); CATransaction.setDisableActions(true)
        let midY = waveBox.bounds.midY
        for (i, b) in bars.enumerated() {
            let h: CGFloat
            if stopped { h = 4 }
            else {
                // Amplitude tracks REAL speech: near-flat when quiet, tall when loud.
                let s = abs(sin(Double(t) * 0.30 + Double(i) * 0.5))
                h = 4 + CGFloat(s) * (level * 18)
            }
            b.frame = CGRect(x: b.frame.minX, y: midY - h/2, width: b.frame.width, height: max(4, h))
            b.backgroundColor = (stopped ? UIColor(white: isDark ? 1 : 0, alpha: 0.28) : accent).cgColor
        }
        CATransaction.commit()
    }
}

/// The VibeFlow keyboard — a fast system-style QWERTY keyboard. The space bar reads
/// "VibeFlow" and a brand-coloured mic key starts voice dictation.
///
/// Performance: the keyboard is built once per page. Shift/caps only re-title the
/// existing letter keys in place (no view rebuild), so typing stays snappy.
///
/// Voice: iOS forbids recording inside a keyboard extension, so the mic opens the
/// VibeFlow app to capture speech (this needs "Allow Full Access"); when you switch
/// back, the keyboard auto-types the dictation the app just saved to the App Group.
final class KeyboardViewController: UIInputViewController {

    // MARK: App Group hand-off
    private let appGroup = "group.com.vibeflow.dictation"
    private let recordURL = "vibeflow://record?from=keyboard"
    private lazy var store = UserDefaults(suiteName: appGroup)

    // MARK: Flow Session (Wispr-style, zero-hop dictation)
    // While the app's background session is alive (Dynamic Island showing), the mic
    // key doesn't open the app — it toggles recording over Darwin IPC and the app
    // pushes the result back for immediate insertion.
    private let flowToggleName = "com.vibeflow.flow.toggle"
    private let flowResultName = "com.vibeflow.flow.result"
    private let flowStatusName = "com.vibeflow.flow.status"
    /// Mic key state, driven by taps (optimistic) + status pings from the app.
    private enum FlowMicState { case idle, listening, processing }
    private var flowMicState: FlowMicState = .idle
    private var lastFlowInserted = ""

    // MARK: In-keyboard live dictation (replaces the old background Flow Session)
    private var dictation: KeyboardDictation?
    private var dictating = false
    /// The text this dictation session has typed so far — diffed against each new partial
    /// so we only delete/insert the part that actually changed (live, revising insertion).
    private var dictatedText = ""
    /// Whether we still owe a leading space before the first dictated word (so a new
    /// dictation doesn't collide with existing text in the field).
    private var dictationNeedsLeadingSpace = false
    /// Transient one-line hint shown in the strip (e.g. a mic/permission error).
    private var micHint: String?
    /// The ~50s window: a thin bar fills over this time, then the mic auto-stops.
    private let dictationCapSeconds: TimeInterval = 50
    private var capTimer: Timer?
    private var capBar: UIView?
    private var capBarWidth: NSLayoutConstraint?
    /// Failsafe: if the app doesn't answer a toggle quickly, it's dead — hop instead.
    private var toggleAckTimer: Timer?
    /// Auto-dismisses info/error lines in the strip.
    private var errorClearTimer: Timer?

    // iOS's built-in spell/prediction engine — powers live suggestions + autocorrect.
    private let textChecker = UITextChecker()

    /// UITextChecker language for suggestions/autocorrect, derived from the user's
    /// selected language (shared via the App Group). Falls back to en_US when iOS
    /// has no dictionary for it.
    private var checkerLang: String {
        let raw = store?.string(forKey: "kbd_language") ?? "en-US"
        let candidate = raw.replacingOccurrences(of: "-", with: "_")
        let available = UITextChecker.availableLanguages
        if available.contains(candidate) { return candidate }
        let base = String(candidate.prefix(2))
        if available.contains(base) { return base }
        return "en_US"
    }

    private let brand = UIColor(red: 0.486, green: 0.361, blue: 1.0, alpha: 1) // #7C5CFF

    // MARK: State
    private enum ShiftState { case off, on, locked }
    private enum Page { case letters, numbers, symbols, emojis }
    private var shift: ShiftState = .on
    private var page: Page = .letters

    private var armed = false
    private var armedSnapshot = ""

    private var lastShiftTap: Date = .distantPast
    private var lastSpaceTap: Date = .distantPast
    private var backspaceTimer: Timer?
    /// True right after a suggestion-accept inserted a trailing space — typing
    /// punctuation next swallows it ("word ." → "word. ").
    private var autoSpacePending = false

    /// Spell-check + strip rebuild are deferred off the keystroke path — doing them
    /// synchronously per key made fast typing drop letters.
    private var suggestTimer: Timer?
    private func scheduleSuggestions() {
        suggestTimer?.invalidate()
        suggestTimer = Timer.scheduledTimer(withTimeInterval: 0.12, repeats: false) { [weak self] _ in
            self?.updateSuggestions()
        }
    }

    // Autocorrect memory: words we've corrected once, and words the user re-typed
    // afterwards (so we stop "fighting" them — like the system keyboard).
    private var correctedOnce: Set<String> = []
    private var refusedCorrections: Set<String> = []

    // Romanized-Telugu/Hindi + user words the keyboard should treat as valid (never
    // autocorrect away) and offer as completions — e.g. "avunu", "kadu", "sare".
    private var learnedWords: [String] = []

    // Next-word prediction: bigrams mined from the user's dictations by the app
    // (word → words they usually say next), shown when no word is being typed.
    private var bigrams: [String: [String]] = [:]
    private static let sentenceStarters = ["I", "The", "We"]
    private static let commonNext = ["the", "to", "and"]

    // MARK: Self-learning (all on-device, persisted in the App Group)
    // The keyboard learns from live typing: every kept word is counted (2+ uses →
    // personal lexicon: never autocorrected, offered as completion), word pairs
    // feed next-word predictions, and suggestion taps reinforce.
    private var learnedCounts: [String: Int] = [:]
    private var typedBigrams: [String: [String: Int]] = [:]
    private var lastCommittedWord: String?
    private var learnEvents = 0

    private func loadLearningState() {
        if let json = groupString("kbd_learned_counts"), let data = json.data(using: .utf8),
           let map = try? JSONDecoder().decode([String: Int].self, from: data) {
            learnedCounts = map
            for (w, c) in map where c >= 2 { UITextChecker.learnWord(w) }
        }
        if let json = groupString("kbd_typed_bigrams"), let data = json.data(using: .utf8),
           let map = try? JSONDecoder().decode([String: [String: Int]].self, from: data) {
            typedBigrams = map
        }
    }

    private func persistLearningState() {
        // Prune so the store stays tiny and hot: top words / top pair-heads only.
        if learnedCounts.count > 2000 {
            let keep = learnedCounts.sorted { $0.value > $1.value }.prefix(1600)
            learnedCounts = Dictionary(uniqueKeysWithValues: Array(keep))
        }
        if typedBigrams.count > 1500 {
            let keep = typedBigrams.sorted { $0.value.values.reduce(0, +) > $1.value.values.reduce(0, +) }.prefix(1200)
            typedBigrams = Dictionary(uniqueKeysWithValues: Array(keep))
        }
        if let data = try? JSONEncoder().encode(learnedCounts), let json = String(data: data, encoding: .utf8) {
            store?.set(json, forKey: "kbd_learned_counts")
        }
        if let data = try? JSONEncoder().encode(typedBigrams), let json = String(data: data, encoding: .utf8) {
            store?.set(json, forKey: "kbd_typed_bigrams")
        }
    }

    /// Called at every word boundary with the word as the user LEFT it (post-
    /// autocorrect, post-revert) — the ground truth of what they wanted.
    private func learnCommittedWord(_ raw: String) {
        let w = raw.lowercased()
        guard w.count >= 2, w.count <= 24, w.allSatisfy({ $0.isLetter || $0 == "'" }) else {
            lastCommittedWord = nil
            return
        }
        learnedCounts[w, default: 0] += 1
        if learnedCounts[w] == 2 { UITextChecker.learnWord(w) }  // reinforced → lexicon
        if let prev = lastCommittedWord {
            typedBigrams[prev, default: [:]][w, default: 0] += 1
        }
        lastCommittedWord = w
        learnEvents += 1
        if learnEvents % 12 == 0 { persistLearningState() }
    }

    /// Top personally-typed continuations for a word (merged ahead of dictation bigrams).
    private func personalNext(after word: String) -> [String] {
        guard let m = typedBigrams[word] else { return [] }
        return m.sorted { $0.value > $1.value }.prefix(3).map { $0.key }
    }

    // MARK: Views / tracking
    private var suggestionsStack: UIStackView!
    private var rowsStack: UIStackView!
    private var letterButtons: [KeyButton] = []   // a–z keys, re-titled on shift
    private var shiftButton: KeyButton?
    private var topMicButton: KeyButton?
    /// The full-screen recording panel (live transcript + countdown), shown over the
    /// keys while dictating. `panelTimer` feeds it live data from the App Group.
    private var recordingPanel: RecordingPanelView?
    private var panelTimer: Timer?
    private var built = false

    // Key-press preview balloon (the character pop-up everyone expects).
    private let keyPreview = UIView()
    private let keyPreviewLabel = UILabel()
    private var keyPreviewHideTimer: Timer?

    // MARK: Appearance-aware colors
    private var isDark: Bool { textDocumentProxy.keyboardAppearance == .dark || traitCollection.userInterfaceStyle == .dark }
    private var kbBackground: UIColor { isDark ? UIColor(white: 0.09, alpha: 1) : UIColor(red: 0.82, green: 0.84, blue: 0.86, alpha: 1) }
    private var keyColor: UIColor { isDark ? UIColor(white: 0.24, alpha: 1) : .white }
    private var keyPressed: UIColor { isDark ? UIColor(white: 0.36, alpha: 1) : UIColor(red: 0.71, green: 0.74, blue: 0.78, alpha: 1) }
    private var specialKeyColor: UIColor { isDark ? UIColor(white: 0.16, alpha: 1) : UIColor(red: 0.67, green: 0.70, blue: 0.74, alpha: 1) }
    private var specialPressed: UIColor { isDark ? UIColor(white: 0.28, alpha: 1) : .white }
    private var inkColor: UIColor { isDark ? .white : .black }
    private var faintInk: UIColor { isDark ? UIColor(white: 0.6, alpha: 1) : UIColor(white: 0.35, alpha: 1) }

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        let h = view.heightAnchor.constraint(equalToConstant: 280)
        h.priority = UILayoutPriority(999)
        h.isActive = true
        buildLayout()
        rebuildKeys()
        built = true
        loadLearnedWords()
        loadLearningState()
        // Dictation now runs in-process (KeyboardDictation) — no App-Group result/status
        // observers, so a stale background session can never inject or overwrite text here.
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        // Keyboard dismissed / switched away mid-dictation — stop the mic so the engine,
        // recognition task and .record audio session don't leak (lingering orange mic
        // indicator, other audio stuck ducked).
        if dictating { stopDictation() }
        persistLearningState()
    }

    deinit {
        CFNotificationCenterRemoveEveryObserver(
            CFNotificationCenterGetDarwinNotifyCenter(),
            Unmanaged.passUnretained(self).toOpaque()
        )
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        recordKeyboardState()
        guard built else { return }
        loadLearnedWords()
        // In-keyboard dictation lives entirely in this process, so the mic is idle whenever
        // the keyboard (re)appears — unless a dictation this instance started is still live.
        flowMicState = dictating ? .listening : .idle
        applyMicAppearance()
        updateSuggestions()
        updateShiftForContext()
    }

    /// Report to the app (via the App Group) that the keyboard has run and whether
    /// it currently has Full Access — powers the guided setup screen's live checks.
    ///
    /// The app reads these cross-process via `CFPreferencesCopyAppValue` on the App
    /// Group domain. A plain `UserDefaults(suiteName:)` write from this extension isn't
    /// reliably visible to that read (separate cache, no forced flush), which left the
    /// setup screen's "Keyboard active" / "Full Access" checks stuck grey even when the
    /// keyboard was clearly running. Mirror the writes through CFPreferences on the same
    /// domain and force a sync so the app sees them immediately.
    private func recordKeyboardState() {
        let fa = hasFullAccess ? "true" : "false"
        store?.set("true", forKey: "kbd_installed")
        store?.set(fa, forKey: "kbd_full_access")
        store?.synchronize()

        CFPreferencesSetAppValue("kbd_installed" as CFString, "true" as CFString, appGroup as CFString)
        CFPreferencesSetAppValue("kbd_full_access" as CFString, fa as CFString, appGroup as CFString)
        CFPreferencesAppSynchronize(appGroup as CFString)
    }

    override func traitCollectionDidChange(_ previous: UITraitCollection?) {
        super.traitCollectionDidChange(previous)
        guard built else { return }
        view.backgroundColor = kbBackground
        updateSuggestions()
        rebuildKeys()
    }

    // MARK: - Layout scaffold

    private func buildLayout() {
        view.backgroundColor = kbBackground

        suggestionsStack = UIStackView()
        suggestionsStack.axis = .horizontal
        suggestionsStack.distribution = .fillEqually
        suggestionsStack.spacing = 0

        // Wispr-style: a prominent mic/record button at the top-right of the toolbar
        // row (not down in the letter rows).
        let topMic = KeyButton(type: .custom)
        topMic.setImage(UIImage(systemName: "mic.fill"), for: .normal)
        topMic.tintColor = .white
        topMic.baseColor = brand
        topMic.pressedColor = brand.withAlphaComponent(0.75)
        topMic.layer.cornerRadius = 16
        topMic.layer.masksToBounds = true
        topMic.widthAnchor.constraint(equalToConstant: 56).isActive = true
        topMic.addAction(UIAction { [weak self] _ in self?.micTapped() }, for: .touchUpInside)
        topMicButton = topMic

        let topBar = UIStackView(arrangedSubviews: [suggestionsStack, topMic])
        topBar.axis = .horizontal
        topBar.alignment = .fill
        topBar.spacing = 8

        rowsStack = UIStackView()
        rowsStack.axis = .vertical
        rowsStack.distribution = .fillEqually
        rowsStack.spacing = 10

        let root = GapForgivingStack(arrangedSubviews: [topBar, rowsStack])
        root.axis = .vertical
        root.spacing = 6
        root.translatesAutoresizingMaskIntoConstraints = false
        root.isLayoutMarginsRelativeArrangement = true
        root.layoutMargins = UIEdgeInsets(top: 8, left: 6, bottom: 4, right: 6)
        view.addSubview(root)

        NSLayoutConstraint.activate([
            root.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            root.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            root.topAnchor.constraint(equalTo: view.topAnchor),
            root.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            topBar.heightAnchor.constraint(equalToConstant: 44),
        ])

        // Thin dictation-countdown line: hidden until the mic starts, then fills left→right
        // over ~50s so you can see when it will auto-stop.
        let bar = UIView()
        bar.translatesAutoresizingMaskIntoConstraints = false
        bar.backgroundColor = brand
        bar.isHidden = true
        bar.isUserInteractionEnabled = false
        bar.layer.cornerRadius = 1.5
        view.addSubview(bar)
        let barW = bar.widthAnchor.constraint(equalToConstant: 0)
        NSLayoutConstraint.activate([
            bar.topAnchor.constraint(equalTo: view.topAnchor),
            bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bar.heightAnchor.constraint(equalToConstant: 3),
            barW,
        ])
        capBar = bar
        capBarWidth = barW

        // Key-press preview balloon.
        keyPreview.layer.cornerRadius = 10
        keyPreview.layer.shadowColor = UIColor.black.cgColor
        keyPreview.layer.shadowOpacity = 0.3
        keyPreview.layer.shadowRadius = 6
        keyPreview.layer.shadowOffset = CGSize(width: 0, height: 2)
        keyPreview.isHidden = true
        keyPreview.isUserInteractionEnabled = false
        keyPreviewLabel.textAlignment = .center
        keyPreviewLabel.font = .systemFont(ofSize: 32, weight: .medium)
        keyPreview.addSubview(keyPreviewLabel)
        view.addSubview(keyPreview)

        updateSuggestions()
    }

    // MARK: - Suggestions strip (typing predictions ↔ dictation recents)

    /// While a word is being typed, show spell/prediction suggestions; otherwise
    /// fall back to recent dictations (or the mic hint).
    private func updateSuggestions() {
        let word = currentWord()
        guard !word.isEmpty else { showNextWordPredictions(); return }
        let lw = word.lowercased()

        let ns = word as NSString
        let full = NSRange(location: 0, length: ns.length)
        var picks: [String] = []
        let mis = textChecker.rangeOfMisspelledWord(in: word, range: full, startingAt: 0, wrap: false, language: checkerLang)
        if mis.location != NSNotFound {
            picks = textChecker.guesses(forWordRange: mis, in: word, language: checkerLang) ?? []
        } else {
            picks = textChecker.completions(forPartialWordRange: full, in: word, language: checkerLang) ?? []
        }

        // Personal words (typed 2+ times) + app-provided words that match come first.
        let personalMatches = learnedCounts
            .filter { $0.value >= 2 && $0.key.hasPrefix(lw) && $0.key != lw }
            .sorted { $0.value > $1.value }
            .prefix(2)
            .map { $0.key }
        let learnedMatches = personalMatches + learnedWords.filter { $0.lowercased().hasPrefix(lw) && $0.lowercased() != lw }
        var seen = Set<String>()
        let combined = (learnedMatches + picks).filter { $0.lowercased() != lw && seen.insert($0.lowercased()).inserted }
        if combined.isEmpty { showIdleSuggestions(); return }

        suggestionsStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        var slots = [word] + combined              // keep raw word first so you can keep what you typed
        slots = Array(slots.prefix(3))
        for (i, s) in slots.enumerated() {
            let b = suggestionButton(title: s, faint: i == 0)
            b.addAction(UIAction { [weak self] _ in self?.replaceCurrentWord(with: s) }, for: .touchUpInside)
            suggestionsStack.addArrangedSubview(b)
        }
    }

    /// Idle strip: a single clear status line. (It used to list past dictations,
    /// which read like broken word-suggestions — and its App-Group reads on the
    /// typing path cost keystrokes.)
    private func showIdleSuggestions() {
        suggestionsStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        let title: String
        switch flowMicState {
        case .listening:  title = "● Listening — speak, tap 🎤 to finish"
        case .processing: title = "✨ Working on your words…"
        case .idle:
            if let hint = micHint {
                title = "💬 \(hint)"
            } else {
                title = "🎙  Tap the mic and just speak"
            }
        }
        let hint = suggestionButton(title: title, faint: flowMicState == .idle)
        hint.addAction(UIAction { [weak self] _ in self?.micTapped() }, for: .touchUpInside)
        suggestionsStack.addArrangedSubview(hint)
    }

    /// No word in progress → predict the NEXT word from sentence context: bigrams
    /// learned from the user's dictations, sentence starters after ./!/?, common
    /// fillers as backstop. Falls back to the status hint with no context.
    private func showNextWordPredictions() {
        guard flowMicState == .idle, page == .letters else { showIdleSuggestions(); return }
        let before = (textDocumentProxy.documentContextBeforeInput ?? "")
            .trimmingCharacters(in: .whitespaces)
        guard !before.isEmpty else { showIdleSuggestions(); return }

        var preds: [String]
        if let last = before.last, ".!?\n".contains(last) {
            preds = Self.sentenceStarters
        } else {
            let lastWord = before
                .split(whereSeparator: { !$0.isLetter && $0 != "'" })
                .last.map(String.init)?.lowercased() ?? ""
            preds = personalNext(after: lastWord)
            for w in bigrams[lastWord] ?? [] where preds.count < 3 && !preds.contains(w) {
                preds.append(w)
            }
            for w in Self.commonNext where preds.count < 3 && !preds.contains(w) {
                preds.append(w)
            }
        }
        preds = Array(preds.prefix(3))
        guard !preds.isEmpty else { showIdleSuggestions(); return }

        suggestionsStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        for p in preds {
            let b = suggestionButton(title: p, faint: false)
            b.addAction(UIAction { [weak self] _ in
                self?.learnCommittedWord(p)
                self?.insert(p + " ")
            }, for: .touchUpInside)
            suggestionsStack.addArrangedSubview(b)
        }
    }

    /// The run of letters immediately before the cursor (the word being typed).
    private func currentWord() -> String {
        guard page == .letters else { return "" }
        let before = textDocumentProxy.documentContextBeforeInput ?? ""
        var chars: [Character] = []
        for ch in before.reversed() {
            if ch.isLetter { chars.append(ch) } else { break }
        }
        return String(chars.reversed())
    }

    /// Replace the in-progress word with a chosen suggestion (adds a trailing space).
    private func replaceCurrentWord(with replacement: String) {
        let word = currentWord()
        guard !word.isEmpty else { return }
        for _ in 0..<(word as NSString).length { textDocumentProxy.deleteBackward() }
        textDocumentProxy.insertText(replacement + " ")
        autoSpacePending = true // typing punctuation next swallows this space
        learnCommittedWord(replacement)
        updateShiftForContext()
        updateSuggestions()
    }

    private func suggestionButton(title: String, faint: Bool) -> UIButton {
        let b = UIButton(type: .system)
        b.setTitle(title, for: .normal)
        b.setTitleColor(faint ? faintInk : inkColor, for: .normal)
        b.titleLabel?.font = .systemFont(ofSize: 15)
        b.titleLabel?.adjustsFontSizeToFitWidth = true
        b.titleLabel?.minimumScaleFactor = 0.8
        return b
    }

    private func divider() -> UIView {
        let v = UIView()
        v.backgroundColor = faintInk.withAlphaComponent(0.35)
        v.widthAnchor.constraint(equalToConstant: 0.5).isActive = true
        return v
    }

    // MARK: - Build keys (only on load / page switch / appearance change)

    private func rebuildKeys() {
        rowsStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        letterButtons.removeAll()
        shiftButton = nil

        switch page {
        case .letters:
            rowsStack.addArrangedSubview(charRow(["q","w","e","r","t","y","u","i","o","p"], letters: true))
            rowsStack.addArrangedSubview(inset(charRow(["a","s","d","f","g","h","j","k","l"], letters: true), by: 18))
            rowsStack.addArrangedSubview(lettersBottomRow(["z","x","c","v","b","n","m"]))
        case .numbers:
            rowsStack.addArrangedSubview(charRow(["1","2","3","4","5","6","7","8","9","0"], letters: false))
            rowsStack.addArrangedSubview(charRow(["-","/",":",";","(",")","$","&","@","\""], letters: false))
            rowsStack.addArrangedSubview(punctBottomRow(toggle: "#+=", keys: [".",",","?","!","'"]) { [weak self] in self?.page = .symbols; self?.rebuildKeys() })
        case .symbols:
            rowsStack.addArrangedSubview(charRow(["[","]","{","}","#","%","^","*","+","="], letters: false))
            rowsStack.addArrangedSubview(charRow(["_","\\","|","~","<",">","€","£","¥","•"], letters: false))
            rowsStack.addArrangedSubview(punctBottomRow(toggle: "123", keys: [".",",","?","!","'"]) { [weak self] in self?.page = .numbers; self?.rebuildKeys() })
        case .emojis:
            rowsStack.addArrangedSubview(charRow(["😀","😂","🥹","❤️","👍","🙏","😊","🎉"], letters: false))
            rowsStack.addArrangedSubview(charRow(["😍","🥰","😭","😅","🤔","👌","🙌","🔥"], letters: false))
            let lastEmojiRow = charRow(["✨","😎","🤝","👏","💯","🥳","😢"], letters: false)
            lastEmojiRow.addArrangedSubview(backspaceKey())   // emoji page needs delete too
            rowsStack.addArrangedSubview(lastEmojiRow)
        }
        rowsStack.addArrangedSubview(functionRow())
        updateShiftForContext() // e.g. ". " typed on the ?123 page → ABC arms shift
        applyShiftAppearance()
    }

    private func charRow(_ keys: [String], letters: Bool) -> UIStackView {
        let row = UIStackView()
        row.axis = .horizontal
        row.distribution = .fillEqually
        row.spacing = 6
        for k in keys { row.addArrangedSubview(charKey(k, isLetter: letters)) }
        return row
    }

    private func lettersBottomRow(_ keys: [String]) -> UIStackView {
        let row = UIStackView()
        row.axis = .horizontal
        row.spacing = 6

        let shiftKey = specialKey(systemImage: "shift")
        shiftKey.addTarget(self, action: #selector(shiftTapped), for: .touchUpInside)
        shiftButton = shiftKey

        let mid = UIStackView()
        mid.axis = .horizontal
        mid.distribution = .fillEqually
        mid.spacing = 6
        for k in keys { mid.addArrangedSubview(charKey(k, isLetter: true)) }

        let back = backspaceKey()

        row.addArrangedSubview(shiftKey)
        row.addArrangedSubview(mid)
        row.addArrangedSubview(back)
        shiftKey.widthAnchor.constraint(equalTo: back.widthAnchor).isActive = true
        shiftKey.widthAnchor.constraint(equalTo: row.widthAnchor, multiplier: 0.13).isActive = true
        return row
    }

    private func punctBottomRow(toggle: String, keys: [String], action: @escaping () -> Void) -> UIStackView {
        let row = UIStackView()
        row.axis = .horizontal
        row.spacing = 6

        let toggleKey = specialKey(title: toggle)
        toggleKey.addAction(UIAction { _ in action() }, for: .touchUpInside)

        let mid = UIStackView()
        mid.axis = .horizontal
        mid.distribution = .fillEqually
        mid.spacing = 6
        for k in keys { mid.addArrangedSubview(charKey(k, isLetter: false)) }

        let back = backspaceKey()

        row.addArrangedSubview(toggleKey)
        row.addArrangedSubview(mid)
        row.addArrangedSubview(back)
        toggleKey.widthAnchor.constraint(equalTo: back.widthAnchor).isActive = true
        toggleKey.widthAnchor.constraint(equalTo: row.widthAnchor, multiplier: 0.13).isActive = true
        return row
    }

    private func functionRow() -> UIStackView {
        let row = UIStackView()
        row.axis = .horizontal
        row.spacing = 6

        let modeKey = specialKey(title: (page == .numbers || page == .symbols) ? "ABC" : "123")
        modeKey.addAction(UIAction { [weak self] _ in
            guard let self else { return }
            self.page = (self.page == .numbers || self.page == .symbols) ? .letters : .numbers
            self.rebuildKeys()
        }, for: .touchUpInside)

        // Only show our own globe when iOS does NOT already provide one in the bar
        // below the keyboard; otherwise that slot becomes the emoji page key.
        let globe: KeyButton?
        if needsInputModeSwitchKey {
            let g = specialKey(systemImage: "globe")
            g.addTarget(self, action: #selector(handleInputModeList(from:with:)), for: .allTouchEvents)
            globe = g
        } else {
            globe = nil
        }
        let emoji = specialKey(title: page == .emojis ? "ABC" : "😀")
        emoji.titleLabel?.font = .systemFont(ofSize: 20)
        emoji.addAction(UIAction { [weak self] _ in
            guard let self else { return }
            self.page = self.page == .emojis ? .letters : .emojis
            self.rebuildKeys()
        }, for: .touchUpInside)

        let space = specialKey(title: "VibeFlow")
        space.baseColor = keyColor
        space.pressedColor = keyPressed
        space.setTitleColor(faintInk, for: .normal)
        space.titleLabel?.font = .systemFont(ofSize: 15)
        space.addAction(UIAction { [weak self] _ in self?.spaceTapped() }, for: .touchUpInside)

        let ret = specialKey(title: "return")
        ret.titleLabel?.font = .systemFont(ofSize: 16)
        ret.addAction(UIAction { [weak self] _ in self?.insert("\n") }, for: .touchUpInside)

        // Bottom row (mic lives in the top toolbar): 123 · [globe] · 😀 · space · return
        row.addArrangedSubview(modeKey)
        if let globe { row.addArrangedSubview(globe) }
        row.addArrangedSubview(emoji)
        row.addArrangedSubview(space)
        row.addArrangedSubview(ret)

        modeKey.widthAnchor.constraint(equalTo: row.widthAnchor, multiplier: 0.13).isActive = true
        globe?.widthAnchor.constraint(equalTo: modeKey.widthAnchor).isActive = true
        emoji.widthAnchor.constraint(equalTo: modeKey.widthAnchor).isActive = true
        ret.widthAnchor.constraint(equalTo: row.widthAnchor, multiplier: 0.20).isActive = true
        return row
    }

    // MARK: - Key factories

    private func charKey(_ base: String, isLetter: Bool) -> KeyButton {
        let b = makeKey()
        b.baseColor = keyColor
        b.pressedColor = keyPressed
        b.setTitle(base, for: .normal)
        b.setTitleColor(inkColor, for: .normal)
        b.titleLabel?.font = .systemFont(ofSize: 22)
        // Insert on TOUCH-DOWN (like fast keyboards): waiting for touch-up made
        // rapid typing drop letters when taps overlapped.
        if isLetter {
            b.accessibilityIdentifier = base       // lowercase base for re-titling
            letterButtons.append(b)
            b.addAction(UIAction { [weak self, weak b] _ in
                guard let self else { return }
                if let b { self.showKeyPreview(over: b, text: self.shift == .off ? base : base.uppercased()) }
                self.charTapped(base)
            }, for: .touchDown)
        } else {
            b.addAction(UIAction { [weak self, weak b] _ in
                guard let self else { return }
                if let b { self.showKeyPreview(over: b, text: base) }
                self.insert(base)
            }, for: .touchDown)
        }
        b.addTarget(self, action: #selector(hideKeyPreview), for: [.touchUpInside, .touchUpOutside, .touchCancel])
        return b
    }

    /// Show the character balloon above a pressed key (auto-hides as a fallback).
    private func showKeyPreview(over key: KeyButton, text: String) {
        let keyFrame = key.convert(key.bounds, to: view)
        let width = max(keyFrame.width + 20, 50)
        let height: CGFloat = 56
        var x = keyFrame.midX - width / 2
        x = min(max(2, x), view.bounds.width - width - 2)
        keyPreview.frame = CGRect(x: x, y: keyFrame.minY - height + 10, width: width, height: height)
        keyPreview.backgroundColor = keyColor
        keyPreviewLabel.frame = keyPreview.bounds
        keyPreviewLabel.textColor = inkColor
        keyPreviewLabel.text = text
        keyPreview.isHidden = false
        view.bringSubviewToFront(keyPreview)
        keyPreviewHideTimer?.invalidate()
        keyPreviewHideTimer = Timer.scheduledTimer(withTimeInterval: 0.35, repeats: false) { [weak self] _ in
            self?.keyPreview.isHidden = true
        }
    }

    @objc private func hideKeyPreview() {
        // Tiny linger so the balloon is perceivable on quick taps.
        keyPreviewHideTimer?.invalidate()
        keyPreviewHideTimer = Timer.scheduledTimer(withTimeInterval: 0.06, repeats: false) { [weak self] _ in
            self?.keyPreview.isHidden = true
        }
    }

    private func specialKey(title: String? = nil, systemImage: String? = nil) -> KeyButton {
        let b = makeKey()
        b.baseColor = specialKeyColor
        b.pressedColor = specialPressed
        if let title { b.setTitle(title, for: .normal); b.setTitleColor(inkColor, for: .normal); b.titleLabel?.font = .systemFont(ofSize: 16) }
        if let systemImage { b.setImage(UIImage(systemName: systemImage), for: .normal); b.tintColor = inkColor }
        return b
    }

    private func backspaceKey() -> KeyButton {
        let b = specialKey(systemImage: "delete.left")
        b.addTarget(self, action: #selector(backspaceDown), for: .touchDown)
        b.addTarget(self, action: #selector(backspaceUp), for: [.touchUpInside, .touchUpOutside, .touchCancel])
        return b
    }

    private func makeKey() -> KeyButton {
        let b = KeyButton(type: .custom)
        b.layer.cornerRadius = 6
        b.layer.masksToBounds = true
        b.heightAnchor.constraint(greaterThanOrEqualToConstant: 46).isActive = true
        return b
    }

    private func inset(_ v: UIView, by pad: CGFloat) -> UIView {
        let c = UIView()
        v.translatesAutoresizingMaskIntoConstraints = false
        c.addSubview(v)
        NSLayoutConstraint.activate([
            v.topAnchor.constraint(equalTo: c.topAnchor),
            v.bottomAnchor.constraint(equalTo: c.bottomAnchor),
            v.leadingAnchor.constraint(equalTo: c.leadingAnchor, constant: pad),
            v.trailingAnchor.constraint(equalTo: c.trailingAnchor, constant: -pad),
        ])
        return c
    }

    // MARK: - Shift (fast, no rebuild)

    private func applyShiftAppearance() {
        guard page == .letters else { return }
        let upper = shift != .off
        for b in letterButtons {
            let base = b.accessibilityIdentifier ?? (b.currentTitle ?? "")
            b.setTitle(upper ? base.uppercased() : base, for: .normal)
        }
        let name = shift == .locked ? "capslock.fill" : (shift == .on ? "shift.fill" : "shift")
        shiftButton?.setImage(UIImage(systemName: name), for: .normal)
    }

    // MARK: - Key actions

    private func charTapped(_ base: String) {
        textDocumentProxy.insertText(shift == .off ? base : base.uppercased())
        if shift == .on {
            shift = .off                   // consume one-shot shift…
            applyShiftAppearance()         // …and re-title the keys immediately
        }
        updateShiftForContext()
        scheduleSuggestions()
    }

    @objc private func shiftTapped() {
        let now = Date()
        if now.timeIntervalSince(lastShiftTap) < 0.3 { shift = .locked }
        else { shift = (shift == .off) ? .on : .off }
        lastShiftTap = now
        applyShiftAppearance()
    }

    private func spaceTapped() {
        endDictationForManualInput()
        autoSpacePending = false
        capitalizeLoneI()
        autocorrectCurrentWord()
        learnCommittedWord(currentWord())
        let now = Date()
        if now.timeIntervalSince(lastSpaceTap) < 0.3,
           let before = textDocumentProxy.documentContextBeforeInput,
           before.hasSuffix(" "),
           let last = before.dropLast().last, last.isLetter || last.isNumber {
            textDocumentProxy.deleteBackward()
            textDocumentProxy.insertText(". ")
            lastSpaceTap = .distantPast
        } else {
            textDocumentProxy.insertText(" ")
            lastSpaceTap = now
        }
        updateShiftForContext()
        scheduleSuggestions()
    }

    /// Conservative autocorrect: if the just-typed word is clearly misspelled and
    /// there's a confident guess, swap it — mirrors the system keyboard's space fix.
    private func autocorrectCurrentWord() {
        let word = currentWord()
        guard word.count >= 3 else { return }
        let key = word.lowercased()
        if refusedCorrections.contains(key) { return }   // user insists on this spelling
        if (learnedCounts[key] ?? 0) >= 2 { return }     // personal lexicon — hands off
        let ns = word as NSString
        let full = NSRange(location: 0, length: ns.length)
        let mis = textChecker.rangeOfMisspelledWord(in: word, range: full, startingAt: 0, wrap: false, language: checkerLang)
        guard mis.location != NSNotFound,
              let top = textChecker.guesses(forWordRange: mis, in: word, language: checkerLang)?.first,
              top.lowercased() != key,
              !top.contains(" ") else { return }
        // If we already corrected this exact word once and the user typed it again,
        // they meant it — stop correcting it (matches the system keyboard).
        if correctedOnce.contains(key) {
            refusedCorrections.insert(key)
            return
        }
        correctedOnce.insert(key)
        for _ in 0..<ns.length { textDocumentProxy.deleteBackward() }
        textDocumentProxy.insertText(top)
    }

    @objc private func backspaceDown() {
        endDictationForManualInput()
        textDocumentProxy.deleteBackward()
        backspaceTimer?.invalidate()
        backspaceTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            self?.textDocumentProxy.deleteBackward()
        }
    }

    @objc private func backspaceUp() {
        backspaceTimer?.invalidate()
        backspaceTimer = nil
        updateShiftForContext()
        scheduleSuggestions()
    }

    private func insert(_ text: String) {
        endDictationForManualInput()
        // Punctuation right after an accepted suggestion swallows the auto-space:
        // "word ‸" + "." → "word. " (system-keyboard behavior), not "word .".
        if autoSpacePending, text.count == 1, ".,!?;:".contains(text),
           (textDocumentProxy.documentContextBeforeInput ?? "").hasSuffix(" ") {
            autoSpacePending = false
            textDocumentProxy.deleteBackward()
            textDocumentProxy.insertText(text + " ")
            updateShiftForContext()
            scheduleSuggestions()
            return
        }
        autoSpacePending = false
        // A single non-letter key (punctuation, return) ends the word in progress —
        // learn it exactly as the user left it.
        if page == .letters, text.count == 1, let ch = text.first, !ch.isLetter, ch != "'" {
            learnCommittedWord(currentWord())
        }
        textDocumentProxy.insertText(text)
        updateShiftForContext()
        scheduleSuggestions()
    }

    private func updateShiftForContext() {
        // NOTE: no `page == .letters` guard — the period key lives on the ?123 page,
        // and gating on the page meant ". " typed there never armed the shift (the
        // "no caps after full stop" bug). State updates on every page; rendering is
        // page-guarded inside applyShiftAppearance.
        guard shift != .locked else { return }
        let before = textDocumentProxy.documentContextBeforeInput ?? ""
        let want: ShiftState
        // Respect the host field's autocapitalization (like the system keyboard):
        // email/username/code fields ask for none — forcing caps there is hostile.
        switch textDocumentProxy.autocapitalizationType ?? .sentences {
        case .none:
            want = .off
        case .allCharacters:
            want = .on
        case .words:
            want = (before.isEmpty || before.hasSuffix(" ") || before.hasSuffix("\n")) ? .on : .off
        default: // .sentences
            want = (before.isEmpty || before.hasSuffix("\n")
                || before.hasSuffix(". ") || before.hasSuffix("! ") || before.hasSuffix("? ")) ? .on : .off
        }
        if want != shift { shift = want; applyShiftAppearance() }
    }

    /// Standalone "i" becomes "I" on space — the classic system-keyboard fix that
    /// the 3-letter autocorrect floor misses.
    private func capitalizeLoneI() {
        guard !refusedCorrections.contains("i") else { return }
        let before = textDocumentProxy.documentContextBeforeInput ?? ""
        guard before.hasSuffix("i") else { return }
        let prior = before.dropLast().last
        if prior == nil || !(prior!.isLetter || prior! == "'") {
            textDocumentProxy.deleteBackward()
            textDocumentProxy.insertText("I")
        }
    }

    // MARK: - Mic → dictation flow

    /// A session is alive only if the flag is set AND the app's 2s heartbeat is
    /// fresh — a force-quit/jetsam kill leaves stale flags (previously the mic
    /// pulsed red and "recorded" into a dead process, and the ack failsafe was
    /// blinded by a stale "listening" status). Stale flags are self-healed here.
    private var flowSessionAlive: Bool {
        guard groupString("flow_session_active") == "true" else { return false }
        let beat = Double(groupString("flow_heartbeat_ts") ?? "") ?? 0
        let fresh = Date().timeIntervalSince1970 * 1000 - beat < 6000
        if !fresh {
            store?.set("false", forKey: "flow_session_active")
            store?.set("", forKey: "kbd_flow_status")
        }
        return fresh
    }

    private func micTapped() {
        if dictating { stopDictation() } else { startDictation() }
    }

    /// Begin live in-keyboard dictation — recognition runs right here and types words into
    /// the field as they're recognised, like the system mic.
    private func startDictation() {
        guard hasFullAccess else { showMicHint("Turn on Allow Full Access to use the mic"); return }
        // Add a leading space before the first word if the field already ends in a word.
        let before = textDocumentProxy.documentContextBeforeInput ?? ""
        if let last = before.last {
            dictationNeedsLeadingSpace = !last.isWhitespace && !"\n([{\"'".contains(last)
        } else {
            dictationNeedsLeadingSpace = false
        }
        dictatedText = ""
        let localeId = groupString("kbd_lang") ?? "en-US"
        let d = KeyboardDictation(localeId: localeId)
        d.onResult = { [weak self] text, _ in self?.applyLiveTranscript(text) }
        d.onEnd = { [weak self] reason in self?.dictationEnded(reason: reason) }
        if let err = d.start() { showMicHint(err); return }
        dictation = d
        dictating = true
        micHint = nil
        flowMicState = .listening
        applyMicAppearance()
        startCapBar()
        updateSuggestions()
    }

    /// Stop the mic (from a tap or the ~50s cap). `dictationEnded` does the cleanup.
    private func stopDictation() { dictation?.stop() }

    /// The user reached for the keys mid-dictation. Stop dictating (committing whatever is
    /// already typed) so manual edits can't desync applyLiveTranscript's diff and delete
    /// into the user's existing text. `dictating` is cleared synchronously so no late
    /// partial touches the field after this returns.
    private func endDictationForManualInput() {
        guard dictating else { return }
        dictating = false
        dictatedText = ""
        stopDictation()
    }

    private func dictationEnded(reason: String?) {
        dictating = false
        dictation = nil
        dictatedText = ""
        stopCapBar()
        flowMicState = .idle
        applyMicAppearance()
        if let reason, !reason.isEmpty { showMicHint(reason) }
        updateSuggestions()
    }

    /// Type the newest partial transcript by diffing against what we've already typed this
    /// session: delete only the changed tail, insert the rest (live, revising insertion).
    private func applyLiveTranscript(_ text: String) {
        guard dictating, view.window != nil else { return }
        if dictationNeedsLeadingSpace, dictatedText.isEmpty, !text.isEmpty {
            textDocumentProxy.insertText(" ")
            dictationNeedsLeadingSpace = false
        }
        if text == dictatedText { return }
        let oldChars = Array(dictatedText)
        let newChars = Array(text)
        var common = 0
        let maxCommon = min(oldChars.count, newChars.count)
        while common < maxCommon && oldChars[common] == newChars[common] { common += 1 }
        for _ in 0..<(oldChars.count - common) { textDocumentProxy.deleteBackward() }
        let tail = String(newChars[common...])
        if !tail.isEmpty { textDocumentProxy.insertText(tail) }
        dictatedText = text
    }

    private func showMicHint(_ text: String) {
        micHint = text
        updateSuggestions()
        errorClearTimer?.invalidate()
        errorClearTimer = Timer.scheduledTimer(withTimeInterval: 3.5, repeats: false) { [weak self] _ in
            self?.micHint = nil
            self?.updateSuggestions()
        }
    }

    // MARK: ~50s cap bar (fills over the window, then auto-stops the mic)

    private func startCapBar() {
        guard let bar = capBar, let w = capBarWidth else { return }
        capTimer?.invalidate()
        bar.layer.removeAllAnimations()
        bar.isHidden = false
        w.constant = 0
        view.layoutIfNeeded()
        UIView.animate(withDuration: dictationCapSeconds, delay: 0, options: [.curveLinear]) {
            w.constant = self.view.bounds.width
            self.view.layoutIfNeeded()
        }
        capTimer = Timer.scheduledTimer(withTimeInterval: dictationCapSeconds, repeats: false) { [weak self] _ in
            self?.stopDictation()
        }
    }

    private func stopCapBar() {
        capTimer?.invalidate()
        capTimer = nil
        guard let bar = capBar, let w = capBarWidth else { return }
        bar.layer.removeAllAnimations()
        w.constant = 0
        bar.isHidden = true
        view.layoutIfNeeded()
    }

    /// Mic key mirrors the real flow state: pulsing red while listening, orange
    /// while the app processes, brand purple when idle (green flash on insert).
    private func applyMicAppearance() {
        guard let mic = topMicButton else { return }
        mic.layer.removeAnimation(forKey: "flowPulse")
        switch flowMicState {
        case .idle:
            mic.baseColor = brand
            mic.pressedColor = brand.withAlphaComponent(0.75)
            mic.setImage(UIImage(systemName: "mic.fill"), for: .normal)
        case .listening:
            mic.baseColor = .systemRed
            mic.pressedColor = UIColor.systemRed.withAlphaComponent(0.75)
            mic.setImage(UIImage(systemName: "waveform"), for: .normal)
            let pulse = CABasicAnimation(keyPath: "opacity")
            pulse.fromValue = 1.0
            pulse.toValue = 0.5
            pulse.duration = 0.55
            pulse.autoreverses = true
            pulse.repeatCount = .infinity
            mic.layer.add(pulse, forKey: "flowPulse")
        case .processing:
            mic.baseColor = .systemOrange
            mic.pressedColor = UIColor.systemOrange.withAlphaComponent(0.75)
            mic.setImage(UIImage(systemName: "ellipsis"), for: .normal)
            let pulse = CABasicAnimation(keyPath: "transform.scale")
            pulse.fromValue = 1.0
            pulse.toValue = 0.92
            pulse.duration = 0.4
            pulse.autoreverses = true
            pulse.repeatCount = .infinity
            mic.layer.add(pulse, forKey: "flowPulse")
        }
    }

    // MARK: - Recording panel (live transcript + countdown over the keys)

    /// Show the panel while dictating (listening/processing) and hide it when idle so the
    /// keys return. Drives a light timer that feeds live text + countdown from the App Group.
    private func updateRecordingPanel() {
        if flowMicState != .idle {
            let panel: RecordingPanelView
            if let p = recordingPanel { panel = p } else {
                panel = RecordingPanelView()
                panel.onStop = { [weak self] in self?.micTapped() }
                view.addSubview(panel)
                NSLayoutConstraint.activate([
                    panel.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                    panel.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                    panel.topAnchor.constraint(equalTo: view.topAnchor),
                    panel.bottomAnchor.constraint(equalTo: view.bottomAnchor),
                ])
                recordingPanel = panel
            }
            panel.backgroundColor = kbBackground
            panel.isHidden = false
            view.bringSubviewToFront(panel)
            panel.show(isDark: isDark)
            refreshPanel()
            if panelTimer == nil {
                panelTimer = Timer.scheduledTimer(withTimeInterval: 0.12, repeats: true) { [weak self] _ in
                    self?.refreshPanel()
                }
            }
        } else {
            panelTimer?.invalidate(); panelTimer = nil
            recordingPanel?.hide()
            recordingPanel?.isHidden = true
        }
    }

    /// Feed the panel one frame of the growing live transcript (published by the app as
    /// `flow_live_full`), read under a cross-process sync (this runs ~8×/sec while recording).
    private func refreshPanel() {
        guard let panel = recordingPanel, !panel.isHidden else { return }
        CFPreferencesAppSynchronize(appGroup as CFString)
        func cf(_ k: String) -> String? {
            (CFPreferencesCopyAppValue(k as CFString, appGroup as CFString) as? String) ?? store?.string(forKey: k)
        }
        let deadline = Double(cf("flow_session_deadline_ts") ?? "") ?? 0
        let remaining = deadline > 0 ? (deadline - Date().timeIntervalSince1970 * 1000) / 1000 : 0
        let level = CGFloat(Double(cf("flow_level") ?? "0") ?? 0)
        panel.render(remaining: remaining, transcript: cf("flow_live_full") ?? "", level: level)
    }

    /// Brief green confirmation when dictated text lands, then back to the LIVE
    /// state — a newer utterance may already be recording (forcing .idle here used
    /// to stomp it, and the next tap then stopped a live recording).
    private func flashMicSuccess() {
        guard let mic = topMicButton else { return }
        mic.layer.removeAnimation(forKey: "flowPulse")
        mic.baseColor = .systemGreen
        mic.setImage(UIImage(systemName: "checkmark"), for: .normal)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { [weak self] in
            guard let self else { return }
            switch self.groupString("kbd_flow_status") ?? "" {
            case "listening": self.flowMicState = .listening
            case "processing": self.flowMicState = .processing
            default: self.flowMicState = .idle
            }
            self.applyMicAppearance()
            self.updateRecordingPanel()   // hide the panel once idle; keep it while still live
        }
    }

    /// Auto-type the dictation the app just saved. Keyed off App-Group timestamps —
    /// NOT in-memory state — because iOS routinely kills the keyboard process during
    /// the hop to the app (which silently broke the old armed-flag handshake).
    private func autoInsertIfReturned() {
        armed = false
        let current = latest()
        guard !current.isEmpty else { return }
        let savedTs = Double(groupString("latest_dictation_ts") ?? "") ?? 0
        let insertedTs = Double(groupString("kbd_inserted_ts") ?? "") ?? 0
        let ageMs = Date().timeIntervalSince1970 * 1000 - savedTs
        // Fresh (≤3 min) and not yet typed anywhere → insert it.
        guard savedTs > insertedTs, ageMs < 180_000 else { return }
        store?.set(String(savedTs), forKey: "kbd_inserted_ts")
        lastFlowInserted = current
        smartInsert(current)
    }

    /// Insert with a separating space when the cursor sits right after a word.
    private func smartInsert(_ text: String) {
        if let before = textDocumentProxy.documentContextBeforeInput,
           let last = before.last, !last.isWhitespace, !"\n([{\"'".contains(last) {
            textDocumentProxy.insertText(" ")
        }
        textDocumentProxy.insertText(text)
    }

    /// Darwin observers: "result ready" → insert the dictation; "status" → animate
    /// the mic with the app's real state.
    private func registerFlowResultObserver() {
        let center = CFNotificationCenterGetDarwinNotifyCenter()
        let observer = Unmanaged.passUnretained(self).toOpaque()
        CFNotificationCenterAddObserver(center, observer, { _, observer, _, _, _ in
            guard let observer = observer else { return }
            let kb = Unmanaged<KeyboardViewController>.fromOpaque(observer).takeUnretainedValue()
            DispatchQueue.main.async { kb.insertFlowResult() }
        }, flowResultName as CFString, nil, .deliverImmediately)
        CFNotificationCenterAddObserver(center, observer, { _, observer, _, _, _ in
            guard let observer = observer else { return }
            let kb = Unmanaged<KeyboardViewController>.fromOpaque(observer).takeUnretainedValue()
            DispatchQueue.main.async { kb.flowStatusChanged() }
        }, flowStatusName as CFString, nil, .deliverImmediately)
    }

    private func insertFlowResult() {
        toggleAckTimer?.invalidate()
        // If the keyboard isn't on screen the proxy is detached and insertText is a
        // silent no-op — bail BEFORE consuming the dedupe timestamp so
        // autoInsertIfReturned can deliver the text when the keyboard next appears.
        guard view.window != nil else { return }
        let text = latest()
        guard !text.isEmpty else { return }
        // Dedupe by TIMESTAMP, not string equality — dictating the same words twice
        // is legitimate (equality-dedupe silently dropped the repeat AND left the
        // mic stuck pulsing "processing"). Same marker autoInsertIfReturned uses.
        let savedTs = Double(groupString("latest_dictation_ts") ?? "") ?? 0
        let insertedTs = Double(groupString("kbd_inserted_ts") ?? "") ?? 0
        guard savedTs > insertedTs else { return }
        store?.set(String(savedTs), forKey: "kbd_inserted_ts")
        lastFlowInserted = text
        smartInsert(text)
        flashMicSuccess()
        updateSuggestions()
    }

    /// App pinged that kbd_flow_status changed — mirror the real state on the mic.
    private func flowStatusChanged() {
        toggleAckTimer?.invalidate()
        let status = groupString("kbd_flow_status") ?? ""
        switch status {
        case "listening":  flowMicState = .listening
        case "processing": flowMicState = .processing
        case "inserted":   return          // insertFlowResult handles the green flash
        default:           flowMicState = .idle   // includes "error: …"
        }
        applyMicAppearance()
        updateRecordingPanel()
        if status.hasPrefix("error"), currentWord().isEmpty {
            showIdleSuggestions()          // surface the error text in the strip
        }
    }

    /// Bundle id of the app hosting the keyboard (WhatsApp etc.), so VibeFlow can
    /// show a "Return to <app>" button. Same non-public key the popular KeyboardKit
    /// framework ships with; falls back to nil if iOS ever removes it.
    private var hostBundleID: String? {
        parent?.value(forKey: "_hostBundleID") as? String
    }

    /// Opening a URL from a keyboard extension requires "Allow Full Access". The old
    /// `openURL:` selector was removed long ago, so walk the responder chain to the
    /// UIApplication and call the modern `open(_:)`.
    private func openApp() {
        var link = recordURL
        if let host = hostBundleID, !host.isEmpty {
            link += "&host=\(host)"
        }
        guard let url = URL(string: link) else { return }
        var responder: UIResponder? = self
        while let r = responder {
            if let app = r as? UIApplication {
                app.open(url, options: [:], completionHandler: nil)
                return
            }
            responder = r.next
        }
    }

    // MARK: - App Group reads

    private struct Dictation: Decodable { let id: Double; let text: String; var pinned: Bool? }

    /// Force a fresh cross-process read from the App Group. The app writes these keys
    /// from its own process, and a plain UserDefaults instance can hand back a stale
    /// cache — which silently broke the round-trip (keyboard never saw the new dictation).
    private func groupString(_ key: String) -> String? {
        CFPreferencesAppSynchronize(appGroup as CFString)
        if let v = CFPreferencesCopyAppValue(key as CFString, appGroup as CFString) as? String {
            return v
        }
        return store?.string(forKey: key)
    }

    private func latest() -> String { groupString("latest_dictation") ?? "" }

    private func history() -> [Dictation] {
        guard let json = groupString("history_json"),
              let data = json.data(using: .utf8),
              let list = try? JSONDecoder().decode([Dictation].self, from: data) else { return [] }
        return list.sorted { $0.id > $1.id }
    }

    /// Load the user + starter romanized-Telugu/Hindi words (written by the app) and
    /// teach them to iOS's spell checker so they're never flagged/autocorrected.
    private func loadLearnedWords() {
        if let json = groupString("kbd_learned_words"),
           let data = json.data(using: .utf8),
           let list = try? JSONDecoder().decode([String].self, from: data) {
            learnedWords = list
            for w in list where !w.isEmpty { UITextChecker.learnWord(w) }
        }
        if let json = groupString("kbd_bigrams"),
           let data = json.data(using: .utf8),
           let map = try? JSONDecoder().decode([String: [String]].self, from: data) {
            bigrams = map
        }
    }
}

// MARK: - In-keyboard live dictation
//
// Runs ENTIRELY inside the keyboard extension: one AVAudioEngine + one on-device
// SFSpeechRecognizer, reporting partial results so the keyboard can type them into the
// field live (like the system mic). It stops itself on the recognizer's final result or an
// error; the caller also caps it at ~50s. No background session, no App-Group round-trip —
// the old architecture that dropped text is gone. Needs "Allow Full Access" + mic/speech
// permission (granted once in the VibeFlow app).
final class KeyboardDictation {
    private let recognizer: SFSpeechRecognizer?
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private(set) var running = false

    /// (fullTranscript, isFinal) — always delivered on the MAIN thread.
    var onResult: ((String, Bool) -> Void)?
    /// Recognition ended — MAIN thread. `reason` nil = clean; non-nil short user message.
    var onEnd: ((String?) -> Void)?

    init(localeId: String) {
        recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeId)) ?? SFSpeechRecognizer()
    }

    /// Begins listening. Returns a short error string if it couldn't start, else nil.
    func start() -> String? {
        guard !running else { return nil }
        guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
            return "Open VibeFlow to allow Speech Recognition"
        }
        guard AVAudioSession.sharedInstance().recordPermission == .granted else {
            return "Open VibeFlow to allow the Microphone"
        }
        guard let recognizer, recognizer.isAvailable else { return "Speech is unavailable right now" }

        let session = AVAudioSession.sharedInstance()
        do {
            // Wispr Flow's keyboard session, per 1.0.37 which fixed exactly this 'what'
            // (2003329396) engine-start error: PlayAndRecord + .defaultToSpeaker, and
            // crucially NO .duckOthers — .duckOthers is what makes engine.start() throw
            // 'what' in a keyboard extension.
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
            try session.setActive(true)
        } catch {
            NSLog("[VibeFlow.kbd] audio session failed: %@", String(describing: error))
            return "Audio: \(error.localizedDescription)"
        }

        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if #available(iOS 16, *) { req.addsPunctuation = true }
        if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
        request = req

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        // installTap raises an UNCATCHABLE Obj-C exception on an invalid (0 sample-rate /
        // 0-channel) format, which the audio route can briefly report right after the session
        // activates. Validate first and fail gracefully instead of crashing the keyboard.
        guard format.sampleRate > 0, format.channelCount > 0 else {
            request = nil
            try? session.setActive(false)
            return "Mic isn't ready — tap again"
        }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.request?.append(buffer)
        }
        engine.prepare()
        do {
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            request = nil
            try? session.setActive(false)
            NSLog("[VibeFlow.kbd] engine.start failed: %@", String(describing: error))
            return "Engine: \(error.localizedDescription)"
        }

        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            guard let self else { return }
            if let result {
                let text = result.bestTranscription.formattedString
                let isFinal = result.isFinal
                DispatchQueue.main.async { self.onResult?(text, isFinal) }
                if isFinal { self.finish(reason: nil) }
            } else if error != nil {
                // A mid-stream error still leaves whatever we've already typed in place.
                self.finish(reason: nil)
            }
        }
        running = true
        return nil
    }

    /// Stop listening (idempotent). Fires `onEnd`.
    func stop() { finish(reason: nil) }

    private func finish(reason: String?) {
        DispatchQueue.main.async {
            guard self.running else { return }
            self.running = false
            self.engine.inputNode.removeTap(onBus: 0)
            if self.engine.isRunning { self.engine.stop() }
            self.request?.endAudio()
            self.task?.finish()
            self.request = nil
            self.task = nil
            try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
            self.onEnd?(reason)
        }
    }

    deinit {
        // Backstop: if the owner is deallocated mid-recording (keyboard torn down without a
        // clean stop), don't leave the engine/tap/session running.
        guard running else { return }
        engine.inputNode.removeTap(onBus: 0)
        if engine.isRunning { engine.stop() }
        request?.endAudio()
        task?.cancel()
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }
}
