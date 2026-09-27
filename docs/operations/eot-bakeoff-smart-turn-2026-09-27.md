<!-- SPDX-License-Identifier: MIT -->
# Smart Turn v3.2 EOT Candidate Bakeoff

**Status:** host candidate evidence only. This does not qualify Android, the
locked product package, physical barge-in behavior, or production turn-taking.

## Environment and method

- Source checkout: `voice` at `3e166db4a7f8d9123424b82729d453546f119c17`.
- Host: Windows x64; Python 3.13.7; onnxruntime 1.24.4; numpy 2.2.6.
- Harness: `scripts/voice/eot_bakeoff_smart_turn.py`, driven by the Silero
  v6.2.2 frames of `packages/voice-core/fixtures/turn-endpointing-parity.json`
  (bit-identical to the Rust corpus runner) over the 91 fixtures of
  `packages/contracts/corpus/unifia-eot-bench.json` with their committed
  annotations.
- Evaluation mirrors `native_audio.rs` (`CaptureSegmenter` VAD path plus the
  corpus evaluator and budgets). The harness refuses to run unless both model
  SHA-256 pins verify against `packages/voice-host/models/registry.json`, and
  it aborts if candidate A does not reproduce the committed benchmark numbers
  (anchor check: speech rate 0.9503, false-positive rate 0.0769, 78/81 finals
  within 400 ms, 24 forbidden, 5 mid-recording, 14 early, barge 4/5,
  languages 20/14/14/14/14).
- The full result set, per-fixture emissions, and every gate decision are
  written to ignored `.build-temp/smart-turn/bakeoff-results.json`.

## Immutable model identities

| Model | Version | SHA-256 | Size | Licence | Upstream revision |
|---|---|---|---:|---|---|
| `smart-turn-v3.2-cpu-onnx` | 3.2 | `2bb026316b14a660486a75b1733cd3fbab8c2fd0314dc9af7be49f8cca967e4f` | 8,679,182 B | BSD-2-Clause | `huggingface.co/pipecat-ai/smart-turn-v3@f766f81d3cfdf7737ac64aad813d91bbfd56bf93` |
| `silero-vad-v6.2.2-onnx` | 6.2.2 | (existing registry pin) | — | MIT | (existing registry pin) |

The Smart Turn artifact was downloaded from the pinned HF revision; the local
SHA-256 matches the repository LFS oid. Inference contract (validated against
`pipecat-ai/pipecat` `src/pipecat/audio/turn/smart_turn/`): input
`input_features` float32 `[1, 80, 800]` (Whisper log-mel, vendored numpy
extractor, zero-mean unit-variance normalization), output `logits` `[1, 1]`
sigmoid probability, accept when `p > 0.5`. Segment = int16/32768, sliced from
the turn start minus 500 ms pre-speech up to the trigger, capped to the last
128,000 samples (8 s) and front-padded with zeros to 8 s. ORT session:
sequential, 1 intra-op / 1 inter-op thread, all graph optimizations.

## Candidates

- **A — deterministic:** the committed endpointer (Silero ≥ 0.5 frames,
  650 ms trailing silence, 280 ms minimum speech, 60 s cap). Pass-through
  gate; this is the anchor and the production fallback.
- **B — smart-turn-gated (pure veto):** Smart Turn evaluates exactly once at
  each trailing-silence commit. Accept commits with `+ceil(e2e)` ms delay;
  veto keeps the turn open until speech resumes (bounded only by the
  deterministic maximum-duration fallback). Upstream semantics, no extras.
- **C — smart-turn-persist (bounded veto):** same single evaluation; a veto
  defers the commit to a deterministic fallback that fires **128 ms (4
  frames)** after the first veto, with no further inference. Silence budget:
  650 + 128 + 32 ≤ 810 ms; the delay stays inside the committed ±250 ms
  non-barge final-delta budget.

## Benchmark results (91 fixtures)

| Metric (budget) | A deterministic | B pure veto | C bounded veto |
|---|---:|---:|---:|
| Finals within ±400 ms (≥ 76) | **78/81** | 72/81 | **78/81** |
| Forbidden emissions (≤ 30) | 24 | 13 | **13** |
| Mid-recording forbidden (≤ 6) | 5 | 5 | **5** |
| Early finals (≥ −150 ms) | 14 | 3 | **3** |
| Incomplete-fixture forbidden (≤ 2 each) | 1 each (5) | 1 each (5) | **1 each (5)** |
| Barge finals emitted (≥ 4/5) | 4/5 | 4/5 | **4/5** |
| Clipped fixtures emitted (0) | 0 | 0 | **0** |
| Matched non-barge finals per language | 20/14/14/14/14 | 20/13/13/14/10 | **20/14/14/14/14** |
| Hard violations | 0 | 6 missing finals | **0** |
| Within budgets | yes | **no** | **yes** |

