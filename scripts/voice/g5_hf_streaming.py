#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""G5 candidate A2: transformers F32 streaming transcription (model-card API).

Streams paced audio through AutoModelForRNNT + TextIteratorStreamer exactly as
documented in the nvidia/nemotron-3.5-asr-streaming-0.6b model card, measures
WER / first partial / retractions / final latency per fixture.

uv run --quiet --with "transformers>=5.13.0" --with torch --with numpy \
    --with librosa python scripts/voice/g5_hf_streaming.py --all \
    --validity .build-temp/g5-streaming/results/audio-validity.json \
    --out .build-temp/g5-streaming/results/g5-hf-streaming.json
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import queue
import pathlib
import re
import string
import sys
import threading
import time
import wave

import numpy as np
import torch
from transformers import AutoModelForRNNT, AutoProcessor, TextIteratorStreamer

ROOT = pathlib.Path(__file__).resolve().parents[2]
CORPUS = ROOT / "packages" / "contracts" / "corpus" / "unifia-eot-bench.json"
MODEL_DIR = ROOT / ".build-temp" / "g5-streaming" / "hf-nemotron35"
CHUNK_MS = 100


def normalize(text: str) -> list[str]:
    text = text.lower()
    text = re.sub(rf"[{re.escape(string.punctuation)}]", " ", text)
    return [w for w in text.split() if w]


def wer(ref: str, hyp: str) -> float:
    r, h = normalize(ref), normalize(hyp)
    if not r:
        return 0.0 if not h else 1.0
    prev = list(range(len(h) + 1))
    for i, rw in enumerate(r, 1):
        cur = [i] + [0] * len(h)
        for j, hw in enumerate(h, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (rw != hw))
        prev = cur
    return prev[-1] / len(r)


def pct(values: list[float], p: float) -> float:
    if not values:
        return float("nan")
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, math.ceil(p / 100 * len(ordered)) - 1))
    return ordered[idx]


def mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else float("nan")


