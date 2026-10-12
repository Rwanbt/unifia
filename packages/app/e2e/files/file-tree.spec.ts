import { test, expect } from "../fixtures"
import { openInspector } from "../v110/inspector"

test("file tree can expand folders and open a file", async ({ page, gotoSession }) => {
  await gotoSession()

  // v110: Explorer and Inspector share one InspectorFrame pane now (session-side-panel.tsx), opened by the
  // inspector toggle in the Editor layout.
  const toggle = page.locator('[data-v110="inspector-toggle"]')
  const panel = page.locator('[data-v110="inspector-content"]')
  // The Explorer is one tree now, with no "All files" / "Changes" tabs.
  const tree = panel

  await openInspector(page, "explorer")
  await expect(panel).toBeVisible()
  await expect(tree).toBeVisible()

  const expand = async (name: string) => {
    const folder = tree.getByRole("button", { name, exact: true }).first()
    await expect(folder).toBeVisible()
    await expect(folder).toHaveAttribute("aria-expanded", /true|false/)
    if ((await folder.getAttribute("aria-expanded")) === "false") await folder.click()
    await expect(folder).toHaveAttribute("aria-expanded", "true")
  }

  await expand("packages")
  await expand("app")
  await expand("src")
  await expand("components")

  const file = tree.getByRole("button", { name: "file-tree.tsx", exact: true }).first()
  await expect(file).toBeVisible()
  await file.click()

  const tab = page.getByRole("tab", { name: "file-tree.tsx" })
  await expect(tab).toBeVisible()
  await tab.click()
  await expect(tab).toHaveAttribute("aria-selected", "true")

  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "false")

  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")

  // v110: Explorer and Inspector are one pane, one tab at a time — reopening
  // via the file-tree toggle lands back on Explorer (the tree), not the file
  // that was open before it closed. The toggle buttons only open/close (see
  // e2e/commands/panels.spec.ts); switch tabs via InspectorFrame's own
  // tablist to verify the file itself is still there, open and unmodified.
  await page.locator('[data-v110="inspector-frame"] [data-v110-tab="inspector"]').click()
  await expect(tab).toHaveAttribute("aria-selected", "true")

  const viewer = page.locator('[data-component="file"][data-mode="text"]').first()
  await expect(viewer).toBeVisible()
  await expect(viewer).toContainText("export default function FileTree")
})
