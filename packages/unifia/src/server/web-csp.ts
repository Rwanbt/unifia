/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { createHash } from "node:crypto"

/**
 * The CSP of an embedded-interface page, with a hash for each inline script it
 * carries. The build inlines the theme preload (app/vite.js) so the saved
 * theme applies before first paint; `script-src 'self'` alone blocked it, so
 * the web runtime flashed the default theme and logged a CSP error on every
 * load. A per-script hash allows exactly that script and nothing else, which
 * keeps the policy as strict as before ('unsafe-inline' stays out).
 */
export async function cspForHtml(basePolicy: string, html: string): Promise<string> {
  const hashes = (await inlineScripts(html)).map((source) => `'sha256-${createHash("sha256").update(source, "utf8").digest("base64")}'`)
  if (hashes.length === 0) return basePolicy
  return basePolicy
    .split(";")
    .map((directive) => {
      const trimmed = directive.trim()
      return trimmed.startsWith("script-src ") ? `${trimmed} ${hashes.join(" ")}` : trimmed
    })
    .join("; ")
}

/**
 * Bodies of `<script>` elements without a `src`, read by Bun's HTML parser
 * (HTMLRewriter) rather than a regular expression, so every end-tag spelling
 * the browser accepts is handled the way the browser handles it.
 */
async function inlineScripts(html: string): Promise<string[]> {
  const scripts: string[] = []
  let current: string[] | undefined
  const rewriter = new HTMLRewriter().on("script", {
    element(element) {
      if (element.hasAttribute("src")) return
      const chunks: string[] = []
      current = chunks
      element.onEndTag(() => {
        if (chunks.length > 0) scripts.push(chunks.join(""))
        current = undefined
      })
    },
    text(chunk) {
      current?.push(chunk.text)
    },
  })
  await rewriter.transform(new Response(html)).text()
  return scripts
}
