#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""G5 streaming STT bake-off harness (Unifia Voice v2.2 brief, section 20).

Drives the NeMo-Speech.cpp realtime WebSocket with paced 16 kHz PCM16 audio
from the Unifia EOT corpus and measures, per fixture:

  - WER (final transcript vs corpus transcript, word-level Levenshtein)
  - first partial latency (wall clock from audio start -> first delta event)
  - first text partial (audio seconds consumed when text first appears)
  - partial stability (retractions = cumulative text that is not a prefix
    extension of the previous cumulative text)
  - final latency (wall clock from end of audio -> completed event)
  - server RSS / CPU samples during the run

Prerequisites (started separately, documented in the G5 checkpoint):

  nemo-speech serve --no-ui --host 127.0.0.1 --port 8137 --asr-model <gguf>

Usage:

  uv run --quiet --with websockets --with psutil \
      python scripts/voice/g5_streaming_bakeoff.py \
      --port 8137 --out .build-temp/g5-streaming/results/g5.json

  --ids en-short-01,fr-...   run a subset (comma-separated fixture ids)
  --all                      run every fixture (default: 5 smoke fixtures)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import pathlib
import re
import string
import sys
import time
import wave

ROOT = pathlib.Path(__file__).resolve().parents[2]
CORPUS = ROOT / "packages" / "contracts" / "corpus" / "unifia-eot-bench.json"
WS_PATH = "/v1/audio/transcriptions/realtime"
CHUNK_MS = 100
SMOKE_IDS = [
    "en-short-01", "fr-short-01", "es-short-01", "it-short-01", "de-short-01",
]


def normalize(text: str) -> list[str]:
    """Lowercase, strip punctuation (keep intra-word apostrophes), split words."""
    text = text.lower()
    text = re.sub(rf"[{re.escape(string.punctuation)}]", " ", text)
    text = text.replace("'", "")  # safety after apostrophe-keep removal
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


def load_fixture_audio(fixture: dict) -> bytes:
    wav_path = CORPUS.parent / fixture["audio"]["path"]
    with wave.open(str(wav_path), "rb") as w:
        if w.getframerate() != 16000 or w.getnchannels() != 1 or w.getsampwidth() != 2:
            raise ValueError(f"{wav_path}: expected 16 kHz mono PCM16")
        return w.readframes(w.getnframes())


