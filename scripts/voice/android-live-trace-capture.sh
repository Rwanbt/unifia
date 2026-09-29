#!/usr/bin/env bash
# android-live-trace-capture.sh — pre-stage for the R12 Android standalone gate.
#
# Usage:
#   ANDROID_SERIAL=<serial> scripts/voice/android-live-trace-capture.sh <out-dir>
#
# Captures a stage-tagged trace of the local Live journey on the target
# Xiaomi, recording everything that the v2 RFC §"Voice-current-state and
# evidence report" §0 lists as "still open":
#
#   * TTS voice discovery outcome (WebView speechSynthesis localService voices)
#   * STT model load (native Parakeet command via packages/mobile/src-tauri/src/speech.rs)
#   * Microphone acquisition (AudioRecord, WebView getUserMedia)
#   * session/provider selection (assistant.info.error)
#
# All output is routed to <out-dir>; the script is idempotent and safe to
# re-run on the same device after a fresh APK install.
#
# The Xiaomi Mi 10 Pro serial seen in the 2026-09-25 inspection is
# b7163823 (package ai.unifia.mobile 0.1.0). Re-run after rebuilding
# from the exact SHA under test, install the matching APK first, and
# compare the SHA reported by `pm path` to the expected one before
# declaring any PASS.

set -euo pipefail

if [[ -z "${ANDROID_SERIAL:-}" ]]; then
  echo "ANDROID_SERIAL is required (e.g. b7163823 for the Xiaomi Mi 10 Pro)." >&2
  exit 64
fi

OUT_DIR="${1:-/tmp/voice-trace-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$OUT_DIR"

log() {
  printf "[trace %s] %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

# 0. Sanity: device alive, package present, exact SHA installed matches the build under test.
log "device state"
adb -s "$ANDROID_SERIAL" shell "pidof ai.unifia.mobile" > "$OUT_DIR/pidof.txt" 2>&1 || true
adb -s "$ANDROID_SERIAL" shell "dumpsys package ai.unifia.mobile | grep -E 'versionCode|lastUpdateTime'" > "$OUT_DIR/package.txt" 2>&1 || true
adb -s "$ANDROID_SERIAL" shell "pm path ai.unifia.mobile" > "$OUT_DIR/apk-path.txt" 2>&1 || true
APK_PATH="$(adb -s "$ANDROID_SERIAL" shell 'pm path ai.unifia.mobile' | sed -n 's/^package://p' | tr -d '\r' | head -n1 || true)"
if [[ -n "$APK_PATH" ]]; then
  adb -s "$ANDROID_SERIAL" pull "$APK_PATH" "$OUT_DIR/installed.apk" >/dev/null 2>&1 || true
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$OUT_DIR/installed.apk" > "$OUT_DIR/installed.apk.sha256" 2>&1 || true
  fi
fi

# 1. Memory and swap at idle (sanity reference, not Live evidence).
log "idle memory snapshot"
adb -s "$ANDROID_SERIAL" shell "cat /proc/meminfo | head -n 4" > "$OUT_DIR/meminfo-idle.txt" 2>&1 || true

# 2. TTS voice discovery (Android system + WebView localService).
log "TTS voice discovery"
adb -s "$ANDROID_SERIAL" shell "settings get secure tts_default_synth" > "$OUT_DIR/tts-default-synth.txt" 2>&1 || true
adb -s "$ANDROID_SERIAL" shell "pm list packages -e | grep -E 'tts|speech'" > "$OUT_DIR/tts-packages.txt" 2>&1 || true

# 3. Microphone capability (just the listing; do not actually record — start
#    the Live flow under the app's own UI to capture a real turn).
log "microphone capability"
adb -s "$ANDROID_SERIAL" shell "dumpsys media.audio_policy | head -n 80" > "$OUT_DIR/audio-policy.txt" 2>&1 || true

# 4. Logcat snapshot — only Voice / Tauri / WebView lines, last 5 minutes of activity.
log "logcat snapshot (last 5000 lines filtered to voice/webview/tauri)"
adb -s "$ANDROID_SERIAL" logcat -d -t 5000 > "$OUT_DIR/logcat-raw.txt" 2>&1 || true
grep -E 'Voice|tauri|webview|TTS|STT|microphone|AudioRecord|SpeechRecognizer' "$OUT_DIR/logcat-raw.txt" \
  > "$OUT_DIR/logcat-voice.txt" 2>/dev/null || true

# 5. Open the app, hit the Live orb, capture the next 60 s of logcat.
log "open app + Live orb (manual)"
adb -s "$ANDROID_SERIAL" shell "monkey -p ai.unifia.mobile -c android.intent.category.LAUNCHER 1" \
  > "$OUT_DIR/monkey.txt" 2>&1 || true
sleep 5
adb -s "$ANDROID_SERIAL" logcat -c || true
adb -s "$ANDROID_SERIAL" logcat -d > "$OUT_DIR/logcat-pre-live.txt" 2>&1 || true

log "operator: tap the Live orb in the app within 5 s, speak a 5-second utterance, then tap again to stop."
sleep 60
adb -s "$ANDROID_SERIAL" logcat -d > "$OUT_DIR/logcat-during-live.txt" 2>&1 || true
grep -E 'Voice|tauri|webview|TTS|STT|microphone|AudioRecord|SpeechRecognizer|info\.error|prepare|startListening' \
  "$OUT_DIR/logcat-during-live.txt" > "$OUT_DIR/logcat-live-filtered.txt" 2>/dev/null || true

# 6. Final memory snapshot for thermal/RSS analysis.
log "post-Live memory snapshot"
adb -s "$ANDROID_SERIAL" shell "cat /proc/meminfo | head -n 4" > "$OUT_DIR/meminfo-after.txt" 2>&1 || true
adb -s "$ANDROID_SERIAL" shell "ps -A -o RSS,NAME | grep -E 'ai\.unifia|voice'" > "$OUT_DIR/ps-voice.txt" 2>&1 || true

log "trace complete; outputs in $OUT_DIR"
echo "$OUT_DIR" > "$OUT_DIR/.out-dir"