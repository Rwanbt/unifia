/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { agentModeIconName } from "./agent-mode"

describe("agentModeIconName (v16 agent modes)", () => {
  test("maps every runtime agent mode to its maquette glyph", () => {
    expect(agentModeIconName("chat")).toBe("chat")
    expect(agentModeIconName("plan")).toBe("plan")
    expect(agentModeIconName("debate")).toBe("debate")
    expect(agentModeIconName("build")).toBe("build")
    expect(agentModeIconName("team")).toBe("team")
    expect(agentModeIconName("auto")).toBe("auto")
  })

  test("accepts the mockup's accented débat spelling and casing", () => {
    expect(agentModeIconName("Débat")).toBe("debate")
    expect(agentModeIconName(" BUILD ")).toBe("build")
  })

  test("falls back to the chat glyph for hidden/subagent agents and empty values", () => {
    expect(agentModeIconName("explore")).toBe("chat")
    expect(agentModeIconName("orchestrator")).toBe("chat")
    expect(agentModeIconName(undefined)).toBe("chat")
    expect(agentModeIconName("")).toBe("chat")
  })
})