<!-- SPDX-License-Identifier: MIT -->
# ADR-088: Smart Turn quantized CPU precision

**Date**: 2026-10-01 | **Status**: Accepted

## Context

Smart Turn's pinned int8 model diverged between Windows and Linux despite
identical PCM, feature and model hashes. Changing padding was disproved:
the reference caller and production both front-pad short segments.

Run [36849906773](https://github.com/Rwanbt/unifia/actions/runs/36849906773)
measured an AMD EPYC 7763 with AVX2 and no VNNI, ORT 1.28.0 and numpy 2.5.3.
For de-incompl-01 (80,896 samples), default precision returned 0.8228970766;
`session.x64quantprecision=1` returned 0.8732463121, matching Windows/reference.
The Rust default returned 0.8228971 and failed the unchanged corpus gate.
Both Rust builds report ORT rel-1.28.0, commit da9b5e3.

ONNX documents [U8S8 saturation and the U8U8 precision option](https://github.com/microsoft/onnxruntime/blob/main/include/onnxruntime/core/session/onnxruntime_session_options_config_keys.h).
The controlled session-option comparison identifies this CPU kernel difference
as the cause of the measured window mismatch. Full-corpus CI remains required.

## Decision

Configure `SmartTurn::load` with `SessionBuilder::with_precise_qmm`, which sets
`session.x64quantprecision=1`. Keep the pinned artifact, frontend, threading,
accept threshold, reference probabilities and gate budgets unchanged.
Reject session-configuration failures through the existing error return.

The Linux workflow records CPU metadata and compares both Python modes;
Rust tests record their actual ONNX build. These diagnostics remain available
to distinguish input drift from runtime drift on future runners.

## Rejected alternatives

- Right-padding: contradicts the pinned caller and breaks the input contract.
- Increasing tolerance or refreshing reference outputs: conceals CPU drift.
- Replacing/requantizing the model: unnecessary artifact change before proving
  the supported runtime option.

## Consequences

AVX2 CPUs without VNNI may use slower U8U8 multiplication. Windows VNNI probe
outputs were identical in both modes. Android cross-compilation and Linux
corpus CI must pass; physical latency/voice qualification stays with the owner.
No physical-device performance claim follows from these host measurements.
