/**
 * Reactive Supabase session for the managed AI tier: who's signed in, and the
 * last-known free-polish count (updated by every polish() response).
 */
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';

import { supabase } from '@/services/supabase';

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  return {
    ready,
    session,
    email: session?.user?.email ?? null,
    signedIn: !!session,
  };
}
