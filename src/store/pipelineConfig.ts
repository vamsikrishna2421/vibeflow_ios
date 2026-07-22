/**
 * Bridges app state → the pure `@/core` pipeline. Turns the user's settings,
 * snippets, vocabulary and corrections into a `PipelineConfig`, and classifies a
 * raw utterance as either an edit *command* or *text* to insert.
 */
import {
  PipelineConfig,
  VoiceCommand,
  defaultPipelineConfig,
  parseVoiceCommand,
  processPipeline,
  withTrailingSpace,
} from '@/core';
import type { AppSettings, Correction, Snippet, Term } from './types';

export function buildPipelineConfig(
  settings: AppSettings,
  snippets: Snippet[],
  vocabulary: Term[],
  corrections: Correction[],
): PipelineConfig {
  const snippetMap: Record<string, string> = {};
  for (const s of snippets) {
    const t = s.trigger.trim();
    if (t) snippetMap[t] = s.expansion;
  }

  const correctionMap: Record<string, string> = {};
  for (const c of corrections) {
    const f = c.from.trim();
    if (f) correctionMap[f] = c.to;
  }

  return defaultPipelineConfig({
    vocabulary: vocabulary.map((t) => t.term),
    snippets: snippetMap,
    corrections: correctionMap,
    curation: settings.curation,
  });
}

export type DictationOutcome =
  | { kind: 'command'; command: VoiceCommand; raw: string }
  | { kind: 'text'; text: string; raw: string };

/**
 * Classify + format a raw utterance. If voice commands are enabled and the entire
 * utterance is a known command ("scratch that"), returns it as a command;
 * otherwise runs the full text pipeline and applies the trailing-space rule.
 */
export function runDictation(
  raw: string,
  settings: AppSettings,
  config: PipelineConfig,
): DictationOutcome {
  const trimmed = raw.trim();

  if (settings.voiceCommands) {
    const command = parseVoiceCommand(trimmed);
    if (command) return { kind: 'command', command, raw: trimmed };
  }

  const text = withTrailingSpace(processPipeline(trimmed, config), settings.trailingSpace);
  return { kind: 'text', text, raw: trimmed };
}
