import UIKit

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

/// The VibeFlow keyboard — a fast system-style QWERTY keyboard. The space bar reads
/// "VibeFlow" and a brand-coloured mic key starts voice dictation.
///
/// Performance: the keyboard is built once per page. Shift/caps only re-title the
/// existing letter keys in place (no view rebuild), so typing stays snappy.
///
/// Voice: iOS forbids recording inside a keyboard extension, so the mic opens the
/// VibeFlow app to capture speech (this needs "Allow Full Access"); when you switch
/// back, the keyboard auto-types the dictation the app just saved to the App Group.
final class KeyboardViewController: UIInputViewController, UIInputViewAudioFeedback {
    /// Enables the standard iOS key-click sound (respects the user's Keyboard Clicks setting).
    var enableInputClicksWhenVisible: Bool { true }

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
    private let flowPartialName = "com.vibeflow.flow.partial"
    /// Mic key state, driven by taps (optimistic) + status pings from the app.
    private enum FlowMicState { case idle, listening, processing }
    private var flowMicState: FlowMicState = .idle
    private var lastFlowInserted = ""
    /// Failsafe: if the app doesn't answer a toggle quickly, it's dead — hop instead.
    private var toggleAckTimer: Timer?
    /// Auto-dismisses info/error lines in the strip.
    private var errorClearTimer: Timer?

    /// The ~45s dictation countdown line: fills left→right while recording, synced to the
    /// app's flow_session_deadline_ts; the mic auto-stops when it reaches the end.
    private var capBar: UIView?
    private var capBarWidth: NSLayoutConstraint?

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

    /// The "feel" of a real keyboard: the system key-click + a light haptic on every key.
    /// (Haptics fire only with Full Access — which the mic needs anyway; the click always
    /// plays, honoring the user's setting.) Prepared on appearance for low latency.
    private let keyHaptic = UIImpactFeedbackGenerator(style: .light)
    private func keyFeedback() {
        UIDevice.current.playInputClick()
        keyHaptic.impactOccurred(intensity: 0.6)
    }

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
    /// The live dictation transcript shown in the strip (left of the mic) while
    /// recording — newest words bright next to the mic, older words dim + truncated
    /// off the left, a caret trailing. Display-only; nothing is inserted mid-dictation.
    private let tailLabel = UILabel()
    private var rowsStack: UIStackView!
    private var letterButtons: [KeyButton] = []   // a–z keys, re-titled on shift
    private var shiftButton: KeyButton?
    private var topMicButton: KeyButton?
    private var built = false

    // Key-press preview balloon (the character pop-up everyone expects).
    private let keyPreview = UIView()
    private let keyPreviewLabel = UILabel()
    private var keyPreviewHideTimer: Timer?

    // Long-press accent callout (é/ñ/ü + alternate punctuation), Apple-style: hold a key
    // to reveal a row of variants, slide to the one you want, lift to insert it.
    private let accentCallout = UIView()
    private var accentItemLabels: [UILabel] = []
    private var accentValues: [String] = []   // strings each item inserts, already cased
    private var accentBaseChar = ""           // the base char inserted on touch-down (to replace)
    private var accentSelected = 0            // index of the highlighted item (0 == base)
    private let accentHaptic = UISelectionFeedbackGenerator()

