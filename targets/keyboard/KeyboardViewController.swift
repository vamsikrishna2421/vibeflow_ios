import UIKit

/// The VibeFlow keyboard extension.
///
/// iOS forbids microphone access inside a keyboard extension, so this keyboard
/// never records. Its job is to **insert text the VibeFlow app already captured
/// by voice** and shared through the App Group:
///   • one-tap "Insert latest dictation"
///   • a scrollable list of recent dictations
///   • quick snippets (saved in the app)
///   • a "Dictate in VibeFlow" button that hops to the app to record
///
/// The app records (on-device SFSpeechRecognizer) → runs the text pipeline →
/// writes `latest` / `history` / `snippets` into the App Group → this keyboard
/// reads them and inserts at the cursor via `textDocumentProxy`.
final class KeyboardViewController: UIInputViewController {

    // VibeFlow brand palette (matches the app).
    private let brand = UIColor(red: 0.486, green: 0.361, blue: 1.0, alpha: 1)      // #7C5CFF
    private let surface = UIColor(red: 0.071, green: 0.063, blue: 0.094, alpha: 1)  // #120F18
    private let chipBg = UIColor(white: 0.16, alpha: 1)

    private let appGroup = "group.com.vibeflow.mobile"
    private let appURLScheme = "vibeflow://record"

