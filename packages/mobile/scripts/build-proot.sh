#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Builds PRoot (GPL-2.0-or-later) from source at a pinned commit of Termux's
# maintained fork, with talloc (LGPL-3.0-or-later) linked statically, for
# ADR-098 containers. This script is the "corresponding source" record ADR-098
# promises: upstream URLs, exact versions and digests, build steps.
#
#   host   : native build for the machine running it (Linux in the e2e CI)
#   android: arm64 build with the NDK (ANDROID_NDK_HOME), loader unbundled so it
#            can ship as libproot-loader.so next to libproot_exec.so in nativeLibraryDir
#
# Usage: build-proot.sh host|android <output dir>
set -euo pipefail

PROOT_REPO="https://github.com/termux/proot.git"
PROOT_COMMIT="e2d843ee6dab076ea0ed1ffd5d0ea12232185499"
TALLOC_VERSION="2.4.2"
TALLOC_URL="https://www.samba.org/ftp/talloc/talloc-$TALLOC_VERSION.tar.gz"
# Computed on the published tarball, whose .tar.asc verifies with the Samba Library
# Distribution Key 9147A339719518EE9011BCB54793916113084025 (checked 2026-10-22).
TALLOC_SHA256="85ecf9e465e20f98f9950a52e9a411e14320bc555fa257d87697b7e7a9b1d8a6"

target="${1:?usage: build-proot.sh host|android <output dir>}"
out="$(mkdir -p "${2:?output dir}" && cd "$2" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

case "$target" in
  host) CC="${CC:-cc}" AR="${AR:-ar}" STRIP="${STRIP:-strip}"; extra=(); include_fix="" ;;
  android)
    : "${ANDROID_NDK_HOME:?set ANDROID_NDK_HOME}"
    toolchain="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin"
    CC="$toolchain/aarch64-linux-android24-clang" AR="$toolchain/llvm-ar" STRIP="$toolchain/llvm-strip"
    # The loader cannot be exec'd from app data on Android; it ships in nativeLibraryDir.
    extra=(PROOT_UNBUNDLE_LOADER=.)
    # The Termux-only ashmem_memfd extension calls strcmp/memset without <string.h>;
    # NDK clang makes that implicit declaration an error.
    include_fix="-include string.h"
    ;;
  *) echo "unknown target $target" >&2; exit 2 ;;
esac

curl -fsSL "$TALLOC_URL" -o "$work/talloc.tgz"
echo "$TALLOC_SHA256  $work/talloc.tgz" | sha256sum -c -
tar -xzf "$work/talloc.tgz" -C "$work"
# talloc is one C file; compiling it directly avoids its waf cross-compile setup.
# This config.h stands in for the one waf would generate (glibc and Bionic both have these).
cat > "$work/config.h" <<'CONFIG'
#define HAVE_STDBOOL_H 1
#define HAVE_BOOL 1
#define HAVE_STDINT_H 1
#define HAVE_INTTYPES_H 1
#define HAVE_STRING_H 1
#define HAVE_STRINGS_H 1
#define HAVE_STDLIB_H 1
#define HAVE_UNISTD_H 1
#define HAVE_SYS_TYPES_H 1
#define HAVE_SYS_TIME_H 1
#define TIME_WITH_SYS_TIME 1
#define HAVE_LIMITS_H 1
#define HAVE_FCNTL_H 1
#define HAVE_STDDEF_H 1
#define HAVE_DLFCN_H 1
#define HAVE_INTPTR_T 1
#define HAVE_UINTPTR_T 1
#define HAVE_PTRDIFF_T 1
#define HAVE_SIG_ATOMIC_T_TYPE 1
#define HAVE_USECONDS_T 1
#define HAVE_VA_COPY 1
#define HAVE_C99_VSNPRINTF 1
#define HAVE_SNPRINTF 1
#define HAVE_VSNPRINTF 1
#define HAVE_ASPRINTF 1
#define HAVE_VASPRINTF 1
#define HAVE_STRNLEN 1
#define HAVE_STRNDUP 1
#define HAVE_STRDUP 1
#define HAVE_MEMMOVE 1
#define HAVE_SETENV 1
#define HAVE_UNSETENV 1
#define HAVE_USLEEP 1
#define HAVE_DLOPEN 1
#define HAVE_DLSYM 1
#define HAVE_DLERROR 1
#define HAVE_DLCLOSE 1
#define HAVE_ERRNO_DECL 1
#define HAVE_CONSTRUCTOR_ATTRIBUTE 1
#define HAVE_DESTRUCTOR_ATTRIBUTE 1
#define HAVE___ATTRIBUTE__ 1
#define TALLOC_BUILD_VERSION_MAJOR 2
#define TALLOC_BUILD_VERSION_MINOR 4
#define TALLOC_BUILD_VERSION_RELEASE 2
CONFIG
"$CC" -O2 -fPIC -D__STDC_WANT_LIB_EXT1__=1 -D_GNU_SOURCE -I"$work" -I"$work/talloc-$TALLOC_VERSION" -I"$work/talloc-$TALLOC_VERSION/lib/replace" \
  -c "$work/talloc-$TALLOC_VERSION/talloc.c" -o "$work/talloc.o"
"$AR" rcs "$work/libtalloc.a" "$work/talloc.o"

git clone --quiet --filter=blob:none "$PROOT_REPO" "$work/proot"
git -C "$work/proot" checkout --quiet "$PROOT_COMMIT"
cp "$work/talloc-$TALLOC_VERSION/talloc.h" "$work/proot/src/"
# Through the environment, not make's command line: the GNUmakefile appends (+=)
# _GNU_SOURCE and its own flags, which a command-line value would replace.
CPPFLAGS="-I$work/proot/src $include_fix" LDFLAGS="-L$work -l:libtalloc.a" \
  make -C "$work/proot/src" -j"$(nproc)" CC="$CC" STRIP="$STRIP" "${extra[@]}" \
    HAS_LOADER_32BIT= proot loader/loader
# HAS_LOADER_32BIT= : no 32-bit guest loader. On an aarch64 host it would need -m32,
# which aarch64 compilers lack, and ADR-098 runs 64-bit images only.

if [ "$target" = android ]; then
  install -m 0755 "$work/proot/src/proot" "$out/libproot_exec.so"
  install -m 0755 "$work/proot/src/loader/loader" "$out/libproot-loader.so"
else
  install -m 0755 "$work/proot/src/proot" "$out/proot"
fi
install -m 0644 "$work/proot/COPYING" "$out/PROOT-COPYING"
echo "PRoot $PROOT_COMMIT (talloc $TALLOC_VERSION) built for $target in $out"
