#!/usr/bin/env bash
set -euo pipefail
apk="$1"
dir="packages/mobile/src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a"
node packages/mobile/scripts/llama-provenance.mjs check
# WHY use the checked manifest: official releases include shared server implementations
# and accelerator libraries that the historical five-file check did not cover.
names=$(node -e 'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log(Object.keys(p.libraries).join("\n"))' "$dir/llama-provenance.json")
while IFS= read -r name; do
  entry="lib/arm64-v8a/$name"
  count=$(unzip -Z1 "$apk" | awk -v target="$entry" '$0 == target { count++ } END { print count+0 }')
  [[ "$count" == 1 ]] || { echo "Expected one APK entry: $entry" >&2; exit 1; }
  built=$(sha256sum "$dir/$name" | cut -d ' ' -f1)
  packaged=$(unzip -p "$apk" "$entry" | sha256sum | cut -d ' ' -f1)
  [[ "$built" == "$packaged" ]] || { echo "APK library differs from build: $name" >&2; exit 1; }
done <<< "$names"
echo "APK llama.cpp libraries match the build"
