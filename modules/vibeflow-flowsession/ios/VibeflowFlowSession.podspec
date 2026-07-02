Pod::Spec.new do |s|
  s.name           = 'VibeflowFlowSession'
  s.version        = '1.0.0'
  s.summary        = 'VibeFlow Flow Session engine (background dictation + Darwin IPC)'
  s.description    = 'Keeps a background audio session alive and relays keyboard record toggles.'
  s.author         = 'VibeFlow'
  s.homepage       = 'https://vibeflow.app'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.license        = { :type => 'MIT' }
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,mm,swift}'
end
