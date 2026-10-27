#!/usr/bin/env bash
set -euo pipefail

JNIDIR="packages/mobile/src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a"
HEADERS="packages/mobile/src-tauri/gen/android/llama-headers"
NDK=$ANDROID_HOME/ndk/27.0.12077973

# Pin the same source for development and release builds.
LLAMA_CPP_REV=$(tr -d "\r\n" < packages/mobile/llama-cpp-revision.txt)
[[ "$LLAMA_CPP_REV" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid llama.cpp revision" >&2; exit 1; }
git init /tmp/llama.cpp
git -C /tmp/llama.cpp remote add origin https://github.com/ggml-org/llama.cpp.git
git -C /tmp/llama.cpp fetch --depth 1 origin "$LLAMA_CPP_REV"
git -C /tmp/llama.cpp checkout --detach FETCH_HEAD
[[ "$(git -C /tmp/llama.cpp rev-parse HEAD)" == "$LLAMA_CPP_REV" ]]

# Build shared libraries with NDK
cmake -B /tmp/llama.cpp/build-android \
  -DCMAKE_TOOLCHAIN_FILE="$NDK"/build/cmake/android.toolchain.cmake \
  -DANDROID_ABI=arm64-v8a \
  -DANDROID_PLATFORM=android-28 \
  -DCMAKE_C_FLAGS="-march=armv8.2-a+dotprod+fp16" \
  -DCMAKE_CXX_FLAGS="-march=armv8.2-a+dotprod+fp16" \
  -DGGML_OPENMP=OFF \
  -DGGML_LLAMAFILE=OFF \
  -DLLAMA_CURL=OFF \
  -DLLAMA_BUILD_UI=OFF \
  -DLLAMA_USE_PREBUILT_UI=OFF \
  -DBUILD_SHARED_LIBS=ON \
  -DCMAKE_BUILD_TYPE=Release \
  -S /tmp/llama.cpp
cmake --build /tmp/llama.cpp/build-android --config Release -j"$(nproc)"

# Copy shared libs to jniLibs
cp /tmp/llama.cpp/build-android/bin/libllama.so "$JNIDIR/"
cp /tmp/llama.cpp/build-android/bin/libggml.so "$JNIDIR/"
cp /tmp/llama.cpp/build-android/bin/libggml-base.so "$JNIDIR/"
cp /tmp/llama.cpp/build-android/bin/libggml-cpu.so "$JNIDIR/"

# Strip
"$NDK"/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip "$JNIDIR"/libllama.so "$JNIDIR"/libggml*.so

# Also build static llama-server for HTTP endpoint
cmake -B /tmp/llama.cpp/build-static \
  -DCMAKE_SYSTEM_NAME=Linux \
  -DCMAKE_SYSTEM_PROCESSOR=aarch64 \
  -DCMAKE_C_COMPILER="$NDK"/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android28-clang \
  -DCMAKE_CXX_COMPILER="$NDK"/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android28-clang++ \
  -DCMAKE_C_FLAGS="-march=armv8.2-a" \
  -DCMAKE_CXX_FLAGS="-march=armv8.2-a" \
  -DBUILD_SHARED_LIBS=OFF \
  -DGGML_OPENMP=OFF \
  -DGGML_LLAMAFILE=OFF \
  -DLLAMA_CURL=OFF \
  -DLLAMA_BUILD_UI=OFF \
  -DLLAMA_USE_PREBUILT_UI=OFF \
  -DCMAKE_BUILD_TYPE=Release \
  -S /tmp/llama.cpp
cmake --build /tmp/llama.cpp/build-static --config Release --target llama-server -j"$(nproc)"
cp /tmp/llama.cpp/build-static/bin/llama-server "$JNIDIR/libllama_server.so"
# These identifiers cover the current mobile catalog and Spark X2.6.
for arch in llama gemma3 gemma4 phi3 qwen2 qwen3 spark2_5; do
  if ! strings "$JNIDIR/libllama_server.so" | grep -Fx "$arch" > /dev/null; then
    echo "llama-server lacks the required architecture: $arch" >&2
    exit 1
  fi
done
"$NDK"/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip "$JNIDIR/libllama_server.so"

# Copy headers for JNI compilation
mkdir -p "$HEADERS"
cp /tmp/llama.cpp/include/*.h "$HEADERS/"
cp /tmp/llama.cpp/ggml/include/*.h "$HEADERS/"

node packages/mobile/scripts/llama-provenance.mjs write

echo "llama.cpp built:"
ls -lh "$JNIDIR"/libllama*.so "$JNIDIR"/libggml*.so
