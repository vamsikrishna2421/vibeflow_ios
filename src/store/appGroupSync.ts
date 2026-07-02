/**
 * Mirror the JS app's data into the App Group so the native keyboard can read it.
 * The keyboard decodes exactly these shapes:
 *   • latest_dictation : plain string (most-recent dictation text)
 *   • history_json     : [{ id:number, text:string, pinned:boolean }]  (newest first)
 *   • snippets_json    : flat [trigger, expansion, trigger, expansion, …] (preserves order)
 */
import { AppGroupKeys, setItem } from './appGroup';
import type { Dictation, Snippet } from './types';

export function syncToAppGroup(history: Dictation[], snippets: Snippet[]): void {
  const ordered = [...history].sort((a, b) => b.id - a.id);
  const latest = ordered[0]?.text ?? '';

  setItem(AppGroupKeys.latest, latest);
  setItem(
    AppGroupKeys.history,
    JSON.stringify(ordered.map((d) => ({ id: d.id, text: d.text, pinned: d.pinned }))),
  );

  const flat: string[] = [];
  for (const s of snippets) {
    if (s.trigger.trim()) {
      flat.push(s.trigger, s.expansion);
    }
  }
  setItem(AppGroupKeys.snippets, JSON.stringify(flat));

  // Next-word prediction model for the keyboard: bigrams mined from the user's own
  // dictations (word → top-3 words they usually say next). Grows with usage.
  const counts: Record<string, Record<string, number>> = {};
  for (const d of ordered.slice(0, 200)) {
    const words = d.text.toLowerCase().split(/[^a-z']+/).filter(Boolean);
    for (let i = 0; i < words.length - 1; i++) {
      const a = words[i];
      const b = words[i + 1];
      const m = (counts[a] ??= {});
      m[b] = (m[b] ?? 0) + 1;
    }
  }
  const top: Record<string, string[]> = {};
  for (const [a, m] of Object.entries(counts)) {
    top[a] = Object.entries(m)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 3)
      .map(([w]) => w);
  }
  setItem('kbd_bigrams', JSON.stringify(top));
}
