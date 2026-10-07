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

// ADR-049 (048f7522de): the Context tool's add actions (File, Folder,
// Selection, Terminal) are placeholders until they have a backend - the owner
// rule is no invented action. The file picker this spec used to open from
// there no longer exists, so it pins the honest state instead.
test("context panel offers its add-file action as coming soon", async ({ page, sdk, gotoSession }) => {
  await withSession(sdk, `e2e context tabs ${Date.now()}`, async (session) => {
    await seedContextSession({ sessionID: session.id, sdk })
    await gotoSession(session.id)

    await page.locator(promptSelector).click()

    const trigger = contextButton(page)
    await expect(trigger).toBeVisible()
    await trigger.click()

    await expect(contextTool(page)).toBeVisible()
    const addFile = contextTool(page).locator("[data-soon]").filter({ hasText: /File|Fichier/ }).first()
    await expect(addFile).toBeVisible()
    await expect(addFile).toBeDisabled()
    await expect(addFile).toHaveAttribute("title", /.+/)
  })
})
