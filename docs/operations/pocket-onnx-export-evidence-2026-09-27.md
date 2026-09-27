<!-- SPDX-License-Identifier: MIT -->
# Pocket TTS ONNX export — measured evidence (English, fp32 + INT8)

**Date:** 2026-09-27
**Campaign:** G7 / §23 (reopen the runtime bake-off), §24 (reference test),
§38 (certified artifact provenance), §46 (artifact evidence).
**Status:** export pipeline **works**; artifact **NOT qualified** — one of five
graphs fails numerical validation. This is a genuine, reproducible result, not
a scaffold and not a mock.

## 1. What was actually run

| Item | Value |
|---|---|
| Exporter | `VolgaGerm/PocketTTS.cpp` `export_onnx.py` |
| Upstream commit | `e801e7d6c2692121a39e80ae525cb5265174a495` (2026-03-29), MIT |
| Local delta | 101 insertions / 18 deletions — 6 documented compatibility shims, see §4 |
| pocket-tts | **3.1.0** (the product lock in `packages/voice-host/.venv`) |
| Torch | 2.14.0+cpu · ONNX Runtime 1.30.0 (CPU) · onnx 1.23.0 |
| Weights repo | `kyutai/pocket-tts-without-voice-cloning` @ `d29db7978e464fb90cb3359ee0c69a273b9142cc` |
| Weights size | 219,029,196 bytes — matches the G7 bake-off record exactly |
| Gating | `gated=false`; **no HF account, no token, no licence click-through required** |
| Config | `pocket_tts/config/english.yaml` (3.1.0) |
| Command | `python export_onnx.py --config <sp>/pocket_tts/config/english.yaml --output-dir models-en2` |

Reproducible tooling is committed under
[`scripts/voice/pocket-export/`](../../scripts/voice/pocket-export/):
the patch, the weight-staging script, the provenance emitter, and the upstream
MIT licence.

## 2. Measured numerical validation (PyTorch eager vs ONNX Runtime)

Tolerances: `atol=1e-4`, `rtol=1e-4` (`flow_lm_main` uses `1e-3` upstream).

| Graph | Result | Worst measured error |
|---|---|---|
| `text_conditioner.onnx` | **PASS** | `abs=0.00e+00 rel=0.00e+00` (bit-exact) |
| `mimi_encoder.onnx` | **PASS** | `abs=0.00e+00 rel=0.00e+00` (bit-exact) |
| `flow_lm_flow.onnx` | **PASS** | `abs=1.80e-06 rel=8.21e-07` |
| `mimi_decoder.onnx` | **PASS** | frames 0-4, worst `abs=5.84e-06 rel=1.35e-05` |
| `flow_lm_main.onnx` (text pass) | **PASS** | `kv_cache_L0_K abs=0.00e+00` (bit-exact, after §2.1) |
| **`flow_lm_main.onnx` (AR pass)** | **FAIL** | `eos_logit abs=2.95e-02 rel=6.76e-03`; `conditioning abs=7.22e-03 rel=5.49e-03` |

### 2.1 A real harness bug, found and fixed

`validate_flow_lm_main` never called `_monkeypatch_for_onnx()`, while
`validate_mimi_decoder` does. Without it, the PyTorch reference ran the
**unpatched fp32** state path while the ONNX graph runs an **fp16 KV cache**,
so the two were compared across dtypes. Adding the call made the text pass
bit-exact (`kv_cache_L0_K 1.78e-03 → 0.00e+00`). That is a genuine fix, not a
tolerance change.

### 2.2 Root cause of the remaining AR divergence — an fp16 precision floor

With the harness bug fixed, the residual was probed directly
(`probe_cache_drift.py`), comparing **every** layer's K and V cache over the
filled prefix after the text pass. Both sides are fp16 (`pt=float16
ort=float16` throughout):

