#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Building Unifia Mobile for Android..."
echo "Requires: Android SDK, NDK, and JAVA_HOME set"
echo ""

# Prepare embedded runtime binaries (bun, git, bash, rg, unifia-cli.js)
if [ ! -f "$SCRIPT_DIR/../src-tauri/assets/runtime/bin/bun" ]; then
  echo "Preparing Android runtime (first build)..."
  bash "$SCRIPT_DIR/prepare-android-runtime.sh"
else
  echo "Runtime binaries already prepared. Refreshing the embedded Unifia CLI bundle..."
  # WHY three levels: SCRIPT_DIR is <repo>/packages/mobile/scripts, so `..` is
  # packages/mobile and `../..` is packages. Only `../../..` is the repository
  # root where scripts/bundle-mobile.mjs lives. With `../..` this resolved to
  # <repo>/packages/scripts/bundle-mobile.mjs and failed with MODULE_NOT_FOUND.
  # The bug was latent because this branch only runs when the runtime binaries
  # already exist; on a first build the branch above runs instead.
  REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
  node "$REPO_ROOT/scripts/bundle-mobile.mjs" --outdir "$SCRIPT_DIR/../src-tauri/assets/runtime"
fi

# Ensure ONNX Runtime shared library is available for Parakeet STT, Silero
# VAD and Smart Turn. Two constraints pin the exact version:
# - the bionic linker does not resolve versioned symbols across versions, so
#   the .so linked at build time (ORT_LIB_LOCATION) must be the one bundled
#   (`OrtGetApiBase@@VERS_x.y.z` must match);
# - the `api-*` feature of `ort` in src-tauri/Cargo.toml must not exceed this
#   runtime's C API level, or every ONNX session panics on the device.
# Keep ORT_VERSION, ORT_SHA256 (official Maven AAR) and `api-23` together.
JNILIBS="$SCRIPT_DIR/../src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a"
ORT_VERSION="${ORT_VERSION:-1.23.0}"
ORT_SHA256="${ORT_SHA256:-2b7e4ed3c3028a1b2afac8dc324442c70b8983fc1a7cb6adda4133030d53f20a}"
ORT_SO="$JNILIBS/libonnxruntime.so"
if [ -n "${ORT_LIB_LOCATION:-}" ] && [ ! -f "$ORT_LIB_LOCATION/libonnxruntime.so" ]; then
  echo "ERROR: ORT_LIB_LOCATION does not contain libonnxruntime.so: $ORT_LIB_LOCATION" >&2
  exit 1
fi
if [ -n "${ORT_LIB_LOCATION:-}" ] && [ -f "$ORT_LIB_LOCATION/libonnxruntime.so" ] && [ ! -f "$ORT_SO" ]; then
  mkdir -p "$JNILIBS"
  cp "$ORT_LIB_LOCATION/libonnxruntime.so" "$ORT_SO"
  echo "ONNX Runtime copied from ORT_LIB_LOCATION: $(du -h -- "$ORT_SO" | cut -f1)"
fi
if [ ! -f "$ORT_SO" ]; then
  echo "Downloading ONNX Runtime $ORT_VERSION for Android arm64..."
  # Try Maven Central (official Qualcomm/Microsoft distribution)
  ORT_AAR_URL="https://repo1.maven.org/maven2/com/microsoft/onnxruntime/onnxruntime-android/${ORT_VERSION}/onnxruntime-android-${ORT_VERSION}.aar"
  mkdir -p "$JNILIBS"
  TMPDIR=$(mktemp -d)
  echo "Fetching from Maven Central..."
  if [ -z "$ORT_SHA256" ]; then
    echo "ERROR: ORT_SHA256 is required when downloading ONNX Runtime $ORT_VERSION." >&2
    exit 1
  fi
  if curl -fsSL "$ORT_AAR_URL" -o "$TMPDIR/ort.aar" && echo "$ORT_SHA256  $TMPDIR/ort.aar" | sha256sum -c -; then
    cd "$TMPDIR"
    unzip -q ort.aar "jni/arm64-v8a/libonnxruntime.so" 2>/dev/null || true
    if [ -f "jni/arm64-v8a/libonnxruntime.so" ]; then
      cp "jni/arm64-v8a/libonnxruntime.so" "$ORT_SO"
      echo "ONNX Runtime installed: $(du -h -- "$ORT_SO" | cut -f1)"
    else
      echo "WARNING: Could not extract libonnxruntime.so from AAR"
      echo "Please manually place libonnxruntime.so (arm64-v8a) in $JNILIBS/"
    fi
    rm -rf "$TMPDIR"
  else
    echo "ERROR: Failed to obtain ONNX Runtime $ORT_VERSION for Android." >&2
    echo "Set ORT_LIB_LOCATION to a directory containing libonnxruntime.so or provide a verified ORT_SHA256." >&2
    rm -rf "$TMPDIR"
    exit 1
  fi
  cd "$SCRIPT_DIR"
else
  echo "ONNX Runtime already present."
fi

