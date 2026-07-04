/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
//
// Live Activity / Dynamic Island target for the "Flow Session". Injected into the
// Xcode project during `expo prebuild` by @bacons/apple-targets. Renders the
// on-screen + Dynamic Island UI while VibeFlow is capturing your voice; the app
// (via the vibeflow-liveactivity module) starts/updates/ends it with ActivityKit.
module.exports = (config) => ({
  type: 'widget',
  name: 'VibeFlowWidgets',
  // Pin the bundle id so credentials/registration are deterministic.
  bundleIdentifier: 'com.vibeflow.app.widget',
  frameworks: ['SwiftUI', 'ActivityKit', 'WidgetKit'],
  deploymentTarget: '17.0',
});
