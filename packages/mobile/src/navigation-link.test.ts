/* SPDX-License-Identifier: MIT */

import { expect, test } from "bun:test"
import { parseMobileNavigationLink } from "./navigation-link"

test("MobileLink_ProjectAndFile_UseSingleDecode", () => {
  expect(parseMobileNavigationLink("unifia://open?project=%2Fworkspace&file=hello%2520world.md")).toEqual({
    kind: "open", directory: "/workspace", file: "/workspace/hello%20world.md",
  })
  expect(parseMobileNavigationLink("unifia://open?project=C%3A%5Cwork&file=C%3A%5Cwork%5Creadme.md")?.kind).toBe("open")
})

test("MobileLink_UnsafeOrUnscopedFile_IsRejected", () => {
  for (const file of ["../secret", "/other/secret", "javascript:alert(1)", "a%0Ab"]) {
    expect(parseMobileNavigationLink(`unifia://open?project=%2Fworkspace&file=${file}`)).toBeUndefined()
  }
  expect(parseMobileNavigationLink("unifia://open?file=/secret")).toBeUndefined()
  expect(parseMobileNavigationLink("unifia://open?project=relative")).toBeUndefined()
})

test("MobileLink_Session_RequiresBoundedIdentifier", () => {
  expect(parseMobileNavigationLink("unifia://session?id=ses_123")).toEqual({ kind: "session", sessionID: "ses_123" })
  for (const id of ["", "../other", "x".repeat(257)]) {
    expect(parseMobileNavigationLink(`unifia://session?id=${id}`)).toBeUndefined()
  }
})
