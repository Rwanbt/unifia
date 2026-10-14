"""Render a Pocket pack repeatedly and score what a listener would hear.

The section 24 gate compares one ONNX render against one eager render. Both
sides sample, so a single comparison says little, and its metrics (duration,
voiced ratio) cannot tell a cut-off last word from a long pause. This sweep
answers the question that matters on the phone: is every render intelligible
and complete?

For each sentence it renders `--repeats` samples through either the C++
runtime (`--engine cpp`, the code path the Android app ships) or the stock
pocket-tts CLI (`--engine eager`, the reference), transcribes each with
Whisper, and records word error rate, duration and leading/trailing silence.

On Windows the C++ CLI must be built with a UTF-8 active code page manifest
(`<activeCodePage>UTF-8</activeCodePage>`). Without it argv arrives in the
ANSI code page, accented text reaches sentencepiece as invalid UTF-8, and the
sweep reports garbled "é"/"ç" words that the phone, fed UTF-8 over FFI, never
produces.

Usage (paths are arguments; nothing here assumes a checkout layout):

    python asr_sweep.py --engine cpp --exe .../pocket-tts.exe \
        --models-dir .../models-fr --voices-dir .../audio --voice fr-f-2154.wav \
        --language fr --precision int8 --temperature 0.5 --eos-extra 8 \
        --repeats 6 --work-dir .../sweep --out results.json

    python asr_sweep.py --engine eager --eager-python .../venv/python.exe \
        --eager-language french_24l --voices-dir .../audio --voice fr-f-2154.wav \
        --language fr --temperature 0.5 --repeats 6 --work-dir ... --out ...
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile
from scipy.signal import resample_poly

SENTENCES = {
    "fr": [
        "Bonjour le monde. Je suis le TTS de poche de Kyutai. "
        "Je suis assez rapide pour fonctionner sur de petits CPU.",
        "D'accord, je regarde ça tout de suite.",
        "La réunion de demain est déplacée en fin d'après-midi, "
        "dans la grande salle au dernier étage.",
    ],
    "en": [
        "Hello world. I am Kyutai's Pocket TTS. "
        "I'm fast enough to run on small CPUs.",
        "Sure, I'll look at it right away.",
        "Tomorrow's meeting has moved to late afternoon, "
        "in the large room on the top floor.",
    ],
}

WHISPER_RATE_HZ = 16_000
SILENCE_DBFS = -45.0
FRAME_SECONDS = 0.02
# A render whose transcript misses or invents more than this share of the
# words is one a listener would notice; it is reported, never hidden.
UNINTELLIGIBLE_WER = 0.2


def normalize_words(text: str) -> list[str]:
    return re.sub(r"[^\w]+", " ", text.lower().replace("’", "'")).split()


def word_error_rate(reference: str, hypothesis: str) -> float:
    ref, hyp = normalize_words(reference), normalize_words(hypothesis)
    previous = list(range(len(hyp) + 1))
    for i, ref_word in enumerate(ref, 1):
        current = [i] + [0] * len(hyp)
        for j, hyp_word in enumerate(hyp, 1):
            current[j] = min(previous[j] + 1, current[j - 1] + 1,
                             previous[j - 1] + (ref_word != hyp_word))
        previous = current
    return previous[-1] / max(len(ref), 1)


def silence_profile(samples: np.ndarray, rate: int) -> tuple[float, float, float]:
    """Returns (lead_s, tail_s, peak_dbfs) using 20 ms RMS frames."""
    frame = max(int(rate * FRAME_SECONDS), 1)
    count = len(samples) // frame
    if count == 0:
        return 0.0, 0.0, -120.0
    rms = np.sqrt(np.mean(samples[: count * frame].reshape(count, frame) ** 2, axis=1))
    loud = np.flatnonzero(20 * np.log10(np.maximum(rms, 1e-9)) > SILENCE_DBFS)
    # Plain floats: numpy scalars leak into comparisons and break json.dumps.
    peak = float(20 * np.log10(max(float(np.max(np.abs(samples))), 1e-9)))
    if loud.size == 0:
        return count * FRAME_SECONDS, 0.0, peak
    return float(loud[0]) * FRAME_SECONDS, float(count - 1 - loud[-1]) * FRAME_SECONDS, peak


def render(args, text: str, out: Path) -> subprocess.CompletedProcess:
    if args.engine == "cpp":
        command = [args.exe, text, args.voice, str(out),
                   "--precision", args.precision,
                   "--temperature", str(args.temperature),
                   "--eos-extra", str(args.eos_extra),
                   "--models-dir", args.models_dir, "--voices-dir", args.voices_dir,
                   "--tokenizer", str(Path(args.models_dir) / "tokenizer.model"),
                   "--no-cache", *args.cpp_arg]
    else:
        command = [args.eager_python, "-m", "pocket_tts", "generate", "--text", text,
                   "--voice", str(Path(args.voices_dir) / args.voice),
                   "--language", args.eager_language,
                   "--temperature", str(args.temperature),
                   "--output-path", str(out), "--quiet"]
    return subprocess.run(command, capture_output=True, text=True, errors="replace",
                          timeout=600)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--engine", choices=["cpp", "eager"], required=True)
    parser.add_argument("--exe")
    parser.add_argument("--eager-python")
    parser.add_argument("--eager-language")
    parser.add_argument("--models-dir")
    parser.add_argument("--voices-dir", required=True)
    parser.add_argument("--voice", required=True)
    parser.add_argument("--language", choices=sorted(SENTENCES), required=True)
    parser.add_argument("--precision", default="int8")
    parser.add_argument("--temperature", type=float, default=0.5)
    parser.add_argument("--eos-extra", type=int, default=-1)
    parser.add_argument("--cpp-arg", action="append", default=[],
                        help="extra runtime flag, e.g. --cpp-arg=--no-pad-short")
    parser.add_argument("--repeats", type=int, default=6)
    parser.add_argument("--whisper-model", default="small")
    parser.add_argument("--work-dir", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    import whisper  # imported late: loading it is slow and needs the GPU

    model = whisper.load_model(args.whisper_model, device="cuda")
    work = Path(args.work_dir)
    work.mkdir(parents=True, exist_ok=True)
    renders = []
    for sentence_index, text in enumerate(SENTENCES[args.language]):
        for repeat in range(args.repeats):
            out = work / f"s{sentence_index}-r{repeat}.wav"
            proc = render(args, text, out)
            if proc.returncode != 0 or not out.exists():
                renders.append({"sentence": sentence_index, "repeat": repeat,
                                "error": (proc.stderr or proc.stdout)[-300:]})
                continue
            samples, rate = soundfile.read(out, dtype="float32", always_2d=False)
            lead, tail, peak = silence_profile(samples, rate)
            audio = resample_poly(samples, WHISPER_RATE_HZ, rate).astype(np.float32)
            heard = model.transcribe(audio, language=args.language, temperature=0.0,
                                     condition_on_previous_text=False)["text"].strip()
            renders.append({
                "sentence": sentence_index, "repeat": repeat,
                "duration_s": round(len(samples) / rate, 3),
                "lead_s": round(lead, 2), "tail_s": round(tail, 2),
                "peak_dbfs": round(peak, 2),
                "wer": round(word_error_rate(text, heard), 3), "heard": heard,
            })
            print(json.dumps(renders[-1], ensure_ascii=False), flush=True)

    scored = [r for r in renders if "wer" in r]
    summary = {
        "engine": args.engine, "precision": args.precision,
        "temperature": args.temperature, "eos_extra": args.eos_extra,
        "cpp_args": args.cpp_arg,
        "voice": args.voice, "renders": len(renders), "failed": len(renders) - len(scored),
        "mean_wer": round(float(np.mean([r["wer"] for r in scored])), 3) if scored else None,
        "unintelligible": sum(r["wer"] > UNINTELLIGIBLE_WER for r in scored),
        "clipped": sum(r["peak_dbfs"] > -0.1 for r in scored),
    }
    Path(args.out).write_text(json.dumps({"summary": summary, "renders": renders},
                                         indent=2, ensure_ascii=False) + "\n",
                              encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
