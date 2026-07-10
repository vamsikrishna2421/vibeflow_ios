# Moving VibeFlow iOS to the new Apple developer account — playbook

## 🎉 DONE 2026-07-09 — first TestFlight build LIVE on the new account
- Build **1.0.20** built on GitHub Actions (Xcode 26.3), uploaded + processed **VALID**
  on the new account's app **VibeFlow Dictation (6787420544)**. Carries the native
  long-dictation fix (flowsession segment chaining) + keyboard fixes.
- TestFlight internal group **"VibeFlow Team"** created, build assigned, tester
  **vamsy.24@icloud.com** added → installable via the TestFlight app.
- Working CI signing (took 11 attempts): MANUAL App Store signing (device-less
  account can't use automatic); ONE stable Apple Distribution cert imported from
  secrets DIST_P12_B64/DIST_P12_PW (never `cert`-created per run → avoids the
  2-cert cap); Xcode 26.3 (Expo SDK 57 needs Swift 6.2 + `weak let`);
  aps-environment=production. Full detail in memory `vibeflow-mobile-keyboard-and-ota-state`.
- Next iOS build: bump app.json ios.buildNumber → `expo prebuild -p ios` → commit ios/ → tag `ios-vX`.

## ✅ EXECUTED 2026-07-09 (autonomous run)
- ASC API key wired: eas.json submit + GitHub Actions secrets (key file gitignored, never committed).
- **Widget App ID registered** (com.vibeflow.dictation.widget) → all 3 App IDs now exist.
- Xcode Cloud DEAD END for now: first-workflow onboarding requires Xcode (this Mac has none).
  → **Pivoted to GitHub Actions free macOS runners** (repo is PUBLIC = unlimited minutes):
  `.github/workflows/ios-testflight.yml` — cloud automatic signing via the ASC API key
  (same mechanism as Xcode Cloud). Trigger: push an `ios-v*` tag (or workflow_dispatch once
  the file lands on `main`). First run: ios-v1.0.20 (github.com/vamsikrishna2421/vibeflow_ios/actions).
- Committed prebuilt `ios/` (CNG) + workspace stub + ci_scripts (kept for future Xcode Cloud).
- Agreements recon: **Paid Apps = "New" (unsigned)** and ASC requires legal-entity update BEFORE
  signing → the user's in-flight country-change (US→India, docs submitted to Apple Support) is
  correctly sequenced: entity change FIRST, then sign Paid Apps as India entity (PAN/bank then).
- Country change: user already has an Apple Support ticket; uploading PAN/passport themselves.

## iOS build pipeline — final design (GitHub Actions + fastlane)
Trigger: push an `ios-v*` tag. Workflow `.github/workflows/ios-testflight.yml` on `macos-15`:
npm install → pod install → `cd ios && fastlane beta`. Fastfile (`ios/fastlane/Fastfile`)
loads the ASC API key, creates a dedicated keychain + distribution cert (`cert`), makes an
App Store profile per target (`sigh` × app/keyboard/widget — App Store profiles need NO
devices, which is why plain xcodebuild automatic signing failed), switches each target to
manual signing, `build_app` (app-store export), `upload_to_testflight`. Secrets in the repo:
ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_P8 (set via API, encrypted). Free (public repo).
- Attempt 1 (ios-v1.0.20, plain xcodebuild): FAILED at Archive — "no devices / no Development
  profile". Diagnosed via the raw job log. Pivoted to fastlane.
- Attempt 2 (ios-v1.0.20-b2, fastlane): building.
Bump `ios.buildNumber` in app.json + re-run `expo prebuild -p ios` (commit ios/) for each new
TestFlight build, then tag `ios-vX`.

Recon date: 2026-07-09 (verified live in Chrome + Apple docs research with citations).

## TL;DR — there is NO app transfer to do 🎉
The "move" is already 80% done. The **new account already owns everything that matters**:

| Thing | State (verified live) |
|---|---|
| New Apple Developer account | **Team `33348G2388`**, Individual, US (Worcester MA), vamsy.24@icloud.com, active until Jul 4 2027 |
| ASC app record | **"VibeFlow Dictation" `6787420544`** lives under THIS account — "Prepare for Submission", 0 builds |
| Bundle IDs | `com.vibeflow.dictation` + `.keyboard` registered to this team (App ID prefix 33348G2388) |
| App Group | `group.com.vibeflow.dictation` registered to this team |
| Capabilities on main App ID | App Groups ✓ (1 group) · Sign In with Apple ✓ · IAP available |
| Repo config | app.json `appleTeamId: 33348G2388` ✓ · bundle ✓ · entitlements ✓ · eas.json `ascAppId: 6787420544` ✓ |
| macOS Developer ID cert | Already on this team (the Mac desktop notarization already uses the new account) |
| RevenueCat | Project "VibeFlow Dictation" exists; **no store app configured yet** (greenfield — nothing to migrate) |

The old account's "VibeFlow Voice" (6786156900, old bundle id) is simply **abandoned** — the old
TestFlight build keeps working (and receiving OTAs, runtime 3) until the new one replaces it.

Research confirmed the alternative paths were all worse: a never-published app **cannot be
Apple-transferred** ("must have at least one version released to the App Store"), and a bundle id
that ever had a build uploaded is **burned forever** for all teams. Creating the new-account app
record fresh (which is what already happened) was the correct move.
Sources: developer.apple.com/help/app-store-connect/transfer-an-app/app-transfer-criteria/,
…/create-an-app-record/remove-an-app/, forums thread 767280.

## What's actually missing (in order)

### 1. YOU (~5 min, one-time): App Store Connect API access + key
- ASC → Users and Access → **Integrations → App Store Connect API → "Request Access"** (agreement acceptance — your click).
- Then **Generate API Key**, role **Admin**, download the `.p8` ONCE. Note Key ID + Issuer ID.
- This is what lets EAS create the iOS distribution certificate + provisioning profiles + missing
  widget bundle id (`com.vibeflow.dictation.widget`) non-interactively, and lets `eas submit` upload.
  (Alternative: interactive `eas credentials -p ios` with your Apple ID + 2FA — you type the password, never me.)

### 2. YOU: unblock EAS builds
- Build credits were exhausted (~Jul 7). expo.dev → billing: wait for the reset or bump the plan for a month.
- iOS can't be built locally on this Mac (no Xcode / OS too old) — cloud build is the path.

### 3. Build + submit (I can run these once 1–2 are done)
```
eas credentials -p ios        # attach the ASC API key / create dist cert + 3 profiles
eas build -p ios --profile testflight
eas submit -p ios --profile testflight   # ascAppId 6787420544 already configured
```
- The build BAKES IN the native fixes: flowsession v3.1 (long-dictation segment chaining) + keyboard fixes.
- Known EAS gotcha after team switches (expo/eas-cli #2704): if old-team credentials are cached on
  EAS servers, delete the project's iOS credentials and recreate.

### 4. TestFlight (new app = fresh testers)
- Old TestFlight testers do NOT carry over. Create an internal group on 6787420544, re-invite
  (vamsy.24@icloud.com / vamsy.24@gmail.com + friends).

### 5. Supabase Sign in with Apple (before testers sign in on the new app)
- Dashboard → Auth → Providers → Apple → **Client IDs must include `com.vibeflow.dictation`**
  (native SIWA uses the bundle id as audience; the old build used the old bundle id).
- If the web/OAuth flow is used anywhere: the Services ID + `.p8` secret are OLD-team-scoped →
  recreate under team 33348G2388 and regenerate the client secret.
- **Known cost:** Apple `sub` identifiers are team-scoped. Testers who signed in with Apple on the
  old TestFlight app will get NEW identities on the new app (fresh Supabase users; old quota rows
  orphaned). With ~3 testers this is fine — they just sign in again. Google sign-in unaffected.

### 6. Later, for IAP (not needed for TestFlight)
- ASC → Business → sign the **Paid Applications Agreement** (+ banking/tax) — currently unsigned.
- RevenueCat → project "VibeFlow Dictation" → New app configuration → App Store → bundle
  `com.vibeflow.dictation` + App-Specific Shared Secret + In-App Purchase key (all minted from the
  NEW account; nothing old to clean up).

## Old account cleanup (optional, later)
- Old ASC: remove app "VibeFlow Voice" (Additional Information → Remove App) once the new TestFlight
  is live. Don't bother trying to free old bundle ids — builds were uploaded, so they're burned anyway.
- Old team's SIWA key/Services ID in Supabase (if any) can be deleted after the provider is re-pointed.
