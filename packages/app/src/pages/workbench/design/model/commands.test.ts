/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { applyCommand } from "./reducer"
import { childrenOf, doc, expectError, frame, rect, zeroTransform } from "./fixtures"
import type { DesignDocumentV1 } from "./schema"

function nested(): DesignDocumentV1 {
  return doc([frame("f", ["a", "b"]), rect("a", { parentId: "f" }), rect("b", { parentId: "f" }), rect("root")])
}

describe("design command reducer", () => {
  test("insertNode appends to rootIds by default", () => {
    const next = applyCommand(doc([]), { kind: "insertNode", node: rect("a"), parentId: null })
    expect(next.rootIds).toEqual(["a"])
    expect(next.nodes.a.parentId).toBeNull()
  })

  test("insertNode respects and clamps the index", () => {
    const base = doc([rect("a"), rect("b")])
    const first = applyCommand(base, { kind: "insertNode", node: rect("c"), parentId: null, index: 0 })
    expect(first.rootIds).toEqual(["c", "a", "b"])
    const clamped = applyCommand(base, { kind: "insertNode", node: rect("c"), parentId: null, index: 99 })
    expect(clamped.rootIds).toEqual(["a", "b", "c"])
  })

  test("insertNode rejects an existing id", () => {
    const error = expectError(() => applyCommand(doc([rect("a")]), { kind: "insertNode", node: rect("a"), parentId: null }))
    expect(error.code).toBe("duplicate-id")
  })

  test("insertNode rejects a container carrying children", () => {
    const error = expectError(() =>
      applyCommand(doc([]), { kind: "insertNode", node: frame("f", ["a"]), parentId: null }),
    )
    expect(error.code).toBe("invalid-child-ids")
  })

  test("insertNode rejects a missing or non-container parent", () => {
    const missing = expectError(() =>
      applyCommand(doc([]), { kind: "insertNode", node: rect("a"), parentId: "ghost" }),
    )
    expect(missing.code).toBe("parent-not-found")
    const notContainer = expectError(() =>
      applyCommand(doc([rect("r")]), { kind: "insertNode", node: rect("a"), parentId: "r" }),
    )
    expect(notContainer.code).toBe("parent-not-container")
  })

  test("deleteNode removes the node and its subtree", () => {
    const next = applyCommand(nested(), { kind: "deleteNode", id: "f" })
    expect(next.rootIds).toEqual(["root"])
    expect(Object.keys(next.nodes)).toEqual(["root"])
  })

  test("deleteNode unlinks a child from its container", () => {
    const next = applyCommand(nested(), { kind: "deleteNode", id: "a" })
    expect(childrenOf(next, "f")).toEqual(["b"])
    expect(next.nodes.a).toBeUndefined()
  })

  test("deleteNode refuses a locked node", () => {
    const base = doc([rect("a", { locked: true })])
    expect(expectError(() => applyCommand(base, { kind: "deleteNode", id: "a" })).code).toBe("node-locked")
  })

  test("updateNode renames, toggles visibility and lock state", () => {
    const base = doc([rect("a")])
    const renamed = applyCommand(base, { kind: "updateNode", id: "a", name: "Hero" })
    expect(renamed.nodes.a.name).toBe("Hero")
    const hidden = applyCommand(renamed, { kind: "updateNode", id: "a", visible: false })
    expect(hidden.nodes.a.visible).toBe(false)
    const locked = applyCommand(hidden, { kind: "setLocked", id: "a", locked: true })
    expect(locked.nodes.a.locked).toBe(true)
    const unlocked = applyCommand(locked, { kind: "setLocked", id: "a", locked: false })
    expect(unlocked.nodes.a.locked).toBe(false)
  })

  test("updateTransform persists canonical geometry", () => {
    const base = doc([rect("a")])
    const next = applyCommand(base, {
      kind: "updateTransform",
      id: "a",
      transform: { x: 5, y: 6, width: 40, height: 30, rotation: 15 },
    })
    expect(next.nodes.a.transform).toEqual({ x: 5, y: 6, width: 40, height: 30, rotation: 15 })
  })

  test("updateTransform rejects non-finite and negative values", () => {
    const base = doc([rect("a")])
    const negative = expectError(() =>
      applyCommand(base, { kind: "updateTransform", id: "a", transform: { ...zeroTransform, width: -1 } }),
    )
    expect(negative.code).toBe("invalid-transform")
    const notFinite = expectError(() =>
      applyCommand(base, { kind: "updateTransform", id: "a", transform: { ...zeroTransform, x: Number.NaN } }),
    )
    expect(notFinite.code).toBe("invalid-transform")
  })

  test("updateTransform refuses a locked node", () => {
    const base = doc([rect("a", { locked: true })])
    const error = expectError(() =>
      applyCommand(base, { kind: "updateTransform", id: "a", transform: zeroTransform }),
    )
    expect(error.code).toBe("node-locked")
  })

  test("updatePoints rewrites a path's data and bounding box", () => {
    const base = doc([
      {
        id: "p",
        name: "p",
        parentId: null,
        visible: true,
        locked: false,
        type: "path",
        transform: { x: 10, y: 10, width: 60, height: 60, rotation: 0 },
        d: "M 0 0 L 60 0 L 60 60",
      },
    ])
    const next = applyCommand(base, {
      kind: "updatePoints",
      id: "p",
      points: [
        { x: 40, y: 30 },
        { x: 70, y: 60 },
        { x: 70, y: 120 },
      ],
    })
    expect(next.nodes.p).toMatchObject({
      transform: { x: 40, y: 30, width: 30, height: 90, rotation: 0 },
      d: "M 0 0 L 30 30 L 30 90",
    })
  })

  test("updatePoints rewrites a line's local points", () => {
    const base = doc([
      {
        id: "l",
        name: "l",
        parentId: null,
        visible: true,
        locked: false,
        type: "line",
        transform: { x: 0, y: 0, width: 10, height: 10, rotation: 0 },
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
      },
    ])
    const next = applyCommand(base, {
      kind: "updatePoints",
      id: "l",
      points: [
        { x: 5, y: 5 },
        { x: 25, y: 5 },
      ],
    })
    expect(next.nodes.l).toMatchObject({
      transform: { x: 5, y: 5, width: 20, height: 0, rotation: 0 },
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
      ],
    })
  })

  test("updatePoints refuses non-polyline, rotated, short and locked targets", () => {
    expect(
      expectError(() =>
        applyCommand(doc([rect("a")]), {
          kind: "updatePoints",
          id: "a",
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
        }),
      ).code,
    ).toBe("not-editable")
    const rotated = doc([
      {
        id: "p",
        name: "p",
        parentId: null,
        visible: true,
        locked: false,
        type: "path",
        transform: { x: 0, y: 0, width: 10, height: 10, rotation: 45 },
        d: "M 0 0 L 10 10",
      },
    ])
    expect(
      expectError(() =>
        applyCommand(rotated, {
          kind: "updatePoints",
          id: "p",
          points: [
            { x: 0, y: 0 },
            { x: 20, y: 20 },
          ],
        }),
      ).code,
    ).toBe("not-editable")
    const path = doc([
      {
        id: "p",
        name: "p",
        parentId: null,
        visible: true,
        locked: false,
        type: "path",
        transform: { x: 0, y: 0, width: 10, height: 10, rotation: 0 },
        d: "M 0 0 L 10 10",
      },
    ])
    expect(
      expectError(() => applyCommand(path, { kind: "updatePoints", id: "p", points: [{ x: 0, y: 0 }] })).code,
    ).toBe("invalid-points")
    const locked = doc([
      {
        id: "p",
        name: "p",
        parentId: null,
        visible: true,
        locked: true,
        type: "path",
        transform: { x: 0, y: 0, width: 10, height: 10, rotation: 0 },
        d: "M 0 0 L 10 10",
      },
    ])
    expect(
      expectError(() =>
        applyCommand(locked, {
          kind: "updatePoints",
          id: "p",
          points: [
            { x: 0, y: 0 },
            { x: 20, y: 20 },
          ],
        }),
      ).code,
    ).toBe("node-locked")
  })

  test("reorderNode moves within siblings and clamps", () => {
    const base = doc([rect("a"), rect("b"), rect("c")])
    expect(applyCommand(base, { kind: "reorderNode", id: "a", toIndex: 2 }).rootIds).toEqual(["b", "c", "a"])
    expect(applyCommand(base, { kind: "reorderNode", id: "a", toIndex: 99 }).rootIds).toEqual(["b", "c", "a"])
    expect(applyCommand(base, { kind: "reorderNode", id: "b", toIndex: 1 })).toBe(base)
  })

  test("reparentNode moves a node into a container and back to root", () => {
    const base = doc([frame("f"), rect("a")])
    const inside = applyCommand(base, { kind: "reparentNode", id: "a", parentId: "f" })
    expect(childrenOf(inside, "f")).toEqual(["a"])
    expect(inside.nodes.a.parentId).toBe("f")
    expect(inside.rootIds).toEqual(["f"])
    const back = applyCommand(inside, { kind: "reparentNode", id: "a", parentId: null })
    expect(back.rootIds).toEqual(["f", "a"])
    expect(back.nodes.a.parentId).toBeNull()
    expect(childrenOf(back, "f")).toEqual([])
  })

  test("reparentNode reorders within the same parent", () => {
    const base = nested()
    const next = applyCommand(base, { kind: "reparentNode", id: "a", parentId: "f", index: 1 })
    expect(childrenOf(next, "f")).toEqual(["b", "a"])
  })

  test("reparentNode rejects cycles and locked participants", () => {
    const cyclic = doc([frame("f", ["g"]), frame("g", ["h"], { parentId: "f" }), rect("h", { parentId: "g" })])
    const cycle = expectError(() => applyCommand(cyclic, { kind: "reparentNode", id: "f", parentId: "g" }))
    expect(cycle.code).toBe("cycle")
    const self = expectError(() => applyCommand(nested(), { kind: "reparentNode", id: "f", parentId: "f" }))
    expect(self.code).toBe("cycle")
    const lockedTarget = expectError(() =>
      applyCommand(doc([frame("f", [], { locked: true }), rect("a")]), { kind: "reparentNode", id: "a", parentId: "f" }),
    )
    expect(lockedTarget.code).toBe("target-locked")
    const lockedSource = expectError(() =>
      applyCommand(doc([rect("a", { locked: true })]), { kind: "reparentNode", id: "a", parentId: null }),
    )
    expect(lockedSource.code).toBe("node-locked")
  })

  test("duplicateNode inserts a copy after the original", () => {
    const base = doc([rect("a"), rect("b")])
    const next = applyCommand(base, { kind: "duplicateNode", id: "a", ids: { a: "a-copy" } })
    expect(next.rootIds).toEqual(["a", "a-copy", "b"])
    expect(next.nodes["a-copy"].name).toBe("a copy")
    expect(next.nodes["a-copy"].parentId).toBeNull()
  })

  test("duplicateNode remaps the subtree ids and parents", () => {
    const base = nested()
    const next = applyCommand(base, {
      kind: "duplicateNode",
      id: "f",
      ids: { f: "f2", a: "a2", b: "b2" },
    })
    expect(next.rootIds).toEqual(["f", "f2", "root"])
    expect(childrenOf(next, "f2")).toEqual(["a2", "b2"])
    expect(next.nodes.a2.parentId).toBe("f2")
    expect(next.nodes.a2.name).toBe("a")
  })

  test("duplicateNode requires a complete id map with unique targets", () => {
    const missing = expectError(() =>
      applyCommand(nested(), { kind: "duplicateNode", id: "f", ids: { f: "f2", a: "a2" } }),
    )
    expect(missing.code).toBe("missing-new-id")
    const colliding = expectError(() =>
      applyCommand(nested(), { kind: "duplicateNode", id: "f", ids: { f: "a", a: "a2", b: "b2" } }),
    )
    expect(colliding.code).toBe("duplicate-id")
    const twice = expectError(() =>
      applyCommand(nested(), { kind: "duplicateNode", id: "f", ids: { f: "f2", a: "f2", b: "b2" } }),
    )
    expect(twice.code).toBe("duplicate-id")
  })

  test("duplicateNode refuses a locked node", () => {
    const base = doc([rect("a", { locked: true })])
    expect(expectError(() => applyCommand(base, { kind: "duplicateNode", id: "a", ids: { a: "a2" } })).code).toBe(
      "node-locked",
    )
  })

  test("commands never mutate the input document", () => {
    const base = nested()
    const frozen = JSON.stringify(base)
    applyCommand(base, { kind: "deleteNode", id: "f" })
    applyCommand(base, { kind: "reorderNode", id: "root", toIndex: 0 })
    applyCommand(base, { kind: "duplicateNode", id: "a", ids: { a: "a2" } })
    expect(JSON.stringify(base)).toBe(frozen)
  })
})
