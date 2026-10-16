/* SPDX-License-Identifier: MIT */

// #553 criterion 5 — the Memory triptych's two resizers, driven from the
// keyboard.
//
// INTERACTIONS.md, Principes: "Resizers clavier-accessibles (role=separator,
// fleches, Shift=24px)." Both handles were plain <div>s with the maquette's own
// pointer drag script: no role, never focusable, no key handling at all. The
// repo already ships the primitive that implements the clause
// (primitives/separator.tsx, used by the shell panels); the memory grid kept
// the drag script.
//
// The two handles sit on opposite sides of the grid — the vault column is
// before its handle, the links column after its — so a direction written into
// the test once per side would only restate the implementation. The test
// instead derives the direction from the pointer drag (the behaviour that
// already exists) and then requires the arrow key in the same physical
// direction to move the column by the same amount, which is what "keyboard
// equivalent" has to mean.
//
// The columns are stored as percentages in custom properties the panel writes
// itself, so the assertions read the panel's own state rather than the animated
// rendering: the grid transitions grid-template-columns over 240ms.

import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test, expect } from "../fixtures"
import { installWorkbenchMock } from "../fixtures/workbench-mock"

const MEMORY_DIR = ".unifia/memory"
const NOTE = "note.md"
const STEP = 16
const FAST = 24
const MIN = 16
const MAX = 38

test("memory resizers are keyboard separators", async ({ page, gotoSession, directory }) => {
  const dir = join(directory, MEMORY_DIR)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, NOTE), "# Note\n\nbody\n", "utf8")

  try {
    await installWorkbenchMock(page, {
      files: [
        { path: MEMORY_DIR, kind: "directory" },
        { path: `${MEMORY_DIR}/${NOTE}`, kind: "file" },
      ],
    })
    await page.setViewportSize({ width: 1400, height: 900 })
    await gotoSession()
    const toggle = page.locator('[data-v110="inspector-toggle"]')
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
    await expect(toggle).toHaveAttribute("aria-expanded", "true")
    await page.locator('[data-v110="inspector-frame"] [data-v110-tab="inspector"]').click()
    await page.getByRole("button", { name: "Memory", exact: true }).click()

    const grid = page.locator('[data-v110="memory-grid"]')
    const handle = (side: "vault" | "links") => page.locator(`[data-memory-resizer="${side}"]`)
    // The width the panel stores for a column, as a percentage of the grid.
    const column = (side: "vault" | "links") =>
      grid.evaluate(
        (node, key) => Number.parseFloat(getComputedStyle(node).getPropertyValue(key)),
        `--memory-${side}-width`,
      )

    for (const side of ["vault", "links"] as const) {
      const sep = handle(side)
      await expect(sep).toBeVisible()

      // The role and its value semantics: the clause names role=separator.
      await expect(sep).toHaveAttribute("role", "separator")
      await expect(sep).toHaveAttribute("aria-orientation", "vertical")
      await expect(sep).toHaveAttribute("tabindex", "0")
      await expect(sep).toHaveAttribute("aria-label", /\S/)

      // Reachable, and showing the highlight the pointer gets on hover — what
      // a keyboard user has instead of the hover affordance.
      const resting = await sep.evaluate((node) => getComputedStyle(node).backgroundColor)
      // A real key press first: Chromium only matches :focus-visible while the
      // keyboard is the input modality, and reaching the panel above is done
      // with the pointer.
      await page.keyboard.press("Tab")
      await sep.focus()
      await expect(sep).toBeFocused()
      expect(await sep.evaluate((node) => node.matches(":focus-visible"))).toBe(true)
      await expect.poll(() => sep.evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe(resting)

      // aria-valuenow is the column in pixels, so the three values keep the
      // ratios of the percentages the panel clamps to.
      await expect.poll(() => sep.evaluate((node) => Number(node.getAttribute("aria-valuenow")))).toBeGreaterThan(0)
      const now = Number(await sep.getAttribute("aria-valuenow"))
      const min = Number(await sep.getAttribute("aria-valuemin"))
      const max = Number(await sep.getAttribute("aria-valuemax"))
      const start = await column(side)
      expect(min).toBeLessThan(now)
      expect(now).toBeLessThan(max)
      expect(min / now).toBeCloseTo(MIN / start, 1)
      expect(max / now).toBeCloseTo(MAX / start, 1)

      const press = async (key: string) => {
        await sep.focus()
        await page.keyboard.press(key)
      }
      // The handle is a 5px track that the grid transition moves, so wait for
      // the layout to stop before aiming at it.
      const settle = async () => {
        let prior = Number.NaN
        await expect
          .poll(async () => {
            const x = Math.round((await sep.boundingBox())?.x ?? Number.NaN)
            const stable = x === prior
            prior = x
            return stable
          })
          .toBe(true)
      }
      const drag = async (dx: number) => {
        await settle()
        const box = await sep.boundingBox()
        if (!box) throw new Error(`the ${side} resizer has no box`)
        const x = Math.round(box.x + box.width / 2)
        const y = Math.round(box.y + box.height / 2)
        await page.mouse.move(x, y)
        await page.mouse.down()
        await page.mouse.move(x + dx, y, { steps: 4 })
        await page.mouse.up()
      }

      // Home and End are the deterministic anchors. Which way a drag moves the
      // column is what the pointer already decides today, so learn it rather
      // than assume it.
      await press("Home")
      const atMin = await column(side)
      await drag(-STEP)
      const left = await column(side)
      await press("Home")
      await drag(STEP)
      const right = await column(side)
      const grow = left > right ? "left" : "right"
      const growKey = grow === "right" ? "ArrowRight" : "ArrowLeft"
      const shrinkKey = grow === "right" ? "ArrowLeft" : "ArrowRight"

      // Growing, from the minimum where there is room: the arrow and the drag
      // in the same direction must move the column by the same amount.
      await press("Home")
      await press(growKey)
      const keyGrow = (await column(side)) - atMin
      await press("Home")
      await drag(grow === "right" ? STEP : -STEP)
      const dragGrow = (await column(side)) - atMin
      expect(keyGrow).toBeGreaterThan(0)
      expect(keyGrow).toBeCloseTo(dragGrow, 2)

      // Shrinking, from the maximum where there is room.
      await press("End")
      const atMax = await column(side)
      await press(shrinkKey)
      const keyShrink = (await column(side)) - atMax
      await press("End")
      await drag(grow === "right" ? -STEP : STEP)
      const dragShrink = (await column(side)) - atMax
      expect(keyShrink).toBeLessThan(0)
      expect(keyShrink).toBeCloseTo(dragShrink, 2)
      expect(keyGrow).toBeCloseTo(-keyShrink, 2)

      // Shift is the fast step, and the two steps keep the contract ratios.
      await press("Home")
      await press(`Shift+${growKey}`)
      const fast = (await column(side)) - atMin
      expect(fast / keyGrow).toBeCloseTo(FAST / STEP, 3)

      // Home and End land on the panel's own clamps.
      await press("End")
      expect(await column(side)).toBeCloseTo(MAX, 3)
      await press("Home")
      expect(await column(side)).toBeCloseTo(MIN, 3)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
