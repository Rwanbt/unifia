/* SPDX-License-Identifier: MIT */

import { expect, test } from "bun:test"

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text()

test("fields never get the default focus ring; other controls keep an accent ring", async () => {
  const css = await read("./v110.css")
  expect(css).toContain("--v110-focus: 0 0 0 2px color-mix(in srgb, var(--accent, var(--border-focus)) 50%, transparent);")
  expect(css).not.toContain("0 0 0 4px var(--border-focus)")
  expect(css).toMatch(/:where\(input, textarea, \[contenteditable\]\):is\(:focus, :focus-visible\),\s*:focus:not\(:focus-visible\) \{\s*outline: none;/)
  expect(css).toContain("--v110-focus-outline: 2px solid color-mix(in srgb, var(--accent, var(--border-focus)) 50%, transparent);")
  const ring = css.match(/\n(:where\([^\n]*\):focus-visible) \{\s*outline: var\(--v110-focus-outline\);/)
  expect(ring?.[1]).toBe(":where(button, select, [tabindex]):not(input, textarea, [contenteditable]):focus-visible")
})

test("panels and fields do not grow a grey frame on focus", async () => {
  const css = (await read("./v110.css")) + (await read("./v110-editor.css"))
  const frames = [...css.matchAll(/\n([^\n{]*:focus(?:-within)?) \{\s*(?:outline: none;\s*)?border-color: var\(--border-focus\);/g)]
    .map((match) => match[1])
    // Design studio styles are owned by the Design lane.
    .filter((selector) => !selector.includes("design-"))
  expect(frames).toEqual([])
  expect(css).not.toContain("outline: 2px solid var(--border-focus);")
})

test("the shared text field drops its grey 3px select halo", async () => {
  const css = await read("../../../ui/src/components/text-field.css")
  expect(css).not.toContain("0 0 0 3px var(--border-weak-selected)")
})

test("copy-context is anchored to Send, not offset from the viewport", async () => {
  const css = await read("./v110-chat.css")
  expect(css).toContain("anchor-name: --v110-send;")
  expect(css).toContain("right: anchor(--v110-send right, 8px);")
  // Anchored on the dock column (todo/question docks + composer), not the
  // composer alone, so it stays clear of the todo chevron (#480).
  expect(css).toContain('[data-v110="session-chat-surface"] [data-v110="composer-dock"] > div {\n  anchor-name: --v110-composer;')
  expect(css).toContain("bottom: calc(anchor(--v110-composer top, 104px) + 8px);")
  expect(css).not.toContain("right: max(52px, calc((100% - var(--v110-chat-width)) / 2 + 53px));")
  const session = await read("../pages/session.tsx")
  // The anchor must precede the positioned button in tree order.
  expect(session.indexOf('data-v110="chat-copy-context"')).toBeGreaterThan(session.indexOf("<SessionComposerRegion"))
})
