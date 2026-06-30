/**
 * The single source of truth for turning raw engine output into delivered text.
 * Port of Android `:core` `Pipeline`. Order matters:
 *   1. corrections — learned "heard → meant" fixes (operate on raw words),
 *   2. vocabulary  — restore canonical casing/spelling of known terms,
 *   3. snippets    — expand trigger phrases,
 *   4. curation    — spoken commands/punctuation, spacing, caps, fillers.
 */
import { applyCorrections } from './corrections';
import { curate, CurationOptions, defaultCurationOptions } from './curation';
import { expandSnippets } from './snippets';
import { applyVocabulary } from './vocabulary';

export interface PipelineConfig {
  vocabulary: string[];
  snippets: Record<string, string>;
  corrections: Record<string, string>;
  curation: CurationOptions;
}

export function defaultPipelineConfig(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return {
    vocabulary: [],
    snippets: {},
    corrections: {},
    curation: defaultCurationOptions(),
    ...overrides,
  };
}

export function processPipeline(raw: string, config: PipelineConfig): string {
  if (!raw || !raw.trim()) return '';
  let text = raw;
  text = applyCorrections(text, config.corrections);
  text = applyVocabulary(text, config.vocabulary);
  text = expandSnippets(text, config.snippets);
  text = curate(text, config.curation);
  return text;
}
