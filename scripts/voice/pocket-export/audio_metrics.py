"""Section 24 audio-level metrics for one or more WAV files.

`WAV exists` is explicitly not an acceptance criterion, so this reports the
properties §24 actually asks for: duration, non-silence ratio, peak/RMS level,
leading/trailing silence, and whether the tail is truncated mid-energy. It is
deliberately dependency-free (stdlib `wave` + `audioop`-free manual stats) so it
can run in CI without scipy.
"""

import array
import struct
import sys
import wave
from pathlib import Path

SILENCE_FLOOR_DBFS = -50.0


def read_wav(path: Path):
    with wave.open(str(path), "rb") as handle:
        channels = handle.getnchannels()
        width = handle.getsampwidth()
        rate = handle.getframerate()
        frames = handle.getnframes()
        raw = handle.readframes(frames)
    if width != 2:
        raise ValueError(f"{path}: only 16-bit PCM supported, got {width * 8}-bit")
    samples = array.array("h")
    samples.frombytes(raw)
    if channels > 1:
        samples = array.array("h", (
            sum(samples[i:i + channels]) // channels
            for i in range(0, len(samples), channels)
        ))
    return samples, rate


def dbfs(peak: int) -> float:
    if peak == 0:
        return float("-inf")
    return 20.0 * __import__("math").log10(peak / 32768.0)


def analyse(path: Path) -> dict:
    samples, rate = read_wav(path)
    total = len(samples)
    duration = total / rate if rate else 0.0
    if total == 0:
        return {"file": path.name, "error": "empty"}

    peak = max(max(samples), -min(samples))
    squares = sum(s * s for s in samples)
    rms = int((squares / total) ** 0.5)
    # 5 ms analysis window, matching a typical silence detector granularity.
    window = max(1, int(rate * 0.005))
    frame_rms = []
    for start in range(0, total, window):
        chunk = samples[start:start + window]
        if not chunk:
            break
        frame_rms.append((sum(s * s for s in chunk) / len(chunk)) ** 0.5)
    threshold = 32768.0 * (10 ** (SILENCE_FLOOR_DBFS / 20.0))
    voiced = [f for f in frame_rms if f > threshold]
    non_silence_ratio = len(voiced) / len(frame_rms) if frame_rms else 0.0

    leading = 0
    for f in frame_rms:
        if f > threshold:
            break
        leading += 1
    trailing = 0
    for f in reversed(frame_rms):
        if f > threshold:
            break
        trailing += 1

    # Truncation proxy: a clip cut mid-utterance ends on a loud frame; a
    # clean render decays into near-silence.
    tail = frame_rms[-1] if frame_rms else 0.0
    last_voiced = max((i for i, f in enumerate(frame_rms) if f > threshold), default=None)
    tail_frames_after_voice = (len(frame_rms) - 1 - last_voiced) if last_voiced is not None else None
    likely_truncated = bool(tail > threshold and (tail_frames_after_voice or 0) <= 1)

    return {
        "file": path.name,
        "sample_rate": rate,
        "channels": 1,
        "duration_s": round(duration, 3),
        "samples": total,
        "peak_dbfs": round(dbfs(peak), 2),
        "rms_dbfs": round(dbfs(rms), 2),
        "non_silence_ratio": round(non_silence_ratio, 4),
        "leading_silence_s": round(leading * window / rate, 3),
        "trailing_silence_s": round(trailing * window / rate, 3),
        "likely_truncated": likely_truncated,
    }


def main(argv) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 1
    for arg in argv[1:]:
        for path in sorted(Path().glob(arg)) or [Path(arg)]:
            if not path.is_file():
                print(f"missing: {path}")
                continue
            row = analyse(path)
            print(f"{row['file']:28s} {row['duration_s']:>7.3f}s  "
                  f"peak={row['peak_dbfs']:>7.2f}dBFS  rms={row['rms_dbfs']:>7.2f}dBFS  "
                  f"voice={row['non_silence_ratio']:>6.3f}  "
                  f"lead={row['leading_silence_s']:.2f}s tail={row['trailing_silence_s']:.2f}s  "
                  f"trunc={row['likely_truncated']}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
