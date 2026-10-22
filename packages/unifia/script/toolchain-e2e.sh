#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# End-to-end proof of the toolchain manager against the real Alpine CDN:
# SOURCE -> DOWNLOAD -> VERIFY -> INSTALL -> EXECUTE -> UPDATE -> ROLLBACK -> REMOVE.
# Runs on a Linux aarch64 host (the phone's ABI). Version probes start each
# binary through the rootfs musl loader, as the phone does with
# libmusl_linker.so; compile tests run in a chroot of the same rootfs.
# It proves the packages and the manager, not Android's SELinux exec path.
# Usage: script/toolchain-e2e.sh <empty work dir>   (from packages/unifia)
set -euo pipefail

work="$(realpath "${1:?usage: toolchain-e2e.sh <work dir>}")"
root="$work/rootfs"
report="$work/report.md"
cdn="https://dl-cdn.alpinelinux.org/alpine"
old=(--repository "$cdn/v3.20/main" --repository "$cdn/v3.20/community")
new=(--repository "$cdn/v3.21/main" --repository "$cdn/v3.21/community")
packages=(python3 py3-pip nodejs npm git openssh-client curl clang build-base rust cargo go)

toolchain() { bun run src/index.ts toolchain "$@" --root "$root" --state "$work/state" --arch aarch64; }
fail() { echo "FAIL: $*" | tee -a "$report" >&2; exit 1; }
# Starts a rootfs binary the way the phone does: through the musl loader, outside any chroot.
loader() {
  local binary="$1"
  shift
  "$root/lib/ld-musl-aarch64.so.1" --library-path "$root/usr/lib:$root/lib" "$root/usr/bin/$binary" "$@"
}
# No bytecode: root-owned __pycache__ files would be left behind in managed directories.
# Alpine's go is trimmed: without GOROOT it locates itself through /proc, absent from a bare chroot.
inside() {
  sudo env -i HOME=/root USER=root PATH=/usr/bin:/bin:/usr/sbin:/sbin GOROOT=/usr/lib/go GOCACHE=/tmp/go GOPATH=/tmp/gopath TMPDIR=/tmp \
    PYTHONDONTWRITEBYTECODE=1 chroot "$root" "$@"
}

versions() {
  {
    loader python3 --version
    loader node --version
    loader git --version
    loader rustc --version
    loader cargo --version
    # Alpine's go is a static ELF: the musl loader cannot start it, so on the
    # phone it has no libmusl_linker.so path either (see toolchain.rs).
    inside /usr/bin/go version
    loader gcc --version | head -1
    loader clang --version | head -1
    loader curl --version | head -1
    loader ssh -V 2>&1
  } 2>&1
}

[ "$(uname -m)" = "aarch64" ] || fail "needs an aarch64 host, got $(uname -m)"
echo "# Toolchain e2e — $(date -u +%FT%TZ) — commit ${GITHUB_SHA:-local}" > "$report"

echo "## 1. Install from Alpine v3.20" >> "$report"
toolchain install "${packages[@]}" "${old[@]}" | tee "$work/install.json"
versions | tee "$work/versions-old.txt" >> "$report"

echo "## 2. Update to Alpine v3.21" >> "$report"
toolchain update "${new[@]}" | tee "$work/update.json"
versions | tee "$work/versions-new.txt" >> "$report"
grep -q "Python 3.12.15" "$work/versions-new.txt" || fail "python3 was not updated"
grep -q "^v22\." "$work/versions-new.txt" || fail "nodejs was not updated"
cmp -s "$work/versions-old.txt" "$work/versions-new.txt" && fail "update changed no version"

echo "## 3. Build and run real programs (chroot)" >> "$report"
sudo mkdir -p "$root/proc" "$root/dev" "$root/tmp/work" "$root/root"
sudo mount -t proc proc "$root/proc"
sudo mount --bind /dev "$root/dev"
trap 'sudo umount "$root/proc" "$root/dev" 2>/dev/null || true' EXIT
sudo cp /etc/resolv.conf "$root/etc/resolv.conf"
sudo tee "$root/tmp/work/hello.c" >/dev/null <<<'#include <stdio.h>
int main(void) { puts("hello from c"); return 0; }'
sudo tee "$root/tmp/work/hello.cpp" >/dev/null <<<'#include <iostream>
int main() { std::cout << "hello from c++" << std::endl; }'
sudo tee "$root/tmp/work/hello.go" >/dev/null <<<'package main
import "fmt"
func main() { fmt.Println("hello from go") }'
{
  inside /usr/bin/cc -o /tmp/work/c /tmp/work/hello.c && inside /tmp/work/c
  inside /usr/bin/c++ -o /tmp/work/cpp /tmp/work/hello.cpp && inside /tmp/work/cpp
  inside /usr/bin/clang -o /tmp/work/clang /tmp/work/hello.c && inside /tmp/work/clang
  inside /usr/bin/go build -o /tmp/work/go /tmp/work/hello.go && inside /tmp/work/go
  inside /usr/bin/cargo new --vcs none /tmp/work/rs && inside /usr/bin/cargo run --offline --manifest-path /tmp/work/rs/Cargo.toml
  inside /usr/bin/python3 -c 'import sqlite3, ssl, json; print("hello from python", ssl.OPENSSL_VERSION)'
  inside /usr/bin/python3 -m pip --version
  inside /usr/bin/node -e 'console.log("hello from node", process.versions.node)'
  inside /usr/bin/npm --version
  inside /usr/bin/git init -q /tmp/work/repo
  inside /usr/bin/git -C /tmp/work/repo -c user.name=e2e -c user.email=e2e@example.invalid commit -q --allow-empty -m first
  inside /usr/bin/git -C /tmp/work/repo log --oneline
} 2>&1 | tee -a "$report"
for expected in "hello from c" "hello from c++" "hello from go" "Hello, world!" "hello from python" "hello from node" "first"; do
  grep -q "$expected" "$report" || fail "missing output: $expected"
done
sudo umount "$root/proc" "$root/dev"
trap - EXIT

echo "## 4. Roll back to the v3.20 state (offline, from the verified cache)" >> "$report"
toolchain rollback "${old[@]}" | tee "$work/rollback.json"
versions > "$work/versions-rolled-back.txt"
cmp "$work/versions-old.txt" "$work/versions-rolled-back.txt" || fail "rollback did not restore the v3.20 versions"
echo "versions identical to step 1" >> "$report"

echo "## 5. Remove everything" >> "$report"
toolchain remove "${packages[@]}" "${new[@]}" | tee "$work/remove.json"
toolchain list | grep -q '"name"' && fail "packages left after remove"
leftover="$(find "$root" -type f -not -path "$root/tmp/*" -not -path "$root/etc/resolv.conf" -not -path "$root/root/*" | head -5)"
[ -z "$leftover" ] || fail "files left after remove: $leftover"
echo "rootfs holds no managed file" >> "$report"
echo "PASS" | tee -a "$report"
