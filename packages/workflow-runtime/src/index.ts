/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * `@unifia/workflow-runtime` — durable workflow runtime types and
 * implementations.
 *
 * M1-09 (YELLOW interface in the plan) is now DECIDED with the
 * in-memory implementation. The interface remains in `adapter.ts`;
 * the implementation is in `in-memory.ts`. Both are exported from
 * this barrel.
 */
export * from "./adapter.ts"
export * from "./in-memory.ts"
