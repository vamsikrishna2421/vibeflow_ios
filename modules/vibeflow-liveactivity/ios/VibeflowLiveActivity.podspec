Pod::Spec.new do |s|
  s.name           = 'VibeflowLiveActivity'
  s.version        = '1.0.0'
  s.summary        = 'Flow Session Live Activity (Dynamic Island) controller'
  s.description    = 'Starts/updates/ends the VibeFlow Live Activity via ActivityKit.'
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
