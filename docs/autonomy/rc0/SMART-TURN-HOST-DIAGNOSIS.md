<!-- SPDX-License-Identifier: MIT -->
# Smart Turn host parity: measured limits

Date: 2026-10-01. Issue #117; PR #162 merged to dev at
`1dc5b0dcabaf0b210b8dca18e5523695936f0b58` after required and Voice checks passed.

## Input boundary

The reference caller front-pads short segments; the prior right-padding patch
was withdrawn. The divergent de-incompl-01 window contains 80,896 samples.
Its PCM hash is `3073131da234a332db852789373080f66c15d53048c19cbc0a0d63741912708c`;
features are `4d647f6a43db23cafa291163b0363c54f0a500b7b50777fa75b0c4a6a5a741c4`.
Both hashes match across Windows Rust, Linux Rust and pinned Python.
Model hash remains `2bb026316b14a660486a75b1733cd3fbab8c2fd0314dc9af7be49f8cca967e4f`.
Padding, frontend, artifact and tolerance changes are not justified by this data.

## Controlled measurements

| Command/runtime | Host | Result |
| --- | --- | --- |
| Pinned Python ORT 1.28.0/numpy 2.5.3, precision 0 | Windows Intel/VNNI | 0.8732463121 |
| Same Python, precision 1 | Windows Intel/VNNI | 0.8732463121 |
| Same Python, precision 0 | Linux AMD EPYC 7763/AVX2, no VNNI | 0.8228970766 |
| Same Python, precision 1 | Same Linux CPU | 0.8732463121 |
| Rust default, full corpus | Same Linux CPU | many parity differences, 86 passed/1 failed/2 ignored |
| Rust precise QMM, full corpus | Same Linux CPU | one difference remains: 0.9042244 vs 0.873246 |
| Rust precise QMM, isolated corpus test | Same Linux CPU | same residual, 0 passed/1 failed/88 filtered, 65.91s |
| Rust precise QMM, full host suite | Windows | 57 passed/0 failed/2 ignored, 37.81s |

The precision option addresses AVX2 quantized saturation; isolated execution
does not remove the residual. Actual builds differ despite matching versions:
Python reports commit `45de2a8b06`; Rust reports `da9b5e3` (rel-1.28.0).
The initial build-drift hypothesis was subsequently verified by option 1 below:
relinking the same Rust gate to the exact Python wheel C library removes the
residual without changing inputs, model, precision, fixtures or tolerance.

## Evidence and failures

- Diagnostic default: GitHub run 36849906773, job 110328827924.
- Partial correction: run 36850737217, job 110331504147.
- Isolated gate: run 36851912823, job 110335306033.
- Run 36851547086 stopped before Rust: our diagnostic inspected `target`
  before compilation on a runner without a restored directory. This is a
  diagnostic regression, fixed by inspecting after compilation at `ed39a52175`.
- Windows logs: rc0-agent/.build-temp/rc0-smart-turn-precise-20261001.log,
  rc0-mobile-full-host-20261001.log and rc0-smart-turn-clippy-20261001.log.
- `cargo clippy --lib --no-deps -- -D warnings`: PASS. Runtime thresholds,
  fixtures and reference probabilities have never been loosened.

## Recovery options after unsuccessful correction/isolated validation

1. Compare Rust against the exact official Python wheel C library in an
   isolated diagnostic build; record binary hashes, ABI and probabilities.
   A positive result would justify a reproducible runtime-distribution pin.
2. Feed identical saved features to a small C API witness and both binaries,
   with repeat/session-history cases, to separate wrapper and backend effects.
3. Compare optimized graphs and node outputs at the first divergent operator
   before considering an optimization-specific workaround or upstream report.

## Option 1 result and correction

Controlled run 36853737588, job 110341189986: static rel-1.28.0/da9b5e3
failed (0 passed/1 failed, 66.20s). The diagnostic relink against the official
wheel HEAD/45de2a8b06 passed (1 passed/88 filtered, 63.35s). Its C library hash
was verified: `aa4079d18f4ea7a5f3a94d80cd4bbe0f2740436626622d64d793803a20381083`.
The primary job remained failed; the diagnostic did not mask the baseline.
This proves runtime-build-dependent behavior, not which operator caused it.

Commit `c0464d926881fba5f362279492c5a93957b02911` adds a reusable Linux
mobile-host Cargo launcher with hash validation, retained library and explicit
link/execution environment. It runs the same compiled native consumer; it
does not substitute Python inference for Rust. ADR-088 contains local
`test --lib` and `build --release` reproduction commands.

Correction run 36855084952, job 110345555331:

- Launcher integrity/failure/lifetime tests: 5 passed (0.004s).
- Native Rust corpus: 1 passed/88 filtered, 63.63s, unchanged budgets/parity.
- Full Linux host suite: 87 passed/0 failed/2 ignored, 71.38s.
- Android cross-compile: PASS (job 110345555575).
- Local Windows: launcher tests 4 passed/1 Linux-only skip; sandbox fixture
  writes failed, identical escalated command passed. Pinned downloaded Linux
  library hash also verified locally. Hooks and Turbo typecheck 47/47 PASS.

The seven required contexts, CodeQL/Analyze and all Voice jobs passed at
`c0464d926881fba5f362279492c5a93957b02911`; Windows unit took 23m4s, Linux
unit 9m30s and voice-host Python 1m3s. Windows host proof is not Android
runtime proof: Android keeps the official 1.23.0 AAR/API23. Physical latency,
five-language voice and device qualification remain owner-only.
