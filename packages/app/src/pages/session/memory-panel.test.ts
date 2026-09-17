/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// Phase 9 (Memory mobile single-pane) - static smoke test. The panel is
// not renderable in this package's test setup, so the responsive wiring
// is pinned at the source level: the canonical viewport authority drives
// the single-pane mode, tap-to-navigate switches panes, and no local CSS
// breakpoint hides a pane behind the user's back.

const SOURCE = resolve(import.meta.dir, "memory-panel.tsx")
const source = readFileSync(SOURCE, "utf8")

describe("MemoryPanel mobile single-pane (Phase 9)", () => {
  test("reads the canonical viewport authority", () => {
    expect(source).toMatch(/import\s+\{\s*useViewport\s*\}\s+from\s+"@\/shell\/v110-store"/)
    expect(source).toMatch(
      /family === "phone-portrait" \|\| family === "tablet-portrait" \|\| family === "compact-landscape"/,
    )
  })

  test("collapses the triptych to one visible pane via data-memory-layout", () => {
    expect(source).toMatch(/data-memory-layout=\{narrow\(\) \? "single" : "triptych"\}/)
    expect(source).toMatch(/classList=\{\{ hidden: narrow\(\) && mobilePane\(\) !== "vault" \}\}/)
    expect(source).toMatch(/classList=\{\{ hidden: narrow\(\) && mobilePane\(\) !== "note" \}\}/)
    expect(source).toMatch(/classList=\{\{ hidden: narrow\(\) && mobilePane\(\) !== "links" \}\}/)
  })

  test("tap-to-navigate selects a note and switches to the note pane", () => {
    expect(source).toMatch(/setSelectedPath\(item\.path\); setMobilePane\("note"\)/)
    expect(source).toMatch(/setSelectedPath\(node\.path\); setMobilePane\("note"\)/)
  })

  test("exposes back navigation between panes", () => {
    expect(source).toMatch(/data-memory-back-to-vault/)
    expect(source).toMatch(/data-memory-open-links/)
    expect(source).toMatch(/data-memory-back-to-note/)
  })

  test("narrow viewports do not auto-select the first note", () => {
    expect(source).toMatch(/if \(narrow\(\)\) return/)
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

  test("moves a dragged note through the real workspace rename route", () => {
    expect(source).toMatch(/renameFile\(current\.workspaceId, from, to\)/)
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

  test("advances the CAS stamp in place instead of racing a refetch", () => {
    expect(source).toMatch(/queryClient\.setQueryData\(\["memory-note", sdk\.directory, path\], result\.data\)/)
    expect(source).toMatch(/if \(draft\(\) !== content\) scheduleAutosave\(\)/)
  })

  test("persists pending edits before switching notes and never clobbers newer ones", () => {
    expect(source).toMatch(/if \(saveState\(\) === "unsaved"\) void persistNote\("auto"\); setSelectedPath\(item\.path\); setMobilePane\("note"\)/)
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

  test("routes each action to the real workspace client", () => {
    expect(source).toMatch(/renameFile\(current\.workspaceId, from, to\)/)
    expect(source).toMatch(/createFiles\(current\.workspaceId, \[\{ path, content \}\]\)/)
    expect(source).toMatch(/removeFiles\(current\.workspaceId, \[target\]\)/)
    expect(source).toMatch(/sdk\.client\.file\.mkdir\(\{ path \}\)/)
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
    expect(source).toMatch(/graphDepth\(\) >= 3 \? 1 : graphDepth\(\) \+ 1/)
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
