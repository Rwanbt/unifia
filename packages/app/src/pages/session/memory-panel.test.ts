/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// Phase 9 (Memory mobile single-pane) - static smoke test. The panel is
// not renderable in this package's test setup, so the responsive wiring
// is pinned at the source level: the canonical viewport authority drives
// the single-pane mode, the vault and the links open as drawers over the
// note (ADR-084), and no local CSS breakpoint hides a pane behind the
// user's back.

// The graph renderer lives in its own component; its markup is pinned with
// the panel's.
const source = ["memory-panel.tsx", "memory-graph.tsx"].map((file) => readFileSync(resolve(import.meta.dir, file), "utf8")).join("\n")

describe("MemoryPanel mobile single-pane (Phase 9)", () => {
  test("reads the canonical viewport authority", () => {
    expect(source).toMatch(/import\s+\{\s*useViewport\s*\}\s+from\s+"@\/shell\/v110-store"/)
    expect(source).toMatch(
      /family === "phone-portrait" \|\| family === "tablet-portrait" \|\| family === "compact-landscape"/,
    )
  })

  test("keeps the note on screen and opens the vault and the links as drawers", () => {
    expect(source).toMatch(/data-memory-layout=\{narrow\(\) \? "single" : "triptych"\}/)
    expect(source).toMatch(/data-memory-vault data-drawer-open=\{narrow\(\) && drawer\(\) === "vault" \? "" : undefined\}/)
    expect(source).toMatch(/<article data-memory-note-pane>/)
    expect(source).toMatch(/data-memory-links data-drawer-open=\{narrow\(\) && drawer\(\) === "links" \? "" : undefined\}/)
    expect(source).toMatch(/data-memory-scrim/)
  })

  test("opening a note closes the drawer", () => {
    expect(source).toMatch(/setSelectedPath\(item\.path\); setDrawer\(undefined\)/)
    expect(source).toMatch(/const openFromGraph = \(path: string\) => \{ setSelectedPath\(path\); setDrawer\(undefined\); setSurface\("note"\) \}/)
  })

  test("the toolbar chevrons toggle the drawers and each drawer closes itself", () => {
    expect(source).toMatch(/data-memory-back-to-vault[^>]*onClick=\{\(\) => toggleDrawer\("vault"\)\}/)
    expect(source).toMatch(/data-memory-open-links[^>]*onClick=\{\(\) => toggleDrawer\("links"\)\}/)
    expect(source).toMatch(/data-memory-back-to-note data-memory-close-drawer/)
  })

  test("phones switch between the note and the graph beside Edit/Preview", () => {
    expect(source).toMatch(/data-memory-surface-switch/)
    expect(source).toMatch(/<Show when=\{narrow\(\) && surface\(\) === "graph"\}/)
  })

  test("every layout opens on a note", () => {
    expect(source).toMatch(/if \(!selectedPath\(\) && notes\(\)\[0\]\) setSelectedPath\(notes\(\)\[0\]\.path\)/)
  })

  test("no local CSS breakpoint hides a pane (viewport authority wins)", () => {
    expect(source).not.toMatch(/max-\[620px\]/)
    expect(source).not.toMatch(/max-\[900px\]/)
  })
})

describe("MemoryPanel vault tree + DnD (Phase 9 remainder)", () => {
  test("renders the tree from the pure model and keeps the folder rows droppable", () => {
    expect(source).toMatch(/buildMemoryTree/)
    expect(source).toMatch(/visibleMemoryRows/)
    expect(source).toMatch(/data-memory-folder=\{item\.path\}/)
    expect(source).toMatch(/aria-expanded=\{!collapsed\(\)\.has\(item\.path\)\}/)
  })

  test("moves a dragged note as a governed move proposal", () => {
    expect(source).toMatch(/moveNote\(from, to\)/)
    expect(source).toMatch(/memoryMovePath\(from, folder\)/)
    expect(source).toMatch(/draggable="true"/)
  })

  test("expands a collapsed drop target after the 620 ms hover delay", () => {
    expect(source).toMatch(/AUTO_EXPAND_DELAY_MS = 620/)
    expect(source).toMatch(/overFolder\(event, item\.path\)/)
    expect(source).toMatch(/onDrop=\{\(event\) => void dropOnFolder\(event, item\.path\)\}/)
  })

  test("labels the vault through the shared i18n dictionary", () => {
    expect(source).toMatch(/t\("workbench\.memory\.vault\.title"\)/)
    expect(source).toMatch(/t\("workbench\.memory\.vault\.searchPlaceholder"\)/)
  })
})

