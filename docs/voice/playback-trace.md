<!-- SPDX-License-Identifier: MIT -->
# Android Live playback trace

Refs #689. This diagnostic separates generated speech, PCM delivery, and the
Oboe callback. It is not an acoustic qualification or microphone recording.
Normal sessions do not create any recordings.

## Explicit, one-session opt-in

With the diagnostic APK installed, before opening Live:

```powershell
adb -s b7163823 shell touch /sdcard/Android/data/ai.unifia.mobile/files/voice-live-trace.enabled
```

The next native audio session consumes this marker once. Capture starts only
when Pocket starts an utterance. Leave the normal microphone/barge-in enabled.
Stopping Live closes Oboe, drains its trace ring while the handle is still
alive, then destroys the handle. The file worker finalizes when its last
session/stream reference is dropped. A crash or unfinished stream may leave
an incomplete trace, which the report tool rejects.

Generated/output speech can contain private response content. Keep the files
local; do not attach them to GitHub or upload them automatically. The recorder
has no microphone stage and records neither input PCM nor input text. The
`vad-speaking` metric contains only a boolean, not microphone audio.

## Bounds and realtime behavior

- One session, at most 90 seconds from first synthesis, 24 MiB PCM and 16,384
  events. A new capture requires a new explicit marker.
- The native callback copies output into a preallocated SPSC ring, with
  lock-free atomic counters. No allocation, mutex, file I/O or logging there.
- Rust drains at most 65,536 samples per poll. A bounded nonblocking queue
  forwards events to a file worker. Saturation drops diagnostics, never audio;
  drops and limits invalidate the capture for attribution.
- Diagnostics are not timing-neutral: opt-in adds copies, queue operations
  and worker load. Compare normal operation as well as diagnostic operation.
- Final worker join can wait for storage during session/stream destruction,
  outside the realtime callback. A diagnostic storage error is logged and
  must not turn into a Live/TTS error.
- Existing lock order is Pocket engine -> native session, with no inverse
  acquisition in the native audio module. No new playback producer is added.

## Files and interpretation

In `/sdcard/Android/data/ai.unifia.mobile/files/voice-traces/<session>/`:

- `pocket-<id>-24000.pcm`: PCM16 LE mono after the existing float conversion,
  before IPC, resampling and playback; one file per synthesis request.
- `accepted-48000.pcm`: exactly the accepted portion of each native write,
  concatenated in write order. Rejected/backpressured samples are not copied.
- `rendered-48000.pcm`: mono PCM given to the Oboe output callback, including
  inserted silence. This is **not** Android mixer/speaker output.
- `trace.tsv`: versioned event manifest; monotonic microseconds, PCM byte
  counts, stream begin/EOF/end requests, read/lock/VAD/poll timings, largest
  callback and diagnostic losses. It contains no response text.

Different stages have different origins and durations. Do not align the raw
files by byte offset. Reconstruct each stage's offsets from its ordered PCM
events; use stream IDs/timestamps to identify synthesis boundaries. Counters
for empty playback include idle time, not just speech underruns. Poll times
include lock wait and diagnostics. A stream end request is not proof of a
false barge-in. Physical callback timestamps, per-callback occupancy and
Android processing remain unmeasured by this first diagnostic version.

Pull a finished session to D:, then validate/export without synthesizing again:

```powershell
python scripts/voice/playback_trace_report.py D:/path/to/session --export-wav
```

The report rejects unfinished/limited/lossy traces and mismatched PCM sizes;
WAV export preserves PCM bytes and refuses to overwrite. Replay those **same
files**, not a new synthesis of the same text, through the paths being compared.
WAV export alone does not perform an Oboe/WebAudio replay experiment.

## Regression checks

The Android workflow runs production-ring C++ tests under ASan/UBSan,
standalone Rust recorder tests with warnings denied, and Python report tests.
Rust target checking and native NDK syntax checking do not substitute for
linking an APK or qualifying acoustic behavior on the phone.
