/**
 * RevenueCat (Apple IAP) glue. The RevenueCat App User ID is set to the Supabase
 * user id, so the RevenueCat→Supabase webhook can flip `profiles.is_pro` for the
 * right account — which is what actually lifts the server-side AI quota to unlimited.
 *
 * The iOS SDK key is publishable (like the Supabase anon key). Fill it in below from
 * RevenueCat → Project → API keys → "Public app-specific (Apple)". Until it's set,
 * every call is a safe no-op so the app runs unchanged.
 */
import Purchases, { LOG_LEVEL } from 'react-native-purchases';

// TODO(founder): paste the RevenueCat Apple public SDK key (looks like "appl_XXXXXXXX").
export const REVENUECAT_IOS_KEY = 'appl_REPLACE_WITH_YOUR_KEY';

const ENTITLEMENT_ID = 'pro'; // must match the entitlement identifier in RevenueCat

let configured = false;

export function revenueCatReady(): boolean {
  return configured;
}

/** Configure once at app launch. No-op until a real key is set. */
export function configureRevenueCat(): void {
  if (configured) return;
  if (!REVENUECAT_IOS_KEY || REVENUECAT_IOS_KEY.includes('REPLACE')) return;
  try {
    if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.WARN);
    Purchases.configure({ apiKey: REVENUECAT_IOS_KEY });
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
