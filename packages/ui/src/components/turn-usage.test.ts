/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import type { AssistantMessage } from "../types/sdk-shim"
import { turnUsage } from "./turn-usage"

const reply = (tokens: number, cost: number) =>
  ({
    cost,
    tokens: { input: tokens, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }) as unknown as AssistantMessage

describe("turnUsage", () => {
  test("TurnUsage_SeveralReplies_SumsTokensAndCost", () => {
    expect(turnUsage([reply(1000, 0.01), reply(2800, 0.02)], 4200)).toEqual({
      durationMs: 4200,
      tokens: 3800,
      cost: 0.03,
    })
  })

  test("TurnUsage_NoReply_IsEmpty", () => {
    expect(turnUsage([], undefined)).toEqual({ durationMs: undefined, tokens: 0, cost: 0 })
  })
})
