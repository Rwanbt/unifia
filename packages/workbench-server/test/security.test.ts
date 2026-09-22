/* SPDX-License-Identifier: MIT */

import { describe, expect, it } from "vitest"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { WORKBENCH_ALLOWED_ORIGINS, addSecurityHeaders, checkRequestOrigin } from "../src/security.js"
import { ServerLogger } from "../src/logging.js"
import { WorkbenchServer } from "../src/index.js"

describe("workbench origin policy", () => {
  it("allows only explicit native origins and requests without an Origin header", () => {
    expect(checkRequestOrigin(null).allowed).toBe(true)
    expect(checkRequestOrigin(WORKBENCH_ALLOWED_ORIGINS[0]).allowed).toBe(true)
    expect(checkRequestOrigin("https://evil.example").allowed).toBe(false)
  })

  it("a ':*' entry allows that scheme and host on a numeric port only (ADR-041)", () => {
    const allowed = [...WORKBENCH_ALLOWED_ORIGINS, "http://127.0.0.1:*", "http://localhost:*"]
    expect(checkRequestOrigin("http://127.0.0.1:4448", allowed).allowed).toBe(true)
    expect(checkRequestOrigin("http://localhost:3000", allowed).allowed).toBe(true)
    expect(checkRequestOrigin(WORKBENCH_ALLOWED_ORIGINS[0], allowed).allowed).toBe(true)
    for (const hostile of [
      "http://127.0.0.1.evil.example:80",
      "http://127.0.0.1:80.evil.example",
      "http://127.0.0.1:",
      "http://127.0.0.1:abc",
      "http://127.0.0.1:123456",
      "https://127.0.0.1:4448",
      "http://localhost.evil.example:3000",
      "http://evil.example",
    ]) {
      expect(checkRequestOrigin(hostile, allowed).allowed, hostile).toBe(false)
    }
    // The default list stays Tauri-only.
    expect(checkRequestOrigin("http://127.0.0.1:4448").allowed).toBe(false)
  })

  it("does not emit a wildcard credential policy", () => {
    const response = addSecurityHeaders(new Response("ok"), WORKBENCH_ALLOWED_ORIGINS[0])
    expect(response.headers.get("access-control-allow-origin")).toBe(WORKBENCH_ALLOWED_ORIGINS[0])
    expect(response.headers.get("access-control-allow-credentials")).toBe("true")
    expect(response.headers.get("access-control-allow-methods")).toContain("OPTIONS")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
  })

  it("keeps server logs separate, redacted, level-filtered and rolling", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "unifia-log-"))
    try {
      const logPath = path.join(root, "server.jsonl")
      const logger = new ServerLogger(logPath, "info", 120)
      logger.log("debug", "hidden", { value: "not written" })
      logger.log("info", "request", { authorization: "Bearer secret", route: "/v1/trace" })
      const content = await readFile(logPath, "utf8")
      expect(content).toContain("[REDACTED]")
      expect(content).not.toContain("Bearer secret")
      expect(content).not.toContain("hidden")
      logger.log("info", "second", { route: "/v1/files/list" })
      expect(await readFile(`${logPath}.1`, "utf8")).toContain("request")
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it("SEC-002: the error path still carries security headers for an allowed origin", async () => {
    const server = new WorkbenchServer({
      auth: { authenticate: async () => ({ id: "principal-1", scopes: new Set(), workspaces: "*" }) },
      workspace: {} as never,
      runtime: {} as never,
      audit: { record: () => undefined },
      capability: { check: async () => "deny" },
    })
    const response = await server.fetch(
      new Request("http://127.0.0.1/v1/specs/validate", {
        method: "POST",
        headers: { origin: WORKBENCH_ALLOWED_ORIGINS[0], "content-type": "application/json" },
        body: "not json",
      }),
    )
    expect(response.status).toBe(400)
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("access-control-allow-origin")).toBe(WORKBENCH_ALLOWED_ORIGINS[0])
  })
})
