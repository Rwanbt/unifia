/* SPDX-License-Identifier: MIT */

// CodeQL js/polynomial-redos: stripping trailing newlines with /\n+$/ was
// quadratic on a body full of newlines that are not at the end.
import { describe, expect, test } from "bun:test"
import { buildDesignSkillContext, parseDesignSkillManifest } from "../src/skill-manifest"

const SKILL = `---\nname: web-prototype\ndescription: x\nscenario: design\n---\n`

describe("buildDesignSkillContext adversarial input", () => {
  test("a body with a huge run of newlines is built in linear time", () => {
    const skill = { ...parseDesignSkillManifest(SKILL), body: `${"\n".repeat(150_000)}x` }
    const start = performance.now()
    buildDesignSkillContext(skill)
    expect(performance.now() - start).toBeLessThan(750)
  })

  test("the context ends with exactly one newline", () => {
    const skill = { ...parseDesignSkillManifest(SKILL), body: "text\n\n\n" }
    const context = buildDesignSkillContext(skill)
    expect(context.endsWith("text\n")).toBe(true)
    expect(context.endsWith("\n\n")).toBe(false)
  })
})