describe("MemoryPanel autosave (v110 700 ms contract)", () => {
  test("debounces writes at 700 ms and flushes on the explicit Save", () => {
    expect(source).toMatch(/AUTOSAVE_DELAY_MS = 700/)
    expect(source).toMatch(/void persistNote\("auto"\)/)
    expect(source).toMatch(/void persistNote\("manual"\)/)
  })

  test("saves a governed update conditional on the version read, then caches the re-read version", () => {
    expect(source).toMatch(/knowledge\(\)\.propose\(updateNoteBodyIntent\(current, body\), MEMORY_REASONS\.edit\)/)
    expect(source).toMatch(/queryClient\.setQueryData\(\["memory-note", sdk\.directory, path\], toMemoryNoteFile\(saved\)\)/)
    expect(source).toMatch(/if \(draft\(\) === content\) setDraft\(saved\.body\)/)
    expect(source).toMatch(/else scheduleAutosave\(\)/)
  })

  test("a stale version is reported as a conflict, not as a failed save", () => {
    expect(source).toMatch(/error instanceof KnowledgeRequestError && error\.status === 409/)
    expect(source).toMatch(/t\("workbench\.memory\.save\.conflict"\)/)
  })

  test("persists pending edits before switching notes and never clobbers newer ones", () => {
    expect(source).toMatch(/if \(saveState\(\) === "unsaved"\) void persistNote\("auto"\); setSelectedPath\(item\.path\); setDrawer\(undefined\)/)
    expect(source).toMatch(/if \(memorySaveState\(draft\(\), content, false\) === "unsaved"\) return/)
  })

  test("renders the save-state chip from the shared dictionary", () => {
    expect(source).toMatch(/data-memory-save-state=\{saveState\(\)\}/)
  })
})

describe("MemoryPanel context actions (Phase 9.5)", () => {
  test("opens a right-click menu per row kind with only real actions", () => {
    expect(source).toMatch(/onContextMenu=\{\(event\) => openMenu\(event, "note", item\.path, item\.name\)\}/)
    expect(source).toMatch(/onContextMenu=\{\(event\) => openMenu\(event, "folder", item\.path, item\.name\)\}/)
    expect(source).toMatch(/memoryMenuActions\(current\(\)\.kind\)/)
  })

  test("routes every note action through a governed proposal", () => {
    expect(source).toMatch(/createNoteIntent\(locatorOf\(path\), `# \$\{name\}\\n\\n`\)/)
    expect(source).toMatch(/duplicateNoteIntent\(locatorOf\(path\), source\)/)
    expect(source).toMatch(/deleteNoteIntent\(note\)/)
    expect(source).toMatch(/moveNote\(target, to\)/)
  })

  test("renames inline with Enter/Escape and no clobber on blur", () => {
    expect(source).toMatch(/if \(event\.key === "Enter"\) void commitRename\(\)/)
    expect(source).toMatch(/onBlur=\{\(\) => \{ if \(renaming\(\) === item\.path\) void commitRename\(\) \}\}/)
  })

  test("exports a real Markdown download and confirms deletes", () => {
    expect(source).toMatch(/anchor\.download = target\.slice/)
    expect(source).toMatch(/window\.confirm\(t\("workbench\.memory\.actions\.confirmDelete"/)
  })
})

describe("MemoryPanel depth graph filters (Phase 9.6)", () => {
  test("cycles depth and toggles tags/orphans with the mockup defaults", () => {
    expect(source).toMatch(/const \[graphDepth, setGraphDepth\] = createSignal\(2\)/)
    expect(source).toMatch(/props\.filters\.depth >= 3 \? 1 : props\.filters\.depth \+ 1/)
    expect(source).toMatch(/data-memory-graph-depth/)
    expect(source).toMatch(/data-memory-graph-tags/)
    expect(source).toMatch(/data-memory-graph-orphans/)
  })

  test("draws nodes, tag nodes and edges from the pure graph model", () => {
    expect(source).toMatch(/memoryGraphAtDepth\(current, notes\(\), documents\.data \?\? \[\], graphDepth\(\), \{ orphans: graphOrphans\(\), tags: graphTags\(\) \}\)/)
    expect(source).toMatch(/data-memory-graph-node=\{node\.path\}/)
    expect(source).toMatch(/data-memory-graph-tag=\{tag\.tag\}/)
    expect(source).toMatch(/data-memory-graph-summary/)
  })

  test("derives backlinks and graph from one documents query", () => {
    expect(source).toMatch(/queryKey: \["memory-documents", sdk\.directory/)
    expect(source).not.toMatch(/memory-backlinks/)
  })
})

describe("MemoryPanel governed reads (Sovereign Knowledge tranche 2)", () => {
  test("lists, reads and rewrites notes through the knowledge routes, never the raw file API", () => {
    expect(source).toMatch(/knowledge\(\)\.tree\(\)/)
    expect(source).toMatch(/knowledge\(\)\.note\(locatorOf\(path!\)\)/)
    expect(source).toMatch(/readOwnedOrSkip\(\(\) => knowledge\(\)\.note\(locatorOf\(candidate\.path\)\)\)/)
    expect(source).not.toMatch(/sdk\.client\.file\.(readRaw|write)/)
  })

  test("the only workspace write left is creating a folder, and it stays visible", () => {
    // A folder is not a knowledge object: creating one still uses the workspace file route. A folder is
    // never renamed, moved or removed from the panel: no menu offers it, and memoryRenamePath has no target for one.
    expect(source).toMatch(/sdk\.client\.file\.mkdir\(\{ path \}\)/)
    expect(source).not.toMatch(/renameFile\(/)
    expect(source).not.toMatch(/createFiles\(/)
    expect(source).not.toMatch(/removeFiles\(/)
  })

  test("the folder listing is read in full and merged with the notes, so no withheld note shows", () => {
    expect(source).toMatch(/readVaultListing\(\(cursor\) => current\.client\.listFiles\(current\.workspaceId, MEMORY_ROOT, cursor\)/)
    expect(source).toMatch(/vaultTreeEntries\(\{ notes: tree\.notes, listing \}\)/)
  })
})
