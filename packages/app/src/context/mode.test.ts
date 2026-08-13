import { expect, test } from "bun:test"
import { SHELL_MODES } from "@unifia/workbench-shell/modes"

test("mode registry exposes the four navigation destinations", () => {
  expect(SHELL_MODES).toEqual(["code", "work", "design", "automate"])
})
