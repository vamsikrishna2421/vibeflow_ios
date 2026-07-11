# VibeFlow Android — UI/UX Review & Polish (2026-07-11)

A code + design review of all app screens, the shared UI kit, and the Android
keyboard IME, run as a 7-way parallel review (one reviewer per surface) and then
synthesized. This doc records what was **applied** (committed) and what's
**deferred** (needs on-device testing or is a larger change), so nothing is lost.

> Done autonomously overnight — every change below is a low-risk code edit verified
> by `tsc --noEmit`. Nothing was shipped/OTA'd; it's staged for a build + on-device pass.

---

## The dominant finding (fixed): the theme system was being bypassed

VibeFlow ships **two palette axes** — scheme (light/dark) and palette (color/**mono**)
— but dozens of surfaces hardcoded the color-palette purple (`rgba(124,92,255,…)`),
green (`#39D98A`), gold, and **`#fff`-on-brand**. Result:
- In the **mono** palette the app stayed purple/green/gold — breaking the whole
  "grayscale except the mic" promise.
- In **light** mode, translucent-white fills and the white Apple button **vanished**.
- Worst: active segmented-control / tab text used literal `#fff` painted on
  `Colors.brand`, which is **near-white in mono-dark** → the **selected item was invisible**.

### Applied
- **New token `Colors.onBrand`** (per palette: white on purple/near-black brand,
  dark on near-white brand). Now used by `PrimaryButton`, the Settings
  Appearance/Theme segments, and the onboarding style tabs → selected text is always legible.
- **Token-derived tints everywhere** (`` `${Colors.brand}26` `` etc., matching the
  kit's own `RowIcon` pattern) across: kit `Chip`/`Badge`/`EmptyState`; Talk
  (waveform bars, session bar, step badge, karaoke highlight); Paywall (feature
  check, selected plan, Pro badge); Settings (account avatar, language row, step);
  Onboarding + Keyboard-setup success icon; About & Corrections & Vocabulary icons;
  **History StatsCard** (edge gradient, streak chip, spark bars) and the list
  `chipBg` fills. Green status → `Colors.success`; gold/amber → `Colors.amber`.
- **Apple sign-in button** got a hairline border so it's visible on light backgrounds.
- **Kept intentionally colored** (the deliberate "one pop"): the mic pulse rings
  (`TalkScreen.ring`, `PersonalizedDemoScreen.orbRing`) and the subtle Talk aurora —
  these sit behind the mic, which itself stays `heroMicGradient` even in mono.

---

## Other high-value fixes (applied)

- **🔴 Debug stamp on the production hero** — the Talk screen rendered
  `code … · flow: processing · from: whatsapp` for *every* user. Kept the
  `code <bundle>` part (the founder reads it to verify OTA ships) but gated the
  `flow:`/`from:` dev noise behind `__DEV__`.
- **Misleading success toast** — the Talk toast always showed a green ✓, even for
  errors ("Couldn't polish…", "Free polishes used up"). Now shows an amber alert
  icon for failure messages, green check for success.
- **Paywall "Start free trial" with no trial** — in placeholder/dev mode there is no
  trial, so the CTA now reads "Get VibeFlow Pro" there; the real build (whose package
  *does* offer a trial, confirmed on-device) keeps "Start free trial". Avoids an
  App-Store-review / trust issue.
- **Paywall busy state** — `Restore purchases` / `Maybe later` are now disabled+dimmed
  during a purchase (added a `disabled` prop to the kit `GhostButton`).
- **Broken "Rate VibeFlow" link (iOS)** — pointed at the App Store homepage; now the
  real product URL with `?action=write-review` (id 6787420544).
- **Touch targets** — Settings Sign out / **Delete account** were ~28px tall; bumped
  to a 44px min target.
- **Kit a11y/robustness** — tappable `Card` now has `accessibilityRole="button"` + a
  haptic; non-scroll `Screen` now respects the bottom safe-area inset.
- **Keyboard (safe subset):** mic + Format buttons got `contentDescription`s (state-aware
  "Start/Stop dictation"); the wordless `✍️ …` status → "Finishing up…"; the Format
  button now dims to 0.5 alpha while the network call runs.

---

## Deferred — recommend doing with the phone in hand (need visual verification)

These are real and worth doing, but they're structural or need on-device eyes, so
they weren't applied blind:

1. **Keyboard theme-awareness (high).** The IME hardcodes a dark-purple palette and
   ignores the user's light/mono choice — a mono/light user gets a purple keyboard.
   Fix: read `app_theme`/`app_palette` from shared prefs in `onCreateInputView` and
   resolve the same 4 palettes as `colors.ts` (keep the mic on `heroMicGradient`).
   Medium effort, Kotlin, **must be tested on-device** across all 4 palettes.
2. **Keyboard key press-states (high).** Char/special keys give only haptic feedback,
   no visual press — add a `StateListDrawable` pressed color. Test feel on-device.
3. **UpdateBanner light/mono (high).** Built entirely from hardcoded gold; looks like a
   bug in light mode and violates mono. Gate the gold to the color palette; fall back to
   `Colors.surface`/`Colors.ink`/`Colors.brand` otherwise.
4. **A11y label sweep (medium).** Many bespoke `Pressable`s across Talk/Settings/
   Onboarding/Paywall lack `accessibilityRole`/`Label`/`State`. The kit components set
   these; the fix is to add labels to the hand-rolled buttons (or reuse kit buttons).
5. **Auth-button loading state (medium).** Apple/Google buttons don't show a spinner
   during the sign-in round-trip → users tap twice. Swap label for `ActivityIndicator`
   while `authBusy`.
6. **Snippets/Corrections sheets + keyboard (medium).** Bottom-anchored add/edit sheets
   have no `KeyboardAvoidingView`, so the software keyboard covers the Save button.
7. **Talk draft overflow (medium).** A long reformatted draft pushes Save off-screen;
   cap the preview height with an internal scroll.
8. **Smart-formatting toggle (medium).** Toggling while signed out just buzzes and
   snaps back (the comment claims it routes to the paywall, but nothing happens) —
   disable it when signed out, or route to sign-in.
9. **Onboarding "read aloud" has no permission-denied state (medium)** — a denied mic
   just looks dead; add an inline retry + "Open Settings".
10. **Nice-to-haves (low):** crossfade the demo before→after; live RMS pulse on the
    keyboard mic; unify the two add/edit bottom sheets; `Appearance`/`Theme` section
    labels are both "theme" (rename to "Light & dark" / "Colour palette");
    caption/`inkFaint` contrast in light mode.

---

*Full per-surface findings are in the review transcript; this doc is the actionable
synthesis. Applied changes are in the same commit as this file.*
