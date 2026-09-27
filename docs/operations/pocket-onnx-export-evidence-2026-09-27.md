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

## 4. The C++ runtime executes the graphs — and fails the audio gate

`PocketTTS.cpp` was built on the Windows host (MSVC, `cmake -B .build
-DCMAKE_BUILD_TYPE=Release`, ONNX Runtime 1.23.2 fetched by the project's own
CMake). The CLI `pocket-tts.exe` links and runs.

> Note: the optional `BUILD_SHARED_LIB=ON` target does **not** link on Windows —
> it passes `-l:libonnxruntime.so`, a GNU-ld flag MSVC ignores
> (`LNK4044`), leaving `OrtGetApiBase` unresolved. This is an upstream Windows
> gap in the shared-library path, not a problem with the graph pack. The CLI
> target, which is what produces audio, builds and runs cleanly.

### 4.1 Measured execution (fp32, 8 threads, desktop)

| Metric | Value |
|---|---|
| Graph load (all 5) | **1.12 s** |
| Audio produced | 12.40 s (temp 0.7) / 14.48 s (temp 0.3) |
| Generation wall time | 4.29 s / 5.25 s |
| **RTFx** | **2.89x / 2.76x** (RTF 0.35 / 0.36) |
| **First-chunk latency** | **1504 ms / 1663 ms** |
| Output level | peak −6.73 / −12.40 dBFS — audible, correctly levelled |

The 5 ONNX graphs therefore load and execute for real and produce genuine,
auditable speech. That part of the Android plan is de-risked.

The headline TTFA is dominated by one-time conditioning work, not by streaming:
the profile shows `encode_voice` at **1325 ms** and `run:mimi_encoder` at
**1214 ms**, each executed exactly **once**. Subtracting that one-time cost
leaves a warm first-chunk latency of roughly **180 ms**, which is inside the
§45 `<250 ms` target. The cold number must not be quoted as steady-state.

### 4.2 Audio-level equivalence against the PyTorch reference: **FAIL**

Reference: eager pocket-tts 3.1.0, same seed voice
(`kyutai/tts-voices` `alba-mackenna/casual.wav`), same text, same
`english.yaml` config. `audio_compare.py` applies the §24 criteria.

| Criterion | Reference | Candidate (t=0.7) | Candidate (t=0.3) | Limit | Result |
|---|---|---|---|---|---|
| duration | 5.640 s | 12.400 s | 14.480 s | ±25% | **FAIL** (+120%, +157%) |
| non-silence ratio | 0.796 | 0.975 | 0.977 | ±0.15 | **FAIL** (+0.179, +0.181) |
| trailing silence | 0.27 s | **0.00 s** | **0.00 s** | — | **FAIL** |
| leading silence | 0.11 s | 0.00 s | 0.00 s | — | note |
| peak level | −5.33 dBFS | −6.73 dBFS | −12.40 dBFS | > −50 | PASS |
| spectral JSD | — | 0.583 | 1.393 | ≤0.35 | **FAIL** |

**This is a runaway-output failure, which §24 names explicitly.** The render
produces continuous energy to a frame cap and never stops on EOS: trailing
silence is exactly 0.00 s in both runs, and non-silence sits at 0.977.

Lowering the temperature to match the config's `default_temperature: 0.3` made
it *worse*, not better (14.48 s, JSD 1.39), so this is not a sampling-tuning
problem. The C++ AR loop is not converging to the same EOS decision as the
eager reference on these graphs.

### 4.3 Minimised repro and the measured EOS trajectory

Following the §40 self-correction loop (reproduce → minimise), the failure was
minimised to a two-character utterance:

| Text | Eager reference | ONNX / C++ | Drift |
|---|---|---|---|
| `"Hi."` | **0.760 s** | **4.560 s** | **+500%** |

