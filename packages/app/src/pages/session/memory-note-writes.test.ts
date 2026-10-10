/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { DEFAULT_PORTABLE_RESTRICTIONS } from "@unifia/contracts/knowledge"
import type { KnowledgeNote } from "@/utils/knowledge-client"
import {
  createNoteIntent,
  deleteNoteIntent,
  duplicateNoteIntent,
  MEMORY_NEW_NOTE_TYPE,
  moveNoteIntent,
  updateNoteBodyIntent,
} from "./memory-note-writes"

const OPEN_RESTRICTIONS = { remoteModel: "allow", localModel: "allow", embeddable: "allow", exportable: "allow" }

const NOTE: KnowledgeNote = {
  id: "0190d2c0-7b00-7000-8000-00000000000a",
  locator: "ideas/Plan.md",
  type: "decision",
  restrictions: OPEN_RESTRICTIONS,
  body: "# Plan\n\nBody",
  versionHash: "a".repeat(64),
}

describe("createNoteIntent", () => {
  test("a new note is unclassified, so it is closed to remote models and to export", () => {
    expect(createNoteIntent("ideas/New.md", "# New\n\n")).toEqual({
      kind: "create",
      targetLocator: "ideas/New.md",
      newContent: { type: MEMORY_NEW_NOTE_TYPE, restrictions: DEFAULT_PORTABLE_RESTRICTIONS, body: "# New\n\n" },
    })
    expect(DEFAULT_PORTABLE_RESTRICTIONS.remoteModel).toBe("deny")
    expect(DEFAULT_PORTABLE_RESTRICTIONS.exportable).toBe("deny")
  })
})

describe("duplicateNoteIntent", () => {
  test("a copy keeps its source's type, restrictions and body, so it is never more open than the note", () => {
    expect(duplicateNoteIntent("ideas/Plan copy.md", NOTE)).toEqual({
      kind: "create",
      targetLocator: "ideas/Plan copy.md",
      newContent: { type: NOTE.type, restrictions: NOTE.restrictions, body: NOTE.body },
    })
  })
})

describe("updateNoteBodyIntent", () => {
  test("an edit is conditional on the version the owner read, and keeps the note's type and restrictions", () => {
    expect(updateNoteBodyIntent(NOTE, "# Plan\n\nEdited")).toEqual({
      kind: "update",
      targetId: NOTE.id,
      expectedVersionHash: NOTE.versionHash,
      newContent: { type: NOTE.type, restrictions: NOTE.restrictions, body: "# Plan\n\nEdited" },
    })
  })
})

describe("moveNoteIntent", () => {
  test("a move names the note by id and version, and changes only its locator", () => {
    expect(moveNoteIntent(NOTE, "archive/Plan.md")).toEqual({
      kind: "move",
      targetId: NOTE.id,
      expectedVersionHash: NOTE.versionHash,
      targetLocator: "archive/Plan.md",
    })
  })
})

describe("deleteNoteIntent", () => {
  test("a delete names the note by id and version, never by path", () => {
    expect(deleteNoteIntent(NOTE)).toEqual({ kind: "delete", targetId: NOTE.id, expectedVersionHash: NOTE.versionHash })
  })
})
