/**
 * App-facing entry point for the VibeFlow Android keyboard (InputMethodService).
 * Centralises the one relative import into the local native module; everything
 * else imports `@/services/keyboard`. All calls no-op off-Android.
 */
export {
  isAvailable,
  isEnabled,
  isChosen,
  openImeSettings,
  openImePicker,
  setAuth,
  setPolishEnabled,
} from '../../modules/vibeflow-keyboard';
