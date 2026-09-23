/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { dict as en } from "./en"
import { dict as ar } from "./ar"
import { dict as br } from "./br"
import { dict as bs } from "./bs"
import { dict as da } from "./da"
import { dict as de } from "./de"
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

const locales: Record<string, Record<string, string>> = { ar, br, bs, da, de, es, fr, ja, ko, no, pl, ru, th, tr, zh, zht }

// A key missing from a locale silently falls back to English, which is how
// "1 Changed fichier" reached French users.
describe("ui i18n parity", () => {
  for (const [name, dict] of Object.entries(locales)) {
    test(`${name} has exactly the English keys`, () => {
      expect(Object.keys(dict).sort()).toEqual(Object.keys(en).sort())
    })
  }
})
