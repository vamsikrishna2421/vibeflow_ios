# VibeFlow — Play Store Production Prep

Ready-to-paste content + a checklist to take **VibeFlow Dictation** (`com.vibeflow.mobile`,
Play app `4976060042817603016`) from **Draft / Internal testing → Production**.

All copy here is grounded in what the app actually does (verified against `app.json`,
the SDKs in `package.json`, and the `polish` edge function). Items that need **your
factual decision** are marked **⚠️ CONFIRM**.

---

## 0. Current status (2026-07-11)
- App status: **Draft**; active track: **Internal testing** (versionCode 4).
- Permissions requested: `RECORD_AUDIO`, `INTERNET` **only** (nothing else — great for Data safety).
- Data leaves the device to: **Supabase** (auth/email + usage metering), **OpenAI** (text → AI formatting, via our server), **Google Play/RevenueCat** (purchases), **Google STT** (speech recognition, OS-level).
- The dictated text is **processed, not stored** by us (the `polish` function records only token *counts*).

---

## 1. Store listing — copy (paste into *Grow → Store presence → Main store listing*)

**App name** (≤30 chars)
```
VibeFlow: AI Voice Keyboard
```

**Short description** (≤80 chars)
```
Talk instead of type. AI turns your voice into clean, ready-to-send text.
```

**Full description** (≤4000 chars)
```
Type with your voice — anywhere on your phone.

VibeFlow is a voice keyboard that turns speech into clean, correctly written
text and drops it straight into whatever app you're using: email, WhatsApp,
Slack, Notes, your browser — anywhere you'd normally tap out a message.

Most dictation gives you a messy wall of words with no punctuation. VibeFlow is
different. Its AI understands what you meant to write and formats it for you:
capital letters, commas and full stops, paragraph breaks, numbered lists, even
"$50", "Q3" and "June 25" written the way you'd type them. Say "new line" or
"question mark" and it does the right thing.

ONE KEYBOARD, EVERY APP
• Switch to VibeFlow like any other keyboard, tap the mic, and speak.
• Your words appear formatted and ready to send — no copy-paste, no app-switching.

SMART FORMATTING STYLES
• Email — greeting, tidy body, and a sign-off.
• Message — natural, casual chat text.
• Notes — clean bullet points.
• Plan — turns a brain-dump into to-dos, follow-ups and open questions.
• Or just clean, correctly punctuated text for anything else.

BUILT FOR REAL SPEECH
• Removes "um", "uh" and false starts automatically.
• Keeps your names, brands and technical terms exactly as you said them.
• Handles long dictation — speak for minutes, not just a sentence.

PRIVACY YOU CAN TRUST
• We never store your recordings, and we don't sell your data.
• Your dictation is used only to produce your text, then it's gone.
• The keyboard has no access to passwords or payment fields.

FREE TO START
• 50 free AI formats to try everything.
• VibeFlow Pro unlocks unlimited formatting — with an early-bird price for our
  first users.

Talk instead of type. Give VibeFlow a try and never thumb-type a long message
again.
```
> Notes: no keyword stuffing, no competitor names, no unverifiable claims ("#1", "best"). Safe for Play policy.

**Graphics required** (⚠️ these are assets, not text — needed before publish):
- App icon: 512×512 PNG (32-bit, ≤1 MB).
- Feature graphic: 1024×500 PNG/JPG (**mandatory** to publish).
- Phone screenshots: **2–8**, 16:9 or 9:16, min 320 px, max 3840 px. Suggest 4–6:
  1. The keyboard mid-dictation (live transcript), 2. Before→after AI formatting,
  3. The style picker (Email/Notes/Plan), 4. "Works in any app" collage,
  5. Free-tier / Pro value.
- (Optional) 7" & 10" tablet screenshots — only if you list tablet support.

---

## 2. Data safety (paste into *Policy → App content → Data safety*)

Declared collection (based on actual behavior):

| Data type | Collected? | Shared? | Ephemeral? | Purpose |
|---|---|---|---|---|
| **Email address** | Yes | No | No | Account management, App functionality |
| **User-generated content — dictated text** | Yes | Yes (OpenAI, as processor) | **Yes — not stored by us** | App functionality (AI formatting) |
| **Voice / audio** (mic) | ⚠️ CONFIRM (see below) | — | Yes | App functionality (speech-to-text) |
| **Purchase history** | Yes | No | No | App functionality (unlock Pro) |
| **Device or other IDs** (app-generated device UUID) | Yes | No | No | App functionality (device limit), Fraud prevention |
| **App activity** (usage counts / tokens) | Yes | No | No | Analytics / App functionality |

