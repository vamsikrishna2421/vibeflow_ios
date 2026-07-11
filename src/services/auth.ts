/**
 * Sign-in for the managed AI tier — same Supabase user base as Android.
 *  • Apple: native Sign in with Apple → identity token → Supabase session.
 *    (Required by the App Store since we offer third-party sign-in.)
 *  • Google: Supabase's web OAuth flow in an in-app browser, bounced back via
 *    the vibeflow:// scheme — no extra native SDK needed.
 * After sign-in we claim this device's slot (one active mobile device per user).
 */
import * as Linking from 'expo-linking';

import { kvGet, kvSet } from '@/store/kv';

import { FUNCTIONS_URL, SUPABASE_ANON_KEY, supabase } from './supabase';

/** Stable per-install device id (persisted; used for the backend device slot). */
export async function deviceId(): Promise<string> {
  const existing = await kvGet('device_id');
  if (existing) return existing;
  // Lazy import: expo-crypto's native module only exists in builds ≥ runtime 3.
  let id: string;
  try {
    const Crypto = await import('expo-crypto');
    id = Crypto.randomUUID();
  } catch {
    id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
  await kvSet('device_id', id);
  return id;
}

export async function signInWithApple(): Promise<void> {
  // Lazy import so this file stays loadable on binaries without the native module.
  const AppleAuthentication = await import('expo-apple-authentication');
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  });
  if (!credential.identityToken) throw new Error('Apple sign-in returned no token');
  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
  });
  if (error) throw error;
  await claimDevice();
}

export async function signInWithGoogle(): Promise<void> {
  const WebBrowser = await import('expo-web-browser');
  const redirectTo = Linking.createURL('auth');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error || !data?.url) throw error ?? new Error('No auth URL');
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success' || !result.url) throw new Error('Sign-in cancelled');
  // Exchange the tokens in the redirect fragment for a session.
  const params = new URLSearchParams(result.url.split('#')[1] ?? '');
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (!access_token || !refresh_token) throw new Error('No tokens in redirect');
  const { error: sessErr } = await supabase.auth.setSession({ access_token, refresh_token });
  if (sessErr) throw sessErr;
  await claimDevice();
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

/**
 * Permanently delete the signed-in user's account + all their data, then sign out
 * locally. Required by the App Store (Guideline 5.1.1(v)) and Google Play. The
 * server deletes the profile/devices rows and the auth user itself; we then clear
 * the local session so the app returns to the signed-out state. Does NOT cancel a
 * store subscription — the UI tells the user to do that separately.
 */
export async function deleteAccount(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const jwt = data?.session?.access_token;
  if (!jwt) throw new Error('You are not signed in.');
  const res = await fetch(`${FUNCTIONS_URL}/delete-account`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
  });
  // 200 = deleted now. 401 = the server no longer recognizes this user — i.e. the
  // account is ALREADY gone (a prior attempt succeeded but its 200 was lost on a
  // flaky network). Both are success: clear the local session so the app returns to
  // signed-out, and never loop forever telling the user a completed delete "failed".
  if (res.ok || res.status === 401) {
    await supabase.auth.signOut().catch(() => {});
    return;
  }
  // A real server-side failure (e.g. 500): the account still exists, so keep the user
  // signed in to retry, and surface the reason.
  let msg = 'Could not delete your account. Please try again.';
  try {
    const body = await res.json();
    if (body?.error) msg = `Deletion failed (${body.error}). Please try again.`;
  } catch {}
  throw new Error(msg);
}

/** Register this install as the active mobile device (supersedes older ones). */
export async function claimDevice(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const jwt = data?.session?.access_token;
  if (!jwt) return;
  try {
    await fetch(`${FUNCTIONS_URL}/claim-device`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ device_id: await deviceId(), platform: 'mobile' }),
    });
  } catch {
    // best-effort; polish re-checks the slot anyway
  }
}
