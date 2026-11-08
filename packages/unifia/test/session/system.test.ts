import { describe, expect, test } from "bun:test"
import path from "path"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { SystemPrompt } from "../../src/session/system"
import { ProviderID } from "../../src/provider/schema"
import { tmpdir } from "../fixture/fixture"

const cloud = { providerID: ProviderID.make("anthropic") }
const local = { providerID: ProviderID.make("local-llm") }

describe("session.system", () => {
  test("skills output is sorted by name and stable across calls", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        for (const [name, description] of [
          ["zeta-skill", "Zeta skill."],
          ["alpha-skill", "Alpha skill."],
          ["middle-skill", "Middle skill."],
        ]) {
          const skillDir = path.join(dir, ".opencode", "skill", name)
          await Bun.write(
            path.join(skillDir, "SKILL.md"),
            `---
name: ${name}
description: ${description}
---

# ${name}
`,
          )
        }
      },
    })

    const home = process.env.UNIFIA_TEST_HOME
    process.env.UNIFIA_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const build = await Agent.get("build")
          const first = await SystemPrompt.skills(build!, cloud)
          const second = await SystemPrompt.skills(build!, cloud)

          expect(first).toBe(second)

          const alpha = first!.indexOf("<name>alpha-skill</name>")
          const middle = first!.indexOf("<name>middle-skill</name>")
          const zeta = first!.indexOf("<name>zeta-skill</name>")

          expect(alpha).toBeGreaterThan(-1)
          expect(middle).toBeGreaterThan(alpha)
          expect(zeta).toBeGreaterThan(middle)

          // A local model never receives the skills catalog: it can exceed the
          // model's whole context window on its own.
          expect(await SystemPrompt.skills(build!, local)).toBeUndefined()
        },
      })
    } finally {
      process.env.UNIFIA_TEST_HOME = home
    }
  })
})
