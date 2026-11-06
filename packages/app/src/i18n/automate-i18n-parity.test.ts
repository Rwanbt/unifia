import { describe, expect, test } from "bun:test"
import type { Locale } from "@/context/language"
import { dicts as config } from "./automate-node-config"
import { dicts as studio } from "./automate-studio"

// The dedicated automate dictionaries used to ship en + fr only, so 15 locales
// rendered English in the Automate studio. Typing each object against its key
// union makes a missing key a compile error; this test is the runtime proof,
// and it also verifies that every translation kept the placeholders intact.
const ALL_LOCALES: Record<Locale, true> = {
  en: true,
  zh: true,
  zht: true,
  ko: true,
  de: true,
  es: true,
  fr: true,
  da: true,
  ja: true,
  pl: true,
  ru: true,
  ar: true,
  no: true,
  br: true,
  th: true,
  bs: true,
  tr: true,
}

function placeholders(value: string) {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
}

describe("automate dictionary parity", () => {
  test("every locale owns every key with the same placeholders", () => {
    const check = <K extends string>(name: string, dicts: Record<Locale, Record<K, string>>) => {
      const expectedLocales = Object.keys(ALL_LOCALES).sort()
      expect(Object.keys(dicts).sort(), `${name}: missing locale module`).toEqual(expectedLocales)

      const keys = (Object.keys(dicts.en) as K[]).sort()
      expect(keys.length, `${name}: empty dictionary`).toBeGreaterThan(0)

      for (const locale of Object.keys(ALL_LOCALES) as Locale[]) {
        const dict = dicts[locale]
        expect(Object.keys(dict).sort(), `${name}.${locale}: key coverage`).toEqual(keys)
        for (const key of keys) {
          expect(placeholders(dict[key]), `${name}.${locale}.${key}: placeholders`).toEqual(placeholders(dicts.en[key]))
        }
      }
    }

    check("studio", studio)
    check("nodeConfig", config)
  })
})
