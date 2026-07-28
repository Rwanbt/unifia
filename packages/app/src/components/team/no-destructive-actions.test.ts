import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { teamCapabilities } from "@/context/team"

// Guard for the TEAM-M04 criterion "no accidental approval".
//
// On a phone, every control is one thumb away from being pressed by mistake,
// and the Team surface is where a gate would be approved or a run cancelled.
// Today it can do neither: nothing in the application constructs a Team run
// (R-WIRING-001), so the surface is read-only and there is nothing to approve.
//
// That is a property worth pinning rather than assuming. This test fails the
// moment an interactive control appears that is not on the known-safe list, so
// an approval or cancellation button cannot arrive quietly in a later change —
// it has to arrive together with a deliberate edit to this file.

const DIRECTORY = import.meta.dir

/**
 * Every click handler the Team components may bind.
 *
 * Navigation and selection only. Nothing here mutates server state; the most
 * consequential is `onSaveDefault`, which writes a local preference.
 */
const ALLOWED_HANDLERS = new Set(["onMore", "onPick", "onSaveDefault", "onClearOverride", "onSelect"])

/** Words that would name an action this surface must not be able to perform. */
const FORBIDDEN = ["approve", "reject", "cancel", "abort", "delete", "destroy", "start", "pause", "resume", "retryRun"]

function componentSources(): { name: string; content: string }[] {
  return readdirSync(DIRECTORY, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
    .map((entry) => ({ name: entry.name, content: readFileSync(join(DIRECTORY, entry.name), "utf8") }))
}

describe("the Team surface exposes no destructive control", () => {
  test("there are components to check, so the assertions below are not vacuous", () => {
    expect(componentSources().length).toBeGreaterThan(0)
  })

  test("every click handler is on the known-safe list", () => {
    const unexpected: string[] = []
    for (const source of componentSources()) {
      for (const match of source.content.matchAll(/onClick=\{[^}]*?props\.(\w+)/g)) {
        if (!ALLOWED_HANDLERS.has(match[1])) unexpected.push(`${source.name}: ${match[1]}`)
      }
    }

    expect(unexpected).toEqual([])
  })

  test("no prop names an approval, cancellation or deletion", () => {
    // Catches the case a handler is added under a new name rather than bound
    // through props.<known>.
    const found: string[] = []
    for (const source of componentSources()) {
      for (const word of FORBIDDEN) {
        const pattern = new RegExp(`\\bon${word[0].toUpperCase()}${word.slice(1)}\\b`)
        if (pattern.test(source.content)) found.push(`${source.name}: on${word}`)
      }
    }

    expect(found).toEqual([])
  })

  test("the capability set itself refuses every lifecycle action", () => {
    // The structural check above is about what is rendered; this is about what
    // the state layer would permit even if something were rendered.
    for (const reachability of ["ok", "offline", "unavailable", "error"] as const) {
      const capabilities = teamCapabilities(reachability)
      expect(capabilities.canStart).toBe(false)
      expect(capabilities.canPause).toBe(false)
      expect(capabilities.canCancel).toBe(false)
    }
  })
})
