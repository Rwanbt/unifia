"""Produce the PyTorch-eager reference audio for the §24 audio-level gate.

Both the eager reference and the ONNX/C++ path must be conditioned on the SAME
seed voice, otherwise any duration or spectral difference is confounded by a
different speaker embedding. This downloads one seed voice and synthesises the
reference WAVs with eager pocket-tts 3.1.0.

Licence note: the seed voice is fetched from `kyutai/tts-voices`, a separate
repository from the model weights. It is used here ONLY as local conditioning
input for a pipeline comparison. It is not redistributed, is not registered as
a Unifia asset, and must not be treated as a cleared shipping voice - campaign
§26 requires a per-voice licence check before any real voice is qualified.
"""

import sys
from pathlib import Path

import huggingface_hub as hf

VOICE_REPO = "kyutai/tts-voices"
VOICE_FILE = "alba-mackenna/casual.wav"
OUT = Path(r"D:\App\unifia\voice-runtime\.build-temp\pocket-export\audio")
TEXTS = {
    "en": "Hello world. I am Kyutai's Pocket TTS. I'm fast enough to run on small CPUs.",
}


def fetch_seed_voice() -> Path:
    OUT.mkdir(parents=True, exist_ok=True)
    dest = OUT / "seed-voice-alba.wav"
    if not dest.exists():
        path = hf.hf_hub_download(
            repo_id=VOICE_REPO, filename=VOICE_FILE, repo_type="model",
        )
        dest.write_bytes(Path(path).read_bytes())
    print(f"seed voice: {dest} ({dest.stat().st_size:,} bytes)")
    return dest


def main() -> int:
    seed = fetch_seed_voice()
    import subprocess
    config = (r"D:\App\unifia\voice-runtime\packages\voice-host\.venv\Lib"
              r"\site-packages\pocket_tts\config\english.yaml")
    for lang, text in TEXTS.items():
        out = OUT / f"reference-{lang}.wav"
        if out.exists():
            print(f"exists: {out}")
            continue
        cmd = [
            sys.executable, "-m", "pocket_tts", "generate",
            "--text", text,
            "--voice", str(seed),
            "--config", config,
            "--output-path", str(out),
            "--quiet",
        ]
        print(f"\n$ {' '.join(cmd[2:6])} ...")
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print("FAILED:", result.returncode)
            print(result.stdout[-3000:])
            print(result.stderr[-3000:])
            return 1
        print(f"  wrote {out} ({out.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
