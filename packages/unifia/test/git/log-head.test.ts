/* SPDX-License-Identifier: MIT */

import { $ } from "bun"
import { describe, expect, test } from "bun:test"
import { ManagedRuntime } from "effect"
import { Git } from "../../src/git"
import { tmpdir } from "../fixture/fixture"

async function readLog(directory: string, limit = 1) {
  const runtime = ManagedRuntime.make(Git.defaultLayer)
  try {
    return await runtime.runPromise(Git.Service.use((git) => git.log(directory, limit)))
  } finally {
    await runtime.dispose()
  }
}

describe("GitLog_Head_Integration", () => {
  test("CommittedRepository_ReturnsHeadCommit", async () => {
    await using temporary = await tmpdir({ git: true })
    const expected = (await $`git rev-parse HEAD`.cwd(temporary.path).quiet().text()).trim()
    const entries = await readLog(temporary.path)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.hash).toBe(expected)
    expect(entries[0]?.author).toBe("Test")
  })

  test("MultipleCommits_PreservesExactHashesAndLimit", async () => {
    await using temporary = await tmpdir({ git: true })
    const first = (await $`git rev-parse HEAD`.cwd(temporary.path).quiet().text()).trim()
    await $`git commit --allow-empty -m second`.cwd(temporary.path).quiet()
    const second = (await $`git rev-parse HEAD`.cwd(temporary.path).quiet().text()).trim()
    expect((await readLog(temporary.path, 2)).map((entry) => entry.hash)).toEqual([second, first])
    expect(await readLog(temporary.path)).toHaveLength(1)
  })

  test("UnbornRepository_ReturnsNoCommits", async () => {
    await using temporary = await tmpdir()
    await $`git init`.cwd(temporary.path).quiet()
    expect(await readLog(temporary.path)).toEqual([])
  })

  test("DetachedHead_ReturnsHeadCommit", async () => {
    await using temporary = await tmpdir({ git: true })
    const expected = (await $`git rev-parse HEAD`.cwd(temporary.path).quiet().text()).trim()
    await $`git checkout --detach ${expected}`.cwd(temporary.path).quiet()
    expect((await readLog(temporary.path))[0]?.hash).toBe(expected)
  })
})
