/* SPDX-License-Identifier: MIT */
import type { GovernedNoteSeed } from "../memory-vault"

/** Three linked notes: a links to b, b links to c, and tags sit in the bodies the graph reads. */
export const GRAPH_NOTES: readonly GovernedNoteSeed[] = [
  { locator: "a.md", id: "018f6d2a-0000-7000-8000-0000000000a1", body: "# A\n[[B]] #alpha\n" },
  { locator: "b.md", id: "018f6d2a-0000-7000-8000-0000000000b1", body: "# B\n[[C]] #alpha #beta\n" },
  { locator: "c.md", id: "018f6d2a-0000-7000-8000-0000000000c1", body: "# C\n#beta\n" },
]
