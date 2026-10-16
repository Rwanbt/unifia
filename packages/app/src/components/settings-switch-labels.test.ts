/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

// #553 criterion 5 — every settings switch carries an accessible name.
//
// `Switch` (@unifia/ui/switch) renders its label only when children are passed,
// so a self-closing <Switch> is a nameless form control: axe reports `label`
// (critical) on each one and a screen reader announces only "switch, on". The
// settings components cannot be imported here (they need the browser router),
// so the contract is pinned against the source, as in
// automate-studio-canvas.test.ts.
//
// Solid's control-flow <Switch> (from solid-js) shares the name. Those elements
// carry no `checked` prop, which is how the two are told apart.

type Site = { at: number; line: number; opening: string; inner: string }

/** End of the opening tag at `at`, brace and quote aware: props hold `>` inside arrow functions. */
function tagEnd(src: string, at: number) {
  let depth = 0
  let quote: string | null = null
  for (let i = at; i < src.length; i++) {
    const char = src[i]
    if (quote) {
      if (char === "\\") i++
      else if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'" || char === "`") quote = char
    else if (char === "{") depth++
    else if (char === "}") depth--
    else if (char === ">" && depth === 0) return { end: i, selfClosing: src[i - 1] === "/" }
  }
  return null
}

function sites(src: string): Site[] {
  const found: Site[] = []
  const pattern = /<(Switch|SwitchComponent)\b/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(src))) {
    const tag = tagEnd(src, match.index)
    if (!tag) continue
    const opening = src.slice(match.index, tag.end + 1)
    const close = src.indexOf(`</${match[1]}>`, tag.end)
    found.push({
      at: match.index,
      line: src.slice(0, match.index).split("\n").length,
      opening,
      inner: tag.selfClosing || close === -1 ? "" : src.slice(tag.end + 1, close),
    })
    pattern.lastIndex = tag.end
  }
  return found
}

/** A switch is a setting's control, not a control-flow branch, when it is checked. */
const isControl = (site: Site) => /\bchecked\s*=/.test(site.opening)

const files = readdirSync(import.meta.dir).filter((name) => name.startsWith("settings") && name.endsWith(".tsx"))
const sources = files.map((name) => ({ name, text: readFileSync(resolve(import.meta.dir, name), "utf8") }))
const controls = sources.flatMap((file) => sites(file.text).filter(isControl).map((site) => ({ file, site })))

describe("settings switches (static)", () => {
  // Anti-vacuity: the parser must be looking at the real population, otherwise
  // every assertion below would pass on an empty list.
  test("finds the settings switches", () => {
    expect(controls.length).toBeGreaterThan(25)
  })

  test("every switch has an accessible name", () => {
    const offenders = controls
      .filter(({ site }) => site.inner.trim() === "" && !/aria-label\s*=/.test(site.opening))
      .map(({ file, site }) => `${file.name}:${site.line}`)
    expect(offenders).toEqual([])
  })

  // A row already renders the title beside the control. A switch that names
  // itself inside one has to hide that copy, or the label renders twice.
  test("a switch inside a settings row hides its own copy of the title", () => {
    const inRow = (file: { text: string }, at: number) =>
      file.text.lastIndexOf("<SettingsRow", at) > file.text.lastIndexOf("</SettingsRow>", at)
    const offenders = controls
      .filter(({ site }) => site.inner.trim() !== "" && !/hideLabel/.test(site.opening))
      .filter(({ file, site }) => inRow(file, site.at))
      .map(({ file, site }) => `${file.name}:${site.line}`)
    expect(offenders).toEqual([])
  })
})