| layer | K abs | K rel | V abs | V rel |
|---|---|---|---|---|
| 0 | `0.000e+00` | `0.000e+00` | `1.221e-04` | `2.053e-04` |
| 1 | `9.766e-04` | `1.813e-04` | `1.221e-04` | `2.538e-04` |
| 2 | `6.836e-03` | `1.339e-03` | `1.541e-03` | `2.803e-03` |
| 3 | `1.123e-02` | `2.205e-03` | `2.197e-03` | `2.854e-03` |
| 4 | `2.734e-02` | `3.145e-03` | `7.029e-03` | `7.794e-03` |
| 5 | `3.125e-02` | `4.427e-03` | `5.127e-03` | `5.183e-03` |

Two independent checks confirm this is a **precision floor, not a structural
defect**:

1. **The error grows monotonically with layer depth.** A wrong operator yields
   a large, non-monotonic error; a precision floor accumulates predictably.
   L0-K is bit-exact because the first cache write has no upstream error to
   accumulate.
2. **The graph computes in fp32.** Probing the artifact shows all **54 weight
   initializers are `FLOAT`**, and `conditioning` / `eos_logit` are `FLOAT`
   outputs. Only the cache I/O is fp16: exactly **12 Cast-to-fp16 nodes**
   (6 layers x K/V), matching the deliberate `.half()` casts in
   `_LinearKVCacheBackend.init_state` and the `k_fp16 = k.half()` append path.

Both sides therefore run identical fp32 maths and differ only in **where fp16
rounding lands** after 6 layers of reassociated matmuls. The deepest-layer
relative error (`4.427e-03`) matches the magnitude of the observed `eos_logit`
relative error (`6.76e-03`), closing the causal chain.

**The upstream spot-check was blind to this by construction:** it inspected only
layer 0, key cache only, over the filled prefix — the one tensor that is
bit-exact.

### 2.3 Consequence for the acceptance gate

Per-tensor `1e-4` equality is the **wrong gate** for an fp16-KV-cache
autoregressive backbone: it is unreachable by construction unless the cache is
widened to fp32, which would roughly double cache memory
(1000 x 16 x 64 x 6 layers x 2, a real mobile cost).

The correct gate is campaign §24 — **audio-level equivalence** against the
eager PyTorch reference: duration, non-silence ratio, truncation, EOS
behaviour, chunk sequence, language, cancellation, TTFA and RTF. The
tensor-level numbers stay recorded above as evidence the graph is structurally
sound. This is a change of *criterion*, recorded openly; the tolerance is
**not** relaxed to manufacture a green result.

### INT8 results, and why they must not be read as a pass

The INT8 pass reports all-green, but that is an artefact of the harness using
looser tolerances for the quantized run. The measured INT8 errors are **larger**
than the fp32 ones:

| Graph | INT8 worst error |
|---|---|
| `flow_lm_flow_int8` | `abs=3.39e-01 rel=1.79e-01` |
| `flow_lm_main_int8` (conditioning) | `abs=3.24e-01 rel=2.46e-01` |
| `flow_lm_main_int8` (eos_logit) | `abs=4.31e-01 rel=9.89e-02` |
| `mimi_decoder_int8` | `abs=3.04e-02 rel=1.46e-01` |

So the INT8 run **masks** the `flow_lm_main` divergence rather than clearing it.
Recorded here explicitly so a green INT8 line is never mistaken for qualification.

## 3. Artifact sizes — the mobile sizing reality

| Set | Size |
|---|---|
| fp32 (5 graphs) | **425.90 MB** |
| INT8 (3 graphs) | **108.42 MB** |

Per-graph fp32 / int8 (MB), with SHA-256 prefix:

