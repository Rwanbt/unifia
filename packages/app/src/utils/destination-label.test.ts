/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { destinationLabelKey } from "./destination-label"

describe("destinationLabelKey", () => {
  test("names the shell mode for a mode destination", () => {
    expect(destinationLabelKey("work", "work")).toBe("workbench.modes.name.work")
  })

  test("names the page, not the mode underneath, for page destinations", () => {
    expect(destinationLabelKey("memory", "code")).toBe("sidebar.rail.memory")
    expect(destinationLabelKey("browser", "code")).toBe("sidebar.rail.browser")
    expect(destinationLabelKey("settings", "work")).toBe("sidebar.settings")
    expect(destinationLabelKey("user", "work")).toBe("sidebar.account")
  })
})
