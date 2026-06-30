/**
 * VibeFlow design tokens — one rhythm, one accent, adaptive dark-first palette.
 * Ported from the Android premium redesign (Design.kt / Theme.kt) so both
 * platforms share the same brand feel.
 */
export const Colors = {
  // Surfaces (dark-first, like most keyboards / the Android app)
  background: '#0B0A14',
  surface: '#120F18',
  surfaceVariant: '#1A1726',
  outline: '#2A2740',

  // Text
  ink: '#FFFFFF',
  inkSoft: '#A7A3C2',
  inkFaint: '#6E6A8A',

  // Brand
  brand: '#7C5CFF',
  accentRed: '#E54749', // stop / recording
  success: '#43E6C1',
  amber: '#F5B544',
} as const;

/** The brand gradient (purple → indigo → sky) — logo, active states, AI effects. */
export const brandGradient = ['#A855F7', '#7C5CFF', '#56B6FF'] as const;

/** The mic / "tap to talk" gradient — purple → blue (the AI hero). */
export const micGradient = ['#8B5CF6', '#5FA8FF'] as const;

export const Radius = {
  card: 22,
  chip: 12,
  pill: 999,
} as const;

export const Spacing = {
  gutter: 20,
  gap: 12,
} as const;
