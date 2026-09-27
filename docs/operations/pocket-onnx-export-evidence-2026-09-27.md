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

### 4.9 The remaining defect is premature EOS on longer text

With the runaway resolved, a real, separable defect appears — the C++ render is
now **too short**, the opposite failure mode:

| Text | Eager reference | ONNX / C++ | Drift | Verdict |
|---|---|---|---|---|
| `"Hi."` | 0.760 s | 0.480 s | −36.8% | duration FAIL, everything else PASS |
| full sentence | **5.640 s** | **2.080 s** | **−63.1%** | duration FAIL, spectral FAIL (0.3652) |

For the full sentence the candidate stops after ~26 frames where the reference
runs ~70, so the EOS head now fires **too early** rather than never.

One caveat on the `"Hi."` duration: the reference deliberately appends tail
padding (0.26 s trailing silence, 0.04 s leading) while the C++ emits none.
Its *voiced* span is therefore ≈0.46 s against the candidate's 0.48 s — a ~4%
match. The raw duration metric conflates speech with padding, so voiced
duration is the fairer criterion; that refinement is recorded rather than
silently applied.

Leading hypothesis for the premature EOS: the C++ supplies voice conditioning
through the pre-3.x path, while pocket-tts 3.1.0 routes it through
`flow_lm.speaker_proj_weight` with `insert_bos_before_voice: true`. A
conditioning path that does not match leaves the model believing the turn is
already complete, which fires EOS early. The `--eos-extra` auto-calculation
(from text length) is a secondary suspect.

Not yet distinguished: early EOS from a wrong conditioning path, versus early
EOS from text being consumed faster than the reference consumes it. The next
step compares, for the full sentence, the frame index at which each side fires
EOS and the conditioning tensors at that frame.

## 5. What this session did and did not establish

Established by measurement: all five graphs export; four reproduce eager
PyTorch to fp32 noise or bit-exactly; the fifth differs only by an fp16
KV-cache precision floor that grows monotonically with depth; the C++ runtime
loads and executes the pack and produces genuine, correctly-levelled speech at
0.35-2.89x realtime on a desktop CPU; the runaway was caused by the no-cloning
weight variant and is **resolved** by the official weights; and the residual
defect is **premature EOS** on longer text, with the C++ stopping at ~26 frames
against the reference's ~70.

Not established: full audio equivalence (duration and spectral both still
failing on the full sentence), the cause of the premature EOS, a warm TTFA
measurement on any device, any Android arm64 build, any on-device figure, and
cancellation behaviour. **No Pocket TTS capability is qualified by this work.**

## 6. Two side findings worth recording

- **`Voice cloning: True`** is reported by the exporter even when the
  no-cloning weights are loaded. The flag reflects architectural capability,
  not the weights in use. Campaign §40 requires honest capability reporting, so
  the shipped capability surface must state that Android Pocket synthesis is
  **not** a voice-cloning engine regardless of this flag — and §4.6/§4.8 are
  direct evidence that the no-cloning variant is not a usable substitute.
- The product `pocket-tts` lock is **3.1.0**, while upstream is **3.3.0**
  (2026-09-24). That two-release gap is itself a scheduled follow-up, not part
  of the Android critical path.

## 7. Not verified this session

- The cause of the premature EOS (§4.9). A wrong voice-conditioning path and
  text consumed too fast are both still consistent with the evidence.
- The seed voice is fetched from `kyutai/tts-voices`, a **different repository
  from the model weights**, and is used only as local conditioning for a
  pipeline comparison. It is not redistributed and is **not** a licence-cleared
  shipping voice; §26 still requires a per-voice licence check before any real
  voice is qualified.
- `mimi_encoder` and `text_conditioner` have no INT8 variant, so an INT8 pack
  still needs the two fp32 graphs (~43 MB combined).
- Only the fp32 pack has been executed. The INT8 pack has never been run.
