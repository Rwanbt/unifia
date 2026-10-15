/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"

test("server switch retargets the global SDK and can return to the original server", async ({ page, backend, gotoSession }) => {
  const remote = new URL(backend.url)
  remote.hostname = "localhost"
  const original = new URL(backend.url).host
  await page.addInitScript((url) => {
    const key = "unifia.global.dat:server"
    const store = JSON.parse(localStorage.getItem(key) ?? "{}")
    store.list = [...(store.list ?? []), url]
    localStorage.setItem(key, JSON.stringify(store))
  }, remote.origin)
  const requests: string[] = []
  page.on("request", (request) => {
    const url = new URL(request.url())
    if (url.pathname === "/global/event" || url.pathname === "/project") requests.push(url.origin)
  })
  const item = (host: string) => page.getByRole("dialog").locator('[data-slot="list-item"]').filter({ hasText: host })
  // Both servers must be listed before a switch: an entry missing from the list leaves the click
  // waiting the whole test timeout, which is how #486 first surfaced, before its cause was fixed.
  const listed = async () => {
    await expect(item(remote.host)).toHaveCount(1)
    await expect(item(original)).toHaveCount(1)
  }

  await gotoSession()
  await page.getByRole("button", { name: "Status", exact: true }).click()
  await page.getByRole("button", { name: "Manage servers", exact: true }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await listed()
  requests.length = 0
  await item(remote.host).click()
  await expect.poll(() => requests.includes(remote.origin)).toBe(true)

  await page.getByRole("button", { name: "Status", exact: true }).click()
  await page.getByRole("button", { name: "Manage servers", exact: true }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await listed()
  requests.length = 0
  await item(original).click()
  await expect.poll(() => requests.includes(new URL(backend.url).origin)).toBe(true)
})
