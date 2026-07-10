# Play Store deployment — status & morning checklist

Overnight autonomous run. Read top-to-bottom.

## ✅✅ MILESTONE (2026-07-07): app INSTALLED on-device via Internal testing
VibeFlow Dictation is live on the Internal testing track and installing on real
devices. Opt-in link: https://play.google.com/apps/internaltest/4701296436550679575
(works for the 3 tester emails: satyaam.official@, satyamonisha2018@, vamsy.24@).
Gotcha that bit us: the email list must be **checked + Saved on the track's Testers
tab** — creating the list alone isn't enough (everyone gets "App not available").

## ✅ Done overnight
- RevenueCat project renamed **Mynah → VibeFlow Dictation**.
- `eas.json` gained an **`android-production`** build profile (AAB) + submit profile (internal track).
- **Android AAB build** kicked off on EAS (build `72e7cc51`, package `com.vibeflow.mobile`,
  versionCode 2). Signing keystore auto-generated + saved on EAS.
- Play Console **create-app form pre-filled** (name "VibeFlow Dictation", package
  `com.vibeflow.mobile`) — **left unsubmitted on purpose** (see below).
- **Store listing drafted** → `docs/play-store-listing-draft.md`.
- ✅ **AAB build FINISHED + downloaded** → `~/Desktop/VibeFlow-Dictation-v1.0.0.aab` (96 MB, valid App Bundle, versionCode 2). Ready to upload to the Internal testing track once the app exists.

## 🔴 The one thing I deliberately left for YOU (≈2 min)
Creating the Play app requires accepting the **Play App Signing ToS** + certifying
**US export-law compliance** — legal acceptances in your name, which I don't click
autonomously. So, in Play Console → **Create app**:
1. Confirm the pre-filled name/package (VibeFlow Dictation / com.vibeflow.mobile).
2. Set **App or game = App**, **Free or paid = Free**.
3. Tick the **3 declaration boxes** (Developer Program Policies, Play App Signing ToS, US export laws).
4. Click **Create app**.

## 📋 Then, remaining steps (some need you, some I can do)
1. **Internal testing track** → create a release → **upload the AAB** (I'll have it on your Desktop, or I can do the upload once the app exists).
2. **Main store listing** — paste from `play-store-listing-draft.md`; **you add**: icon 512², feature graphic 1024×500, ≥2 phone screenshots.
3. **Data safety** form — *your* declaration (mic audio: on-device? any analytics? account/Supabase data?). I can't answer this for you.
4. **Content rating** questionnaire — a few clicks (you).
5. **App content** declarations (ads, target audience, etc.).
6. **IAP / subscriptions** (for RevenueCat): create products → set up the **payments/merchant profile** → download the **Play service-account JSON** → RevenueCat → `goog_` key.
7. **Submit for review** — I will NOT do this autonomously; your call.

## ⚠️ Notes
- **EAS build credits exhausted** this billing period — further builds blocked until reset or plan upgrade (expo.dev billing).
- Desktop builds (win-v1.22.23, mac-v1.17.5 native Intel) are all published + separate from this.
