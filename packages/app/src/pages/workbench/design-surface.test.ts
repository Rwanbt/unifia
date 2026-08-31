/* SPDX-License-Identifier: MIT */

// Structural / static tests for the DA-UI-02 / DA-UI-03 approval
// state machine on the Design surface.
//
// The reducer is a pure function — it would be straightforward to
// cover behaviourally with a `bun:test` import of the helpers — but
// `design-surface.tsx` is a `.tsx` module that imports Solid's
// client-only runtime (`use` from `solid-js/web`, which is not part
// of the SSR build). Bun's test loader therefore picks the server
// build and a literal import fails before any code runs. The same
// constraint bit V03 in `provider.test.ts`, which uses the read-
// file + regex pattern below to assert the contract without ever
// evaluating the module.
//
// The trade-off: these tests catch a regression the moment a
// refactor drops a state, a transition, or a guard from the file.
// They do not exercise the reducer's run-time behaviour; that path
// is covered by the typecheck (`tsc --noEmit`) and by the e2e
// suite under `e2e/modes/design-mode.spec.ts`. Together they form
// the DA-UI-02 / DA-UI-03 quality gate.

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, test } from "bun:test"

const SURFACE_TSX = resolve(import.meta.dir, "./design-surface.tsx")
const surface = readFileSync(SURFACE_TSX, "utf-8")

function extractUnion(name: string): string {
  // Catches the multi-line discriminated union the reducer drives.
  const re = new RegExp(`export type ${name} =\\s*([\\s\\S]+?)\\n\\}`, "m")
  const match = surface.match(re)
  if (!match) throw new Error(`Could not find \`export type ${name}\` in design-surface.tsx`)
  return match[1]
}

describe("DA-UI-02 — approval state machine type (the 8-shape discriminated union)", () => {
  test("declares the brief's gate kinds plus the `approval-required` expiry flag", () => {
    // Plan-Audit §9.1:
    //   idle → requesting → approval-required → resolving → retrying → succeeded|failed|cancelled
    // The expiry flag is the DA-UI-03 addition; it stays on the
    // `approval-required` sub-state so the modal can render the
    // non-modal warning without losing the in-flight approval id.
    const union = extractUnion("ApprovalState")
    expect(union).toMatch(/"idle"/)
    expect(union).toMatch(/"requesting"/)
    expect(union).toMatch(/"approval-required"/)
    expect(union).toMatch(/expired:\s*boolean/)
    expect(union).toMatch(/"resolving"/)
    expect(union).toMatch(/"retrying"/)
    expect(union).toMatch(/"succeeded"/)
    expect(union).toMatch(/"failed"/)
    expect(union).toMatch(/"cancelled"/)
  })

  test("the approval-required variant carries broker metadata (id, capability, resource, deadline)", () => {
    const union = extractUnion("ApprovalState")
    const branch = union.match(/\{\s*kind:\s*"approval-required"[\s\S]+?\}/)
    expect(branch).not.toBeNull()
    expect(branch![0]).toMatch(/approvalId:\s*string/)
    expect(branch![0]).toMatch(/capability:\s*string/)
    expect(branch![0]).toMatch(/resource:\s*string/)
    expect(branch![0]).toMatch(/expiresAt:\s*number/)
  })
})

describe("DA-UI-02 — the reducer covers every transition on the brief's diagram", () => {
  test("exports a pure `reduceApprovalState` reducer with the right signature", () => {
    const signature = surface.match(/export function reduceApprovalState\(\s*state:\s*ApprovalState,\s*event:\s*ApprovalEvent\):\s*ApprovalState\s*\{/)
    expect(signature).not.toBeNull()
  })

  test("idle + request-start → requesting", () => {
    expect(surface).toMatch(/case "request-start":[\s\S]+?return\s*\{\s*kind:\s*"requesting"\s*\}/)
  })

  test("requesting + request-approval-required → approval-required (carries broker metadata)", () => {
    expect(surface).toMatch(/case "request-approval-required":[\s\S]+?return\s*\{\s*kind:\s*"approval-required"/)
  })

  test("approval-required + resolve-start → resolving, but the expired branch is a no-op", () => {
    const block = surface.match(/case "resolve-start":[\s\S]+?\}/)
    expect(block).not.toBeNull()
    expect(block![0]).toMatch(/"resolving"/)
    expect(block![0]).toMatch(/state\.expired/)
  })

  test("resolving + resolve-completed → retrying, retrying + retry-start → requesting (retry path)", () => {
    expect(surface).toMatch(/case "resolve-completed":[\s\S]+?return\s*\{\s*kind:\s*"retrying"\s*\}/)
    expect(surface).toMatch(/case "retry-start":[\s\S]+?return\s*\{\s*kind:\s*"requesting"\s*\}/)
  })

  test("requesting|retrying + request-succeeded → succeeded, request-failed → failed", () => {
    expect(surface).toMatch(/case "request-succeeded":[\s\S]+?return\s*\{\s*kind:\s*"succeeded"\s*\}/)
    expect(surface).toMatch(/case "request-failed":[\s\S]+?return\s*\{\s*kind:\s*"failed",\s*error:\s*event\.error\s*\}/)
  })

  test("any in-flight state + cancel → cancelled; terminals ignore cancel", () => {
    const block = surface.match(/case "cancel":[\s\S]+?\}/)
    expect(block).not.toBeNull()
    expect(block![0]).toMatch(/"cancelled"/)
    expect(block![0]).toMatch(/"succeeded" \|\| state\.kind === "failed" \|\| state\.kind === "cancelled" \|\| state\.kind === "idle"/)
  })
})

