// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
// Generic check for the parity plan: opens the dev app, runs a list of
// clicks, prints the box and a few computed styles of each measured
// selector, and saves a screenshot.
//
// Usage (from the repo root):
//   node --experimental-strip-types docs/audit/tools/probe.mts <desk|mob> "<clicks>" "<measures>" <out.png> [route]
//   <clicks>   selectors separated by ";;" clicked in order (may be "")
//   <measures> selectors separated by ";;" (may be "")
//   [route]    "session" (default) or "home"
// Example:
//   node --experimental-strip-types docs/audit/tools/probe.mts mob "[data-v110=\"mobile-nav\"] [data-destination=\"work\"]" "[data-v110=\"work-view\"]" C:/tmp/audit/check.png
import { chromium, devices } from "playwright"
import { withAuth } from "./auth.mts"

const [viewport = "desk", clicks = "", measures = "", out = "C:/tmp/audit/probe.png", route = "session"] = process.argv.slice(2)
const dir = Buffer.from(["D:", "App", "unifia", "unifia"].join(String.fromCharCode(92)))
  .toString("base64")
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=/g, "")
const url =
  route === "home" ? "http://localhost:4448/" : `http://localhost:4448/${dir}/session/ses_f346a720effeNQK3XG1WaWLyiT`
const browser = await chromium.launch({ headless: true })
const options =
  viewport === "mob"
    ? { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } }
    : { viewport: { width: 1440, height: 900 } }
const context = await browser.newContext({ ...options, colorScheme: "dark", deviceScaleFactor: 1 })
const page = await context.newPage()
await withAuth(page)
await page.goto(url)
await page.waitForTimeout(6000)
await page.addStyleTag({ content: "[data-component*=toast],[data-slot*=toast]{display:none!important}" })
for (const selector of clicks.split(";;").filter(Boolean)) {
  await page.locator(selector).first().click({ force: true })
  await page.waitForTimeout(1500)
}
for (const selector of measures.split(";;").filter(Boolean)) {
  const result = await page.evaluate((s) => {
    const nodes = [...document.querySelectorAll(s)]
    return nodes.slice(0, 6).map((e) => {
      const r = e.getBoundingClientRect()
      const c = getComputedStyle(e)
      return {
        box: [r.x, r.y, r.width, r.height].map(Math.round),
        display: c.display,
        background: c.backgroundColor,
        border: `${c.borderTopWidth} ${c.borderTopStyle} ${c.borderTopColor}`,
        radius: c.borderRadius,
        font: `${c.fontSize} ${c.fontWeight}`,
        color: c.color,
        text: (e.textContent || "").trim().slice(0, 40),
      }
    })
  }, selector)
  console.log(selector, JSON.stringify(result))
}
console.log("scrollWidth", await page.evaluate(() => document.documentElement.scrollWidth))
await page.screenshot({ path: out })
await browser.close()