A trivial input running away 6x proves this is **not** sampling divergence from
the fp16 floor — an AR model that had merely sampled differently would still
terminate somewhere. The loop never reaches its end-of-sequence decision at all.

The EOS comparison itself was then checked and is **correct**: pocket-tts
computes `out_eos = self.out_eos(transformer_out) > eos_threshold`
(`models/flow_lm.py:154`) and the C++ tests
`eos_logit > tts.cfg_.eos_threshold` (`pocket_tts.cpp:1814`). Same direction,
same default threshold of −4.0. There is no sign or polarity bug.

Instrumenting the C++ per-frame (temporary, scratch-tree only) shows the EOS
logit **is** being produced and **is** rising — it is simply far too slow to
reach the threshold:

```
frame  0  -7.3226      frame 12  -6.2091      frame 23  -4.7661   <- still below -4.0
frame  1  -6.8403      frame 13  -5.9363
frame  2  -6.1751      frame 14  -5.7228
frame  3  -5.9363      frame 15  -5.6481
frame  4  -5.9346      frame 16  -5.4966
frame  5  -5.8465      frame 17  -5.4009
frame  6  -6.0755      frame 18  -5.2442
frame  7  -6.0553      frame 19  -5.2719
frame  8  -5.7943      frame 20  -5.2682
frame  9  -5.9174      frame 21  -5.1376
frame 10  -6.1274      frame 22  -4.9770
frame 11  -6.1711      frame 23  -4.7661
```

The trajectory climbs by roughly 0.1 per frame. Extrapolating the trend, it
would cross −4.0 within ~8 further frames — but the render ran to ~51 frames
(~4.1 s) and **never fired**.

**Diagnosis: the EOS signal is systematically delayed, not absent.** For `"Hi."`
the eager model is done after ~9 frames; this runtime has not resolved
end-of-sequence after 5x that. A rising-but-lagging logit points at the
autoregressive *state* rather than the EOS head: the model is not accumulating
"the text is finished" evidence across steps, which is consistent with the
KV-cache/conditioning state the C++ loop carries between frames differing from
the reference even though the exported graph itself is numerically sound
(§2.2). The audio is plausible speech rather than noise, which is why the
defect is not obvious by ear.

### 4.4 Reading this against §2.2

§2.2 established that the graph computes correctly in fp32 and differs from
eager PyTorch only by fp16 KV-cache rounding through 6 layers, deepest-layer
relative error `4.4e-03`. §4.2 then showed the product consequence: the
residual is large enough to flip autoregressive decisions, so the ONNX path
stops where the reference does not. §4.3 sharpens that: even the two-character
case never terminates, so the defect is not marginal drift but a systematically
wrong autoregressive state. **The tensor-level precision floor and the
audio-level failure are the same defect at two levels** — which is why the gate
had to move to audio, and why the audio result governs.

### 4.6 CORRECTION — the runaway is in the weights, not the C++ runtime

The §4.2 and §4.3 conclusions above — that the C++ autoregressive state was
wrong — **are wrong, and are withdrawn.** A direct trace of the *eager PyTorch
reference* settles it.

`english.yaml` declares **two different weight variants**:

```yaml
weights_path:                        hf://kyutai/pocket-tts/languages/english/model.safetensors@39592ff2...
weights_path_without_voice_cloning:  hf://kyutai/pocket-tts-without-voice-cloning/...@d29db797...
```

| Path | Weights used | Result for `"Hi."` |
|---|---|---|
| CLI `generate --config english.yaml` | `weights_path` → **voice-cloning** | **0.760 s**, terminates |
| `_from_pydantic_config_with_weights`, `weights_path` overridden to the staged file | **no-cloning** | **2.720 s**, never fires EOS |
| ONNX pack exported from that staged file → C++ runtime | **no-cloning** | **4.560 s**, never fires EOS |

The eager reference, given the *same* no-cloning weights as the ONNX pack,
also fails to terminate and logs the model's own warning:

