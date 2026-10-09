#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
#
# Final verdict of voice-ci. When Voice changed, every suite must succeed. When it
# did not, every suite must be skipped. Any other result fails the check: a failure,
# a cancellation, or a suite that should have run and did not.
set -euo pipefail

if [[ "${CHANGES_RESULT:-}" != "success" ]]; then
  echo "::error::Voice path filter did not complete (result: ${CHANGES_RESULT:-none})"
  exit 1
fi

case "${VOICE_CHANGED:-}" in
  true) expected=success ;;
  false) expected=skipped ;;
  *)
    echo "::error::Unknown path filter output: '${VOICE_CHANGED:-}'"
    exit 1
    ;;
esac

failed=0
check_suite() {
  local name=$1 result=$2
  if [[ "$result" != "$expected" ]]; then
    echo "::error::$name: expected $expected, got $result"
    failed=1
  else
    echo "$name: $result"
  fi
}

check_suite "voice-host python" "${HOST_RESULT:-none}"
check_suite "voice app tests and typecheck" "${APP_RESULT:-none}"
check_suite "voice contracts tests and typecheck" "${CONTRACTS_RESULT:-none}"
check_suite "voice Rust scheduler" "${SCHEDULER_RESULT:-none}"
check_suite "voice Rust core" "${CORE_RESULT:-none}"
check_suite "voice model artifact manager" "${ARTIFACTS_RESULT:-none}"
check_suite "voice docs sanity" "${DOCS_RESULT:-none}"

if [[ $failed -ne 0 ]]; then
  exit 1
fi

if [[ "$VOICE_CHANGED" == "true" ]]; then
  echo "Voice suites passed."
else
  echo "No Voice path changed: suites excluded, verdict success."
fi
