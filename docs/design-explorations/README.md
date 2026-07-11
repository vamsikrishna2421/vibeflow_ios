# VibeFlow — Approved visual redesign (2026-07-11)

GPT-5.6 Sol brainstorm → filtered & rendered by Claude → reviewed & approved by the founder.
These mockups are the **approved target look**. Implement to match; verify the real
React Native render in a TestFlight build before calling any of it done.
NOTE: never change app UI without a rendered preview + approval first.

| # | Item | Decision | Mockup |
|---|------|----------|--------|
| 01 | Palette shift | **Dropped** (too subtle to matter; keep current tokens) | — |
| 02 | Voice-orb hero | **Approved** — layered orb (halo rings, glow, top-left highlight, border) on the CURRENT palette; **keep** the "Speak naturally" hint + the 3-step guide under it | `orb_hero_v2.*` |
| 03 | Orb states | **Approved** — Idle "Ready" / Listening (double halo + amplitude bars) / Processing (rotating segmented ring + cyan-accent dots, "Formatting") | `orb_states.*` |
| 04 | App icon | **Direction C** (voice orb) — matches the in-app hero | `icons.*` (C = right) |
| 05 | Paywall | **Approved** — new identity, **single screen no scroll**, fixed pricing (Monthly $0.99/mo, Annual $9.99/yr) | `paywall_compact.*` |

Implementation notes:
- 02 + 03 are contained to `src/screens/TalkScreen.tsx` (mic component + waveform + status states). Listening amplitude bars need a live mic-RMS source — confirm it exists first.
- 05 → `src/screens/PaywallScreen.tsx` layout; also fix the iOS annual placeholder price so it's < 12x monthly.
- 04 → refine icon C into the real icon set (all sizes) before replacing app icon.
