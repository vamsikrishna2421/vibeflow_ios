import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * JS surface for the App Group bridge. Writing here makes data visible to the
 * native keyboard extension. Falls back to no-ops in Expo Go / on Android (where
 * the native module isn't present), so app code can call it unconditionally.
 */
const native = requireOptionalNativeModule<{
  setItem(key: string, value: string): void;
  getItem(key: string): string | null;
  removeItem(key: string): void;
}>('VibeflowAppGroup');

export const AppGroupKeys = {
  latest: 'latest_dictation',
  history: 'history_json',
  snippets: 'snippets_json',
} as const;

export function setItem(key: string, value: string): void {
  native?.setItem(key, value);
}

export function getItem(key: string): string | null {
  return native?.getItem(key) ?? null;
}

export function removeItem(key: string): void {
  native?.removeItem(key);
}

export const isAvailable = native != null;