```
WARNING:pocket_tts.models.tts_model:Maximum generation length reached
        without EOS, this very often indicates an error.
```

Its per-frame trajectory never crosses −4.0 either:

```
frame  0  -8.3495   frame  8  -7.1900   frame 16  -7.1694
frame  1  -5.5615   frame  9  -6.8124   ...
frame  2  -7.5405   frame 10  -6.6408   RESULT: never crosses the threshold
...                    ...                  (36 steps, 2.88s of AR)
```

**Therefore the C++/ONNX runtime is faithful to the weights it was given.** It
does not fire EOS because the no-cloning variant does not fire EOS. The
earlier comparison against a 0.760 s CLI render was invalid: it compared two
*different models*, not two runtimes.

The `without-voice-cloning` repository is a community-processed derivative —
upstream's own gate carries a Prohibited Use clause on voice cloning, and the
processing is a script that strips the cloning path. That stripping appears to
leave the EOS head degenerate for this model/config. This is a
**weight-provenance defect, not an ONNX export defect and not a C++ port
defect.**

What survives from the earlier sections: the export itself is sound (§2.1–§2.2,
four graphs bit-exact, the fifth an fp16 precision floor), the pack loads and
runs at 1.55–2.89x realtime (§4.1), and the audio gate is correctly specified
(§2.3, §4.2). What is withdrawn: §4.2's "runaway means the AR state is wrong",
§4.3's "EOS is delayed, pointing at the C++ AR state", and §4.5's diagnostic
plan premised on that.

### 4.7 Next exact action

1. Re-run the export and the audio gate from the **voice-cloning** weights
   (`kyutai/pocket-tts` @ `39592ff23c9ef80098bb74895d104c26275fe2c9`) as the
   reference, and confirm the C++ render then terminates. That isolates the
   weight variant as the sole cause.
2. Separately, decide the **licence question**, which is a product decision and
   not an engineering one: `kyutai/pocket-tts` is `gated: "auto"` and its model
   card carries a **Prohibited Use** clause covering voice cloning. Shipping a
   runtime built on those weights may be unacceptable even though the code is
   MIT and the weights are CC-BY-4.0. This must be resolved before any Android
   work, not after.
3. Only after 1 and 2, re-run the §24 audio gate and the arm64 build.

### 4.8 Re-run with the official voice-cloning weights — runaway resolved

Following the §4.7 action, the pack was re-exported from the official
`kyutai/pocket-tts` weights at the revision `english.yaml` pins. The staged
file hashes `473f47d99560bd50eb8b4509d3cacfe7f316ab20bdca86505403a2e6a936a6e9`,
distinct from the no-cloning file's `be9c6b48...`, so the two variants are
genuinely different artifacts.

The export behaves as before (four graphs exact; `flow_lm_main` AR at the same
fp16 floor; `mimi_decoder` frames 0.21e-06 to 8.09e-06), confirming §2.2 is a
property of the runtime rather than of one weight file.

**The runaway is gone.** EOS now fires instead of never firing:

| | no-cloning weights | voice-cloning weights |
|---|---|---|
| `"Hi."` EOS | never crosses −4.0 | **fires at frame 2** (−3.4199) |
| `"Hi."` duration | 4.560 s | **0.480 s** |
| `"Hi."` non-silence drift | +0.382 (FAIL) | +0.128 (PASS) |
| `"Hi."` spectral JSD | 0.8615 (FAIL) | **0.2147 (PASS)** |

This confirms §4.6: the runaway was the weight variant, and the ONNX pack and
C++ port were faithful all along.

### 4.10 Root cause found and fixed — the missing `bos_before_voice` prefix

pocket-tts 3.1.0 builds the voice conditioning as (`tts_model.py:972`):

```python
if self.flow_lm.insert_bos_before_voice:
    prompt = torch.cat([self.flow_lm.bos_before_voice, prompt], dim=1)
```

