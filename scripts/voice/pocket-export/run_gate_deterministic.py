"""Re-run the section 24 gate with BOTH sides deterministic.

The previous sweep compared an ONNX render against a temperature-0.3 eager
reference, so the reference moved between runs and the duration criterion was
unreliable. Here both sides are greedy:

  * reference: eager pocket-tts at temp 0 (make_greedy_reference.py)
  * candidate: PocketTTS.cpp at --temperature 0, which skips noise sampling
    entirely and is therefore reproducible

Only languages with a complete pack and a greedy reference are run; anything
missing is reported rather than silently skipped.
"""

import subprocess
import sys
from pathlib import Path

BASE = Path(r"D:\App\unifia\voice-runtime\.build-temp\pocket-export")
EXE = BASE / "PocketTTS.cpp" / "Release" / "pocket-tts.exe"
PY = Path(r"D:\App\unifia\voice-runtime\packages\voice-host\.venv\Scripts\python.exe")
VOICE = BASE / "audio" / "seed-voice-alba.wav"

REQUIRED = ["mimi_encoder.onnx", "text_conditioner.onnx", "flow_lm_main.onnx",
            "flow_lm_flow.onnx", "mimi_decoder.onnx", "bos_before_voice.onnx"]

JOBS = [
    ("ES", "models-es",
     "Hola mundo. Soy el TTS de bolsillo de Kyutai. "
     "Soy lo suficientemente rápido para funcionar en pequeños CPU."),
    ("IT", "models-it",
     "Ciao mondo. Sono il TTS tascabile di Kyutai. "
     "Sono abbastanza veloce da funzionare su piccoli CPU."),
    ("DE", "models-de",
     "Hallo Welt. Ich bin Pocket TTS von Kyutai. "
     "Ich bin schnell genug, um auch auf kleinen CPUs zu laufen."),
    ("EN", "models-cloning",
     "Hello world. I am Kyutai's Pocket TTS. "
     "I'm fast enough to run on small CPUs."),
]


def main() -> int:
    failures = 0
    for label, pack, text in JOBS:
        out_dir = BASE / pack
        missing = [name for name in REQUIRED if not (out_dir / name).exists()]
        if missing:
            print(f"[{label}] SKIP - incomplete pack, missing {missing}")
            continue

        ref = BASE / "audio" / f"ref-{label.lower()}-greedy.wav"
        if not ref.exists():
            print(f"[{label}] SKIP - no greedy reference at {ref.name}")
            continue

        cand = BASE / "audio" / f"onnx-{label.lower()}-greedy.wav"
        if cand.exists():
            cand.unlink()

        proc = subprocess.run(
            [str(EXE), text, VOICE.name, str(cand), "--precision", "fp32",
             "--temperature", "0", "--models-dir", str(out_dir),
             "--voices-dir", str(BASE / "audio"),
             "--tokenizer", str(out_dir / "tokenizer.model"), "--no-cache"],
            capture_output=True, text=True, errors="replace",
            encoding="utf-8", timeout=3600, cwd=str(EXE.parent.parent),
        )
        tail = (proc.stdout or "").strip().splitlines()
        warn = [line for line in (proc.stderr or "").splitlines()
                if "WARNING" in line or "bos_before_voice" in line]
        print(f"\n[{label}] {tail[-1:] if tail else ''}")
        if warn:
            print(f"[{label}] warnings: {warn}")
        if not cand.exists():
            print(f"[{label}] FAILED - no candidate audio")
            failures += 1
            continue

        gate = subprocess.run(
            [str(PY), str(BASE / "audio_compare.py"), str(ref), str(cand)],
            capture_output=True, text=True, errors="replace", encoding="utf-8",
            timeout=1800, cwd=str(BASE),
        )
        print(gate.stdout.strip())
        if gate.returncode != 0:
            failures += 1

    print(f"\n{'=' * 60}\nlanguages failing the deterministic gate: {failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
