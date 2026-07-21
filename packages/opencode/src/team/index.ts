/**
 * index.ts — TEAM-G01
 *
 * Public entry point for the team lock manager package. Re-exports the
 * runtime API used by tests, CLI, and downstream workers.
 */

export * from "./lock-manager";
export * from "./fencing";
export * from "./scope-monitor";
// team-cli is intentionally NOT re-exported here because it calls process.exit.
