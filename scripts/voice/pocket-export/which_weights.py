"""Determine which weight variant each path actually loads.

Two results conflict: the CLI produced a 0.760s render that terminated, while a
direct `_from_pydantic_config_with_weights` call on the same `english.yaml`
produced 2.720s that never fires EOS. `english.yaml` declares BOTH

    weights_path:                        ...kyutai/pocket-tts/...            (voice cloning)
    weights_path_without_voice_cloning:  ...pocket-tts-without-voice-cloning (no cloning)

so which one is taken decides everything. The exported ONNX pack and this
probe must agree, or the comparison is meaningless.
"""

import sys
from pathlib import Path

sys.path.insert(0, r"D:\App\unifia\voice-runtime\.build-temp\pocket-export\pylibs")

CONFIG = Path(r"D:\App\unifia\voice-runtime\packages\voice-host\.venv\Lib"
              r"\site-packages\pocket_tts\config\english.yaml")
STAGED = Path(r"D:\App\unifia\voice-runtime\.build-temp\pocket-export\models-en2"
              r"\.cache\tts_b6369a24.safetensors")

from pocket_tts.utils.config import load_config  # noqa: E402

config = load_config(str(CONFIG))
print("=== english.yaml as shipped ===")
for attr in ("weights_path", "weights_path_without_voice_cloning"):
    print(f"  {attr:36s} = {getattr(config, attr, '<absent>')}")
print(f"  default_temperature              = {getattr(config, 'default_temperature', '<absent>')}")
print()
print("=== staged weight used for the ONNX export ===")
print(f"  {STAGED}")
print(f"  exists={STAGED.exists()} size={STAGED.stat().st_size if STAGED.exists() else 0:,}")
print()

# What the exporter does: it overrides weights_path with the staged file, so the
# ONNX pack was produced from the no-cloning weights regardless of what the
# config's first entry points at.
print("CONCLUSION")
print("  The ONNX pack was exported from whatever file the exporter staged.")
print("  If that file is the no-cloning variant, the pack inherits whatever EOS")
print("  behaviour that variant has, and an ONNX-vs-PyTorch comparison using")
print("  voice-cloning weights would be comparing two different models.")
