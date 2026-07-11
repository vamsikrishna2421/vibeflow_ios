/**
 * VibeFlow design tokens — selectable palette × scheme, resolved ONCE at JS launch.
 *
 * Two axes, both persisted in the App Group and applied via an instant JS reload
 * (Settings → Appearance / Theme):
 *   • scheme  : light | dark        ("app_theme",   default: system → dark)
 *   • palette : color | mono        ("app_palette", default: color)
 *
 * COLOR = the original vibrant brand (purple → blue).
 * MONO  = a black/white/gray world (the VibeFlow logo look) — with the main mic
 *         button kept colourful via `heroMicGradient` as the single deliberate pop.
 */
import { Appearance } from 'react-native';

import { getItem } from '../store/appGroup';
import { prefGet } from '../store/prefs';

// ---- COLOR palette (original) ----------------------------------------------
const COLOR_DARK = {
  background: '#0B0A14', surface: '#120F18', surfaceVariant: '#1A1726', outline: '#2A2740',
  ink: '#FFFFFF', inkSoft: '#A7A3C2', inkFaint: '#6E6A8A',
  brand: '#7C5CFF', onBrand: '#FFFFFF', accentRed: '#E54749', success: '#43E6C1', amber: '#F5B544',
  hairline: 'rgba(255,255,255,0.08)', chipBg: 'rgba(255,255,255,0.06)',
  statInner: '#151022', karaokeDim: 'rgba(255,255,255,0.55)',
};
const COLOR_LIGHT: typeof COLOR_DARK = {
  background: '#F5F4FA', surface: '#FFFFFF', surfaceVariant: '#EFEDF7', outline: '#DCD8E8',
  ink: '#171226', inkSoft: '#544E6B', inkFaint: '#8B85A0',
  brand: '#6A48F5', onBrand: '#FFFFFF', accentRed: '#DC3B3D', success: '#0FA47F', amber: '#C98F0A',
  hairline: 'rgba(23,18,38,0.08)', chipBg: 'rgba(23,18,38,0.05)',
  statInner: '#FFFFFF', karaokeDim: 'rgba(23,18,38,0.5)',
};

// ---- MONO palette (black/white/gray) ---------------------------------------
const MONO_DARK: typeof COLOR_DARK = {
  background: '#0A0A0C', surface: '#131316', surfaceVariant: '#1C1C21', outline: '#2C2C33',
  ink: '#FFFFFF', inkSoft: '#A6A6AE', inkFaint: '#6C6C76',
  brand: '#ECECF1', onBrand: '#0A0A0C', accentRed: '#CC5F60', success: '#C4CBCF', amber: '#E3B24E',
  hairline: 'rgba(255,255,255,0.08)', chipBg: 'rgba(255,255,255,0.06)',
  statInner: '#141418', karaokeDim: 'rgba(255,255,255,0.55)',
};
const MONO_LIGHT: typeof COLOR_DARK = {
  background: '#F4F4F6', surface: '#FFFFFF', surfaceVariant: '#ECECEF', outline: '#DADADE',
  ink: '#17171A', inkSoft: '#55555E', inkFaint: '#8A8A93',
  brand: '#1C1C20', onBrand: '#FFFFFF', accentRed: '#C24B4C', success: '#5D6B65', amber: '#B98A2A',
  hairline: 'rgba(23,23,26,0.08)', chipBg: 'rgba(23,23,26,0.05)',
  statInner: '#FFFFFF', karaokeDim: 'rgba(23,23,26,0.5)',
};

// Read the cross-platform prefs store first (persists on Android + iOS), then
// fall back to the App Group (kept so the iOS keyboard extension stays in sync),
// then the OS default. The App Group no-ops off-iOS, which is why the prefs store
// is the primary source of truth for the standalone app's theme.
function resolvePref(key: string): string | null {
  try {
    return prefGet(key) ?? getItem(key);
  } catch {
    return null;
  }
}

function resolveScheme(): 'light' | 'dark' {
  const pref = resolvePref('app_theme');
  if (pref === 'light' || pref === 'dark') return pref;
  return Appearance.getColorScheme() === 'light' ? 'light' : 'dark';
}

function resolvePalette(): 'color' | 'mono' {
  const pref = resolvePref('app_palette');
  if (pref === 'color' || pref === 'mono') return pref;
  return 'color'; // default: the vibrant original
}

export const themeName: 'light' | 'dark' = resolveScheme();
export const paletteName: 'color' | 'mono' = resolvePalette();
export const isLight = themeName === 'light';
export const isMono = paletteName === 'mono';

const PALETTES = {
  color: { light: COLOR_LIGHT, dark: COLOR_DARK },
  mono: { light: MONO_LIGHT, dark: MONO_DARK },
} as const;

export const Colors = PALETTES[paletteName][themeName];

type Grad = readonly [string, string, ...string[]];

/** Brand gradient — logo, active states, AI effects (mono = grayscale). */
export const brandGradient: Grad = isMono
  ? ['#FFFFFF', '#C9C9D0', '#8E8E97']
  : ['#A855F7', '#7C5CFF', '#56B6FF'];

/** Secondary gradient for quick-action buttons (mono = grayscale). */
export const micGradient: Grad = isMono ? ['#F2F2F5', '#9A9AA2'] : ['#8B5CF6', '#5FA8FF'];

/** The MAIN mic button ALWAYS keeps its colour — the one deliberate pop even in mono. */
export const heroMicGradient: Grad = ['#8B5CF6', '#5FA8FF'];

export const Radius = { card: 22, chip: 12, pill: 999 } as const;
export const Spacing = { gutter: 20, gap: 12 } as const;