    /// Alternate characters revealed by long-pressing a key. Letters map to their accented
    /// forms; a handful of punctuation/symbol keys map to related marks — matching what the
    /// stock iOS keyboard offers. Keys are lowercase bases; case is applied at insert time.
    private static let accentMap: [String: [String]] = [
        // Letters
        "a": ["à", "á", "â", "ä", "æ", "ã", "å", "ā"],
        "c": ["ç", "ć", "č"],
        "e": ["è", "é", "ê", "ë", "ē", "ė", "ę"],
        "i": ["î", "ï", "í", "ī", "į", "ì"],
        "l": ["ł"],
        "n": ["ñ", "ń"],
        "o": ["ô", "ö", "ò", "ó", "œ", "ø", "ō", "õ"],
        "s": ["ß", "ś", "š"],
        "u": ["û", "ü", "ù", "ú", "ū"],
        "y": ["ÿ"],
        "z": ["ž", "ź", "ż"],
        // Punctuation & symbols
        "-": ["–", "—", "•"],
        "/": ["\\"],
        "$": ["€", "£", "¥", "₩", "₹", "¢"],
        "&": ["§"],
        "\"": ["\u{201C}", "\u{201D}", "\u{201E}", "«", "»"],
        "'": ["\u{2018}", "\u{2019}", "`"],
        ".": ["…"],
        "?": ["¿"],
        "!": ["¡"],
        "%": ["‰"],
        "=": ["≠", "≈"],
    ]

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
        registerFlowResultObserver()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
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
        autoInsertIfReturned()
        loadLearnedWords()
        // Reflect the LIVE flow state instead of forcing idle — during a long
        // dictation the user may switch fields / the keyboard may relaunch, and an
        // idle-looking mic invited a tap that actually STOPPED the live recording.
        if flowSessionAlive {
            switch groupString("kbd_flow_status") ?? "" {
            case "listening": flowMicState = .listening
            case "processing": flowMicState = .processing
            default: flowMicState = .idle
            }
        } else {
            flowMicState = .idle
        }
        applyMicAppearance()
        // Also resume the countdown line: the app posts "listening" only once per
        // utterance, so a mid-dictation relaunch/field-switch never gets a fresh ping —
        // rebuild the bar from flow_session_deadline_ts. Deferred so layout (and thus
        // view.bounds.width) is resolved before the fill animation is computed.
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if self.flowMicState == .listening { self.startCountdownBar() } else { self.hideCountdownBar() }
        }
        updateSuggestions()
        updateShiftForContext()
    }

    /// Report to the app (via the App Group) that the keyboard has run and whether
    /// it currently has Full Access — powers the guided setup screen's live checks.
    private func recordKeyboardState() {
        store?.set("true", forKey: "kbd_installed")
        store?.set(hasFullAccess ? "true" : "false", forKey: "kbd_full_access")
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

        // Thin dictation-countdown line: fills left→right over ~45s while recording,
        // then the mic auto-stops (synced to flow_session_deadline_ts).
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

        // Accent callout (shares the balloon look; laid out on demand).
        accentCallout.layer.cornerRadius = 10
        accentCallout.layer.shadowColor = UIColor.black.cgColor
        accentCallout.layer.shadowOpacity = 0.3
        accentCallout.layer.shadowRadius = 6
        accentCallout.layer.shadowOffset = CGSize(width: 0, height: 2)
        accentCallout.isHidden = true
        accentCallout.isUserInteractionEnabled = false
        view.addSubview(accentCallout)

        // Live tail-line: right-aligned so the newest words sit next to the mic, and
        // head-truncated so older words slide off the left as you keep talking.
        tailLabel.textAlignment = .right
        tailLabel.lineBreakMode = .byTruncatingHead
        tailLabel.font = .systemFont(ofSize: 15)
        tailLabel.isAccessibilityElement = true
        tailLabel.accessibilityLabel = "Live transcript"

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
        // The mic hops to the app / uses the network, which a keyboard extension can only
        // do with "Allow Full Access". Without it the mic would just sit dead — so say so
        // clearly (the user shouldn't have to guess why nothing happens).
        if !hasFullAccess {
            suggestionsStack.addArrangedSubview(fullAccessHint())
            return
        }
        let title: String
        switch flowMicState {
        case .listening:  installTailLine(); return   // live transcript takes over the strip
        case .processing: title = "✨ Working on your words…"
        case .idle:
            let status = groupString("kbd_flow_status") ?? ""
            if status.hasPrefix("error") {
                // Friendly info line, auto-clears after a few seconds.
                let detail = status.replacingOccurrences(of: "error: ", with: "")
                title = "💬 \(detail)"
                errorClearTimer?.invalidate()
                errorClearTimer = Timer.scheduledTimer(withTimeInterval: 3.5, repeats: false) { [weak self] _ in
                    // Only clear if an error is STILL the live status — the user may
                    // have retried ("listening"/"processing"), and wiping that broke
                    // the status-keyed delivery + the toggle-ack handshake.
                    if (self?.groupString("kbd_flow_status") ?? "").hasPrefix("error") {
                        self?.store?.set("", forKey: "kbd_flow_status")
                    }
                    self?.updateSuggestions()
                }
            } else {
                title = "🎙  Tap the mic and just speak"
            }
        }
        let hint = suggestionButton(title: title, faint: flowMicState == .idle)
        hint.addAction(UIAction { [weak self] _ in self?.micTapped() }, for: .touchUpInside)
        suggestionsStack.addArrangedSubview(hint)
    }

    // MARK: - Live transcript tail-line

    /// Put the live transcript into the strip (replacing predictions while recording).
    private func installTailLine() {
        suggestionsStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        tailLabel.attributedText = tailAttributed(groupString("flow_partial") ?? "")
        suggestionsStack.addArrangedSubview(tailLabel)
    }

    /// App pushed a new partial transcript → refresh the tail-line (only while listening).
    @objc private func flowPartialChanged() {
        guard flowMicState == .listening else { return }
        if tailLabel.superview == nil { installTailLine(); return }
        tailLabel.attributedText = tailAttributed(groupString("flow_partial") ?? "")
    }

    /// Newest word bright, everything before it dim (reads as "trailing off"), a brand
    /// caret to signal it's live. Empty → a gentle listening placeholder.
    private func tailAttributed(_ raw: String) -> NSAttributedString {
        let font = UIFont.systemFont(ofSize: 15)
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty {
            return NSAttributedString(string: "● Listening…", attributes: [.foregroundColor: faintInk, .font: font])
        }
        let out = NSMutableAttributedString()
        if let sp = text.range(of: " ", options: .backwards) {
            out.append(NSAttributedString(string: String(text[..<sp.upperBound]), attributes: [.foregroundColor: faintInk, .font: font]))
            out.append(NSAttributedString(string: String(text[sp.upperBound...]), attributes: [.foregroundColor: inkColor, .font: font]))
        } else {
            out.append(NSAttributedString(string: text, attributes: [.foregroundColor: inkColor, .font: font]))
        }
        out.append(NSAttributedString(string: " ▏", attributes: [.foregroundColor: brand, .font: font]))
        return out
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

    /// A clear two-line prompt shown in the strip when the keyboard lacks Full Access —
    /// the mic needs it, so tell the user exactly where to turn it on (never sit silent).
    private func fullAccessHint() -> UIButton {
        let b = UIButton(type: .system)
        b.setTitle("⚠️  Turn on “Allow Full Access” to use the mic\nSettings ▸ General ▸ Keyboard ▸ Keyboards ▸ VibeFlow", for: .normal)
        b.setTitleColor(inkColor, for: .normal)
        b.titleLabel?.numberOfLines = 2
        b.titleLabel?.textAlignment = .center
        b.titleLabel?.lineBreakMode = .byTruncatingTail
        b.titleLabel?.font = .systemFont(ofSize: 11, weight: .medium)
        b.titleLabel?.adjustsFontSizeToFitWidth = true
        b.titleLabel?.minimumScaleFactor = 0.75
        b.addAction(UIAction { [weak self] _ in self?.updateSuggestions() }, for: .touchUpInside)
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
        // Long-press → accent callout, for any key that has alternates. The base char is
        // still inserted on touch-down (fast typing); a completed slide replaces it.
        if Self.accentMap[base.lowercased()] != nil {
            b.accessibilityIdentifier = base       // so the gesture can recover the base
            let lp = UILongPressGestureRecognizer(target: self, action: #selector(handleAccentLongPress(_:)))
            lp.minimumPressDuration = 0.28
            b.addGestureRecognizer(lp)
        }
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

    // MARK: - Accent callout (long-press for é / ñ / ü …)

    /// Uppercase a variant only when the result stays a single character, so shift-holding
    /// "s" → "Š" works but never turns ß into "SS".
    private func casedVariant(_ v: String, upper: Bool) -> String {
        guard upper else { return v }
        let u = v.uppercased()
        return u.count == v.count ? u : v
    }

    @objc private func handleAccentLongPress(_ g: UILongPressGestureRecognizer) {
        guard let key = g.view as? KeyButton, let base = key.accessibilityIdentifier else { return }
        switch g.state {
        case .began:
            showAccentCallout(over: key, base: base)
        case .changed:
            guard !accentCallout.isHidden else { return }
            updateAccentSelection(g.location(in: view))
        case .ended:
            commitAccentSelection()
        default:
            hideAccentCallout()
        }
    }

    private func showAccentCallout(over key: KeyButton, base: String) {
        guard let variants = Self.accentMap[base.lowercased()] else { return }
        keyPreview.isHidden = true

        // Match the case of the char just inserted on touch-down.
        let upper = textDocumentProxy.documentContextBeforeInput?.last?.isUppercase ?? false
        accentBaseChar = casedVariant(base, upper: upper)
        accentValues = ([base] + variants).map { casedVariant($0, upper: upper) }

        accentItemLabels.forEach { $0.removeFromSuperview() }
        accentItemLabels.removeAll()

        let itemW: CGFloat = 40, itemH: CGFloat = 44, pad: CGFloat = 5
        let totalW = itemW * CGFloat(accentValues.count) + pad * 2
        let calloutH = itemH + pad * 2
        for (i, v) in accentValues.enumerated() {
            let lbl = UILabel(frame: CGRect(x: pad + CGFloat(i) * itemW, y: pad, width: itemW, height: itemH))
            lbl.textAlignment = .center
            lbl.font = .systemFont(ofSize: 24)
            lbl.text = v
            lbl.layer.cornerRadius = 6
            lbl.layer.masksToBounds = true
            accentCallout.addSubview(lbl)
            accentItemLabels.append(lbl)
        }

        // Sit the base item over the key, then clamp the whole row inside the keyboard.
        let keyFrame = key.convert(key.bounds, to: view)
        var x = keyFrame.midX - (pad + itemW / 2)
        x = min(max(2, x), max(2, view.bounds.width - totalW - 2))
        let y = max(2, keyFrame.minY - calloutH - 4)
        accentCallout.frame = CGRect(x: x, y: y, width: totalW, height: calloutH)
        accentCallout.backgroundColor = keyColor
        accentCallout.isHidden = false
        view.bringSubviewToFront(accentCallout)

        accentSelected = 0
        styleAccentItems()
        accentHaptic.prepare()
        keyHaptic.impactOccurred(intensity: 0.7)
    }

    private func updateAccentSelection(_ pointInView: CGPoint) {
        guard !accentItemLabels.isEmpty else { return }
        var best = 0
        var bestDist = CGFloat.greatestFiniteMagnitude
        for (i, lbl) in accentItemLabels.enumerated() {
            let f = accentCallout.convert(lbl.frame, to: view)
            let d = abs(f.midX - pointInView.x)
            if d < bestDist { bestDist = d; best = i }
        }
        if best != accentSelected {
            accentSelected = best
            styleAccentItems()
            accentHaptic.selectionChanged()
        }
    }

    private func styleAccentItems() {
        for (i, lbl) in accentItemLabels.enumerated() {
            let on = (i == accentSelected)
            lbl.backgroundColor = on ? brand : .clear
            lbl.textColor = on ? .white : inkColor
        }
    }

    private func commitAccentSelection() {
        defer { hideAccentCallout() }
        // Index 0 is the base char, already inserted on touch-down — nothing to do.
        guard accentSelected > 0, accentSelected < accentValues.count else { return }
        // Replace the base char with the chosen variant.
        if let last = textDocumentProxy.documentContextBeforeInput?.last,
           String(last).lowercased() == accentBaseChar.lowercased() {
            textDocumentProxy.deleteBackward()
        }
        textDocumentProxy.insertText(accentValues[accentSelected])
        keyHaptic.impactOccurred(intensity: 0.6)
        scheduleSuggestions()
    }

    private func hideAccentCallout() {
        accentCallout.isHidden = true
        accentItemLabels.forEach { $0.removeFromSuperview() }
        accentItemLabels.removeAll()
        accentValues.removeAll()
        accentSelected = 0
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
        keyFeedback()
        textDocumentProxy.insertText(shift == .off ? base : base.uppercased())
        if shift == .on {
            shift = .off                   // consume one-shot shift…
            applyShiftAppearance()         // …and re-title the keys immediately
        }
        updateShiftForContext()
        scheduleSuggestions()
    }

    @objc private func shiftTapped() {
        keyFeedback()
        let now = Date()
        if now.timeIntervalSince(lastShiftTap) < 0.3 { shift = .locked }
        else { shift = (shift == .off) ? .on : .off }
        lastShiftTap = now
        applyShiftAppearance()
    }

    private func spaceTapped() {
        keyFeedback()
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
        keyFeedback()
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
        keyFeedback()
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
        guard shift != .locked, page == .letters else { return }
        let before = textDocumentProxy.documentContextBeforeInput ?? ""
        let cap = before.isEmpty || before.hasSuffix("\n")
            || before.hasSuffix(". ") || before.hasSuffix("! ") || before.hasSuffix("? ")
        let want: ShiftState = cap ? .on : .off
        if want != shift { shift = want; applyShiftAppearance() }
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
        // No Full Access → the mic can't hop to the app or reach the network, so it would
        // just sit dead. Surface the "enable Full Access" prompt instead of failing silently.
        guard hasFullAccess else { updateSuggestions(); return }
        // Flow Session alive (Dynamic Island showing)? Record right here — no hop.
        if flowSessionAlive {
            let wasIdle = flowMicState == .idle
            flowMicState = wasIdle ? .listening : .processing
            applyMicAppearance()
            CFNotificationCenterPostNotification(
                CFNotificationCenterGetDarwinNotifyCenter(),
                CFNotificationName(flowToggleName as CFString),
                nil, nil, true
            )
            // Failsafe: the island can outlive a force-quit app (zombie pill). If the
            // app doesn't ack a record-start quickly, it's dead — hop to restart it.
            if wasIdle {
                toggleAckTimer?.invalidate()
                toggleAckTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: false) { [weak self] _ in
                    guard let self, self.flowMicState == .listening else { return }
                    if self.groupString("kbd_flow_status") != "listening" {
                        self.flowMicState = .idle
                        self.applyMicAppearance()
                        self.armed = true
                        self.armedSnapshot = self.latest()
                        self.openApp()
                    }
                }
            }
            return
        }
        // Otherwise: the one-time hop that starts the session.
        armed = true
        armedSnapshot = latest()
        openApp()
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
        let before = textDocumentProxy.documentContextBeforeInput ?? ""
        var out = text
        // Continuous dictation arrives in 45s chunks, each capitalized as if it were its
        // own dictation. Re-case the FIRST letter from the real cursor context so the
        // chunks read as one flowing sentence: uppercase only at a genuine sentence start,
        // lowercase when continuing mid-sentence. (Scoped to continuous mode — normal
        // single dictations keep the app's capitalization untouched.)
        if groupString("flow_continuous") == "true", let first = out.first, first.isLetter {
            let trimmed = before.trimmingCharacters(in: .whitespacesAndNewlines)
            let atSentenceStart = trimmed.isEmpty || (trimmed.last.map { ".!?\n".contains($0) } ?? true)
            let head = atSentenceStart ? first.uppercased() : first.lowercased()
            out = head + String(out.dropFirst())
        }
        if let last = before.last, !last.isWhitespace, !"\n([{\"'".contains(last) {
            textDocumentProxy.insertText(" ")
        }
        textDocumentProxy.insertText(out)
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
        CFNotificationCenterAddObserver(center, observer, { _, observer, _, _, _ in
            guard let observer = observer else { return }
            let kb = Unmanaged<KeyboardViewController>.fromOpaque(observer).takeUnretainedValue()
            DispatchQueue.main.async { kb.flowPartialChanged() }
        }, flowPartialName as CFString, nil, .deliverImmediately)
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
        if flowMicState == .listening {
            startCountdownBar()
            installTailLine()              // the live transcript takes over the strip
        } else {
            hideCountdownBar()
            updateSuggestions()            // strip returns to predictions/recents/processing
        }
        if status.hasPrefix("error"), currentWord().isEmpty {
            showIdleSuggestions()          // surface the error text in the strip
        }
    }

    /// Show the countdown line and fill it to the app's ~45s deadline; the app auto-stops
    /// the mic at that same moment, so the line reaching the end == recording ending.
    private func startCountdownBar() {
        guard let bar = capBar, let w = capBarWidth else { return }
        let total = 45.0
        let deadlineMs = Double(groupString("flow_session_deadline_ts") ?? "") ?? 0
        let remaining = deadlineMs > 0 ? (deadlineMs / 1000 - Date().timeIntervalSince1970) : total
        guard remaining > 0.5 else { hideCountdownBar(); return }
        bar.layer.removeAllAnimations()
        bar.isHidden = false
        let elapsedFrac = CGFloat(max(0, min(1, (total - remaining) / total)))
        view.layoutIfNeeded()
        w.constant = view.bounds.width * elapsedFrac
        view.layoutIfNeeded()
        UIView.animate(withDuration: remaining, delay: 0, options: [.curveLinear, .beginFromCurrentState]) {
            w.constant = self.view.bounds.width
            self.view.layoutIfNeeded()
        }
    }

    private func hideCountdownBar() {
        guard let bar = capBar, let w = capBarWidth else { return }
        bar.layer.removeAllAnimations()
        w.constant = 0
        bar.isHidden = true
        view.layoutIfNeeded()
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
