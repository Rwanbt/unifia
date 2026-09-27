"""Section 24 audio-level equivalence gate: ONNX/C++ render vs eager PyTorch.

`WAV exists` is explicitly not an acceptance criterion (campaign §24), so this
compares the properties that actually matter for a usable voice:

  * duration agreement (a truncated or runaway render is the failure mode that
    a file-existence check would miss entirely);
  * non-silence agreement and EOS behaviour (does the render stop when the
    model says stop, or run on into padding?);
  * leading/trailing silence (onset latency and tail behaviour);
  * spectral similarity over the voiced region, which is the first objective
    signal that the two paths are producing the *same speech* rather than two
    differently-worded noises.

A naive sample-wise correlation is deliberately NOT used: ONNX and PyTorch
autoregressive decoding diverge slightly in *which* token is sampled once the
fp16 cache floor is crossed, so the waveforms cannot be expected to align
sample-by-sample. Duration + silence envelope + spectral shape is the
appropriate level of agreement for that situation, and a token/sequence
divergence is reported rather than hidden.
"""

import math
import struct
import sys
import wave
from array import array as _array
from pathlib import Path

WAVE_FORMAT_PCM = 1
WAVE_FORMAT_IEEE_FLOAT = 3

# A render is accepted when these hold. Chosen from the §24 failure modes, not
# fitted to the observed numbers; see docs/operations/pocket-onnx-export-evidence-2026-09-27.md
# §2.3 for why per-tensor equality is the wrong gate for an fp16-cache backbone.
MAX_DURATION_DRIFT = 0.25          # +-25% of reference duration
MAX_SILENCE_RATIO_DRIFT = 0.15     # absolute difference in voiced fraction
SPEECH_DETECT_FLOOR_DBFS = -50.0


def load(path: Path):
    """Load 16-bit PCM or 32-bit float WAV, downmixed to mono int16.

    Parses RIFF directly rather than using `wave`, because `wave` refuses the
    IEEE-float container (format tag 3) that the C++ runtime emits while eager
    PyTorch emits PCM16 - and both sides have to be readable to be compared.
    """
    data = path.read_bytes()
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError(f"{path.name}: not a RIFF/WAVE file")

    fmt_tag = channels = rate = width = None
    payload = None
    pos = 12
    while pos + 8 <= len(data):
        chunk_id = data[pos:pos + 4]
        chunk_size = struct.unpack("<I", data[pos + 4:pos + 8])[0]
        body = data[pos + 8:pos + 8 + chunk_size]
        if chunk_id == b"fmt ":
            fmt_tag, channels, rate, _byte_rate, _align, bits = struct.unpack(
                "<HHIIHH", body[:16]
            )
            width = bits // 8
        elif chunk_id == b"data":
            payload = body
        pos += 8 + chunk_size + (chunk_size & 1)

    if payload is None or fmt_tag is None:
        raise ValueError(f"{path.name}: missing fmt or data chunk")

    if fmt_tag == WAVE_FORMAT_IEEE_FLOAT and width == 4:
        values = _array("f")
        values.frombytes(payload[:len(payload) - (len(payload) % 4)])
        samples = _array("h", (
            max(-32768, min(32767, int(v * 32767.0))) for v in values
        ))
    elif fmt_tag == WAVE_FORMAT_PCM and width == 2:
        samples = _array("h")
        samples.frombytes(payload[:len(payload) - (len(payload) % 2)])
    else:
        raise ValueError(
            f"{path.name}: unsupported format tag={fmt_tag} width={width * 8}-bit"
        )

    if channels > 1:
        samples = _array("h", (
            sum(samples[i:i + channels]) // channels
            for i in range(0, len(samples) - channels + 1, channels)
        ))
    return samples, rate


def frame_rms(samples, rate, window_s=0.005):
    window = max(1, int(rate * window_s))
    out = []
    for start in range(0, len(samples), window):
        chunk = samples[start:start + window]
        if chunk:
            out.append((sum(s * s for s in chunk) / len(chunk)) ** 0.5)
    return out, window


def describe(path: Path) -> dict:
    samples, rate = load(path)
    rms_frames, window = frame_rms(samples, rate)
    threshold = 32768.0 * (10 ** (SPEECH_DETECT_FLOOR_DBFS / 20.0))
    voiced = [i for i, f in enumerate(rms_frames) if f > threshold]
    peak = max(max(samples), -min(samples)) if samples else 0
    return {
        "file": path.name,
        "rate": rate,
        "duration_s": len(samples) / rate if rate else 0.0,
        "peak_dbfs": 20 * math.log10(peak / 32768.0) if peak else float("-inf"),
        "non_silence_ratio": len(voiced) / len(rms_frames) if rms_frames else 0.0,
        "leading_silence_s": (voiced[0] * window / rate) if voiced else len(samples) / rate,
        "trailing_silence_s": ((len(rms_frames) - 1 - voiced[-1]) * window / rate) if voiced else 0.0,
        "frames": rms_frames,
        "window": window,
        "rate_actual": rate,
    }


