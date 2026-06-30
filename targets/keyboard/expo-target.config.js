/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
//
// Native iOS keyboard extension target, injected into the Xcode project during
// `expo prebuild` by @bacons/apple-targets. iOS forbids microphone access in a
// keyboard extension, so this target NEVER records — it only inserts text the
// VibeFlow app already captured and shared through the App Group. Because it is
// native code, changes here require a rebuild (they do NOT ride EAS Update OTA);
// keep it thin and stable, and put fast-moving logic in the JS app instead.
module.exports = (config) => ({
  type: 'keyboard',
  name: 'VibeFlowKeyboard',
  // Inherit the same App Group the app writes to, so the keyboard can read the
  // latest dictation + recents without any "Full Access".
  entitlements: {
    'com.apple.security.application-groups':
      config.ios.entitlements['com.apple.security.application-groups'],
  },
  deploymentTarget: '17.0',
});
