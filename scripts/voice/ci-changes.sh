#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
#
# Writes `voice=true` or `voice=false` to $GITHUB_OUTPUT. Any doubt answers true:
# when the diff cannot be read, every Voice suite runs.
set -euo pipefail

# Superset of the workflow's former `paths:` filters. Over-matching only runs more
# suites, so the pattern errs on the side of running them.
VOICE_PATH_PATTERN='^(packages/voice-host/|packages/app/src/voice/|packages/app/src/contracts/|packages/contracts/|packages/mobile/src-tauri/src/voice/|packages/mobile/src-tauri/src/speech\.rs$|packages/mobile/src-tauri/Cargo\.(toml|lock)$|packages/voice-core/|packages/desktop/src-tauri/src/parakeet/|packages/desktop/src-tauri/src/speech\.rs$|packages/desktop/src-tauri/Cargo\.(toml|lock)$|crates/unifia-voice-artifacts/|scripts/voice/|docs/voice-|docs/adr/ADR-0(5|6|7)|docs/rfcs/RFC-VOICE-|docs/CHECKPOINT-VOICE-|docs/PLAN-.*-VOICE|docs/operations/voice-v2-autonomous-state\.md$|\.github/workflows/voice-ci\.yml$)'

readonly ZERO_SHA='0000000000000000000000000000000000000000'

changed_files_or_fail() {
  local before=$1 after=$2
  git diff --name-only "$before" "$after" 2>/dev/null
}

decide() {
  local changed
  case "${EVENT_NAME:-}" in
    pull_request)
      if ! changed=$(changed_files_or_fail "$BASE_SHA" "$HEAD_SHA"); then
        echo true
        return
      fi
      ;;
    push)
      if [[ -z "${PUSH_BEFORE:-}" || "$PUSH_BEFORE" == "$ZERO_SHA" ]]; then
        echo true
        return
      fi
      if ! changed=$(changed_files_or_fail "$PUSH_BEFORE" "$GITHUB_SHA"); then
        echo true
        return
      fi
      ;;
    *)
      echo true
      return
      ;;
  esac

  if grep -Eq "$VOICE_PATH_PATTERN" <<<"$changed"; then
    echo true
  else
    echo false
  fi
}

verdict=$(decide)
echo "Voice changes in this run: $verdict (event: ${EVENT_NAME:-unknown})"
echo "voice=$verdict" >> "$GITHUB_OUTPUT"