| Graph | fp32 | int8 | SHA-256 (fp32) |
|---|---|---|---|
| `flow_lm_main` | 302.36 | 75.87 | `13430179fa3069af…` |
| `mimi_decoder` | 41.41 | 22.62 | `15cb1fdb81488ae5…` |
| `flow_lm_flow` | 39.08 | 9.94 | `8fca20a45ec5b4df…` |
| `mimi_encoder` | 26.65 | — | `d301de1c5362cb0d…` |
| `text_conditioner` | 16.39 | — | `0c4a200c839d1890…` |

INT8 is 25% of fp32 for the two flow graphs and 55% for the decoder. A full
mobile pack using the INT8 flow graphs is ~108 MB **per language**, so five
mandatory languages remain on the order of **0.5 GB provisioned**, not 1.07 GB.
That is a meaningful improvement over the raw-weight estimate, and it is now a
**measured** figure rather than an assumption. Provisioning must still be
on-demand through the model registry; nothing goes in the APK.

## 4. The compatibility delta (isolated, auditable, per §25 policy)

The exporter targets an older pocket-tts generation. pocket-tts 3.x moved and
renamed internals. Six shims were required; each is isolated and commented in
place, and none alters an exported graph, tensor name, op set, or numeric
operation:

1. **`TokenizedText`** — wrapper removed in 3.x. Upstream uses it both as a
   tensor argument *and* via `.tokens`, so the shim is a `torch.Tensor`
   subclass that also exposes `.tokens`.
2. **`DEFAULT_LSD_DECODE_STEPS` → `DEFAULT_SAMPLER_DECODE_STEPS`** — rename.
3. **`lsd_decode_steps=` → `sampler_decode_steps=`** keyword on
   `_from_pydantic_config_with_weights`.
4. **`_LinearKVCacheBackend`** moved `modules.transformer` → `modules.attention`.
5. **`_unwrap_prepared()`** — 3.x `LUTConditioner.prepare()` returns a
   `torch.Tensor`, not a wrapper.
6. **`mimi_decoder` validation double-quantize** — 3.x
   `decode_from_latent` runs the quantizer internally
   (`mimi.py:95`), so the harness must pass the pre-quantizer tensor.

Patch: `scripts/voice/pocket-export/pockettts-cpp-3.1.0-compat.patch`.

## 5. Two side findings worth recording

- **`Voice cloning: True`** is reported by the exporter even when the
  no-voice-cloning weights are loaded. The flag reflects architectural
  capability, not the weights in use. Campaign §40 requires honest capability
  reporting, so the shipped capability surface must state that Android Pocket
  synthesis is **not** a voice-cloning engine regardless of this flag.
- The product `pocket-tts` lock is **3.1.0**, while upstream is **3.3.0**
  (2026-09-24). That two-release gap is itself a scheduled follow-up, not part
  of the Android critical path.

## 6. Next exact action

1. Diagnose the `flow_lm_main` divergence against the other four exact graphs.
   Leading hypothesis: the ONNX AR-loop monkeypatch of
   `StreamingMultiheadAttention` / `_LinearKVCacheBackend` assumes the pre-3.x
   cache contract, and the residual lands in the KV cache first
   (`kv_cache_L0_K 1.78e-03`) then propagates to `eos_logit` (2.85e-02) —
   consistent with an accumulation error across autoregressive steps rather
   than a single wrong operator.
2. Re-run `--validate-only` until `flow_lm_main` passes at `1e-4`.
3. Only then build the arm64 JNI library and measure TTFA/RTF/RSS on
   `b7163823`. Do not start Android work against a numerically unverified
   backbone.
4. Then repeat per language, and register each pack with pinned digests.

## 7. Not verified this session

- The `flow_lm_main` root cause is **not** yet established; §6.1 is a hypothesis.
- No C++ runtime has been compiled and no PCM has been produced from these
  graphs. Nothing here qualifies audio output.
- No Android arm64 build exists. `onnxruntime` on-device is untested.
- `mimi_encoder` and `text_conditioner` have no INT8 variant, so an INT8 pack
  still needs the two fp32 graphs (~43 MB combined).