describe("DA-UI-02 — canStartApproval (DA-UI-03 double-click guard)", () => {
  test("the predicate refuses every in-flight kind and accepts terminal + expired", () => {
    const block = surface.match(/export function canStartApproval\([\s\S]+?\}/)
    expect(block).not.toBeNull()
    expect(block![0]).toMatch(/"idle" \|\| state\.kind === "succeeded" \|\| state\.kind === "failed" \|\| state\.kind === "cancelled"/)
    expect(block![0]).toMatch(/state\.kind === "approval-required" && state\.expired/)
  })
})

describe("DA-UI-02 — isApprovalModalVisible (the modal gate)", () => {
  test("visible only on approval-required or resolving", () => {
    const block = surface.match(/export function isApprovalModalVisible\([\s\S]+?\}/)
    expect(block).not.toBeNull()
    expect(block![0]).toMatch(/"approval-required" \|\| state\.kind === "resolving"/)
  })
})

describe("DA-UI-03 — expiration + navigation + double-click", () => {
  test("the expire event flips the approval-required sub-state to expired: true (idempotent)", () => {
    // The case body is small enough to be matched in one shot; the
    // outer switch contains a sibling `}` that we don't want to
    // confuse with the case's closing brace, so we anchor on the
    // case label rather than the first `}`.
    const block = surface.match(/case "expire":\s*if[\s\S]+?return \{ \.\.\.state, expired: true \}/)
    expect(block).not.toBeNull()
    expect(block![0]).toMatch(/state\.kind !== "approval-required" \|\| state\.expired/)
  })

  test("the surface aborts the in-flight HTTP request on unmount (DA-UI-03 navigation cleanup)", () => {
    // There are several `onCleanup` blocks in the file (e.g. the
    // comment store's debounce timer). We target the export-cleanup
    // one by its `DA-UI-03` comment marker, which the author must
    // keep alongside `exportAbort.abort()` so the regex keeps
    // matching across refactors.
    const block = surface.match(/onCleanup\(\(\) => \{[\s\S]+?if \(state\.kind === "requesting" \|\| state\.kind === "resolving" \|\| state\.kind === "retrying"\)[\s\S]+?\}\)/)
    expect(block).not.toBeNull()
    expect(block![0]).toMatch(/exportAbort\.abort\(\)/)
    expect(block![0]).toMatch(/clearTimeout\(approvalExpireTimer\)/)
  })

  test("the `runExportFlow` entry point guards a second click with `canStartApproval` (DA-UI-03 double-click)", () => {
    const block = surface.match(/async function runExportFlow\([\s\S]+?const signal = exportAbort\.signal/)
    expect(block).not.toBeNull()
    expect(block![0]).toMatch(/if \(!canStartApproval\(approvalState\(\)\)\) return/)
  })

  test("the `runExportFlow` retry path routes through `retry-start` then re-issues the same request", () => {
    const block = surface.match(/async function runExportFlow\([\s\S]+?throw new Error\("export returned an unrecognised envelope"\)/)
    expect(block).not.toBeNull()
    expect(block![0]).toMatch(/setApprovalState\(\{ type: "retry-start" \}\)/)
    expect(block![0]).toMatch(/setApprovalState\(\{ type: "request-start" \}\)/)
  })
})

describe("DA-UI-02 / DA-UI-03 — the modal renders and routes the right callbacks", () => {
  test("`ApprovalModal` is wired into the surface's return, with onAllow/onDeny/onCancel", () => {
    expect(surface).toMatch(/<ApprovalModal[\s\S]+?\/>/)
    const block = surface.match(/<ApprovalModal[\s\S]+?\/>/)
    expect(block![0]).toMatch(/onAllow=\{/)
    expect(block![0]).toMatch(/onDeny=\{/)
    expect(block![0]).toMatch(/onCancel=\{/)
  })

  test("the modal's data attributes announce the state and the expired flag (test + a11y contract)", () => {
    expect(surface).toMatch(/data-design-approval-modal=\{props\.state\.kind\}/)
    expect(surface).toMatch(/data-design-approval-expired=/)
  })

  test("the modal exposes Allow, Deny, and Cancel buttons with stable test selectors", () => {
    expect(surface).toMatch(/data-design-approval-action="allow"/)
    expect(surface).toMatch(/data-design-approval-action="deny"/)
    expect(surface).toMatch(/data-design-approval-action="cancel"/)
  })
})
