/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { dict as ar } from "./ar"
import { dict as br } from "./br"
import { dict as bs } from "./bs"
import { dict as da } from "./da"
import { dict as de } from "./de"
import { dict as en } from "./en"
import { dict as es } from "./es"
import { dict as fr } from "./fr"
import { dict as ja } from "./ja"
import { dict as ko } from "./ko"
import { dict as no } from "./no"
import { dict as pl } from "./pl"
import { dict as ru } from "./ru"
import { dict as th } from "./th"
import { dict as tr } from "./tr"
import { dict as zh } from "./zh"
import { dict as zht } from "./zht"

const locales = { ar, br, bs, da, de, es, fr, ja, ko, no, pl, ru, th, tr, zh, zht }

// The main dictionaries interpolate {{name}}, not {name}. A translation that
// rewrites the braces renders a literal "{count}" on screen, and the type
// system cannot see inside a string, so this guard compares the placeholder
// set of every design.* value with the English source.
function placeholders(value: string) {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort()
}

describe("design.* placeholders", () => {
  test("every locale keeps the English placeholders", () => {
    const keys = Object.keys(en).filter((key) => key.startsWith("design."))
    expect(keys.length).toBeGreaterThan(100)

    for (const [name, dict] of Object.entries(locales)) {
      for (const key of keys) {
        expect(placeholders(dict[key as keyof typeof dict]), `${name}.${key}`).toEqual(placeholders(en[key as keyof typeof en]))
      }
    }
  })
})
