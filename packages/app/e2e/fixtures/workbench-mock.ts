/* SPDX-License-Identifier: MIT */

// V14.5 — mock workbench bridge for the design journey e2e.
//
// The harness injects this platform via the test hook in
// `entry.tsx` (window.__UNIFIA_PLATFORM__). The e2e spec calls
// `installWorkbenchMock(page)` from a `addInitScript` so the
// global is set BEFORE the app code runs.
//
// The mock covers enough of `WorkbenchClient` to render the
// design surface and exercise a single prompt → artifact round
// trip. It is intentionally NOT a full server: methods that the
// design journey does not call return empty defaults via the
// Proxy fallback. The goal is the test infrastructure; the full
// mock is a follow-up card.

import type { Page } from "@playwright/test"
export type WorkbenchMockOptions = {
  /** Manifests returned by listDesignSystems. Default: one empty system. */
  designSystems?: ReadonlyArray<{
    id: string
    name: string
    version: string
    source: string
    tokens: Record<string, unknown>
  }>
  /** Skills returned by listDesignSkills. Default: empty list. */
  skills?: ReadonlyArray<Record<string, unknown>>
}

/**
 * Install the mock onto the page. Must be called via
 * `addInitScript` so the global is set before the app code runs.
 */
export function workbenchMockInitScript(): string {
  // Returns a JavaScript string that the page side executes
  // via page.addInitScript. The descriptor is reconstructed
  // here; the actual client behaviour is implemented as a
  // lightweight in-page object that satisfies the structural
  // shape the app expects.
  return `
    (() => {
      const descriptor = window.__UNIFIA_MOCK_DESCRIPTOR__ || { designSystems: [], skills: [] }
      // The native bridge is asynchronous across an IPC/HTTP turn. Resolving
      // immediately in the current microtask re-enters Solid Query while it
      // is updating its observer and does not represent production timing.
      const reply = (value) => new Promise((resolve) => setTimeout(() => resolve(value), 0))
      const makeArtifact = (input) => {
        const id = input.artifactId || ("art-" + Math.random().toString(36).slice(2, 10))
        return {
          artifactId: id,
          version: 1,
          kind: input.kind,
          filename: input.filename,
          relativePath: "design/" + input.filename,
          sha256: "deadbeef",
          bytes: input.content.length,
          createdAt: Date.now(),
          metadata: input.metadata || {},
          provenance: input.provenance || {},
        }
      }
      // Keep the mock structurally close to a real client. A permissive Proxy
      // made every property lookup look like an async method, including
      // framework-internal probes, which caused a Solid update recursion.
      const client = {
        listDesignSystems: () => reply({ designSystems: descriptor.designSystems }),
        listDesignSkills: () => reply({ skills: descriptor.skills }),
        githubStatus: () => reply({ connected: false, configured: false }),
        validateSpec: (spec) => reply({ valid: true, spec, capabilities: { granted: [], denied: [] } }),
        createArtifact: (input) => reply({ artifact: makeArtifact(input) }),
        exportArtifact: (_workspaceId, artifactId) => reply({ exported: { artifactId, version: 1, relativePath: "design/out.svg", sha256: "deadbeef", metadata: {} } }),
        artifactHistory: () => reply({ history: [] }),
        listArtifacts: () => reply({ artifacts: [] }),
        listDocuments: () => reply({ documents: [] }),
        listFiles: () => reply({ entries: [], skipped: 0 }),
        readFiles: () => reply({ results: [] }),
        listApprovals: () => reply({ approvals: [] }),
        trace: () => reply({ kind: "trace", events: [], nextCursor: null }),
        activity: () => reply({ kind: "activity", events: [], nextCursor: null }),
        searchCapabilities: () => reply({ records: [] }),
        events: async function* (_workspaceId, _dispatcher, signal) {
          if (!signal) return
          await new Promise((resolve) => {
            if (signal.aborted) return resolve()
            signal.addEventListener("abort", resolve, { once: true })
          })
        },
        current: () => undefined,
        refresh: async () => "",
      }
      const connection = {
        client,
        serverOrigin: "mock://workbench",
        instanceId: "mock-instance-1",
        workspaceId: descriptor.workspaceId || "mock-workspace-1",
        async revoke() {
          // No-op: the mock does not own any native resource.
        },
      }
      window.__UNIFIA_PLATFORM__ = { workbench: { connect: async () => connection } }
    })()
  `
}

export async function installWorkbenchMock(
  page: Page,
  opts: WorkbenchMockOptions & { workspaceId?: string } = {},
): Promise<void> {
  const descriptor = {
    designSystems: opts.designSystems ?? [
      {
        id: "test-system",
        name: "Test system",
        version: "1.0.0",
        source: "test",
        tokens: { colors: {}, spacing: {}, typography: {} },
      },
    ],
    skills: opts.skills ?? [],
    workspaceId: opts.workspaceId ?? "mock-workspace-1",
  }
  // Pass the descriptor through a single init script so the
  // page side can read it. Two scripts: first sets the
  // descriptor, second reads it and builds the platform.
  await page.addInitScript((value) => {
    ;(window as unknown as { __UNIFIA_MOCK_DESCRIPTOR__: unknown }).__UNIFIA_MOCK_DESCRIPTOR__ = value
  }, descriptor)
  await page.addInitScript({
    content: workbenchMockInitScript(),
  })
}
