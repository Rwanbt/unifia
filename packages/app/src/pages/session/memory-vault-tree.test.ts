/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import type { KnowledgeNoteDescription } from "@/utils/knowledge-client"
import type { MemoryFileEntry } from "./memory-panel-model"
import { MEMORY_ROOT, readVaultListing, vaultTreeEntries, type VaultListing } from "./memory-vault-tree"

const file = (locator: string): MemoryFileEntry => ({ path: `${MEMORY_ROOT}/${locator}`, kind: "file" })
const folder = (locator: string): MemoryFileEntry => ({ path: `${MEMORY_ROOT}/${locator}`, kind: "directory" })
const note = (locator: string): KnowledgeNoteDescription => ({
  id: "0190d2c0-7b00-7000-8000-00000000000a",
  locator,
  type: "decision",
  space: "default",
  lifecycle: "active",
})
const complete = (entries: MemoryFileEntry[]): VaultListing => ({ entries, complete: true })

function paths(entries: MemoryFileEntry[]): string[] {
  return entries.map((entry) => entry.path.slice(MEMORY_ROOT.length + 1)).sort()
}

describe("vaultTreeEntries: what the owner sees", () => {
  test("an empty folder from the workspace listing is shown, since no note would list it", () => {
    const result = vaultTreeEntries({ notes: [], listing: complete([folder("Empty")]) })
    expect(paths(result)).toEqual(["Empty"])
  })

  test("the folder of a visible note and the note are shown", () => {
    const result = vaultTreeEntries({ notes: [note("ideas/Plan.md")], listing: complete([folder("ideas"), file("ideas/Plan.md")]) })
    expect(paths(result)).toEqual(["ideas", "ideas/Plan.md"])
  })

  test("a folder listed both by the listing and by a note appears once", () => {
    const result = vaultTreeEntries({ notes: [note("ideas/Plan.md")], listing: complete([folder("ideas"), file("ideas/Plan.md")]) })
    expect(result.filter((entry) => entry.path === `${MEMORY_ROOT}/ideas`)).toHaveLength(1)
  })
})

describe("vaultTreeEntries: a withheld note is not revealed by its folder", () => {
  test("a folder that holds only a withheld note is not shown, and neither is the note", () => {
    const result = vaultTreeEntries({ notes: [], listing: complete([folder("Secret"), file("Secret/hidden.md")]) })
    expect(result).toEqual([])
  })

  test("the folders above a withheld note are not shown when nothing visible sits under them", () => {
    const result = vaultTreeEntries({
      notes: [],
      listing: complete([folder("A"), folder("A/B"), file("A/B/hidden.md")]),
    })
    expect(result).toEqual([])
  })

  test("a folder holding a visible note is shown, and its withheld sibling stays out", () => {
    const result = vaultTreeEntries({
      notes: [note("ideas/Plan.md")],
      listing: complete([folder("ideas"), file("ideas/Plan.md"), file("ideas/secret.md")]),
    })
    expect(paths(result)).toEqual(["ideas", "ideas/Plan.md"])
  })

  test("the withheld note's locator never appears in the result", () => {
    const result = vaultTreeEntries({
      notes: [note("ideas/Plan.md")],
      listing: complete([folder("ideas"), file("ideas/Plan.md"), folder("Secret"), file("Secret/hidden.md")]),
    })
    expect(JSON.stringify(result)).not.toContain("hidden")
    expect(JSON.stringify(result)).not.toContain("Secret")
  })
})

describe("vaultTreeEntries: fail closed when the folders cannot be checked", () => {
  test("a listing cut short adds no folder from the listing, while the visible notes still show", () => {
    const result = vaultTreeEntries({
      notes: [note("ideas/Plan.md")],
      listing: { entries: [folder("Empty"), file("Empty/x.md")], complete: false },
    })
    expect(paths(result)).toEqual(["ideas", "ideas/Plan.md"])
  })

  test("without a connected workspace, only the folders that hold a visible note are known", () => {
    const result = vaultTreeEntries({ notes: [note("ideas/Plan.md")], listing: undefined })
    expect(paths(result)).toEqual(["ideas", "ideas/Plan.md"])
  })
})

describe("readVaultListing: every page is read, or the listing says it was cut short", () => {
  test("reads pages until the cursor runs out", async () => {
    const pages = new Map<string | undefined, { entries: MemoryFileEntry[]; nextCursor?: string | null }>([
      [undefined, { entries: [folder("a")], nextCursor: "page-2" }],
      ["page-2", { entries: [file("a/n.md")], nextCursor: null }],
    ])
    const listing = await readVaultListing(async (cursor) => pages.get(cursor)!, 20)
    expect(listing.complete).toBe(true)
    expect(listing.entries.map((entry) => entry.path)).toEqual([`${MEMORY_ROOT}/a`, `${MEMORY_ROOT}/a/n.md`])
  })

  test("a listing that is still going when the page budget ends is reported as incomplete", async () => {
    const listing = await readVaultListing(async () => ({ entries: [], nextCursor: "more" }), 3)
    expect(listing.complete).toBe(false)
  })
})
