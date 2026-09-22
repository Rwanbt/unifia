# AI_SUMMARY — desktop

> **Auto-generated 2026-09-17 10:46** — do not edit manually.
> Source: `tools/ai_docs/generate_ai_summary.py`
> For purpose, thread model and constraints, read `AI_CONTEXT.md`.

## Purpose
Application desktop Tauri 2.0 : backend Rust (`src-tauri/src/`) gérant le TLS,
la synthèse/reconnaissance vocale (Kokoro TTS, Parakeet STT), l'orchestration LLM local
(llama-server subprocess), et la personnalisation de la fenêtre (titlebar décorum).
Le frontend SolidJS est servi depuis `packages/app`.

## Files & LOC
| File | LOC | |
|------|-----|--|
| `sst-env.d.ts` | 2 | |
| `unifia-env.d.ts` | 6 | |
| `vite.config.ts` | 26 | |
| **Total** | **34** | |
