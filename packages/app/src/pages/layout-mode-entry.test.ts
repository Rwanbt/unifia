/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// Source-level wiring check, same approach as components/team-dialog-host.test.ts:
// the provider tree cannot be rendered under bun, so the mode entry points are
// pinned by the code that connects them.
const APP = resolve(import.meta.dir, "..", "..")
const read = (rel: string) => readFileSync(resolve(APP, rel), "utf8")

describe("mode entry from the phone bar and the rail", () => {
  const layout = read("src/pages/layout.tsx")

  test("the rail and the phone bar share one selection path", () => {
    expect(layout).toMatch(/onMode=\{selectDestination\}/)
    expect(layout).toMatch(/onDestination=\{selectDestination\}/)
  })

  test("Home opens the project picker for a mode instead of only queuing it", () => {
    expect(layout).toContain('const PROJECT_MODES: readonly string[] = SHELL_MODES')
    expect(layout).toMatch(/mode\.routeKind\(\) === "home" && PROJECT_MODES\.includes\(target\)/)
    expect(layout).toMatch(/void chooseProject\(\)/)
  })

  test("a queued mode is applied only when the project came from the picker", () => {
    expect(layout).toMatch(/const fromPicker = pickedFromPicker/)
    expect(layout).toMatch(/if \(fromPicker && requested !== "code"\)/)
    expect(layout).toMatch(/onPicked: \(\) => \{\s*pickedFromPicker = true/)
    expect(layout).toMatch(/onPickerCancel: \(\) => mode\.cancelPendingMode\(\)/)
  })

  test("the project picker reports a close without a choice as a cancellation", () => {
    const actions = read("src/pages/layout/project-actions.tsx")
    expect(actions).toMatch(/if \(!settled\) resolve\(null\)/)
    expect(actions).toMatch(/deps\.onPickerCancel\?\.\(\)/)
  })
})

describe("Team model selection without the registry", () => {
  test("the panel falls back to models from connected providers", () => {
    const panel = read("src/components/team/team-panel.tsx")
    expect(panel).toMatch(/if \(registry\.length > 0\)/)
    expect(panel).toMatch(/connected\.has\(item\.provider\.id\)/)
  })
})
