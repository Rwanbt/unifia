#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""G4 EOT candidate bake-off: deterministic endpointing vs Smart Turn v3.2.

Candidate order follows campaign section 19:

1. ``deterministic`` — trailing-silence endpointing, an exact replica of the
   production Rust ``CaptureSegmenter`` (threshold 0.5, minimum speech 280 ms,
   trailing silence 650 ms, maximum duration 60 s) driven by the committed
   Silero v6.2.2 per-frame probabilities stored in
   ``packages/voice-core/fixtures/turn-endpointing-parity.json``.
2. ``smart-turn-gated`` — identical trigger, but every trailing-silence commit
   is gated by the pinned ``smart-turn-v3.2-cpu.onnx`` model (pipecat-ai,
   Hugging Face revision pinned in the model registry). A rejected commit
   vetoes that silence run; the deterministic maximum-duration path is kept as
   fallback exactly as before (campaign: "Always retain deterministic
   maximum-silence fallback"). Commit wall time adds the measured Smart Turn
   end-to-end inference time of the gating call.

Metrics replicate ``voice::native_audio::eot_corpus_tests`` so both candidates
are judged by the committed benchmark evaluator. Candidate A must reproduce
the committed benchmark numbers exactly (harness anchor); candidate B is
reported against the same tables. This is host-side benchmark evidence only —
it never claims physical or production qualification.

Smart Turn feature extraction is vendored from pipecat
``src/pipecat/audio/turn/smart_turn/_whisper_features.py``
(Copyright (c) 2024-2026, Daily, BSD 2-Clause License), which itself mirrors
the Hugging Face ``WhisperFeatureExtractor`` (Apache-2.0); see the upstream
repositories for the reference implementations.

Usage:
    python scripts/voice/eot_bakeoff_smart_turn.py [--json PATH]
"""

from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import math
import sys
import time
from pathlib import Path
from typing import Any, Callable

import numpy as np
import onnxruntime as ort
from numpy.lib.stride_tricks import sliding_window_view

REPO_ROOT = Path(__file__).resolve().parents[2]
CORPUS_JSON = REPO_ROOT / "packages" / "contracts" / "corpus" / "unifia-eot-bench.json"
PARITY_FIXTURE = REPO_ROOT / "packages" / "voice-core" / "fixtures" / "turn-endpointing-parity.json"
REGISTRY_JSON = REPO_ROOT / "packages" / "voice-host" / "models" / "registry.json"
SMART_TURN_MODEL = REPO_ROOT / ".build-temp" / "smart-turn" / "smart-turn-v3.2-cpu.onnx"
DEFAULT_JSON_OUT = REPO_ROOT / ".build-temp" / "smart-turn" / "bakeoff-results.json"

RATE = 16_000
FRAME_SAMPLES = 512
FRAME_MS = 32
SPEECH_THRESHOLD = 0.5
MIN_UTTERANCE_SAMPLES = RATE * 280 // 1000
MAX_UTTERANCE_SAMPLES = RATE * 60
END_OF_TURN_SILENCE_MS = 650
PRE_SPEECH_MS = 500
PRE_SPEECH_SAMPLES = RATE * PRE_SPEECH_MS // 1000
MAX_SEGMENT_SAMPLES = RATE * 8
SMART_TURN_THRESHOLD = 0.5
# Candidate C policy: one Smart Turn evaluation at the deterministic trigger;
# a veto defers the commit to a bounded deterministic fallback 128 ms (4
# frames) later. Total silence before commit stays <= 650 + 128 + 32 ms and
# the emission delay stays inside the benchmark's +/- 250 ms non-barge budget
# (the probe over the corpus showed no vetoed segment accepting before 150 ms
# anyway, so a re-evaluation cadence buys nothing inside the bound).
PERSIST_CAP_SAMPLES = RATE * 128 // 1000

# Calibrated budget constants, mirrored from native_audio.rs.
SPEECH_RATE_MIN = 0.94
FALSE_POSITIVE_RATE_MAX = 0.12
FINAL_DELTA_MAX_MS = 250
EARLY_FINAL_MAX_MS = 150
TOTAL_FORBIDDEN_MAX = 30
MID_RECORDING_FORBIDDEN_MAX = 6
INCOMPLETE_FORBIDDEN_MAX = 2
TURN_COMPLETE_MATCHED_MIN = 76
BARGE_EMITTED_MIN = 4
EXPECTED_LANGUAGES = ("en", "fr", "es", "it", "de")

# Anchor: numbers committed by test(voice): benchmark Silero VAD against the
# five-language EOT corpus (candidate A must reproduce them exactly).
ANCHOR_A = {
    "matched_400": 78,
    "total_forbidden": 24,
    "mid_recording_forbidden": 5,
    "early_finals": 14,
    "barge_emitted": 4,
    "language_non_barge_matched": {"en": 20, "fr": 14, "es": 14, "it": 14, "de": 14},
}


# --- Vendored Whisper log-mel features (pipecat, BSD 2-Clause) ---------------

_N_FFT = 400
_HOP_LENGTH = 160
_N_MELS = 80
_SAMPLING_RATE = 16_000
_MEL_FLOOR = 1e-10
_NORM_VARIANCE_EPS = 1e-7


def _hertz_to_mel_slaney(freq: np.ndarray) -> np.ndarray:
    min_log_hertz = 1000.0
    min_log_mel = 15.0
    logstep = 27.0 / np.log(6.4)
    freq = np.atleast_1d(np.asarray(freq, dtype=np.float64))
    mels = 3.0 * freq / 200.0
    log_region = freq >= min_log_hertz
    mels[log_region] = min_log_mel + np.log(freq[log_region] / min_log_hertz) * logstep
    return mels


def _mel_to_hertz_slaney(mels: np.ndarray) -> np.ndarray:
    min_log_hertz = 1000.0
    min_log_mel = 15.0
    logstep = np.log(6.4) / 27.0
    mels = np.atleast_1d(np.asarray(mels, dtype=np.float64))
    freq = 200.0 * mels / 3.0
    log_region = mels >= min_log_mel
    freq[log_region] = min_log_hertz * np.exp(logstep * (mels[log_region] - min_log_mel))
    return freq


def _build_mel_filterbank(
    num_frequency_bins: int,
    num_mel_filters: int,
    min_frequency: float,
    max_frequency: float,
    sampling_rate: int,
) -> np.ndarray:
    mel_min = float(_hertz_to_mel_slaney(np.array([min_frequency], dtype=np.float64))[0])
    mel_max = float(_hertz_to_mel_slaney(np.array([max_frequency], dtype=np.float64))[0])
    mel_freqs = np.linspace(mel_min, mel_max, num_mel_filters + 2)
    filter_freqs = _mel_to_hertz_slaney(mel_freqs)
    fft_freqs = np.linspace(0, sampling_rate // 2, num_frequency_bins)

    filter_diff = np.diff(filter_freqs)
    slopes = np.expand_dims(filter_freqs, 0) - np.expand_dims(fft_freqs, 1)
    down_slopes = -slopes[:, :-2] / filter_diff[:-1]
    up_slopes = slopes[:, 2:] / filter_diff[1:]
    mel_filters = np.maximum(np.zeros(1), np.minimum(down_slopes, up_slopes))

    enorm = 2.0 / (filter_freqs[2 : num_mel_filters + 2] - filter_freqs[:num_mel_filters])
    mel_filters *= np.expand_dims(enorm, 0)
    return mel_filters


def _periodic_hann_window(window_length: int) -> np.ndarray:
    return np.hanning(window_length + 1)[:-1]


_HANN_WINDOW = _periodic_hann_window(_N_FFT)
_MEL_FILTERS = _build_mel_filterbank(
    num_frequency_bins=_N_FFT // 2 + 1,
    num_mel_filters=_N_MELS,
    min_frequency=0.0,
    max_frequency=_SAMPLING_RATE / 2.0,
    sampling_rate=_SAMPLING_RATE,
)


def _power_spectrogram(
    waveform: np.ndarray,
    window: np.ndarray,
    frame_length: int,
    hop_length: int,
) -> np.ndarray:
    pad = frame_length // 2
    padded = np.pad(waveform.astype(np.float64), (pad, pad), mode="reflect")
    win = window.astype(np.float64)
    windows = sliding_window_view(padded, frame_length)[::hop_length]
    spec = np.fft.rfft(windows * win, axis=-1)
    return (np.abs(spec) ** 2).T


def compute_whisper_log_mel_features(audio: np.ndarray, *, do_normalize: bool = True) -> np.ndarray:
    if audio.ndim != 1:
        raise ValueError(f"Expected 1-D audio, got shape {audio.shape}")
    x = np.asarray(audio, dtype=np.float32)
    n_samples = _SAMPLING_RATE * 8
    if x.size < n_samples:
        x = np.pad(x, (0, n_samples - x.size), mode="constant")
    elif x.size > n_samples:
        x = x[:n_samples]
    if do_normalize:
        x = (x - x.mean()) / np.sqrt(x.var() + _NORM_VARIANCE_EPS)
    magnitudes = _power_spectrogram(x, _HANN_WINDOW, _N_FFT, _HOP_LENGTH)
    mel_spec = np.maximum(_MEL_FLOOR, _MEL_FILTERS.T @ magnitudes)
    log_spec = np.log10(mel_spec)
    log_spec = log_spec[:, :-1]
    log_spec = np.maximum(log_spec, log_spec.max() - 8.0)
    log_spec = (log_spec + 4.0) / 4.0
    return log_spec.astype(np.float32)


# --- Pin verification ---------------------------------------------------------


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def registry_entry(model_id: str) -> dict[str, Any]:
    registry = json.loads(REGISTRY_JSON.read_text(encoding="utf-8"))
    for model in registry["models"]:
        if model["model_id"] == model_id:
            return model
    raise SystemExit(f"model {model_id} missing from {REGISTRY_JSON}")


def verify_pin(model_id: str, path: Path) -> dict[str, Any]:
    entry = registry_entry(model_id)
    if not path.is_file():
        raise SystemExit(f"missing artifact {path}; download it from {entry['source']}")
    digest = sha256_file(path)
    if digest != entry["sha256"]:
        raise SystemExit(
            f"{path} SHA-256 {digest} does not match registry pin {entry['sha256']}"
        )
    size = path.stat().st_size
    if size != entry["size_bytes"]:
        raise SystemExit(f"{path} size {size} != registry {entry['size_bytes']}")
    return entry


# --- Deterministic segmenter replica ------------------------------------------


class Segmenter:
    """Exact replica of the Rust ``CaptureSegmenter`` VAD path with a hook.

    ``gate`` receives a would-commit event and returns
    ``(allow, extra_delay_ms)``. Candidate A uses a pass-through gate;
    candidate B consults Smart Turn. The turn PCM itself is not buffered here:
    candidate B slices it straight from the WAV using ``turn_start_sample``
    and ``cursor`` (the segmenter's own accounting only drives the min/max
    sample counters).
    """

    def __init__(self, gate: Callable[[str, "Segmenter"], tuple[bool, int]] | None = None):
        self.sample_count = 0
        self.speech_active = False
        self.silent_ms = 0
        self.turn_start_sample: int | None = None
        self.cursor = 0
        self.gate = gate or (lambda _kind, _segmenter: (True, 0))
        # Veto bookkeeping for the Smart Turn gates: cursor of the first veto
        # inside the current silence run. Cleared whenever speech resumes or a
        # turn commits.
        self.veto_first_cursor: int | None = None
        self.last_delay_ms = 0

    def _clear_veto(self) -> None:
        self.veto_first_cursor = None

    def finish(self) -> bool:
        self.speech_active = False
        self.silent_ms = 0
        self._clear_veto()
        self.turn_start_sample = None
        too_short = self.sample_count < MIN_UTTERANCE_SAMPLES
        self.sample_count = 0
        return not too_short

    def accept(self, probability: float) -> bool:
        active = probability >= SPEECH_THRESHOLD
        if not self.speech_active and not active:
            self.cursor += FRAME_SAMPLES
            return False
        commit_kind: str | None = None
        if active:
            self.speech_active = True
            self.silent_ms = 0
            self._clear_veto()
            if self.turn_start_sample is None:
                self.turn_start_sample = self.cursor
            self.sample_count = min(self.sample_count + FRAME_SAMPLES, MAX_UTTERANCE_SAMPLES)
        elif self.speech_active:
            self.silent_ms += max(FRAME_MS, 1)
            if self.silent_ms >= END_OF_TURN_SILENCE_MS:
                commit_kind = "trailing-silence"
        if commit_kind is None and self.sample_count >= MAX_UTTERANCE_SAMPLES:
            commit_kind = "maximum-duration"

        emitted = False
        if commit_kind is not None:
            allow, delay_ms = self.gate(commit_kind, self)
            self.last_delay_ms = delay_ms
            if allow:
                emitted = self.finish()
        self.cursor += FRAME_SAMPLES
        return emitted


def run_deterministic(frames: list[float]) -> list[int]:
    """Candidate A: pass-through gate, emissions at the crossing frame end."""
    segmenter = Segmenter()
    emissions: list[int] = []
    for index, probability in enumerate(frames):
        if segmenter.accept(probability):
            emissions.append((index + 1) * FRAME_MS)
    return emissions


def run_smart_turn_gated(
    frames: list[float],
    wav: np.ndarray,
    fixture_id: str,
    smart_turn: SmartTurn,
    gate_decisions: list[dict[str, Any]],
    *,
    candidate: str,
    cap_samples: int | None = None,
) -> list[int]:
    """Smart Turn gate on every trailing-silence commit.

    Two policies share this driver:

    - candidate B (default): exactly one evaluation per silence run; a veto
      waits for the next speech resumption (pure veto, bounded only by the
      deterministic maximum-duration fallback).
    - candidate C (``cap_samples`` set): a veto defers the commit to a bounded
      deterministic fallback that fires ``cap_samples`` (128 ms = 4 frames)
      after the first veto, without further inference.
    """

    def gate(kind: str, segmenter: Segmenter) -> tuple[bool, int]:
        # Deterministic maximum-duration fallback stays ungated.
        if kind == "maximum-duration":
            return True, 0
        cursor = segmenter.cursor
        trigger_ms = (cursor // FRAME_SAMPLES + 1) * FRAME_MS

        if segmenter.veto_first_cursor is not None:
            first_trigger_ms = (
                segmenter.veto_first_cursor // FRAME_SAMPLES + 1
            ) * FRAME_MS
            if cap_samples is None or cursor - segmenter.veto_first_cursor < cap_samples:
                # Pure veto (B) or still waiting for the bounded cap (C).
                return False, 0
            # Bounded deterministic fallback: commit this frame without
            # further inference. Emission = first veto + cap (+ 1 frame).
            gate_decisions.append(
                {
                    "candidate": candidate,
                    "fixture": fixture_id,
                    "kind": f"{kind}-veto-cap",
                    "trigger_ms": trigger_ms,
                    "offset_ms": trigger_ms - first_trigger_ms,
                    "probability": None,
                    "accepted": True,
                    "forced": True,
                    "e2e_ms": 0.0,
                }
            )
            return True, 0

        start = 0
        if segmenter.turn_start_sample is not None:
            start = max(0, segmenter.turn_start_sample - PRE_SPEECH_SAMPLES)
        end = min(cursor + FRAME_SAMPLES, wav.size)
        accept, probability, e2e_ms = smart_turn.predict(wav[start:end])
        gate_decisions.append(
            {
                "candidate": candidate,
                "fixture": fixture_id,
                "kind": kind,
                "trigger_ms": trigger_ms,
                "offset_ms": 0,
                "probability": round(probability, 6),
                "accepted": accept,
                "forced": False,
                "e2e_ms": round(e2e_ms, 3),
            }
        )
        if accept:
            return True, int(math.ceil(e2e_ms))
        segmenter.veto_first_cursor = cursor
        return False, 0

    segmenter = Segmenter(gate)
    emissions: list[int] = []
    for index, probability in enumerate(frames):
        if segmenter.accept(probability):
            emissions.append((index + 1) * FRAME_MS + segmenter.last_delay_ms)
    return emissions


# --- Smart Turn session -------------------------------------------------------


class SmartTurn:
    def __init__(self, model_path: Path):
        options = ort.SessionOptions()
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        options.inter_op_num_threads = 1
        options.intra_op_num_threads = 1
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.session = ort.InferenceSession(str(model_path), sess_options=options)
        self.calls = 0
        self.accepts = 0
        self.e2e_ms: list[float] = []
        self.probabilities: list[float] = []

    def predict(self, segment_int16: np.ndarray) -> tuple[bool, float, float]:
        audio = segment_int16.astype(np.float32) / 32768.0
        if audio.size > MAX_SEGMENT_SAMPLES:
            audio = audio[-MAX_SEGMENT_SAMPLES:]
        elif audio.size < MAX_SEGMENT_SAMPLES:
            audio = np.pad(audio, (MAX_SEGMENT_SAMPLES - audio.size, 0), mode="constant")
        started = time.perf_counter()
        features = compute_whisper_log_mel_features(audio, do_normalize=True)
        outputs = self.session.run(None, {"input_features": features[None]})
        e2e_ms = (time.perf_counter() - started) * 1000.0
        probability = float(outputs[0][0][0])
        accept = probability > SMART_TURN_THRESHOLD
        self.calls += 1
        self.accepts += int(accept)
        self.e2e_ms.append(e2e_ms)
        self.probabilities.append(probability)
        return accept, probability, e2e_ms


# --- Corpus loading -----------------------------------------------------------


def load_corpus() -> list[dict[str, Any]]:
    corpus = json.loads(CORPUS_JSON.read_text(encoding="utf-8"))
    if corpus["version"] != "2.0.0" or len(corpus["fixtures"]) != 91:
        raise SystemExit("unexpected corpus shape")
    return corpus["fixtures"]


def load_parity_frames() -> dict[str, list[float]]:
    fixture = json.loads(PARITY_FIXTURE.read_text(encoding="utf-8"))
    frames: dict[str, list[float]] = {}
    for case in fixture["cases"]:
        if case["name"].startswith("corpus/"):
            frames[case["name"].removeprefix("corpus/")] = case["frames"]
    if len(frames) != 91:
        raise SystemExit(f"parity fixture holds {len(frames)} corpus cases, expected 91")
    return frames


def read_wav(fixture: dict[str, Any]) -> np.ndarray:
    import wave as wave_module

    path = CORPUS_JSON.parent / fixture["audio"]["path"]
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != fixture["audio"]["sha256"]:
        raise SystemExit(f"{fixture['id']}: WAV SHA-256 mismatch")
    with wave_module.open(str(path), "rb") as handle:
        if (
            handle.getframerate() != fixture["audio"]["sampleRateHz"]
            or handle.getframerate() != RATE
            or handle.getnchannels() != 1
            or handle.getsampwidth() != 2
        ):
            raise SystemExit(f"{fixture['id']}: unexpected WAV format")
        samples = np.frombuffer(handle.readframes(handle.getnframes()), dtype=np.int16)
    measured_ms = round(len(samples) * 1000 / RATE)
    if measured_ms != fixture["audio"]["durationMs"]:
        raise SystemExit(
            f"{fixture['id']}: WAV duration {measured_ms} ms != annotation "
            f"{fixture['audio']['durationMs']} ms"
        )
    return samples


# --- Evaluator (mirror of native_audio.rs) ------------------------------------


def in_interval(ms: int, intervals: list[dict[str, int]]) -> bool:
    return any(interval["startMs"] <= ms < interval["endMs"] for interval in intervals)


def condition_of(fixture: dict[str, Any]) -> str:
    return f"{fixture['audio']['noiseCondition']}/{fixture['audio']['overlapCondition']}"


def evaluate(fixture: dict[str, Any], emissions: list[int]) -> dict[str, Any]:
    audio = fixture["audio"]
    forbidden = sum(
        1 for emission in emissions if in_interval(emission, audio["forbiddenEotIntervalsMs"])
    )
    return {
        "id": fixture["id"],
        "language": fixture["language"],
        "condition": condition_of(fixture),
        "emissions_ms": emissions,
        "expected_eot_ms": audio["expectedEotMs"],
        "forbidden_emissions": forbidden,
        "incomplete_commits": int(audio["expectedEotMs"] is None and bool(emissions)),
    }


def aggregate(outcomes: list[dict[str, Any]]) -> dict[str, Any]:
    turn_complete = 0
    matched_400 = 0
    total_forbidden = 0
    early_finals = 0
    mid_recording_forbidden = 0
    barge_total = 0
    barge_emitted = 0
    incomplete_commits = 0
    clipped_emitted = 0
    language_matched: dict[str, int] = {language: 0 for language in EXPECTED_LANGUAGES}
    language_total: dict[str, int] = {language: 0 for language in EXPECTED_LANGUAGES}
    violations: list[str] = []

    for outcome in outcomes:
        total_forbidden += outcome["forbidden_emissions"]
        incomplete_commits += outcome["incomplete_commits"]
        is_barge = outcome["condition"].endswith("/assistant-speech")
        is_clipped = outcome["condition"].startswith("clipped/")
        is_incomplete = outcome["expected_eot_ms"] is None
        last_emission = outcome["emissions_ms"][-1] if outcome["emissions_ms"] else None

        if is_barge:
            barge_total += 1
            if last_emission is not None:
                barge_emitted += 1
        if is_clipped and last_emission is not None:
            clipped_emitted += 1
            violations.append(f"{outcome['id']}: clipped fixture emitted {last_emission} ms")

        expected = outcome["expected_eot_ms"]
        if expected is not None:
            turn_complete += 1
            if last_emission is None:
                if not is_barge:
                    violations.append(f"{outcome['id']}: no final emission for turn-complete")
            else:
                delta = last_emission - expected
                if abs(delta) <= 400:
                    matched_400 += 1
                last_forbidden = last_emission < expected
                forbidden_before_last = outcome["forbidden_emissions"] - int(last_forbidden)
                mid_recording_forbidden += forbidden_before_last
                if last_forbidden:
                    early_finals += 1
                    if delta < -EARLY_FINAL_MAX_MS:
                        violations.append(
                            f"{outcome['id']}: final {delta:+} ms earlier than "
                            f"-{EARLY_FINAL_MAX_MS} ms"
                        )
                if not is_barge:
                    if abs(delta) > FINAL_DELTA_MAX_MS:
                        violations.append(
                            f"{outcome['id']}: non-barge delta {delta:+} ms exceeds "
                            f"±{FINAL_DELTA_MAX_MS} ms"
                        )
                    language_matched[outcome["language"]] += 1
        else:
            if is_incomplete and outcome["forbidden_emissions"] > INCOMPLETE_FORBIDDEN_MAX:
                violations.append(
                    f"{outcome['id']}: {outcome['forbidden_emissions']} forbidden emissions "
                    f"on incomplete fixture (max {INCOMPLETE_FORBIDDEN_MAX})"
                )
            if not is_clipped and not is_incomplete:
                violations.append(f"{outcome['id']}: unexpected null-EOT fixture")
        if is_barge and outcome["forbidden_emissions"] > 0:
            violations.append(
                f"{outcome['id']}: barge fixture fired "
                f"{outcome['forbidden_emissions']} times inside its forbidden window"
            )
        if outcome["forbidden_emissions"] > 2:
            violations.append(
                f"{outcome['id']}: {outcome['forbidden_emissions']} forbidden emissions "
                "(max 2 per fixture)"
            )
        language_total[outcome["language"]] += 1

    return {
        "turn_complete": turn_complete,
        "matched_400": matched_400,
        "total_forbidden": total_forbidden,
        "early_finals": early_finals,
        "mid_recording_forbidden": mid_recording_forbidden,
        "barge_total": barge_total,
        "barge_emitted": barge_emitted,
        "incomplete_commits": incomplete_commits,
        "clipped_emitted": clipped_emitted,
        "language_non_barge_matched": language_matched,
        "language_total": language_total,
        "within_budget": (
            not violations
            and matched_400 >= TURN_COMPLETE_MATCHED_MIN
            and total_forbidden <= TOTAL_FORBIDDEN_MAX
            and mid_recording_forbidden <= MID_RECORDING_FORBIDDEN_MAX
            and barge_emitted >= BARGE_EMITTED_MIN
            and clipped_emitted == 0
            and all(language_matched[language] > 0 for language in EXPECTED_LANGUAGES)
        ),
        "violations": violations,
    }


def speech_stats(
    fixtures: list[dict[str, Any]], frames_by_id: dict[str, list[float]]
) -> tuple[int, int, int, int]:
    speech_frames = detected_speech = silence_frames = false_positives = 0
    for fixture in fixtures:
        audio = fixture["audio"]
        for index, probability in enumerate(frames_by_id[fixture["id"]]):
            center_ms = index * FRAME_MS + FRAME_MS // 2
            detected = probability >= SPEECH_THRESHOLD
            if in_interval(center_ms, audio["speechIntervalsMs"]):
                speech_frames += 1
                detected_speech += int(detected)
            elif in_interval(center_ms, audio["silenceIntervalsMs"]) and not in_interval(
                center_ms, audio["assistantSpeechIntervalsMs"]
            ):
                silence_frames += 1
                false_positives += int(detected)
    return speech_frames, detected_speech, silence_frames, false_positives


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    return float(np.percentile(np.asarray(values, dtype=np.float64), p))


def rss_mb() -> float:
    class Counters(ctypes.Structure):
        _fields_ = [
            ("PageFaultCount", ctypes.c_uint32),
            ("PeakWorkingSetSize", ctypes.c_size_t),
            ("WorkingSetSize", ctypes.c_size_t),
            ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
            ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
            ("PagefileUsage", ctypes.c_size_t),
            ("PeakPagefileUsage", ctypes.c_size_t),
        ]

    counters = Counters()
    kernel32 = ctypes.windll.kernel32
    kernel32.GetCurrentProcess.restype = ctypes.c_void_p
    process = kernel32.GetCurrentProcess()
    psapi = ctypes.windll.psapi
    psapi.GetProcessMemoryInfo.argtypes = (
        ctypes.c_void_p,
        ctypes.POINTER(Counters),
        ctypes.c_uint32,
    )
    psapi.GetProcessMemoryInfo.restype = ctypes.c_int
    ok = psapi.GetProcessMemoryInfo(process, ctypes.byref(counters), ctypes.sizeof(counters))
    if not ok:
        return 0.0
    return counters.WorkingSetSize / (1024 * 1024)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", type=Path, default=DEFAULT_JSON_OUT)
    args = parser.parse_args()

    pins = {
        "smart-turn": verify_pin("smart-turn-v3.2-cpu-onnx", SMART_TURN_MODEL),
        "silero": verify_pin(
            "silero-vad-v6.2.2-onnx", REPO_ROOT / ".build-temp" / "silero-vad-v6.2.2.onnx"
        ),
    }
    print(f"pins verified: {pins['smart-turn']['model_id']} + {pins['silero']['model_id']}")

    fixtures = load_corpus()
    frames_by_id = load_parity_frames()
    smart_turn = SmartTurn(SMART_TURN_MODEL)

    # Warm-up so first-call session setup does not pollute the p50/p95 table.
    smart_turn.predict(np.zeros(RATE, dtype=np.int16))
    smart_turn.calls = 0
    smart_turn.accepts = 0
    smart_turn.e2e_ms.clear()
    smart_turn.probabilities.clear()

    cpu_started = time.process_time()
    outcomes: dict[str, list[dict[str, Any]]] = {
        "deterministic": [],
        "smart-turn-gated": [],
        "smart-turn-persist": [],
    }
    gate_decisions: list[dict[str, Any]] = []

    for fixture in fixtures:
        wav = read_wav(fixture)
        frames = frames_by_id[fixture["id"]]

        outcomes["deterministic"].append(evaluate(fixture, run_deterministic(frames)))
        outcomes["smart-turn-gated"].append(
            evaluate(
                fixture,
                run_smart_turn_gated(
                    frames,
                    wav,
                    fixture["id"],
                    smart_turn,
                    gate_decisions,
                    candidate="smart-turn-gated",
                ),
            )
        )
        outcomes["smart-turn-persist"].append(
            evaluate(
                fixture,
                run_smart_turn_gated(
                    frames,
                    wav,
                    fixture["id"],
                    smart_turn,
                    gate_decisions,
                    candidate="smart-turn-persist",
                    cap_samples=PERSIST_CAP_SAMPLES,
                ),
            )
        )

    cpu_seconds = time.process_time() - cpu_started
    speech_frames, detected, silence_frames, false_positives = speech_stats(
        fixtures, frames_by_id
    )

    aggregates = {name: aggregate(rows) for name, rows in outcomes.items()}
    aggregate_a = aggregates["deterministic"]

    # Harness anchor: candidate A must reproduce the committed benchmark.
    anchor_errors: list[str] = []
    for key, expected in ANCHOR_A.items():
        if aggregate_a[key] != expected:
            anchor_errors.append(f"anchor A {key}: {aggregate_a[key]} != committed {expected}")
    speech_rate = detected / max(speech_frames, 1)
    false_positive_rate = false_positives / max(silence_frames, 1)
    if round(speech_rate, 4) != 0.9503:
        anchor_errors.append(f"anchor A speech_rate: {speech_rate:.4f} != 0.9503")
    if round(false_positive_rate, 4) != 0.0769:
        anchor_errors.append(f"anchor A false_positive_rate: {false_positive_rate:.4f} != 0.0769")
    if anchor_errors:
        print("ANCHOR FAILURES (harness does not match committed benchmark):")
        for error in anchor_errors:
            print(f"  - {error}")
        return 1
    print("anchor OK: candidate A reproduces the committed benchmark numbers")

    smart_summary = {
        "calls": smart_turn.calls,
        "accepts": smart_turn.accepts,
        "rejects": smart_turn.calls - smart_turn.accepts,
        "e2e_ms_p50": round(percentile(smart_turn.e2e_ms, 50), 3),
        "e2e_ms_p95": round(percentile(smart_turn.e2e_ms, 95), 3),
        "e2e_ms_max": round(max(smart_turn.e2e_ms, default=0.0), 3),
        "probability_min": round(min(smart_turn.probabilities, default=0.0), 6),
        "probability_max": round(max(smart_turn.probabilities, default=0.0), 6),
    }

    results = {
        "generated_by": "scripts/voice/eot_bakeoff_smart_turn.py",
        "pins": {key: {k: entry[k] for k in ("model_id", "sha256", "size_bytes", "licence", "upstream_revision")} for key, entry in pins.items()},
        "runtime": {
            "python": sys.version.split()[0],
            "onnxruntime": ort.__version__,
            "numpy": np.__version__,
            "cpu_seconds": round(cpu_seconds, 3),
            "peak_rss_mb": round(rss_mb(), 1),
        },
        "speech_frames": speech_frames,
        "detected_speech_frames": detected,
        "speech_rate": round(speech_rate, 4),
        "false_positive_rate": round(false_positive_rate, 4),
        "candidates": aggregates,
        "smart_turn": smart_summary,
        "persistence_policy": {
            "veto_cap_ms": PERSIST_CAP_SAMPLES * 1000 // RATE,
            "threshold": SMART_TURN_THRESHOLD,
            "re_evaluations": "none (single evaluation per silence run)",
        },
        "gate_decisions": gate_decisions,
        "per_fixture": outcomes,
    }
    args.json.parent.mkdir(parents=True, exist_ok=True)
    args.json.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")

    labels = {
        "deterministic": "deterministic (A)",
        "smart-turn-gated": "smart-turn-gated (B)",
        "smart-turn-persist": "smart-turn-persist (C)",
    }
    for key, table in aggregates.items():
        print(
            f"[{labels[key]}] matched_400={table['matched_400']}/{table['turn_complete']} "
            f"forbidden={table['total_forbidden']} mid={table['mid_recording_forbidden']} "
            f"early={table['early_finals']} barge={table['barge_emitted']}/{table['barge_total']} "
            f"incomplete_commits={table['incomplete_commits']} "
            f"clipped_emitted={table['clipped_emitted']} "
            f"languages={table['language_non_barge_matched']} "
            f"within_budget={table['within_budget']}"
        )
        if table["violations"]:
            for violation in table["violations"]:
                print(f"  ! {violation}")
    print(f"smart-turn: {smart_summary}")
    print(f"cpu={results['runtime']['cpu_seconds']}s rss={results['runtime']['peak_rss_mb']}MB")
    print(f"wrote {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
