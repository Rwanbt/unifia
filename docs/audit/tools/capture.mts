// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
// Captures maquette V5 | app for every destination, desktop 1440x900 and phone 390x844.
// Usage (from repo root): node --experimental-strip-types docs/audit/tools/capture.mts [desk|mob]
// Output: C:/tmp/audit/<vp>-<state>-maq.png and -app.png; then run pair.py.
import { chromium, devices } from "playwright"
import { withAuth } from "./auth.mts"
const dir = Buffer.from(["D:", "App", "unifia", "unifia"].join(String.fromCharCode(92))).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
const APP = `http://localhost:4448/${dir}/session/ses_f346a720effeNQK3XG1WaWLyiT`
const MAQ = "file:///C:/Users/barat/Desktop/Unifia-UI-UX-v110-JARVIS-TOPBAR-PROTOTYPE-V5.html"
const O = "C:/tmp/audit/"
const only = process.argv[2]
const b = await chromium.launch({ headless: true })
const HIDE = "[data-component*=toast],[data-slot*=toast]{display:none!important}"
const states = ["home", "code", "split", "editor", "work", "design", "automate", "browser", "memory", "settings", "user"]
for (const vp of ["desk", "mob"] as const) {
  if (only && only !== vp) continue
  const opts = vp === "desk" ? { viewport: { width: 1440, height: 900 } } : { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } }
  const ctx = await b.newContext({ ...opts, colorScheme: "dark", deviceScaleFactor: 1 })
  const m = await ctx.newPage(); const p = await ctx.newPage(); await withAuth(p)
  for (const s of states) {
    if (vp === "mob" && s === "split") continue
    try {
      await m.goto(MAQ); await m.waitForTimeout(900)
      if (s !== "home") {
        const mode = s === "split" || s === "editor" ? "code" : s === "user" ? "settings" : s
        await m.evaluate(`UnifiaDemo.enter(${JSON.stringify(mode)})`); await m.waitForTimeout(900)
        if (s === "split" || s === "editor") await m.locator("#layoutSwitch button, .segmented button", { hasText: s === "split" ? "Split" : "Editor" }).filter({ visible: true }).first().click().catch(() => {})
        if (s === "code" && vp === "desk") await m.locator("#layoutSwitch button", { hasText: "Chat" }).filter({ visible: true }).first().click().catch(() => {})
        if (s === "code" && vp === "mob") await m.locator("button", { hasText: "Chat" }).filter({ visible: true }).first().click().catch(() => {})
        if (s === "user") { await m.evaluate(`window.setMode?.("user")`).catch(() => {}); }
        await m.waitForTimeout(1200)
      }
      await m.screenshot({ path: `${O}${vp}-${s}-maq.png` })
    } catch (e) { console.log("maq", vp, s, (e as Error).message.slice(0, 80)) }
    try {
      await p.goto(s === "home" ? "http://localhost:4448/" : APP); await p.waitForTimeout(5500)
      await p.addStyleTag({ content: HIDE })
      if (s === "split" || s === "editor") { await p.getByRole("radio", { name: s === "split" ? "Split" : "Editor" }).click(); await p.waitForTimeout(1200) }
      if (s === "code") { await p.getByRole("radio", { name: "Chat" }).click().catch(() => {}); await p.waitForTimeout(800) }
      const dest = ["work", "design", "automate", "browser", "memory"].includes(s)
      if (dest) {
        if (vp === "desk") {
          const sel = ["browser", "memory"].includes(s) ? `[data-v110="rail-mode"][aria-label="${s === "browser" ? "Browser" : "Memory"}"]` : `[data-v110="rail-mode"][data-mode="${s}"]`
          await p.locator(sel).first().click({ force: true })
        } else await p.locator(`[data-v110="mobile-nav"] [data-destination="${s}"]`).click()
        await p.waitForTimeout(3000)
      }
      if (s === "settings") {
        if (vp === "desk") await p.locator('[data-v110="rail-mode"][aria-label="Paramètres"]').first().click({ force: true })
        else { await p.click('[data-action="mobile-more"]'); await p.click('[data-mobile-action="settings"]') }
        await p.waitForTimeout(3000)
      }
      if (s === "user") {
        if (vp === "desk") await p.locator('button[aria-label="Compte"]').first().click({ force: true })
        else { await p.click('[data-action="mobile-more"]'); await p.click('[data-mobile-action="account"]'); await p.locator('[data-slot="account-quick-action"]', { hasText: "Gérer" }).click() }
        await p.waitForTimeout(3000)
      }
      await p.mouse.move(700, 450)
      await p.screenshot({ path: `${O}${vp}-${s}-app.png` })
    } catch (e) { console.log("app", vp, s, (e as Error).message.slice(0, 120)) }
  }
  await ctx.close()
}
await b.close()
