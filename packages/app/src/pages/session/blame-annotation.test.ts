/* SPDX-License-Identifier: MIT */

// Matrix row "Git blame annotations" (#96 slice 2): the server route + SDK
// already return `git blame --porcelain` entries; this pins the rendering
// contract the editor uses (inline annotation + hover tooltip).

import { describe, expect, test } from "bun:test"
import { BlameWidget, formatBlameAnnotation, shortBlameHash } from "@unifia/ui/code-mirror-blame"

describe("git blame annotations", () => {
  test("the inline annotation shows the author and the short hash", () => {
    expect(
      formatBlameAnnotation({
        hash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
        author: "Erwan",
        timestamp: 1_760_000_000,
        content: "const answer = 42",
      }),
    ).toBe("Erwan · a1b2c3d")
  })

  test("short hashes stay untouched and unsliced values keep their length", () => {
    expect(shortBlameHash("a1b2c3d")).toBe("a1b2c3d")
    expect(shortBlameHash("deadbeefcafebabe")).toBe("deadbee")
  })

  test("the widget DOM carries the v110 blame contract", () => {
    const element = new BlameWidget("Erwan · a1b2c3d").toDOM()
    expect(element.className).toBe("cm-blame-inline")
    expect(element.getAttribute("data-component")).toBe("blame-annotation")
    expect(element.textContent).toBe("Erwan · a1b2c3d")
  })
})