Answer these Data-safety questions as:
- **Is all data encrypted in transit?** → **Yes** (all traffic is HTTPS/TLS to Supabase, OpenAI, Google).
- **Do you provide a way to request data deletion?** → **⚠️ CONFIRM** (see §6, item D — you need an in-app or web "delete my account" path + URL).
- **Data collected vs shared:** "shared" = sent to another company. OpenAI processes text *on our behalf* (a service provider), which Google generally treats as **collected, processed ephemerally**; declaring the dictated text as also **shared** with OpenAI is the safe, honest choice.

**⚠️ CONFIRM — the audio question.** On Android the mic audio is handled by the **OS speech recognizer (Google STT)**; VibeFlow itself receives only text and never stores audio. Two defensible declarations — pick one:
- (a) *Voice/audio recordings — not collected by us* (audio is processed by the OS recognizer, we only get text), **or**
- (b) *Voice/audio recordings — collected, processed ephemerally, not stored.*
Option (b) is the more conservative/safe choice for review. Recommend (b).

---

## 3. Content rating (paste into *Policy → App content → Content ratings*)

It's a **Utility / Productivity** app with no objectionable content. Questionnaire answers:
- Category: **Utility, Productivity, Communication, or Other** → choose **Productivity**.
- Violence / sexual / profanity / controlled substances / gambling: **No** to all.
- User-generated content shared with others? **No** (text goes into the user's own apps, not a VibeFlow social feed).
- Users can interact / share location / personal info with others in-app? **No**.
- Digital purchases? **Yes** (Pro subscription).
Expected result: **Everyone / PEGI 3 / rated for all ages.**

---

## 4. App access (paste into *Policy → App content → App access*)

The app **requires sign-in**, so Google's reviewers can't see full functionality without an account.
- Choose **"All or some functionality is restricted."**
- Provide a **demo account** so review can pass:
  - **⚠️ CONFIRM:** create a dedicated review login (e.g. an email + password test user, or Google test account) and paste the credentials + a one-line "sign in, tap the mic, dictate" instruction. Do **not** use your personal account.

---

## 5. Other required declarations (*Policy → App content*)
- **Privacy policy URL:** `https://vibeflow.app/privacy` — ⚠️ CONFIRM this page is live and covers email, dictated text→OpenAI, purchases, and deletion.
- **Ads:** **No** (VibeFlow shows no ads) → declare "No ads."
- **Target audience & content:** target **18+** (or 13+); **not** directed to children → avoids the Families/Designed-for-Families obligations. Recommend **18 and over** given the paid subscription.
- **News app:** No. **COVID-19 contact tracing:** No. **Government app:** No.
- **Financial features:** No. **Health:** No.
- **Data safety ↔ permissions match:** only `RECORD_AUDIO` + `INTERNET` → nothing to explain for sensitive permissions (no SMS/Call-log/Location/Photos).

---

## 6. Path to Production — ordered checklist
- [ ] **A.** Main store listing: name + short + full description (§1) + all graphics (icon, feature graphic, ≥2 screenshots).
- [ ] **B.** Content rating questionnaire (§3) → submit → get the rating.
- [ ] **C.** Data safety form (§2) → complete + submit.
- [x] **D.** ✅ **Account/data deletion** — BUILT (Settings → "Delete account" → `delete-account` edge function wipes profiles/devices/user_profiles + the auth user; client treats a retry-401 as already-deleted). One caveat to disclose: an **anonymous per-device usage counter** (`device_usage`, keyed by a random device UUID, no account link after deletion) is **retained for abuse-prevention** — note this in the privacy policy so review can't flag an undisclosed retention.
- [ ] **E.** App access: demo account (§4).
- [ ] **F.** Ads, Target audience, Privacy policy, News/Gov/Financial/Health (§5).
- [ ] **G.** Store settings: app category = **Productivity**; tags; contact email; (external marketing opt-out as you prefer).
- [ ] **H.** Select countries/regions + confirm the Pro subscription is available where you sell.
- [ ] **I.** Create a **Production** release, promote the reviewed AAB (versionCode ≥ current), add release notes, roll out (staged % optional).
- [ ] **J.** Submit for review. First review typically a few days.

### Blocking on you (the ⚠️ CONFIRMs)
1. **Account deletion** (item D) — required; decide in-app vs web form. I can build the in-app flow (Settings → Delete account → calls a Supabase RPC that wipes the profile/devices) if you want.
2. **Audio declaration** choice (§2) — recommend "collected, ephemeral, not stored."
3. **Demo review account** (§4) — create one; I can wire a throwaway login.
4. **Privacy policy page** live at vibeflow.app/privacy and accurate (§5).
5. **Graphics** — feature graphic + screenshots (design assets).

---

*Generated 2026-07-11. Update as items are completed in Play Console.*