async def run_fixture(ws_url: str, fixture: dict, language: str) -> dict:
    import websockets

    pcm = load_fixture_audio(fixture)
    audio_dur_s = len(pcm) / 32000.0
    events: list[tuple[float, dict]] = []
    created = asyncio.Event()
    updated = asyncio.Event()
    done = asyncio.Event()
    completed: dict | None = None
    first_text: dict | None = None
    first_text_t: float | None = None

    async def reader(ws):
        nonlocal completed, first_text, first_text_t
        while True:
            raw = await ws.recv()
            if not isinstance(raw, str):
                continue
            now = time.perf_counter()
            ev = json.loads(raw)
            events.append((now, ev))
            t = ev.get("type", "")
            if t == "session.created":
                created.set()
            elif t == "session.updated":
                updated.set()
            elif t.endswith("transcription.delta") and ev.get("delta") \
                    and first_text is None:
                first_text, first_text_t = ev, now
            elif t.endswith("transcription.completed") or t == "error":
                completed = ev
                done.set()
                return

    async with websockets.connect(ws_url, max_size=None) as ws:
        reader_task = asyncio.create_task(reader(ws))
        await asyncio.wait_for(created.wait(), timeout=15)
        await ws.send(json.dumps({
            "type": "session.update",
            "session": {"sample_rate": 16000, "language": language,
                        "automatic_punctuation": True},
        }))
        await asyncio.wait_for(updated.wait(), timeout=15)
        frame = 16000 * CHUNK_MS // 1000 * 2
        t_audio_start = time.perf_counter()
        offsets = list(range(0, len(pcm), frame))
        for i, off in enumerate(offsets):
            await ws.send(pcm[off:off + frame])
            if i + 1 < len(offsets):
                await asyncio.sleep(CHUNK_MS / 1000)
        t_audio_end = time.perf_counter()
        await ws.send(json.dumps({"type": "input_audio_buffer.commit"}))
        await asyncio.wait_for(done.wait(), timeout=60)
        await reader_task
        t_final = time.perf_counter()

    deltas = [(t, ev) for t, ev in events
              if ev.get("type", "").endswith("transcription.delta")]
    first_delta_t = deltas[0][0] if deltas else None
    first_text_audio_ms = (round(first_text.get("audio_processed", 0) * 1000, 1)
                           if first_text else None)

    # cumulative stability: deltas are incremental text fragments; retraction
    # = cumulative text that no longer has the previous cumulative as prefix
    cumulative = ""
    retractions = 0
    rewritten_chars = 0
    appended_chars = 0
    for _, ev in deltas:
        prev = cumulative
        cumulative += ev.get("delta", "")
        if prev and not cumulative.startswith(prev):
            retractions += 1
            shared = 0
            for a, b in zip(prev, cumulative):
                if a != b:
                    break
                shared += 1
            rewritten_chars += len(prev) - shared
        else:
            appended_chars += len(cumulative) - len(prev)

    transcript = (completed or {}).get("transcript", "")
    fixture_wer = wer(fixture["transcript"], transcript)
    stability = (appended_chars / (appended_chars + rewritten_chars)
                 if (appended_chars + rewritten_chars) else 1.0)

    return {
        "id": fixture["id"],
        "language": fixture["language"],
        "audioDurationMs": round(audio_dur_s * 1000, 1),
        "transcriptExpected": fixture["transcript"],
        "transcriptFinal": transcript,
        "wer": round(fixture_wer, 4),
        "firstPartialMs": (round((first_delta_t - t_audio_start) * 1000, 1)
                           if first_delta_t else None),
        "firstTextPartialAudioMs": first_text_audio_ms,
        "firstTextPartialWallMs": (round((first_text_t - t_audio_start) * 1000, 1)
                                   if first_text_t else None),
        "partialCount": len(deltas),
        "emptyPartialCount": sum(1 for _, ev in deltas if not ev.get("delta")),
        "retractions": retractions,
        "stabilityRatio": round(stability, 4),
        "finalLatencyMs": round((t_final - t_audio_end) * 1000, 1),
        "error": (completed or {}).get("type") == "error" if completed else True,
    }


def sample_server(pid: int, stop: asyncio.Event):
    import psutil

    proc = psutil.Process(pid)
    samples: list[dict] = []

    async def loop():
        while not stop.is_set():
            try:
                with proc.oneshot():
                    samples.append({
                        "cpuPercent": proc.cpu_percent(interval=None),
                        "rssMb": round(proc.memory_info().rss / (1024 * 1024), 1),
                    })
            except psutil.NoSuchProcess:
                return
            await asyncio.sleep(1.0)

    return loop, samples


def load_validity(path: str) -> dict[str, bool]:
    """Map fixture id -> audio validity flag from audio_validity.py output."""
    data = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    return {r["id"]: r["valid"] for r in data["results"]}


