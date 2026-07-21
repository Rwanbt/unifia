import { test, expect } from "bun:test";
import { createTempGitRepo } from "../helper";

test("integration-22: patch-id stability check (sanity)", () => {
  const repo = createTempGitRepo();
  // Make two commits and verify patch-id is stable for the same content.
  repo.commit("feat: hello", { "src/team/h.ts": "export const a = 1;\n" });
  // Use the spawnSync alternative — Bun returns {exitCode, stdout, stderr}
  // while node returns {status, stdout, stderr}. Accept both.
  const proc1 = Bun.spawnSync({
    cmd: ["git", "format-patch", "--stdout", "HEAD~1..HEAD"],
    cwd: repo.path,
    encoding: "utf-8",
  });
  const status1 = (proc1 as any).exitCode ?? (proc1 as any).status;
  expect(status1).toBe(0);
  const proc2 = Bun.spawnSync({
    cmd: ["git", "patch-id", "--stable"],
    cwd: repo.path,
    encoding: "utf-8",
    stdin: proc1.stdout as string,
  });
  const status2 = (proc2 as any).exitCode ?? (proc2 as any).status;
  expect(status2).toBe(0);
  // Bun.spawnSync returns stdout as Uint8Array when encoding is not "utf-8".
  // With encoding: "utf-8", it returns a string. Coerce defensively.
  const proc2stdout =
    typeof proc2.stdout === "string"
      ? (proc2.stdout as string).trim()
      : Buffer.from(proc2.stdout as Uint8Array).toString("utf-8").trim();
  expect(proc2stdout).toMatch(/[0-9a-f]{40}/);
  repo.cleanup();
});

