#!/bin/zsh
# Xcode Cloud: prepare the Expo/React Native workspace before xcodebuild runs.
# The runner ships without Node; install it + CocoaPods, then JS deps + pods.
set -e
set -o pipefail

brew install node@20 cocoapods
export PATH="/opt/homebrew/opt/node@20/bin:/usr/local/opt/node@20/bin:$PATH"
echo "node: $(node --version)  pod: $(pod --version)"

cd "$CI_PRIMARY_REPOSITORY_PATH"
npm install --no-audit --no-fund

cd ios
pod install
