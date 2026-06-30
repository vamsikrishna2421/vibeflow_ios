/**
 * Offline voice-editing commands. When the *entire* utterance is a known command
 * phrase ("scratch that", "delete last word", "new line"), it's an edit action,
 * not text to insert. Matching the whole utterance (not a substring) keeps it
 * predictable. Port of Android `:core` `VoiceCommands`.
 */
export enum VoiceCommand {
  DeleteLast = 'DELETE_LAST',
  DeleteWord = 'DELETE_WORD',
  NewLine = 'NEW_LINE',
  NewParagraph = 'NEW_PARAGRAPH',
}

const PHRASES: Record<string, VoiceCommand> = {
  'scratch that': VoiceCommand.DeleteLast,
  'scratch all that': VoiceCommand.DeleteLast,
  'delete that': VoiceCommand.DeleteLast,
  'delete last': VoiceCommand.DeleteLast,
  'undo that': VoiceCommand.DeleteLast,
  'delete last word': VoiceCommand.DeleteWord,
  'delete a word': VoiceCommand.DeleteWord,
  'delete word': VoiceCommand.DeleteWord,
  'backspace word': VoiceCommand.DeleteWord,
  'new line': VoiceCommand.NewLine,
  'next line': VoiceCommand.NewLine,
  'new paragraph': VoiceCommand.NewParagraph,
};

// Trim surrounding whitespace + edge punctuation, lowercase, collapse whitespace.
const EDGE_PUNCT = /^[\s.,!?;:]+|[\s.,!?;:]+$/g;

/** Returns the command if the whole utterance is one, else null. */
export function parseVoiceCommand(raw: string): VoiceCommand | null {
  if (!raw || !raw.trim()) return null;
  const key = raw.trim().toLowerCase().replace(EDGE_PUNCT, '').replace(/\s+/g, ' ');
  return PHRASES[key] ?? null;
}
