/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * The terminal lives at the bottom of the Code editor card. In the Chat layout
 * that card is not shown, so opening the terminal used to flip its state (the
 * button turned "active") with nothing appearing. Opening it from Chat now
 * also brings the editor card in: Split where the viewport offers it, else
 * Editor.
 */
export type Layout = "chat" | "split" | "main"

export function layoutShowingTerminal(current: Layout, offered: readonly Layout[]): Layout | undefined {
  if (current !== "chat") return undefined
  if (offered.includes("split")) return "split"
  if (offered.includes("main")) return "main"
  return undefined
}
