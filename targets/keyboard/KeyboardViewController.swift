import UIKit

/// The VibeFlow keyboard — a full QWERTY keyboard (styled like the system keyboard)
/// with two VibeFlow twists:
///   • the space bar reads **VibeFlow**, and
///   • a brand-coloured **mic** key that starts voice dictation.
///
/// iOS forbids microphone access inside a keyboard extension, so the mic can't
/// record here. Instead it opens the VibeFlow app to capture your voice; when you
/// switch back to this text field, the keyboard auto-types the dictation you just
/// made (the app writes it to the shared App Group). A suggestions strip also
/// surfaces your recent dictations for one-tap insertion.
final class KeyboardViewController: UIInputViewController {

    // MARK: App Group hand-off
    private let appGroup = "group.com.vibeflow.mobile"
    private let recordURL = "vibeflow://record?from=keyboard"
    private lazy var store = UserDefaults(suiteName: appGroup)

    // MARK: Brand
    private let brand = UIColor(red: 0.486, green: 0.361, blue: 1.0, alpha: 1) // #7C5CFF

    // MARK: State
    private enum ShiftState { case off, on, locked }
    private enum Page { case letters, numbers, symbols }
    private var shift: ShiftState = .on
    private var page: Page = .letters

    // Auto-insert-on-return: when the mic is tapped we snapshot the current latest
    // dictation; on returning, if it changed, we type the new one.
    private var armed = false
    private var armedSnapshot = ""

    // Double-tap / double-space tracking
    private var lastShiftTap: Date = .distantPast
    private var lastSpaceTap: Date = .distantPast
    private var backspaceTimer: Timer?

    // MARK: Views
    private var suggestionsStack: UIStackView!
    private var rowsStack: UIStackView!

