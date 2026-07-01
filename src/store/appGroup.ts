/**
 * Single entry point for the App Group bridge. The native module lives outside
 * `src/`, so we centralise the one relative import here; everything else imports
 * `@/store/appGroup`. Writing here makes data visible to the keyboard extension.
 */
export {
  setItem,
  getItem,
  removeItem,
  AppGroupKeys,
  isAvailable,
} from '../../modules/vibeflow-appgroup';
