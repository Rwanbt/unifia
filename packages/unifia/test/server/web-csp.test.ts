/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { cspForHtml } from "../../src/server/web-csp"

const BASE = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'"
const hash = (source: string) => `'sha256-${createHash("sha256").update(source, "utf8").digest("base64")}'`

describe("cspForHtml", () => {
  test("allows the inlined theme preload by its hash, nothing broader", () => {
    const body = ";(function () { document.documentElement.dataset.theme = 'dark' })()"
    const csp = cspForHtml(BASE, `<head><script id="oc-theme-preload-script">${body}</script><script type="module" src="/assets/index.js"></script></head>`)
    expect(csp).toBe(`default-src 'self'; script-src 'self' 'wasm-unsafe-eval' ${hash(body)}; style-src 'self' 'unsafe-inline'`)
    expect(csp).not.toContain("unsafe-inline' ;")
    expect(csp.split("script-src")[1]?.split(";")[0]).not.toContain("unsafe-inline")
  })

  test("a page without inline scripts keeps the base policy", () => {
    expect(cspForHtml(BASE, `<script type="module" src="/assets/index.js"></script>`)).toBe(BASE)
  })
})
