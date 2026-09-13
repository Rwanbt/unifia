/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { buildRevertDockProps } from "./revert-dock-props"

describe("buildRevertDockProps", () => {
  test("returns undefined when no items are rolled", () => {
    const props = buildRevertDockProps({
      rolled: () => [],
      restoring: () => undefined,
      reverting: () => false,
      restore: () => {},
    })

    expect(props).toBeUndefined()
  })

  test("forwards rolled items, restoring id and disabled flag verbatim", () => {
    const items = [
      { id: "a", text: "first" },
      { id: "b", text: "second" },
    ]
    const props = buildRevertDockProps({
      rolled: () => items,
      restoring: () => "a",
      reverting: () => true,
      restore: () => {},
    })

    expect(props).toBeDefined()
    expect(props?.items).toEqual(items)
    expect(props?.restoring).toBe("a")
    expect(props?.disabled).toBe(true)
    expect(typeof props?.onRestore).toBe("function")
  })

  test("onRestore delegates to the restore callback with the item id", () => {
    const restore = (id: string) => {
      expect(id).toBe("target")
    }
    const props = buildRevertDockProps({
      rolled: () => [{ id: "target", text: "x" }],
      restoring: () => undefined,
      reverting: () => false,
      restore,
    })

    props?.onRestore("target")
  })
})
