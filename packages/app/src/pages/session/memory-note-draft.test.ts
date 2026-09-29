/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import {
  memoryDisplayPath,
  memoryDraftParts,
  memoryDraftTags,
  memoryLinkTarget,
  memoryPreviewMarkdown,
  withMemoryBody,
  withMemoryTags,
  withMemoryTitle,
} from "./memory-note-draft"

const NOTE = "# Vision\n\n#unifia #architecture\n\nBody text.\n"

const join = (raw: string) => {
  const p = memoryDraftParts(raw)
  return p.front + p.heading + p.lead + p.tagLine + p.trail + p.body
}

describe("Memory note draft", () => {
  test("splitting and joining gives back any note unchanged", () => {
    for (const raw of [
      NOTE,
      "",
      "no heading at all",
      "---\nproject: unifia\n---\n# T\r\n\r\n#a\r\n\r\nx\r\n",
      "# Only a title",
      "#tag-only-line\nbody",
      "# T\nbody #inline stays in the body",
      "# T\n\n\n#a #b   \n\n\nbody",
    ]) {
      expect(join(raw)).toBe(raw)
    }
  })

  test("reads the title, the tag line and the body apart", () => {
    const parts = memoryDraftParts(NOTE)
    expect(parts.title).toBe("Vision")
    expect(memoryDraftTags(NOTE)).toEqual(["unifia", "architecture"])
    expect(parts.body).toBe("Body text.\n")
  })

  test("a tag inside a sentence is not the tag line", () => {
    const parts = memoryDraftParts("# T\n\nSee #inline here\n")
    expect(parts.tagLine).toBe("")
    expect(parts.body).toBe("\nSee #inline here\n")
  })

  test("rewrites the title in place, or adds a heading", () => {
    expect(withMemoryTitle(NOTE, "Vision produit")).toBe("# Vision produit\n\n#unifia #architecture\n\nBody text.\n")
    expect(withMemoryTitle("Body\n", "New")).toBe("# New\n\nBody\n")
    expect(withMemoryTitle("---\na: 1\n---\n# Old\r\nx", "New")).toBe("---\na: 1\n---\n# New\r\nx")
  })

  test("rewrites the body and keeps the heading and tag line", () => {
    expect(withMemoryBody(NOTE, "Other.\n")).toBe("# Vision\n\n#unifia #architecture\n\nOther.\n")
  })

  test("rewrites, adds and removes the tag line", () => {
    expect(withMemoryTags(NOTE, "unifia, design")).toBe("# Vision\n\n#unifia #design\n\nBody text.\n")
    expect(withMemoryTags("# Vision\n\nBody text.\n", "a b")).toBe("# Vision\n\n#a #b\n\nBody text.\n")
    expect(withMemoryTags("# Vision", "a")).toBe("# Vision\n\n#a\n")
    expect(withMemoryTags(NOTE, "")).toBe("# Vision\n\nBody text.\n")
    expect(withMemoryTags("# Vision\n\nBody\n", " , ")).toBe("# Vision\n\nBody\n")
  })

  test("the preview drops the tag line and turns wikilinks into note links", () => {
    const preview = memoryPreviewMarkdown("# T\n\n#a\n\nSee [[Work mode]] and [[Design system|design]].\n")
    expect(preview).toBe("See [Work mode](#memory:Work%20mode) and [design](#memory:Design%20system).\n")
    expect(memoryPreviewMarkdown("# T\n\n```\n[[kept]]\n```\n")).toBe("\n```\n[[kept]]\n```\n")
    expect(memoryLinkTarget("#memory:Work%20mode")).toBe("Work mode")
    expect(memoryLinkTarget("https://example.com")).toBeUndefined()
    expect(memoryLinkTarget("#memory:%E0")).toBeUndefined()
  })

  test("the path line reads folder / file, relative to the vault", () => {
    expect(memoryDisplayPath(".unifia/memory/10 — Projects/Unifia/Vision produit.md", ".unifia/memory")).toBe(
      "10 — Projects/Unifia / Vision produit.md",
    )
    expect(memoryDisplayPath(".unifia/memory/Note.md", ".unifia/memory")).toBe("Note.md")
  })
})
