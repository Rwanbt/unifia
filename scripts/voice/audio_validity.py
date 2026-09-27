#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""G5 audio validity screen.

Runs whisper-small with the forced fixture language over every corpus fixture
and flags fixtures whose audio does not carry the reference transcript
(degenerated TTS loops etc.). Classification: valid iff WER <= THRESHOLD.

Output: .build-temp/g5-streaming/results/audio-validity.json
"""
import wave, pathlib, json, sys, numpy as np, torch
from transformers import pipeline

THRESHOLD = 0.25
CORPUS = pathlib.Path("packages/contracts/corpus")
OUT = pathlib.Path(".build-temp/g5-streaming/results/audio-validity.json")
WHISPER_LANG = {"en": "english", "fr": "french", "es": "spanish",
                "it": "italian", "de": "german"}

import re, string

def normalize(text):
    text = text.lower()
    text = re.sub(f"[{re.escape(string.punctuation)}]", " ", text)
    return [w for w in text.split() if w]

def wer(ref, hyp):
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

manifest = json.loads((CORPUS / "unifia-eot-bench.json").read_text(encoding="utf-8"))
fixtures = manifest["fixtures"]
pipe = pipeline("automatic-speech-recognition", model="openai/whisper-small",
                device="cpu", dtype=torch.float32, ignore_warning=True)

results = []
for i, fx in enumerate(fixtures, 1):
    p = CORPUS / fx["audio"]["path"]
    with wave.open(str(p), "rb") as w:
        audio = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768.0
    out = pipe(audio, generate_kwargs={"task": "transcribe",
                                       "language": WHISPER_LANG[fx["language"]]})
    hyp = out["text"].strip()
    w = wer(fx["transcript"], hyp)
    valid = w <= THRESHOLD
    results.append({"id": fx["id"], "language": fx["language"],
                    "expected": fx["transcript"], "whisper": hyp,
                    "wer": round(w, 4), "valid": valid})
    print(f"[{i:2}/{len(fixtures)}] {fx['id']:<20} wer={w:.3f} "
          f"{'VALID' if valid else 'INVALID'}", flush=True)

invalid = [r for r in results if not r["valid"]]
report = {
    "screen": "whisper-small forced-language WER vs corpus transcript",
    "threshold": THRESHOLD,
    "total": len(results),
    "valid": len(results) - len(invalid),
    "invalid": len(invalid),
    "invalidByLang": {},
    "results": results,
}
for r in invalid:
    report["invalidByLang"][r["language"]] = report["invalidByLang"].get(r["language"], 0) + 1
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"\nvalid={report['valid']} invalid={report['invalid']} byLang={report['invalidByLang']}")
print("invalid ids:", [r["id"] for r in invalid])
print(f"wrote {OUT}")
