"""Export `flow_lm.bos_before_voice` as a first-class asset of the ONNX pack.

Measured 2026-09-27: the C++ runtime omits the BOS prefix that pocket-tts 3.1.0
prepends to the voice conditioning (`tts_model.py:972`, guarded by
`insert_bos_before_voice: true` in `english.yaml`). A controlled replay of the
model's own state construction, with the prefix as the only variable, showed:

    with BOS     -> EOS fires at frame 67, 71 AR frames, 5.520 s
    without BOS  -> EOS fires at frame  7, 11 AR frames, 0.720 s

One conditioning step out of 126 changes the stop point by a factor of ~9.6.

The vector is a model parameter, not a constant baked into the graph, so it
cannot live inside `flow_lm_main` without changing the graph's contract for
every caller. Exporting it as its own zero-input graph keeps the existing
`flow_lm_main` interface intact and gives the runtime exactly one way to
obtain it, with no format parsing in C++.
"""

import sys
from pathlib import Path

import onnx
import torch
from onnx import helper, numpy_helper

sys.path.insert(0, r"D:\App\unifia\voice-runtime\.build-temp\pocket-export\pylibs")

MODEL_DIR = Path(
    sys.argv[1] if len(sys.argv) > 1
    else r"D:\App\unifia\voice-runtime\.build-temp\pocket-export\models-cloning"
)
CONFIG = Path(r"D:\App\unifia\voice-runtime\packages\voice-host\.venv\Lib"
              r"\site-packages\pocket_tts\config\english.yaml")

from pocket_tts.models.tts_model import TTSModel  # noqa: E402
from pocket_tts.utils.config import load_config  # noqa: E402


def main() -> int:
    config_path = MODEL_DIR.parent / "config" / (
        "english.yaml" if "cloning" in MODEL_DIR.name or MODEL_DIR.name == "models-en"
        else MODEL_DIR.name.replace("models-", "") + ".yaml"
    )
    config = load_config(str(config_path))
    config.weights_path = str(MODEL_DIR / ".cache" / "tts_b6369a24.safetensors")
    print(f"config  = {config_path.name}")
    print(f"weights = {config.weights_path}")
    model = TTSModel._from_pydantic_config_with_weights(
        config, temp=0.0, sampler_decode_steps=1, noise_clamp=None, eos_threshold=-4.0,
    )
    model.eval()

    if not getattr(model.flow_lm, "insert_bos_before_voice", False):
        print("config does not set insert_bos_before_voice; nothing to export")
        return 1

    bos = model.flow_lm.bos_before_voice.detach().float().cpu()
    shape = tuple(bos.shape)
    print(f"bos_before_voice shape = {shape}")
    print(f"bos_before_voice dtype = {bos.dtype}")

    array = numpy_helper.from_array(bos.numpy(), name="bos_before_voice_value")
    node = helper.make_node(
        "Identity", inputs=["bos_before_voice_value"], outputs=["bos_before_voice"]
    )
    graph = helper.make_graph(
        [node],
        "pocket_bos_before_voice",
        [],
        [helper.make_tensor_value_info("bos_before_voice", onnx.TensorProto.FLOAT, list(shape))],
        initializer=[array],
    )
    model_proto = helper.make_model(
        graph,
        opset_imports=[helper.make_opsetid("", 17)],
        producer_name="unifia-pocket-export",
    )
    model_proto.ir_version = 8
    onnx.checker.check_model(model_proto)

    dest = MODEL_DIR / "bos_before_voice.onnx"
    onnx.save(model_proto, str(dest))
    print(f"wrote {dest} ({dest.stat().st_size:,} bytes)")

    # Round-trip through ORT so a wrong asset can never reach the runtime.
    import onnxruntime as ort
    import numpy as np

    session = ort.InferenceSession(str(dest))
    out = session.run(None, {})[0]
    delta = np.abs(out.astype(np.float64) - bos.numpy().astype(np.float64)).max()
    print(f"ORT round-trip max abs diff = {delta:.3e}")
    if delta != 0.0:
        print("FAIL: exported asset does not round-trip exactly")
        return 1
    print("OK: exported BOS asset round-trips bit-exactly")
    return 0


if __name__ == "__main__":
    sys.exit(main())