async def main_async(args) -> int:
    import psutil

    corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
    fixtures = {f["id"]: f for f in corpus["fixtures"]}
    validity = load_validity(args.validity) if args.validity else None
    if args.all:
        selected = [fixtures[k] for k in sorted(fixtures)]
    elif args.ids:
        wanted = [s.strip() for s in args.ids.split(",") if s.strip()]
        missing = [w for w in wanted if w not in fixtures]
        if missing:
            print(f"unknown fixture ids: {missing}", file=sys.stderr)
            return 2
        selected = [fixtures[w] for w in wanted]
    else:
        selected = [fixtures[i] for i in SMOKE_IDS if i in fixtures]

    ws_url = f"ws://127.0.0.1:{args.port}{WS_PATH}"
    server_pid = args.server_pid
    if server_pid is None:
        for p in psutil.process_iter(["pid", "name"]):
            if p.info["name"] == "nemo-speech.exe":
                server_pid = p.info["pid"]
                break

    stop = asyncio.Event()
    sampler = None
    samples: list[dict] = []
    if server_pid is not None:
        sampler, samples = sample_server(server_pid, stop)
        sampler_task = asyncio.create_task(sampler())
    else:
        sampler_task = None

    results = []
    t_run0 = time.perf_counter()
    for fx in selected:
        try:
            res = await run_fixture(ws_url, fx, fx["language"])
        except Exception as exc:  # noqa: BLE001 - record and continue
            res = {"id": fx["id"], "language": fx["language"],
                   "error": f"{type(exc).__name__}: {exc}"}
        if validity is not None:
            res["audioValid"] = validity.get(fx["id"])
        results.append(res)
        tag = "ERR" if "error" in res and res.get("error") else "ok "
        print(f"[{tag}] {res['id']:<20} wer={res.get('wer')} "
              f"valid={res.get('audioValid')} "
              f"first={res.get('firstTextPartialWallMs')}ms "
              f"final={res.get('finalLatencyMs')}ms "
              f"retr={res.get('retractions')}", flush=True)

    wall_s = time.perf_counter() - t_run0
    stop.set()
    if sampler_task:
        await sampler_task

    by_lang: dict[str, list[dict]] = {}
    for r in results:
        by_lang.setdefault(r.get("language", "?"), []).append(r)

    def agg(rows: list[dict]) -> dict:
        # WER is only meaningful where the audio carries the reference
        # (audio-validity screen); latency metrics apply to every fixture.
        good = [r for r in rows if isinstance(r.get("wer"), (int, float))
                and r.get("audioValid") is not False]
        lat = [r for r in rows if isinstance(r.get("finalLatencyMs"), (int, float))]
        return {
            "fixtures": len(rows),
            "audioValid": sum(1 for r in rows if r.get("audioValid") is True),
            "audioInvalid": sum(1 for r in rows if r.get("audioValid") is False),
            "errors": sum(1 for r in rows if r.get("error") is True or
                          isinstance(r.get("error"), str)),
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
            "finalLatencyMsP95": round(pct(
                [r["finalLatencyMs"] for r in lat], 95), 1) if lat else None,
            "retractionsTotal": sum(r.get("retractions", 0) for r in rows),
            "stabilityRatioMean": round(mean(
                [r["stabilityRatio"] for r in lat]), 4) if lat else None,
        }

    report = {
        "harness": "g5_streaming_bakeoff",
        "model": "nvidia/nemotron-3.5-asr-streaming-0.6b (q8_0, nemo-speech 0.1.0)",
        "transport": f"websocket {WS_PATH}, paced {CHUNK_MS}ms PCM16 frames",
        "corpus": str(CORPUS.relative_to(ROOT)),
        "audioValidityScreen": args.validity,
        "serverPid": server_pid,
        "wallSeconds": round(wall_s, 1),
        "overall": agg(results),
        "byLanguage": {lang: agg(rows) for lang, rows in sorted(by_lang.items())},
        "serverSamples": {
            "count": len(samples),
            "rssMbMax": max((s["rssMb"] for s in samples), default=None),
            "cpuPercentMax": max((s["cpuPercent"] for s in samples), default=None),
        },
        "fixtures": results,
    }
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("overall", "serverSamples")}, indent=2))
    print(f"wrote {out}")
    return 0 if all(not (isinstance(r.get("error"), str)) for r in results) else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--port", type=int, default=8137)
    ap.add_argument("--out", default=".build-temp/g5-streaming/results/g5.json")
    ap.add_argument("--ids", default=None)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--validity", default=None,
                    help="audio-validity JSON from audio_validity.py; "
                         "WER aggregates then cover audio-valid fixtures only")
    ap.add_argument("--server-pid", type=int, default=None)
    args = ap.parse_args()
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    sys.exit(main())
