"""Resolve and stage the exact Pocket weights pinned by the product config.

The exporter forces `config.weights_path` to a single staged file, so the file
must match the revision the chosen config YAML declares. Cached snapshots on
this machine do not correspond to that revision, so resolve it from the
ungated no-voice-cloning repository (CC-BY-4.0, no auth required).
"""

import os
import shutil
import sys

import huggingface_hub as hf

REPO = "kyutai/pocket-tts-without-voice-cloning"
OUT = r"D:\App\unifia\voice-runtime\.build-temp\pocket-export\models-en2"
CACHE = os.path.join(OUT, ".cache")

# Pinned by packages/voice-host's pocket-tts 3.1.0 `config/english.yaml`
# (weights_path_without_voice_cloning).
REV = "d29db7978e464fb90cb3359ee0c69a273b9142cc"

WANT = [
    "languages/english/model.safetensors",
    "languages/english/tokenizer.model",
]


def main() -> int:
    os.makedirs(CACHE, exist_ok=True)
    info = hf.model_info(REPO, revision=REV, files_metadata=True)
    print(f"repo   = {REPO}")
    print(f"rev    = {REV}")
    print(f"gated  = {info.gated}")
    if info.gated:
        print("REFUSING: repository is gated; this build must not need HF auth")
        return 1

    by_name = {s.rfilename: s for s in info.siblings}
    for name in WANT:
        sibling = by_name.get(name)
        if sibling is None:
            print(f"MISSING in repo: {name}")
            return 1
        print(f"  {name}  size={sibling.size}")

    for name in WANT:
        dest = os.path.join(CACHE, os.path.basename(name))
        if os.path.exists(dest) and os.path.getsize(dest) == by_name[name].size:
            print(f"  already staged: {dest}")
            continue
        path = hf.hf_hub_download(
            repo_id=REPO,
            revision=REV,
            filename=name,
            local_dir=os.path.join(CACHE, "_hf"),
        )
        real = os.path.realpath(path)
        shutil.copyfile(real, dest)
        print(f"  staged {dest} ({os.path.getsize(dest):,} bytes)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
