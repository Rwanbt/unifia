/* SPDX-License-Identifier: MIT */
/**
 * The changes the Memory panel proposes to the vault, one builder per kind.
 *
 * The panel names a note by its path; the vault names it by id and version. Each builder takes the
 * note as the owner read it, so a proposal is conditional on that version: a change made since then
 * is refused, never merged over it. A new note is unclassified, so it cannot leave the machine until
 * the owner classifies it.
 */
import { DEFAULT_PORTABLE_RESTRICTIONS } from "@unifia/contracts/knowledge"
import type { KnowledgeIntent, KnowledgeNote } from "@/utils/knowledge-client"

/** A neutral type for a note the panel creates; the owner classifies it from the vault. */
export const MEMORY_NEW_NOTE_TYPE = "reference"

/** Recorded with each proposal, so the vault's audit trail says where a change came from. */
export const MEMORY_REASONS = {
  create: "Created in the Memory panel",
  duplicate: "Duplicated in the Memory panel",
  edit: "Edited in the Memory panel",
  link: "Wikilinks rewritten after a note rename",
  move: "Moved in the Memory panel",
  delete: "Deleted in the Memory panel",
} as const

export function createNoteIntent(locator: string, body: string): KnowledgeIntent {
  return {
    kind: "create",
    targetLocator: locator,
    newContent: { type: MEMORY_NEW_NOTE_TYPE, restrictions: DEFAULT_PORTABLE_RESTRICTIONS, body },
  }
}

/** A copy keeps its source's type, restrictions and body: it must never be more open than the note it copies. */
export function duplicateNoteIntent(locator: string, source: KnowledgeNote): KnowledgeIntent {
  return {
    kind: "create",
    targetLocator: locator,
    newContent: { type: source.type, restrictions: source.restrictions, body: source.body },
  }
}

/** What a change to an existing note is conditional on: the note's identity and the version the owner read. */
type ReadNoteVersion = Pick<KnowledgeNote, "id" | "versionHash">

export function updateNoteBodyIntent(note: ReadNoteVersion & Pick<KnowledgeNote, "type" | "restrictions">, body: string): KnowledgeIntent {
  return {
    kind: "update",
    targetId: note.id,
    expectedVersionHash: note.versionHash,
    newContent: { type: note.type, restrictions: note.restrictions, body },
  }
}

export function moveNoteIntent(note: ReadNoteVersion, locator: string): KnowledgeIntent {
  return { kind: "move", targetId: note.id, expectedVersionHash: note.versionHash, targetLocator: locator }
}

export function deleteNoteIntent(note: ReadNoteVersion): KnowledgeIntent {
  return { kind: "delete", targetId: note.id, expectedVersionHash: note.versionHash }
}
