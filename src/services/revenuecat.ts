/**
 * RevenueCat (IAP) glue for BOTH stores. The RevenueCat App User ID is set to the
 * Supabase user id, so the RevenueCat→Supabase webhook can flip `profiles.is_pro`
 * for the right account — which is what actually lifts the server-side AI quota to
 * unlimited.
 *
 * SDK keys are publishable (like the Supabase anon key), from RevenueCat →
 * Project → API keys → "Public app-specific". Until a platform's key is set,
 * every call on that platform is a safe no-op so the app runs unchanged.
 *
 * iOS note: key stays unset until the Apple account's Paid Apps Agreement is
 * signed (India entity change in flight) — Android monetizes first.
 */
import { Platform } from 'react-native';
import Purchases, { LOG_LEVEL } from 'react-native-purchases';

// TODO(founder): paste the RevenueCat Apple public SDK key once Paid Apps is signed.
export const REVENUECAT_IOS_KEY = 'appl_REPLACE_WITH_YOUR_KEY';
// RevenueCat Google public SDK key (Play app com.vibeflow.mobile).
export const REVENUECAT_ANDROID_KEY = 'goog_idpQxSobScOwDQBOrRgzcxHRfMG';

const ENTITLEMENT_ID = 'pro'; // must match the entitlement identifier in RevenueCat

let configured = false;

export function revenueCatReady(): boolean {
  return configured;
}

/** Configure once at app launch. No-op until the platform's real key is set. */
export function configureRevenueCat(): void {
  if (configured) return;
  const key = Platform.OS === 'ios' ? REVENUECAT_IOS_KEY : REVENUECAT_ANDROID_KEY;
  if (!key || key.includes('REPLACE')) return;
  try {
    if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.WARN);
    Purchases.configure({ apiKey: key });
    configured = true;
  } catch {
    // leave unconfigured; the app still works, IAP just stays inert
  }
}

/** Tie purchases to the signed-in Supabase account (call after sign-in). */
export async function identifyRevenueCat(supabaseUserId: string): Promise<void> {
  if (!configured || !supabaseUserId) return;
  try {
    await Purchases.logIn(supabaseUserId);
  } catch {}
}

export async function revenueCatLogout(): Promise<void> {
  if (!configured) return;
  try {
    await Purchases.logOut();
  } catch {}
}

/** True if the current customer has the Pro entitlement active right now. */
export async function checkProEntitlement(): Promise<boolean> {
  if (!configured) return false;
  try {
    const info = await Purchases.getCustomerInfo();
    return !!info.entitlements.active[ENTITLEMENT_ID];
  } catch {
    return false;
  }
}

/** Subscribe to entitlement changes; returns an unsubscribe fn. */
export function onProChange(cb: (isPro: boolean) => void): () => void {
  if (!configured) return () => {};
  const listener = (info: import('react-native-purchases').CustomerInfo) => {
    cb(!!info.entitlements.active[ENTITLEMENT_ID]);
  };
  Purchases.addCustomerInfoUpdateListener(listener);
  return () => {
    try {
      Purchases.removeCustomerInfoUpdateListener(listener);
    } catch {}
  };
}
