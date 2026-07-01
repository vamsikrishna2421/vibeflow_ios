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
}
