/**
 * Mynah's managed backend (same Supabase project the Android app uses — one
 * user base, one quota, both platforms). The URL + anon key are publishable;
 * real authority is the signed-in user's JWT. The OpenAI key lives ONLY server-side.
 */
import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';

import { kvGet, kvSet, kvRemove } from '@/store/kv';

export const SUPABASE_URL = 'https://emvstripgwywhcuxgjeg.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVtdnN0cmlwZ3d5d2hjdXhnamVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NjAwMDAsImV4cCI6MjA5ODEzNjAwMH0.qPj7pOZJwMg7HUUxOQa5blU9GUXxS0_S_K4I_MN-Svw';
export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

/** Session persistence via our existing SQLCipher-backed KV store. */
const storage = {
  getItem: (key: string) => kvGet(key),
  setItem: (key: string, value: string) => kvSet(key, value),
  removeItem: (key: string) => kvRemove(key),
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
