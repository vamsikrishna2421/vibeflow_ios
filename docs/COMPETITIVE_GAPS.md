# VibeFlow iOS — Competitive gaps & OTA feature roadmap

Derived from the mobile competitive matrix (`android/docs/COMPETITIVE_ANALYSIS.md`,
21-product research sweep) + the current iOS app. Ranked by value ÷ effort.
**Bias: OTA-able (JS + server-prompt) first** — those ship instantly, no Apple build.

Legend: value ★→★★★ · effort L/M/H · **OTA** (JS &/or server) vs **NATIVE** (needs Codemagic build).

## Shipped this session
- ✅ **Reformat as Clean/Email/Casual/Notes** (Talk draft) — Wispr/Aqua-style tone/format switching, reusing the server polish styles. **OTA.** (Notes now yields the Facts/To-dos/Follow-ups/Open-questions digest — server prompt tuned + deployed.)
- ✅ **First-run personalized demo** — sign-in → profile → permissions → read → one-voice-note-three-ways (Email/Casual/Notes) with recognizer priming (contextualStrings) + vocabulary seeding. **OTA.**

## Also shipped this session
- ✅ **Natural-language edits** ("make it shorter", "add a greeting", "bullet it") — Aqua's headline differentiator. "Tell VibeFlow how to change it…" field under the Talk draft → server `instruct` style (polish v11). **OTA.**

## Top recommendations (build next — all OTA)
2. **Reformat/re-polish from History** ★★ · L–M · OTA. Apply the same style chips to any saved dictation (long-press → Reformat as…). Pure reuse of the new `reformat()`.
3. **Live "N free polishes left this week" readout** in Settings + the Talk toast. ★★ · M · OTA. Parity with Android (it reads the profile via RLS, no quota spent); drives Pro. iOS Settings currently shows static "50 free / week". Needs a lightweight profile-quota read (or persist last-known `remaining` from polish responses as a v1).
4. **"✨ Enhance / try harder" one-tap re-polish** ★ · L · OTA. Mostly covered by Reformat › Clean; a dedicated affordance is a small add.
5. **Multilingual polish styles** ★★ · M · OTA (server). The model is language-agnostic but the style prompts are English-shaped; add locale-aware phrasing so non-English dictation formats idiomatically.

## Native (need a Codemagic build — do in the next build batch, not OTA)
- **Prime the KEYBOARD flow-session recognizer** with the user's name/vocab (`contextualStrings`) — done for the in-app mic; the native `VibeflowFlowSessionModule` SFSpeechAudioBufferRecognitionRequest needs the same one-line `request.contextualStrings = [...]` (map is in the exploration notes). ★★ · L (Swift).
- **Downloadable high-accuracy engine** (Whisper/Parakeet, opt-in) — matches FUTO/Outspoke for power users while the default stays light. ★★★ · H.
- **System-wide dictation** beyond the keyboard (share-extension / action) — broader reach. ★★ · M–H.

## Where iOS already matches/leads (don't rebuild)
Offline-capable on-device ASR (SFSpeechRecognizer, `requiresOnDeviceRecognition`), a true keyboard extension (not an accessibility bubble like Wispr Android), local searchable history, custom vocabulary + snippets, spoken punctuation/layout, voice-edit commands, Flow-Session zero-hop dictation (Dynamic Island), and the managed 50-free/week → Pro AI polish. The **compliance/offline wedge** is the desktop's job (deliberately cloud-free).

## Notes
- Everything "OTA" ships via `eas update` (JS) and/or a Supabase edge-function deploy (server prompts) — no App Store review, no build. That's the fast lane; prefer it.
- The paywall CTA is live but RevenueCat is inert until the `appl_` key (post Apple region-fix). All the above work regardless.
