/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { approvedNavigationOrigin, assertHttpNavigationDestination, navigationApprovalReason, requiresNavigationApproval } from "../src/navigation-approval.ts"

describe("navigation approval origin checks", () => {
  test("allows same-origin and relative destinations without asking again", () => {
    expect(navigationApprovalReason("https://example.com/repositories", "/issues")).toBeUndefined()
    expect(navigationApprovalReason("https://example.com/repositories", "https://example.com:443/issues")).toBeUndefined()
  })

  test("names the target origin when a destination crosses origins", () => {
    expect(navigationApprovalReason("https://example.com/repositories", "https://other.example/search"))
      .toBe("This action navigates to https://other.example, a different origin.")
  })

  test("fails closed for malformed current URLs or destinations", () => {
    expect(navigationApprovalReason("not a URL", "/issues")).toContain("invalid destination")
    expect(navigationApprovalReason("https://example.com", "http://[invalid")).toContain("invalid destination")
  })

  test("extracts only an exact canonical origin from the approval reason", () => {
    expect(approvedNavigationOrigin("This action navigates to https://example.com, a different origin.")).toBe("https://example.com")
    expect(approvedNavigationOrigin("This action navigates to https://example.com.attacker, a different origin.")).toBe("https://example.com.attacker")
    expect(approvedNavigationOrigin("This action navigates to https://example.com/path, a different origin.")).toBeUndefined()
    expect(approvedNavigationOrigin("This action may delete an item.")).toBeUndefined()
  })

  test("requires approval for every unapproved cross-origin AI navigation", () => {
    expect(requiresNavigationApproval("ai", "https://example.com", "https://example.com/issues")).toBe(false)
    expect(requiresNavigationApproval("ai", "https://example.com", "https://other.example/issues", "https://other.example")).toBe(false)
    expect(requiresNavigationApproval("ai", "https://example.com", "https://redirect.example/issues", "https://other.example")).toBe(true)
    expect(requiresNavigationApproval("paused", "https://example.com", "https://other.example/issues")).toBe(true)
    expect(requiresNavigationApproval("user", "https://example.com", "https://other.example/issues")).toBe(false)
  })

  test("fails closed for malformed non-user navigations", () => {
    expect(requiresNavigationApproval("ai", "https://example.com", "not a URL")).toBe(true)
    expect(requiresNavigationApproval("ai", "https://example.com", "file:///etc/passwd")).toBe(true)
    expect(requiresNavigationApproval("ai", "https://example.com", "about:blank")).toBe(false)
  })

  test("blocks external protocols before user or AI browser actions dispatch", () => {
    expect(() => assertHttpNavigationDestination("https://example.com", "mailto:person@example.com"))
      .toThrow("external browser protocols are blocked")
    expect(() => assertHttpNavigationDestination("https://example.com", "file:///private/report.pdf"))
      .toThrow("external browser protocols are blocked")
    expect(() => assertHttpNavigationDestination("https://example.com", "/issues")).not.toThrow()
    expect(() => assertHttpNavigationDestination("https://example.com", "about:blank")).not.toThrow()
  })
})
