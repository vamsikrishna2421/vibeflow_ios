# VibeFlow — Store Screenshots Spec (iOS + Play)

The one store asset that still needs producing. Everything here is exact so
capture → caption → upload is mechanical. **Same 5-frame story on both stores**;
only the canvas size and chrome differ.

> The listings themselves (copy, privacy labels, data safety, checklists) are done —
> see `APP-STORE-LISTING.md` and `PLAY-STORE-PRODUCTION.md`. This doc is only the visuals.

---

## Canvas sizes (upload these exact pixels)

| Store | Canvas | Notes |
|---|---|---|
| **App Store** — 6.9"/6.7" iPhone | **1290 × 2796** portrait | Apple's single required size; scales to all iPhones. Upload **3–10**. |
| **Google Play** — phone | **1080 × 1920** portrait (9:16) | Min 320 / max 3840 px per side. Upload **2–8** (do all 5). |
| **Play feature graphic** (mandatory) | **1024 × 500** landscape | Not a screenshot — a banner. Spec in §Feature-graphic below. |

Skip iPad/tablet — VibeFlow is iPhone-first; listing tablet support invites an
"optimize for tablet" review note for zero gain.

---

## The 5 frames (order = the story a browsing user reads)

Each frame is a real app capture with a **caption band** composited on top (a
solid `#0B0A14` band, brand-purple `#7C5CFF` keyword, white text). Keep the
caption in the **top ~22%** so the device/app content reads below it. First two
frames show in search results — make them carry the pitch alone.

| # | Capture this screen | Caption (headline / subhead) |
|---|---|---|
| **1** | VibeFlow keyboard open in **Messages**, mid-dictation, live transcript visible, mic active (pulsing) | **Talk. It types.** / Your voice, in any app — formatted and ready to send. |
| **2** | Before → after: raw run-on ("send priya the q3 numbers by friday…") above, clean formatted version below | **AI that writes it right.** / Punctuation, capitals, lists — the way you'd type it. |
| **3** | The **style picker** (Email · Message · Notes · Plan) | **One voice, four styles.** / Email, message, notes, or a to-do plan — you pick. |
| **4** | Collage / carousel of VibeFlow keyboard in **Mail, WhatsApp, Safari** | **Works everywhere you type.** / No copy-paste, no app-switching. |
| **5** | Paywall / value screen: "50 free formats" + Pro early-bird price | **Free to start.** / 50 free AI formats. Go Pro for unlimited, early-bird pricing. |

Caption copy is deliberately claim-safe (no "#1/best"), matches the listing
descriptions, and avoids competitor names — clean for both stores' review.

---

## How to capture the raw screens

**iOS (for the 1290×2796 frames):**
1. iPhone 15/16 Pro Max (or the 6.9" simulator) — its native screenshot is already 1290×2796, no scaling.
2. Settings → General → Keyboards → add VibeFlow + Allow Full Access.
3. Open each target app, switch to the VibeFlow keyboard, stage the moment, press Volume-Up + Side (or ⌘S in simulator).
4. Frame 2's before/after and frame 4's collage are composited in design, not a single live capture.

**Android (for the 1080×1920 frames):**
1. A 1080×1920 (or taller 9:16) device/emulator; Power+Volume-Down.
2. Same staging. Android chrome (nav bar, keyboard styling) makes these visibly "the Android app" — don't reuse iOS captures on Play.

**Compositing the caption band:** any tool (Figma/Canva/Sketch). Band = full-width
rectangle `#0B0A14`, height ≈ 22% of canvas, anchored top. Headline 64–72px bold
white with the keyword in `#7C5CFF`; subhead 34–40px `#A7A3C2`. Keep 96px side
margins so nothing clips on the store card crop.

---

## Filenames (keep them sortable so store order is obvious)

```
ios/01-talk-it-types_1290x2796.png
ios/02-ai-writes-it-right_1290x2796.png
ios/03-four-styles_1290x2796.png
ios/04-works-everywhere_1290x2796.png
ios/05-free-to-start_1290x2796.png

play/01-talk-it-types_1080x1920.png
play/02-ai-writes-it-right_1080x1920.png
play/03-four-styles_1080x1920.png
play/04-works-everywhere_1080x1920.png
play/05-free-to-start_1080x1920.png
```

---

## Feature graphic (Play only — mandatory, 1024×500)

Banner, not a phone shot. Layout:
- Background: brand gradient `#A855F7 → #7C5CFF → #56B6FF` (the `brandGradient` token).
- Left ~60%: wordmark **VibeFlow** + tagline **"Talk. It types it, formatted."** in white.
- Right ~40%: a single phone showing the keyboard mid-dictation (frame 1's capture).
- No essential text near the edges (Play crops it on some surfaces). No screenshots-of-screenshots look — keep it a clean banner.

App icon (512×512) already exists — reuse the shipped icon; no work needed.

---

## Definition of done
- [ ] 5 iOS frames at 1290×2796 (captions composited).
- [ ] 5 Play frames at 1080×1920 (Android chrome, captions composited).
- [ ] 1 Play feature graphic at 1024×500.
- [ ] Uploaded: App Store Connect → Version → Media; Play → Main store listing → Graphics.
- [ ] First two frames independently sell the app (search-result preview).

*Generated 2026-07-11. Captions mirror the approved listing copy; regenerate captions here if the listing copy changes.*
</content>
</invoke>
