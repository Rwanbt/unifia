import { describe, expect, it } from "vitest"
import { WORKBENCH_ALLOWED_ORIGINS, addSecurityHeaders, checkRequestOrigin } from "../src/security.js"

describe("workbench origin policy", () => {
  it("allows only explicit native origins and requests without an Origin header", () => {
    expect(checkRequestOrigin(null).allowed).toBe(true)
    expect(checkRequestOrigin(WORKBENCH_ALLOWED_ORIGINS[0]).allowed).toBe(true)
    expect(checkRequestOrigin("https://evil.example").allowed).toBe(false)
  })

  it("does not emit a wildcard credential policy", () => {
    const response = addSecurityHeaders(new Response("ok"), WORKBENCH_ALLOWED_ORIGINS[0])
    expect(response.headers.get("access-control-allow-origin")).toBe(WORKBENCH_ALLOWED_ORIGINS[0])
    expect(response.headers.get("access-control-allow-credentials")).toBe("true")
    expect(response.headers.get("access-control-allow-methods")).toContain("OPTIONS")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
  })
})
