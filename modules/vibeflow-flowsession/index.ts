import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * JS surface for the Flow Session (see the Swift module for the architecture).
 * No-ops gracefully on Android / Expo Go so callers can invoke unconditionally.
 */
const native = requireOptionalNativeModule<{
  isActive(): boolean;
  start(): boolean;
  stop(): void;
  reassert(): void;
  notifyResultReady(): void;
  notifyStatus?(): void;
  addListener(event: string, listener: (payload?: any) => void): { remove(): void };
}>('VibeflowFlowSession');

/** Whether the native engine module is present in this binary at all. */
export function flowSessionModuleAvailable(): boolean {
  return native != null;
}

export function flowSessionActive(): boolean {
  try {
    return native?.isActive() ?? false;
  } catch {
    return false;
  }
}

/** Start the background session. Returns false if unavailable (e.g. Android). */
export function startFlowSession(): boolean {
  try {
    return native?.start() ?? false;
  } catch {
    return false;
  }
}

export function stopFlowSession(): void {
  try {
    native?.stop();
  } catch {}
}

/** Re-assert the audio keep-alive after a dictation ends. */
export function reassertFlowSession(): void {
  try {
    native?.reassert();
  } catch {}
}

/** Ping the keyboard that latest_dictation has a fresh result to insert. */
export function notifyResultReady(): void {
  try {
    native?.notifyResultReady();
  } catch {}
}

/** Ping the keyboard that kbd_flow_status changed (drives the mic animation). */
export function notifyFlowStatus(): void {
  try {
    native?.notifyStatus?.();
  } catch {}
}

/** Fired when the keyboard's mic is tapped during an active session. (Recognition
 * itself runs natively in the module; JS only reacts for UI/history.) */
export function addRecordToggleListener(listener: () => void): { remove(): void } | null {
  try {
    return native?.addListener('recordToggle', listener) ?? null;
  } catch {
    return null;
  }
}

/** Fired with the final text of each native flow utterance. `id` (v3 engines) is
 * the utterance's claim token: echo it to the App Group key `flow_claim_id` so the
 * native 8s raw-delivery fallback knows JS is alive and owns delivery. */
export function addUtteranceFinalListener(
  listener: (e: { text: string; id?: string }) => void,
): { remove(): void } | null {
  try {
    return native?.addListener('utteranceFinal', listener) ?? null;
  } catch {
    return null;
  }
}

/** Fired whenever the native engine's status changes (listening/processing/…). */
export function addFlowStatusListener(
  listener: (e: { status: string }) => void,
): { remove(): void } | null {
  try {
    return native?.addListener('flowStatus', listener) ?? null;
  } catch {
    return null;
  }
}
