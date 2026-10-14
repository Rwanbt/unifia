#!/bin/bash
# session-start.sh — Claude Code cloud sessions: install the pinned Bun and the
# workspace dependencies, the way .github/actions/setup-bun does in CI.
# Local sessions (the owner's PC) manage their own toolchain and skip it.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# package.json pins the exact version ("packageManager": "bun@1.3.11"); the
# container's own bun may differ, and the lockfile is written by the pinned one.
want=$(node -p "require('./package.json').packageManager.split('@')[1]")
case "$(uname -m)" in
  x86_64) asset=bun-linux-x64-baseline ;;
  aarch64 | arm64) asset=bun-linux-aarch64 ;;
  *) echo "session-start: unsupported architecture $(uname -m)" >&2; exit 1 ;;
esac
bun_dir="$HOME/.bun-$want"
if [ ! -x "$bun_dir/bin/bun" ]; then
  tmp=$(mktemp -d)
  curl -fsSL -o "$tmp/bun.zip" "https://github.com/oven-sh/bun/releases/download/bun-v$want/$asset.zip"
  unzip -q "$tmp/bun.zip" -d "$tmp"
  mkdir -p "$bun_dir/bin"
  mv "$tmp/$asset/bun" "$bun_dir/bin/bun"
  ln -sf bun "$bun_dir/bin/bunx"
  rm -rf "$tmp"
fi
export PATH="$bun_dir/bin:$PATH"
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"$bun_dir/bin:\$PATH\"" >>"$CLAUDE_ENV_FILE"
fi

# As in CI: native addons build against the local Node headers instead of
# downloading them.
npm_config_nodedir=$(dirname "$(dirname "$(readlink -f "$(command -v node)")")")
export npm_config_nodedir
if ! bun install; then
  # The cloud proxy refuses api.github.com tarballs of third-party repositories,
  # which is why ghostty-web is vendored (packages/ghostty-web, #664). A new
  # github: dependency would fail here the same way.
  echo "session-start: bun install failed; check for a github: dependency (see #664)" >&2
  exit 1
fi
