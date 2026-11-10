// SPDX-License-Identifier: MIT
import { expect, test } from "bun:test"
import { plan, split } from "@/cli/cmd/tui/util/editor-command"

test("split keeps a quoted path with spaces", () => {
  expect(split('"C:\\Program Files\\Code\\code.exe" --wait')).toEqual(["C:\\Program Files\\Code\\code.exe", "--wait"])
  expect(split("node script.cjs")).toEqual(["node", "script.cjs"])
  expect(split('""')).toEqual([""])
})

test("plan spawns a real executable as an argv, without a shim", () => {
  const out = plan("node script.cjs", "input.md", "win32")
  expect(out.shim).toBe(false)
  expect(out.argv.at(-1)).toBe("input.md")
  expect(out.argv[0]).not.toMatch(/\.(cmd|bat)$/i)
})

test("plan flags a Windows .cmd/.bat shim", () => {
  const out = plan("C:\\tools\\code.cmd --wait", "C:\\tmp\\input.md", "win32")
  expect(out.shim).toBe(true)
  expect(out.argv).toEqual(["C:\\tools\\code.cmd", "--wait", "C:\\tmp\\input.md"])
})

test("plan never flags a shim outside Windows", () => {
  expect(plan("C:\\tools\\code.cmd", "input.md", "linux").shim).toBe(false)
})
