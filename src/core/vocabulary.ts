/**
 * Restores canonical casing/spelling of known terms (e.g. "github" -> "GitHub").
 * Whole-word, case-insensitive; longer terms win. Pure & offline. Port of the
 * Android `:core` `Vocabulary`.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function applyVocabulary(text: string, terms: string[]): string {
  if (!text || terms.length === 0) return text;
  let out = text;
  const sorted = terms
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .sort((a, b) => b.length - a.length);
  for (const term of sorted) {
    const re = new RegExp('\\b' + escapeRegExp(term) + '\\b', 'gi');
    out = out.replace(re, () => term);
  }
  return out;
}
