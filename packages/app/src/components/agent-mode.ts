/* SPDX-License-Identifier: MIT */

/**
 * v16 agent modes (maquette module `unifia-v16-agent-modes`). The composer's
 * mode control shows one icon per runtime agent; unknown agent names fall
 * back to the chat icon, exactly like the reference module's `modeIcons`
 * lookup (`modeIcons[normalize(value)] || modeIcons.chat`).
 */
export type AgentMode = "chat" | "plan" | "debate" | "build" | "team" | "auto"

const MODES: ReadonlySet<string> = new Set(["chat", "plan", "debate", "build", "team", "auto"])

export function agentModeIconName(name: string | undefined): AgentMode {
  const normalized = (name ?? "").trim().toLocaleLowerCase()
  const canonical = normalized === "débat" ? "debate" : normalized
  return MODES.has(canonical) ? (canonical as AgentMode) : "chat"
}