# VibeFlow — iOS

A premium **voice keyboard** for iPhone: an Expo/React Native app plus a native
**keyboard extension**, delivering Wispr-Flow-style **zero-hop dictation** — tap the
mic on the keyboard, speak *inside WhatsApp (or any app)*, and your words appear at
the cursor. Feature parity with the mature Android VibeFlow, sharing its Supabase
managed AI backend (one user base across platforms).

## The core product rule

**You never dictate inside VibeFlow.** The keyboard exists so you can read the
conversation while replying. The app is a background engine; the only visit is a
~2-second bootstrap hop that arms the audio session (iOS forbids keyboards from
touching the mic, and a backgrounded app can't *start* an audio session — the same
hop Wispr Flow does).

## Architecture

```
┌─ VibeFlow app (Expo/RN, JS — OTA-updatable) ────────────────────────────────┐
│ UI: Talk (aurora hero, karaoke transcript) · History (voice stats, cards)   │
│     Settings (icon chips, Appearance light/dark) · golden update card       │
│ TextPipeline (src/core, pure TS — Android :core port)                       │
│ Managed AI tier: Supabase auth (Apple native / Google web-OAuth) →          │
│     polish edge fn (50 free/week, Pro unlimited) — services/{auth,polish}   │
└──────────────┬──────────────────────────────────────────────────────────────┘
               │ App Group (group.com.vibeflow.mobile) + Darwin notifications
┌──────────────┴──────────────────────────────────────────────────────────────┐
│ Native layer (Swift — changes need a Codemagic build)                       │
│ • targets/keyboard   QWERTY: touch-down keys, gap-forgiving hit-testing,    │
│   key-press balloons, UITextChecker suggest/autocorrect, SELF-LEARNING      │
│   (personal lexicon + typed bigrams, persisted), flow-mic state machine     │
│ • targets/widget     Live Activity / Dynamic Island (Flow Session pill)     │
│ • modules/vibeflow-appgroup      App-Group KV bridge (CFPreferences reads!) │
│ • modules/vibeflow-liveactivity  ActivityKit start/update/end               │
│ • modules/vibeflow-flowsession   THE ENGINE: one foreground-activated       │
│   AVAudioEngine input tap runs for the whole session; keyboard toggles      │
│   attach/detach SFSpeechRecognizer to the live stream (zero background      │
│   audio-session calls — the fix for OSStatus '!int'); Darwin IPC both ways  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### The Flow Session (zero-hop dictation)
1. First keyboard-mic tap → 2s hop: the app arms ONE audio session + input tap,
   shows the Dynamic Island pill, and offers a center "Return to WhatsApp" button.
2. Every next tap: keyboard → Darwin toggle → native recognition on the live
   stream → text into the App Group → Darwin result ping → keyboard inserts at the
   cursor. The mic key animates the real state (red pulse / orange / green ✓).
3. Failsafes: 1.5s ack timeout auto-re-bootstraps a dead session (Live Activities
   outlive force-quit — the "zombie pill"); errors surface in the strip + island;
   the orange mic indicator stays on while a session runs (as with Wispr).

## Build & ship

- **Native builds: Codemagic** — `codemagic.yaml` signs all three bundle ids
  (app / keyboard / widget) and publishes to TestFlight. Needs the `ios-creds`
  variable group: ASC API key (**Admin** role — App Manager 403s on certificate
  creation), Key ID, Issuer ID, and a **PKCS#1** `CERTIFICATE_PRIVATE_KEY`
  (`ssh-keygen -t rsa -b 2048 -m PEM`). Builds are numbered `1.0.(BUILD+100)`.
- **JS ships OTA**: `./scripts/deploy.sh update "msg"` (EAS Update, channel
  `production`) — the golden in-app "Update ready" card prompts the restart.
  **Bump `runtimeVersion` whenever the native surface changes** (currently `3`).
- **Local Xcode builds impossible** on the 2018 MacBook (needs macOS 26 / Tahoe).
- ⚠️ Local Expo modules **must have an `ios/*.podspec`** or they silently vanish
  from the binary. Verify: `npx expo-modules-autolinking resolve -p apple`.

## Backend (shared with vibeflow_android)

Supabase project `emvstripgwywhcuxgjeg`:
- `polish` edge fn — JWT auth → atomic quota reserve (50/week free, Pro unlimited)
  → server-side prompt + OpenAI → refund on failure. 402 = limit, 409 = device
  superseded (client signs out), 503 = maintenance kill-switch.
- `claim-device` — one active device per platform per user.
- Client: `src/services/{supabase,auth,polish}.ts`; contract tests in
  `tests/polish.test.ts`. Anon key is publishable; the OpenAI key never leaves the
  server.

## Dev

```bash
npm install                        # .npmrc has legacy-peer-deps
npx tsc --noEmit                   # typecheck (0 errors)
npx jest                           # 43 tests: pipeline, curation, commands, polish contract
./scripts/deploy.sh update "msg"   # OTA a JS-only change
```