    // MARK: - Appearance-aware colors
    private var isDark: Bool { textDocumentProxy.keyboardAppearance == .dark || traitCollection.userInterfaceStyle == .dark }
    private var kbBackground: UIColor { isDark ? UIColor(white: 0.09, alpha: 1) : UIColor(red: 0.82, green: 0.84, blue: 0.86, alpha: 1) }
    private var keyColor: UIColor { isDark ? UIColor(white: 0.24, alpha: 1) : .white }
    private var specialKeyColor: UIColor { isDark ? UIColor(white: 0.16, alpha: 1) : UIColor(red: 0.67, green: 0.70, blue: 0.74, alpha: 1) }
    private var inkColor: UIColor { isDark ? .white : .black }
    private var faintInk: UIColor { isDark ? UIColor(white: 0.6, alpha: 1) : UIColor(white: 0.35, alpha: 1) }

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.heightAnchor.constraint(equalToConstant: 268).isActive = true
        buildLayout()
        rebuildKeys()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        autoInsertIfReturned()
        reloadSuggestions()
        updateShiftForContext()
        rebuildKeys()
    }

    override func traitCollectionDidChange(_ previous: UITraitCollection?) {
        super.traitCollectionDidChange(previous)
        view.backgroundColor = kbBackground
        reloadSuggestions()
        rebuildKeys()
    }

    // MARK: - Layout scaffold

    private func buildLayout() {
        view.backgroundColor = kbBackground

        suggestionsStack = UIStackView()
        suggestionsStack.axis = .horizontal
        suggestionsStack.distribution = .fillEqually
        suggestionsStack.alignment = .fill
        suggestionsStack.spacing = 0

        rowsStack = UIStackView()
        rowsStack.axis = .vertical
        rowsStack.distribution = .fillEqually
        rowsStack.spacing = 10

        let root = UIStackView(arrangedSubviews: [suggestionsStack, rowsStack])
        root.axis = .vertical
        root.spacing = 6
        root.translatesAutoresizingMaskIntoConstraints = false
        root.isLayoutMarginsRelativeArrangement = true
        root.layoutMargins = UIEdgeInsets(top: 8, left: 4, bottom: 4, right: 4)
        view.addSubview(root)

        NSLayoutConstraint.activate([
            root.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            root.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            root.topAnchor.constraint(equalTo: view.topAnchor),
            root.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            suggestionsStack.heightAnchor.constraint(equalToConstant: 42),
        ])
    }

    // MARK: - Suggestions strip (VibeFlow recents / latest)

    private func reloadSuggestions() {
        suggestionsStack.arrangedSubviews.forEach { $0.removeFromSuperview() }

        let recents = history().prefix(3).map { $0.text }
        if recents.isEmpty {
            let hint = suggestionButton(title: "🎙  Tap the mic to dictate", faint: true)
            hint.addAction(UIAction { [weak self] _ in self?.micTapped() }, for: .touchUpInside)
            suggestionsStack.addArrangedSubview(hint)
            return
        }

        for (i, text) in recents.enumerated() {
            if i > 0 { suggestionsStack.addArrangedSubview(divider()) }
            let oneLine = text.replacingOccurrences(of: "\n", with: " ")
            let b = suggestionButton(title: String(oneLine.prefix(22)), faint: false)
            b.addAction(UIAction { [weak self] _ in self?.insert(text) }, for: .touchUpInside)
            suggestionsStack.addArrangedSubview(b)
        }
    }

    private func suggestionButton(title: String, faint: Bool) -> UIButton {
        let b = UIButton(type: .system)
        b.setTitle(title, for: .normal)
        b.setTitleColor(faint ? faintInk : inkColor, for: .normal)
        b.titleLabel?.font = .systemFont(ofSize: 15, weight: .regular)
        b.titleLabel?.adjustsFontSizeToFitWidth = true
        b.titleLabel?.minimumScaleFactor = 0.8
        return b
    }

    private func divider() -> UIView {
        let v = UIView()
        v.backgroundColor = faintInk.withAlphaComponent(0.35)
        v.widthAnchor.constraint(equalToConstant: 1.0 / UIScreen.main.scale).isActive = true
        return v
    }

    // MARK: - Keyboard rows

    private func rebuildKeys() {
        rowsStack.arrangedSubviews.forEach { $0.removeFromSuperview() }

        switch page {
        case .letters:
            let top = shifted(["q","w","e","r","t","y","u","i","o","p"])
            let mid = shifted(["a","s","d","f","g","h","j","k","l"])
            let bot = shifted(["z","x","c","v","b","n","m"])
            rowsStack.addArrangedSubview(letterRow(top))
            rowsStack.addArrangedSubview(inset(letterRow(mid), by: 18))
            rowsStack.addArrangedSubview(bottomLetterRow(bot))
        case .numbers:
            rowsStack.addArrangedSubview(letterRow(["1","2","3","4","5","6","7","8","9","0"]))
            rowsStack.addArrangedSubview(letterRow(["-","/",":",";","(",")","$","&","@","\""]))
            rowsStack.addArrangedSubview(symbolBottomRow(toggleTitle: "#+=", keys: [".",",","?","!","'"]) { [weak self] in self?.page = .symbols; self?.rebuildKeys() })
        case .symbols:
            rowsStack.addArrangedSubview(letterRow(["[","]","{","}","#","%","^","*","+","="]))
            rowsStack.addArrangedSubview(letterRow(["_","\\","|","~","<",">","€","£","¥","•"]))
            rowsStack.addArrangedSubview(symbolBottomRow(toggleTitle: "123", keys: [".",",","?","!","'"]) { [weak self] in self?.page = .numbers; self?.rebuildKeys() })
        }
        rowsStack.addArrangedSubview(functionRow())
    }

    private func shifted(_ letters: [String]) -> [String] {
        shift == .off ? letters : letters.map { $0.uppercased() }
    }

    /// A row of equal-width character keys.
    private func letterRow(_ keys: [String]) -> UIStackView {
        let row = UIStackView()
        row.axis = .horizontal
        row.distribution = .fillEqually
        row.spacing = 6
        for k in keys { row.addArrangedSubview(charKey(k)) }
        return row
    }

    /// Row 3 of letters: shift + letters + backspace.
    private func bottomLetterRow(_ keys: [String]) -> UIStackView {
        let row = UIStackView()
        row.axis = .horizontal
        row.spacing = 6
        row.distribution = .fill

        let shiftKey = specialKey(systemImage: shift == .locked ? "capslock.fill" : (shift == .on ? "shift.fill" : "shift"))
        shiftKey.addAction(UIAction { [weak self] _ in self?.shiftTapped() }, for: .touchUpInside)

        let letters = UIStackView()
        letters.axis = .horizontal
        letters.distribution = .fillEqually
        letters.spacing = 6
        for k in keys { letters.addArrangedSubview(charKey(k)) }

        let back = specialKey(systemImage: "delete.left")
        back.addTarget(self, action: #selector(backspaceDown), for: .touchDown)
        back.addTarget(self, action: #selector(backspaceUp), for: [.touchUpInside, .touchUpOutside, .touchCancel])

        row.addArrangedSubview(shiftKey)
        row.addArrangedSubview(letters)
        row.addArrangedSubview(back)
        shiftKey.widthAnchor.constraint(equalTo: back.widthAnchor).isActive = true
        shiftKey.widthAnchor.constraint(equalTo: row.widthAnchor, multiplier: 0.13).isActive = true
        return row
    }

    /// Row 3 of numbers/symbols: page-toggle + punctuation + backspace.
    private func symbolBottomRow(toggleTitle: String, keys: [String], toggle: @escaping () -> Void) -> UIStackView {
        let row = UIStackView()
        row.axis = .horizontal
        row.spacing = 6
        row.distribution = .fill

        let toggleKey = specialKey(title: toggleTitle)
        toggleKey.addAction(UIAction { _ in toggle() }, for: .touchUpInside)

        let mid = UIStackView()
        mid.axis = .horizontal
        mid.distribution = .fillEqually
        mid.spacing = 6
        for k in keys { mid.addArrangedSubview(charKey(k)) }

        let back = specialKey(systemImage: "delete.left")
        back.addTarget(self, action: #selector(backspaceDown), for: .touchDown)
        back.addTarget(self, action: #selector(backspaceUp), for: [.touchUpInside, .touchUpOutside, .touchCancel])

        row.addArrangedSubview(toggleKey)
        row.addArrangedSubview(mid)
        row.addArrangedSubview(back)
        toggleKey.widthAnchor.constraint(equalTo: back.widthAnchor).isActive = true
        toggleKey.widthAnchor.constraint(equalTo: row.widthAnchor, multiplier: 0.13).isActive = true
        return row
    }

    /// Bottom function row: [123/ABC] [🌐] [ space "VibeFlow" ] [🎤] [return].
    private func functionRow() -> UIStackView {
        let row = UIStackView()
        row.axis = .horizontal
        row.spacing = 6
        row.distribution = .fill

        let modeTitle = page == .letters ? "123" : "ABC"
        let modeKey = specialKey(title: modeTitle)
        modeKey.addAction(UIAction { [weak self] _ in
            self?.page = (self?.page == .letters ? .numbers : .letters)
            self?.rebuildKeys()
        }, for: .touchUpInside)

        let globe = specialKey(systemImage: "globe")
        globe.addTarget(self, action: #selector(handleInputModeList(from:with:)), for: .allTouchEvents)

        let space = charKey("VibeFlow")
        space.titleLabel?.font = .systemFont(ofSize: 15, weight: .regular)
        space.setTitleColor(faintInk, for: .normal)
        // override the default char action with space handling
        space.removeTarget(nil, action: nil, for: .allEvents)
        space.addAction(UIAction { [weak self] _ in self?.spaceTapped() }, for: .touchUpInside)

        let mic = specialKey(systemImage: "mic.fill")
        mic.backgroundColor = brand
        mic.tintColor = .white
        mic.addAction(UIAction { [weak self] _ in self?.micTapped() }, for: .touchUpInside)

        let ret = specialKey(title: "return")
        ret.titleLabel?.font = .systemFont(ofSize: 16, weight: .regular)
        ret.addAction(UIAction { [weak self] _ in self?.insert("\n") }, for: .touchUpInside)

        row.addArrangedSubview(modeKey)
        row.addArrangedSubview(globe)
        row.addArrangedSubview(space)
        row.addArrangedSubview(mic)
        row.addArrangedSubview(ret)

        // widths: space is widest; the rest share a base width
        modeKey.widthAnchor.constraint(equalTo: row.widthAnchor, multiplier: 0.11).isActive = true
        globe.widthAnchor.constraint(equalTo: modeKey.widthAnchor).isActive = true
        mic.widthAnchor.constraint(equalTo: modeKey.widthAnchor).isActive = true
        ret.widthAnchor.constraint(equalTo: row.widthAnchor, multiplier: 0.18).isActive = true
        return row
    }

    // MARK: - Key factories

    private func charKey(_ title: String) -> UIButton {
        let b = baseKey()
        b.setTitle(title, for: .normal)
        b.setTitleColor(inkColor, for: .normal)
        b.titleLabel?.font = .systemFont(ofSize: 22, weight: .regular)
        b.backgroundColor = keyColor
        if title.count == 1 {
            b.addAction(UIAction { [weak self] _ in self?.charTapped(title) }, for: .touchUpInside)
        }
        return b
    }

    private func specialKey(title: String? = nil, systemImage: String? = nil) -> UIButton {
        let b = baseKey()
        if let title { b.setTitle(title, for: .normal); b.setTitleColor(inkColor, for: .normal); b.titleLabel?.font = .systemFont(ofSize: 16, weight: .regular) }
        if let systemImage { b.setImage(UIImage(systemName: systemImage), for: .normal); b.tintColor = inkColor }
        b.backgroundColor = specialKeyColor
        return b
    }

    private func baseKey() -> UIButton {
        let b = UIButton(type: .system)
        b.layer.cornerRadius = 6
        b.layer.masksToBounds = true
        b.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        return b
    }

    /// Wrap a row with horizontal padding (used to inset the A–L row like iOS).
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

    // MARK: - Key actions

    private func charTapped(_ ch: String) {
        insert(ch)
        if shift == .on { shift = .off; rebuildKeys() } // one-shot shift
    }

    private func shiftTapped() {
        let now = Date()
        if now.timeIntervalSince(lastShiftTap) < 0.3 {
            shift = .locked
        } else {
            shift = (shift == .off) ? .on : .off
        }
        lastShiftTap = now
        rebuildKeys()
    }

    private func spaceTapped() {
        let now = Date()
        // double-space → ". " (iOS behaviour)
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
    }

    private func insert(_ text: String) {
        textDocumentProxy.insertText(text)
        updateShiftForContext()
    }

    /// Auto-capitalise at the start of input and after sentence enders.
    private func updateShiftForContext() {
        guard shift != .locked else { return }
        let before = textDocumentProxy.documentContextBeforeInput ?? ""
        let trimmed = before
        let shouldCap: Bool
        if trimmed.isEmpty { shouldCap = true }
        else if trimmed.hasSuffix("\n") { shouldCap = true }
        else if trimmed.hasSuffix(". ") || trimmed.hasSuffix("! ") || trimmed.hasSuffix("? ") { shouldCap = true }
        else { shouldCap = false }
        let newShift: ShiftState = shouldCap ? .on : .off
        if newShift != shift { shift = newShift; rebuildKeys() }
    }

    // MARK: - Mic → dictation flow

    private func micTapped() {
        armed = true
        armedSnapshot = latest()
        openApp()
    }

    /// When we come back from the app after a mic tap, type the new dictation.
    private func autoInsertIfReturned() {
        guard armed else { return }
        let current = latest()
        if !current.isEmpty && current != armedSnapshot {
            textDocumentProxy.insertText(current)
        }
        armed = false
    }

    /// Extensions can't call openURL directly — walk the responder chain.
    private func openApp() {
        guard let url = URL(string: recordURL) else { return }
        var responder: UIResponder? = self
        let selector = sel_registerName("openURL:")
        while let r = responder {
            if r.responds(to: selector) { r.perform(selector, with: url); return }
            responder = r.next
        }
    }

    // MARK: - App Group reads

    private struct Dictation: Decodable { let id: Double; let text: String; var pinned: Bool? }

    private func latest() -> String { store?.string(forKey: "latest_dictation") ?? "" }

    private func history() -> [Dictation] {
        guard let json = store?.string(forKey: "history_json"),
              let data = json.data(using: .utf8),
              let list = try? JSONDecoder().decode([Dictation].self, from: data) else { return [] }
        return list.sorted { $0.id > $1.id }
    }
}
