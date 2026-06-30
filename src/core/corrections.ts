/**
 * Applies learned "heard → meant" corrections to recognized text. Whole-word,
 * case-insensitive; the replacement keeps its stored casing ("cubanet" ->
 * "Kubernetes"). Port of Android `:core` `Corrections`.
 *
 * Lookbehind-free (Hermes-safe): the Kotlin version used `(?<![\p{L}\p{N}])`;
 * here the leading boundary is captured and re-emitted instead.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function applyCorrections(text: string, map: Record<string, string>): string {
  const keys = Object.keys(map).filter((k) => k.trim().length > 0);
  if (!text || keys.length === 0) return text;
  // Longest key first so multi-word corrections win.
  keys.sort((a, b) => b.length - a.length);
  const alt = keys.map(escapeRegExp).join('|');
  // (^|[^L/N]) leading boundary + the matched key + a trailing non-L/N lookahead.
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${alt})(?![\\p{L}\\p{N}])`, 'giu');
  return text.replace(re, (_m, lead: string, hit: string) => {
    const canonical = keys.find((k) => k.toLowerCase() === hit.toLowerCase());
    return lead + (canonical != null ? map[canonical] : hit);
  });
}
