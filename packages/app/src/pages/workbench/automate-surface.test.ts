/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// C-PRE1-01 — suite Automate minimale (R-013, Critical, bloquant M1).
//
// Phase 1 : smoke test statique qui pin la forme du fichier de la
// surface. Le module lui-meme ne peut pas etre importe en Node
// (SolidJS router client-only), donc on verifie le code source.
//
// Phase 2 (livree dans `automate-decode.test.ts`) : tests round-trip
// reels sur les helpers extraits (`decodeFile`,
// `parseWorkflowDefinition`).
//
// La phase 3 (a faire en M1, apres ADR-000) :
//   - e2e minimal : 1 parcours approval_required avec horloge Playwright
//   - test des 8 sorties du plan v4 §16.3

const SURFACE = resolve(import.meta.dir, "automate-surface.tsx")
const source = readFileSync(SURFACE, "utf8")

describe("C-PRE1-01 automate-surface smoke test (static)", () => {
  test("exports the AutomateSurface SolidJS component", () => {
    expect(source).toMatch(/export\s+function\s+AutomateSurface\s*\(/)
  })

  test("imports decodeFile and parseWorkflowDefinition from automate-decode", () => {
    // After phase 2 extraction (C-PRE1-01), the surface delegates parsing
    // to ./automate-decode. This pins that contract: a future refactor
    // that re-inlines the parsing breaks this test, which is the point.
    expect(source).toMatch(/from\s+["']\.\/automate-decode["']/)
    expect(source).toMatch(/\bdecodeFile\b/)
    expect(source).toMatch(/\bparseWorkflowDefinition\b/)
  })

  test("calls client.startWorkflow with the workflow definition", () => {
    // The contract is: client.startWorkflow(workspaceId, definition).
    // If this line ever changes, Phase 3 e2e will need to be rewritten.
    expect(source).toMatch(/client\.startWorkflow\(/)
  })

  test("handles the approvalRequired branch explicitly", () => {
    // Phase 3 e2e covers this branch end-to-end.
    expect(source).toMatch(/approvalRequired/)
  })

  test("parses the editable draft and falls back to the decoded file body", () => {
    // A restored local draft is the authoritative editor value. Before it
    // exists, the decoded server file remains the safe fallback.
    expect(source).toMatch(/parseWorkflowDefinition\(draftSource\(\) \|\| publishedSource\(\)\)/)
    expect(source).toMatch(/return file \? decodeFile\(file\) : ""/)
  })

  test("writes the drawn graph into the draft on every edit and on the Versions menu save", () => {
    // Anti-regression: positions, edges and library nodes live in the draft
    // (`ui`), so Publish and reload keep them and Run sends the added nodes.
    expect(source).toMatch(/onSaveCanonical=\{saveGraphToDraft\}/)
    expect(source).toMatch(/updateDraftSource\(sourceWithGraph\(/)
    expect(source).toMatch(/runnableSteps\(steps, graph\(\)\.extraNodes, graph\(\)\.edges\)/)
    expect(source).toMatch(/runnableEdges\(steps, graph\(\)\.extraNodes, graph\(\)\.edges\)/)
    expect(source).toMatch(/graphFromSource\(/)
  })

  test("reclaims the run token from the server for an earlier session and keeps it in memory only", () => {
    // CR05: a run listed from a previous session is cancelled with a token the
    // server hands back to its owner; the token is never persisted or logged.
    expect(source).toMatch(/reclaimWorkflow\(current\.workspaceId, runId\)/)
    expect(source).toMatch(/const runAuthorities = new Map<string, WorkflowAuthority>\(\)/)
    expect(source).not.toMatch(/(localStorage|sessionStorage|indexedDB)[^\n]*(authority|Authority)/)
    expect(source).not.toMatch(/log\([^\n]*(authority|Authority)/)
  })

  // ADR-086: phones keep the canvas like the reference; the library opens as
  // a sheet from the zoom pill's Nodes button and the debugger is toggled.
  test("uses the viewport authority for the phone layout", () => {
    expect(source).toMatch(/useViewport\(\)/)
    expect(source).toMatch(/data-automate-studio-layout=\{narrow\(\) \? "single" : "studio"\}/)
    expect(source).toMatch(/data-automate-studio-nodes-sheet/)
    expect(source).toMatch(/data-automate-studio-debug-toggle/)
  })

  test("opens the first workflow file and creates real files only", () => {
    expect(source).toMatch(/if \(!selectedDefinition\(\) && first\) openDefinition\(first\)/)
    expect(source).toMatch(/JSON\.stringify\(\{ id, version: 1, steps: \[\] \}, null, 2\)/)
    expect(source).toMatch(/current\.client\.createFiles\(/)
  })

  test("coalesces a drag into one undo step", () => {
    expect(source).toMatch(/DRAG_COALESCE_MS = 400/)
    expect(source).toMatch(/const sameDrag = kind === "positions"/)
  })
})
