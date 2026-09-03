/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * `@unifia/workflow-runtime` — durable workflow runtime types and
 * implementations.
 *
 * - `adapter.ts` : `DurableHistoryAuthority` interface (substrate-agnostic).
 * - `in-memory.ts` : `InMemoryDurableHistoryAuthority` impl (M1-09).
 * - `file-backed.ts` : `FileBackedDurableHistoryAuthority` impl (M1-10)
 *   — wraps the in-memory impl with JSON snapshot persistence.
 */
export * from "./adapter.ts"
export * from "./in-memory.ts"
export * from "./file-backed.ts"
