# Moving VibeFlow iOS to the new Apple developer account — playbook

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