class TimedStreamer(TextIteratorStreamer):
    """TextIteratorStreamer that records (wall_time, incremental_text).

    put() receives token-id tensors, not str: the decoded fragments are
    drained from text_queue after each put.
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.events: list[tuple[float, str]] = []
        self.finished = False

    def put(self, value):
        super().put(value)
        while True:
            try:
                item = self.text_queue.get_nowait()
            except queue.Empty:
                break
            if item == self.stop_signal:
                self.finished = True
                break
            self.events.append((time.perf_counter(), item))


def load_fixture(fixture: dict) -> np.ndarray:
    wav_path = CORPUS.parent / fixture["audio"]["path"]
    with wave.open(str(wav_path), "rb") as w:
        if w.getframerate() != 16000 or w.getnchannels() != 1:
            raise ValueError(f"{wav_path}: expected 16 kHz mono")
        return np.frombuffer(w.readframes(w.getnframes()),
                             dtype="<i2").astype(np.float32) / 32768.0


def run_fixture(proc, model, fixture: dict) -> dict:
    lang = fixture["language"]
    audio = load_fixture(fixture)
    sr = proc.feature_extractor.sampling_rate
    audio_dur_s = len(audio) / sr

    proc.set_num_lookahead_tokens(6)

    first_samples = audio[: proc.num_samples_first_audio_chunk]
    if len(first_samples) < proc.num_samples_first_audio_chunk:
        # pad short clips (e.g. es-clip-01, 380ms) so the first streaming
        # chunk yields the exact required mel-frame count
        first_samples = np.pad(
            first_samples, (0, proc.num_samples_first_audio_chunk - len(first_samples))
        )
    first_chunk_inputs = proc(
        first_samples,
        sampling_rate=sr, is_streaming=True, is_first_audio_chunk=True,
        language=lang, return_tensors="pt",
    )
    first_chunk_inputs = first_chunk_inputs.to(model.device, dtype=model.dtype)

    yield_log: list[tuple[float, float]] = []  # (wall, audio_pos_seconds)
    hop = proc.feature_extractor.hop_length
    n_fft = proc.feature_extractor.n_fft

    def input_features_generator():
        yield first_chunk_inputs.input_features[:, : proc.num_mel_frames_first_audio_chunk, :]
        now = time.perf_counter()
        audio_pos = proc.num_samples_first_audio_chunk / sr
        yield_log.append((now, audio_pos))

        mel_idx = proc.num_mel_frames_first_audio_chunk
        start_idx = mel_idx * hop - n_fft // 2
        while (end_idx := start_idx + proc.num_samples_per_audio_chunk) < len(audio):
            # pace: never feed audio ahead of wall clock (real-time arrival)
            target = t0 + end_idx / sr
            delay = target - time.perf_counter()
            if delay > 0:
                time.sleep(delay)
            inputs = proc(audio[start_idx:end_idx], sampling_rate=sr,
                          is_streaming=True, is_first_audio_chunk=False,
                          language=lang, return_tensors="pt")
            inputs = inputs.to(model.device, dtype=model.dtype)
            yield inputs.input_features
            mel_idx += proc.num_mel_frames_per_audio_chunk
            start_idx = mel_idx * hop - n_fft // 2
            yield_log.append((time.perf_counter(), end_idx / sr))

        # stream the remainder (padded tail) so the full utterance, trailing
        # silence included, reaches the model like a realtime client would
        if start_idx < len(audio):
            delay = t0 + len(audio) / sr - time.perf_counter()
            if delay > 0:
                time.sleep(delay)
            tail = np.pad(audio[start_idx:],
                          (0, start_idx + proc.num_samples_per_audio_chunk - len(audio)))
            inputs = proc(tail, sampling_rate=sr,
                          is_streaming=True, is_first_audio_chunk=False,
                          language=lang, return_tensors="pt")
            inputs = inputs.to(model.device, dtype=model.dtype)
            yield inputs.input_features
            yield_log.append((time.perf_counter(), len(audio) / sr))

    # timed streamer: drains decoded fragments from text_queue per put()
    streamer = TimedStreamer(proc.tokenizer, skip_special_tokens=True)

    t0 = time.perf_counter()
    thread = threading.Thread(
        target=model.generate,
        kwargs={**first_chunk_inputs, "input_features": input_features_generator(),
                "streamer": streamer, "max_new_tokens": 400},
        daemon=True,
    )
    thread.start()
    thread.join(timeout=300)
    t_end = time.perf_counter()

    cumulative = ""
    retractions = 0
    appended = 0
    rewritten = 0
    first_text_t = None
    first_text_audio = None
    for t, delta in streamer.events:
        prev = cumulative
        cumulative += delta
        if prev and not cumulative.startswith(prev):
            retractions += 1
            shared = 0
            for a, b in zip(prev, cumulative):
                if a != b:
                    break
                shared += 1
            rewritten += len(prev) - shared
        else:
            appended += len(cumulative) - len(prev)
        if first_text_t is None and cumulative.strip():
            first_text_t = t
            pos = 0.0
            for yt, ap in yield_log:
                if yt <= t:
                    pos = ap
                else:
                    break
            first_text_audio = pos

    final_text = cumulative.strip()
    stability = appended / (appended + rewritten) if (appended + rewritten) else 1.0

    return {
        "id": fixture["id"],
        "language": lang,
        "audioDurationMs": round(audio_dur_s * 1000, 1),
        "transcriptExpected": fixture["transcript"],
        "transcriptFinal": final_text,
        "wer": round(wer(fixture["transcript"], final_text), 4),
        "firstTextPartialWallMs": (round((first_text_t - t0) * 1000, 1)
                                   if first_text_t else None),
        "firstTextPartialAudioMs": (round(first_text_audio * 1000, 1)
                                    if first_text_audio is not None else None),
        "partialCount": len(streamer.events),
        "retractions": retractions,
        "stabilityRatio": round(stability, 4),
        "finalLatencyMs": round((t_end - t0 - audio_dur_s) * 1000, 1),
        "wallMs": round((t_end - t0) * 1000, 1),
        "error": None,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=".build-temp/g5-streaming/results/g5-hf-streaming.json")
    ap.add_argument("--ids", default=None)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--validity", default=None)
    args = ap.parse_args()

    corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
    fixtures = {f["id"]: f for f in corpus["fixtures"]}
    if args.all:
        selected = [fixtures[k] for k in sorted(fixtures)]
    else:
        ids = [s.strip() for s in args.ids.split(",")] if args.ids else \
            ["en-short-01", "fr-short-01", "es-short-01", "it-short-01", "de-short-01"]
        selected = [fixtures[i] for i in ids if i in fixtures]

    validity = None
    if args.validity:
        data = json.loads(pathlib.Path(args.validity).read_text(encoding="utf-8"))
        validity = {r["id"]: r["valid"] for r in data["results"]}

    print("loading model...", flush=True)
    proc = AutoProcessor.from_pretrained(str(MODEL_DIR))
    model = AutoModelForRNNT.from_pretrained(str(MODEL_DIR))
    model.eval()
    print("model ready", flush=True)

    results = []
    for i, fx in enumerate(selected, 1):
        try:
            res = run_fixture(proc, model, fx)
        except Exception as exc:  # noqa: BLE001
            res = {"id": fx["id"], "language": fx["language"],
                   "error": f"{type(exc).__name__}: {exc}"}
        if validity is not None:
            res["audioValid"] = validity.get(fx["id"])
        results.append(res)
        print(f"[{i}/{len(selected)}] {res['id']:<20} wer={res.get('wer')} "
              f"first={res.get('firstTextPartialWallMs')}ms "
              f"lat={res.get('finalLatencyMs')}ms retr={res.get('retractions')}",
              flush=True)

    def agg(rows):
        good = [r for r in rows if isinstance(r.get("wer"), (int, float))
                and r.get("audioValid") is not False]
        lat = [r for r in rows if isinstance(r.get("finalLatencyMs"), (int, float))]
        return {
            "fixtures": len(rows),
            "audioValid": sum(1 for r in rows if r.get("audioValid") is True),
            "errors": sum(1 for r in rows if r.get("error")),
            "werMean": round(mean([r["wer"] for r in good]), 4) if good else None,
            "werP95": round(pct([r["wer"] for r in good], 95), 4) if good else None,
            "firstPartialWallMsMean": round(mean(
                [r["firstTextPartialWallMs"] for r in lat
                 if r.get("firstTextPartialWallMs") is not None]), 1) if lat else None,
            "firstPartialAudioMsMean": round(mean(
                [r["firstTextPartialAudioMs"] for r in lat
                 if r.get("firstTextPartialAudioMs") is not None]), 1) if lat else None,
            "finalLatencyMsMean": round(mean(
                [r["finalLatencyMs"] for r in lat]), 1) if lat else None,
            "retractionsTotal": sum(r.get("retractions", 0) for r in rows),
            "stabilityRatioMean": round(mean(
                [r["stabilityRatio"] for r in lat]), 4) if lat else None,
        }

    by_lang = {}
    for r in results:
        by_lang.setdefault(r.get("language", "?"), []).append(r)

    report = {
        "harness": "g5_hf_streaming",
        "model": "nvidia/nemotron-3.5-asr-streaming-0.6b F32 safetensors (transformers)",
        "transport": "TextIteratorStreamer, paced 100ms input chunks (model card API)",
        "audioValidityScreen": args.validity,
        "overall": agg(results),
        "byLanguage": {k: agg(v) for k, v in sorted(by_lang.items())},
        "fixtures": results,
    }
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(report["overall"], indent=2))
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
