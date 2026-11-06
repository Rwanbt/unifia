import { test, expect } from "../fixtures"
import type { Page } from "@playwright/test"
import { promptSelector } from "../selectors"
import { withSession } from "../actions"

function contextButton(page: Page) {
  return page.locator('[data-action="prompt-context"]').first()
}

// The meter opens the Context tool of the Code inspector.
function contextTool(page: Page) {
  return page.locator('[data-code-inspector="context"]')
}

async function seedContextSession(input: { sessionID: string; sdk: Parameters<typeof withSession>[0] }) {
  await input.sdk.session.promptAsync({
    sessionID: input.sessionID,
    noReply: true,
    parts: [
      {
        type: "text",
        text: "seed context",
      },
    ],
  })

  await expect
    .poll(async () => {
      const messages = await input.sdk.session
        .messages({ sessionID: input.sessionID, limit: 1 })
        .then((r) => r.data ?? [])
      return messages.length
    })
    .toBeGreaterThan(0)
}

test("context panel can be opened from the prompt", async ({ page, sdk, gotoSession }) => {
  const title = `e2e smoke context ${Date.now()}`

  await withSession(sdk, title, async (session) => {
    await seedContextSession({ sessionID: session.id, sdk })

    await gotoSession(session.id)

    const trigger = contextButton(page)
    await expect(trigger).toBeVisible()
    await trigger.click()

    await expect(page.locator('[data-code-tool="context"]')).toHaveAttribute("aria-pressed", "true")
    await expect(contextTool(page)).toBeVisible()
  })
})

test("context panel closes when the meter is clicked again", async ({ page, sdk, gotoSession }) => {
  await withSession(sdk, `e2e context toggle ${Date.now()}`, async (session) => {
    await seedContextSession({ sessionID: session.id, sdk })
    await gotoSession(session.id)

    await page.locator(promptSelector).click()

    const trigger = contextButton(page)
    await expect(trigger).toBeVisible()
    await trigger.click()

    await expect(contextTool(page)).toBeVisible()

    await trigger.click()
    await expect(contextTool(page)).not.toBeVisible()
  })
})

// ADR-049: Folder and Terminal stay greyed until they have a context item type.
// File and Selection reuse the composer's own context paths (#679), so the
// file picker this spec once drove is back, and it pins a real file.
test("context panel adds a file through the file picker and keeps folder greyed", async ({ page, sdk, gotoSession }) => {
  await withSession(sdk, `e2e context tabs ${Date.now()}`, async (session) => {
    await seedContextSession({ sessionID: session.id, sdk })
    await gotoSession(session.id)

    await page.locator(promptSelector).click()

    const trigger = contextButton(page)
    await expect(trigger).toBeVisible()
    await trigger.click()
    await expect(contextTool(page)).toBeVisible()

    const folder = contextTool(page).locator("[data-soon]").filter({ hasText: /Folder|Dossier/ }).first()
    await expect(folder).toBeDisabled()

    await contextTool(page).locator('[data-code-context-add="file"]').click()
    const dialog = page.getByRole("dialog").filter({ has: page.getByPlaceholder(/search files/i) }).first()
    await expect(dialog).toBeVisible()
    await dialog.getByRole("textbox").first().fill("package.json")
    await expect(dialog.locator('[data-slot="list-scroll"]')).not.toHaveAttribute("aria-busy", "true")
    const item = dialog.locator('[data-slot="list-item"][data-key="file:package.json"]')
    await expect(item).toBeVisible({ timeout: 30_000 })
    await item.click()
    await expect(dialog).toHaveCount(0)

    await expect(contextTool(page).locator("[data-code-row] b").filter({ hasText: "package.json" })).toBeVisible()
  })
})
