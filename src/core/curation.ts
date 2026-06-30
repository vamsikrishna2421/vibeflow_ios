/**
 * Deterministic, fully-offline curation of raw speech-to-text output — the
 * faithful TypeScript port of the Android `:core` `TextCuration`. Behaviour is
 * kept identical so dictation formats the same on iOS and Android.
 *
 * On-device recognizers emit lowercase, lightly-punctuated text, so this layer:
 *  - applies spoken layout commands ("new line", "new paragraph"),
 *  - applies spoken punctuation ("period", "comma", "question mark", …),
 *  - normalises spacing around punctuation,
 *  - fixes the lone pronoun "i" -> "I" (and contractions),
 *  - capitalises the first letter + sentence starts,
 *  - optionally strips vocalised fillers and collapses repeated phrases.
 *
 * Every function is pure (no I/O) so it's fast, offline, and unit-tested. Lives
 * in JS (not the native keyboard), so it is OTA-updatable.
 *
 * NOTE: written WITHOUT regex lookbehind — Hermes (React Native's engine) has
 * historically lacked `(?<=…)`, so the equivalent leading-capture form is used.
 */

export interface CurationOptions {
  spokenCommands: boolean;
  spokenPunctuation: boolean;
  capitalizeSentences: boolean;
  capitalizeFirst: boolean;
  fixPronounI: boolean;
  stripFillers: boolean;
  autoPeriod: boolean;
  dedupeRepeats: boolean;
  fillers: string[];
}

/** Conservative, unambiguous vocalised fillers. Mirrors the desktop default set. */
export const DEFAULT_FILLERS = ['um', 'uh', 'umm', 'uhh', 'uhm', 'mm', 'hmm', 'er', 'ah'];

export function defaultCurationOptions(
  overrides: Partial<CurationOptions> = {},
): CurationOptions {
  return {
    spokenCommands: true,
    spokenPunctuation: true,
    capitalizeSentences: true,
    capitalizeFirst: true,
    fixPronounI: true,
    stripFillers: false,
    autoPeriod: false,
    dedupeRepeats: true,
    fillers: DEFAULT_FILLERS,
    ...overrides,
  };
}

/**
 * Spoken punctuation map: phrase a user can say -> the literal it becomes.
 * Multi-word phrases are matched before single words (longest-first).
 */
export const SPOKEN_PUNCTUATION: ReadonlyArray<readonly [string, string]> = [
  ['exclamation point', '!'],
  ['exclamation mark', '!'],
  ['question mark', '?'],
  ['open parenthesis', '('],
  ['close parenthesis', ')'],
  ['open paren', '('],
  ['close paren', ')'],
  ['open quote', '"'],
  ['close quote', '"'],
  ['ellipsis', '…'],
  ['semicolon', ';'],
  ['colon', ':'],
  ['comma', ','],
  ['period', '.'],
  ['full stop', '.'],
  ['hyphen', '-'],
  ['dash', ' — '],
  ['ampersand', '&'],
  ['asterisk', '*'],
  ['percent sign', '%'],
  ['dollar sign', '$'],
  ['at sign', '@'],
];

// --- regex helpers -----------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word, case-insensitive replacement with a LITERAL replacement string. */
function replaceWord(text: string, word: string, replacement: string): string {
  const w = word.trim();
  if (!w) return text;
  const re = new RegExp('\\b' + escapeRegExp(w) + '\\b', 'gi');
  return text.replace(re, () => replacement);
}

// --- curation pieces ---------------------------------------------------------

const WHITESPACE = /\s+/;

/**
 * Collapse an immediately-repeated phrase to a single copy — a recogniser that
 * emits "send the report send the report" becomes "send the report". Only phrases
 * of `minPhrase` words or more collapse, so deliberate short repeats ("no no",
 * "very very") survive.
 */
export function collapseRepeats(text: string, minPhrase = 3, maxPhrase = 8): string {
  if (!text.trim()) return text;
  const toks = text.split(WHITESPACE).filter((t) => t.length > 0);
  if (toks.length < minPhrase * 2) return text;
  const out: string[] = [];
  let i = 0;
  while (i < toks.length) {
    const maxL = Math.min(maxPhrase, Math.floor((toks.length - i) / 2));
    let matched = 0;
    for (let l = maxL; l >= minPhrase; l--) {
      let equal = true;
      for (let j = 0; j < l; j++) {
        if (toks[i + j].toLowerCase() !== toks[i + l + j].toLowerCase()) {
          equal = false;
          break;
        }
      }
      if (equal) {
        matched = l;
        break;
      }
    }
    if (matched > 0) {
      for (let j = 0; j < matched; j++) out.push(toks[i + j]);
      i += matched * 2;
    } else {
      out.push(toks[i]);
      i += 1;
    }
  }
  return out.join(' ');
}

