# Piper Host

This package runs Piper TTS as a separate supervised GPL-3.0-or-later process.
It is not linked into Unifia's Rust or TypeScript core. Unifia owns provider
selection, requests, sessions, permissions, cancellation, and fallback policy.

The host is CPU-only. Voice artifacts are fetched only when selected, from a
fixed Hugging Face repository commit, and installed after size and SHA-256
verification using an atomic rename. The catalog records each dataset license
and source; the Italian M-AILABS voice additionally requires attribution and
prohibits endorsement. Voice assets are not bundled with the application.

Run the worker with `python -m piper_host.worker`. Its stdin/stdout JSONL
protocol is private to the supervising desktop runtime; diagnostics go to
stderr. Python 3.12 and the locked `piper-tts==1.8.0` dependency are isolated
from the Pocket Voice Host environment.
