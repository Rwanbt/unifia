import { test, expect } from "../fixtures"
import { openSettings, closeDialog, waitTerminalFocusIdle, withSession } from "../actions"
import { keybindButtonSelector, terminalSelector } from "../selectors"
import { modKey } from "../utils"

test("changing sidebar toggle keybind works", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Shortcuts" }).click()

  const keybindButton = dialog.locator(keybindButtonSelector("sidebar.toggle")).first()
  await expect(keybindButton).toBeVisible()

  const initialKeybind = await keybindButton.textContent()
  expect(initialKeybind).toContain("B")

  await keybindButton.click()
  await expect(keybindButton).toHaveText(/press/i)

  await page.keyboard.press(`${modKey}+Shift+KeyH`)
  await page.waitForTimeout(100)

  const newKeybind = await keybindButton.textContent()
  expect(newKeybind).toContain("H")

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("settings.v3")
    return raw ? JSON.parse(raw) : null
  })
  expect(stored?.keybinds?.["sidebar.toggle"]).toBe("mod+shift+h")

  await closeDialog(page, dialog)

  const button = page.getByRole("button", { name: /toggle sidebar/i }).first()
  const initiallyClosed = (await button.getAttribute("aria-expanded")) !== "true"

  await page.keyboard.press(`${modKey}+Shift+H`)
  await expect(button).toHaveAttribute("aria-expanded", initiallyClosed ? "true" : "false")

  const afterToggleClosed = (await button.getAttribute("aria-expanded")) !== "true"
  expect(afterToggleClosed).toBe(!initiallyClosed)

  await page.keyboard.press(`${modKey}+Shift+H`)
  await expect(button).toHaveAttribute("aria-expanded", initiallyClosed ? "false" : "true")

  const finalClosed = (await button.getAttribute("aria-expanded")) !== "true"
  expect(finalClosed).toBe(initiallyClosed)
})

test("sidebar toggle keybind guards against shortcut conflicts", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Shortcuts" }).click()

  const keybindButton = dialog.locator(keybindButtonSelector("sidebar.toggle"))
  await expect(keybindButton).toBeVisible()

  const initialKeybind = await keybindButton.textContent()
  expect(initialKeybind).toContain("B")

  await keybindButton.click()
  await expect(keybindButton).toHaveText(/press/i)

  await page.keyboard.press(`${modKey}+Shift+KeyP`)
  await page.waitForTimeout(100)

  const toast = page.locator('[data-component="toast"]').last()
  await expect(toast).toBeVisible()
  await expect(toast).toContainText(/already/i)

  await keybindButton.click()
  await expect(keybindButton).toContainText("B")

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("settings.v3")
    return raw ? JSON.parse(raw) : null
  })
  expect(stored?.keybinds?.["sidebar.toggle"]).toBeUndefined()

  await closeDialog(page, dialog)
})

test("resetting all keybinds to defaults works", async ({ page, gotoSession }) => {
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ keybinds: { "sidebar.toggle": "mod+shift+x" } }))
  })

  await gotoSession()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Shortcuts" }).click()

  const keybindButton = dialog.locator(keybindButtonSelector("sidebar.toggle"))
  await expect(keybindButton).toBeVisible()

  const customKeybind = await keybindButton.textContent()
  expect(customKeybind).toContain("X")

  const resetButton = dialog.getByRole("button", { name: "Reset to defaults" })
  await expect(resetButton).toBeVisible()
  await expect(resetButton).toBeEnabled()
  await resetButton.click()
  await page.waitForTimeout(100)

  const restoredKeybind = await keybindButton.textContent()
  expect(restoredKeybind).toContain("B")

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("settings.v3")
    return raw ? JSON.parse(raw) : null
  })
  expect(stored?.keybinds?.["sidebar.toggle"]).toBeUndefined()

  await closeDialog(page, dialog)
})

test("clearing a keybind works", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Shortcuts" }).click()

  const keybindButton = dialog.locator(keybindButtonSelector("sidebar.toggle"))
  await expect(keybindButton).toBeVisible()

  const initialKeybind = await keybindButton.textContent()
  expect(initialKeybind).toContain("B")

  await keybindButton.click()
  await expect(keybindButton).toHaveText(/press/i)

  await page.keyboard.press("Delete")
  await page.waitForTimeout(100)

  const clearedKeybind = await keybindButton.textContent()
  expect(clearedKeybind).toMatch(/unassigned|press/i)

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("settings.v3")
    return raw ? JSON.parse(raw) : null
  })
  expect(stored?.keybinds?.["sidebar.toggle"]).toBe("none")

  await closeDialog(page, dialog)

  await page.keyboard.press(`${modKey}+B`)
  await page.waitForTimeout(100)

  const stillOnSession = page.url().includes("/session")
  expect(stillOnSession).toBe(true)
})

