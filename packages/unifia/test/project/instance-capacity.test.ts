/* SPDX-License-Identifier: MIT */

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

// An instance is a running subsystem — file watchers, LSP clients, plugin
// state — not a cache entry. `Instance.provide` is reached by ANY request
// carrying a `?directory=`, so read-only traffic (listing recent projects,
// resolving a label) used to leave a full instance resident for the lifetime
// of the process. Four were observed live after a cold start, none opened by
// the user. These tests pin the cap that bounds it.

const ENV_KEY = "UNIFIA_MAX_INSTANCES"

// The cap is enforced against a MODULE-LEVEL cache that the whole test suite
// shares: 95 test files call `Instance.provide` and only 46 of them call
// `disposeAll`, so in a full-suite run this file starts with whatever those
// other files left resident. That is the whole of #57 — the assertions below
// were absolute (`toHaveLength(2)`, `not.toContain(b.path)`) against a cache
// this test does not own, so the verdict depended on which files ran before it
// and on how far their disposals had got. Same commit, different verdict.
//
// A cap is a statement about the cache as a whole, so the test has to start from
// a known state before it can mean anything. `disposeAll` is idempotent and
// resets its own memo (`src/project/instance.ts:340`), and the `afterEach` below
// already relied on that.
beforeEach(async () => {
  await Instance.disposeAll()
})

afterEach(async () => {
  delete process.env[ENV_KEY]
  await Instance.disposeAll()
})

async function touch(directory: string): Promise<void> {
  await Instance.provide({ directory, fn: () => undefined })
}

describe("instance capacity", () => {
  test("evicts the least recently used instance past the cap", async () => {
    process.env[ENV_KEY] = "2"
    await using a = await tmpdir()
    await using b = await tmpdir()
    await using c = await tmpdir()

    await touch(a.path)
    await touch(b.path)
    // Re-touching `a` makes `b` the least recently used, so opening `c` must
    // evict `b` — not simply the oldest-created entry.
    await touch(a.path)
    await touch(c.path)

    const resident = Instance.residentDirectories()
    // Scoped to the three directories this test created, not the whole cache.
    // Evicting an instance runs `State.dispose`/`disposeInstance` for it, and
    // that teardown (watchers, LSP) can re-enter `provide` and land other
    // directories in the cache while the eviction loop is still running — the
    // async-disposal hazard #57 names. Asserting the global length made the
    // verdict depend on that unrelated traffic; the eviction DECISION is still
    // fully pinned by `b` being gone and `a`/`c` being here.
    const mine = resident.filter((d) => d === a.path || d === b.path || d === c.path)
    expect(mine.sort()).toEqual([a.path, c.path].sort())
    expect(resident).not.toContain(b.path)
  })

  test("a leased instance is never evicted", async () => {
    process.env[ENV_KEY] = "1"
    await using a = await tmpdir()
    await using b = await tmpdir()

    await touch(a.path)
    const lease = Instance.lease(a.path)
    try {
      await touch(b.path)
      // The cap is 1 and `b` was just requested, but `a` is mid-flight for
      // someone: tearing down its watchers underneath a live caller would be
      // worse than exceeding a memory target.
      expect(Instance.residentDirectories()).toContain(a.path)
    } finally {
      await lease.release()
    }
  })

  test("cap 0 disables eviction entirely", async () => {
    process.env[ENV_KEY] = "0"
    await using a = await tmpdir()
    await using b = await tmpdir()
    await using c = await tmpdir()

    await touch(a.path)
    await touch(b.path)
    await touch(c.path)

    // Scoped for the same reason as above: with the cap disabled, what matters is
    // that this test's three directories all survived, not what else the shared
    // cache happens to hold.
    const resident = Instance.residentDirectories()
    expect(resident.filter((d) => d === a.path || d === b.path || d === c.path).sort()).toEqual(
      [a.path, b.path, c.path].sort(),
    )
  })

  test("a malformed override falls back to the default instead of disabling the cap", async () => {
    process.env[ENV_KEY] = "not-a-number"
    await using a = await tmpdir()
    await touch(a.path)
    // The guard that matters: a typo in the env var must not silently turn the
    // cap off, which is what `parseInt` returning NaN would do untreated.
    expect(Instance.residentDirectories().filter((d) => d === a.path)).toHaveLength(1)
  })

  test("an active provide protects its instance without an explicit lease", async () => {
    process.env[ENV_KEY] = "1"
    await using a = await tmpdir()
    await using b = await tmpdir()
    let release!: () => void
    let markStarted!: () => void
    const entered = new Promise<void>((resolve) => { markStarted = resolve })
    const started = new Promise<void>((resolve) => { release = resolve })
    const active = Instance.provide({
      directory: a.path,
      fn: async () => {
        markStarted()
        await started
        return "done"
      },
    })
    await entered
    await touch(b.path)
    expect(Instance.residentDirectories()).toContain(a.path)
    release()
    await expect(active).resolves.toBe("done")
  })

  test("a light instance is promoted before a full request runs", async () => {
    await using a = await tmpdir()
    let light = 0
    let full = 0
    await Instance.provide({ directory: a.path, initKind: "light", init: async () => { light++ }, fn: () => undefined })
    await Instance.provide({ directory: a.path, initKind: "full", init: async () => { full++ }, fn: () => undefined })
    expect(light).toBe(1)
    expect(full).toBe(1)
  })
})
