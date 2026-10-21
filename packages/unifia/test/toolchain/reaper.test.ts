// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

/**
 * Tests for src/toolchain/reaper.ts. The processes are real sleep commands. The reaper acts only on a
 * process whose UNIFIA_OWNER marker names an owner that is gone, and it checks the start time of the
 * target before signalling it, so a reused pid is never touched.
 */
import { expect, test } from "bun:test"
import { ownerMarker, running } from "../../src/toolchain/proc"
import { reap } from "../../src/toolchain/reaper"

// A pid whose process has finished, so no live process owns it.
async function finishedPid() {
  const proc = Bun.spawn(["true"])
  await proc.exited
  return proc.pid
}

function sleeper(marker?: string) {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) }
  delete env.UNIFIA_OWNER
  if (marker !== undefined) env.UNIFIA_OWNER = marker
  return Bun.spawn(["sleep", "60"], { env })
}

test("kills a process whose owner has finished", async () => {
  const child = sleeper(`${await finishedPid()}:1`)
  expect(await reap()).toContain(child.pid)
  await child.exited
  expect(running(child.pid)).toBe(false)
})

test("kills a process whose owner pid was reused by a different process", async () => {
  // This test process is alive, but it started at a different time than the marker records.
  const child = sleeper(`${process.pid}:1`)
  expect(await reap()).toContain(child.pid)
  await child.exited
})

test("spares a process whose owner is still alive", async () => {
  const child = sleeper(await ownerMarker())
  const killed = await reap()
  expect(killed).not.toContain(child.pid)
  expect(running(child.pid)).toBe(true)
  child.kill()
  await child.exited
})

test("spares a process that carries no marker", async () => {
  const child = sleeper()
  expect(await reap()).not.toContain(child.pid)
  expect(running(child.pid)).toBe(true)
  child.kill()
  await child.exited
})

test("never acts on a malformed marker", async () => {
  const child = sleeper("not-a-marker")
  expect(await reap()).not.toContain(child.pid)
  expect(running(child.pid)).toBe(true)
  child.kill()
  await child.exited
})