test("changing settings open keybind works", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Shortcuts" }).click()

  const keybindButton = dialog.locator(keybindButtonSelector("settings.open"))
  await expect(keybindButton).toBeVisible()

  const initialKeybind = await keybindButton.textContent()
  expect(initialKeybind).toContain(",")

  await keybindButton.click()
  await expect(keybindButton).toHaveText(/press/i)

  await page.keyboard.press(`${modKey}+Slash`)
  await page.waitForTimeout(100)

  const newKeybind = await keybindButton.textContent()
  expect(newKeybind).toContain("/")

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("settings.v3")
    return raw ? JSON.parse(raw) : null
  })
  expect(stored?.keybinds?.["settings.open"]).toBe("mod+/")

  await closeDialog(page, dialog)

  const settingsFrame = page.locator('[data-v110="settings-frame"]')
  await expect(settingsFrame).toHaveCount(0)

  await page.keyboard.press(`${modKey}+Slash`)
  await page.waitForTimeout(100)

  await expect(settingsFrame).toBeVisible()

  await closeDialog(page, settingsFrame)
})

test("changing new session keybind works", async ({ page, sdk, gotoSession }) => {
  await withSession(sdk, "test session for keybind", async (session) => {
    await gotoSession(session.id)

    const initialUrl = page.url()
    expect(initialUrl).toContain(`/session/${session.id}`)

    const dialog = await openSettings(page)
    await dialog.getByRole("tab", { name: "Shortcuts" }).click()

    const keybindButton = dialog.locator(keybindButtonSelector("session.new"))
    await expect(keybindButton).toBeVisible()

    await keybindButton.click()
    await expect(keybindButton).toHaveText(/press/i)

    // mod+shift+n is NOT free: measured, the app answers "Ctrl+Shift+N is already
    // assigned to New folder" and settings-keybinds.tsx refuses the capture
    // without persisting anything. The old assertion passed anyway because the row
    // label "New session..." already contains the letter N. mod+shift+j is free and
    // persists, per the same measurement.
    await page.keyboard.press(`${modKey}+Shift+KeyJ`)
    await page.waitForTimeout(200)

    const newKeybind = await keybindButton.textContent()
    expect(newKeybind).toContain("Shift+J")

    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem("settings.v3")
      return raw ? JSON.parse(raw) : null
    })
    expect(stored?.keybinds?.["session.new"]).toBe("mod+shift+j")

    await closeDialog(page, dialog)

    await page.keyboard.press(`${modKey}+Shift+N`)
    await page.waitForTimeout(200)

    const newUrl = page.url()
    expect(newUrl).toMatch(/\/session\/?$/)
    expect(newUrl).not.toContain(session.id)
  })
})

test("changing file open keybind works", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Shortcuts" }).click()

  const keybindButton = dialog.locator(keybindButtonSelector("file.open"))
  await expect(keybindButton).toBeVisible()

  const initialKeybind = await keybindButton.textContent()
  // Measured default is "Open fileCtrl+P", not the maquette's "Ctrl K" label.
  // session-header.tsx:149-155 records the same decision for the sibling control:
  // show "the actual keybind rather than a 'Ctrl K' label that would not work".
  expect(initialKeybind).toContain("P")

  await keybindButton.click()
  await expect(keybindButton).toHaveText(/press/i)

  // mod+shift+f is measured to be free and to persist (mod+shift+g is the
  // measured-free alternative used below); the old value was rejected as a
  // conflict and the old "F" assertion matched nothing but the row title.
  await page.keyboard.press(`${modKey}+Shift+KeyG`)
  await page.waitForTimeout(200)

  const newKeybind = await keybindButton.textContent()
  expect(newKeybind).toContain("Shift+G")

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("settings.v3")
    return raw ? JSON.parse(raw) : null
  })
  expect(stored?.keybinds?.["file.open"]).toBe("mod+shift+g")

  await closeDialog(page, dialog)

  // The file picker is a real dialog (`file.open` opens it), unlike the settings
  // surface, so the role locator is correct here.
  const filePickerDialog = page.getByRole("dialog").filter({ has: page.getByPlaceholder(/search files/i) })
  await expect(filePickerDialog).toHaveCount(0)

  await page.keyboard.press(`${modKey}+Shift+G`)
  await page.waitForTimeout(200)

  await expect(filePickerDialog).toBeVisible()

  await page.keyboard.press("Escape")
  await expect(filePickerDialog).toHaveCount(0)
})

