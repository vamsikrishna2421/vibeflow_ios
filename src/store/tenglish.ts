/**
 * Starter set of common romanized Indian-language words ("Tenglish"/"Hinglish") —
 * Telugu and Hindi written in Latin letters. These are shared with the keyboard
 * (App Group → kbd_learned_words) so it treats them as valid words: it won't
 * autocorrect them away and will offer them as completions. Users add their own
 * via the Vocabulary screen; this just makes the common ones work out of the box.
 */

/** Common romanized Telugu. */
const TELUGU = [
  'avunu', 'kaadu', 'kadu', 'sare', 'ela', 'unnav', 'unnaru', 'unnava',
  'bagunnava', 'bagunnanu', 'bagunnaru', 'enti', 'emiti', 'emi', 'cheppu',
  'cheptha', 'telusu', 'teliyadu', 'kavali', 'vaddu', 'ekkada', 'eppudu',
  'enduku', 'evaru', 'meeru', 'nuvvu', 'nenu', 'manam', 'vaallu', 'chala',
  'chinna', 'pedda', 'ippudu', 'inka', 'tarwata', 'mundu', 'bagundi',
  'chesanu', 'chestha', 'randi', 'vellu', 'tinnava', 'annam', 'ante', 'kani',
  'mari', 'choodu', 'repu', 'ledu', 'undi', 'kastam', 'sepu', 'baga', 'chesav',
];

/** Common romanized Hindi. */
const HINDI = [
  'haan', 'nahi', 'nahin', 'kya', 'kaise', 'theek', 'accha', 'acha', 'bhai',
  'yaar', 'matlab', 'bas', 'chalo', 'thoda', 'bahut', 'kyunki', 'hai', 'karo',
  'raha', 'gaya', 'kaam', 'abhi', 'kal', 'aaj', 'kuch', 'sab', 'mera', 'tera',
];

/** De-duplicated starter word list for the keyboard's personal dictionary. */
export const TENGLISH_STARTER: string[] = Array.from(new Set([...TELUGU, ...HINDI]));
