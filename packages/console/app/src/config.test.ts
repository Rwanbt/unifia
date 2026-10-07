// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// Original work. No upstream derivation.

import { expect, test } from "bun:test"
import { installCommand, installPath, readBaseUrl } from "./config"

// Regression cover for issue #31. The rebrand fabricated `unifia.ai`, the fork
// does not hold that domain, and `config.baseUrl` shipped it as a literal that
// fed canonical links, og:url tags and three copyable install commands.

test("ReadBaseUrl_IsNullWhenUnset", () => {
  // The whole point: no fabricated fallback.
  expect(readBaseUrl(undefined)).toBeNull()
  expect(readBaseUrl(null)).toBeNull()
  expect(readBaseUrl("")).toBeNull()
  expect(readBaseUrl("   ")).toBeNull()
})

test("ReadBaseUrl_AcceptsAnHttpsOrigin", () => {
  expect(readBaseUrl("https://unifia.example")).toBe("https://unifia.example")
  expect(readBaseUrl("https://unifia.example/")).toBe("https://unifia.example")
  expect(readBaseUrl("  https://unifia.example  ")).toBe("https://unifia.example")
  expect(readBaseUrl("https://unifia.example:8443")).toBe("https://unifia.example:8443")
})

test("ReadBaseUrl_AcceptsHttpOnlyForLoopback", () => {
  expect(readBaseUrl("http://localhost:3000")).toBe("http://localhost:3000")
  expect(readBaseUrl("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000")
  expect(readBaseUrl("http://unifia.example")).toBeNull()
})

test("ReadBaseUrl_RejectsAnythingThatWouldProduceAWrongLink", () => {
  for (const raw of [
    "not a url",
    "unifia.example",
    "ftp://unifia.example",
    "javascript:alert(1)",
    "https://user:pass@unifia.example",
    "https://unifia.example/zen",
    "https://unifia.example/?a=1",
    "https://unifia.example/#x",
  ]) {
    expect(readBaseUrl(raw)).toBeNull()
  }
})

test("InstallCommand_TracksTheConfiguredOrigin", () => {
  expect(installCommand("https://unifia.example")).toBe(
    "curl -fsSL https://unifia.example/install | bash",
  )
  expect(installPath("https://unifia.example")).toBe("https://unifia.example/install")
  // No origin, no command: the surface that would have named an unowned host
  // renders nothing instead of rendering a dead link.
  expect(installCommand(null)).toBeNull()
  expect(installPath(null)).toBeNull()
})

test("InstallCommand_NeverMentionsTheUnownedDomain", () => {
  // Whatever the environment says, the fabricated domain must not be reachable
  // through these helpers, and must not be a default.
  expect(installCommand(readBaseUrl(undefined))).toBeNull()
  expect(installPath(readBaseUrl(""))).toBeNull()
})
