/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { relative, resolve, sep } from "node:path"
import { browserQuarantineTarget } from "../src/quarantine-path.js"

const ROOT = resolve("browser-quarantine-test-root")

describe("browserQuarantineTarget", () => {
  test("keeps each workspace quarantine below the configured root", () => {
    const first = browserQuarantineTarget(ROOT, "workspace-one", "report.txt")
    const second = browserQuarantineTarget(ROOT, "workspace-two", "report.txt")
    const firstRelative = relative(ROOT, first.target)
    const secondRelative = relative(ROOT, second.target)

    expect(firstRelative.startsWith(`..${sep}`)).toBe(false)
    expect(firstRelative).not.toBe("..")
    expect(secondRelative.startsWith(`..${sep}`)).toBe(false)
    expect(first.directory).not.toBe(second.directory)
  })

  test("treats traversal-shaped workspace ids as opaque identifiers", () => {
    const target = browserQuarantineTarget(ROOT, "../../outside", "report.txt")
    const pathFromRoot = relative(ROOT, target.target)

    expect(pathFromRoot.startsWith(`..${sep}`)).toBe(false)
    expect(pathFromRoot).not.toBe("..")
  })

  test.each(["", ".", "..", "../outside.txt", "..\\outside.txt", "C:\\outside.txt", "/outside.txt"])(
    "rejects unsafe download filename %s",
    (filename) => {
      expect(() => browserQuarantineTarget(ROOT, "workspace-one", filename)).toThrow("unsafe download filename")
    },
  )
})
