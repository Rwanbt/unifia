import { test, expect, describe, beforeEach } from "bun:test";
import { getDbInMemory } from "../../src/team/lock-manager";
import { claim, heartbeat, release } from "../../src/team/lock-manager";
import { newLease } from "./helper";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Each test gets its own lock-dir, so DBs don't leak between tests.
let testLocksDir = "";
beforeEach(() => {
  testLocksDir = mkdtempSync(join(tmpdir(), "team-cli-locks-"));
});

describe("team-cli claim subcommand", () => {
  test("CLI exits 0 on success", () => {
    const spec = newLease({ branch: "c-cli/ok" });
    const code = runCli(["claim",
      "--lease-id", spec.lease_id,
      "--card", spec.card_id,
      "--worker", spec.worker_id,
      "--branch", spec.branch,
      "--worktree", spec.worktree,
      "--base", spec.base_sha,
      "--manifest-hash", spec.scope_manifest_hash,
      "--allowed-files", spec.allowed_files.join(","),
      "--protected-files", spec.protected_files.join(","),
      "--scope-mode", "OPEN",
    ]);
    expect(code).toBe(0);
  });

  test("CLI exits 1 on double-claim", () => {
    const spec = newLease({ branch: "c-cli/double" });
    const code1 = runCli(["claim",
      "--lease-id", spec.lease_id,
      "--card", spec.card_id,
      "--worker", spec.worker_id,
      "--branch", spec.branch,
      "--worktree", spec.worktree,
      "--base", spec.base_sha,
      "--manifest-hash", spec.scope_manifest_hash,
      "--allowed-files", spec.allowed_files.join(","),
      "--protected-files", spec.protected_files.join(","),
      "--scope-mode", "OPEN",
    ]);
    expect(code1).toBe(0);
    const code2 = runCli(["claim",
      "--lease-id", "LEASE-other",
      "--card", spec.card_id,
      "--worker", "worker-other",
      "--branch", spec.branch,
      "--worktree", "D:/wt/other",
      "--base", spec.base_sha,
      "--manifest-hash", spec.scope_manifest_hash,
      "--allowed-files", "src/",
      "--protected-files", "",
      "--scope-mode", "OPEN",
    ]);
    expect(code2).toBeGreaterThan(0);
  });

  test("CLI exits 64 on missing required flag", () => {
    const code = runCli(["claim", "--card", "TEAM-X", "--worker", "W"]);
    expect(code).toBe(64);
  });
});

describe("team-cli heartbeat subcommand", () => {
  test("exit 0 for owner", () => {
    const spec = newLease({ branch: "c-cli/hb-ok" });
    runCli(["claim",
      "--lease-id", spec.lease_id,
      "--card", spec.card_id,
      "--worker", spec.worker_id,
      "--branch", spec.branch,
      "--worktree", spec.worktree,
      "--base", spec.base_sha,
      "--manifest-hash", spec.scope_manifest_hash,
      "--allowed-files", spec.allowed_files.join(","),
      "--protected-files", spec.protected_files.join(","),
      "--scope-mode", "OPEN",
    ]);
    const code = runCli(["heartbeat", "--lease-id", spec.lease_id, "--worker", spec.worker_id]);
    expect(code).toBe(0);
  });
  test("exit 1 for non-owner", () => {
    const spec = newLease({ branch: "c-cli/hb-bad" });
    runCli(["claim",
      "--lease-id", spec.lease_id,
      "--card", spec.card_id,
      "--worker", spec.worker_id,
      "--branch", spec.branch,
      "--worktree", spec.worktree,
      "--base", spec.base_sha,
      "--manifest-hash", spec.scope_manifest_hash,
      "--allowed-files", spec.allowed_files.join(","),
      "--protected-files", spec.protected_files.join(","),
      "--scope-mode", "OPEN",
    ]);
    const code = runCli(["heartbeat", "--lease-id", spec.lease_id, "--worker", "intruder"]);
    expect(code).toBeGreaterThan(0);
  });
});

describe("team-cli validate subcommand", () => {
  test("exit 0 with correct token", () => {
    const claimRes = runCli(["claim",
      "--lease-id", "LEASE-cli-v-ok",
      "--card", "TEAM-G01",
      "--worker", "worker-A",
      "--branch", "c-cli/v-ok",
      "--worktree", "D:/wt/ok",
      "--base", "0".repeat(40),
      "--manifest-hash", "h".repeat(64),
      "--allowed-files", "src/",
      "--protected-files", "",
      "--scope-mode", "OPEN",
    ]);
    expect(claimRes).toBe(0);
    const code = runCli(["validate", "--lease-id", "LEASE-cli-v-ok", "--fencing-token", "1"]);
    expect(code).toBe(0);
  });
  test("exit 1 with stale token", () => {
    const claimRes = runCli(["claim",
      "--lease-id", "LEASE-cli-v-stale",
      "--card", "TEAM-G01",
      "--worker", "worker-A",
      "--branch", "c-cli/v-stale",
      "--worktree", "D:/wt/stale",
      "--base", "0".repeat(40),
      "--manifest-hash", "h".repeat(64),
      "--allowed-files", "src/",
      "--protected-files", "",
      "--scope-mode", "OPEN",
    ]);
    expect(claimRes).toBe(0);
    const code = runCli(["validate", "--lease-id", "LEASE-cli-v-stale", "--fencing-token", "99999"]);
    expect(code).toBeGreaterThan(0);
  });
});

describe("team-cli release subcommand", () => {
  test("exit 0 for owner", () => {
    const claimRes = runCli(["claim",
      "--lease-id", "LEASE-cli-rel",
      "--card", "TEAM-G01",
      "--worker", "worker-A",
      "--branch", "c-cli/rel",
      "--worktree", "D:/wt/rel",
      "--base", "0".repeat(40),
      "--manifest-hash", "h".repeat(64),
      "--allowed-files", "src/",
      "--protected-files", "",
      "--scope-mode", "OPEN",
    ]);
    expect(claimRes).toBe(0);
    const code = runCli(["release", "--lease-id", "LEASE-cli-rel", "--worker", "worker-A"]);
    expect(code).toBe(0);
  });
});

function runCli(args: string[]): number {
  const proc = spawnSync("bun", ["run", "packages/opencode/src/team/team-cli.ts", ...args], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    cwd: "D:/App/OpenCode/.team-worktrees/G01-bbf637be",
    env: { ...process.env, TEAM_LOCKS_DIR: testLocksDir },
  });
  return proc.status ?? 1;
}
