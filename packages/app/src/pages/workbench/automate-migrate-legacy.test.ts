/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import {
  buildCanonicalFromState,
  canonicalToLegacyForTest,
  migrateLegacyToCanonical,
  serializeCanonical,
} from "./automate-migrate-legacy"
import type { ParsedWorkflowDefinition } from "./automate-decode"

function legacy(steps: Array<Record<string, unknown>>, options: { id?: string; displayName?: string; description?: string } = {}): ParsedWorkflowDefinition {
  return {
    id: options.id ?? "wf-1",
    version: 1,
    displayName: options.displayName,
    description: options.description,
    steps,
  } as ParsedWorkflowDefinition
}

describe("migrateLegacyToCanonical", () => {
  test("returns an empty canonical for an empty legacy definition", () => {
    const canonical = migrateLegacyToCanonical(legacy([]))
    expect(canonical.id).toBe("wf-1")
    expect(canonical.version).toBe(2)
    expect(canonical.nodes).toHaveLength(0)
    expect(canonical.edges).toHaveLength(0)
  })

  test("lifts a single step into a single canonical node with flow edge skipped", () => {
    const canonical = migrateLegacyToCanonical(legacy([{ id: "s-1", family: "tool.http" }]))
    expect(canonical.nodes).toHaveLength(1)
    expect(canonical.nodes[0]).toMatchObject({ id: "s-1", family: "tool.http" })
    expect(canonical.edges).toHaveLength(0)
  })

  test("connects consecutive steps with kind=flow edges", () => {
    const canonical = migrateLegacyToCanonical(
      legacy([
        { id: "s-1", family: "tool.http" },
        { id: "s-2", family: "tool.transform" },
        { id: "s-3", family: "human.approval" },
      ]),
    )
    expect(canonical.nodes).toHaveLength(3)
    expect(canonical.edges).toHaveLength(2)
    expect(canonical.edges[0]).toMatchObject({ from: "s-1", to: "s-2", kind: "flow" })
    expect(canonical.edges[1]).toMatchObject({ from: "s-2", to: "s-3", kind: "flow" })
  })

  test("preserves requiresApproval in config._meta", () => {
    const canonical = migrateLegacyToCanonical(legacy([{ id: "s-1", family: "human.approval", requiresApproval: true }]))
    expect(canonical.nodes[0]?.family).toBe("human.approval")
    expect(canonical.nodes[0]?.config._meta).toMatchObject({ requiresApproval: true })
  })

  test("falls back to tool.transform when the legacy family is missing", () => {
    const canonical = migrateLegacyToCanonical(legacy([{ id: "s-1" }]))
    expect(canonical.nodes[0]?.family).toBe("tool.transform")
  })

  test("falls back to tool.transform for unknown families without throwing", () => {
    const canonical = migrateLegacyToCanonical(legacy([{ id: "s-1", family: "made.up.family" }]))
    expect(canonical.nodes[0]?.family).toBe("tool.transform")
  })

  test("uses id when displayName is missing", () => {
    const canonical = migrateLegacyToCanonical(legacy([], { id: "wf-42" }))
    expect(canonical.displayName).toBe("wf-42")
  })

  test("preserves displayName when present", () => {
    const canonical = migrateLegacyToCanonical(legacy([], { id: "wf-1", displayName: "My Workflow" }))
    expect(canonical.displayName).toBe("My Workflow")
  })

  test("preserves description when present, omits otherwise", () => {
    const withDesc = migrateLegacyToCanonical(legacy([], { description: "Daily ETL" }))
    expect(withDesc.description).toBe("Daily ETL")
    const withoutDesc = migrateLegacyToCanonical(legacy([]))
    expect(withoutDesc.description).toBeUndefined()
  })

  test("synthesises step ids when missing", () => {
    const canonical = migrateLegacyToCanonical(legacy([{ family: "tool.http" }, { family: "tool.transform" }]))
    expect(canonical.nodes[0]?.id).toBe("step-1")
    expect(canonical.nodes[1]?.id).toBe("step-2")
    expect(canonical.edges[0]?.from).toBe("step-1")
    expect(canonical.edges[0]?.to).toBe("step-2")
  })
})

