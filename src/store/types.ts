/**
 * App data model — the serialisable shapes that the VibeFlow app persists and
 * shares with the native keyboard. Kept dependency-free (only `@/core` types) so
 * it can be imported anywhere, including tests.
 */
import { CurationOptions, defaultCurationOptions, RoutingMode } from '@/core';

/** A captured + formatted dictation. `id` is monotonic (newer = larger). */
export interface Dictation {
  id: number;
  text: string;
  createdAt: number;
  pinned: boolean;
}

/** A snippet/macro: say `trigger`, insert `expansion`. */
export interface Snippet {
  id: number;
  trigger: string;
  expansion: string;
}

/** A learned "heard → meant" correction. */
export interface Correction {
  id: number;
  from: string;
  to: string;
}

/** A vocabulary term whose canonical casing should be restored. */
export interface Term {
  id: number;
  term: string;
}

/** User-tunable behaviour. `curation` is the full set of pipeline toggles. */
export interface AppSettings {
  curation: CurationOptions;
  routingMode: RoutingMode;
  trailingSpace: boolean;
  language: string;
  onDeviceOnly: boolean;
  voiceCommands: boolean;
  smartFormat: boolean;
  autoCopy: boolean;
  haptics: boolean;
}

/** Everything that survives an app restart. */
export interface PersistedState {
  settings: AppSettings;
  history: Dictation[];
  snippets: Snippet[];
  vocabulary: Term[];
  corrections: Correction[];
  premium: boolean;
}

/** Languages offered for on-device recognition (BCP-47 codes). */
export const LANGUAGES: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'en-AU', label: 'English (Australia)' },
  { code: 'en-IN', label: 'English (India)' },
  { code: 'es-ES', label: 'Spanish (Spain)' },
  { code: 'es-MX', label: 'Spanish (Mexico)' },
  { code: 'fr-FR', label: 'French' },
  { code: 'de-DE', label: 'German' },
  { code: 'it-IT', label: 'Italian' },
  { code: 'pt-BR', label: 'Portuguese (Brazil)' },
  { code: 'hi-IN', label: 'Hindi' },
  { code: 'ja-JP', label: 'Japanese' },
];

export function languageLabel(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

export function defaultSettings(): AppSettings {
  return {
    curation: defaultCurationOptions(),
    routingMode: 'AUTO',
    trailingSpace: true,
    language: 'en-US',
    onDeviceOnly: true,
    voiceCommands: true,
    smartFormat: false,
    autoCopy: true,
    haptics: true,
  };
}

export function defaultPersistedState(): PersistedState {
  return {
    settings: defaultSettings(),
    history: [],
    snippets: [],
    vocabulary: [],
    corrections: [],
    premium: false,
  };
}
