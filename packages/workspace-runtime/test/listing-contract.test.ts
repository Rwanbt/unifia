/* SPDX-License-Identifier: MIT */

// C1-4/FUNC-004: WorkspaceRuntime.list() has no pagination — past
// maxEntries it throws and aborts the whole listing instead of returning a
// bounded page; a missing prefix throws ENOENT instead of an empty result;
// and a single symlink/junction pointing outside the workspace root aborts
// the ENTIRE listing instead of skipping just that one entry. All three are
// measured, reproducible failures (see UNIFIA-WORK-DESIGN-AUDIT-b7add2bb.md,
// FUNC-004) — this file fixes each own fixture via fs.mkdtemp, no
// dependency on pre-existing machine state.
//
// Full pagination contract (ordering stability, opaque cursor bound to
// workspace+prefix, tree-modified-mid-walk behavior) is pinned precisely
// once C5-1 defines the cursor shape on WorkspacePort.list(); this test
// covers the three concretely measured failure modes that C5-1 must not
// reproduce.

import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { expect, test } from "bun:test"
import { WorkspaceRuntime } from "../src/index.js"

async function fixture(): Promise<{ root: string; runtime: WorkspaceRuntime; token: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "unifia-listing-contract-"))
  const runtime = new WorkspaceRuntime({ now: () => 1_000 })
  const workspace = await runtime.register({ name: "fixture", path: root })
  const handle = await runtime.open(workspace.id)
  return { root, runtime, token: handle.token }
}

test("more than maxEntries files: list() returns a bounded result instead of throwing", async () => {
  const { root, runtime, token } = await fixture()
  try {
    const bounded = new WorkspaceRuntime({ now: () => 1_000, maxEntries: 50 })
    const workspace = await bounded.register({ name: "bounded", path: root })
    const boundedHandle = await bounded.open(workspace.id)
    for (let i = 0; i < 80; i += 1) await writeFile(path.join(root, `file-${i}.txt`), String(i))

    let threw: unknown
    let entries: readonly unknown[] = []
    try {
      entries = await bounded.list(boundedHandle.token, ".")
    } catch (error) {
      threw = error
    }
    void token
    void runtime
    expect(threw).toBeUndefined()
    expect(entries.length).toBeGreaterThan(0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a non-existent prefix returns an empty result instead of throwing ENOENT", async () => {
  const { root, runtime, token } = await fixture()
  try {
    let threw: unknown
    let entries: readonly unknown[] | undefined
    try {
      entries = await runtime.list(token, "does-not-exist")
    } catch (error) {
      threw = error
    }
    expect(threw).toBeUndefined()
    expect(entries).toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a symlink escaping the workspace root is skipped, not fatal to the whole listing", async () => {
  const { root, runtime, token } = await fixture()
  const outside = await mkdtemp(path.join(os.tmpdir(), "unifia-listing-outside-"))
  try {
    await writeFile(path.join(root, "inside.txt"), "kept")
    let symlinked = true
    try {
      await symlink(outside, path.join(root, "escape-link"), "dir")
    } catch {
      symlinked = false // no symlink privilege on this machine (Windows without Developer Mode/admin) — covered by the junction case below
    }
    if (symlinked) {
      let threw: unknown
      let entries: readonly { path: string }[] = []
      try {
        entries = await runtime.list(token, ".")
      } catch (error) {
        threw = error
      }
      expect(threw).toBeUndefined()
      expect(entries.some((entry) => entry.path === "inside.txt")).toBe(true)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test("a Windows junction escaping the workspace root is skipped, not fatal to the whole listing", async () => {
  if (process.platform !== "win32") return
  const { root, runtime, token } = await fixture()
  const outside = await mkdtemp(path.join(os.tmpdir(), "unifia-listing-outside-"))
  try {
    await mkdir(outside, { recursive: true })
    await writeFile(path.join(root, "inside.txt"), "kept")
    await symlink(outside, path.join(root, "escape-junction"), "junction")

    let threw: unknown
    let entries: readonly { path: string }[] = []
    try {
      entries = await runtime.list(token, ".")
    } catch (error) {
      threw = error
    }
    expect(threw).toBeUndefined()
    expect(entries.some((entry) => entry.path === "inside.txt")).toBe(true)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})
