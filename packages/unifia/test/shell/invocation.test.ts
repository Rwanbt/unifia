/* SPDX-License-Identifier: MIT */
// The `!` shell route used to embed the command with JSON.stringify inside a
// double-quoted bash string, so `$X` and backticks expanded before `eval`
// (found on a phone, 2026-10-23: `X=1; echo $X` printed an empty line).
import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { shellArgs, singleQuoted } from "../../src/shell/invocation"

const bash = spawnSync("bash", ["-c", "echo ok"], { encoding: "utf8" }).stdout?.trim() === "ok"
const run = (command: string) => spawnSync("bash", shellArgs("bash", command), { encoding: "utf8", env: { ...process.env, HOME: "/nonexistent" } }).stdout

test("single quoting keeps quotes, dollars and backslashes literal", () => {
  expect(singleQuoted(String.raw`it's $HOME \n`)).toBe(String.raw`'it'\''s $HOME \n'`)
})

test.skipIf(!bash)("a command is evaluated as typed: variables, backticks and quotes", () => {
  expect(run('X=1; echo "X=$X"')).toBe("X=1\n")
  expect(run("Y=2\necho $Y")).toBe("2\n")
  expect(run("A=`echo late`; echo $A")).toBe("late\n")
  expect(run(`echo "it's" 'a "b"'`)).toBe(`it's a "b"\n`)
})
