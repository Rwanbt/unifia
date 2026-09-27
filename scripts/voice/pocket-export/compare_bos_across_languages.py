"""Is `flow_lm.bos_before_voice` language-specific, or shared across models?

A 2026-09-27 sweep rendered ES, IT and DE all at exactly 0.860s (~10 frames)
with EOS firing early, even though the C++ runtime reported the BOS asset as
loaded with no warning. The three packs all carried the *English* BOS, because
an earlier orchestration bug moved one file into every pack.

`bos_before_voice` is a learned `nn.Parameter`, so it is expected to differ per
model. If it does, using one language's BOS with another's weights is
out-of-distribution conditioning - the same class of failure the model warns
about at tts_model.py:932.

This loads each language's own weights and prints the vector's fingerprint, so
the question is answered from the models rather than assumed.
"""

import sys
from pathlib import Path

import torch

sys.path.insert(0, r"D:\App\unifia\voice-runtime\.build-temp\pocket-export\pylibs")

BASE = Path(r"D:\App\unifia\voice-runtime\.build-temp\pocket-export")
CONFIG_DIR = Path(r"D:\App\unifia\voice-runtime\packages\voice-host\.venv\Lib"
                  r"\site-packages\pocket_tts\config")

PACKS = [
    ("english", "models-cloning"),
    ("spanish", "models-es"),
    ("italian", "models-it"),
    ("german", "models-de"),
]

from pocket_tts.models.tts_model import TTSModel  # noqa: E402
from pocket_tts.utils.config import load_config  # noqa: E402


def main() -> int:
    fingerprints = {}
    for stem, pack in PACKS:
        weights = BASE / pack / ".cache" / "tts_b6369a24.safetensors"
        if not weights.exists():
            print(f"{stem:9s} SKIP - no staged weights in {pack}")
            continue
        config = load_config(str(CONFIG_DIR / f"{stem}.yaml"))
        config.weights_path = str(weights)
        model = TTSModel._from_pydantic_config_with_weights(
            config, temp=0.0, sampler_decode_steps=1, noise_clamp=None, eos_threshold=-4.0,
        )
        bos = model.flow_lm.bos_before_voice.detach().float().cpu()
        fingerprints[stem] = bos
        print(f"{stem:9s} shape={tuple(bos.shape)} mean={bos.mean():+.6f} "
              f"std={bos.std():.6f} absmax={bos.abs().max():.4f}")

    print()
    names = list(fingerprints)
    if len(names) < 2:
        print("Not enough models compared to decide.")
        return 1
    print("pairwise max abs difference:")
    shared = True
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            delta = (fingerprints[a] - fingerprints[b]).abs().max().item()
            if delta != 0.0:
                shared = False
            print(f"  {a:9s} vs {b:9s} -> {delta:.6e}")
    print()
    if shared:
        print("RESULT: bos_before_voice is IDENTICAL across models; a shared asset is correct.")
    else:
        print("RESULT: bos_before_voice DIFFERS per model; each pack must export its own.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
