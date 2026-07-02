/**
 * VibeFlow design tokens — one rhythm, one accent, adaptive palette.
 *
 * Theme resolution happens ONCE at JS launch (styles are created at module load,
 * so a theme change applies via an instant JS reload — Settings → Appearance):
 *   1. explicit user choice persisted in the App Group ("app_theme": light|dark)
 *   2. otherwise the system scheme
 *   3. otherwise dark (the brand's home turf)
 */
import { Appearance } from 'react-native';

import { getItem } from '../store/appGroup';

const DARK = {
  background: '#0B0A14',
  surface: '#120F18',
  surfaceVariant: '#1A1726',
  outline: '#2A2740',

  ink: '#FFFFFF',
  inkSoft: '#A7A3C2',
  inkFaint: '#6E6A8A',

  brand: '#7C5CFF',
  accentRed: '#E54749',
  success: '#43E6C1',
  amber: '#F5B544',

  // Semantic extras (kept in both palettes)
  hairline: 'rgba(255,255,255,0.08)',
  chipBg: 'rgba(255,255,255,0.06)',
  statInner: '#151022',
  karaokeDim: 'rgba(255,255,255,0.55)',
};

const LIGHT: typeof DARK = {
  background: '#F5F4FA',
  surface: '#FFFFFF',
  surfaceVariant: '#EFEDF7',
  outline: '#DCD8E8',

  ink: '#171226',
  inkSoft: '#544E6B',
  inkFaint: '#8B85A0',

  brand: '#6A48F5',
  accentRed: '#DC3B3D',
  success: '#0FA47F',
  amber: '#C98F0A',

  hairline: 'rgba(23,18,38,0.08)',
  chipBg: 'rgba(23,18,38,0.05)',
  statInner: '#FFFFFF',
  karaokeDim: 'rgba(23,18,38,0.5)',
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
