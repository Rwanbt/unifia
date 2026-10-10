// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

import type { Locator, Page, Route } from "@playwright/test"
import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"

// A path that exists in no project. If a superseded answer is applied, this row appears.
const STALE_PATH = "zz-stale-result.md"
const STALE_QUERY = "zz-stale"
const CURRENT_QUERY = "package.json"

type Hold = {
  arrived: Promise<void>
  release: () => void
  answered: Promise<void>
}

// Routes /find/file by its query string. A held query waits for release() before answering,
// either with a fixed reply or with the real server. Lets a test choose the order of answers.
async function routeSearches(page: Page) {
  const holds = new Map<string, { gate: Promise<void>; reply?: string[]; markArrived: () => void; markAnswered: () => void }>()

  await page.route("**/find/file**", async (route: Route) => {
    const query = new URL(route.request().url()).searchParams.get("query") ?? ""
    const hold = holds.get(query)
    if (!hold) return route.continue()
    hold.markArrived()
    await hold.gate
    if (hold.reply) await route.fulfill({ json: hold.reply })
    else await route.continue()
    hold.markAnswered()
  })

  return {
    hold(query: string, reply?: string[]): Hold {
      let release!: () => void
      let markArrived!: () => void
      let markAnswered!: () => void
      const gate = new Promise<void>((resolve) => (release = resolve))
      const arrived = new Promise<void>((resolve) => (markArrived = resolve))
      const answered = new Promise<void>((resolve) => (markAnswered = resolve))
      holds.set(query, { gate, reply, markArrived, markAnswered })
      return { arrived, release, answered }
    },
  }
}

async function openFilePalette(page: Page, gotoSession: () => Promise<void>) {
  await gotoSession()
  await page.getByRole("radio", { name: "Split" }).click()
  await page.locator(promptSelector).click()
  await page.keyboard.type("/open")
  const command = page.locator('[data-slash-id="file.open"]').first()
  await expect(command).toBeVisible()
  await page.keyboard.press("Enter")

  const dialog = page
    .getByRole("dialog")
    .filter({ has: page.getByPlaceholder(/search files/i) })
    .first()
  await expect(dialog).toBeVisible()
  return { dialog, input: dialog.getByRole("textbox").first() }
}

const fileRow = (dialog: Locator, path: string) => dialog.locator(`[data-slot="list-item"][data-key="file:${path}"]`)

// The answer is applied (or dropped) in the page after the response arrives. Waiting for the
// response and then for two paint frames lets that update land before the list is checked.
async function settleAfterAnswer(page: Page, answered: Promise<void>) {
  await answered
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
}

test("an answer for a superseded query never replaces the current results", async ({ page, gotoSession }) => {
  const routes = await routeSearches(page)
  const { dialog, input } = await openFilePalette(page, gotoSession)

  const stale = routes.hold(STALE_QUERY, [STALE_PATH])
  await input.fill(STALE_QUERY)
  await stale.arrived

  await input.fill(CURRENT_QUERY)
  await expect(fileRow(dialog, CURRENT_QUERY)).toBeVisible({ timeout: 30_000 })

  stale.release()
  await settleAfterAnswer(page, stale.answered)

  await expect(fileRow(dialog, STALE_PATH)).toHaveCount(0)
  await expect(fileRow(dialog, CURRENT_QUERY)).toBeVisible()
})

test("clearing the query does not bring back the rows of the cleared search", async ({ page, gotoSession }) => {
  const routes = await routeSearches(page)
  const { dialog, input } = await openFilePalette(page, gotoSession)

  const stale = routes.hold(STALE_QUERY, [STALE_PATH])
  await input.fill(STALE_QUERY)
  await stale.arrived

  await input.fill("")
  await input.fill(CURRENT_QUERY)
  await expect(fileRow(dialog, CURRENT_QUERY)).toBeVisible({ timeout: 30_000 })

  stale.release()
  await settleAfterAnswer(page, stale.answered)

  await expect(fileRow(dialog, STALE_PATH)).toHaveCount(0)
  await expect(fileRow(dialog, CURRENT_QUERY)).toBeVisible()
})

test("Enter while the search runs commits the top match of the current query", async ({ page, gotoSession }) => {
  const routes = await routeSearches(page)
  const { dialog, input } = await openFilePalette(page, gotoSession)

  // The real answer is held, so Enter is pressed while the search for this query is in flight.
  const current = routes.hold(CURRENT_QUERY)
  await input.fill(CURRENT_QUERY)
  await current.arrived

  await page.keyboard.press("Enter")
  current.release()

  await expect(dialog).toHaveCount(0, { timeout: 30_000 })
  await expect(page.getByRole("tab", { name: CURRENT_QUERY, exact: true }).first()).toBeVisible()
})

test("typing several queries in a row ends on the last one", async ({ page, gotoSession }) => {
  const { dialog, input } = await openFilePalette(page, gotoSession)

  await input.pressSequentially("package", { delay: 0 })
  await input.pressSequentially(".json", { delay: 0 })

  await expect(fileRow(dialog, CURRENT_QUERY)).toBeVisible({ timeout: 30_000 })
  await expect(dialog.locator('[data-slot="list-scroll"]')).not.toHaveAttribute("aria-busy", "true", { timeout: 30_000 })
  await expect(input).toHaveValue(CURRENT_QUERY)
})
