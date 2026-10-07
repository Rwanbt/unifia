import { seedSessionTask, withSession } from "../actions"
import { test, expect, settingsKey } from "../fixtures"
import { inputMatch } from "../prompt/mock"
import { promptSelector } from "../selectors"

test("task tool child-session link does not trigger stale show errors", async ({ page, llm, project }) => {
  test.setTimeout(120_000)

  const errs: string[] = []
  const onError = (err: Error) => {
    errs.push(err.message)
  }
  page.on("pageerror", onError)

  try {
    // ADR-046 (8c0a771376): the timeline filters parts by observability
    // domain, and the default "balanced" preset leaves the task tool's
    // "agents" domain off, so the child-session link is hidden by default.
    // This spec is about that link, so it opts the domain in. The filter
    // reads the per-domain map (settings.tsx observabilityDomain), not the
    // preset name.
    await page.addInitScript((key) => {
      const raw = localStorage.getItem(key)
      const settings = raw ? JSON.parse(raw) : {}
      settings.general = { ...settings.general, observability: { preset: "custom", domains: { agents: true } } }
      localStorage.setItem(key, JSON.stringify(settings))
    }, settingsKey)
    await project.open()
    await withSession(project.sdk, `e2e child nav ${Date.now()}`, async (session) => {
      const taskInput = {
        description: "Open child session",
        prompt: "Search the repository for AssistantParts and then reply with exactly CHILD_OK.",
        subagent_type: "general",
      }
      await llm.toolMatch(inputMatch(taskInput), "task", taskInput)
      const child = await seedSessionTask(project.sdk, {
        sessionID: session.id,
        description: taskInput.description,
        prompt: taskInput.prompt,
      })
      project.trackSession(child.sessionID)

      await project.gotoSession(session.id)

      const link = page
        .locator("a.subagent-link")
        .filter({ hasText: /open child session/i })
        .first()
      await expect(link).toBeVisible({ timeout: 30_000 })
      await link.click()

      await expect(page).toHaveURL(new RegExp(`/session/${child.sessionID}(?:[/?#]|$)`), { timeout: 30_000 })
      await expect(page.locator(promptSelector)).toBeVisible({ timeout: 30_000 })
      await expect.poll(() => errs, { timeout: 5_000 }).toEqual([])
    })
  } finally {
    page.off("pageerror", onError)
  }
})
