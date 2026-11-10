// SPDX-License-Identifier: MIT
import { expect, test } from "@playwright/test"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { MARKDOWN_SANITIZE_CONFIG, anchorRelHook } from "../../ui/src/components/markdown-sanitize"

// Proves the shipped Markdown sanitisation policy actually neutralises hostile
// HTML. The policy is imported from `@unifia/ui` rather than restated here, so a
// weakened config fails this test instead of passing against a stale copy.
//
// Runs in Chromium on purpose: DOMPurify is tree-mutating and its behaviour
// depends on a real DOM implementation. Under happy-dom 20.x it returns the
// input essentially unchanged (see docs/security/MARKDOWN-SANITIZE-COVERAGE.md),
// which would make a green test meaningless.

const require = createRequire(import.meta.url)
const purifySource = readFileSync(require.resolve("dompurify/dist/purify.min.js"), "utf8")

const HOSTILE = [
  "<p>keep me</p>",
  '<script>window.__pwned = true</script>',
  '<style>body { display: none }</style>',
  '<img src="x" onerror="window.__pwned = true">',
  '<svg><animate onbegin="window.__pwned = true" attributeName="x" /></svg>',
  '<a href="javascript:window.__pwned=true">click</a>',
  '<iframe src="https://evil.test"></iframe>',
  "<div>template {{ 7*7 }} stays inert text</div>",
].join("")

test("Markdown_Sanitizer_HostileHtml_StripsActiveContent", async ({ page }) => {
  await page.setContent("<!doctype html><html><body></body></html>")

  // Load the same UMD bundle the bundled clients receive.
  await page.addScriptTag({ content: purifySource })

  // The production hook is shipped as source, not reimplemented: the exact
  // function body is injected so `anchorRelHook` is the one under test.
  await page.addScriptTag({ content: `window.__anchorRelHook = (${anchorRelHook.toString()});` })

  const out = await page.evaluate((config) => {
    const DOMPurify = (window as unknown as { DOMPurify: any }).DOMPurify
    const hook = (window as unknown as { __anchorRelHook: (node: Element) => void }).__anchorRelHook
    DOMPurify.addHook("afterSanitizeAttributes", hook)
    return {
      supported: DOMPurify.isSupported,
      html: DOMPurify.sanitize(
        [
          "<p>keep me</p>",
          '<script>window.__pwned = true</script>',
          '<style>body { display: none }</style>',
          '<img src="x" onerror="window.__pwned = true">',
          '<svg><animate onbegin="window.__pwned = true" attributeName="x" /></svg>',
          '<a href="javascript:window.__pwned=true">click</a>',
          '<iframe src="https://evil.test"></iframe>',
          "<div>template {{ 7*7 }} stays inert text</div>",
        ].join(""),
        config,
      ),
    }
  }, MARKDOWN_SANITIZE_CONFIG)

  // Sanity: if DOMPurify reports no DOM, every assertion below is vacuous.
  expect(out.supported).toBe(true)

  // Benign markup survives, so the assertions below cannot be satisfied by
  // returning an empty string.
  expect(out.html).toContain("<p>keep me</p>")

  // No script/style element, and their bodies never leak back as text.
  expect(out.html).not.toMatch(/<script/i)
  expect(out.html).not.toMatch(/<style/i)
  expect(out.html).not.toContain("window.__pwned = true</script>")
  expect(out.html).not.toContain("display: none")

  // No event-handler attribute survives, in either attribute or SVG form.
  expect(out.html).not.toMatch(/\son[a-z]+\s*=/i)

  // No executable URL scheme survives on a link.
  expect(out.html).not.toMatch(/javascript:/i)

  // Frames are not part of the html profile.
  expect(out.html).not.toMatch(/<iframe/i)

  // Nothing in the output can execute when re-inserted into the DOM.
  const executed = await page.evaluate((html) => {
    const host = document.createElement("div")
    host.innerHTML = html
    document.body.appendChild(host)
    return (window as unknown as { __pwned?: boolean }).__pwned === true
  }, out.html)
  expect(executed).toBe(false)
})

// NOTE (measured, not assumed): DOMPurify's `html` profile does not allow the
// `target` attribute, so `target="_blank"` never survives sanitisation. The
// sanitised output therefore cannot open a new browsing context at all, which is
// stronger than rel-hardening. `anchorRelHook` only fires on anchors that still
// carry `target="_blank"`, so for this policy it is inert — the second test pins
// the hook's own behaviour, and this one pins the shipped contract.
test("Markdown_Sanitizer_ExternalLink_CannotOpenNewBrowsingContext", async ({ page }) => {
  await page.setContent("<!doctype html><html><body></body></html>")
  await page.addScriptTag({ content: purifySource })
  await page.addScriptTag({ content: `window.__anchorRelHook = (${anchorRelHook.toString()});` })

  const html = await page.evaluate((config) => {
    const DOMPurify = (window as unknown as { DOMPurify: any }).DOMPurify
    const hook = (window as unknown as { __anchorRelHook: (node: Element) => void }).__anchorRelHook
    DOMPurify.addHook("afterSanitizeAttributes", hook)
    return DOMPurify.sanitize('<a href="https://example.test" target="_blank">out</a>', config) as string
  }, MARKDOWN_SANITIZE_CONFIG)

  expect(html).toContain("https://example.test")
  expect(html).not.toContain('target="_blank"')
})

test("AnchorRelHook_BlankTargetAnchor_GainsNoopenerNoreferrer", async ({ page }) => {
  await page.setContent("<!doctype html><html><body></body></html>")
  await page.addScriptTag({ content: `window.__anchorRelHook = (${anchorRelHook.toString()});` })

  const rel = await page.evaluate(() => {
    const hook = (window as unknown as { __anchorRelHook: (node: Element) => void }).__anchorRelHook
    const make = (target: string, rel: string) => {
      const a = document.createElement("a")
      a.setAttribute("href", "https://example.test")
      a.setAttribute("target", target)
      if (rel) a.setAttribute("rel", rel)
      hook(a)
      return a.getAttribute("rel") ?? ""
    }
    return {
      blank: make("_blank", ""),
      blankExisting: make("_blank", "external"),
      sameTab: make("_self", ""),
    }
  })

  expect(rel.blank).toBe("noopener noreferrer")
  // Existing rel tokens are preserved, not overwritten.
  expect(rel.blankExisting.split(" ")).toEqual(expect.arrayContaining(["external", "noopener", "noreferrer"]))
  expect(rel.sameTab).toBe("")
})

// Guard against a policy that silently stops forbidding the dangerous shapes.
// If someone widens the config, this fails even when DOMPurify happens to cope.
test("Markdown_SanitizeConfig_KeepsForbiddenTagsAndClobberProtection", () => {
  expect(MARKDOWN_SANITIZE_CONFIG.FORBID_TAGS).toContain("style")
  expect(MARKDOWN_SANITIZE_CONFIG.FORBID_CONTENTS).toEqual(expect.arrayContaining(["style", "script"]))
  expect(MARKDOWN_SANITIZE_CONFIG.SANITIZE_NAMED_PROPS).toBe(true)
})
