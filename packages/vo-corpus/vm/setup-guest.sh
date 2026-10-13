#!/bin/bash
# Prepares a Tart macOS guest (cirruslabs macos-*-base image, user admin) for VoiceOver collection.
# Run from the host: tart exec -i vo-collector bash -s < vm/setup-guest.sh
# Idempotent. Steps that need a person (permission prompts, turning VoiceOver on, choosing the capture voice) are printed at the end.
set -euo pipefail
export PATH="/opt/homebrew/bin:$PATH"
SERVER_VERSION=0.1.3
DIR="$HOME/at-driver"

echo "== Korean UI (VoiceOver speaks the UI language; takes effect after the next login)"
defaults write -g AppleLanguages -array ko-KR en-US
defaults write -g AppleLocale ko_KR

echo "== No sleep, screen saver, or notifications getting in front of the browser"
sudo -n pmset -a sleep 0 displaysleep 0 disksleep 0 || echo "  (pmset needs sudo; skipped)"
defaults -currentHost write com.apple.screensaver idleTime 0
defaults write com.apple.Safari AlwaysRestoreSessionAtLaunch -bool false 2>/dev/null || true

echo "== Node"
command -v node >/dev/null || brew install node
node --version

echo "== Bocoup macOS AT Driver server $SERVER_VERSION"
mkdir -p "$DIR" && cd "$DIR"
[ -f package.json ] || npm init -y >/dev/null
npm install --no-audit --no-fund "@bocoup/macos-at-driver-server@$SERVER_VERSION"
PKG="$DIR/node_modules/@bocoup/macos-at-driver-server"
# Same fix as the host copy: an utterance can contain line breaks, keep all of it.
sed -i '' 's#/^(lifecycle|speech|internalError):(.\*)$/)#/^(lifecycle|speech|internalError):(.*)$/s)#' "$PKG/lib/create-voice-server.js"
grep -q '(.\*)\$/s)' "$PKG/lib/create-voice-server.js" && echo "  multi-line speech patch applied"
# Upstream listens on all interfaces (unlike the host copy, patched to loopback): the collector on the host reaches it over
# Tart's NAT network, which only the host can reach.
npx at-driver install --unattended || echo "  install reported a problem; see above"

cat <<'EOF'

== Left for a person, inside the VM window:
1. Log out and back in (or restart the VM) so the Korean UI applies
2. Turn VoiceOver on: click the VM window, press Command+F5
3. VoiceOver Utility > Speech: choose the voice MacOSATDriverServerExtensionVoice
4. Allow the Accessibility / Automation prompts that appear when the server first presses keys
EOF
