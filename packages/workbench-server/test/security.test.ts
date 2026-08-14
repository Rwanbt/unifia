/* SPDX-License-Identifier: MIT */

import { describe, expect, it } from "vitest"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { WORKBENCH_ALLOWED_ORIGINS, addSecurityHeaders, checkRequestOrigin } from "../src/security.js"
import { ServerLogger } from "../src/logging.js"

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
})
