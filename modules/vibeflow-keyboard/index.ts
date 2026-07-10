/**
 * JS surface for the VibeFlow Android keyboard (InputMethodService).
 *
 * Android-only. On iOS (or Expo Go) the native module is absent and every call is
 * a safe no-op — the iOS keyboard is a separate app-extension, so app code can call
 * these unconditionally and gate on `isAvailable` / Platform.OS.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

const native = requireOptionalNativeModule<{
  /** Is the VibeFlow keyboard in the system's list of ENABLED input methods? */
  isEnabled(): boolean;
  /** Is the VibeFlow keyboard the CURRENTLY-SELECTED default input method? */
  isChosen(): boolean;
  /** Open Settings → System → Languages & input → On-screen keyboard list. */
  openImeSettings(): void;
  /** Pop the system "choose input method" switcher so the user can pick VibeFlow. */
  openImePicker(): void;
  /** Share the signed-in session with the keyboard process so it can call Smart
   *  Formatting. Pass empty jwt to clear on sign-out. */
  setAuth(jwt: string, url: string, anonKey: string, deviceId: string): void;
  /** Whether the keyboard should offer AI Smart Formatting (Pro / signed-in). */
  setPolishEnabled(enabled: boolean): void;
}>('VibeFlowKeyboard');

export const isAvailable = native != null;

export function isEnabled(): boolean {
  return native?.isEnabled() ?? false;
}
export function isChosen(): boolean {
  return native?.isChosen() ?? false;
}
export function openImeSettings(): void {
  native?.openImeSettings();
}
export function openImePicker(): void {
  native?.openImePicker();
}
export function setAuth(jwt: string | null, url: string, anonKey: string, deviceId: string): void {
  native?.setAuth(jwt ?? '', url, anonKey, deviceId);
}
export function setPolishEnabled(enabled: boolean): void {
  native?.setPolishEnabled(enabled);
}
