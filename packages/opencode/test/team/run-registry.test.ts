import { describe, expect, test } from "bun:test"
import { TeamRunRegistry } from "../../src/team/run-registry"

describe("TeamRunRegistry", () => {
  test("pauses at a cooperative boundary and resumes", async () => {
    const control = TeamRunRegistry.register("run-pause")
    expect(TeamRunRegistry.pause("run-pause")).toBe(true)
    let released = false
    const waiting = control.waitUntilRunnable().then(() => { released = true })
    await Promise.resolve()
    expect(released).toBe(false)
    expect(TeamRunRegistry.resume("run-pause")).toBe(true)
    await waiting
    expect(released).toBe(true)
    TeamRunRegistry.finish("run-pause")
  })

  test("propagates parent cancellation", () => {
    const parent = new AbortController()
    const control = TeamRunRegistry.register("run-cancel", parent.signal)
    parent.abort()
    expect(control.signal.aborted).toBe(true)
    expect(TeamRunRegistry.status("run-cancel")).toBe("cancelled")
    TeamRunRegistry.finish("run-cancel", parent.signal)
  })

  test("refuses duplicate active run IDs", () => {
    TeamRunRegistry.register("run-duplicate")
    expect(() => TeamRunRegistry.register("run-duplicate")).toThrow("already active")
    TeamRunRegistry.finish("run-duplicate")
  })
})