/* SPDX-License-Identifier: MIT */

import { expect, test } from "bun:test"

// Owner request 2026-11-07: Design does not announce "connected to the
// Workbench instance"; other surfaces and failure states are unchanged.
test("the Design banner stays silent once connected", async () => {
  const source = await Bun.file(new URL("./connection-banner.tsx", import.meta.url)).text()
  expect(source).toContain('const silentReady = () => props.dataAttr === "design-connection" && phase() === "ready"')
  expect(source).toContain("hidden={silentReady()}")
  expect(source).toContain('{silentReady() ? "" : phaseText()}')
})