/** Strip standalone vocalised fillers (um, uh, …) — conservative & offline. */
export function removeFillers(text: string, fillers: string[] = DEFAULT_FILLERS): string {
  if (!text) return text;
  const sorted = [...fillers].sort((a, b) => b.length - a.length);
  const alt = sorted.map(escapeRegExp).join('|');
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const onlyLine = new RegExp(`^[ \\t,]*(?:${alt})(?:[ \\t,]+(?:${alt}))*[ \\t,]*$`, 'i');
  const leading = new RegExp(`^[ \\t]*(?:${alt})(?:[ \\t]*,)?(?=[ \\t]|$)`, 'i');
  const internal = new RegExp(`[ \\t]+(?:${alt})(?=[ \\t])`, 'gi');
  const trailing = new RegExp(`[ \\t]*,?[ \\t]+(?:${alt})[ \\t]*$`, 'i');

  const out: string[] = [];
  for (const line of normalized.split('\n')) {
    const stripped = line.trim();
    if (stripped.length > 0 && onlyLine.test(stripped)) continue;
    let l = line.replace(leading, '');
    let prev: string | null = null;
    while (prev !== l) {
      // fixpoint: clear consecutive fillers ("um uh")
      prev = l;
      l = l.replace(internal, '');
    }
    l = l.replace(trailing, '');
    out.push(l.replace(/[ \t]{2,}/g, ' ').replace(/^[ \t]+|[ \t]+$/g, ''));
  }
  return out.join('\n');
}

/** Replace spoken punctuation phrases ("comma", "question mark") with literals. */
export function applySpokenPunctuation(text: string): string {
  if (!text) return text;
  let out = text;
  // Longest phrases first so "question mark" isn't half-matched by "mark".
  const sorted = [...SPOKEN_PUNCTUATION].sort((a, b) => b[0].length - a[0].length);
  for (const [phrase, mark] of sorted) {
    out = replaceWord(out, phrase, mark);
  }
  return out;
}

function addTrailingPeriod(text: string): string {
  const t = text.replace(/[ \t\n]+$/g, '');
  if (!t) return text;
  const last = t[t.length - 1];
  return /[A-Za-z0-9]/.test(last) ? t + '.' : text;
}

function capitalize(text: string, sentences: boolean, first: boolean): string {
  let out = text;
  if (first) {
    out = out.replace(/^(\s*)([a-z])(?=[a-z]*\b)/g, (_m, p1, p2) => p1 + p2.toUpperCase());
  }
  if (sentences) {
    out = out.replace(/([.!?]\s+)([a-z])(?=[a-z]*\b)/g, (_m, p1, p2) => p1 + p2.toUpperCase());
    out = out.replace(/(\n[ \t]*)([a-z])(?=[a-z]*\b)/g, (_m, p1, p2) => p1 + p2.toUpperCase());
  }
  return out;
}

/** Main pipeline: turn raw engine text into tidy written text. */
export function curate(
  text: string,
  options: CurationOptions = defaultCurationOptions(),
): string {
  if (!text) return '';
  let out = text;

  if (options.dedupeRepeats) out = collapseRepeats(out);
  if (options.stripFillers) out = removeFillers(out, options.fillers);
  if (options.spokenCommands) {
    out = out.replace(/\bnew\s+paragraph\b/gi, '\n\n');
    out = out.replace(/\bnew\s+line\b|\bnext\s+line\b/gi, '\n');
  }
  if (options.spokenPunctuation) out = applySpokenPunctuation(out);

  // space BEFORE clause/sentence punctuation → removed
  out = out.replace(/[ \t]+([,.!?;:…])/g, '$1');
  // space AFTER punctuation, but only when NOT glued to an alphanumeric on the left
  // (protects emails, URLs, decimals, versions). Lookbehind-free: capture the
  // leading boundary (start-of-string or a non-alphanumeric) and re-emit it.
  out = out.replace(/(^|[^A-Za-z0-9])([,.!?;:])(?=[A-Za-z])/g, (_m, p1, p2) => p1 + p2 + ' ');
  out = out.replace(/[ \t]{2,}/g, ' ');
  out = out.replace(/[ \t]*\n[ \t]*/g, '\n');

  if (options.fixPronounI) {
    out = out.replace(/\bi('(?:m|ve|ll|d|s|re))\b/gi, (_m, p1) => 'I' + p1);
    out = out.replace(/\bi\b/g, 'I');
  }
  if (options.autoPeriod) out = addTrailingPeriod(out);
  if (options.capitalizeSentences || options.capitalizeFirst) {
    out = capitalize(out, options.capitalizeSentences, options.capitalizeFirst);
  }
  return out.trim();
}
