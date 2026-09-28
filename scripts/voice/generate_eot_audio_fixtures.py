#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Generate the authorized, reproducible speech fixtures for UNIFIA-EOT-BENCH."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import io
import json
import platform
import re
import sys
import wave
from pathlib import Path
from typing import Any

import numpy as np
from piper import PiperVoice, SynthesisConfig

RATE = 16_000
TAIL_MS = 1_000
EOT_SILENCE_MS = 650
GENERATOR = "piper-tts@1.8.0"
RUNTIME_VERSIONS = {"python": "3.12.13", "onnxruntime": "1.30.0", "numpy": "2.5.3", "piper-tts": "1.8.0"}
MODEL_INFO = {
    "en": ("en_US-ljspeech-medium", "en_US-ljspeech-medium.onnx", "bae641d", "6f52a751e2349abe7a76735eb09dc1875298c77ea2342ffd2fef79ff81b87f22", "141d612cc0a95ed7efc1ca936b845c2364967f2e9217c5dbfcf69fc4d6c65860"),
    "fr": ("fr_FR-mls-medium", "fr_FR-mls-medium.onnx", "7e8200c", "0ed223f78466917f2bae05ee90096ce69ab1fdeb251f55590d0e7422d234e162", "252b0b0a6e4cc4949e23eccb956f9c779986c32f934f2f7e2191e5fdc2edca61"),
    "es": ("es_ES-carlfm-x_low", "es_ES-carlfm-x_low.onnx", "2f8dbe0", "d69677323a907cd4963f42b29c20a98b5d6bfa7f3e64df339915e4650c00d125", "d9bdfa9ff01eb2bc9e62e7d2593939d1e4c4d8eb7cf75f972731539d12399966"),
    "it": ("it_IT-riccardo-x_low", "it_IT-riccardo-x_low.onnx", "2f8dbe0", "1368de15f123275a7ef951c9e5e30be0f58a032daa14a0da44037443c1d1d21b", "146ab9c634afe524e9fb7530f2510df7a42fb1db56b52658ca1fb3d98001a62a"),
    "de": ("de_DE-mls-medium", "de_DE-mls-medium.onnx", "7e8200c", "69cd1d2aa5a35839a518966fcc4924b5f93e5f8c948ed0752b1a616ad53f65bf", "b0af1c89ddfdc72d32e015729b0e89b99eec13c2c8caa1db7488d98e9e570b40"),
}
SWITCH_PHRASES = {
    "en": ("por favor", "es"),
    "fr": ("please", "en"),
    "es": ("merci", "fr"),
    "it": ("gracias", "es"),
    "de": ("gracias", "es"),
}
ASSISTANT_TEXT = {
    "en": "I am still speaking.",
    "fr": "Je parle encore.",
    "es": "Sigo hablando.",
    "it": "Sto ancora parlando.",
    "de": "Ich spreche noch.",
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def resample(pcm: np.ndarray, source_rate: int) -> np.ndarray:
    if source_rate == RATE:
        return pcm.astype(np.int16, copy=False)
    output_size = round(len(pcm) * RATE / source_rate)
    positions = np.arange(output_size, dtype=np.float64) * source_rate / RATE
    converted = np.interp(positions, np.arange(len(pcm)), pcm.astype(np.float64))
    return np.clip(np.rint(converted), -32768, 32767).astype(np.int16)


def activity_intervals(pcm: np.ndarray, offset: int = 0) -> list[tuple[int, int]]:
    frame_size = RATE // 100
    frames = [pcm[start : start + frame_size].astype(np.float64) for start in range(0, len(pcm), frame_size)]
    levels = [float(np.sqrt(np.mean(frame * frame))) for frame in frames if len(frame)]
    if not levels:
        return []
    threshold = max(250.0, max(levels) * 0.02)
    active = [index for index, level in enumerate(levels) if level >= threshold]
    if not active:
        return []
    groups: list[tuple[int, int]] = []
    first = previous = active[0]
    for index in active[1:]:
        if index - previous > 12:
            groups.append((first * frame_size + offset, min((previous + 1) * frame_size + offset, len(pcm) + offset)))
            first = index
        previous = index
    groups.append((first * frame_size + offset, min((previous + 1) * frame_size + offset, len(pcm) + offset)))
    return groups


def complement_intervals(speech: list[dict[str, int]], duration_ms: int) -> list[dict[str, int]]:
    silences: list[dict[str, int]] = []
    cursor = 0
    for interval in speech:
        if interval["startMs"] > cursor:
            silences.append({"startMs": cursor, "endMs": interval["startMs"]})
        cursor = max(cursor, interval["endMs"])
    if cursor < duration_ms:
        silences.append({"startMs": cursor, "endMs": duration_ms})
    return silences


def split_jobs(fixture: dict[str, Any]) -> tuple[list[tuple[str, str]], int]:
    language = fixture["language"]
    scenario = fixture["scenario"]
    transcript = fixture["transcript"].strip()
    if scenario == "pause":
        return [(part.strip(), language) for part in re.split(r"\s{2,}", transcript) if part.strip()], 600
    if scenario == "enumeration":
        parts = re.split(r"(?<=,)\s*", transcript)
        return [(part.strip(), language) for part in parts if part.strip()], 250
    if scenario == "false-ending":
        words = {"en": "but", "fr": "mais", "es": "pero", "it": "ma", "de": "aber"}
        parts = re.split(rf"\s+(?={words[language]}\b)", transcript, maxsplit=1, flags=re.IGNORECASE)
        return [(part.strip(), language) for part in parts if part.strip()], 400
    if scenario == "conjunction-continuation":
        words = {"en": "and", "fr": "et", "es": "y", "it": "e", "de": "und"}
        parts = re.split(rf"\s+(?={words[language]}\b)", transcript, maxsplit=1, flags=re.IGNORECASE)
        return [(part.strip(), language) for part in parts if part.strip()], 300
    if scenario == "correction":
        corrections = {"en": "sorry|actually", "fr": "pardon", "es": "perdón", "it": "scusa", "de": "sorry"}
        parts = re.split(rf"\s+(?=(?:{corrections[language]})\b)", transcript, maxsplit=1, flags=re.IGNORECASE)
        return [(part.strip(), language) for part in parts if part.strip()], 350
    if scenario == "multilingual-switch":
        phrase, switch_language = SWITCH_PHRASES[language]
        match = re.search(re.escape(phrase), transcript, re.IGNORECASE)
        if match:
            return [(transcript[: match.start()].rstrip(" ,"), language), (transcript[match.start() :], switch_language)], 120
    if scenario == "rapid-interruption":
        return [(transcript, language)] * 3, 250
    return [(transcript, language)], 0


def check_runtime() -> None:
    actual_versions = {
        "python": platform.python_version(),
        "onnxruntime": importlib.metadata.version("onnxruntime"),
        "numpy": np.__version__,
        "piper-tts": importlib.metadata.version("piper-tts"),
    }
    if actual_versions != RUNTIME_VERSIONS or sys.version_info[:3] != (3, 12, 13):
        raise SystemExit(f"Pinned generation runtime mismatch: expected {RUNTIME_VERSIONS}, got {actual_versions}")


def load_voices(models_dir: Path) -> tuple[dict[str, PiperVoice], dict[str, dict[str, str]]]:
    voices: dict[str, PiperVoice] = {}
    model_refs: dict[str, dict[str, str]] = {}
    for language, (model_id, filename, revision, model_hash, config_hash) in MODEL_INFO.items():
        model_path = models_dir / filename
        config_path = Path(f"{model_path}.json")
        if not model_path.is_file() or not config_path.is_file():
            raise SystemExit(f"Missing pinned model/config for {model_id}; expected {model_path} and {config_path}")
        if digest(model_path) != model_hash or digest(config_path) != config_hash:
            raise SystemExit(f"Pinned model/config SHA-256 mismatch for {model_id}: {model_path}")
        voice = PiperVoice.load(model_path, config_path=config_path)
        if voice.session.get_providers() != ["CPUExecutionProvider"]:
            raise SystemExit(f"{model_id} must run on CPU, got {voice.session.get_providers()}")
        voices[language] = voice
        model_refs[language] = {
            "id": model_id,
            "revision": revision,
            "modelSha256": model_hash,
            "configSha256": config_hash,
        }
    return voices, model_refs


def synthesize(voices: dict[str, PiperVoice], text: str, language: str) -> np.ndarray:
    voice = voices[language]
    config = SynthesisConfig(noise_scale=0.0, noise_w_scale=0.0)
    chunks = list(voice.synthesize(text, syn_config=config))
    pcm = np.frombuffer(b"".join(chunk.audio_int16_bytes for chunk in chunks), dtype="<i2")
    return resample(pcm, voice.config.sample_rate)


def render_user(fixture: dict[str, Any], voices: dict[str, PiperVoice]) -> tuple[np.ndarray, list[dict[str, int]], set[str]]:
    jobs, pause_ms = split_jobs(fixture)
    if not jobs or any(not text for text, _ in jobs):
        raise SystemExit(f"Could not create non-empty speech jobs for {fixture['id']}")
    parts: list[np.ndarray] = []
    intervals: list[dict[str, int]] = []
    languages = {language for _, language in jobs}
    cursor = 0
    for index, (text, language) in enumerate(jobs):
        speech = synthesize(voices, text, language)
        intervals.extend(
            {"startMs": round(start * 1000 / RATE), "endMs": round(end * 1000 / RATE)}
            for start, end in activity_intervals(speech, cursor)
        )
        parts.append(speech)
        cursor += len(speech)
        if index + 1 < len(jobs):
            gap_size = round(pause_ms * RATE / 1000)
            parts.append(np.zeros(gap_size, dtype=np.int16))
            cursor += gap_size
    if not intervals:
        raise SystemExit(f"No speech activity detected for {fixture['id']}")
    parts.append(np.zeros(round(TAIL_MS * RATE / 1000), dtype=np.int16))
    return np.concatenate(parts), intervals, languages


def apply_conditions(
    fixture: dict[str, Any], audio: np.ndarray, speech: list[dict[str, int]], languages: set[str],
    voices: dict[str, PiperVoice], seed: int,
) -> tuple[np.ndarray, list[dict[str, int]], list[dict[str, int]], set[str], str]:
    assistant_intervals: list[dict[str, int]] = []
    noise_condition = "clean"
    scenario = fixture["scenario"]
    if scenario == "speech-over-assistant":
        assistant = synthesize(voices, ASSISTANT_TEXT[fixture["language"]], fixture["language"])
        offset = round(300 * RATE / 1000)
        end = min(len(audio), offset + len(assistant))
        audio[offset:end] = np.clip(audio[offset:end].astype(np.int32) + assistant[: end - offset].astype(np.int32) // 2, -32768, 32767).astype(np.int16)
        assistant_intervals = [
            {"startMs": round(start * 1000 / RATE), "endMs": round(last * 1000 / RATE)}
            for start, last in activity_intervals(assistant[: end - offset], offset)
        ]
        languages.add(fixture["language"])
    elif scenario == "whisper":
        audio = np.rint(audio.astype(np.float64) * 0.08).astype(np.int16)
        noise_condition = "whisper"
    elif scenario == "clipping":
        clipped_end = max(1, speech[-1]["endMs"] * RATE // 1000 - round(40 * RATE / 1000))
        audio = np.clip(audio[:clipped_end].astype(np.int32), -12_000, 12_000).astype(np.int16)
        speech = [
            {"startMs": round(start * 1000 / RATE), "endMs": round(end * 1000 / RATE)}
            for start, end in activity_intervals(audio)
        ]
        noise_condition = "clipped"
    elif scenario == "background-noise":
        rng = np.random.default_rng(seed)
        active_pcm = np.concatenate([audio[item["startMs"] * RATE // 1000 : item["endMs"] * RATE // 1000] for item in speech])
        speech_rms = float(np.sqrt(np.mean(active_pcm.astype(np.float64) ** 2)))
        noise = rng.normal(0.0, max(1.0, speech_rms / 10 ** (15 / 20)), size=len(audio))
        audio = np.clip(audio.astype(np.float64) + noise, -32768, 32767).astype(np.int16)
        noise_condition = "background-noise"
    return audio, speech, assistant_intervals, languages, noise_condition



def encode_wav(audio: np.ndarray) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(RATE)
        target.writeframes(audio.astype("<i2", copy=False).tobytes())
    return buffer.getvalue()


def make_annotation(
    fixture: dict[str, Any], wav_bytes: bytes, audio: np.ndarray, audio_path: Path, speech: list[dict[str, int]],
    assistant: list[dict[str, int]], languages: set[str], model_refs: dict[str, dict[str, str]], noise_condition: str,
) -> dict[str, Any]:
    if not speech:
        raise SystemExit(f"No speech activity remains after applying conditions to {fixture['id']}")
    duration_ms = round(len(audio) * 1000 / RATE)
    expected_eot = speech[-1]["endMs"] + EOT_SILENCE_MS if fixture["expectedTurnComplete"] else None
    forbidden = [{"startMs": 0, "endMs": expected_eot}] if expected_eot else [{"startMs": 0, "endMs": duration_ms}]
    spoken = " ".join([fixture["transcript"].strip()] * 3) if fixture["scenario"] == "rapid-interruption" else fixture["transcript"]
    return {
        "path": f"audio/{audio_path.name}",
        "spokenTranscript": spoken,
        "assistantTranscript": ASSISTANT_TEXT[fixture["language"]] if assistant else None,
        "sampleRateHz": RATE,
        "durationMs": duration_ms,
        "sha256": hashlib.sha256(wav_bytes).hexdigest(),
        "speechIntervalsMs": speech,
        "silenceIntervalsMs": complement_intervals(speech, duration_ms),
        "forbiddenEotIntervalsMs": forbidden,
        "expectedEotMs": expected_eot,
        "noiseCondition": noise_condition,
        "overlapCondition": "assistant-speech" if assistant else "none",
        "assistantSpeechIntervalsMs": assistant,
        "models": sorted((model_refs[language] for language in languages), key=lambda item: item["id"]),
        "pythonVersion": RUNTIME_VERSIONS["python"],
        "generator": GENERATOR,
        "onnxRuntimeVersion": RUNTIME_VERSIONS["onnxruntime"],
        "numpyVersion": RUNTIME_VERSIONS["numpy"],
        "seed": int(hashlib.sha256(fixture["id"].encode()).hexdigest()[:8], 16),
    }


def write_manifest(path: Path, corpus: dict[str, Any]) -> None:
    lines = [
        "{",
        f'  "version": {json.dumps(corpus["version"])},',
        f'  "description": {json.dumps(corpus["description"], ensure_ascii=False)},',
        f'  "languages": {json.dumps(corpus["languages"])},',
        f'  "scenarios": {json.dumps(corpus["scenarios"])},',
        '  "fixtures": [',
    ]
    lines.extend("    " + json.dumps(fixture, ensure_ascii=False, separators=(", ", ": ")) + ("," if index + 1 < len(corpus["fixtures"]) else "") for index, fixture in enumerate(corpus["fixtures"]))
    lines.extend(["  ]", "}", ""])
    path.write_text("\n".join(lines), encoding="utf-8")


def generate_fixture(fixture: dict[str, Any], voices: dict[str, PiperVoice], model_refs: dict[str, dict[str, str]]) -> tuple[Path, bytes, dict[str, Any]]:
    seed = int(hashlib.sha256(fixture["id"].encode()).hexdigest()[:8], 16)
    audio, speech, languages = render_user(fixture, voices)
    audio, speech, assistant, languages, noise = apply_conditions(fixture, audio, speech, languages, voices, seed)
    audio_path = Path(f"{fixture['id']}.wav")
    wav_bytes = encode_wav(audio)
    return audio_path, wav_bytes, make_annotation(fixture, wav_bytes, audio, audio_path, speech, assistant, languages, model_refs, noise)


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models-dir", type=Path, default=root / ".build-temp")
    parser.add_argument("--check", action="store_true", help="Regenerate in memory and verify every committed WAV and annotation")
    args = parser.parse_args()
    check_runtime()
    corpus_path = root / "packages/contracts/corpus/unifia-eot-bench.json"
    audio_dir = corpus_path.parent / "audio"
    corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
    voices, model_refs = load_voices(args.models_dir)
    generated = []
    for fixture in corpus["fixtures"]:
        filename, wav_bytes, annotation = generate_fixture(fixture, voices, model_refs)
        generated.append((fixture, audio_dir / filename.name, wav_bytes, annotation))
    if args.check:
        for fixture, path, wav_bytes, annotation in generated:
            if not path.exists() or path.read_bytes() != wav_bytes or fixture.get("audio") != annotation:
                raise SystemExit(f"Generated PCM or annotations differ for {fixture['id']}: {path}")
    else:
        audio_dir.mkdir(parents=True, exist_ok=True)
        for fixture, path, wav_bytes, annotation in generated:
            path.write_bytes(wav_bytes)
            fixture["audio"] = annotation
    if not args.check:
        write_manifest(corpus_path, corpus)
    print(f"Verified {len(corpus['fixtures'])} deterministic {RATE} Hz fixtures ({'check only' if args.check else 'generated'}).")


if __name__ == "__main__":
    main()
