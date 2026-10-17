import { test, expect } from "./fixtures"
import { modelVariantCycleSelector } from "./selectors"

test("smoke model variant cycle updates label", async ({ page, gotoSession }) => {
  await gotoSession()

  await page.addStyleTag({
    content: `${modelVariantCycleSelector} { display: inline-block !important; }`,
  })

  // The variant control is the prompt's Select (prompt-input.tsx), rendered only
  // when the current model declares variants; the e2e provider declares low and high.
  const trigger = page.locator(`${modelVariantCycleSelector} [data-action="prompt-model-variant"]`)
  await expect(trigger).toBeVisible()

  const before = (await trigger.innerText()).trim().toLowerCase()
  const next = before === "high" ? "low" : "high"
  await trigger.click()
  await page.locator('[data-slot="select-select-item"]').filter({ hasText: next }).first().click()
  await expect(trigger).not.toHaveText(new RegExp(`^${before}$`, "i"))
  await expect(trigger).toContainText(new RegExp(next, "i"))
})
