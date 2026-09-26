#!/bin/bash
# SessionStart hook for Claude Code on the web: installs npm dependencies so
# typecheck, lint, tests, and `npm run dev` work in remote sessions.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# npm install (not ci) so the cached container's node_modules is reused;
# --no-save keeps an older npm from rewriting package-lock.json each session.
npm install --no-audit --no-fund --no-save
