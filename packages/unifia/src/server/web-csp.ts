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
export function cspForHtml(basePolicy: string, html: string): string {
  const hashes = inlineScripts(html).map((source) => `'sha256-${createHash("sha256").update(source, "utf8").digest("base64")}'`)
  if (hashes.length === 0) return basePolicy
  return basePolicy
    .split(";")
    .map((directive) => {
      const trimmed = directive.trim()
      return trimmed.startsWith("script-src ") ? `${trimmed} ${hashes.join(" ")}` : trimmed
    })
    .join("; ")
}

/** Bodies of `<script>` elements that have no `src` attribute. */
function inlineScripts(html: string): string[] {
  const scripts: string[] = []
  // `</script\s*>`: an end tag may carry whitespace before `>` (CodeQL
  // js/bad-tag-filter). A missed tag would only drop a hash, so the policy
  // fails closed either way; matching it keeps the script working.
  const pattern = /<script(\s[^>]*)?>([\s\S]*?)<\/script\s*>/gi
  for (const match of html.matchAll(pattern)) {
    const attributes = match[1] ?? ""
    if (/\ssrc\s*=/i.test(attributes)) continue
    if (match[2]) scripts.push(match[2])
  }
  return scripts
}