VAD-level statistics are candidate-independent (same Silero frames): speech
detection rate 0.9503 (≥ 0.94), silence false-positive rate 0.0769 (≤ 0.12).

## Veto analysis

Candidate B's six vetoes are genuine endings that Smart Turn calls
"incomplete" at the 650 ms trigger. A probe extending each vetoed segment
(`.build-temp/smart-turn/probe_persistence.py`, host-only) showed:

| Fixture | Trigger | p at trigger | First accept | C emission | Delta vs expected |
|---|---:|---:|---|---:|---:|
| fr-multi-01 | 3264 ms | 0.2642 | +400 ms | 3392 ms | +164 ms |
| es-multi-01 | 2880 ms | 0.0130 | +150 ms | 3008 ms | +228 ms |
| de-question-01 | 4256 ms | 0.1103 | +150 ms | 4384 ms | +88 ms |
| de-hesitation-01 | 4864 ms | 0.2012 | +300 ms | 4992 ms | +93 ms |
| de-filler-01 | 4480 ms | 0.0120 | never (≤ 0.089 at +2 s) | 4608 ms | +115 ms |
| de-false-01 | 8064 ms | 0.0107 | never (≤ 0.012 at +2 s) | 8192 ms | +106 ms |

No vetoed segment ever accepts inside the ±250 ms budget window, so a
re-evaluation cadence buys nothing within the bound; the 128 ms bounded
fallback alone recovers all six finals inside every budget. The five
mid-recording pauses and all early-window emissions are accepted at the
first evaluation (p 0.71–0.99), which is why candidate C keeps the
mid-recording count at 5 (budget 6).

## Runtime

180 evaluations (90 per Smart Turn candidate): 168 accepts, 12 rejects (the
same six segments evaluated once per candidate). End-to-end inference
p50 35.7 ms, p95 37.2 ms, max 39.1 ms. Whole-harness process cost 6.77 CPU-seconds,
peak RSS 100.1 MB. Thermal behavior and battery were not measured.

## Attribution and caveats

- Candidate C's forbidden reduction (24 → 13) is **partly latency, partly
  model**. Eleven of the removed emissions were borderline early commits that
  candidate A fired 18–80 ms before the expected endpoint; Smart Turn's
  accepted gates add ≈ 36 ms of inference latency, which alone moves most of
  them past the expected point. The six vetoes plus the 128 ms bound remove
  the rest while keeping every final matched.
- Smart Turn does **not** suppress the five mid-recording pause commits at
  the 650 ms window (it accepts them). Upstream pipecat defaults to a 3,000 ms
  stop window; this product commits at 650 ms, where the model's
  discrimination is weaker. The bounded veto must therefore be understood as
  a latency/early-commit refinement, not as a mid-pause filter, at this
  commitment point.
- Candidate B, the literal upstream policy, fails the benchmark (72/81 < 76)
  and must not ship alone.
- The 128 ms cap was chosen against this corpus (trigger offsets reach
  +100 ms against expected endpoints). It is overfit by construction and
  needs validation on unseen audio before any product adoption.
- The corpus is TTS-generated with synthetic noise/overlap; physical
  microphones, reverb, far-field speech, and real conversations are untested.

## Decision

Among the measured candidates, **C (Smart Turn gated with a bounded 128 ms
deterministic fallback)** is the only Smart Turn policy that stays inside
every committed budget while strictly improving forbidden (13 vs 24) and
early (3 vs 14) emissions at equal matched finals (78/81). Per the campaign
brief's candidate order, deterministic endpointing remains the primary
fallback, with Smart Turn policy C as the gated enhancement for the
`TurnDetectorProvider` integration.

## Findings and remaining gates

- Registry entry `smart-turn-v3.2-cpu-onnx` is pinned (revision, SHA-256,
  licence, runtime) and passes `scripts/voice/model-registry-validator.mjs`.
- Not measured: Android runtime, Mi 10 Pro latency/memory/thermal/battery,
  sustained-session behavior, physical barge-in with real microphones,
  offline model installation, and validation of the 128 ms cap on unseen
  audio. The upstream ONNX probability parity check against the reference
  implementation is still open.
- This result is not a G9/G12/G13 or GO PROD pass; the final campaign verdict
  remains `IMPLEMENTATION COMPLETE / PRODUCTION QUALIFICATION BLOCKED` until
  the physical gates run.
