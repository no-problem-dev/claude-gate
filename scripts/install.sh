#!/bin/bash
# claude-gate デーモンを launchd に常駐させる(何度実行しても安全)
set -euo pipefail

cd "$(dirname "$0")/.."
npm run build

mkdir -p ~/.gate/logs
PLIST_SRC="launchd/com.taniguchi.claude-gate.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.taniguchi.claude-gate.plist"

cp "$PLIST_SRC" "$PLIST_DST"
launchctl bootout "gui/$(id -u)/com.taniguchi.claude-gate" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"

sleep 1
curl -sf http://127.0.0.1:7350/health && echo "" && echo "claude-gate is running"
