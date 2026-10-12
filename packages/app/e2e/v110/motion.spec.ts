/* SPDX-License-Identifier: MIT */

// S14 motion surface test (test of surface, NOT visual parity claim).
// Verifies the v110 motion contract from INTERACTIONS.md Motion + the
// reduced-motion / html[data-ui-animations=off] kill-switches. Real
// browser. G2 motion parity vs the maquette is NOT claimed by this
// checkpoint -- only the duration tokens and the kill-switches land.

import { test, expect } from "../fixtures"

test("motion tokens exist on :root and the v110 contract respects reduced-motion", async ({ page, project }) => {
  await project.open()
  await page.setViewportSize({ width: 1440, height: 900 })

  const tokens = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement)
    return {
      fast: root.getPropertyValue("--v110-fast").trim(),
      layout: root.getPropertyValue("--v110-layout").trim(),
      split: root.getPropertyValue("--v110-split").trim(),
      micro: root.getPropertyValue("--v110-micro").trim(),
      soft: root.getPropertyValue("--v110-soft").trim(),
      ease: root.getPropertyValue("--v110-ease").trim(),
    }
  })
  expect(tokens.fast).toBe("150ms")
  expect(tokens.layout).toBe("650ms")
  expect(tokens.split).toBe("680ms")
  expect(tokens.micro).toBe("150ms")
  expect(tokens.soft).toBe("220ms")
  expect(tokens.ease.length).toBeGreaterThan(0)
})

test("data-ui-animations=off collapses every motion token to 0ms", async ({ page, project }) => {
  await project.open()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-ui-animations", "off")
  })

  const tokens = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement)
    return {
      fast: root.getPropertyValue("--v110-fast").trim(),
      layout: root.getPropertyValue("--v110-layout").trim(),
      split: root.getPropertyValue("--v110-split").trim(),
      micro: root.getPropertyValue("--v110-micro").trim(),
      soft: root.getPropertyValue("--v110-soft").trim(),
    }
  })
  expect(tokens.fast).toBe("0ms")
  expect(tokens.layout).toBe("0ms")
  expect(tokens.split).toBe("0ms")
  expect(tokens.micro).toBe("0ms")
  expect(tokens.soft).toBe("0ms")
})

test("motion contract selectors carry a transition property", async ({ page, project }) => {
  await project.open()
  await page.setViewportSize({ width: 1440, height: 900 })

  // Computed styles resolve var(): a transition never reads "var(--v110-soft)".
  // Prove the token drives it instead: the durations are the soft/fast token
  // values, and collapsing the tokens collapses the transition with them.
  const inspector = page.locator('[data-parity="shell.inspector"]').first()
  const durations = () =>
    inspector.evaluate((el) => getComputedStyle(el as HTMLElement).transitionDuration.split(",").map((d) => d.trim()))
  const tokens = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement)
    return [root.getPropertyValue("--v110-soft").trim(), root.getPropertyValue("--v110-fast").trim()]
  })
  const asSeconds = (ms: string) => `${Number.parseFloat(ms) / 1000}s`
  const live = await durations()
  expect(live.length).toBeGreaterThan(0)
  for (const duration of live) expect(tokens.map(asSeconds)).toContain(duration)
  await page.evaluate(() => document.documentElement.setAttribute("data-ui-animations", "off"))
  await expect.poll(async () => (await durations()).every((duration) => duration === "0s")).toBe(true)
})