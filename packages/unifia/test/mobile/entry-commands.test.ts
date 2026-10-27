/* SPDX-License-Identifier: MIT */
// mobile-entry.ts is the phone's only CLI. Importing it would start the server,
// so its command list is checked from the source.
import { expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const source = fs.readFileSync(path.join(import.meta.dir, "../../src/mobile-entry.ts"), "utf8")

test("the mobile CLI exposes the toolchain and container commands", () => {
  for (const command of ["ServeCommand", "ToolchainCommand", "ContainerCommand"]) {
    expect(source).toContain(`.command(${command})`)
  }
})