require_ort_version() {
  if ! grep -a -q "VERS_${ORT_VERSION}" "$1"; then
    echo "ERROR: $1 is not ONNX Runtime $ORT_VERSION (found: $(grep -a -o 'VERS_1\.[0-9]*\.[0-9]*' "$1" | head -n1))." >&2
    echo "Replace it with the runtime from onnxruntime-android-${ORT_VERSION}.aar." >&2
    exit 1
  fi
}
[ -f "$ORT_SO" ] && require_ort_version "$ORT_SO"
[ -n "${ORT_LIB_LOCATION:-}" ] && require_ort_version "$ORT_LIB_LOCATION/libonnxruntime.so"

if [ ! -f "$ORT_SO" ] && [ -z "${ORT_LIB_LOCATION:-}" ]; then
  echo "ERROR: Android ONNX Runtime is unavailable; refusing to start Cargo with an opaque ort-sys failure." >&2
  exit 1
fi

# Set ORT_LIB_LOCATION for cargo build if not already set
if [ -z "${ORT_LIB_LOCATION:-}" ]; then
  # Check multiple possible locations
  ORT_EXTRACTED="$SCRIPT_DIR/../src-tauri/ort-android/extracted/jni/arm64-v8a"
  if [ -f "$ORT_EXTRACTED/libonnxruntime.so" ]; then
    export ORT_LIB_LOCATION="$ORT_EXTRACTED"
    echo "Using ORT from ort-android/extracted/"
  elif [ -f "$ORT_SO" ]; then
    export ORT_LIB_LOCATION="$JNILIBS"
    echo "Using ORT from jniLibs/"
  fi
fi
# Android ships only libonnxruntime.so, so ort-sys must link dynamically even
# when the caller provided ORT_LIB_LOCATION; otherwise it attempts a static
# link and fails with "could not link to the ONNX Runtime build".
export ORT_PREFER_DYNAMIC_LINK=1

echo ""
cd "$SCRIPT_DIR/../src-tauri"

# WHY size Cargo's parallelism on available RAM, not on core count: cargo
# defaults to one rustc per *logical* CPU (16 here), and each one drives its own
# LLVM. The release codegen for unifia-mobile (ort + reqwest + ndarray + tauri
# plus the voice crates) is the peak: when the machine was down to 1.7 GB free
# of 15.7 GB with the pagefile saturated, rustc died with
# `rustc-LLVM ERROR: out of memory`. Windows reports that as 0xc0000409
# STATUS_STACK_BUFFER_OVERRUN, a name that sends you hunting for a buffer bug
# instead of the real cause, which is simply memory exhaustion. Cores cap the
# upper bound; free RAM decides how far below it we can afford to go.
CARGO_RUSTC_MEMORY_BUDGET_GB="${CARGO_RUSTC_MEMORY_BUDGET_GB:-2}"
case "$CARGO_RUSTC_MEMORY_BUDGET_GB" in '' | *[!0-9]*) CARGO_RUSTC_MEMORY_BUDGET_GB=2 ;; esac
[ "$CARGO_RUSTC_MEMORY_BUDGET_GB" -lt 1 ] && CARGO_RUSTC_MEMORY_BUDGET_GB=1
CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-}"
if [ -z "$CARGO_BUILD_JOBS" ]; then
  read -r PHYSICAL_CORES AVAILABLE_GB <<<"$(
    powershell.exe -NoProfile -Command \
      "\$c=(Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfCores -Sum).Sum; \$f=[math]::Floor((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB); \"\$c \$f\"" \
      2>/dev/null | tr -d '\r'
  )"
  case "$PHYSICAL_CORES" in '' | *[!0-9]*) PHYSICAL_CORES="$(nproc 2>/dev/null || echo 2)" ;; esac
  case "$AVAILABLE_GB" in '' | *[!0-9]*) AVAILABLE_GB="" ;; esac
  [ "$PHYSICAL_CORES" -lt 1 ] && PHYSICAL_CORES=1
  if [ -n "$AVAILABLE_GB" ]; then
    CARGO_BUILD_JOBS=$(( AVAILABLE_GB / CARGO_RUSTC_MEMORY_BUDGET_GB ))
  else
    CARGO_BUILD_JOBS="$PHYSICAL_CORES"
  fi
  [ "$CARGO_BUILD_JOBS" -lt 1 ] && CARGO_BUILD_JOBS=1
  [ "$CARGO_BUILD_JOBS" -gt "$PHYSICAL_CORES" ] && CARGO_BUILD_JOBS="$PHYSICAL_CORES"
fi
export CARGO_BUILD_JOBS
echo "Cargo build jobs: $CARGO_BUILD_JOBS (override with CARGO_BUILD_JOBS, budget with CARGO_RUSTC_MEMORY_BUDGET_GB)"

# Build only aarch64 by default (ORT only has arm64-v8a binaries)
if echo "$@" | grep -q -- "--target"; then
  cargo tauri android build "$@"
else
  cargo tauri android build --target aarch64 "$@"
fi

echo "Build complete. APK at src-tauri/gen/android/app/build/outputs/apk/"