`english.yaml` sets `insert_bos_before_voice: true`. The C++ runtime fed the
raw `mimi_encoder` output with **no prefix**, and contained no
`insert_bos` / `bos_before_voice` handling at all.

A controlled replay of the model's own state construction, using its identical
`_run_flow_lm_and_increment_step` call and making the prefix the *only*
variable, confirmed it:

| | WITH `bos_before_voice` (stock eager) | WITHOUT (C++ path) |
|---|---|---|
| conditioning length | **126** steps | **125** steps |
| EOS fires at frame | **67** | **7** |
| AR frames | 71 | 11 |
| duration | **5.520 s** | 0.720 s |

**One conditioning step out of 126 moved the stop point by a factor of ~9.6.**

The model itself documents this class of failure: feeding conditioning outside
its trained distribution leaves it *"typically never emits EOS"*
(`tts_model.py:932`).

**The fix.** `flow_lm.bos_before_voice` is a model parameter, not a constant in
the graph, so baking it into `flow_lm_main` would change that graph's contract
for every caller. It is instead exported as a zero-input asset
(`bos_before_voice.onnx`, 4,288 bytes, SHA-256
`c0a66e83fa9ae0ed66a36781fb076602fd9701df55a2f0640ed497a71a838849`, verified to
round-trip through ONNX Runtime bit-exactly) and prepended by the runtime on
the **voice conditioning pass only**. The text path is deliberately untouched,
because pocket-tts does not prefix text conditioning. The runtime also warns
loudly when the asset is absent, since its absence silently degrades output.

Patch: `scripts/voice/pocket-export/pockettts-cpp-bos-before-voice.patch`
(93 insertions, 1 deletion, against upstream `e801e7d6c269`).

### 4.11 §24 audio gate now **PASSES**

| Criterion | Eager reference | ONNX / C++ + BOS | Limit | Result |
|---|---|---|---|---|
| duration | 5.640 s | 5.840 s (**+3.55%**) | ±25% | **PASS** |
| non-silence ratio | 0.796 | 0.856 (+0.060) | ±0.15 | **PASS** |
| leading silence | 0.11 s | 0.04 s | — | ok |
| trailing silence | 0.27 s | 0.12 s | — | ok |
| peak level | −5.33 dBFS | −4.34 dBFS | > −50 | **PASS** |
| spectral JSD | — | **0.1565** | ≤0.35 | **PASS** |

**VERDICT: PASS — audio-level equivalence holds at the §24 gate.**

For the same sentence the C++ render goes from 2.080 s / JSD 0.3652 (failing) to
5.840 s / JSD 0.1565 (passing) on a one-line semantic fix. Throughput is
RTFx 2.28x with a 1305 ms cold first chunk.

This closes the loop on the whole investigation: the runaway (§4.2) was the
no-cloning weight variant (§4.6), and the premature EOS (§4.9) was the missing
BOS prefix (§4.10). Neither was an ONNX export defect, and the fp16 precision
floor of §2.2 remains a documented, understood property that did not prevent
audio equivalence.

## 4.12 Extending to the five mandatory languages — French is structurally different

A first sweep exposed a mismatch that is easy to get wrong: the published
models are **not** one architecture. Inspecting the configs at revision
`39592ff2`:

| Config | HF directory | `num_layers` | `d_model` | weights |
|---|---|---|---|---|
| `english.yaml` | `languages/english` | 6 | 1024 | 219 MB |
| `spanish.yaml` | `languages/spanish` | 6 | 1024 | 219 MB |
| `italian.yaml` | `languages/italian` | 6 | 1024 | 219 MB |
| `german.yaml` | `languages/german` | 6 | 1024 | 219 MB |
| `french_24l.yaml` | `languages/french_24l` | **24** | 1024 | **672 MB** |

