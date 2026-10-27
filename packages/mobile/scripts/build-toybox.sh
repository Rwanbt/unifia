#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Builds toybox, the multi-call userland shipped as libtoybox_exec.so, from its
# pinned upstream source. The archive must match TOYBOX_SHA256 before it is
# unpacked. The phone gets the NDK clang build (bionic) with the project's own
# configuration (scripts/android_miniconfig, the android_defconfig target).
#
# Usage: build-toybox.sh <NDK root> <output file>
#
# Update TOYBOX_VERSION and TOYBOX_SHA256 together when bumping toybox.
set -euo pipefail

readonly TOYBOX_VERSION="0.8.15"
readonly TOYBOX_SHA256="52452b68a6cf50f9a9728b0f844b03c4dd1f70463675b202e6cf0475bda3934f"
readonly ANDROID_API="28"

ndk="${1:?usage: build-toybox.sh <NDK root> <output file>}"
# Resolved before the build changes directory: the copy at the end must not land in the toybox source tree.
output="$(realpath -m "${2:?usage: build-toybox.sh <NDK root> <output file>}")"
toolchain_bin="$ndk/toolchains/llvm/prebuilt/linux-x86_64/bin"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

archive="$work/toybox-$TOYBOX_VERSION.tar.gz"
curl -fsSL --retry 5 --retry-delay 15 --retry-connrefused \
  -o "$archive" "https://github.com/landley/toybox/archive/refs/tags/$TOYBOX_VERSION.tar.gz"
echo "$TOYBOX_SHA256  $archive" | sha256sum -c -
tar -xzf "$archive" -C "$work"

cd "$work/toybox-$TOYBOX_VERSION"
# The phone's binary is built without libselinux and without libcrypto: neither library is in the NDK, and the
# shipped binary references neither (its md5sum uses toybox's own code). android_miniconfig enables both, so
# those two symbols are dropped from the copy this build uses.
grep -v -E '^CONFIG_TOYBOX_(SELINUX|LIBCRYPTO)=y$' scripts/android_miniconfig > scripts/android_miniconfig.phone
mv scripts/android_miniconfig.phone scripts/android_miniconfig
grep -q -E 'TOYBOX_(SELINUX|LIBCRYPTO)=' scripts/android_miniconfig && { echo "a host library is still enabled in the miniconfig" >&2; exit 1; }
# Applets that runtime/server.rs routes to toybox and that the shipped binary has. None needs a library, so they
# are enabled here: without them those command names point at a binary that does not know them.
printf 'CONFIG_%s=y\n' WGET FOLD HOST RESET W HEXEDIT BUNZIP2 BZCAT >> scripts/android_miniconfig
# HOSTCC builds the configuration tool for this machine; CROSS_COMPILE + CC is the NDK clang for the phone.
# STRIP is the NDK's llvm-strip: the target has no GNU strip, and an unstripped binary is far larger.
make_args=(HOSTCC=cc CROSS_COMPILE="$toolchain_bin/aarch64-linux-android$ANDROID_API-" CC=clang STRIP="$toolchain_bin/llvm-strip")
make "${make_args[@]}" android_defconfig
make "${make_args[@]}" -j"$(nproc)"

grep -a -q "$TOYBOX_VERSION" toybox || { echo "built binary does not carry toybox $TOYBOX_VERSION" >&2; exit 1; }
cp toybox "$output"
