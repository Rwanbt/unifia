/* SPDX-License-Identifier: MIT */
/**
 * The vault tree the Memory panel shows: the notes the owner may read, and the folders around them.
 *
 * Notes come from the knowledge tree. Folders come from the workspace listing, because an empty folder
 * is not a knowledge object and has no note to list it. A folder from the listing is shown only when
 * nothing under it is hidden from the owner: a folder that holds a withheld note would reveal that the
 * note exists, and the vault never reveals that.
 */
import type { KnowledgeNoteDescription } from "@/utils/knowledge-client"
import type { MemoryFileEntry } from "./memory-panel-model"

export const MEMORY_ROOT = ".unifia/memory"

export function noteVaultPath(locator: string): string {
  return `${MEMORY_ROOT}/${locator}`
}

/** One page of the workspace listing, as the Workbench client returns it. */
export interface VaultListingPage {
  readonly entries: readonly MemoryFileEntry[]
  readonly nextCursor?: string | null
}

export interface VaultListing {
  readonly entries: readonly MemoryFileEntry[]
  /** False when the pages ran out before the listing ended: its folders cannot then be checked for hidden content. */
  readonly complete: boolean
}

/** Reads every page of the vault's listing, up to `maxPages`. A listing cut short says so. */
export async function readVaultListing(
  readPage: (cursor: string | undefined) => Promise<VaultListingPage>,
  maxPages: number,
): Promise<VaultListing> {
  const entries: MemoryFileEntry[] = []
  let cursor: string | undefined
  for (let pages = 0; pages < maxPages; pages++) {
    const page = await readPage(cursor)
    entries.push(...page.entries)
    if (!page.nextCursor) return { entries, complete: true }
    cursor = page.nextCursor
  }
  return { entries, complete: false }
}

export interface VaultTreeInput {
  readonly notes: readonly KnowledgeNoteDescription[]
  /** Undefined when the workspace is not connected: only the folders the notes sit in are then known. */
  readonly listing: VaultListing | undefined
}

export function vaultTreeEntries(input: VaultTreeInput): MemoryFileEntry[] {
  const entries = new Map<string, MemoryFileEntry>()
  const visibleFiles = new Set<string>()
  for (const note of input.notes) {
    const path = noteVaultPath(note.locator)
    visibleFiles.add(path)
    entries.set(path, { path, kind: "file" })
    const segments = note.locator.split("/")
    for (let depth = 1; depth < segments.length; depth++) {
      const folder = `${MEMORY_ROOT}/${segments.slice(0, depth).join("/")}`
      entries.set(folder, { path: folder, kind: "directory" })
    }
  }
  // Fail closed: a listing cut short cannot show that a folder holds nothing hidden, so it adds no folders.
  if (input.listing === undefined || !input.listing.complete) return [...entries.values()]

  const hiddenFiles = input.listing.entries
    .filter((entry) => entry.kind === "file" && !visibleFiles.has(entry.path))
    .map((entry) => entry.path)
  for (const entry of input.listing.entries) {
    if (entry.kind !== "directory" || entries.has(entry.path)) continue
    if (hiddenFiles.some((path) => path.startsWith(`${entry.path}/`))) continue
    entries.set(entry.path, { path: entry.path, kind: "directory" })
  }
  return [...entries.values()]
}
