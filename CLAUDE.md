# VibeFlow — iOS

This is a **dedicated session for building the iOS version of VibeFlow**, a premium
voice-dictation **keyboard** for iPhone (app + custom Keyboard Extension). The Android
version already exists and is mature; this project brings VibeFlow to iOS at the same
(or higher) quality bar.

## Mission
Build the iOS VibeFlow app and its **custom Keyboard Extension** to feature-parity with
the Android version, with best-in-class UI/UX. **Study the sources below first and be
confident on the iOS-specific pieces (keyboard extension, on-device speech, App Store
shipping) before building.** Open with a short plan, then implement in vertical slices.

## Knowledge sources — read these, don't guess

1. **Product & features → the Android VibeFlow** at `C:\Users\vamsy\Documents\vibeflow_mobile`
   - The mature reference for *what VibeFlow is*: a voice keyboard. Study its core pipeline
     (`android/core/...` — TextCuration, OutputRouting, Snippets, Vocabulary, VoiceCommands,
     Pipeline), the IME/keyboard UX (`android/app/.../ime/`), settings/history, the recent
     premium redesign, and the on-device ASR "Engine Lab" (Vosk vs Whisper).
   - **Existing iOS Swift scaffold** at `vibeflow_mobile/ios/` — XcodeGen `project.yml`;
     `VibeFlow` SwiftUI app; `VibeFlowCore` (SharedStore, TextPipeline); and
     `VibeFlowKeyboard/KeyboardViewController.swift`. **This is your starting point** —
     review it and decide what to reuse vs rebuild here in `vibeflow_ios`.

2. **iOS build & shipping know-how → `lucy`** at `C:\Users\vamsy\Documents\lucy` (a shipped
   iOS+Android app) and the playbook `C:\Users\vamsy\Documents\my_ai_projects\shared_resources\expo-mobile-app-playbook.md`
   - Use for the Apple-side process: signing, provisioning, App Store Connect, build/deploy,
     and monetization patterns. **Caveat:** lucy is Expo/React-Native — great for *process*
     knowledge, but an iOS keyboard is a **native app extension**, so VibeFlow iOS should be
     **native Swift/SwiftUI** (like the `vibeflow_mobile/ios` scaffold), not Expo.

## Key architectural decision (yours — justify it)
- iOS custom keyboards are app extensions ⇒ **native Swift/SwiftUI + a Keyboard Extension**
  is the right path. Decide the on-device speech approach (Apple `SFSpeechRecognizer` vs
  porting Whisper as on Android), the shared-core layout, and the app↔extension data sharing
  (App Group), then build.

## Process
- Study sources → short plan (architecture, stack, milestones) → build in vertical slices, kept buildable.
- Premium UI, effortless UX, clean/modular/well-commented code. (Operating principles are in the global rules.)
