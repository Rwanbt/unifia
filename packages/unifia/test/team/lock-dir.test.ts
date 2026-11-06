/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { resolveLocksDir } from "../../src/team/lock-manager";

describe("resolveLocksDir", () => {
  const base = { env: undefined, dataDir: "/data/unifia", exists: () => false };
  test("TEAM_LOCKS_DIR wins", () => {
    expect(resolveLocksDir({ ...base, env: "/tmp/locks", platform: "linux" })).toBe("/tmp/locks");
  });
  test("Linux and Android default to the app data directory, never a relative D: path", () => {
    expect(resolveLocksDir({ ...base, platform: "linux" })).toBe(join("/data/unifia", "team", "locks"));
    expect(resolveLocksDir({ ...base, platform: "android", exists: () => true })).toBe(join("/data/unifia", "team", "locks"));
  });
  test("Windows keeps the existing Obsidian vault folder when it exists", () => {
    expect(resolveLocksDir({ ...base, platform: "win32", exists: () => true })).toContain("Obsidian");
    expect(resolveLocksDir({ ...base, platform: "win32" })).toBe(join("/data/unifia", "team", "locks"));
  });
});
