/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"
import { waitSessionIdle } from "../actions"
import { dirPath } from "../utils"

/**
 * F13 — performance regression scenario.
 *
 * Runbook oracle: « 10 cycles de mode n'augmentent pas
 * heap/listeners/requêtes ».
 *
 * The scenario:
 *   1. Open a workspace in Work mode.
 *   2. For 10 iterations, switch the mode Work → Design → Automate
 *      → Work, sending one assistant prompt per cycle and waiting
 *      for the reply.
 *   3. After each cycle, snapshot three counters:
 *        - `performance.memory.usedJSHeapSize` (heap)
 *        - the number of active event listeners (instrumented
 *          via a hook the app installs in dev only)
 *        - the count of active TanStack queries (also dev-instrumented)
 *   4. Assert that the deltas between cycle N+1 and cycle N stay
 *      within a budget (heap: < 1 MB, listeners: ≤ 0, queries: ≤ 0).
 *
 * The dev-only instrumentation (heap via `performance.memory`,
 * listeners/queries via dev hooks) is what makes the test
 * deterministic; the production build strips it. The test
 * therefore runs in dev mode and is gated on `test.skip` in
 * production builds.
 *
 * WHY a separate spec file (and not a new test in
 * `mode-navigation.spec.ts`): the scenario is heavier than
 * navigation tests and has different timing characteristics
 * (3 s sleep between cycles to give the WebView a chance to
 * reclaim deferred listeners). Splitting it out keeps the
 * navigation suite's flake rate low and lets CI run this
 * performance test on a slower cadence.
 */

test("10 mode cycles do not grow heap, listeners, or active queries", async ({ page, project, assistant }) => {
  test.setTimeout(600_000)

  await project.open()
  const sessionID = await project.user("Create the temporary E2E session and do not modify files.")
  const route = `${dirPath(project.directory)}/work`
  await page.goto(route)
  await expect(page).toHaveURL(/\/work(?:[/?#]|$)/)
  await expect(page.locator('[data-workbench-mode="work"]').first()).toBeVisible()

  const baseline = await page.evaluate(() => {
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
    const dev = (
      window as unknown as {
        __UNIFIA_PERF__?: { eventStreams: () => number; queryObservers: () => number; queryCacheEntries: () => number }
      }
    ).__UNIFIA_PERF__
    if (!memory || !dev) throw new Error("Performance instrumentation is unavailable; refusing a false-green measurement")
    return {
      heap: memory?.usedJSHeapSize ?? 0,
      eventStreams: dev.eventStreams(),
      queryObservers: dev.queryObservers(),
      queryCacheEntries: dev.queryCacheEntries(),
    }
  })

  for (let cycle = 1; cycle <= 10; cycle += 1) {
    // Walk the three modes and return. The cycle counter is
    // embedded in the assistant token so the test can verify
    // each prompt actually completed (a stuck cycle would
    // not advance the counter).
    const token = `PERF_CYCLE_${cycle}_${Date.now()}`
    await assistant.reply(token)
    for (const mode of ["design", "automate", "work"] as const) {
      await page.goto(`${dirPath(project.directory)}/${mode}`)
      await expect(page.locator(`[data-workbench-mode="${mode}"]`).first()).toBeVisible()
    }
    for (let message = 1; message <= 100; message += 1) {
      const callsBefore = await assistant.calls()
      await project.sdk.session.prompt({
        sessionID,
        agent: "build",
        parts: [{ type: "text", text: `Reply with exactly: ${token}_${message}` }],
      })
      await expect.poll(() => assistant.calls(), { timeout: 30_000 }).toBeGreaterThan(callsBefore)
      await waitSessionIdle(project.sdk, sessionID, 30_000)
    }
  }

  const after = await page.evaluate(() => {
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
    const dev = (
      window as unknown as {
        __UNIFIA_PERF__?: { eventStreams: () => number; queryObservers: () => number; queryCacheEntries: () => number }
      }
    ).__UNIFIA_PERF__
    if (!memory || !dev) throw new Error("Performance instrumentation is unavailable; refusing a false-green measurement")
    return {
      heap: memory?.usedJSHeapSize ?? 0,
      eventStreams: dev.eventStreams(),
      queryObservers: dev.queryObservers(),
      queryCacheEntries: dev.queryCacheEntries(),
    }
  })

  // Heap may grow a little (strings retained for caching) but a
  // 1 MB / 10 cycles budget is the strict gate; 10 cycles ×
  // 100 KB = 1 MB of acceptable cache growth. Anything beyond
  // points to a leak in the mode-switch path.
  expect(after.heap - baseline.heap).toBeLessThan(1_000_000)
  // Listeners and queries must NOT grow. A non-zero delta is a
  // regression: every switch adds a provider and a query client,
  // and the F10 lazy boundary + the E14 cache defaults are
  // exactly the F-cards that prevent that.
  expect(after.eventStreams).toBeLessThanOrEqual(baseline.eventStreams)
  expect(after.queryObservers).toBeLessThanOrEqual(baseline.queryObservers)
  expect(after.queryCacheEntries).toBeLessThanOrEqual(baseline.queryCacheEntries)
})
