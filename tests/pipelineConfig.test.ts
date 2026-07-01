/**
 * Tests for the app↔core bridge: building a PipelineConfig from app state, and
 * classifying an utterance as an edit command vs text to insert. These are pure
 * (no React Native), so they run in plain Node with ts-jest.
 */
import { VoiceCommand } from '@/core';
import { buildPipelineConfig, runDictation } from '@/store/pipelineConfig';
import { Correction, Snippet, Term, defaultSettings } from '@/store/types';

const snippets: Snippet[] = [{ id: 1, trigger: 'my email', expansion: 'me@vibeflow.app' }];
const vocabulary: Term[] = [{ id: 1, term: 'GitHub' }];
const corrections: Correction[] = [{ id: 1, from: 'cubanetes', to: 'Kubernetes' }];

describe('buildPipelineConfig', () => {
  it('maps app state into a PipelineConfig', () => {
    const cfg = buildPipelineConfig(defaultSettings(), snippets, vocabulary, corrections);
    expect(cfg.snippets['my email']).toBe('me@vibeflow.app');
    expect(cfg.vocabulary).toContain('GitHub');
    expect(cfg.corrections['cubanetes']).toBe('Kubernetes');
    expect(cfg.curation.capitalizeFirst).toBe(true);
  });

  it('skips snippets/corrections with blank triggers', () => {
    const cfg = buildPipelineConfig(
      defaultSettings(),
      [{ id: 9, trigger: '   ', expansion: 'x' }],
      [],
      [{ id: 9, from: '  ', to: 'y' }],
    );
    expect(Object.keys(cfg.snippets)).toHaveLength(0);
    expect(Object.keys(cfg.corrections)).toHaveLength(0);
  });
});

describe('runDictation', () => {
  const settings = defaultSettings();
  const cfg = buildPipelineConfig(settings, snippets, vocabulary, corrections);

  it('detects a voice command when the whole utterance is one', () => {
    const out = runDictation('scratch that', settings, cfg);
    expect(out.kind).toBe('command');
    if (out.kind === 'command') expect(out.command).toBe(VoiceCommand.DeleteLast);
  });

  it('formats text and appends a trailing space', () => {
    const out = runDictation('hello world period', settings, cfg);
    expect(out.kind).toBe('text');
    if (out.kind === 'text') {
      expect(out.text).toBe('Hello world. ');
    }
  });

  it('expands snippets and restores vocabulary casing', () => {
    const out = runDictation('email me on github at my email', settings, cfg);
    expect(out.kind).toBe('text');
    if (out.kind === 'text') {
      expect(out.text).toContain('GitHub');
      expect(out.text).toContain('me@vibeflow.app');
    }
  });

  it('honours the trailingSpace setting when disabled', () => {
    const noSpace = { ...settings, trailingSpace: false };
    const out = runDictation('done', noSpace, cfg);
    if (out.kind === 'text') expect(out.text.endsWith(' ')).toBe(false);
  });

  it('does not treat a command as text when voice commands are disabled', () => {
    const off = { ...settings, voiceCommands: false };
    const out = runDictation('new line', off, cfg);
    // "new line" becomes a layout command inside curation → a newline, not text "new line"
    expect(out.kind).toBe('text');
  });
});
