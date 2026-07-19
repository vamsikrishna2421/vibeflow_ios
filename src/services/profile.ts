/**
 * Cloud profile (name + occupation) for signed-in users, stored in the
 * `user_profiles` table (columns `display_name`, `title`). Kept deliberately
 * separate from `profiles` (billing/quota) — the client has read-only RLS on
 * `profiles` (writes go through service-role edge functions), whereas
 * `user_profiles` grants each user insert/update/select on *their own* row.
 *
 * Powers two things: the "welcome back {name}" greeting when a returning user
 * signs in on a fresh install, and a professions breakdown (group by title).
 * No voice or transcripts are ever stored here.
 */
import { supabase } from './supabase';

export interface CloudProfile {
  name: string;
  occupation: string;
}

/** Read the signed-in user's saved profile, or null if there's none / not signed in. */
export async function fetchCloudProfile(): Promise<CloudProfile | null> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('display_name, title')
    .maybeSingle();
  if (error || !data) return null;
  const name = (data.display_name ?? '').trim();
  const occupation = (data.title ?? '').trim();
  if (!name && !occupation) return null;
  return { name, occupation };
}

/**
 * Upsert the signed-in user's profile. Silently no-ops when not signed in, so
 * callers can fire-and-forget. RLS restricts the write to the user's own row.
 */
export async function saveCloudProfile(name: string, occupation: string): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const id = session?.user?.id;
  if (!id) return;
  await supabase.from('user_profiles').upsert(
    {
      id,
      display_name: name.trim() || null,
      title: occupation.trim() || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );
}
