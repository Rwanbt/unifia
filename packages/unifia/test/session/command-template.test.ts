// SPDX-License-Identifier: MIT
import { expect, test } from "bun:test"
import { expand, resolveShell } from "../../src/session/command-template"

test("keeps the command argument placeholder behavior", () => {
  expect(expand("Describe this input: $ARGUMENTS", "two words")).toBe("Describe this input: two words")
  expect(expand("Review $1 and $2", '"first file" second third')).toBe("Review first file and second third")
  expect(expand("Inspect $1", "[Image 2] 'quoted value'")).toBe("Inspect [Image 2] quoted value")
  expect(expand("Describe the change", "extra context")).toBe("Describe the change\n\nextra context")
})

test("resolves each final shell directive through the supplied runner", async () => {
  const seen: string[] = []
  const result = await resolveShell("first !`printf one` then !`printf two`", async (command) => {
    seen.push(command)
    return command.endsWith("one") ? "1" : "2"
  })
  expect(seen).toEqual(["printf one", "printf two"])
  expect(result).toBe("first 1 then 2")
})

test("does not invoke the runner when there are no shell directives", async () => {
  const run = async () => {
    throw new Error("unexpected shell execution")
  }
  expect(await resolveShell("plain prompt", run)).toBe("plain prompt")
})
