# VibeFlow — iOS

A premium **offline voice keyboard** for iPhone: an Expo/React Native app that
records and formats your voice on-device, plus a native **keyboard extension**
that inserts your dictations into any app. Feature parity with the mature Android
VibeFlow, built on the same stack as LUCY so **95% of iteration ships over-the-air
(OTA)** — users just restart the app, no App Store update.

## Architecture (and the one hard iOS constraint)

iOS **forbids microphone access inside a keyboard extension** (confirmed against
Apple's own runtime error — extensions lack the record-audio entitlement, even
with Full Access). So VibeFlow splits the job:

```
   VibeFlow app  (Expo / React Native, JS — OTA-updatable)
   ────────────
   record (expo-speech-recognition, on-device) →
   TextPipeline (src/core, pure TS — same rules as Android) →
   write latest + recents + snippets to the App Group ─────────┐
                                                               ▼
   VibeFlow keyboard  (native Swift target — NOT OTA-updatable, but thin & stable)
   ─────────────────
   read App Group → "Insert latest" / pick a recent / a snippet → insertText()
```

- **OTA boundary:** the app's JS (recording, the whole text pipeline, UI, AI
  polish, paywall) rides EAS Update. The **keyboard extension is native code**, so
  changes there need a Codemagic rebuild — keep it thin; put fast-moving logic in JS.
- **No "Full Access":** the hand-off uses an **App Group** (`group.com.vibeflow.mobile`),
  not the system pasteboard, so the keyboard requests no special access.

## Layout

```
app.json / app.config.js   Expo config (bundle com.vibeflow.mobile, OTA channel `production`)
eas.json                   EAS Build/Update profiles
codemagic.yaml             iOS TestFlight pipeline (prebuild → sign → build-ipa → TestFlight)
index.ts / App.tsx         entry + root
src/
  core/                    PURE text pipeline (curation, vocab, snippets, corrections,
                           voice commands, routing) — Android :core port, Jest-tested
  navigation/ screens/     RN UI (premium home, history, settings)
  theme/                   design tokens (brand gradient, surfaces)
modules/vibeflow-appgroup/ local Expo native module: write into the App Group from JS
targets/keyboard/          native Swift keyboard extension (@bacons/apple-targets)
```

## Build & ship

This repo is **source-complete**; native builds run on macOS (Codemagic), not here.

```bash
npm install
npm test                 # runs the core pipeline tests (pure TS, any machine)
# first-time native setup (on a Mac / Codemagic):
npx eas init             # creates the EAS project → fill projectId in app.json + updates.url
npx expo prebuild        # CNG: generates ios/ incl. the keyboard target + app-group module
# ship:
#   Codemagic `ios-testflight` workflow → TestFlight
#   eas update --branch production   → OTA JS/asset updates (users restart to apply)
```

### Placeholders to fill once
- `app.json` → `updates.url` and `extra.eas.projectId` (from `eas init`)
- `eas.json` → `submit.testflight.ios.ascAppId` (from App Store Connect)
- `assets/` → see `assets/README.md` (icon / splash images)

## Status
- ✅ Project scaffold on the LUCY stack (Expo SDK 56, RN 0.85, EAS OTA, Codemagic)
- ✅ Core text pipeline ported to TS + verified against the Android unit suite
- ✅ Native keyboard target + App-Group bridge (source-complete)
- ⏳ Premium app UI · live recorder · AI Smart Formatting · history · paywall
