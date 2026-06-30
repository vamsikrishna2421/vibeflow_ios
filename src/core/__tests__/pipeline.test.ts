import { processPipeline, defaultPipelineConfig } from '../pipeline';
import { defaultCurationOptions } from '../curation';

// Faithful port of Android PipelineScenarioTest — realistic raw, lowercase,
// unpunctuated dictations through the full pipeline with the app's defaults
// (auto-period ON, like the shipping Settings).
function run(
  raw: string,
  opts: {
    vocabulary?: string[];
    snippets?: Record<string, string>;
    stripFillers?: boolean;
  } = {},
): string {
  return processPipeline(
    raw,
    defaultPipelineConfig({
      vocabulary: opts.vocabulary ?? [],
      snippets: opts.snippets ?? {},
      curation: defaultCurationOptions({ autoPeriod: true, stripFillers: opts.stripFillers ?? false }),
    }),
  );
}

describe('Pipeline scenarios', () => {
  test('plain sentence gets capped and punctuated', () => {
    expect(run("let's ship this today")).toBe("Let's ship this today.");
  });

  test('spoken punctuation forms a clean sentence', () => {
    expect(
      run('hey comma can you review the pr question mark thanks period', { vocabulary: ['PR'] }),
    ).toBe('Hey, can you review the PR? Thanks.');
  });

  test('new paragraph produces two sentences', () => {
    expect(run('first thought new paragraph second thought')).toBe(
      'First thought\n\nSecond thought.',
    );
  });

  test('vocabulary fixes casing mid-sentence', () => {
    expect(
      run('i pushed to github and deployed to kubernetes', {
        vocabulary: ['GitHub', 'Kubernetes'],
      }),
    ).toBe('I pushed to GitHub and deployed to Kubernetes.');
  });

  test('snippet expands then sentence is tidy', () => {
    expect(run('reach me at my email', { snippets: { 'my email': 'vamsy@example.com' } })).toBe(
      'Reach me at vamsy@example.com.',
    );
  });

  test('email from snippet is not mangled', () => {
    expect(run('write to my email', { snippets: { 'my email': 'a.b@example.co.uk' } })).toBe(
      'Write to a.b@example.co.uk.',
    );
  });

  test('filler removal on by config', () => {
    expect(run('um so i think uh we should go', { stripFillers: true })).toBe(
      'So I think we should go.',
    );
  });

  test('pronoun I variants fixed', () => {
    expect(run("i'm sure i'll do it")).toBe("I'm sure I'll do it.");
  });

  test('multiple spaces and stray spacing normalized', () => {
    expect(run('hello   there    friend')).toBe('Hello there friend.');
  });

  test('question retains no trailing period', () => {
    expect(run('are you coming question mark')).toBe('Are you coming?');
  });

  test('empty and whitespace stay empty', () => {
    expect(run('   ')).toBe('');
    expect(run('')).toBe('');
  });
});
