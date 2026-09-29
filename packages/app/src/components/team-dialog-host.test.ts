/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// Issue #82 - static smoke test. The provider tree cannot be rendered in
// plain Node (no @solidjs/testing-library in this package), so the wiring
// is pinned at the source level: the host must stay inside TeamProvider,
// the shell command must go through the TeamDialog context, and the
// dialog content must require useTeam() at render time.

const APP = resolve(import.meta.dir, "..", "..")
function read(rel: string): string {
  return readFileSync(resolve(APP, rel), "utf8")
}

describe("TeamDialogHost (#82)", () => {
  const host = read("src/components/team-dialog-host.tsx")

  test("renders the dialog locally with its own Kobalte root + overlay", () => {
    expect(host).toMatch(/<Kobalte modal/)
    expect(host).toMatch(/data-component="dialog-overlay"/)
    expect(host).toMatch(/<Dialog size="x-large"/)
  })

  test("lazy-imports the team dialog content", () => {
    expect(host).toMatch(/import\("@\/components\/dialog-team"\)/)
    expect(host).toMatch(/mod\.TeamDialogContent/)
  })

  test("is mounted inside TeamProvider in directory-layout.tsx", () => {
    const layout = read("src/pages/directory-layout.tsx")
    const providerIndex = layout.indexOf("<TeamProvider>")
    const hostIndex = layout.indexOf("<TeamDialogHost />")
    expect(providerIndex).toBeGreaterThan(-1)
    expect(hostIndex).toBeGreaterThan(providerIndex)
    expect(layout.indexOf("</TeamProvider>")).toBeGreaterThan(hostIndex)
  })

  test("the shell command goes through the TeamDialog context, not the shared outlet", () => {
    const page = read("src/pages/layout.tsx")
    expect(page).toMatch(/teamDialog\.open\(\)/)
    expect(page).toMatch(/if \(!decode64\(params\.dir\)\) return/)
    expect(page).not.toMatch(/dialog\.show\(\(\) => <x\.DialogTeam/)
  })

  test("the provider wraps Layout in app.tsx", () => {
    const app = read("src/app.tsx")
    const providerIndex = app.indexOf("<TeamDialogProvider>")
    const layoutIndex = app.indexOf("<Layout>{props.children}</Layout>")
    expect(providerIndex).toBeGreaterThan(-1)
    expect(layoutIndex).toBeGreaterThan(providerIndex)
  })

  test("content requires TeamProvider (useTeam) and refreshes on mount", () => {
    const content = read("src/components/dialog-team.tsx")
    expect(content).toMatch(/export function TeamDialogContent/)
    expect(content).toMatch(/useTeam\(\)/)
    expect(content).toMatch(/team\.runs\.refresh\(\)/)
  })

  test("the open flag lives in a context, not in global module state", () => {
    const ctx = read("src/context/team-dialog.tsx")
    expect(ctx).toMatch(/createSimpleContext/)
    expect(ctx).toMatch(/createSignal\(false\)/)
  })
})