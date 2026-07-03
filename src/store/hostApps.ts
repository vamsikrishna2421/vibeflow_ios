/**
 * Bundle-id → URL-scheme map for the "Return to <app>" button on the bootstrap
 * screen. iOS has no public "switch back" API — but opening the source app's URL
 * scheme gets a one-tap system confirm ("Mynah wants to open WhatsApp"), which
 * is exactly how Wispr Flow does its redirect-back. Unknown hosts fall back to the
 * "tap ‹ back top-left" instruction.
 */
export interface HostApp {
  name: string;
  scheme: string;
}

export const HOST_APPS: Record<string, HostApp> = {
  'net.whatsapp.WhatsApp': { name: 'WhatsApp', scheme: 'whatsapp://' },
  'ph.telegra.Telegraph': { name: 'Telegram', scheme: 'tg://' },
  'com.apple.MobileSMS': { name: 'Messages', scheme: 'messages://' },
  'com.apple.mobilemail': { name: 'Mail', scheme: 'message://' },
  'com.apple.mobilenotes': { name: 'Notes', scheme: 'mobilenotes://' },
  'com.apple.reminders': { name: 'Reminders', scheme: 'x-apple-reminderkit://' },
  'com.burbn.instagram': { name: 'Instagram', scheme: 'instagram://' },
  'com.atebits.Tweetie2': { name: 'X', scheme: 'twitter://' },
  'com.linkedin.LinkedIn': { name: 'LinkedIn', scheme: 'linkedin://' },
  'com.google.Gmail': { name: 'Gmail', scheme: 'googlegmail://' },
  'com.google.chrome.ios': { name: 'Chrome', scheme: 'googlechrome://' },
  'com.tinyspeck.chatlyio': { name: 'Slack', scheme: 'slack://' },
  'com.hammerandchisel.discord': { name: 'Discord', scheme: 'discord://' },
  'com.microsoft.skype.teams': { name: 'Teams', scheme: 'msteams://' },
  'org.whispersystems.signal': { name: 'Signal', scheme: 'sgnl://' },
  'com.facebook.Messenger': { name: 'Messenger', scheme: 'fb-messenger://' },
  'com.reddit.Reddit': { name: 'Reddit', scheme: 'reddit://' },
  'com.openai.chat': { name: 'ChatGPT', scheme: 'chatgpt://' },
  'com.anthropic.claude': { name: 'Claude', scheme: 'claude://' },
};

export function hostAppFor(bundleId: string | null): HostApp | null {
  if (!bundleId) return null;
  return HOST_APPS[bundleId] ?? null;
}
