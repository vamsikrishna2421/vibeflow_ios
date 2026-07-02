Pod::Spec.new do |s|
  s.name           = 'VibeflowAppGroup'
  s.version        = '1.0.0'
  s.summary        = 'App Group KV bridge for the VibeFlow keyboard'
  s.description    = 'Shares dictations/settings with the keyboard extension via the App Group.'
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
