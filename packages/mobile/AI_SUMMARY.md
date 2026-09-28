# AI_SUMMARY — mobile

> **Auto-generated 2026-09-27 11:19** — do not edit manually.
> Source: `tools/ai_docs/generate_ai_summary.py`
> For purpose, thread model and constraints, read `AI_CONTEXT.md`.

## Purpose
Couche mobile Android : frontend TypeScript mobile-spécifique (11 fichiers TS)
+ sidecar Rust Tauri (`src-tauri/src/`) gérant le proxy HTTP, le runtime Alpine/busybox,
l'inférence locale (llama-server via LlamaService.kt JNI), et la synthèse vocale.
LlamaService.kt (dans gen/android/) est un foreground service Kotlin qui possède llama-server.

## Files & LOC
| File | LOC | |
|------|-----|--|
| `happydom.ts` | 2 | |
| `vite.config.ts` | 26 | |
| **Total** | **28** | |
