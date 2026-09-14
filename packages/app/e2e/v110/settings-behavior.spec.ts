/* SPDX-License-Identifier: MIT */

// Phase 11 hardening — behavioral proofs for settings tabs whose wiring was
// real but had no e2e evidence (matrix rows were ⚠️ "wired, unproven").
//
// Two tabs, two real persistence paths:
//   - Audio: localStorage (`unifia-audio-settings`) through the tab's own
//     switches, asserted after a reload.
//   - Memory: the real backend config (`global.config.update`), asserted
//     through the isolated per-worker backend the browser itself talks to.

import { test, expect } from "../fixtures"
import { openSettings } from "../actions"

const AUDIO_STORAGE_KEY = "unifia-audio-settings"

test("audio tab switches persist through localStorage across a reload", async ({ page, gotoSession }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoSession()

  let dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Audio", exact: true }).click()

  const stt = dialog.locator('[data-action="settings-audio-stt-enabled"]')
  await expect(stt).toBeVisible()
  const sttInput = stt.locator('[data-slot="switch-input"]')
  // Fresh profile: the audio defaults are both enabled.
  await expect(sttInput).toBeChecked()

  await stt.locator('[data-slot="switch-control"]').click()
  await expect(sttInput).not.toBeChecked()

  const tts = dialog.locator('[data-action="settings-audio-tts-enabled"]')
  const ttsInput = tts.locator('[data-slot="switch-input"]')
  await expect(ttsInput).toBeChecked()
  await tts.locator('[data-slot="switch-control"]').click()
  await expect(ttsInput).not.toBeChecked()

  const stored = await page.evaluate((key) => localStorage.getItem(key), AUDIO_STORAGE_KEY)
  expect(JSON.parse(stored ?? "{}")).toMatchObject({ sttEnabled: false, ttsEnabled: false })

  await page.reload()
  dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Audio", exact: true }).click()
  await expect(dialog.locator('[data-action="settings-audio-stt-enabled"] [data-slot="switch-input"]')).not.toBeChecked()
  await expect(dialog.locator('[data-action="settings-audio-tts-enabled"] [data-slot="switch-input"]')).not.toBeChecked()
})

test("memory tab enable switch writes the real backend config and restores it", async ({ page, backend, gotoSession }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoSession()

  // Transport-level access to the same route the tab writes (/global/config):
  // the e2e SDK client is the v1 shape and has no `global` namespace, so a
  // raw fetch is the honest way to observe the backend's real state.
  type GlobalConfig = { memory?: { enabled?: boolean } }
  const readConfig = async (): Promise<GlobalConfig> => (await fetch(`${backend.url}/global/config`)).json()
  const writeMemoryEnabled = async (enabled: boolean) => {
    const current = await readConfig()
    const res = await fetch(`${backend.url}/global/config`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...current, memory: { ...(current.memory ?? {}), enabled } }),
    })
    if (!res.ok) throw new Error(`global.config PATCH failed: ${res.status}`)
  }
  const readMemory = async () => (await readConfig()).memory?.enabled ?? true
  const initial = await readMemory()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Memory", exact: true }).click()

  const row = dialog.locator('[data-action="settings-memory-enabled"]')
  await expect(row).toBeVisible()
  const input = row.locator('[data-slot="switch-input"]')
  await expect(input).toBeChecked({ checked: initial })

  try {
    await row.locator('[data-slot="switch-control"]').click()
    await expect.poll(readMemory, { timeout: 15_000 }).toBe(!initial)
    await expect(input).toBeChecked({ checked: !initial })
  } finally {
    // Restore through the same real route so a later spec in this worker
    // still sees the fixture's memory default.
    await writeMemoryEnabled(initial)
  }

  await expect.poll(readMemory, { timeout: 15_000 }).toBe(initial)
})

test("plugins tab adds and removes a real MCP server", async ({ page, backend, gotoSession }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoSession()

  // Transport-level view of the same route the tab reads (GET /mcp): the e2e
  // SDK client is the v1 shape, and the backend registry is what must change.
  const readServers = async (): Promise<Record<string, unknown>> => (await fetch(`${backend.url}/mcp`)).json()
  const name = `e2e-mcp-${Date.now()}`

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Plugins", exact: true }).click()
  // The MCP sub-tab is the default; click it so a future default change
  // fails here instead of silently testing a different pane.
  await dialog.getByRole("tab", { name: "MCP Servers", exact: true }).click()

  await dialog.locator('[data-action="settings-mcp-add-toggle"]').click()
  await dialog.locator('[data-action="settings-mcp-type-remote"]').click()
  await dialog.locator('[data-action="settings-mcp-name"] input').fill(name)
  // Port 1 is closed by construction: the add must not need a live server.
  await dialog.locator('[data-action="settings-mcp-url"] input').fill("http://127.0.0.1:1/mcp")
  await dialog.locator('[data-action="settings-mcp-submit"]').click()

  const row = dialog.locator(`[data-mcp-server="${name}"]`)
  await expect(row).toBeVisible()
  await expect
    .poll(async () => name in (await readServers()), { timeout: 20_000 })
    .toBe(true)

  await row.locator('[data-action="settings-mcp-remove"]').click()
  await expect(row).toHaveCount(0)
  await expect
    .poll(async () => name in (await readServers()), { timeout: 20_000 })
    .toBe(false)
})
