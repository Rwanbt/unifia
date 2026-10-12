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
as a cause of host drift. It does not explain every Rust/Python difference.

Follow-up run 36850737217 reduced Rust parity failures to one: de-incompl-01
still returned 0.9042244 versus 0.873246, with identical feature hashes.
Windows full host suite passed (57 passed, two ignored, 37.81 seconds) and
Clippy passed. Linux full-corpus qualification remains blocked; compare an
isolated Rust gate with the full suite and inspect actual runtime binaries.

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

## Runtime build qualification

Controlled run [36853737588](https://github.com/Rwanbt/unifia/actions/runs/36853737588)
failed with Pyke's statically linked rel-1.28.0/da9b5e3 build (0 passed, one
failed, 66.20 seconds). Relinking the same Rust gate against the official Python
wheel's C library (HEAD/45de2a8b06) passed (one passed, 63.35 seconds). Inputs,
model, session precision and tolerance were unchanged. This establishes a
runtime-build-dependent residual; the individual divergent operator is unknown.

The Linux x86_64 mobile host build now uses `scripts/voice/mobile_host_cargo.py`
to validate the wheel library SHA-256
`aa4079d18f4ea7a5f3a94d80cd4bbe0f2740436626622d64d793803a20381083`, retain it
beside Cargo outputs and select dynamic linking for both build and execution.
An unexpected artifact fails before Cargo runs. Reproduce from the repository:

```sh
python3 -m venv .build-temp/smart-turn-host
.build-temp/smart-turn-host/bin/pip install numpy==2.5.3 onnxruntime==1.28.0
.build-temp/smart-turn-host/bin/python scripts/voice/mobile_host_cargo.py test --lib
# Use the same launcher with build --release for a Linux mobile host binary.
```

This is the mobile crate's Linux host path, not the desktop Parakeet crate's
separate optional ORT dependency. Windows retains its measured host runtime.
The shipped Android AAR remains 1.23.0 with C API 23; host corpus success does
not qualify that runtime or a physical device. The full Linux suite must also
pass before this lot is accepted.
