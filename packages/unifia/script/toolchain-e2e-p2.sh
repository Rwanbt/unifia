#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# End-to-end proof for the P2 toolchains (JVM, Kotlin, Ruby, PHP, Lua, Perl,
# SQLite, CMake, Make, Maven, Gradle) and the P3 Docker client, installed by
# the toolchain manager from Alpine v3.21 into a fresh rootfs, then removed.
# Like toolchain-e2e.sh: Linux aarch64 host, programs run in a chroot of the
# managed rootfs. It proves the packages and the manager, not Android's exec path.
# Kotlin is not in Alpine v3.21 (only in testing): it is compiled here by the
# official Kotlin Gradle plugin, which Gradle downloads from the plugin portal.
# Docker is a client only: it talks to a daemon outside the rootfs. Unifia never
# presents it as a local daemon, which would need root.
# Usage: script/toolchain-e2e-p2.sh <empty work dir>   (from packages/unifia)
set -euo pipefail

work="$(realpath "${1:?usage: toolchain-e2e-p2.sh <work dir>}")"
root="$work/rootfs"
report="$work/report.md"
cdn="https://dl-cdn.alpinelinux.org/alpine/v3.21"
repos=(--repository "$cdn/main" --repository "$cdn/community")
packages=(coreutils findutils sed grep ca-certificates openjdk21-jdk gradle maven ruby php83 lua5.4 perl sqlite cmake make build-base docker-cli)
kotlin_plugin="2.0.21"
# The JDK commands have no /usr/bin links: Alpine creates them in an install script, which the manager never runs.
jdk=/usr/lib/jvm/java-21-openjdk/bin

toolchain() { bun run src/index.ts toolchain "$@" --root "$root" --state "$work/state" --arch aarch64; }
fail() { echo "FAIL: $*" | tee -a "$report" >&2; exit 1; }
inside() {
  sudo env -i HOME=/root USER=root PATH=/usr/bin:/bin:/usr/sbin:/sbin TMPDIR=/tmp \
    JAVA_HOME=/usr/lib/jvm/java-21-openjdk GRADLE_USER_HOME=/tmp/gradle DOCKER_HOST=unix:///run/host-docker.sock \
    chroot "$root" "$@"
}

[ "$(uname -m)" = "aarch64" ] || fail "needs an aarch64 host, got $(uname -m)"
echo "# Toolchain e2e P2/P3 — $(date -u +%FT%TZ) — commit ${GITHUB_SHA:-local}" > "$report"

echo "## 1. Install P2/P3 from Alpine v3.21" >> "$report"
toolchain install "${packages[@]}" "${repos[@]}" | tee "$work/install.json"

sudo mkdir -p "$root/proc" "$root/dev" "$root/run" "$root/tmp/work/kt/src/main/kotlin" "$root/root"
sudo mount -t proc proc "$root/proc"
sudo mount --bind /dev "$root/dev"
sudo touch "$root/run/host-docker.sock"
sudo mount --bind /var/run/docker.sock "$root/run/host-docker.sock"
trap 'sudo umount "$root/proc" "$root/dev" "$root/run/host-docker.sock" 2>/dev/null || true' EXIT
sudo cp /etc/resolv.conf "$root/etc/resolv.conf"

sudo tee "$root/tmp/work/Hello.java" >/dev/null <<<'public class Hello { public static void main(String[] a) { System.out.println("hello from java " + Runtime.version()); } }'
sudo tee "$root/tmp/work/kt/settings.gradle.kts" >/dev/null <<<'rootProject.name = "kt"'
sudo tee "$root/tmp/work/kt/build.gradle.kts" >/dev/null <<EOF
plugins { kotlin("jvm") version "$kotlin_plugin"; application }
repositories { mavenCentral() }
application { mainClass.set("MainKt") }
EOF
sudo tee "$root/tmp/work/kt/src/main/kotlin/Main.kt" >/dev/null <<<'fun main() = println("hello from kotlin ${KotlinVersion.CURRENT}")'
sudo tee "$root/tmp/work/CMakeLists.txt" >/dev/null <<<'cmake_minimum_required(VERSION 3.20)
project(hello C)
add_executable(hello hello.c)'
sudo tee "$root/tmp/work/hello.c" >/dev/null <<<'#include <stdio.h>
int main(void) { puts("hello from cmake"); return 0; }'

echo "## 2. Run P2 programs and the P3 client (chroot)" >> "$report"
{
  inside "$jdk/javac" -d /tmp/work /tmp/work/Hello.java && inside "$jdk/java" -cp /tmp/work Hello
  inside /usr/bin/gradle -q --no-daemon -p /tmp/work/kt run
  inside /usr/bin/mvn -v
  inside /usr/bin/ruby -e 'puts "hello from ruby #{RUBY_VERSION}"'
  inside /usr/bin/php83 -r 'echo "hello from php " . PHP_VERSION . "\n";'
  inside /usr/bin/lua5.4 -e 'print("hello from " .. _VERSION)'
  inside /usr/bin/perl -e 'print "hello from perl $^V\n"'
  inside /usr/bin/sqlite3 :memory: "select 'hello from sqlite ' || sqlite_version();"
  inside /usr/bin/cmake -S /tmp/work -B /tmp/work/build && inside /usr/bin/make -C /tmp/work/build && inside /tmp/work/build/hello
  inside /usr/bin/docker version --format 'docker client {{.Client.Version}} -> remote daemon {{.Server.Version}}'
} 2>&1 | tee -a "$report"
for expected in "hello from java" "hello from kotlin" "Apache Maven" "hello from ruby" "hello from php" "hello from Lua 5.4" \
  "hello from perl" "hello from sqlite" "hello from cmake" "-> remote daemon"; do
  grep -q -- "$expected" "$report" || fail "missing output: $expected"
done
sudo umount "$root/proc" "$root/dev" "$root/run/host-docker.sock"
trap - EXIT

echo "## 3. Remove everything" >> "$report"
toolchain remove "${packages[@]}" "${repos[@]}" | tee "$work/remove.json"
toolchain list | grep -q '"name"' && fail "packages left after remove"
leftover="$(find "$root" -type f -not -path "$root/tmp/*" -not -path "$root/etc/resolv.conf" -not -path "$root/root/*" -not -path "$root/run/*" | head -5)"
[ -z "$leftover" ] || fail "files left after remove: $leftover"
echo "rootfs holds no managed file" >> "$report"
echo "PASS" | tee -a "$report"
