/* SPDX-License-Identifier: MIT */

// ADR-043 — the composer's permission mode may only turn an allow into an ask.
import { describe, expect, test } from "bun:test"
import { Permission } from "../../src/permission"

const decide = (ruleset: Permission.Ruleset, permission: string, pattern = "src/app.ts") =>
  Permission.evaluate(permission, pattern, ruleset).action

const build: Permission.Ruleset = [
  { permission: "*", pattern: "*", action: "allow" },
  { permission: "external_directory", pattern: "*", action: "ask" },
]

describe("Permission.tighten", () => {
  test("ask mode makes the build agent ask before editing and running commands", () => {
    const ruleset = Permission.tighten(build, Permission.restrictedBy("ask"))
    expect(decide(ruleset, "edit")).toBe("ask")
    expect(decide(ruleset, "bash", "rm -rf dist")).toBe("ask")
    expect(decide(ruleset, "read")).toBe("allow")
    expect(decide(ruleset, "external_directory")).toBe("ask")
  })

  test("auto-edit restricts commands only, full-auto and no mode change nothing", () => {
    const autoEdit = Permission.tighten(build, Permission.restrictedBy("auto-edit"))
    expect(decide(autoEdit, "edit")).toBe("allow")
    expect(decide(autoEdit, "bash")).toBe("ask")
    expect(Permission.tighten(build, Permission.restrictedBy("full-auto"))).toEqual(build)
    expect(Permission.tighten(build, Permission.restrictedBy(undefined))).toEqual(build)
  })

  test("never loosens a deny: the chat agent keeps denying edits in ask mode", () => {
    const chat: Permission.Ruleset = [{ permission: "*", pattern: "*", action: "deny" }]
    const ruleset = Permission.tighten(chat, Permission.restrictedBy("ask"))
    expect(decide(ruleset, "edit")).toBe("deny")
    expect(decide(ruleset, "bash")).toBe("deny")
  })

  test("a later, narrower deny still wins over the inserted ask", () => {
    const agent: Permission.Ruleset = [...build, { permission: "edit", pattern: "*.env", action: "deny" }]
    const ruleset = Permission.tighten(agent, Permission.restrictedBy("ask"))
    expect(decide(ruleset, "edit", ".env")).toBe("deny")
    expect(decide(ruleset, "edit", "src/app.ts")).toBe("ask")
  })

  test("a later, narrower allow is tightened too, a narrower deny before it is kept", () => {
    const agent: Permission.Ruleset = [
      { permission: "edit", pattern: "*", action: "deny" },
      { permission: "edit", pattern: "src/*", action: "allow" },
    ]
    const ruleset = Permission.tighten(agent, Permission.restrictedBy("ask"))
    expect(decide(ruleset, "edit", "src/app.ts")).toBe("ask")
    expect(decide(ruleset, "edit", "package.json")).toBe("deny")
  })
})
