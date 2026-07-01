import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * JS surface for the Flow Session Live Activity (Dynamic Island). No-ops in Expo
 * Go / on Android / iOS < 16.2, so callers can invoke it unconditionally.
 */
const native = requireOptionalNativeModule<{
  isAvailable(): boolean;
  start(status: string): string | null;
  update(status: string, transcript: string): Promise<void>;
  stop(): Promise<void>;
}>('VibeflowLiveActivity');

export function liveActivityAvailable(): boolean {
  try {
    return native?.isAvailable() ?? false;
  } catch {
    return false;
  }
}

export function startLiveActivity(status = 'Listening…'): string | null {
  return native?.start(status) ?? null;
}

export function updateLiveActivity(status: string, transcript = ''): void {
  native?.update(status, transcript).catch(() => {});
}

export function stopLiveActivity(): void {
  native?.stop().catch(() => {});
}
