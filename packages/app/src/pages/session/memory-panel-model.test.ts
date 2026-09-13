import { describe, expect, test } from "bun:test"
import { buildMemoryTree, isMemoryMarkdown, linkedMemoryNotes, localMemoryGraph, memoryBacklinks, memoryExcerpt, memoryGraphAtDepth, memoryMenuActions, memoryMovePath, memoryRenamePath, memorySaveState, memoryTitle, memoryUniquePath, parseMemoryNote, visibleMemoryRows } from "./memory-panel-model"

describe("Memory inspector model", () => {
  test("only exposes Markdown notes from the configured workspace vault", () => {
    expect(isMemoryMarkdown(".unifia/memory/Architecture.md")).toBe(true)
    expect(isMemoryMarkdown("README.md")).toBe(false)
    expect(isMemoryMarkdown(".unifia/memory/diagram.svg")).toBe(false)
  })

  test("parses frontmatter, tags and wikilinks without serving the frontmatter as note text", () => {
    const note = parseMemoryNote(".unifia/memory/Architecture.md", "---\nproject: unifia\n---\n# Architecture\n\n#platform [[Vision|product vision]]")
    expect(note.title).toBe("Architecture")
    expect(note.body).not.toContain("project: unifia")
    expect(note.body).not.toContain("# Architecture")
    expect(note.tags).toEqual(["platform"])
    expect(note.links).toEqual(["Vision"])
  })

  test("resolves links by note identity, independent of the extension", () => {
    const notes = [{ path: ".unifia/memory/Vision.md", title: memoryTitle(".unifia/memory/Vision.md") }]
    expect(linkedMemoryNotes(["Vision.md"], notes)).toEqual(notes)
  })

  test("finds backlinks from parsed notes without using a second index", () => {
    const target = { path: ".unifia/memory/Vision.md", title: "Vision" }
    const architecture = parseMemoryNote(".unifia/memory/Architecture.md", "# Architecture\n[[Vision]]")
    expect(memoryBacklinks(target, [architecture])).toEqual([{ path: architecture.path, title: "Architecture" }])
  })

  test("memoryExcerpt strips markdown noise, collapses whitespace and truncates with ellipsis", () => {
    const body = "## Section\n\nThe **first** paragraph references `code` and a [link](https://example.com) plus an ![img](a.png). It carries a longer sentence that should be cut off somewhere after the configured limit."
    const excerpt = memoryExcerpt(body, 60)
    expect(excerpt).not.toMatch(/[*`#>[\]()!]/)
    expect(excerpt.endsWith("…")).toBe(true)
    expect(excerpt.length).toBeLessThanOrEqual(61)
  })

  test("memoryExcerpt returns the body unchanged when short enough and trims only when over the limit", () => {
    expect(memoryExcerpt("short body", 60)).toBe("short body")
    expect(memoryExcerpt("   spaced  out   body  ", 60)).toBe("spaced out body")
  })

  test("keeps a local graph stable around the selected note", () => {
    const selected = { path: ".unifia/memory/Architecture.md", title: "Architecture" }
    const graph = localMemoryGraph(selected, [{ path: ".unifia/memory/Vision.md", title: "Vision" }])
    expect(graph[0]).toMatchObject({ title: "Architecture", x: 50, y: 50 })
    expect(graph[1]?.title).toBe("Vision")
  })
})

describe("Memory vault tree and move target (Phase 9 folders)", () => {
  const entries = [
    { path: ".unifia/memory/10 - Projects/Unifia/Vision.md", kind: "file" as const },
    { path: ".unifia/memory/10 - Projects/Unifia/Automate.md", kind: "file" as const },
    { path: ".unifia/memory/10 - Projects/Unifia", kind: "directory" as const },
    { path: ".unifia/memory/10 - Projects", kind: "directory" as const },
    { path: ".unifia/memory/00 - Inbox", kind: "directory" as const },
    { path: ".unifia/memory/README.md", kind: "file" as const },
    { path: ".unifia/memory/diagram.svg", kind: "file" as const },
  ]

  test("builds a pre-order tree with folders before notes and subtree counts", () => {
    const rows = buildMemoryTree(entries)
    expect(rows.map((row) => `${row.kind}:${row.path}:${row.depth}`)).toEqual([
      "folder:.unifia/memory/00 - Inbox:0",
      "folder:.unifia/memory/10 - Projects:0",
      "folder:.unifia/memory/10 - Projects/Unifia:1",
      "note:.unifia/memory/10 - Projects/Unifia/Automate.md:2",
      "note:.unifia/memory/10 - Projects/Unifia/Vision.md:2",
      "note:.unifia/memory/README.md:0",
    ])
    expect(rows.find((row) => row.path.endsWith("10 - Projects"))?.count).toBe(2)
    expect(rows.find((row) => row.path.endsWith("00 - Inbox"))?.count).toBe(0)
  })

  test("keeps empty directories, drops non-Markdown files and paths outside the vault", () => {
    const rows = buildMemoryTree([...entries, { path: "src/index.ts", kind: "file" as const }, { path: "packages", kind: "directory" as const }])
    expect(rows.some((row) => row.path === "src/index.ts")).toBe(false)
    expect(rows.some((row) => row.path === "packages")).toBe(false)
    expect(rows.some((row) => row.path === ".unifia/memory/00 - Inbox")).toBe(true)
    expect(rows.some((row) => row.path.endsWith("diagram.svg"))).toBe(false)
  })

  test("hides descendants of collapsed folders without hiding the folder row", () => {
    const rows = visibleMemoryRows(buildMemoryTree(entries), new Set([".unifia/memory/10 - Projects/Unifia"]))
    expect(rows.map((row) => row.path)).toContain(".unifia/memory/10 - Projects/Unifia")
    expect(rows.map((row) => row.path)).not.toContain(".unifia/memory/10 - Projects/Unifia/Vision.md")
  })

  test("computes the destination path for a note dropped on a folder", () => {
    expect(memoryMovePath(".unifia/memory/README.md", ".unifia/memory/00 - Inbox")).toBe(".unifia/memory/00 - Inbox/README.md")
    expect(memoryMovePath(".unifia/memory/00 - Inbox/README.md", ".unifia/memory/00 - Inbox")).toBeUndefined()
    expect(memoryMovePath(".unifia/memory/README.md", ".unifia/memory")).toBeUndefined()
    expect(memoryMovePath("README.md", ".unifia/memory/00 - Inbox")).toBeUndefined()
  })
})

describe("Memory editor save state (autosave 700 ms)", () => {
  test("reports unsaved only while the draft differs from disk", () => {
    expect(memorySaveState("one", "one", false)).toBe("saved")
    expect(memorySaveState("two", "one", false)).toBe("unsaved")
  })

  test("a write in flight wins over the draft comparison", () => {
    expect(memorySaveState("two", "one", true)).toBe("saving")
  })

  test("a note that has not loaded yet is not reported as unsaved", () => {
    expect(memorySaveState("draft", undefined, false)).toBe("saved")
  })
})

describe("Memory context actions (Phase 9.5)", () => {
  test("offers only runtime-backed actions per row kind", () => {
    expect(memoryMenuActions("note")).toEqual(["open", "rename", "duplicate", "move", "export", "delete"])
    expect(memoryMenuActions("folder")).toEqual(["newNote", "newFolder"])
  })

  test("memoryUniquePath suffixes collisions maquette-style", () => {
    const existing = [".unifia/memory/New note.md", ".unifia/memory/New note-2.md"]
    expect(memoryUniquePath(existing, ".unifia/memory", "New note")).toBe(".unifia/memory/New note-3.md")
    expect(memoryUniquePath([], ".unifia/memory/10 - Projects", "Plan")).toBe(".unifia/memory/10 - Projects/Plan.md")
    expect(memoryUniquePath([".unifia/memory/New folder"], ".unifia/memory", "New folder", "")).toBe(".unifia/memory/New folder-2")
  })

  test("memoryRenamePath sanitises the stem and rejects empty or foreign paths", () => {
    expect(memoryRenamePath(".unifia/memory/Note.md", " Renamed/note ")).toBe(".unifia/memory/Renamed-note.md")
    expect(memoryRenamePath(".unifia/memory/Note.md", "   ")).toBeUndefined()
    expect(memoryRenamePath("README.md", "X")).toBeUndefined()
  })
})

describe("Memory depth graph (Phase 9.6)", () => {
  const notes = [
    { path: ".unifia/memory/a.md", title: "A" },
    { path: ".unifia/memory/b.md", title: "B" },
    { path: ".unifia/memory/c.md", title: "C" },
    { path: ".unifia/memory/isolated.md", title: "Isolated" },
  ]
  const documents = [
    parseMemoryNote(".unifia/memory/a.md", "# A\n[[B]] #alpha"),
    parseMemoryNote(".unifia/memory/b.md", "# B\n[[C]] #alpha #beta"),
    parseMemoryNote(".unifia/memory/c.md", "# C\n#beta"),
    parseMemoryNote(".unifia/memory/isolated.md", "# Isolated"),
  ]
  const options = { orphans: true, tags: false }

  test("depth 1 keeps direct neighbours, depth 2 walks one more hop", () => {
    const one = memoryGraphAtDepth(notes[0], notes, documents, 1, options)
    expect(one.nodes.map((node) => node.title).sort()).toEqual(["A", "B"])
    expect(one.edges).toEqual([{ from: ".unifia/memory/a.md", to: ".unifia/memory/b.md", kind: "note" }])
    const two = memoryGraphAtDepth(notes[0], notes, documents, 2, options)
    expect(two.nodes.map((node) => node.title).sort()).toEqual(["A", "B", "C"])
    expect(two.nodes.find((node) => node.title === "A")).toMatchObject({ x: 50, y: 50 })
  })

  test("tags render as an outer ring with membership edges", () => {
    const tagged = memoryGraphAtDepth(notes[0], notes, documents, 2, { orphans: true, tags: true })
    expect(tagged.tags.map((tag) => tag.tag)).toEqual(["alpha", "beta"])
    expect(tagged.edges.filter((edge) => edge.kind === "tag")).toEqual([
      { from: "tag:alpha", to: ".unifia/memory/a.md", kind: "tag" },
      { from: "tag:alpha", to: ".unifia/memory/b.md", kind: "tag" },
      { from: "tag:beta", to: ".unifia/memory/b.md", kind: "tag" },
      { from: "tag:beta", to: ".unifia/memory/c.md", kind: "tag" },
    ])
  })

  test("orphans filtering can empty the graph when the selected note is isolated", () => {
    const shown = memoryGraphAtDepth(notes[3], notes, documents, 2, { orphans: true, tags: false })
    expect(shown.nodes.map((node) => node.title)).toEqual(["Isolated"])
    const hidden = memoryGraphAtDepth(notes[3], notes, documents, 2, { orphans: false, tags: false })
    expect(hidden.nodes).toEqual([])
  })
})
