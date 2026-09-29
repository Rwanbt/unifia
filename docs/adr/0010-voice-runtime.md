# ADR-0010: Isolated CPU-first voice runtime

**Date**: 2026-09-23 | **Status**: Accepted

## Context

Unifia must provide Pocket TTS without relying on a user's global Python, loading CUDA into the desktop process, or retaining multiple language models at once. Live voice transport and agent execution must remain separate from the speech engine.

## Decision

The voice worker uses managed Python 3.12 through uv and an exact `uv.lock`. Pocket TTS is pinned to 3.1.0, PyTorch resolves only from its CPU wheel index, quantized inference is enabled, and the worker hides CUDA and defaults to two CPU threads. The worker communicates over supervised JSON-lines IPC. It serializes model operations and retains only one language model. Parakeet remains the non-live STT engine. The later LiveKit worker will hand voice turns to the existing Unifia session and will not own tools or permissions.

## Alternatives rejected

- A globally installed `pocket-tts` executable depends on an unmanaged Python environment and can select incompatible or GPU-enabled packages.
- A localhost HTTP TTS server adds a second transport layer for same-machine process communication and complicates lifecycle ownership.
- On-device Android inference makes a community Pocket runtime prerequisite for mobile delivery, contrary to the frozen Voice Host topology.
- Replacing Parakeet would broaden this change and discard the existing supported STT path.

## Consequences

The first installation downloads a managed Python runtime and locked wheels. The Voice Host owns runtime health, warmup, cancellation and model lifecycle. Linux/macOS CPU wheel resolution and runtime packaging still require cross-platform validation before release.
