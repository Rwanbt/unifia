/* SPDX-License-Identifier: MIT */

import type { Part } from "../types/sdk-shim"

// What the conversation shows of a reply's work (ADR-046). The full trace
// stays recorded per session; these domains only filter the timeline.

export const OBSERVABILITY_DOMAINS = [
  "reasoning",
  "progress",
  "shell",
  "edit",
  "artifact",
  "approval",
  "question",
  "agents",
  "skills",
  "tools",
  "context",
  "memory",
  "browser",
  "sources",
  "tests",
  "git",
  "process",
  "errors",
  "routing",
  "policy",
  "hooks",
  "compaction",
  "usage",
  "trajectory",
] as const

export type ObservabilityDomain = (typeof OBSERVABILITY_DOMAINS)[number]
export type ObservabilityPreset = "clean" | "balanced" | "full" | "custom"
export type ObservabilityFilter = (domain: ObservabilityDomain) => boolean

// Domains Unifia has something to show for. The others are listed so the
// settings match the reference, but a switch for them would change nothing.
export const WIRED_DOMAINS: ReadonlySet<ObservabilityDomain> = new Set([
  "reasoning",
  "progress",
  "shell",
  "edit",
  "question",
  "agents",
  "skills",
  "tools",
  "context",
  "memory",
  "sources",
  "tests",
  "git",
  "errors",
  "compaction",
  "usage",
  "trajectory",
])

const all = (value: boolean) =>
  Object.fromEntries(OBSERVABILITY_DOMAINS.map((domain) => [domain, value])) as Record<ObservabilityDomain, boolean>

// Values copied from the reference's presets.
export const OBSERVABILITY_PRESETS: Record<Exclude<ObservabilityPreset, "custom">, Record<ObservabilityDomain, boolean>> = {
  clean: { ...all(false), trajectory: true },
  balanced: {
    ...all(false),
    progress: true,
    shell: true,
    edit: true,
    artifact: true,
    approval: true,
    question: true,
    browser: true,
    sources: true,
    tests: true,
    git: true,
    errors: true,
    routing: true,
    usage: true,
    trajectory: true,
  },
  full: all(true),
}

const TOOL_DOMAINS: Record<string, ObservabilityDomain> = {
  bash: "shell",
  edit: "edit",
  write: "edit",
  multiedit: "edit",
  apply_patch: "edit",
  todowrite: "progress",
  todoread: "progress",
  plan_enter: "progress",
  plan_exit: "progress",
  question: "question",
  task: "agents",
  team: "agents",
  debate: "agents",
  skill: "skills",
  read: "context",
  glob: "context",
  grep: "context",
  list: "context",
  memory_read: "memory",
  memory_search: "memory",
  memory_write: "memory",
  webfetch: "sources",
  websearch: "sources",
  codesearch: "sources",
  lsp: "tests",
}

/** Built-in tools map to their domain; anything else is an MCP or plugin tool. */
export function toolDomain(tool: string): ObservabilityDomain {
  return TOOL_DOMAINS[tool] ?? "tools"
}

/** The domain a part belongs to, or undefined for the reply's own text. */
export function partDomain(part: Part): ObservabilityDomain | undefined {
  if (part.type === "reasoning") return "reasoning"
  if (part.type === "compaction") return "compaction"
  if (part.type !== "tool") return undefined
  if (part.state.status === "error") return "errors"
  return toolDomain(part.tool)
}
