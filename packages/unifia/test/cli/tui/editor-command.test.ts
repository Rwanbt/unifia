// SPDX-License-Identifier: MIT
import { expect, test } from "bun:test"
import path from "node:path"
import { plan, quote, split } from "@/cli/cmd/tui/util/editor-command"
import { Process } from "@/util/process"
import { tmpdir } from "../../fixture/fixture"

test("split keeps a quoted path with spaces", () => {
  expect(split('"C:\\Program Files\\Code\\code.exe" --wait')).toEqual(["C:\\Program Files\\Code\\code.exe", "--wait"])
  expect(split("node script.cjs")).toEqual(["node", "script.cjs"])
  expect(split('""')).toEqual([""])
})

test("quote wraps metacharacters so cmd cannot split the command", () => {
  for (const arg of ["a&b", "a|b", "a>b", "a<b", "a^b", "a b"])
    expect(quote(arg)).toBe(`"${arg}"`)
})

test("quote refuses characters it cannot neutralise", () => {
  for (const arg of ['a"b', "a%b", "a\rb", "a\nb"])
    expect(() => quote(arg)).toThrow(/cannot be quoted safely/)
})

test("plan spawns a real executable as an argv, without a shell", () => {
  const out = plan("node script.cjs", "input.md", "win32")
  expect(out.shell).toBe(false)
  if (out.shell) throw new Error("unreachable")
  expect(out.argv.at(-1)).toBe("input.md")
  expect(out.argv[0]).not.toMatch(/\.(cmd|bat)$/i)
})

test("plan reserves the shell for a Windows .cmd/.bat shim", () => {
  const out = plan("C:\\tools\\code.cmd --wait", "C:\\tmp\\input.md", "win32")
  expect(out.shell).toBe(true)
  if (!out.shell) throw new Error("unreachable")
  expect(out.line).toBe('"C:\\tools\\code.cmd" "--wait" "C:\\tmp\\input.md"')
})

test("plan never uses a shell outside Windows", () => {
  expect(plan("C:\\tools\\code.cmd", "input.md", "linux").shell).toBe(false)
})

test.skipIf(process.platform !== "win32")("a .cmd shim receives a metacharacter argument as one command", async () => {
  await using tmp = await tmpdir()
  const shim = path.join(tmp.path, "passthrough.cmd")
  await Bun.write(shim, "@echo off\r\nexit /b 7\r\n")

  const out = plan(`"${shim}" a&b`, path.join(tmp.path, "input.md"))
  expect(out.shell).toBe(true)
  if (!out.shell) throw new Error("unreachable")

  // A bare `a&b` would make cmd run `b` as a second command and lose the exit
  // code; the strict quoting keeps it one argument for the shim.
  const proc = Process.spawnShell([out.line], { shell: true, stdout: "ignore", stderr: "ignore" })
  expect(await proc.exited).toBe(7)
})
