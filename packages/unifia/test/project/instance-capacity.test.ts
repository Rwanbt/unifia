/* SPDX-License-Identifier: MIT */

import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

// An instance is a running subsystem — file watchers, LSP clients, plugin
// state — not a cache entry. `Instance.provide` is reached by ANY request
// carrying a `?directory=`, so read-only traffic (listing recent projects,
// resolving a label) used to leave a full instance resident for the lifetime
// of the process. Four were observed live after a cold start, none opened by
// the user. These tests pin the cap that bounds it.

const ENV_KEY = "UNIFIA_MAX_INSTANCES"

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
    expect(resident).toHaveLength(2)
    expect(resident).toContain(c.path)
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

    expect(Instance.residentDirectories()).toHaveLength(3)
  })

  test("a malformed override falls back to the default instead of disabling the cap", async () => {
    process.env[ENV_KEY] = "not-a-number"
    await using a = await tmpdir()
    await touch(a.path)
    // The guard that matters: a typo in the env var must not silently turn the
    // cap off, which is what `parseInt` returning NaN would do untreated.
    expect(Instance.residentDirectories()).toHaveLength(1)
  })
})