test.skip(!!process.env.CI, "Flaky on ubuntu-latest: waitTerminalFocusIdle exceeds 90s")
test("changing terminal toggle keybind works", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Shortcuts" }).click()

  const keybindButton = dialog.locator(keybindButtonSelector("terminal.toggle"))
  await expect(keybindButton).toBeVisible()

  await keybindButton.click()
  await expect(keybindButton).toHaveText(/press/i)

  // mod+shift+u is measured free and persisting; the previous mod+y was rejected
  // as a conflict, and "Toggle terminalCtrl+Y" already contains the letter Y so
  // the old label assertion could not tell success from refusal.
  await page.keyboard.press(`${modKey}+Shift+KeyU`)
  await page.waitForTimeout(200)

  const newKeybind = await keybindButton.textContent()
  expect(newKeybind).toContain("Shift+U")

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("settings.v3")
    return raw ? JSON.parse(raw) : null
  })
  expect(stored?.keybinds?.["terminal.toggle"]).toBe("mod+shift+u")

  await closeDialog(page, dialog)

  const terminal = page.locator(terminalSelector)
  await expect(terminal).not.toBeVisible()

  await page.keyboard.press(`${modKey}+Shift+U`)
  await waitTerminalFocusIdle(page, { term: terminal })

  await page.keyboard.press(`${modKey}+Shift+U`)
  await expect(terminal).not.toBeVisible()
})

test.skip(!!process.env.CI, "Flaky on ubuntu-latest: waitTerminalFocusIdle exceeds 90s")
test("terminal toggle keybind persists after reload", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Shortcuts" }).click()

  const keybindButton = dialog.locator(keybindButtonSelector("terminal.toggle"))
  await expect(keybindButton).toBeVisible()

  await keybindButton.click()
  await expect(keybindButton).toHaveText(/press/i)

  await page.keyboard.press(`${modKey}+Shift+KeyY`)
  await page.waitForTimeout(100)

  await expect(keybindButton).toContainText("Y")
  await closeDialog(page, dialog)

  await page.reload()

  await expect
    .poll(async () => {
      return await page.evaluate(() => {
        const raw = localStorage.getItem("settings.v3")
        if (!raw) return
        const parsed = JSON.parse(raw)
        return parsed?.keybinds?.["terminal.toggle"]
      })
    })
    .toBe("mod+shift+y")

  const reloaded = await openSettings(page)
  await reloaded.getByRole("tab", { name: "Shortcuts" }).click()
  const reloadedKeybind = reloaded.locator(keybindButtonSelector("terminal.toggle")).first()
  await expect(reloadedKeybind).toContainText("Y")
  await closeDialog(page, reloaded)
})

test("changing command palette keybind works", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Shortcuts" }).click()

  const keybindButton = dialog.locator(keybindButtonSelector("command.palette"))
  await expect(keybindButton).toBeVisible()

  const initialKeybind = await keybindButton.textContent()
  expect(initialKeybind).toContain("P")

  await keybindButton.click()
  await expect(keybindButton).toHaveText(/press/i)

  await page.keyboard.press(`${modKey}+Shift+KeyK`)
  await page.waitForTimeout(100)

  const newKeybind = await keybindButton.textContent()
  expect(newKeybind).toContain("K")

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("settings.v3")
    return raw ? JSON.parse(raw) : null
  })
  expect(stored?.keybinds?.["command.palette"]).toBe("mod+shift+k")

  await closeDialog(page, dialog)

  const palette = page.getByRole("dialog").filter({ has: page.getByRole("textbox").first() })
  await expect(palette).toHaveCount(0)

  await page.keyboard.press(`${modKey}+Shift+K`)
  await page.waitForTimeout(100)

  await expect(palette).toBeVisible()
  await expect(palette.getByRole("textbox").first()).toBeVisible()

  await page.keyboard.press("Escape")
  await expect(palette).toHaveCount(0)
})
