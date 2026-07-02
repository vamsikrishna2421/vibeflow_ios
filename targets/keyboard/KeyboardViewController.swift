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
    private let appGroup = "group.com.vibeflow.mobile"
    private let recordURL = "vibeflow://record?from=keyboard"
    private lazy var store = UserDefaults(suiteName: appGroup)

    // MARK: Flow Session (Wispr-style, zero-hop dictation)
    // While the app's background session is alive (Dynamic Island showing), the mic
    // key doesn't open the app — it toggles recording over Darwin IPC and the app
    // pushes the result back for immediate insertion.
    private let flowToggleName = "com.vibeflow.flow.toggle"
    private let flowResultName = "com.vibeflow.flow.result"
    private var flowListening = false
    private var lastFlowInserted = ""

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
    private enum Page { case letters, numbers, symbols }
    private var shift: ShiftState = .on
    private var page: Page = .letters

    private var armed = false
    private var armedSnapshot = ""

    private var lastShiftTap: Date = .distantPast
    private var lastSpaceTap: Date = .distantPast
    private var backspaceTimer: Timer?

    // Autocorrect memory: words we've corrected once, and words the user re-typed
    // afterwards (so we stop "fighting" them — like the system keyboard).
    private var correctedOnce: Set<String> = []
    private var refusedCorrections: Set<String> = []

    // Romanized-Telugu/Hindi + user words the keyboard should treat as valid (never
    // autocorrect away) and offer as completions — e.g. "avunu", "kadu", "sare".
    private var learnedWords: [String] = []

    // MARK: Views / tracking
    private var suggestionsStack: UIStackView!
    private var rowsStack: UIStackView!
    private var letterButtons: [KeyButton] = []   // a–z keys, re-titled on shift
    private var shiftButton: KeyButton?
    private var topMicButton: KeyButton?
    private var built = false

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
        registerFlowResultObserver()
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
        flowListening = false          // never carry a stale "recording" state
        applyMicAppearance()
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

        let root = UIStackView(arrangedSubviews: [topBar, rowsStack])
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
        updateSuggestions()
    }

    // MARK: - Suggestions strip (typing predictions ↔ dictation recents)

    /// While a word is being typed, show spell/prediction suggestions; otherwise
    /// fall back to recent dictations (or the mic hint).
    private func updateSuggestions() {
        let word = currentWord()
        guard !word.isEmpty else { showIdleSuggestions(); return }
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

        // Romanized-Telugu/Hindi + user words that start with what's typed come first.
        let learnedMatches = learnedWords.filter { $0.lowercased().hasPrefix(lw) && $0.lowercased() != lw }
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

    private func showIdleSuggestions() {
        suggestionsStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        let recents = history().prefix(3).map { $0.text }
        if recents.isEmpty {
            let hint = suggestionButton(title: "🎙  Tap the mic to dictate", faint: true)
            hint.addAction(UIAction { [weak self] _ in self?.micTapped() }, for: .touchUpInside)
            suggestionsStack.addArrangedSubview(hint)
            return
        }
        for (_, text) in recents.enumerated() {
            let oneLine = text.replacingOccurrences(of: "\n", with: " ")
            let b = suggestionButton(title: String(oneLine.prefix(20)), faint: false)
            b.addAction(UIAction { [weak self] _ in self?.insert(text) }, for: .touchUpInside)
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

        let modeKey = specialKey(title: page == .letters ? "123" : "ABC")
        modeKey.addAction(UIAction { [weak self] _ in
            self?.page = (self?.page == .letters ? .numbers : .letters)
            self?.rebuildKeys()
        }, for: .touchUpInside)

        let globe = specialKey(systemImage: "globe")
        globe.addTarget(self, action: #selector(handleInputModeList(from:with:)), for: .allTouchEvents)

        let space = specialKey(title: "VibeFlow")
        space.baseColor = keyColor
        space.pressedColor = keyPressed
        space.setTitleColor(faintInk, for: .normal)
        space.titleLabel?.font = .systemFont(ofSize: 15)
        space.addAction(UIAction { [weak self] _ in self?.spaceTapped() }, for: .touchUpInside)

        let ret = specialKey(title: "return")
        ret.titleLabel?.font = .systemFont(ofSize: 16)
        ret.addAction(UIAction { [weak self] _ in self?.insert("\n") }, for: .touchUpInside)

        // Bottom row (mic now lives in the top toolbar, Wispr-style): 123 · globe · space · return
        row.addArrangedSubview(modeKey)
        row.addArrangedSubview(globe)
        row.addArrangedSubview(space)
        row.addArrangedSubview(ret)

        modeKey.widthAnchor.constraint(equalTo: row.widthAnchor, multiplier: 0.13).isActive = true
        globe.widthAnchor.constraint(equalTo: modeKey.widthAnchor).isActive = true
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
            b.addAction(UIAction { [weak self] _ in self?.charTapped(base) }, for: .touchDown)
        } else {
            b.addAction(UIAction { [weak self] _ in self?.insert(base) }, for: .touchDown)
        }
        return b
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
        if shift == .on { shift = .off }   // consume one-shot shift
        updateShiftForContext()
        updateSuggestions()
    }

    @objc private func shiftTapped() {
        let now = Date()
        if now.timeIntervalSince(lastShiftTap) < 0.3 { shift = .locked }
        else { shift = (shift == .off) ? .on : .off }
        lastShiftTap = now
        applyShiftAppearance()
    }

    private func spaceTapped() {
        autocorrectCurrentWord()
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
        updateSuggestions()
    }

    /// Conservative autocorrect: if the just-typed word is clearly misspelled and
    /// there's a confident guess, swap it — mirrors the system keyboard's space fix.
    private func autocorrectCurrentWord() {
        let word = currentWord()
        guard word.count >= 3 else { return }
        let key = word.lowercased()
        if refusedCorrections.contains(key) { return }   // user insists on this spelling
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
        updateSuggestions()
    }

    private func insert(_ text: String) {
        textDocumentProxy.insertText(text)
        updateShiftForContext()
        updateSuggestions()
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

    private var flowSessionAlive: Bool { groupString("flow_session_active") == "true" }

    private func micTapped() {
        // Flow Session alive (Dynamic Island showing)? Record right here — no hop.
        if flowSessionAlive {
            flowListening.toggle()
            applyMicAppearance()
            CFNotificationCenterPostNotification(
                CFNotificationCenterGetDarwinNotifyCenter(),
                CFNotificationName(flowToggleName as CFString),
                nil, nil, true
            )
            return
        }
        // Otherwise: the one-time hop that starts the session.
        armed = true
        armedSnapshot = latest()
        openApp()
    }

    /// Mic key turns red while a flow recording is in progress.
    private func applyMicAppearance() {
        guard let mic = topMicButton else { return }
        mic.baseColor = flowListening ? .systemRed : brand
        mic.pressedColor = (flowListening ? UIColor.systemRed : brand).withAlphaComponent(0.75)
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

    /// Darwin "result ready" → insert the fresh dictation right where the user is.
    private func registerFlowResultObserver() {
        let center = CFNotificationCenterGetDarwinNotifyCenter()
        let observer = Unmanaged.passUnretained(self).toOpaque()
        CFNotificationCenterAddObserver(center, observer, { _, observer, _, _, _ in
            guard let observer = observer else { return }
            let kb = Unmanaged<KeyboardViewController>.fromOpaque(observer).takeUnretainedValue()
            DispatchQueue.main.async { kb.insertFlowResult() }
        }, flowResultName as CFString, nil, .deliverImmediately)
    }

    private func insertFlowResult() {
        let text = latest()
        guard !text.isEmpty, text != lastFlowInserted else { return }
        lastFlowInserted = text
        flowListening = false
        applyMicAppearance()
        // Mark consumed so a later viewWillAppear doesn't re-insert the same text.
        if let ts = groupString("latest_dictation_ts") {
            store?.set(ts, forKey: "kbd_inserted_ts")
        }
        smartInsert(text)
        updateSuggestions()
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
        guard let json = groupString("kbd_learned_words"),
              let data = json.data(using: .utf8),
              let list = try? JSONDecoder().decode([String].self, from: data) else { return }
        learnedWords = list
        for w in list where !w.isEmpty { UITextChecker.learnWord(w) }
    }
}
