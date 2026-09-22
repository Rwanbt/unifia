/* SPDX-License-Identifier: MIT */

// A5-01..A5-05: the Work cockpit (v110 maquette `.work65-*`) and the six
// views (Overview/Tasks/Board/Timeline/Activity/Runs), picked from the
// context panel's "Work" section (ADR-040). No Team run exists in this
// harness, so the honest assertion is the gated/empty copy -- never a
// fabricated percentage, task list, event, or next action -- plus a guard
// that export survived the removal of the operations grid.
//
// Until session 5 this spec skipped on web because the surface needs the
// native workbench bridge. The established mock (fixtures/workbench-mock,
// already used by the memory and design journeys) now stands in for it, so
// the panels are exercised in web CI instead of skipped.

import { test, expect } from "../fixtures"
import { openPalette } from "../actions"
import { installWorkbenchMock } from "../fixtures/workbench-mock"
import { dirPath } from "../utils"

test("work surface's view-switcher gates the real Team-backed panels, empty state included", async ({
  page,
  directory,
  sdk,
  gotoSession,
}) => {
  await installWorkbenchMock(page, { workspaceId: "mock-workspace-1" })
  await page.setViewportSize({ width: 1400, height: 800 })
  // The backend is worker-scoped and another v110 test may have created a
  // run already. Cancel those runs so this empty-state assertion remains
  // about the fixture's state, not test execution order.
  const existing = await sdk.team.listRuns({ limit: 50 })
  for (const run of existing.data?.items ?? []) {
    if (run.status === "pending" || run.status === "running") {
      await sdk.team.cancelRun({ runID: run.runId })
    }
  }
  // Seeded navigation: the page must talk to the worker backend (with the
  // registry seed), not the unseeded harness server, before Work boots.
  await gotoSession()
  await page.goto(`${dirPath(directory)}/work`)
  // Mode surfaces render in the Split/Editor layouts only (Chat shows the
  // conversation alone, as in the maquette).
  await page.getByRole("radio", { name: "Editor" }).click()
  await expect(page.locator('[data-workbench-surface="work"]')).toBeVisible()

  await expect(page.locator('[data-v110="work-top"]')).toBeVisible()

  // Issue #100: the v65 header chip maps real run/task/gate facts. No run is
  // in flight in this harness, so it must show the mockup's all-clear state —
  // never a fabricated "At risk".
  const health = page.locator('[data-v110="work-health"]')
  await expect(health).toBeVisible()
  await expect(health).toHaveAttribute("data-work-health", "ok")
  await expect(health).toHaveText("On track")

  // ADR-040: the six mockup views are picked from the context panel's
  // "Work" section, as in the maquette -- no tab bar inside the card.
  // Pin the panel: a hover peek also shows the sections but closes as soon
  // as the pointer leaves, and the rail then intercepts the click. mod+B,
  // never the toggle button (Wave 0.5 decision, see the vault memory).
  const sidebarToggle = page.getByRole("button", { name: /toggle sidebar|basculer la barre latérale/i })
  if ((await sidebarToggle.getAttribute("aria-expanded")) !== "true") {
    await page.keyboard.press("ControlOrMeta+b")
  }
  await expect(sidebarToggle).toHaveAttribute("aria-expanded", "true")
  await expect(page.locator("[data-work-view]:visible")).toHaveCount(6)
  for (const view of ["overview", "tasks", "board", "timeline", "activity", "runs"]) {
    await expect(page.locator(`[data-work-view="${view}"]:visible`)).toBeVisible()
  }

  // Overview (default): the cockpit's six cards, honest empty states.
  await expect(page.locator('[data-work-view="overview"]:visible')).toHaveAttribute("aria-pressed", "true")
  await expect(page.locator('[data-v110="work-grid"] [data-v110="work-card"]')).toHaveCount(6)
  await expect(page.locator('[data-v110="work-grid"]').getByText(/no actionable task|aucune tâche actionnable/i)).toBeVisible()
  // Not on this view: Plan/Runs panels stay view-gated, not simultaneously visible.
  await expect(page.locator('[data-v110="work-plan-panel"]')).not.toBeVisible()
  await expect(page.locator('[data-v110="work-runs-panel"]')).not.toBeVisible()

  // Tasks view: the real DAG view, empty-state text.
  await page.locator('[data-work-view="tasks"]:visible').click()
  await expect(page.locator('[data-work-view="tasks"]:visible')).toHaveAttribute("aria-pressed", "true")
  await expect(page.locator('[data-v110="work-plan-panel"]')).toBeVisible()
  await expect(page.locator('[data-v110="work-plan-panel"]').getByText(/no tasks|aucune tâche/i)).toBeVisible()

  // Board view: real 6-status columns, honest empty state (no fake "Review"
  // column from the mockup, since the server has no such status).
  await page.locator('[data-work-view="board"]:visible').click()
  await expect(page.locator('[data-work-view="board"]:visible')).toHaveAttribute("aria-pressed", "true")
  await expect(page.locator('[data-v110="work-content"]')).toHaveAttribute("data-work-view-content", "board")
  await expect(page.locator('[data-v110="work-board-panel"]')).toBeVisible()
  await expect(page.locator('[data-v110="work-board-panel"]').getByText(/no tasks|aucune tâche/i)).toBeVisible()
  const columns = page.locator('[data-v110="work-board-column"]')
  await expect(columns).toHaveCount(6)
  await expect(page.locator('[data-v110="work-board-column"][data-status="blocked"]')).toBeVisible()
  await expect(page.locator('[data-v110="work-board-column"][data-status="cancelled"]')).toBeVisible()
  // No "review" column: the mockup's Board has one, the real status enum
  // does not.
  await expect(page.locator('[data-v110="work-board-column"][data-status="review"]')).toHaveCount(0)

  // Timeline tab: real event feed, honest empty state (no run means no events).
  await page.locator('[data-work-view="timeline"]:visible').click()
  await expect(page.locator('[data-work-view="timeline"]:visible')).toHaveAttribute("aria-pressed", "true")
  await expect(page.locator('[data-v110="work-timeline-panel"]')).toBeVisible()
  await expect(
    page.locator('[data-v110="work-timeline-panel"]').getByText(/no events|aucun événement/i),
  ).toBeVisible()

  // Activity tab: the same event feed, with a real-kind filter (not the
  // mockup's fictional edit/run/approval/artifact taxonomy).
  await page.locator('[data-work-view="activity"]:visible').click()
  await expect(page.locator('[data-work-view="activity"]:visible')).toHaveAttribute("aria-pressed", "true")
  await expect(page.locator('[data-v110="work-activity-panel"]')).toBeVisible()
  await expect(page.locator('[data-v110="work-activity-filter"]')).toBeVisible()
  await expect(
    page.locator('[data-v110="work-activity-panel"]').getByText(/no events|aucun événement/i),
  ).toBeVisible()

  // Runs tab: the real Runs list + "Open Team" reaching the real Team dialog.
  await page.locator('[data-work-view="runs"]:visible').click()
  await expect(page.locator('[data-work-view="runs"]:visible')).toHaveAttribute("aria-pressed", "true")
  await expect(page.locator('[data-v110="work-runs-panel"]')).toBeVisible()
  await expect(page.locator('[data-v110="work-runs-panel"]').getByText(/no runs|aucune exécution/i)).toBeVisible()
  await page.locator('[data-v110="work-open-team"]').click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.keyboard.press("Escape")

  // The operations grid is gone (not in the maquette); its two real actions
  // survive in the header overflow menu.
  await expect(page.locator("[data-workbench-operation]")).toHaveCount(0)
  await page.getByRole("button", { name: /more actions|plus d'actions/i }).click()
  await expect(page.locator("[data-workbench-export]")).toBeVisible()
  await expect(page.locator("[data-workbench-open-artifact]")).toBeVisible()
  await page.keyboard.press("Escape")
})


test("command palette opens the Team dialog (regression #82)", async ({ page, gotoSession }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  await gotoSession()

  // The palette entry is the pre-existing command (layout/commands.ts,
  // id "team.open", title team.selector.title = "Model", category
  // "View"). It used to render through the shared DialogOutlet at
  // RouterRoot, above TeamProvider, so DialogTeam's useTeam() threw
  // "Team context must be used within a context provider" on every use.
  const palette = await openPalette(page, "Shift+P")
  await palette.getByRole("textbox").first().fill("Model")
  const option = palette
    .getByRole("option")
    .filter({ hasText: "Model" })
    .filter({ has: page.locator("span", { hasText: /^View$/ }) })
    .first()
  await option.click()
  await expect(palette).toHaveCount(0)

  const dialog = page.getByRole("dialog").last()
  await expect(dialog).toBeVisible()
  await expect(page.getByText("Team context must be used within a context provider")).toHaveCount(0)

  await page.keyboard.press("Escape")
  await expect(dialog).not.toBeVisible()
})
