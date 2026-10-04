/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"

test("server switch retargets the global SDK and can return to the original server", async ({ page, backend, gotoSession }) => {
  const remote = new URL(backend.url)
  remote.hostname = "localhost"
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
  await gotoSession()
  await page.getByRole("button", { name: "Status", exact: true }).click()
  await page.getByRole("button", { name: "Manage servers", exact: true }).click()
  requests.length = 0
  await page.getByRole("dialog").locator('[data-slot="list-item"]').filter({ hasText: remote.host }).click()
  await expect.poll(() => requests.includes(remote.origin)).toBe(true)

  await page.getByRole("button", { name: "Status", exact: true }).click()
  await page.getByRole("button", { name: "Manage servers", exact: true }).click()
  requests.length = 0
  await page.getByRole("dialog").locator('[data-slot="list-item"]').filter({ hasText: new URL(backend.url).host }).click()
  await expect.poll(() => requests.includes(new URL(backend.url).origin)).toBe(true)
})
