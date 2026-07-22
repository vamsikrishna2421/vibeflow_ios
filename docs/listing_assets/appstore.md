# VibeFlow Dictation — App Store listing (ready-to-paste)

First public iOS release, **iPhone-only**, **free**. Speech recognition is **on-device by
default** (private); users can opt into Apple's cloud speech service in Settings for higher
accuracy. Keyboard dictation is **continuous — no time limit** (default on). The VibeFlow Pro
paywall is **hidden in v1** (`PRO_ENABLED = false`) — it returns with the AI-formatting
subscription in a later update. App Store Connect app id **6787420544**, bundle
`com.vibeflow.dictation`.
**Build to submit: `1.0.71`** (iPhone-only, Pro hidden, on-device default, continuous on).

## App information (static)
- **Name (≤30):** `VibeFlow Dictation`
- **Subtitle (≤30):** `Voice keyboard, talk to type`
- **Category:** Primary **Productivity**, Secondary **Utilities**
- **Support URL:** `https://vamsikrishna2421.github.io/vibeflow-web/`
- **Marketing URL (optional):** `https://vamsikrishna2421.github.io/vibeflow-web/`
- **Privacy Policy URL:** `https://vamsikrishna2421.github.io/vibeflow-web/privacy.html`
- **Copyright:** `2026 Vamsi Krishna Reddy Lekkala`

## Version listing (per-language: English U.S.)
**Promotional text (≤170):**
```
Tap the mic and talk — VibeFlow types your words in any app, cleaned up as you speak. Private, on-device by default. No time limit: keep talking and your words stream in.
```

**Keywords (≤100, comma-separated):**
```
voice,dictation,keyboard,speech to text,transcribe,voice typing,talk to type,hands free,notes,stt
```

**Description (≤4000):**
```
VibeFlow is a voice keyboard: tap the mic and talk, and your words are typed for you — right where you're already typing, in any app. Messages, email, notes, search — dictate in place, no copy-paste.

WHY VIBEFLOW
• Types where you type — VibeFlow is a full keyboard, so you can dictate in every app on your iPhone.
• No time limit — talk as long as you like; your words stream into the field as you speak.
• Private on-device mode — turn on "On-device only" to keep your voice entirely on your iPhone. On-device recognition is CPU-intensive, so this mode runs in ~45-second stretches (a countdown shows the time left) to keep your device cool and easy on the battery — just tap the mic to continue.
• Clean text automatically — filler words and stumbles are cleaned up, and punctuation is added as you speak (say "new line", "comma", "question mark").
• A real keyboard, too — a fast, modern QWERTY layout with smart suggestions and long-press accents for when you'd rather type.

HOW TO START
1. Install VibeFlow.
2. In Settings → General → Keyboard → Keyboards, add the VibeFlow keyboard and allow Full Access.
3. Switch to VibeFlow in any app, tap the mic, and start talking.

VibeFlow is built to feel effortless — a premium voice keyboard that gets out of your way. Download it and start talking.
```

**What's New (for 1.0 — first release):**
```
The first public release of VibeFlow — a voice keyboard for iPhone. Tap the mic in any app and talk; your words are typed in place, cleaned up as you speak. No time limit on dictation, plus a private on-device mode that runs in short stretches to keep your device cool.
```

## App Privacy (nutrition labels)
- **Used to track you:** None.
- **Data linked to you** (only when the user signs in; sign-in is optional):
  - **Contact Info → Email Address** — from Apple/Google sign-in. Purpose: App Functionality (account, cross-device sync).
  - **Contact Info → Name** — captured in onboarding (optional), stored to the user's account. Purpose: App Functionality (personalized greeting) + Product Personalization.
  - **User Content → Other** — occupation/role (optional, onboarding). Purpose: App Functionality + **Analytics** (which professions use VibeFlow).
  - **Identifiers → Device ID** — device-limit enforcement + Fraud Prevention.
  - **Usage Data → Product Interaction** — free-tier usage counts (when signed in).
- **NOT collected:** Audio/voice (speech recognition runs on-device by default; when the user opts into cloud, audio is processed by **Apple's** speech service — VibeFlow never receives, stores, or transmits audio itself), Location, Contacts, Messages, Photos, Health, Browsing history.
- Encrypted in transit: **Yes**. Account/data deletion offered: **Yes** (in-app "Delete account" + the public delete-account page).

> NOTE vs the old draft: Name + occupation are now **collected** (saved to the user's account for the returning-user greeting + a professions breakdown) — they are NOT "stored on device only" anymore. Audio remains uncollected by VibeFlow in both modes.

## Age rating
Answer **No** to every content descriptor. Expected rating: **4+**.

## Export compliance
Already declared in Info.plist: `ITSAppUsesNonExemptEncryption = false` → no extra documentation prompt.

## App Review notes (paste into "Notes")
```
VibeFlow is a voice-dictation keyboard for iPhone.

To test:
1. Install; open the VibeFlow app and grant Microphone + Speech Recognition when prompted.
2. Enable the keyboard: Settings → General → Keyboard → Keyboards → Add New Keyboard → VibeFlow. Then tap VibeFlow and turn on "Allow Full Access."
3. In any app (Notes, Messages), switch to the VibeFlow keyboard, tap the microphone button, and speak. Your words are typed in place. There is no time limit — keep talking and the text streams in as you speak.

Speech recognition runs ON-DEVICE BY DEFAULT — your voice stays on the iPhone. Users can optionally switch to Apple's cloud speech recognition (Settings → Recognition → turn off "On-device only") for higher accuracy; in that mode audio is processed by Apple's speech service. VibeFlow itself never collects, stores, or transmits audio.

Why the keyboard requests Full Access: it is required to run the microphone and speech recognition through the App Group shared with the container app.

Sign-in is optional and NOT required to use the keyboard, so no demo account is needed.
```

## Screenshots (6.9-inch, 1320 × 2868)
Current files in `docs/listing_assets/` (`appstore-1..4-*.png`) predate the live transcript "tail line" and the redesigned sectioned Settings. **Reshoot on 1.0.71 before submitting**, especially:
1. Keyboard + mic in Messages (the core hook).
2. **Keyboard dictating live — now shows the live transcript "tail line" streaming left of the mic** (great new visual; the old shot had a countdown ring that no longer appears in continuous mode).
3. The in-app Talk mic.
4. Dictation history (with the new "as heard" raw vs formatted view).
Optional 5th: the redesigned Settings menu.

iPad screenshots are NOT needed (iPhone-only for v1).
```
