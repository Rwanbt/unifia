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

const locales: Record<string, Record<string, string | undefined>> = { ar, br, bs, da, de, en, es, fr, ja, ko, no, pl, ru, th, tr, zh, zht }

// Every key that labels a deferred control. Owner decision 2026-10-16
// (option A): the control announces unavailability and never announces a
// delay. The words below are exactly the promise words the 17 locales
// carried before this guard — a translation that reintroduces one fails
// here instead of shipping to a user.
const KEYS = [
  "design.studio.unavailable",
  "automate.studio.unavailable",
  "terminal.panel.unavailable",
  "settings.general.observability.unavailable",
  "common.unavailable",
  "inspector.code.overview.completionHint",
] as const

const PROMISE = /soon|bient[oô]t|demnächst|em breve|próxim|قريب|uskoro|snart|wkrótce|скоро|เร็ว|yakında|即将|即將|곧|近日/i

describe("deferred-control labels", () => {
  test("every locale defines the unavailable labels", () => {
    for (const [name, dict] of Object.entries(locales)) {
      for (const key of KEYS) {
        expect(dict[key], `${name}:${key}`).toBeDefined()
      }
    }
  })

  test("no locale announces a delay on a deferred control", () => {
    for (const [name, dict] of Object.entries(locales)) {
      for (const key of KEYS) {
        const value = dict[key]
        expect(value, `${name}:${key}`).toBeDefined()
        expect(PROMISE.test(value ?? ""), `${name}:${key} = ${value}`).toBe(false)
      }
    }
  })

  test("the promise-named keys are gone from every locale", () => {
    const legacy = [
      "design.studio.soon",
      "automate.studio.soon",
      "terminal.panel.comingSoon",
      "settings.general.observability.comingSoon",
      "common.comingSoon",
    ]
    for (const [name, dict] of Object.entries(locales)) {
      for (const key of legacy) {
        expect(dict[key], `${name}:${key}`).toBeUndefined()
      }
    }
  })
})
