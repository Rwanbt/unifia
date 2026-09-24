/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"
import { closeDialog, openSettings } from "../actions"

// v110 Settings parity gate (M3 campaign, Phase 11 audit).
//
// The mockup's settings sidebar has 17 destinations. The runtime ships the
// capability-backed subset as tabs; the mockup-only destinations with no
// runtime backing (AI routing, Compute, Security, Network, System, Hooks)
// are tracked as gaps in the parity audit, not fabricated here.
//
// This gate pins two facts per tab:
//   1. the pane mounts its own content (a probe from its real copy);
//   2. the pane exposes interactive controls (button/switch/select/input).
// A tab whose data source fails still has to render, so a 503 on an
// optional endpoint must not blank the pane or trip the error boundary.

type Probe = { readonly tab: string; readonly probe: RegExp }

// Tab names follow ADR-047 (Sign In is Security, Plugins is MCP). Compute
// renders on the web build too: only its "Access to this instance" block is
// gated on `platform.getRemoteAccess`.
const TABS: readonly Probe[] = [
  { tab: "General", probe: /^Language$/ },
  { tab: "Audio", probe: /Speech to Text \(STT\)/ },
  { tab: "Shortcuts", probe: /Reset to defaults/ },
  { tab: "Providers", probe: /^Providers$/ },
  { tab: "Models", probe: /^Models$/ },
  { tab: "Configuration", probe: /Accelerator/ },
  { tab: "Security", probe: /Sign In/ },
  { tab: "Compute", probe: /^Computes$/ },
  { tab: "Benchmark", probe: /^Run$/ },
  { tab: "Observability", probe: /Data scope/ },
  { tab: "Memory", probe: /Vault/ },
  { tab: "MCP", probe: /MCP Servers/ },
]

test("every capability-backed settings tab renders its pane with real controls", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)

  for (const { tab, probe } of TABS) {
    await dialog.getByRole("tab", { name: tab, exact: true }).click()

    const panel = dialog.locator('[data-slot="tabs-content"]:visible')
    await expect(panel, `${tab} pane mounts`).toHaveCount(1)
    await expect(panel.getByText(probe).first(), `${tab} pane content`).toBeVisible()

    const controls = panel.locator("button, [role=switch], [data-slot=select-select-trigger], input")
    expect(await controls.count(), `${tab} pane exposes interactive controls`).toBeGreaterThan(0)

    await expect(page.getByRole("heading", { name: /something went wrong/i })).toHaveCount(0)
  }

  await closeDialog(page, dialog)
})
