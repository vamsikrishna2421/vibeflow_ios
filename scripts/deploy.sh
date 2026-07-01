#!/usr/bin/env bash
#
# VibeFlow → TestFlight deploy, one fixed step, runs in the background.
#
# `eas build --auto-submit` builds the IPA AND submits it to App Store Connect /
# TestFlight in one server-side pipeline (no separate `eas submit` to forget or
# time out). `--no-wait` returns immediately; EAS keeps going in the cloud and
# emails when it's done.
#
#   Usage:  ./scripts/deploy.sh              # native build + auto-submit to TestFlight
#           ./scripts/deploy.sh update "msg" # JS-only OTA (instant, no build/queue)
#
# Credentials are already set up (dist cert + provisioning for app/keyboard/widget,
# and an App Store Connect API key for submit), so this runs non-interactively.
set -euo pipefail
cd "$(dirname "$0")/.."

mode="${1:-build}"

if [ "$mode" = "update" ]; then
  msg="${2:-"JS update"}"
  echo "▶ OTA update (instant) — $msg"
  exec eas update --branch production --environment production --message "$msg" --non-interactive
fi

echo "▶ Build + auto-submit to TestFlight (background; ~build 5-8m, then the free-tier"
echo "  submit queue + Apple processing). Watch: https://expo.dev/accounts/lekkala2421/projects/vibeflow/builds"
exec eas build --profile testflight --platform ios --non-interactive --auto-submit --no-wait
