"""Stage the OFFICIAL voice-cloning Pocket weights for the ONNX exporter.

The no-cloning derivative has a degenerate EOS head: the eager reference
itself never terminates with those weights, so the runaway measured on
2026-09-27 came from the weights and not from the export or the C++ port.

The exporter forces `config.weights_path` to a single staged file, so the
variant under test must be placed there explicitly. This stages the official
`kyutai/pocket-tts` weights at the revision `english.yaml` pins.

Licence: CC-BY-4.0 weights behind a Hugging Face gate whose model card carries
a Prohibited Use clause on voice cloning. Accepted as a project decision on
2026-09-27. The shipped capability surface must not expose voice cloning
(campaign section 40) regardless of the licence permitting the weights.
"""

import hashlib
import shutil
import sys
from pathlib import Path

import huggingface_hub as hf

REPO = "kyutai/pocket-tts"
# Pinned by pocket-tts 3.1.0 `config/english.yaml` (`weights_path`).
REV = "39592ff23c9ef80098bb74895d104c26275fe2c9"

SRC = Path(r"D:\App\unifia\voice-runtime\.build-temp\pocket-export\weights-cloning")
OUT = Path(r"D:\App\unifia\voice-runtime\.build-temp\pocket-export\models-cloning")
# The exporter reads a fixed cache filename for the weights it loads.
EXPECTED_WEIGHTS = "tts_b6369a24.safetensors"

FILES = ["languages/english/model.safetensors", "languages/english/tokenizer.model"]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    (OUT / ".cache").mkdir(parents=True, exist_ok=True)
    print(f"repo   = {REPO}")
    print(f"rev    = {REV}")
    info = hf.model_info(REPO, revision=REV)
    print(f"gated  = {info.gated}")
    print()

    for name in FILES:
        real = Path(str(SRC / name))
        if not real.exists():
            print(f"missing: {real}")
            return 1
        dest_name = EXPECTED_WEIGHTS if name.endswith("model.safetensors") else "tokenizer.model"
        dest = (OUT / ".cache" / dest_name) if dest_name == EXPECTED_WEIGHTS else (OUT / dest_name)
        shutil.copyfile(real, dest)
        print(f"staged {dest.name:28s} {dest.stat().st_size:>12,} bytes  sha256={sha256(dest)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
