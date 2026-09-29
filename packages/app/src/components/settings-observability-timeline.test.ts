/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { observableSessionId } from "./settings-observability-session-id"

describe("observableSessionId", () => {
  test("does not send visual-parity route IDs to the session API", () => {
    expect(observableSessionId("audit-check")).toBeUndefined()
  })

  test("preserves backend session IDs", () => {
    expect(observableSessionId("ses_123")).toBe("ses_123")
  })
})