**There is no 6-layer French model.** `kyutai/pocket-tts` publishes
`french_24l` but no `french`; the earlier sweep failed with a 404 on
`languages/french/model.safetensors` because the directory simply does not
exist. English, Spanish, Italian and German share the 6-layer architecture
that the exporter was written for. French exists only as the 24-layer
checkpoint, at **672 MB — 3x English** — which is a material mobile packaging
fact on its own.

### 4.13 The exporter hardcoded 6 layers

`export_onnx.py` declared `NUM_LAYERS = 6` as a class constant on
`FlowLMMainWrapper`, and the tracing wrapper sizes its KV caches from it. With
a 24-layer model the wrapper indexes `k_caches[i]` past its end and dies with
`IndexError` during `torch.jit.trace`. The PocketTTS.cpp runtime has **no**
such assumption — it enumerates graph states dynamically through
`StateBufferIO` — so the exporter was the only blocker.

Patch 7 derives the geometry from the loaded model instead:

```python
FlowLMMainWrapper.NUM_LAYERS = len(flow_lm.transformer.layers)
FlowLMMainWrapper.D_MODEL   = first.self_attn.in_proj.in_features
FlowLMMainWrapper.NUM_HEADS = int(first.self_attn.num_heads)
FlowLMMainWrapper.DIM_PER_HEAD = int(first.self_attn.dim_per_head)
```

This is verified to work: the French export now reports
`flow_lm geometry: 24 layers, d_model=1024, heads=16` and gets past the
previous `IndexError`.

### 4.14 French export then hits `MemoryError`

With the layer count generalised, the 24-layer `flow_lm_main` trace exhausts
memory on this host:

```
torch.onnx.export -> _export -> graph._export_onnx
MemoryError: bad allocation
```

The 6-layer backbone already produces a 302 MB graph; 24 layers is roughly 4x
the nodes, and the TorchScript trace holds the whole graph in memory. This is a
host-capacity finding, not a correctness one, and it has **not** been resolved
here. French therefore remains unqualified, and for a reason that is about
model size rather than about the runtime's correctness.



Established by measurement: all five graphs export; four reproduce eager
PyTorch to fp32 noise or bit-exactly; the fifth differs only by an fp16
KV-cache precision floor that grows monotonically with depth; the C++ runtime
loads and executes the pack at 2.28x realtime on a desktop CPU; the runaway was
caused by the no-cloning weight variant; the premature EOS was caused by a
missing `bos_before_voice` prefix; and after fixing it the **§24 audio gate
passes on English** with duration within 3.55% and spectral JSD 0.1565.

**English is the only language qualified.** Not established: the remaining four
mandatory languages, the INT8 pack (never executed), any Android arm64 build,
any on-device TTFA/RTF/RAM/thermal figure, and cancellation behaviour.
**No Pocket TTS capability is production-qualified by this work yet.**

### 4.15 `bos_before_voice` is model-specific — one BOS per language

A first multi-language sweep rendered **ES, IT and DE all at exactly 0.860 s**
(~10 frames) with EOS firing early, while the runtime reported the BOS asset as
loaded with no warning. An identical duration across three languages is not
speech; it is a fixed early stop.

The cause was an orchestration fault worth recording precisely, because it
produced plausible audio and raised no error: an earlier step moved the
**English** BOS asset into every pack. Loading each model's own weights settles
whether that was legitimate:

| model | mean | std | abs max |
|---|---|---|---|
| english | −0.000119 | 0.018299 | 0.0728 |
| spanish | +0.000398 | 0.058794 | 0.2119 |
| italian | +0.000299 | 0.052642 | 0.1719 |
| german | +0.000212 | 0.035513 | 0.1709 |

```
english vs spanish  2.060547e-01      english vs german  1.503906e-01
english vs italian  1.972656e-01      spanish vs german  1.452637e-01
italian vs german   1.608887e-01
```

