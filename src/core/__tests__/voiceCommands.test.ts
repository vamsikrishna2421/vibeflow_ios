import { parseVoiceCommand, VoiceCommand } from '../voiceCommands';

// Faithful port of Android VoiceCommandsTest.
describe('VoiceCommands', () => {
  test('recognizes scratch that', () => {
    expect(parseVoiceCommand('scratch that')).toBe(VoiceCommand.DeleteLast);
    expect(parseVoiceCommand('Scratch that.')).toBe(VoiceCommand.DeleteLast);
    expect(parseVoiceCommand('  delete that  ')).toBe(VoiceCommand.DeleteLast);
  });

  test('recognizes delete last word', () => {
    expect(parseVoiceCommand('delete last word')).toBe(VoiceCommand.DeleteWord);
    expect(parseVoiceCommand('delete word')).toBe(VoiceCommand.DeleteWord);
  });

  test('recognizes layout commands', () => {
    expect(parseVoiceCommand('new line')).toBe(VoiceCommand.NewLine);
    expect(parseVoiceCommand('new paragraph')).toBe(VoiceCommand.NewParagraph);
  });

  test('does not trigger mid-sentence', () => {
    expect(parseVoiceCommand('please scratch that itch')).toBeNull();
    expect(parseVoiceCommand('add a new line item to the list')).toBeNull();
    expect(parseVoiceCommand('hello world')).toBeNull();
  });

  test('blank is null', () => {
    expect(parseVoiceCommand('')).toBeNull();
    expect(parseVoiceCommand('   ')).toBeNull();
  });
});
