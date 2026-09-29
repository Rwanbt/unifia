/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { OBSERVABILITY_DOMAINS, OBSERVABILITY_PRESETS, partDomain, toolDomain, WIRED_DOMAINS } from "./chat-observability"

const tool = (name: string, status = "completed") => ({ type: "tool", tool: name, state: { status } }) as never

describe("chat observability", () => {
  test("built-in tools land in their domain and unknown tools count as MCP tools", () => {
    expect(toolDomain("bash")).toBe("shell")
    expect(toolDomain("apply_patch")).toBe("edit")
    expect(toolDomain("todowrite")).toBe("progress")
    expect(toolDomain("websearch")).toBe("sources")
    expect(toolDomain("github_create_issue")).toBe("tools")
  })

  test("a failed step belongs to errors, the reply's text to no domain", () => {
    expect(partDomain(tool("bash", "error"))).toBe("errors")
    expect(partDomain(tool("bash"))).toBe("shell")
    expect(partDomain({ type: "reasoning", text: "x" } as never)).toBe("reasoning")
    expect(partDomain({ type: "text", text: "x" } as never)).toBeUndefined()
  })

  test("presets cover every domain and keep the trajectory shortcut even when clean", () => {
    for (const preset of Object.values(OBSERVABILITY_PRESETS)) {
      expect(Object.keys(preset).sort()).toEqual([...OBSERVABILITY_DOMAINS].sort())
    }
    expect(OBSERVABILITY_PRESETS.clean.trajectory).toBe(true)
    expect(OBSERVABILITY_PRESETS.clean.shell).toBe(false)
    expect(OBSERVABILITY_PRESETS.balanced.reasoning).toBe(false)
  })

  test("only domains with a source in Unifia are wired", () => {
    for (const domain of WIRED_DOMAINS) expect(OBSERVABILITY_DOMAINS).toContain(domain)
    expect(WIRED_DOMAINS.has("hooks")).toBe(false)
  })
})
