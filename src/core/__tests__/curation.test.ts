import { curate, defaultCurationOptions, CurationOptions } from '../curation';

// Faithful port of Android TextCurationTest. Default options mirror Kotlin's
// TextCuration.Options() (autoPeriod = false, dedupeRepeats = true).
const o = (over: Partial<CurationOptions> = {}) => defaultCurationOptions(over);
const run = (s: string, over: Partial<CurationOptions> = {}) => curate(s, o(over));

describe('TextCuration', () => {
  test('capitalizes first letter and sentences', () => {
    expect(run('hello world. how are you?')).toBe('Hello world. How are you?');
  });

  test('fixes lone pronoun I', () => {
    expect(run("i think i'm right")).toBe("I think I'm right");
  });

  test('does not force-capitalize case-bearing tokens', () => {
    expect(run('iOS is great', { capitalizeFirst: false })).toBe('iOS is great');
  });

  test('spoken new line becomes break', () => {
    expect(
      run('line one new line line two', { capitalizeFirst: false, capitalizeSentences: false }),
    ).toBe('line one\nline two');
  });

  test('spoken paragraph becomes double break', () => {
    expect(
      run('first new paragraph second', { capitalizeFirst: false, capitalizeSentences: false }),
    ).toBe('first\n\nsecond');
  });

  test('spoken punctuation period and comma', () => {
    expect(run('hello comma world period')).toBe('Hello, world.');
  });

  test('spoken question mark is a whole phrase', () => {
    expect(run('really question mark')).toBe('Really?');
  });

  test('removes standalone fillers', () => {
    expect(run('um i think uh we should ship', { stripFillers: true })).toBe(
      'I think we should ship',
    );
  });

  test('keeps filler inside a word', () => {
    expect(
      run('the scrum meeting', {
        stripFillers: true,
        capitalizeFirst: false,
        capitalizeSentences: false,
      }),
    ).toBe('the scrum meeting');
  });

  test('auto period adds terminal punctuation', () => {
    expect(run('send it now', { autoPeriod: true })).toBe('Send it now.');
  });

  test('auto period skips when already punctuated', () => {
    expect(run('done!', { autoPeriod: true })).toBe('Done!');
  });

  test('normalizes spacing around punctuation', () => {
    expect(run('hi , there .')).toBe('Hi, there.');
  });

  test('empty stays empty', () => {
    expect(run('')).toBe('');
  });
});
