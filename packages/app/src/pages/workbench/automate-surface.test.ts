/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// C-PRE1-01 — suite Automate minimale (R-013, Critical, bloquant M1).
//
// Phase 1 : smoke test statique. Le module automate-surface.tsx
// importe @solidjs/router qui lance une erreur "Client-only API called
// on the server side" en environnement Node (test runner). Un import
// dynamique echoue donc systematiquement, comme documente dans
// le log de ce fichier (voir EXECUTION_STATUS phase PRE-1.1).
//
// La phase 1 verifie par lecture du source que la surface declare
// les symboles attendus et qu'aucune regression n'a ete introduite
// dans la forme du fichier.
//
// Phase 2 (a faire en M1, apres ADR-000) :
//   - decodeFile UTF-8 + base64 round-trip
//   - validation WorkflowDefinition (id/version/steps)
//   - e2e minimal : 1 parcours approval_required
// Phase 2 necessite l'extraction de decodeFile vers un helper
// testable, OU un environnement de test SolidJS (jsdom + provider
// mocks). Voir ADR-002 et plan §197 "M1 final gate".

const SURFACE = resolve(import.meta.dir, "automate-surface.tsx")
const source = readFileSync(SURFACE, "utf8")

describe("C-PRE1-01 automate-surface smoke test (static)", () => {
  test("exports the AutomateSurface SolidJS component", () => {
    expect(source).toMatch(/export\s+function\s+AutomateSurface\s*\(/)
  })

  test("declares a decodeFile helper for base64 + utf-8 file reads", () => {
    // Internal helper — not exported yet, but Phase 2 will require
    // either exporting it or extracting to a separate module.
    expect(source).toMatch(/const\s+decodeFile\s*=/)
    expect(source).toMatch(/atob\(/)
  })

  test("calls client.startWorkflow with the workflow definition", () => {
    // The contract is: client.startWorkflow(workspaceId, definition).
    // If this line ever changes, Phase 2 e2e will need to be rewritten.
    expect(source).toMatch(/client\.startWorkflow\(/)
  })

  test("handles the approvalRequired branch explicitly", () => {
    // Phase 2 e2e covers this branch end-to-end.
    expect(source).toMatch(/approvalRequired/)
  })

  test("validates the minimum WorkflowDefinition shape (id, version, steps)", () => {
    // The current validation is minimal — it only checks types. Phase 2
    // will replace this with a strict WorkflowIR validator aligned on
    // ADR-002. We pin the existing shape so any future drift is caught
    // even before the strict validator exists.
    expect(source).toMatch(/typeof\s+definition\.id\s*!==\s*"string"/)
    expect(source).toMatch(/definition\.version\s*!==\s*1/)
    expect(source).toMatch(/!Array\.isArray\(definition\.steps\)/)
  })
})
