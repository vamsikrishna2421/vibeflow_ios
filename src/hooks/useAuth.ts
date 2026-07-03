/**
 * Reactive Supabase session for the managed AI tier: who's signed in, and the
 * last-known free-polish count (updated by every polish() response).
 */
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';

import { supabase } from '@/services/supabase';
import { identifyRevenueCat, revenueCatLogout } from '@/services/revenuecat';

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      if (data.session?.user?.id) identifyRevenueCat(data.session.user.id);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      const uid = s?.user?.id;
      if (uid) identifyRevenueCat(uid);
      else revenueCatLogout();
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return {
    ready,
    session,
    email: session?.user?.email ?? null,
    signedIn: !!session,
  };
}
