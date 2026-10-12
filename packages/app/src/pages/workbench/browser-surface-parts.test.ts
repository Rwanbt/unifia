/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import type { BrowserActivityEvent } from "@unifia/contracts"
import { dict as en } from "@/i18n/en"
import { browserActivityLabel } from "./browser-surface-parts"

const t = (key: string, params?: Record<string, string | number>) =>
  Object.entries(params ?? {}).reduce((text, [name, value]) => text.replace(`{{${name}}}`, String(value)), (en as Record<string, string>)[key] ?? key)

const event = (fields: Partial<BrowserActivityEvent>) => ({ sequence: 1, occurredAt: 1, ...fields }) as BrowserActivityEvent

describe("browserActivityLabel", () => {
  test("KnownKind_UsesItsTranslatedLabel", () => {
    expect(browserActivityLabel(event({ kind: "navigation.blocked" }), t)).toBe("Navigation blocked")
  })
  test("ControllerChange_NamesTheNewController", () => {
    expect(browserActivityLabel(event({ kind: "controller.changed", controller: "ai" }), t)).toBe("Control transferred to AI")
  })
})
