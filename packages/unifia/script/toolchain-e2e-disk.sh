#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Real small-disk check for the toolchain manager: on a 64 MB tmpfs, installing
# python3 (well over 64 MB installed) must be refused by the free-space check
# before any package is downloaded, and leave no cache, staging or rootfs file.
# Usage: script/toolchain-e2e-disk.sh <empty work dir>   (from packages/unifia)
set -euo pipefail

work="$(realpath "${1:?usage: toolchain-e2e-disk.sh <work dir>}")"
disk="$work/disk"
mkdir -p "$disk"
sudo mount -t tmpfs -o size=64m,uid="$(id -u)",gid="$(id -g)" tmpfs "$disk"
trap 'sudo umount "$disk" 2>/dev/null || true' EXIT
cdn="https://dl-cdn.alpinelinux.org/alpine/v3.21"

set +e
output="$(bun run src/index.ts toolchain install python3 --root "$disk/rootfs" --state "$disk/state" --arch aarch64 \
  --repository "$cdn/main" --repository "$cdn/community" 2>&1)"
status=$?
set -e
echo "$output" | tail -5
[ "$status" -ne 0 ] || { echo "FAIL: install on a 64 MB disk succeeded"; exit 1; }
echo "$output" | grep -q "not enough free space" || { echo "FAIL: refused for another reason"; exit 1; }
[ -z "$(ls -A "$disk/state/cache")" ] || { echo "FAIL: packages were downloaded before the refusal"; exit 1; }
[ -z "$(find "$disk/rootfs" -type f)" ] || { echo "FAIL: files written to the rootfs"; exit 1; }
[ -z "$(find "$disk/state" -maxdepth 1 -name 'staging-*')" ] || { echo "FAIL: staging left behind"; exit 1; }
echo "PASS: refused before download, nothing written ($(df -h "$disk" | tail -1 | awk '{print $3 " used of " $2}'))"