    private lazy var store = UserDefaults(suiteName: appGroup)
    private var recentsStack: UIStackView!
    private var snippetsStack: UIStackView!

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = surface
        buildUI()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        reload()
    }

    // MARK: - Data (App Group)

    private struct Dictation: Decodable {
        let id: Double
        let text: String
        var pinned: Bool? = false
    }

    private func latest() -> String { store?.string(forKey: "latest_dictation") ?? "" }

    private func history() -> [Dictation] {
        guard let json = store?.string(forKey: "history_json"),
              let data = json.data(using: .utf8),
              let list = try? JSONDecoder().decode([Dictation].self, from: data) else { return [] }
        return list.sorted { ($0.pinned ?? false ? 1 : 0, $0.id) > ($1.pinned ?? false ? 1 : 0, $1.id) }
    }

    /// Snippets shared as a flat [trigger, expansion, trigger, expansion, …] array
    /// (JSON objects don't preserve order; a flat list keeps the app's ordering).
    private func snippets() -> [(String, String)] {
        guard let json = store?.string(forKey: "snippets_json"),
              let data = json.data(using: .utf8),
              let flat = try? JSONDecoder().decode([String].self, from: data) else { return [] }
        var pairs: [(String, String)] = []
        var i = 0
        while i + 1 < flat.count { pairs.append((flat[i], flat[i + 1])); i += 2 }
        return pairs
    }

    // MARK: - UI

    private func buildUI() {
        let header = label("VibeFlow", size: 14, weight: .semibold, color: .white)

        let insertLatest = filledButton("⤵  Insert latest dictation")
        insertLatest.addTarget(self, action: #selector(insertLatestTapped), for: .touchUpInside)

        let dictate = plainButton("🎙  Dictate in VibeFlow")
        dictate.addTarget(self, action: #selector(openAppTapped), for: .touchUpInside)

        recentsStack = verticalStack()
        snippetsStack = verticalStack()

        let recentsTitle = label("RECENT", size: 11, weight: .semibold, color: .lightGray)
        let snippetsTitle = label("SNIPPETS", size: 11, weight: .semibold, color: .lightGray)

        let scrollContent = UIStackView(arrangedSubviews: [
            recentsTitle, recentsStack, snippetsTitle, snippetsStack,
        ])
        scrollContent.axis = .vertical
        scrollContent.spacing = 6
        scrollContent.translatesAutoresizingMaskIntoConstraints = false

        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(scrollContent)

        let nextKb = plainButton("🌐  Switch keyboard")
        nextKb.addTarget(self, action: #selector(handleInputModeList(from:with:)), for: .allTouchEvents)

        let root = UIStackView(arrangedSubviews: [header, insertLatest, dictate, scroll, nextKb])
        root.axis = .vertical
        root.spacing = 10
        root.translatesAutoresizingMaskIntoConstraints = false
        root.isLayoutMarginsRelativeArrangement = true
        root.layoutMargins = UIEdgeInsets(top: 10, left: 12, bottom: 10, right: 12)
        view.addSubview(root)

        NSLayoutConstraint.activate([
            root.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            root.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            root.topAnchor.constraint(equalTo: view.topAnchor),
            root.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            scrollContent.leadingAnchor.constraint(equalTo: scroll.leadingAnchor),
            scrollContent.trailingAnchor.constraint(equalTo: scroll.trailingAnchor),
            scrollContent.topAnchor.constraint(equalTo: scroll.topAnchor),
            scrollContent.bottomAnchor.constraint(equalTo: scroll.bottomAnchor),
            scrollContent.widthAnchor.constraint(equalTo: scroll.widthAnchor),
            scroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 120),
        ])
        view.heightAnchor.constraint(equalToConstant: 300).isActive = true
    }

    private func reload() {
        recentsStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        snippetsStack.arrangedSubviews.forEach { $0.removeFromSuperview() }

        let recent = history().prefix(8)
        if recent.isEmpty {
            recentsStack.addArrangedSubview(label("Dictate in the VibeFlow app first.", size: 13, weight: .regular, color: .gray))
        } else {
            for d in recent {
                let b = chip(d.text)
                b.addAction(UIAction { [weak self] _ in self?.insert(d.text) }, for: .touchUpInside)
                recentsStack.addArrangedSubview(b)
            }
        }

        let snips = snippets().prefix(6)
        snippetsStack.isHidden = snips.isEmpty
        for (trigger, expansion) in snips {
            let b = chip("⚡ \(trigger)")
            b.addAction(UIAction { [weak self] _ in self?.insert(expansion) }, for: .touchUpInside)
            snippetsStack.addArrangedSubview(b)
        }
    }

    // MARK: - Actions

    @objc private func insertLatestTapped() {
        let t = latest()
        if !t.isEmpty { insert(t) }
    }

    private func insert(_ text: String) {
        textDocumentProxy.insertText(text)
    }

    /// Best-effort hop to the VibeFlow app to record. Keyboard extensions can't call
    /// `openURL` directly, so walk the responder chain to an object that can.
    @objc private func openAppTapped() {
        guard let url = URL(string: appURLScheme) else { return }
        var responder: UIResponder? = self
        let selector = sel_registerName("openURL:")
        while let r = responder {
            if r.responds(to: selector) {
                r.perform(selector, with: url)
                return
            }
            responder = r.next
        }
    }

    // MARK: - View helpers

    private func verticalStack() -> UIStackView {
        let s = UIStackView()
        s.axis = .vertical
        s.spacing = 6
        s.translatesAutoresizingMaskIntoConstraints = false
        return s
    }

    private func label(_ text: String, size: CGFloat, weight: UIFont.Weight, color: UIColor) -> UILabel {
        let l = UILabel()
        l.text = text
        l.font = .systemFont(ofSize: size, weight: weight)
        l.textColor = color
        return l
    }

    private func filledButton(_ title: String) -> UIButton {
        let b = UIButton(type: .system)
        b.setTitle(title, for: .normal)
        b.setTitleColor(.white, for: .normal)
        b.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        b.backgroundColor = brand
        b.layer.cornerRadius = 14
        b.heightAnchor.constraint(equalToConstant: 52).isActive = true
        return b
    }

    private func plainButton(_ title: String) -> UIButton {
        let b = UIButton(type: .system)
        b.setTitle(title, for: .normal)
        b.setTitleColor(.white, for: .normal)
        b.backgroundColor = chipBg
        b.layer.cornerRadius = 12
        b.heightAnchor.constraint(equalToConstant: 44).isActive = true
        return b
    }

    private func chip(_ text: String) -> UIButton {
        let b = UIButton(type: .system)
        let oneLine = text.replacingOccurrences(of: "\n", with: " ")
        b.setTitle(String(oneLine.prefix(60)), for: .normal)
        b.contentHorizontalAlignment = .left
        b.setTitleColor(UIColor(white: 0.95, alpha: 1), for: .normal)
        b.titleLabel?.font = .systemFont(ofSize: 15)
        b.backgroundColor = chipBg
        b.layer.cornerRadius = 10
        b.contentEdgeInsets = UIEdgeInsets(top: 10, left: 12, bottom: 10, right: 12)
        return b
    }
}
