/**
 * Managed Smart Formatting ("AI polish") — calls the same Supabase edge function
 * the Android app uses. Server owns the prompt, the quota (50 free/week, Pro =
 * unlimited) and the OpenAI key. Failures refund server-side, so callers can
 * safely fall back to the local pipeline text.
 */
import { deviceId, signOut } from './auth';
import { FUNCTIONS_URL, SUPABASE_ANON_KEY, supabase } from './supabase';

export type PolishStyle = 'cleanup' | 'message' | 'structured' | 'email' | 'notes' | 'auto';

export interface PolishResult {
  ok: boolean;
  text?: string;
  remaining?: number;
  isPro?: boolean;
  error?: 'signed_out' | 'limit_reached' | 'maintenance' | 'network' | 'other';
  message?: string;
}

export async function polish(text: string, style: PolishStyle = 'cleanup'): Promise<PolishResult> {
  const { data } = await supabase.auth.getSession();
  const jwt = data?.session?.access_token;
  if (!jwt) return { ok: false, error: 'signed_out' };

  let res: Response;
  try {
    res = await fetch(`${FUNCTIONS_URL}/polish`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        style,
        device_id: await deviceId(),
        platform: 'mobile',
      }),
    });
  } catch {
    return { ok: false, error: 'network' };
  }

  if (res.status === 402) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: 'limit_reached', isPro: body?.isPro ?? false, remaining: 0 };
  }
  if (res.status === 409) {
    // Another device took this account's mobile slot — sign out, like Android does.
    await signOut().catch(() => {});
    return { ok: false, error: 'signed_out', message: 'Signed in on another device' };
  }
  if (res.status === 503) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: 'maintenance', message: body?.message ?? '' };
  }
  if (!res.ok) return { ok: false, error: 'other' };

  const body = await res.json().catch(() => null);
  if (!body?.text) return { ok: false, error: 'other' };
  return { ok: true, text: body.text, remaining: body.remaining, isPro: body.isPro };
}
