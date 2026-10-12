/* SPDX-License-Identifier: MIT */

// A4-01: data-v110 markers on the real Code chrome (file tab bar, editor
// content, terminal panel) so future A4/A8 checks can target them without
// re-deriving selectors. No behavior change — same components file-tree.spec.ts
// already exercises, just anchored with stable markers.
//
// Deliberately does not open the terminal: ghostty-web PTY startup is a known
// CI-latency source (tracked via PLAYWRIGHT_SKIP_TERMINAL, see #71's
// diagnosis) — checking the panel is attached (it always mounts, just
// aria-hidden when closed) proves the marker exists without paying that cost.

import { test, expect } from "../fixtures"

test("code chrome markers: file tab bar, editor content, terminal panel", async ({ page, gotoSession }) => {
  await gotoSession()

  // The file-tree toggle is command-only (`command.fileTree.toggle`): the header
  // deliberately exposes no button for it, which
  // `src/pages/session/session-workspace-layout.test.ts` pins. The code scope
  // tree is already mounted in the rail, and the Inspector is the surface that
  // carries the Explorer tabs, so open that through its real control.
  const inspector = page.getByRole("button", { name: /show \/ hide the inspector/i })
  if ((await inspector.getAttribute("aria-expanded")) !== "true") await inspector.click()
  await expect(inspector).toHaveAttribute("aria-expanded", "true")

  const panel = page.locator('[data-v110="inspector-content"]')
  // v110-inspector-frame.tsx exposes exactly Explorer / Inspector / Execution
  // and its header states "one shared pane, one tab visible at a time - no
  // second Explorer, no dual-pane". The separate pill tab set with an
  // "All files" entry this test used to drive is gone; the workspace tree is
  // the Explorer tab's own content (data-v110 inspector-explorer).
  const frame = panel.locator('[data-v110="inspector-frame"]')
  const explorerTab = frame.locator('[data-v110-tab="explorer"]')
  await expect(explorerTab).toHaveAttribute("aria-selected", "true")
  const tree = panel.locator('[data-v110="inspector-explorer"]')
  const expand = async (name: string) => {
    const folder = tree.getByRole("button", { name, exact: true }).first()
    await expect(folder).toBeVisible()
    if ((await folder.getAttribute("aria-expanded")) === "false") await folder.click()
    await expect(folder).toHaveAttribute("aria-expanded", "true")
  }
  await expand("packages")
  await expand("app")
  await expand("src")
  await expand("components")

  const file = tree.getByRole("button", { name: "file-tree.tsx", exact: true }).first()
  await expect(file).toBeVisible()

  // Phase 5.1: the file tree root carries the v110 marker while the Explorer
  // pane is on screen; opening the file replaces this pane, so assert first.
  await expect(page.locator('[data-component="file-tree"]:visible').first()).toBeVisible()

  await file.click()

  // Opening a file does not, by itself, mount the editor: the Chat/Split/Editor
  // switch owns the workspace view (session-workspace-layout.test.ts pins that
  // it is deliberately not wired to Inspector visibility), so the layout has to
  // be on Editor before the code chrome exists. Measured: on Chat the main
  // surface stays "Conversation" and no code-tabs header is in the DOM.
  const layout = page.locator('[data-v110="layout-switch"]')
  await layout.getByRole("radio", { name: "Editor", exact: true }).click()
  await expect(layout.getByRole("radio", { name: "Editor", exact: true })).toHaveAttribute("aria-checked", "true")

  await expect(page.locator('[data-v110="code-tabs"]')).toBeVisible()
  await expect(page.locator('[data-v110="code-editor"]')).toBeVisible()

  // Phase 5.1: the v110 chrome selectors are mounted on the real components,
  // not only present in v110.css (they used to be dead rules).
  await expect(page.locator('[data-component="editor-pane"]')).toBeVisible()

  // Always mounted (height:0 + aria-hidden when closed), not conditionally
  // rendered — attached is the correct assertion, not visible.
  // Phase 5.3: the panel carries the canonical v110 marker (`terminal-panel`,
  // per PORTING.md) and the v110.css rule really wins the cascade.
  //
  // Which rule must win depends on where the panel sits. v110.css:974 styles the
  // bare panel as a bottom bar with `border-top: 1px solid var(--border-base)`,
  // but v110-editor.css:303 turns it into a floating card over the code area
  // with `border: 1px solid var(--v110-card-line)`, and that selector carries
  // two attribute components against one, so it wins inside the editor surface.
  // Measured on dev: the panel resolves to rgba(0, 0, 0, 0.067) in dark theme,
  // which is exactly --v110-card-line (v110-editor.css:86). Asserting
  // --border-base here was asserting the superseded bottom-bar design.
  const terminal = page.locator('[data-v110="terminal-panel"]')
  await expect(terminal).toBeAttached()
  const border = await page.evaluate(() => {
    const el = document.querySelector('[data-v110="terminal-panel"]')
    if (!el) return { actual: "", expected: "" }
    // The probe must resolve the custom property in the same context as the
    // panel: --v110-card-line is declared on a theme/editor-surface selector,
    // not on body, so a body-level probe silently falls back to rgb(0, 0, 0).
    const probe = document.createElement("div")
    probe.style.color = "var(--v110-card-line)"
    el.appendChild(probe)
    const expected = getComputedStyle(probe).color
    probe.remove()
    return { actual: getComputedStyle(el).borderTopColor, expected }
  })
  expect(border.actual).toBe(border.expected)
})

// Split out from the test above, and not passing: `WorkspaceTabsBar`
// (components/workspace-tabs-bar.tsx) is exported but has no render site
// anywhere in src — its only other references are two unit tests that read the
// file as text and two comments. So `data-component="workspace-tabs-bar"` and
// the `data-parity="shell.workspace-tabs"` anchor are styled in v110.css but
// never mounted, which is a capability declared and not wired (RB05/RB07
// territory), not a stale selector. Restored when the bar is mounted.
test.fixme("workspace tabs bar marker is styled but never rendered", async ({ page, gotoSession }) => {
  await gotoSession()
  await expect(page.locator('[data-component="workspace-tabs-bar"]')).toBeVisible()
})