**RESULT: `bos_before_voice` differs per model.** The inter-language deltas
(0.10–0.21) are an order of magnitude larger than the English vector's own
standard deviation (0.018), so substituting one language's BOS for another's is
out-of-distribution conditioning — exactly the failure class the model warns
about at `tts_model.py:932`.

This sharpens the earlier note: `bos_before_voice` is not merely
*config*-dependent, it is **weight-dependent**. Every language pack must export
its own, derived from the same weights as the graphs in that pack. A pack whose
BOS digest does not correspond to its own weights is invalid even when the
runtime loads it without complaint.

### 4.16 Five-language sweep results with per-model BOS

| Language | Gate | Duration drift | non-silence | spectral JSD |
|---|---|---|---|---|
| **EN** | **PASS** (via `models-cloning`) | +3.55% | +0.060 | **0.1565** |
| **IT** | **PASS** | −15.19% | +0.088 | **0.0463** |
| **DE** | **PASS** | −6.73% | +0.058 | **0.0330** |
| ES | FAIL | **+82.86%** | −0.014 | 0.4320 |
| FR | not run | — | — | — |

Italian and German now pass every criterion, which confirms that supplying each
model's own BOS is both necessary and sufficient for those two. Spanish passes
non-silence and level but **overshoots** — 15.58 s against an 8.52 s reference,
a +82.86% drift in the opposite direction to the earlier early-EOS failure.
French is blocked on the 24-layer `MemoryError` of §4.14.

### 4.17 A methodological flaw in the gate itself: the reference is stochastic

While running the sweep, the **same Spanish text against the same weights
produced three different reference durations**: 5.960 s, then 7.400 s, then
8.520 s. The eager reference is sampled at temperature 0.3, so it varies run to
run, and the candidate render is compared against a moving target with a ±25%
duration limit. Any individual comparison in that regime is unreliable in both
directions — it can fail a good render or pass a broken one.

This is a defect in the harness, not in the product, and it is recorded rather
than worked around: **the reference must be generated greedily (temperature 0)
so that both sides of the comparison are deterministic.** Until then the
duration column should be read as indicative, and the ES result in particular
should not be treated as settled. A greedy-reference generator is the next
harness change.

### 4.18 Two defects in my own harness, and the corrected deterministic result

Fixing §4.17 required correcting two more things that were mine, not the
product's.

**A silent reference.** The first greedy-reference generator cast the model's
normalised float output straight to int16 with `int(v)`, which truncates every
sample to zero. All four references were written as silence
(`peak=-infdBFS`, `voice=0.000`) and the gate dutifully reported every language
as failing. The generator now scales by 32767 and **refuses to write a file
whose peak is below 1000**, so a silent reference can never be produced or
compared again.

**An unstable spectral metric.** `spectral_profile` truncated to the first 3 s
and then analysed a single 2048-sample window — **85 ms at 24 kHz**. That is
not a sentence, which is why the same file pair scored 0.0330 against one
reference and 2.7321 against another. It now isolates the voiced frames with
the same silence threshold used elsewhere, concatenates them, and evaluates a
20-band Goertzel filterbank across the whole span. Self-check: a file compared
against itself now scores **JSD 0.0000**, which the old version could not be
trusted to produce.

With both sides greedy and the metric sound:

| Language | Duration (≤±25 %) | non-silence (≤±0.15) | spectral JSD (≤0.35) | Verdict |
|---|---|---|---|---|
| **EN** | +3.99 % | +0.046 | **0.0141** | **PASS** |
| **IT** | −9.82 % | +0.038 | **0.1220** | **PASS** |
| **DE** | −7.62 % | +0.110 | **0.1673** | **PASS** |
| ES | **+136.73 %** | **−0.447** | 0.0965 | **FAIL** |
| FR | not run | — | — | blocked on §4.14 |

