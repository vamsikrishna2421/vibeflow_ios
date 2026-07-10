# VibeFlow mobile — live-testing feedback (2026-07-07)

## iOS LONG-DICTATION DATA LOSS — root cause + fix (2026-07-09)
User lost a 2-3 min keyboard dictation ("processing forever", not even in history). ROOT CAUSE
(native, NOT the JS hook fixed earlier): `vibeflow-flowsession` created ONE SFSpeechRecognizer
request per utterance; Apple caps a request at ~60s → task errored → code nulled `request` → the
always-on tap fed buffers into nil (audio silently dropped from ~60s on) → state desynced (stop
started a new utterance) → text lost. FIX (v3.1, adversarially reviewed by 5 agents — 2 critical +
4 major findings all fixed): segment chaining (rotate at a natural pause 40-55s, self-heal on
early death, stitch on stop), all state main-thread-owned, recognizers retained per segment,
gen-fenced callbacks + 8s fallback, claim-id protocol with JS (flow_claim_id), keyboard ts-based
insert dedupe, error-timer guard, teardown delivers accumulated text. **NATIVE → needs an iOS
build** (see docs/APPLE-ACCOUNT-MIGRATION.md for the build path on the new Apple account).
Workaround until then: use the IN-APP Talk mic for long dictation (JS rotation fix, already OTA'd).
JS parts (flow_on_device write, claim echo, always-deliver) are OTA-able and backward-compatible
with the old native (legacy status-gated path kept when no claim id).

## PARKED (resume ~2026-07-11, per user)
- **Android voice keyboard (real IME)** — built: `modules/vibeflow-keyboard` (InputMethodService + mic/SpeechRecognizer + keys + Format), app-side setup screen, `KeyboardBridge`. Release APK built locally at `android/app/build/outputs/apk/release/app-release.apk` (debug-signed). NOT installed (needs device reconnect + uninstall-first due to signature). Local toolchain installed (JDK17/SDK35/NDK r27b); Gradle heap bumped to 6g in `android/gradle.properties`.
- **iOS Phase 2** (live raw-text streaming into the host field, then one-shot swap to AI-polished) — designed, NOT built. Native (KeyboardViewController.swift + per-segment flow posting) → needs an iOS build (EAS credits out / local Xcode). eas.json submit → ascAppId 6787420544 (VibeFlow Dictation).
- **Interim-OTA safety:** keyboard app-side UI self-gates on `@/services/keyboard` `isAvailable` (SettingsScreen + KeyboardBridge), so OTAs in the gap won't surface a dead keyboard section on Android Play builds. `android/` is gitignored.
- **iOS long-dictation fix is LIVE** (OTA `f7fb7c14`, code `675d8705`): rotate SFSpeechRecognizer at a natural pause + stop-watchdog → no more "processing forever" / stuck mic.
- **Windows mic beep** fix in `audio.py` (self-heal on stale device index) — committed? no; needs a `win-v*` tag to ship.


From on-device testing of the internal build. Fixes ship via `eas update` (OTA, no rebuild).

## OTA log
- **OTA #1** (`df9f71b3`, runtime 3) — items #1 + #2. Published 2026-07-07.
- **OTA #2** (`be8a7706`, runtime 3) — items #3 + #6 + #7-demo. Published 2026-07-07.
- **OTA #3** (`59288ddd`, runtime 3) — items #5 + #7-real (Talk screen). Published 2026-07-07.
- **OTA #4** (`f419456e`, runtime 3) — item #8 (polish() throw → stuck 'Polishing…' / locked reformat, now try/catch fallback). Published 2026-07-07.
- **OTA #5** (`4e17c6df`, runtime 3) — item #9 (Android keyboard-parity). Published 2026-07-07.
- **OTA #6** (`987033de`, runtime 3) — item #10 (Notes→bullets + new Action plan style). Published 2026-07-08. Also **polish edge fn → v12**.
- **OTA #7** (`1f5a45ed`, runtime 3) — on-device QA fixes (F1/F2/F3). Published 2026-07-08.

## On-device QA sweep (2026-07-08, via adb on SM-E225F / Android 13, vamsy.24)
VERIFIED ✅: Talk screen (Android copy/paste steps, ON-DEVICE badge, code stamp) · Settings (account, "47 free polishes left", all toggles) · **Theme persistence — tapped Dark, app restarted, stayed Dark** (the core Android parity fix, confirmed) · **Keyboard section hidden on Android** · History empty state · Paywall (Monthly $4.99 / Annual $29.99, Start free trial, Restore). Could NOT test actual voice dictation (no audio injectable via adb) → demo result tabs (Email/Casual/Notes/Plan) still need a human to dictate.
FOUND + FIXED (OTA #7):
- **F1** — Settings "Smart formatting" subtitle rendered a literal `&amp;` (it was a JS string, not JSX text, so the entity wasn't decoded) → plain `&`.
- **F2** — History empty state said "made available to **the keyboard**" (iOS-only) → Android copy-flow wording.
- **F3** — Paywall footer + About "Rate" said "**App Store**" on Android → now "Google Play" (+ Rate link points to the Play listing).
NOTE (not a bug): Auto-copy shows ON on this install — it persisted before OTA #6's default flip; the default only affects fresh installs. Toggle off in Settings to silence Android's "Send to device" chip.

## Style taxonomy (item #10)
- **Notes** → flat, scannable **bullet points** (no categories).
- **Plan** (Action plan) → **✅ To-dos / 🔁 Follow-ups / ❓ Open questions** (action-focused; Facts dropped per the chosen design).
- Server prompt lives in the `polish` edge function (`notes` rewritten, `plan` added, v12) — takes effect immediately; the new **Plan** tab/chip needs OTA #6.
- Demo tabs are now Email · Casual · Notes · Plan; Talk reformat chips add Plan (row wraps).

## Parity audit (2026-07-07) — App Group is iOS-only, no-ops on Android
Three iOS-only native modules (no `android/`): `vibeflow-appgroup`, `vibeflow-flowsession`, `vibeflow-liveactivity`.
- `app_theme` / `app_palette` → **app-level UI pref → real Android bug (#3), FIXED** via new sync `src/store/prefs.ts` (expo-sqlite sync API); App Group kept as the iOS-keyboard mirror.
- `kbd_*`, `flow_*`, `latest_dictation`, `history_json`, `snippets_json` → iOS keyboard-extension bridge; harmless on Android (data also lives in the main `kv.ts` blob store, so no loss).
- Parity GAPS (not bugs): `KeyboardSetupScreen` + keyboard-flow bits in `TalkScreen` are inert on Android → consider hiding on Android (no Android IME in this codebase yet).

## Items
| # | Item | Type | Status |
|---|---|---|---|
| 1 | Demo result tabs (Email/Casual/Notes) not obviously tappable | UX | ✅ OTA #1 — pulsing amber dot on unseen tabs + "tap the other styles" hint |
| 2 | Read-aloud screen: mic below the fold | layout | ✅ OTA #1 — smaller orb + tighter margins so it fits |
| 3 | Appearance + Theme don't persist on Android — restart reverts | bug | ✅ OTA #2 — sync prefs store (was iOS-only App Group) |
| 4 | Default dictation = on-device-only; want default REMOTE, fall back to on-device when free polishes run out | product | ❓ needs clarification (recognition vs polish — see below) |
| 5 | "Send to device" chip on every AI result | not-our-bug | ✅ OTA #3 — it's Android 13+'s system clipboard chip, triggered by auto-copy. Auto-copy now defaults OFF (existing installs: toggle it off in Settings) |
| 6 | Copy the AI result to paste into Gmail (+ edit the name) | feature | ✅ OTA #2 — Copy button (editable-name deferred) |
| 7 | Stuck / can't scroll — had to force-close | UX | ✅ OTA #2 (demo back button) + ✅ OTA #3 (real cause: **Talk screen** had no ScrollView; long drafts pushed the Save button off-screen — now scrollable) |
| 8 | Tapping Casual/Notes sometimes stays stuck | bug | ✅ OTA #4 — real bug: a thrown `polish()` left the tab hung on "Polishing…" (no catch). Now falls back to the crafted preview. Same fix on the Talk-screen reformat. |
| 9 | "Set up Keyboard" section shows iOS-only content on Android (parity gap from the audit) | bug | ✅ OTA #5 — Settings "Keyboard" section hidden on Android; Talk screen now platform-aware (Save to history + copy/paste steps instead of the iOS keyboard flow) |

## Notes / findings
- `onDeviceOnly` default = `true` in `src/store/types.ts`. Store persists whole blob on every change (`Store.tsx` kvSet) — so #3 is likely a reload-before-persist race, or appearance/theme not in the persisted slice.
- #4/#5 are related: on-device-only mode appears to gate the polish path AND surface the "on-device only" banner. Design question: should REMOTE be the default (better polish) with automatic fallback to on-device when the weekly free-polish quota is exhausted? Recommend **yes** — needs the polish service to try cloud first, catch quota/offline, then run on-device silently (no banner unless it actually fell back).
- #6 Copy needs a clipboard API — check `expo-clipboard` is in the build (native module; if absent, needs a rebuild, not OTA).
