/**
 * Mynah design tokens — one rhythm, one accent, adaptive palette.
 *
 * Theme resolution happens ONCE at JS launch (styles are created at module load,
 * so a theme change applies via an instant JS reload — Settings → Appearance):
 *   1. explicit user choice persisted in the App Group ("app_theme": light|dark)
 *   2. otherwise the system scheme
 *   3. otherwise dark (the brand's home turf)
 */
import { Appearance } from 'react-native';

import { getItem } from '../store/appGroup';

// MONOCHROME preview — neutral grays + white ink, matching the Mynah logo's
// black/white/gray world. The purple/teal are gone; the only warmth is a single
// restrained gold (`amber`) borrowed from the logo's beak, used sparingly for
// the recording pulse + Pro touches. `brand` (the primary accent) is near-white.
const DARK = {
  background: '#0A0A0C',
  surface: '#131316',
  surfaceVariant: '#1C1C21',
  outline: '#2C2C33',

  ink: '#FFFFFF',
  inkSoft: '#A6A6AE',
  inkFaint: '#6C6C76',

  brand: '#ECECF1',       // near-white — primary accent (buttons, active, links)
  accentRed: '#CC5F60',   // muted red — recording / destructive (functional only)
  success: '#C4CBCF',     // neutral light — success/checks
  amber: '#E3B24E',       // the logo's gold — one restrained warm accent (Pro, pulse)

  // Semantic extras (kept in both palettes)
  hairline: 'rgba(255,255,255,0.08)',
  chipBg: 'rgba(255,255,255,0.06)',
  statInner: '#141418',
  karaokeDim: 'rgba(255,255,255,0.55)',
};

const LIGHT: typeof DARK = {
  background: '#F4F4F6',
  surface: '#FFFFFF',
  surfaceVariant: '#ECECEF',
  outline: '#DADADE',

  ink: '#17171A',
  inkSoft: '#55555E',
  inkFaint: '#8A8A93',

  brand: '#1C1C20',       // near-black — primary accent on light
  accentRed: '#C24B4C',
  success: '#5D6B65',
  amber: '#B98A2A',

  hairline: 'rgba(23,23,26,0.08)',
  chipBg: 'rgba(23,23,26,0.05)',
  statInner: '#FFFFFF',
  karaokeDim: 'rgba(23,23,26,0.5)',
};

function resolveScheme(): 'light' | 'dark' {
  try {
    const pref = getItem('app_theme');
    if (pref === 'light' || pref === 'dark') return pref;
  } catch {
    // native module unavailable (Expo Go) → fall through to system
  }
  return Appearance.getColorScheme() === 'light' ? 'light' : 'dark';
}

export const themeName: 'light' | 'dark' = resolveScheme();
export const isLight = themeName === 'light';

export const Colors = isLight ? LIGHT : DARK;

/** Brand gradient — monochrome (white → gray). Logo, active states, AI effects. */
export const brandGradient = ['#FFFFFF', '#C9C9D0', '#8E8E97'] as const;

/** The mic / "tap to talk" gradient — monochrome (light → mid gray), the hero. */
export const micGradient = ['#F2F2F5', '#9A9AA2'] as const;

/** The MAIN mic button keeps its original colour — the one deliberate pop in the
 *  otherwise monochrome UI (purple → blue). Used only by the hero MicButton. */
export const heroMicGradient = ['#8B5CF6', '#5FA8FF'] as const;

export const Radius = {
  card: 22,
  chip: 12,
  pill: 999,
} as const;

export const Spacing = {
  gutter: 20,
  gap: 12,
} as const;
