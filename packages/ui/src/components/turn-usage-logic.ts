import type { AssistantMessage } from "../types/sdk-shim"

export type TurnUsage = { durationMs?: number; tokens: number; cost: number }

/** Tokens and cost summed over a turn's assistant messages. */
export function turnUsage(messages: readonly AssistantMessage[], durationMs: number | undefined): TurnUsage {
  let tokens = 0
  let cost = 0
  for (const message of messages) {
    const t = message.tokens
    tokens += t.input + t.output + t.reasoning + t.cache.read + t.cache.write
    cost += message.cost
  }
  return { durationMs, tokens, cost }
}
