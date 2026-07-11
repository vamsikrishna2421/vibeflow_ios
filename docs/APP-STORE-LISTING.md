# VibeFlow — App Store (iOS) Listing Prep

Ready-to-paste content + a plan to prepare **VibeFlow Dictation** for App Store review.
App Store Connect app: **VibeFlow Dictation**, `ascAppId 6787420544`, bundle
`com.vibeflow.dictation`. Currently on **TestFlight** (builds 1.0.20 / 1.0.21).

Grounded in the real app (`app.json`, SDKs, the `polish` edge function). **⚠️ CONFIRM**
marks items needing your decision. Character limits are Apple's hard caps.

---

## 1. App information / metadata (App Store Connect → *App Information* + *Version*)

**Name** (≤30 chars)
```
VibeFlow: AI Voice Keyboard
```

**Subtitle** (≤30 chars)
```
Talk. It types it, formatted.
```

**Promotional text** (≤170 chars — editable anytime without review)
```
Early-bird pricing for our first users. Speak into any app and VibeFlow's AI
writes it out clean — punctuation, lists, email and notes styles, and more.
```

**Keywords** (≤100 chars, comma-separated, no spaces, don't repeat the name)
```
dictation,voice to text,speech,keyboard,transcribe,AI writing,notes,email,talk to type,voice typing
```
> 98 chars. Don't include "VibeFlow" (the name already indexes) or plurals of words already present.

**Description** (≤4000 chars)
```
Type with your voice — in any app.

VibeFlow is a voice keyboard that turns what you say into clean, correctly
written text and puts it right where you're typing: Mail, Messages, WhatsApp,
Slack, Notes, Safari — anywhere.

Plain dictation gives you a run-on with no punctuation. VibeFlow is different.
Its AI understands what you meant to write and formats it: capitalization,
commas and periods, paragraph breaks, numbered lists, and details like "$50",
"Q3" and "June 25" written the way you'd type them. Say "new line" or
"question mark" and it does the right thing.

ONE KEYBOARD, EVERY APP
• Switch to the VibeFlow keyboard, tap the mic, and speak.
• Your words appear formatted and ready to send — no copy-paste, no switching apps.

SMART FORMATTING STYLES
• Email — greeting, tidy body, sign-off.
• Message — natural, casual chat text.
• Notes — clean bullet points.
• Plan — turns a brain-dump into to-dos, follow-ups and open questions.
• Or just clean, punctuated text for anything else.

BUILT FOR REAL SPEECH
• Removes "um", "uh" and false starts.
• Keeps your names, brands and technical terms exactly as said.
• Handles long dictation — speak for minutes.

PRIVACY
• We never store your recordings and don't sell your data.
• Your dictation is used only to produce your text, then it's gone.
• The keyboard can't see password or payment fields.

FREE TO START
• 50 free AI formats to try everything.
• VibeFlow Pro unlocks unlimited formatting, with early-bird pricing for our
  first users.

Talk instead of type.
```

**URLs**
- Support URL: **⚠️ CONFIRM** (e.g. `https://vibeflow.app/support` — must be live).
- Marketing URL (optional): `https://vibeflow.app`.
- Privacy Policy URL: `https://vibeflow.app/privacy` — ⚠️ CONFIRM live + accurate.

---

## 2. Screenshots plan (App Store Connect → *Version → Media*)

Apple now accepts **one required size** that scales to all iPhones:
- **iPhone 6.9"/6.7"** — **1320×2868** or **1290×2796** portrait. **Required.** Upload **3–10**.
- iPad (only if you ship an iPad build): **12.9"** 2048×2732. *A keyboard app is iPhone-first; skip iPad unless you support it.*

Suggested 5 frames (same story as Play, iOS chrome):
1. Keyboard mid-dictation with live transcript.
2. Before → after AI formatting (messy → clean).
3. Style picker (Email / Notes / Plan).
4. "Works in any app" (Mail/Messages/Safari collage).
5. Free 50 + Pro value.
- Optional **App Preview** video (15–30s) of a real dictation.
- Tip: add short caption text baked into each frame; keep the first 2 strong (they show in search).

---

## 3. App Privacy "nutrition labels" (App Store Connect → *App Privacy*)

Mirror of the Play Data-safety declaration. Data types + usage:

| Data | Linked to user? | Used for tracking? | Purpose |
|---|---|---|---|
| **Email address** (Contact Info) | Yes | No | App Functionality |
| **User Content — dictated text / "Other User Content"** | Yes | No | App Functionality (sent to OpenAI to format; **not stored** by us) |
| **Audio Data** | ⚠️ CONFIRM | No | App Functionality (speech-to-text) |
| **Purchases** | Yes | No | App Functionality |
| **Identifiers — device/user ID** (app-generated) | Yes | No | App Functionality, Fraud prevention |
| **Usage Data** (counts) | Yes | No | Analytics / App Functionality |

- **Tracking:** **No** — VibeFlow does **not** track across other companies' apps/sites (no ad SDK, no IDFA). So *App Tracking Transparency* prompt is **not** required.
- **Audio (⚠️ CONFIRM):** iOS uses `SFSpeechRecognizer` (`NSSpeechRecognitionUsageDescription` is set) + the mic (`NSMicrophoneUsageDescription`). Recognition may use Apple's servers unless on-device; audio isn't stored by us. Safe label: **Audio Data → App Functionality, not used for tracking.**
- All data **encrypted in transit** (TLS).

Your `Info.plist` usage strings already present (via `app.json`): microphone, speech recognition, photo library. **⚠️ CONFIRM** the app still uses Photo Library — if not, remove `NSPhotoLibraryUsageDescription` to avoid a reviewer question.

---

## 4. Age rating (App Store Connect → *Age Rating*)
- Utility/productivity, no objectionable content → all frequencies **None** → **4+**.
- No user-generated content shared publicly, no unrestricted web → keep **4+**.

---

## 5. App Review Information (the part that most often gets a keyboard REJECTED)
- **Sign-in required → provide a demo account.** ⚠️ CONFIRM: create a review login (email + password) and put it in *App Review Information → Sign-In required*. Not your personal account.
- **Keyboard "Full Access" justification.** VibeFlow's keyboard needs **Open Access / Full Access** (network — to reach the AI formatting server). Apple scrutinizes this. In *Notes to reviewer*, state plainly:
  > "The custom keyboard requests Full Access solely to send the user's dictated text to our server for AI formatting and to sync the signed-in user's settings. We do not log keystrokes, and we do not collect data from password or other secure fields (the keyboard is disabled in secure text fields per iOS). Recordings are not stored."
- **How to test:** "Add the VibeFlow keyboard in Settings → General → Keyboards, enable Allow Full Access, open Notes, switch to VibeFlow, tap the mic, and dictate."
- **Guideline 5.1.1 / data-use:** the privacy strings + App Privacy labels must match the above.

---

## 6. Path to submission — checklist
- [ ] **A.** Metadata: name, subtitle, promo, keywords, description (§1) + URLs.
- [ ] **B.** Screenshots: ≥3 at 6.9"/6.7" (§2) (+ optional App Preview).
- [ ] **C.** App Privacy labels (§3) completed + published.
- [ ] **D.** Age rating questionnaire (§4) → 4+.
- [ ] **E.** App Review Information: **demo account** + **Full-Access justification** + test steps (§5).
- [x] **F.** ✅ **Account deletion** — BUILT (Settings → "Delete account", destructive confirm → `delete-account` edge function; satisfies Guideline 5.1.1(v)). Disclose in the privacy policy that an **anonymous per-device usage counter** (no account link) is retained for abuse-prevention.
- [ ] **G.** Pricing: free app; configure the **Pro auto-renewable subscription** in App Store Connect + attach the localized display name/price. *(IAP stays UNWIRED until the Apple Paid Apps Agreement is signed — India entity change pending — so this step waits on that.)*
- [ ] **H.** Select a build (1.0.21 or newer) → submit for review.

### Blocking on you (⚠️ CONFIRMs), shared with Play where noted
1. **Account deletion** (F) — Apple + Play both require it; one implementation serves both. I can build it.
2. **Demo review account** — one login serves both stores.
3. **Audio privacy label** choice (§3) — recommend "Audio Data → App Functionality."
4. **Photo Library usage** — confirm still used, else drop the Info.plist string.
5. **Privacy + Support pages** live at vibeflow.app.
6. **Screenshots** — same 5-frame story as Play, iOS chrome.
7. **Paid Apps Agreement** — gates the subscription/IAP step (G).

---

*Generated 2026-07-11. iOS listing mirrors the Play deliverable (`PLAY-STORE-PRODUCTION.md`);
the demo account, account-deletion flow, privacy page, and screenshot story are shared work.*
