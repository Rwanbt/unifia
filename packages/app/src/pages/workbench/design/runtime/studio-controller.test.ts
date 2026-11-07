/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import type { DesignCommand } from "../model/commands"
import { doc, frame, line, rect } from "../model/fixtures"
import { applyCommand } from "../model/reducer"
import type { DesignDocumentV1, DesignNodeId } from "../model/schema"
import { createDesignStudioController } from "./studio-controller"
import { deletableIds } from "./studio-actions"

/**
 * Drives the controller against the real reducer: every dispatched command
 * is recorded and applied, so a test asserts both the command the studio
 * emits and the document that results.
 */
function harness(initial: DesignDocumentV1, selected: readonly DesignNodeId[] = []) {
  return createRoot((dispose) => {
    const [document, setDocument] = createSignal(initial)
    const [selection, setSelection] = createSignal<readonly DesignNodeId[]>(selected)
    const commands: DesignCommand[] = []
    let next = 0
    const controller = createDesignStudioController({
      document,
      selection,
      setSelection: (ids) => setSelection(ids),
      dispatch: (command) => {
        commands.push(command)
        setDocument(applyCommand(document(), command))
      },
      locale: () => "en",
      newId: () => `new-${++next}`,
      capture: () => undefined,
      setViewport: () => {},
      stageSize: () => ({ width: 1000, height: 800 }),
      download: () => {},
    })
    return { controller, document, selection, commands, dispose }
  })
}

describe("delete: deletableIds", () => {
  test("keeps existing unlocked ids and drops a descendant of a selected container", () => {
    const document = doc([frame("f", ["a"]), rect("a", { parentId: "f" }), rect("b"), rect("c", { locked: true })])
    expect(deletableIds(document, ["f", "a", "b", "c", "ghost"])).toEqual(["f", "b"])
  })

  test("an empty or all-locked selection has nothing to delete", () => {
    expect(deletableIds(doc([rect("a", { locked: true })]), ["a"])).toEqual([])
    expect(deletableIds(doc([rect("a")]), [])).toEqual([])
  })
})

describe("delete: controller.deleteSelection", () => {
  test("removes the selection as one deleteNodes command and clears it", () => {
    const h = harness(doc([rect("a"), rect("b"), rect("c")]), ["a", "b"])
    expect(h.controller.canDelete()).toBe(true)
    h.controller.deleteSelection()
    expect(h.commands).toEqual([{ kind: "deleteNodes", ids: ["a", "b"] }])
    expect(h.document().rootIds).toEqual(["c"])
    expect(h.selection()).toEqual([])
    h.dispose()
  })

  test("skips locked nodes, which stay selected", () => {
    const h = harness(doc([rect("a"), rect("b", { locked: true })]), ["a", "b"])
    h.controller.deleteSelection()
    expect(h.commands).toEqual([{ kind: "deleteNodes", ids: ["a"] }])
    expect(h.selection()).toEqual(["b"])
    h.dispose()
  })

  test("an all-locked selection dispatches nothing and explains why", () => {
    const h = harness(doc([rect("a", { locked: true })]), ["a"])
    expect(h.controller.canDelete()).toBe(false)
    h.controller.deleteSelection()
    expect(h.commands).toEqual([])
    expect(h.controller.notice()).toBe("Locked elements cannot be deleted")
    h.dispose()
  })

  test("no selection is a no-op without a notice", () => {
    const h = harness(doc([rect("a")]))
    h.controller.deleteSelection()
    expect(h.commands).toEqual([])
    expect(h.controller.notice()).toBeUndefined()
    h.dispose()
  })
})

describe("vector: convert the selected shape into a path", () => {
  test("a selected line converts in place to a path with the same id", () => {
    const h = harness(doc([line("l")]), ["l"])
    expect(h.controller.canVectorize()).toBe(true)
    h.controller.run("vector")
    expect(h.commands.map((command) => command.kind)).toEqual(["replaceNode"])
    expect(h.document().nodes.l?.type).toBe("path")
    expect(h.controller.notice()).toBe("Converted to an editable path")
    h.dispose()
  })

  test("nothing, several nodes, a locked shape or a frame is not convertible", () => {
    for (const [nodes, selected] of [
      [[rect("a")], []],
      [[rect("a"), rect("b")], ["a", "b"]],
      [[rect("a", { locked: true })], ["a"]],
      [[frame("f")], ["f"]],
    ] as const) {
      const h = harness(doc([...nodes]), selected)
      expect(h.controller.canVectorize()).toBe(false)
      h.controller.run("vector")
      expect(h.commands).toEqual([])
      expect(h.controller.notice()).toBe("Select a rectangle, an ellipse or a line to convert it")
      h.dispose()
    }
  })
})
describe("text: controller.addText", () => {
  test("inserts one text at the point, selects it and opens Modify", () => {
    const h = harness(doc([rect("a")]), ["a"])
    h.controller.addText({ x: 40, y: 50 })
    expect(h.commands.map((command) => command.kind)).toEqual(["insertNode"])
    expect(h.document().nodes["new-1"]).toMatchObject({ type: "text", text: "Text", transform: { x: 40, y: 50 } })
    expect(h.selection()).toEqual(["new-1"])
    expect(h.controller.panel()).toBe("modify")
    h.dispose()
  })
})