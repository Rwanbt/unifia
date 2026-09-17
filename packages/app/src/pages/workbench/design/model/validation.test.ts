/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { createDesignDocument } from "./document"
import { DesignDocumentError } from "./errors"
import { comment, doc, frame, rect } from "./fixtures"
import { inspectDesignDocument, parseDesignDocument } from "./validation"

describe("design document validation", () => {
  test("an empty created document is valid", () => {
    const inspection = inspectDesignDocument(createDesignDocument("doc", "Doc"))
    expect(inspection.ok).toBe(true)
  })

  test("a nested container document is valid", () => {
    const document = doc([frame("f", ["a", "b"]), rect("a", { parentId: "f" }), rect("b", { parentId: "f" })])
    const inspection = inspectDesignDocument(document)
    expect(inspection.ok).toBe(true)
  })

  test("a malformed value is rejected with a located issue", () => {
    const malformed = { ...doc([rect("a")]), rootIds: [42] }
    const inspection = inspectDesignDocument(malformed)
    expect(inspection.ok).toBe(false)
    if (!inspection.ok) expect(inspection.issues.join(" ")).toContain("rootIds")
  })

  test("an unsupported schema version is rejected by the strict schema", () => {
    const inspection = inspectDesignDocument({ ...doc([rect("a")]), schemaVersion: 3 })
    expect(inspection.ok).toBe(false)
  })

  test("negative dimensions are rejected", () => {
    const broken = rect("a", { transform: { x: 0, y: 0, width: -1, height: 10, rotation: 0 } })
    const inspection = inspectDesignDocument(doc([broken]))
    expect(inspection.ok).toBe(false)
    if (!inspection.ok) expect(inspection.issues.join(" ")).toContain("width")
  })

  test("duplicate comment ids are rejected, dangling anchors are accepted", () => {
    const duplicated = { ...doc([rect("a")]), comments: [comment("c1"), comment("c1")] }
    const inspection = inspectDesignDocument(duplicated)
    expect(inspection.ok).toBe(false)
    if (!inspection.ok) expect(inspection.issues.join(" ")).toContain("duplicate id")
    // A comment outlives its node and falls back to its stored position
    // (ADR-039 section 31), so an unknown anchor is not a structure issue.
    const dangling = { ...doc([rect("a")]), comments: [comment("c1", { nodeId: "deleted-node" })] }
    expect(inspectDesignDocument(dangling).ok).toBe(true)
  })

  test("unknown properties are rejected", () => {
    const inspection = inspectDesignDocument({ ...doc([rect("a")]), extra: true })
    expect(inspection.ok).toBe(false)
  })

  test("a node key that does not match node.id is rejected", () => {
    const document = { ...doc([rect("actual")]), nodes: { wrong: rect("actual") } }
    const inspection = inspectDesignDocument(document)
    expect(inspection.ok).toBe(false)
    if (!inspection.ok) expect(inspection.issues.join(" ")).toContain("key does not match")
  })

  test("a child reference to a missing node is rejected", () => {
    const inspection = inspectDesignDocument(doc([frame("f", ["ghost"])]))
    expect(inspection.ok).toBe(false)
    if (!inspection.ok) expect(inspection.issues.join(" ")).toContain('no node "ghost"')
  })

  test("a node referenced by two containers is rejected", () => {
    const document = doc([frame("f1", ["x"]), frame("f2", ["x"]), rect("x", { parentId: "f1" })])
    const inspection = inspectDesignDocument(document)
    expect(inspection.ok).toBe(false)
    if (!inspection.ok) expect(inspection.issues.join(" ")).toContain("referenced by both")
  })

  test("a parentId that contradicts the container listing is rejected", () => {
    const document = doc([frame("f"), rect("x", { parentId: "f" })])
    const inspection = inspectDesignDocument(document)
    expect(inspection.ok).toBe(false)
    if (!inspection.ok) expect(inspection.issues.join(" ")).toContain('no container lists "x"')
  })

  test("a parentless node missing from rootIds is rejected", () => {
    const document = doc([rect("orphan")], [])
    const inspection = inspectDesignDocument(document)
    expect(inspection.ok).toBe(false)
    if (!inspection.ok) expect(inspection.issues.join(" ")).toContain("not listed in rootIds")
  })

  test("a detached cycle is rejected as unreachable", () => {
    const document = doc([frame("a", ["b"], { parentId: "b" }), frame("b", ["a"], { parentId: "a" })], [])
    const inspection = inspectDesignDocument(document)
    expect(inspection.ok).toBe(false)
    if (!inspection.ok) expect(inspection.issues.join(" ")).toContain("unreachable")
  })

  test("parseDesignDocument returns the document when valid", () => {
    const document = doc([rect("a")])
    expect(parseDesignDocument(document)).toEqual(document)
  })

  test("parseDesignDocument throws a coded error when invalid", () => {
    const error = (() => {
      try {
        parseDesignDocument({ schemaVersion: 1 })
      } catch (thrown) {
        return thrown
      }
    })()
    expect(error).toBeInstanceOf(DesignDocumentError)
    expect((error as DesignDocumentError).code).toBe("invalid-document")
  })
})