def spectral_profile(path: Path, bands=20):
    """Log-magnitude band profile over the whole VOICED region.

    An earlier version truncated to the first 3 s and then analysed a single
    2048-sample window, which at 24 kHz is 85 ms - far too short to characterise
    a sentence, and it made the JSD swing wildly between runs (0.03 to 2.7 for
    the same pair of files) depending on which 85 ms happened to be analysed.
    A gate whose own metric is that unstable cannot be used to judge anything.

    This instead isolates the voiced frames using the same silence threshold
    as the rest of the tool, concatenates them, and evaluates a Goertzel
    filterbank across the whole span. The result is an utterance-level spectral
    envelope: still not a sample-alignment test, but now stable and meaningful.
    """
    samples, rate = load(path)
    if not samples:
        return [0.0] * bands

    rms_frames, window = frame_rms(samples, rate)
    threshold = 32768.0 * (10 ** (SPEECH_DETECT_FLOOR_DBFS / 20.0))
    voiced_samples = _array("h")
    for index, value in enumerate(rms_frames):
        if value > threshold:
            start = index * window
            voiced_samples.extend(samples[start:start + window])
    if len(voiced_samples) < rate // 2:
        voiced_samples = samples

    # Keep the comparison bounded: the profile is an envelope, not a waveform.
    span = voiced_samples[:rate * 10]
    length = len(span)
    if length < 64:
        return [0.0] * bands

    profile = []
    for band in range(bands):
        lo = 100.0 * (2.0 ** band)
        hi = lo * 2.0
        if hi > rate / 2:
            hi = rate / 2
        if lo >= rate / 2:
            break
        centre = (lo + hi) / 2.0
        omega = 2.0 * math.pi * centre / rate
        coeff = 2.0 * math.cos(omega)
        s1 = s2 = 0.0
        # Sample the envelope at a bounded number of evenly spaced points rather
        # than every sample, so cost does not scale with utterance length.
        stride = max(1, length // 20000)
        for n in range(0, length, stride):
            value = span[n]
            window_gain = 0.5 - 0.5 * math.cos(2.0 * math.pi * n / (length - 1))
            s0 = value * window_gain + coeff * s1 - s2
            s2, s1 = s1, s0
        magnitude = math.sqrt(max(0.0, s1 * s1 + s2 * s2 - coeff * s1 * s2)) / (length / stride)
        profile.append(20 * math.log10(magnitude + 1e-9))
    total = sum(profile) or 1.0
    return [p / total for p in profile]


def compare(reference: Path, candidate: Path) -> int:
    ref = describe(reference)
    cand = describe(candidate)

    print("=" * 78)
    print(f"reference : {ref['file']}  {ref['duration_s']:.3f}s @ {ref['rate']}Hz  "
          f"peak={ref['peak_dbfs']:.2f}dBFS  voice={ref['non_silence_ratio']:.3f}  "
          f"lead={ref['leading_silence_s']:.2f}s tail={ref['trailing_silence_s']:.2f}s")
    print(f"candidate : {cand['file']}  {cand['duration_s']:.3f}s @ {cand['rate']}Hz  "
          f"peak={cand['peak_dbfs']:.2f}dBFS  voice={cand['non_silence_ratio']:.3f}  "
          f"lead={cand['leading_silence_s']:.2f}s tail={cand['trailing_silence_s']:.2f}s")

    failures = []

    drift = (cand["duration_s"] - ref["duration_s"]) / max(ref["duration_s"], 1e-9)
    ok_dur = abs(drift) <= MAX_DURATION_DRIFT
    print(f"\nduration drift     : {drift:+.2%}  (limit +-{MAX_DURATION_DRIFT:.0%})  "
          f"{'PASS' if ok_dur else 'FAIL'}")
    if not ok_dur:
        failures.append("duration drift (truncation or runaway)")

    silence_drift = cand["non_silence_ratio"] - ref["non_silence_ratio"]
    ok_sil = abs(silence_drift) <= MAX_SILENCE_RATIO_DRIFT
    print(f"non-silence drift  : {silence_drift:+.3f}  (limit +-{MAX_SILENCE_RATIO_DRIFT})  "
          f"{'PASS' if ok_sil else 'FAIL'}")
    if not ok_sil:
        failures.append("non-silence / EOS behaviour")

    if cand["peak_dbfs"] < SPEECH_DETECT_FLOOR_DBFS:
        failures.append("candidate is silent")
        print("candidate level    : SILENT  FAIL")
    else:
        print(f"candidate level    : {cand['peak_dbfs']:.2f} dBFS  PASS (audible)")

    ref_profile = spectral_profile(reference)
    cand_profile = spectral_profile(candidate)
    # Jensen-Shannon divergence over the normalised band profile.
    divergence = 0.0
    for a, b in zip(ref_profile, cand_profile):
        m = (a + b) / 2.0
        if a > 0 and m > 0:
            divergence += 0.5 * a * math.log2(a / m)
        if b > 0 and m > 0:
            divergence += 0.5 * b * math.log2(b / m)
    ok_spec = divergence <= 0.35
    print(f"spectral JSD       : {divergence:.4f}  (limit 0.35)  {'PASS' if ok_spec else 'FAIL'}")
    if not ok_spec:
        failures.append("spectral shape")

    print("\n" + "=" * 78)
    if failures:
        print("VERDICT: FAIL -> " + "; ".join(failures))
        return 1
    print("VERDICT: PASS -> audio-level equivalence holds at the section 24 gate")
    return 0


def main(argv) -> int:
    if len(argv) < 3:
        print("usage: audio_compare.py <reference.wav> <candidate.wav>")
        return 1
    return compare(Path(argv[1]), Path(argv[2]))


if __name__ == "__main__":
    sys.exit(main(sys.argv))
