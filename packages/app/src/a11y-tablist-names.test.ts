/* SPDX-License-Identifier: MIT */

// #553 criterion 5: every tab list needs an accessible name, or a screen reader
// announces only "tab list". This test reads the source rather than one rendered
// page, so a new unnamed tab list fails here even if no e2e test opens it.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { Glob } from "bun"

/** Returns the JSX opening tag that contains `index`, scanning braces so `=>` inside `{}` is not the tag's end. */
function openingTag(source: string, index: number): string {
  const start = source.lastIndexOf("<", index)
  let depth = 0
  for (let at = start; at < source.length; at++) {
    const char = source[at]
    if (char === "{") depth++
    else if (char === "}") depth--
    else if (char === ">" && depth === 0) return source.slice(start, at + 1)
  }
  return source.slice(start)
}

export function unnamedTablists(files: readonly { path: string; source: string }[]): string[] {
  const offenders: string[] = []
  for (const { path, source } of files) {
    for (const match of source.matchAll(/role="tablist"/g)) {
      const before = source.slice(0, match.index)
      if (before.lastIndexOf("/*") > before.lastIndexOf("*/")) continue
      const tag = openingTag(source, match.index)
      // Comments mention the role in prose (often in backticks); only real JSX opening tags count.
      if (!/^<[A-Za-z][\w.]*\s/.test(tag) || tag.includes("`")) continue
      if (/aria-label(ledby)?=/.test(tag)) continue
      offenders.push(`${path}:${source.slice(0, match.index).split("\n").length}`)
    }
  }
  return offenders
}

const files = [...new Glob("**/*.tsx").scanSync({ cwd: `${import.meta.dir}` })]
  .filter((path) => !path.endsWith(".test.tsx"))
  .map((path) => ({ path, source: readFileSync(`${import.meta.dir}/${path}`, "utf8") }))

describe("tab lists carry an accessible name", () => {
  test("the scan finds the app's tab lists", () => {
    const count = files.reduce((total, file) => total + [...file.source.matchAll(/role="tablist"/g)].length, 0)
    expect(count).toBeGreaterThan(6)
  })

  test("no role=tablist without aria-label or aria-labelledby", () => {
    expect(unnamedTablists(files)).toEqual([])
  })

  test("an unnamed tab list is reported, a named one is not", () => {
    const sample = [
      { path: "a.tsx", source: '<div role="tablist">\n<div role="tablist" aria-label={t("x")} onClick={() => go()}>' },
    ]
    expect(unnamedTablists(sample)).toEqual(["a.tsx:1"])
  })
})