describe("canonicalToLegacyForTest (round-trip)", () => {
  test("recovers id + version + steps from a canonical definition", () => {
    const canonical = migrateLegacyToCanonical(
      legacy([
        { id: "s-1", family: "tool.http" },
        { id: "s-2", family: "human.approval", requiresApproval: true },
      ]),
    )
    const roundTripped = canonicalToLegacyForTest(canonical)
    expect(roundTripped.id).toBe("wf-1")
    expect(roundTripped.version).toBe(1)
    expect(roundTripped.steps).toEqual([
      { id: "s-1", family: "tool.http" },
      { id: "s-2", family: "human.approval", requiresApproval: true },
    ])
  })

  test("omits requiresApproval when it was not set", () => {
    const canonical = migrateLegacyToCanonical(legacy([{ id: "s-1", family: "tool.http" }]))
    const roundTripped = canonicalToLegacyForTest(canonical)
    expect(roundTripped.steps[0]).toEqual({ id: "s-1", family: "tool.http" })
    expect(roundTripped.steps[0]).not.toHaveProperty("requiresApproval")
  })
})

describe("buildCanonicalFromState", () => {
  test("merges legacy steps + extra nodes in order", () => {
    const canonical = buildCanonicalFromState({
      legacy: legacy([
        { id: "s-1", family: "tool.http" },
        { id: "s-2", family: "tool.transform" },
      ]),
      positions: {},
      userEdges: [],
      extraNodes: [{ id: "lib-1", label: "If / else", requiresApproval: false, family: "control.if" }],
    })
    expect(canonical.nodes.map((n) => n.id)).toEqual(["s-1", "s-2", "lib-1"])
    expect(canonical.nodes[2]?.family).toBe("control.if")
  })

  test("stores override positions in config._meta.position", () => {
    const canonical = buildCanonicalFromState({
      legacy: legacy([{ id: "s-1", family: "tool.http" }]),
      positions: { "s-1": { x: 500, y: 120 } },
      userEdges: [],
      extraNodes: [],
    })
    expect(canonical.nodes[0]?.config._meta).toMatchObject({ position: { x: 500, y: 120 } })
  })

  test("includes user-added edges verbatim", () => {
    const canonical = buildCanonicalFromState({
      legacy: legacy([
        { id: "s-1", family: "tool.http" },
        { id: "s-2", family: "human.approval" },
      ]),
      positions: {},
      userEdges: [{ from: "s-1", to: "s-2" }],
      extraNodes: [],
    })
    expect(canonical.edges).toEqual([{ from: "s-1", to: "s-2", kind: "flow" }])
  })

  test("preserves the branch kind of user-added edges (slice 9.2)", () => {
    const canonical = buildCanonicalFromState({
      legacy: legacy([{ id: "s-1", family: "control.if" }]),
      positions: {},
      userEdges: [
        { from: "s-1", to: "s-2", kind: "branch-true" },
        { from: "s-1", to: "s-3", kind: "branch-false" },
      ],
      extraNodes: [],
    })
    expect(canonical.edges).toEqual([
      { from: "s-1", to: "s-2", kind: "branch-true" },
      { from: "s-1", to: "s-3", kind: "branch-false" },
    ])
  })

  test("carries requiresApproval from extra nodes into config._meta", () => {
    const canonical = buildCanonicalFromState({
      legacy: legacy([]),
      positions: {},
      userEdges: [],
      extraNodes: [{ id: "lib-approval", label: "Approval", requiresApproval: true, family: "human.approval" }],
    })
    expect(canonical.nodes[0]?.config._meta).toMatchObject({ requiresApproval: true })
  })

  test("falls back to tool.transform for unknown families in extra nodes", () => {
    const canonical = buildCanonicalFromState({
      legacy: legacy([]),
      positions: {},
      userEdges: [],
      extraNodes: [{ id: "lib-x", label: "Custom", requiresApproval: false, family: "made.up" }],
    })
    expect(canonical.nodes[0]?.family).toBe("tool.transform")
  })
})

describe("serializeCanonical", () => {
  test("produces parseable JSON with version 2", () => {
    const canonical = migrateLegacyToCanonical(legacy([{ id: "s-1", family: "tool.http" }]))
    const json = serializeCanonical(canonical)
    const parsed = JSON.parse(json) as Record<string, unknown>
    expect(parsed.version).toBe(2)
    expect(parsed.nodes).toHaveLength(1)
  })

  test("round-trips through parseCanonicalWorkflowDefinition", () => {
    const canonical = buildCanonicalFromState({
      legacy: legacy([
        { id: "s-1", family: "tool.http" },
        { id: "s-2", family: "human.approval", requiresApproval: true },
      ]),
      positions: { "s-1": { x: 100, y: 50 } },
      userEdges: [{ from: "s-1", to: "s-2" }],
      extraNodes: [],
    })
    const json = serializeCanonical(canonical)
    const parsed = JSON.parse(json) as Record<string, unknown>
    expect(parsed.version).toBe(2)
    expect((parsed.nodes as unknown[]).length).toBe(2)
    expect((parsed.edges as unknown[]).length).toBe(1)
  })
})
