/**
 * Text snippets / macros: say the trigger phrase, insert the expansion
 * (e.g. "my email" -> "you@example.com"). Whole-phrase, case-insensitive; longer
 * triggers win ("my work email" beats "my email"). Port of Android `:core`
 * `Snippets`.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function expandSnippets(text: string, snippets: Record<string, string>): string {
  const entries = Object.entries(snippets);
  if (!text || entries.length === 0) return text;
  let out = text;
  const sorted = entries.sort((a, b) => b[0].length - a[0].length);
  for (const [trigger, expansion] of sorted) {
    const t = trigger.trim();
    if (!t) continue;
    const re = new RegExp('\\b' + escapeRegExp(t) + '\\b', 'gi');
    out = out.replace(re, () => expansion);
  }
  return out;
}
