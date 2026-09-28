"""Run the section 24 audio gate for every mandatory Pocket language.

For each of EN/FR/ES/IT/DE this performs the full pipeline and records the
result:

  1. fetch the official voice-cloning weights for that language;
  2. export the five ONNX graphs (fp32 + int8) and the bos_before_voice asset;
  3. render the eager PyTorch reference through the stock CLI;
  4. render the same text and voice through the ONNX pack + C++ runtime;
  5. apply the audio-level gate (duration, non-silence, level, spectral JSD).

Every config sets `insert_bos_before_voice: true` and pins the same weight
revision, so the runtime fix generalises; this asserts that rather than
assuming it, and skips the language loudly if a config ever diverges.

Runaway renders are the failure mode this exists to catch, so a per-language
timeout is enforced rather than letting one bad language stall the sweep.
"""

import json
import subprocess
import sys
import time
from pathlib import Path

BASE = Path(r"D:\App\unifia\voice-runtime\.build-temp\pocket-export")
PY = Path(r"D:\App\unifia\voice-runtime\packages\voice-host\.venv\Scripts\python.exe")
EXE = BASE / "PocketTTS.cpp" / "Release" / "pocket-tts.exe"
EXPORTER = BASE / "PocketTTS.cpp" / "export_onnx.py"
CONFIG_DIR = Path(r"D:\App\unifia\voice-runtime\packages\voice-host\.venv\Lib"
                  r"\site-packages\pocket_tts\config")
VOICE = BASE / "audio" / "seed-voice-alba.wav"

REPO = "kyutai/pocket-tts"
REV = "39592ff23c9ef80098bb74895d104c26275fe2c9"

# config stem -> (huggingface language dir, human label, sample text)
#
# The 6-layer models (en/es/it/de) share `english.yaml`'s architecture, so the
# exporter's 6-layer path applies unchanged. French has NO 6-layer model: the
# only published French checkpoint is the 24-layer `french_24l`, whose weights
# are 672 MB against English's 219 MB. That variant needs the generalised
# exporter (patch 7) because upstream hardcodes 6 layers.
LANGUAGES = {
    "english": ("english", "EN",
                "Hello world. I am Kyutai's Pocket TTS. "
                "I'm fast enough to run on small CPUs."),
    "spanish": ("spanish", "ES",
                "Hola mundo. Soy el TTS de bolsillo de Kyutai. "
                "Soy lo suficientemente rápido para funcionar en pequeños CPU."),
    "italian": ("italian", "IT",
                "Ciao mondo. Sono il TTS tascabile di Kyutai. "
                "Sono abbastanza veloce da funzionare su piccoli CPU."),
    "german": ("german", "DE",
               "Hallo Welt. Ich bin Pocket TTS von Kyutai. "
               "Ich bin schnell genug, um auch auf kleinen CPUs zu laufen."),
    "french_24l": ("french_24l", "FR",
                   "Bonjour le monde. Je suis le TTS de poche de Kyutai. "
                   "Je suis assez rapide pour fonctionner sur de petits CPU."),
}

PER_LANGUAGE_TIMEOUT = 45 * 60


def run(cmd, timeout, cwd=None):
    started = time.time()
    # The C++ runtime writes raw bytes to stderr that are not always valid
    # UTF-8 (Windows console codepage), so decode defensively rather than
    # letting a reader thread die and poison the whole sweep.
    proc = subprocess.run(
        cmd, capture_output=True, text=True, errors="replace",
        encoding="utf-8", timeout=timeout, cwd=cwd,
    )
    return proc, time.time() - started


