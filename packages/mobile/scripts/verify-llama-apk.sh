#!/usr/bin/env bash
set -euo pipefail
apk="$1"
dir="packages/mobile/src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a"
for name in libllama_server.so libllama.so libggml.so libggml-base.so libggml-cpu.so; do
  entry="lib/arm64-v8a/$name"
  count=$(unzip -Z1 "$apk" | awk -v target="$entry" '$0 == target { count++ } END { print count+0 }')
  [[ "$count" == 1 ]] || { echo "Expected one APK entry: $entry" >&2; exit 1; }
  built=$(sha256sum "$dir/$name" | cut -d ' ' -f1)
  packaged=$(unzip -p "$apk" "$entry" | sha256sum | cut -d ' ' -f1)
  [[ "$built" == "$packaged" ]] || { echo "APK library differs from build: $name" >&2; exit 1; }
done
echo "APK llama.cpp libraries match the build"
