"""Locate exactly where the flow_lm_main AR divergence originates.

Facts established so far:
  * every weight initializer is fp32; `conditioning`/`eos_logit` are fp32;
    only the KV cache I/O is fp16 (12 Cast-to-fp16 nodes = 6 layers x K/V).
  * after the monkeypatch fix the *text* pass compares bit-exact on
    `kv_cache_L0_K` -- but that check only inspects layer 0, K, and only the
    filled prefix.

So this probe repeats the text pass and compares EVERY layer's K and V cache
over the filled prefix. If deeper layers or the V caches drift, the AR step
(which attends over the whole cache) inherits that error while the L0-K spot
check still looks perfect.
"""

import copy
import sys

import numpy as np
import onnxruntime as ort
import torch

sys.path.insert(0, r"D:\App\unifia\voice-runtime\.build-temp\pocket-export\PocketTTS.cpp")
sys.path.insert(0, r"D:\App\unifia\voice-runtime\.build-temp\pocket-export\pylibs")

import export_onnx as EX  # noqa: E402
from pocket_tts.models.tts_model import TTSModel  # noqa: E402
from pocket_tts.modules.stateful_module import init_states, increment_steps  # noqa: E402
from pocket_tts.utils.config import load_config  # noqa: E402

MODEL_DIR = r"D:\App\unifia\voice-runtime\.build-temp\pocket-export\models-en2"
CONFIG = r"D:\App\unifia\voice-runtime\packages\voice-host\.venv\Lib\site-packages\pocket_tts\config\english.yaml"
N_LAYERS = 6
MAX_SEQ = EX.MAX_SEQ_LEN


def main() -> int:
    config = load_config(CONFIG)
    config.weights_path = rf"{MODEL_DIR}\.cache\tts_b6369a24.safetensors"
    model = TTSModel._from_pydantic_config_with_weights(
        config,
        temp=EX.DEFAULT_TEMPERATURE,
        sampler_decode_steps=EX.DEFAULT_LSD_DECODE_STEPS,
        noise_clamp=EX.DEFAULT_NOISE_CLAMP,
        eos_threshold=EX.DEFAULT_EOS_THRESHOLD,
    )
    model.eval()
    EX._monkeypatch_for_onnx()

    text = "Hello world."
    prepared = model.flow_lm.conditioner.prepare(text)
    tokens = EX._unwrap_prepared(prepared)
    if tokens.dim() == 1:
        tokens = tokens.unsqueeze(0)
    with torch.no_grad():
        text_embeddings = model.flow_lm.conditioner(EX._wrap_tokens(tokens))
    text_len = tokens.shape[1]
    print(f"text_len = {text_len}")

    sess = ort.InferenceSession(rf"{MODEL_DIR}\flow_lm_main.onnx")
    ort_states = []
    for _ in range(N_LAYERS):
        ort_states.append(np.zeros((1, MAX_SEQ, 16, 64), dtype=np.float16))
        ort_states.append(np.zeros((1, MAX_SEQ, 16, 64), dtype=np.float16))
        ort_states.append(np.zeros((1,), dtype=np.int64))

    feed = {
        "sequence": np.zeros((1, 0, 32), dtype=np.float32),
        "text_embeddings": text_embeddings.numpy(),
    }
    for i in range(N_LAYERS):
        feed[f"state_{i * 3}"] = ort_states[i * 3]
        feed[f"state_{i * 3 + 1}"] = ort_states[i * 3 + 1]
        feed[f"state_{i * 3 + 2}"] = ort_states[i * 3 + 2]
    ort_out = sess.run(None, feed)
    for i in range(N_LAYERS):
        ort_states[i * 3] = ort_out[2 + i * 3]
        ort_states[i * 3 + 1] = ort_out[3 + i * 3]
        ort_states[i * 3 + 2] = ort_out[4 + i * 3]

    pt_state = init_states(model.flow_lm, batch_size=1, sequence_length=MAX_SEQ)
    EX._sanitize_states(pt_state)
    empty_seq = torch.empty(1, 0, model.flow_lm.ldim)
    with torch.no_grad():
        model._run_flow_lm_and_increment_step(
            model_state=pt_state, text_tokens=tokens, backbone_input_latents=empty_seq,
        )

    print("\nper-layer cache divergence after the TEXT pass")
    print(f"{'layer':>5} {'which':>3} {'offset':>7} {'abs':>11} {'rel':>11}  dtypes")
    for name, ms in sorted(pt_state.items()):
        if "self_attn" not in name:
            continue
        layer_no = int(name.split("layers.")[1].split(".")[0])
        offset = int(ms["offset"][0].item())
        for which in ("k", "v"):
            if which == "k":
                pt_cache = (ms["cache"][0, 0, :offset].numpy() if "cache" in ms
                            else ms["cache_k"][0, :offset].numpy())
            else:
                pt_cache = (ms["cache"][0, 1, :offset].numpy() if "cache" in ms
                            else ms["cache_v"][0, :offset].numpy())
            ort_step = int(ort_states[layer_no * 3 + 2][0])
            ort_cache = ort_states[layer_no * 3 + (0 if which == "k" else 1)][0, :ort_step]
            if pt_cache.shape != ort_cache.shape:
                print(f"{layer_no:>5} {which:>3} SHAPE MISMATCH {pt_cache.shape} vs {ort_cache.shape}")
                continue
            abs_d = float(np.abs(pt_cache.astype(np.float64) - ort_cache.astype(np.float64)).max())
            rel_d = abs_d / (float(np.abs(pt_cache).max()) + 1e-8)
            flag = "  <-- DRIFT" if abs_d > 1e-6 else ""
            print(f"{layer_no:>5} {which:>3} {offset:>7} {abs_d:>11.3e} {rel_d:>11.3e}  "
                  f"pt={pt_cache.dtype} ort={ort_cache.dtype}{flag}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