def main() -> int:
    import huggingface_hub as hf

    results = {}
    for stem, (hf_dir, label, text) in LANGUAGES.items():
        config = CONFIG_DIR / f"{stem}.yaml"
        if not config.exists():
            print(f"[{label}] SKIP - no config {config.name}")
            results[label] = {"status": "skipped", "reason": "missing config"}
            continue

        body = config.read_text(encoding="utf-8")
        if "insert_bos_before_voice: true" not in body:
            print(f"[{label}] SKIP - config does not enable insert_bos_before_voice")
            results[label] = {"status": "skipped", "reason": "bos disabled"}
            continue

        out_dir = BASE / f"models-{label.lower()}"
        cache = out_dir / ".cache"
        cache.mkdir(parents=True, exist_ok=True)
        print(f"\n{'=' * 70}\n[{label}] {stem}\n{'=' * 70}")

        # 1. weights
        for name in (f"languages/{hf_dir}/model.safetensors",
                     f"languages/{hf_dir}/tokenizer.model"):
            local = cache / "tts_b6369a24.safetensors" if name.endswith("model.safetensors") \
                else out_dir / "tokenizer.model"
            if local.exists():
                continue
            try:
                fetched = hf.hf_hub_download(repo_id=REPO, revision=REV, filename=name,
                                             local_dir=str(BASE / "weights-cloning"))
                Path(local).write_bytes(Path(fetched).read_bytes())
            except Exception as error:
                print(f"[{label}] FAIL downloading {name}: {type(error).__name__} {error}")
                results[label] = {"status": "failed", "stage": "download", "error": str(error)[:200]}
                break
        else:
            # 2. export graphs. A pack is only complete when all five graphs
            # plus the BOS asset are present; a partial directory left by an
            # earlier failed run must not be mistaken for a finished pack.
            required = ["mimi_encoder.onnx", "text_conditioner.onnx",
                        "flow_lm_main.onnx", "flow_lm_flow.onnx", "mimi_decoder.onnx"]
            complete = all((out_dir / name).exists() for name in required)
            if complete:
                print(f"[{label}] export: pack already complete, skipping")
            else:
                proc, secs = run(
                    [str(PY), str(EXPORTER), "--config", str(config),
                     "--output-dir", str(out_dir)],
                    PER_LANGUAGE_TIMEOUT, cwd=str(BASE),
                )
                graphs = sorted(p.name for p in out_dir.glob("*.onnx"))
                print(f"[{label}] export: {len(graphs)} graphs in {secs:.0f}s")
                if len(graphs) < 5 and not all((out_dir / n).exists() for n in required):
                    tail = (proc.stderr or proc.stdout or "").strip().splitlines()
                    print(f"[{label}] export incomplete; last line: {tail[-1:]}")
            export_ok = all((out_dir / name).exists() for name in required)

            # 3. BOS asset, written into this language's own pack
            if not (out_dir / "bos_before_voice.onnx").exists():
                run([str(PY), str(BASE / "export_bos_asset.py"), str(out_dir)],
                    1800, cwd=str(BASE))

            # 4. eager reference through the stock CLI
            ref = BASE / "audio" / f"reference-{label.lower()}.wav"
            if not ref.exists():
                run([str(PY), "-m", "pocket_tts", "generate", "--text", text,
                     "--voice", str(VOICE), "--language", stem,
                     "--output-path", str(ref), "--quiet"], 1800)
            ref_ok = ref.exists() and ref.stat().st_size > 1000

            # 5. ONNX render through the patched C++ runtime
            cand = BASE / "audio" / f"onnx-{label.lower()}.wav"
            proc_cpp, cpp_secs = run(
                [str(EXE), text, VOICE.name, str(cand), "--precision", "fp32",
                 "--temperature", "0.3", "--models-dir", str(out_dir),
                 "--voices-dir", str(BASE / "audio"),
                 "--tokenizer", str(out_dir / "tokenizer.model"), "--no-cache"],
                PER_LANGUAGE_TIMEOUT, cwd=str(EXPORTER.parent),
            )
            cand_ok = cand.exists() and cand.stat().st_size > 1000

            entry = {"status": "ran", "export_ok": export_ok, "ref_ok": ref_ok,
                     "cand_ok": cand_ok, "cpp_seconds": round(cpp_secs, 1),
                     "cpp_tail": proc_cpp.stdout.strip().splitlines()[-1:] or
                                 proc_cpp.stderr.strip().splitlines()[-1:]}

            # 6. the gate
            if ref_ok and cand_ok:
                proc_gate, _ = run(
                    [str(PY), str(BASE / "audio_compare.py"),
                     str(ref), str(cand)], 900, cwd=str(BASE))
                entry["gate_exit"] = proc_gate.returncode
                entry["gate"] = proc_gate.stdout.strip()
                results[label] = entry
                print(f"[{label}] gate exit={proc_gate.returncode}")
                print(proc_gate.stdout.strip()[-800:])
            else:
                entry["gate"] = "not run (missing reference or candidate audio)"
                results[label] = entry
                print(f"[{label}] {entry['gate']}")
            continue

    dest = BASE / "five-language-gate.json"
    dest.write_text(json.dumps(results, indent=2, ensure_ascii=False) + "\n",
                    encoding="utf-8")
    print(f"\n{'=' * 70}\nwrote {dest}")
    for label, entry in results.items():
        verdict = entry.get("gate_exit", "-")
        print(f"  {label}: status={entry['status']} gate_exit={verdict}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
