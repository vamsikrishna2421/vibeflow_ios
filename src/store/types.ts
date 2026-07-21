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
  /** The device's raw transcription before local/AI formatting — so History can show
   *  the "as heard" version next to the formatted one. Absent on older entries. */
  raw?: string;
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

/** Who the user is — captured in the first-run demo, used to personalise + prime ASR. */
export interface UserProfile {
  name: string;
  jobTitle: string;
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
  /** EXPERIMENTAL: chain the keyboard mic's 45s chunks so long dictation feels
   *  limitless (each chunk auto-saves, then the next begins). Off by default. */
  continuousDictation: boolean;
}

/** Everything that survives an app restart. */
export interface PersistedState {
  settings: AppSettings;
  history: Dictation[];
  snippets: Snippet[];
  vocabulary: Term[];
  corrections: Correction[];
  premium: boolean;
  /** Captured in the first-run demo (empty until then). */
  profile: UserProfile;
  /** True once the first-run personalised demo has been seen. Gates the demo. */
  demoCompleted: boolean;
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
    // On-device recognition by DEFAULT (2026-07-20) — private: your voice never leaves the
    // phone (true for BOTH the in-app mic and the keyboard). Users who want the larger,
    // more-accurate cloud model (Apple's speech service, same backend as the system
    // keyboard mic) can turn "On-device only" OFF in Settings. NOTE: verify on-device
    // keyboard CONTINUOUS dictation survives in the background (old cpulimit concern —
    // possibly stale post the 1.0.55 waveform-CPU fix); fall back to cloud default if not.
    onDeviceOnly: true,
    voiceCommands: true,
    smartFormat: false,
    autoCopy: false, // OFF by default: auto-copy triggers Android 13+'s intrusive
    //                  "Send to device" clipboard chip on every result. Users who
    //                  want it can re-enable in Settings → Auto-copy after dictation.
    haptics: true,
    continuousDictation: true, // limitless keyboard dictation, ON by default (1.0.71)
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
    profile: { name: '', jobTitle: '' },
    demoCompleted: false,
  };
}
