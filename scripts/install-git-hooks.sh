#!/usr/bin/env bash
# scripts/install-git-hooks.sh
#
# Wires the tracked .githooks/ directory into git so hooks run on every commit
# in this clone. Runs automatically via package.json `prepare` on `npm install`.
#
# Idempotent — safe to run multiple times.

set -euo pipefail

# Skip in CI (Vercel, GitHub Actions, etc.) — no local commits happen there.
if [[ "${CI:-}" == "true" || "${VERCEL:-}" == "1" || "${GITHUB_ACTIONS:-}" == "true" ]]; then
  exit 0
fi

# Skip if we're not inside a git worktree (e.g. running from a tarball).
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

git config core.hooksPath .githooks
chmod +x .githooks/pre-commit 2>/dev/null || true

echo "✓ git hooks installed (core.hooksPath=.githooks)"
