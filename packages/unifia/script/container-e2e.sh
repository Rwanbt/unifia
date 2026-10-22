#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# End-to-end proof of ADR-098 containers on a Linux aarch64 host (the phone's
# ABI): build PRoot from its pinned sources, pull real arm64 images from Docker
# Hub, run containers through `unifia container`, install a package inside one,
# then remove containers and images. No chroot and no root: PRoot alone, as on
# the phone. Android's SELinux and its nativeLibraryDir loader still need a phone.
# Usage: script/container-e2e.sh <empty work dir>   (from packages/unifia)
set -euo pipefail

work="$(realpath "${1:?usage: container-e2e.sh <work dir>}")"
report="$work/report.md"
fail() { echo "FAIL: $*" | tee -a "$report" >&2; exit 1; }
ctr() { bun run src/index.ts container "$@" --state "$work/state" --proot "$work/proot/proot"; }

[ "$(uname -m)" = "aarch64" ] || fail "needs an aarch64 host, got $(uname -m)"
echo "# Container e2e — $(date -u +%FT%TZ) — commit ${GITHUB_SHA:-local}" > "$report"

bash ../mobile/scripts/build-proot.sh host "$work/proot" | tail -1 | tee -a "$report"
for image in alpine:3.21 python:3.12-alpine node:22-alpine; do ctr pull "$image" | tee -a "$report"; done

echo "## Runs" >> "$report"
{
  ctr run alpine:3.21 cat /etc/alpine-release
  ctr run alpine:3.21 id -u
  ctr run alpine:3.21 sh -c 'apk add --no-cache curl >/dev/null && curl --version | head -1'
  ctr run python:3.12-alpine python3 -c 'import platform; print("python", platform.python_version(), platform.machine())'
  ctr run node:22-alpine node -e 'console.log("node", process.version, process.arch)'
  ctr run --name exits-3 alpine:3.21 sh -c 'exit 3' || echo "exit code $?"
} 2>&1 | tee -a "$report"
for expected in "3.21" "^0$" "curl 8" "python 3.12" "aarch64" "node v22" "arm64" "exit code 3"; do
  grep -qE -- "$expected" "$report" || fail "missing output: $expected"
done

echo "## Cleanup" >> "$report"
for id in $(ctr ps | grep -o '"id": "[0-9a-f]*"' | cut -d'"' -f4); do ctr rm "$id" >/dev/null; done
for image in alpine:3.21 python:3.12-alpine node:22-alpine; do ctr rmi "$image" >/dev/null; done
ctr ps | grep -q '"id"' && fail "containers left"
ctr images | grep -q '"digest"' && fail "images left"
[ -z "$(ls -A "$work/state/blobs")" ] || fail "blobs left"
echo "PASS" | tee -a "$report"