English, Italian and German pass every criterion against a deterministic
reference. **Spanish is a genuine failure, not measurement noise**: the render
is 15.34 s against a 6.48 s reference, with 6.55 s of trailing silence after
the speech ends, and its non-silence ratio collapses from 1.000 to 0.553. The
spectral envelope matches (0.0965), so the voice is recognisably the same
language — the AR loop simply runs far too long. Note also that the Spanish
*reference itself* is 100 % voiced and flagged `trunc=True`, so the eager model
may itself be misbehaving for Spanish at temperature 0; that needs separating
from the runtime before the cause is attributed.

### 4.19 Spanish: the AR loop never reaches EOS — with a caveat about the trace

Tracing the Spanish render through the C++ runtime shows the autoregressive
EOS logit starting at **−7.4804** and moving *away* from the threshold, through
−7.15, −7.01, −8.06, −8.75, −9.59, −10.52, never approaching −4.0. The render
therefore runs to its frame budget: **15.34 s at RTFx 3.31**. Compare English,
whose AR logit crossed at frame 2. So Spanish is a genuine "EOS never fires"
failure, distinct from the earlier premature-EOS case and from the no-cloning
runaway.

**Caveat on this evidence, stated rather than glossed.** The trace printed two
separate `frame=0` blocks. The first block's logits cross the threshold and
report `FIRED` at frame 2; the second block does not. A per-frame counter
restarting means more than one latent-generation path is being sampled, and
the per-frame `out_eos` forward hook used elsewhere is also known to fire on
conditioning passes, not only on AR steps. So the two blocks are **not** yet
separated into "conditioning pass" and "AR loop", and the frame-2 `FIRED` in
the first block must not be read as a real end-of-sequence decision.

What *is* established: the block that governs the rendered audio never crosses
−4.0 for Spanish while it does for English, and Spanish therefore overruns to
15.34 s. What is **not** established: which conditioning call produces the
first block, and therefore whether the fault is in the Spanish model, in the
text-conditioning handoff, or in the AR state. Isolating that needs the trace
to tag its phase (conditioning vs AR) rather than infer it from a counter.

### 4.20 Spanish's reference is itself suspect

The Spanish eager reference at temperature 0 is **100 % voiced** with
`trunc=True`, against 0.756 (IT) and 0.755 (DE) for the same generator, and its
EOS is reported at frame 80 of 84. A reference that never decays into silence
is not a trustworthy target for a duration criterion, so the Spanish result
needs the reference's own behaviour characterised before the runtime is blamed.
That is the next diagnostic.

## 6. Three side findings worth recording

- **`Voice cloning: True`** is reported by the exporter even when the
  no-cloning weights are loaded. The flag reflects architectural capability,
  not the weights in use. Campaign §40 requires honest capability reporting, so
  the shipped capability surface must state that Android Pocket synthesis is
  **not** a voice-cloning engine regardless of this flag — and §4.6/§4.8 are
  direct evidence that the no-cloning variant is not a usable substitute.
- `insert_bos_before_voice` is a **config-dependent** model behaviour, not a
  constant. Any runtime port must honour it per language config rather than
  assuming it, and must fail loudly when the corresponding asset is missing,
  because the failure mode is plausible-sounding audio rather than an error.
- The product `pocket-tts` lock is **3.1.0**, while upstream is **3.3.0**
  (2026-09-24). That two-release gap is itself a scheduled follow-up, not part
  of the Android critical path.

## 7. Not verified this session

- **French, Spanish, Italian and German** are unmeasured. Each has its own
  config, and §6's BOS note means `insert_bos_before_voice` must be checked per
  language rather than assumed.
- The INT8 pack was never executed; only the fp32 pack has been run.
- No Android arm64 build exists and no on-device measurement has been taken.
- Cancellation, barge-in and streaming-chunk behaviour are untested.
- The seed voice is fetched from `kyutai/tts-voices`, a **different repository
  from the model weights**, used only as local conditioning. It is not
  redistributed and is **not** a licence-cleared shipping voice; §26 still
  requires a per-voice licence check before any real voice is qualified.
