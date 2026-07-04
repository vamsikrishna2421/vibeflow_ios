/**
 * Read the user's remaining free AI polishes WITHOUT consuming any — mirrors the
 * server's `reserve_polish` bucket logic (welcome lifetime → then weekly rolling),
 * reading only RLS-readable rows (`profiles` own row + public `app_status` limits).
 * Used for the "N free left" readout; Pro = unlimited.
 */
import { supabase } from './supabase';

export interface Quota {
  isPro: boolean;
  /** Remaining in the active free bucket; -1 when Pro (unlimited). */
  remaining: number;
  /** true = weekly bucket ("… this week"), false = the one-time welcome bucket. */
  weekly: boolean;
}

function olderThan7Days(iso: string): boolean {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return true;
  return Date.now() - t >= 7 * 24 * 60 * 60 * 1000;
}

export async function fetchQuota(): Promise<Quota | null> {
  const { data: sess } = await supabase.auth.getSession();
  if (!sess?.session) return null;
  try {
    const [{ data: prof }, { data: cfg }] = await Promise.all([
      supabase.from('profiles').select('is_pro,free_used,week_used,week_start').maybeSingle(),
      supabase.from('app_status').select('welcome_limit,weekly_limit').maybeSingle(),
    ]);
    if (!prof) return null;
    const welcomeLimit = (cfg?.welcome_limit as number | undefined) ?? 50;
    const weeklyLimit = (cfg?.weekly_limit as number | undefined) ?? 20;

    if (prof.is_pro) return { isPro: true, remaining: -1, weekly: false };

    const freeUsed = (prof.free_used as number | undefined) ?? 0;
    if (freeUsed < welcomeLimit) {
      return { isPro: false, remaining: Math.max(0, welcomeLimit - freeUsed), weekly: false };
    }

    const ws = prof.week_start as string | null;
    const rolled = !ws || olderThan7Days(ws);
    const remaining = rolled ? weeklyLimit : Math.max(0, weeklyLimit - ((prof.week_used as number | undefined) ?? 0));
    return { isPro: false, remaining, weekly: true };
  } catch {
    return null;
  }
}

/** Friendly one-liner for a fetched quota (or a sensible fallback while loading). */
export function quotaLabel(q: Quota | null): string {
  if (!q) return '50 free AI polishes / week · Pro = unlimited';
  if (q.isPro) return 'Pro · unlimited AI polishes';
  const n = q.remaining;
  return `✨ ${n} free polish${n === 1 ? '' : 'es'} left${q.weekly ? ' this week' : ''}`;
}
