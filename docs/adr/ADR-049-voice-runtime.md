# ADR-049: Provider-neutral voice runtime

**Date**: 2026-09-23 | **Status**: Draft

## Context

Voice behavior currently spans app browser events, duplicated desktop/mobile hooks, Tauri commands, and versionless local settings. Desktop and mobile select different TTS engines directly. Live conversation must reuse the existing Unifia session and agent authority, while preserving non-live dictation behavior and local-first privacy.

## Decision

Introduce stable provider-neutral speech contracts and versioned audio settings before replacing runtime paths. Pocket is the primary TTS provider, Piper is the automatic fallback, and Parakeet remains the STT engine. LiveKit may own transport and turn-taking only; Unifia retains session, model, tool, and permission authority. The microphone dictation action continues to insert text without submitting it.

## Alternatives rejected

- Keep provider-specific UI commands: this preserves the current split behavior and makes backend replacement leak into the app.
- Let LiveKit own the assistant session or tools: this conflicts with the existing Unifia runtime authority.
- Replace current voice paths before characterizing them: this risks regressing the non-live dictation contract.

## Consequences

Settings migration and shared contracts become prerequisites for runtime replacement. Kokoro removal is deferred until the new settings and routing gate passes. Live performance and real-device behavior require separate measurements; unit tests alone cannot qualify production.

## Evidence and open gates

- Baseline: [voice runtime baseline](../voice-runtime-baseline.md).
- Architecture is derived from the user-provided `UNIFIA VOICE RUNTIME.md` plan and remains a draft pending implementation evidence.
- Wave A performance baseline remains pending; no GO PROD claim is supported.
