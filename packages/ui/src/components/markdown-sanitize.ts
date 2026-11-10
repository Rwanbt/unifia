// SPDX-License-Identifier: MIT
// Sanitisation policy for rendered Markdown.
//
// The configuration and the anchor hook live here, outside the component, so
// the browser test in `packages/app/e2e/security/markdown-sanitize.spec.ts`
// can assert against the exact policy that ships instead of a copy that drifts.
// Do not import DOMPurify here: the module is also loaded in a Node process by
// that test, where there is no DOM to bind to.

// Type-only import: erased at build time, so this module stays loadable from a
// Node process (the browser test) without pulling DOMPurify's runtime in.
import type { Config } from "dompurify"

/**
 * Policy for model output and user Markdown rendered by `markdown.tsx`.
 * `USE_PROFILES` keeps MathML (LaTeX output), `SANITIZE_NAMED_PROPS` stops
 * DOM clobbering through `id`/`name`, and `FORBID_CONTENTS` drops the *text*
 * of script/style so a stripped tag cannot leak its body as plain text.
 */
export const MARKDOWN_SANITIZE_CONFIG: Config = {
  USE_PROFILES: { html: true, mathMl: true },
  SANITIZE_NAMED_PROPS: true,
  FORBID_TAGS: ["style"],
  FORBID_CONTENTS: ["style", "script"],
}

/**
 * Marks externally-opened links so the target page cannot reach back through
 * `window.opener`, and so the referrer of a rendered conversation is not leaked.
 * Registered with `DOMPurify.addHook("afterSanitizeAttributes", …)`.
 */
export function anchorRelHook(node: Element) {
  if (!(node instanceof HTMLAnchorElement)) return
  if (node.target !== "_blank") return

  const rel = node.getAttribute("rel") ?? ""
  const set = new Set(rel.split(/\s+/).filter(Boolean))
  set.add("noopener")
  set.add("noreferrer")
  node.setAttribute("rel", Array.from(set).join(" "))
}
