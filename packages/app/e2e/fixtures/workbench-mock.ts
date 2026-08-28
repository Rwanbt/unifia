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
import type { WorkbenchConnection } from "@unifia/workbench-shell"

type MockEvent = Record<string, unknown>

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
  /** validateSpec return value. Default: { valid: true, granted: [], denied: [] }. */
  validateSpec?: (spec: string | Record<string, unknown>) => {
    valid: boolean
    spec?: unknown
    capabilities: { granted: readonly string[]; denied: readonly string[] }
  }
  /** createArtifact handler. Receives the createArtifact input,
   *  returns the ArtifactSummary the surface stores. The mock
   *  also queues an artifact:start/chunk/end sequence on the
   *  event stream so the design surface can render the artifact. */
  createArtifact?: (input: {
    workspaceId: string
    kind: string
    filename: string
    content: string
    artifactId?: string
    metadata?: Record<string, string>
    provenance?: Record<string, string>
  }) => {
    artifact: {
      artifactId: string
      version: number
      kind: string
      filename: string
      relativePath: string
      sha256: string
      bytes: number
      createdAt: number
      metadata: Record<string, string>
      provenance?: Record<string, string>
    }
    /** Sequence of events to push on the stream after createArtifact returns. */
    events?: ReadonlyArray<MockEvent>
  }
}

/**
 * Build the platform.workbench value the harness injects.
 * Returned object is plain and serialisable: it lives inside an
 * `addInitScript` payload, so no live references (functions,
 * classes) are allowed. The client is a Proxy whose default
 * response for any method is `{ }` — overrides go through
 * the options above.
 */
export function buildWorkbenchMock(opts: WorkbenchMockOptions = {}): {
  workbench: {
    connect: (input: { workspacePath: string; capabilities: readonly string[] }) => Promise<WorkbenchConnection>
  }
} {
  // We expose the connection on a closure so createArtifact and
  // exportArtifact can read its workspaceId and instanceId. The
  // closure itself is created at build time, then serialised
  // through `JSON.stringify` (allowed because the data is plain)
  // and re-instantiated by the page's init script. To stay in
  // the serialisable-only contract, the real client behaviour
  // lives in the page (the e2e fixture) and we only pass the
  // option overrides through.
  const designSystems = opts.designSystems ?? [
    {
      id: "test-system",
      name: "Test system",
      version: "1.0.0",
      source: "test",
      tokens: { colors: {}, spacing: {}, typography: {} },
    },
  ]
  const skills = opts.skills ?? []
  // The harness reads these out of the closure to build the
  // actual client on the page side. We can't ship a function
  // through addInitScript, so the client itself is constructed
  // there from a serialised description.
  return {
    workbench: {
      connect: async (input) => {
        // The page side rebuilds the connection from a serialised
        // descriptor. This stub is the one called by `entry.tsx`'s
        // PlatformProvider if (hypothetically) the global is read
        // synchronously. In practice the addInitScript path replaces
        // it before the app code runs.
        throw new Error("workbench-mock: connect() must be installed via installWorkbenchMock(page) before navigation")
      },
      // marker for the install function below
      __mockDescriptor: {
        designSystems,
        skills,
        workspacePath: "",
        capabilities: input.capabilities,
      },
    },
  } as unknown as { workbench: { connect: (input: { workspacePath: string; capabilities: readonly string[] }) => Promise<WorkbenchConnection> } }
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
      const client = new Proxy({}, {
        get(_, prop) {
          if (prop === "listDesignSystems") return async () => ({ designSystems: descriptor.designSystems })
          if (prop === "listDesignSkills") return async () => ({ skills: descriptor.skills })
          if (prop === "githubStatus") return async () => ({ connected: false, configured: false })
          if (prop === "validateSpec") return async (spec) => ({ valid: true, spec, capabilities: { granted: [], denied: [] } })
          if (prop === "createArtifact") return async (input) => ({ artifact: makeArtifact(input) })
          if (prop === "exportArtifact") return async (workspaceId, artifactId) => ({ exported: { artifactId, version: 1, relativePath: "design/out.svg", sha256: "deadbeef", metadata: {} } })
          if (prop === "artifactHistory") return async () => ({ history: [] })
          if (prop === "listArtifacts") return async () => ({ artifacts: [] })
          if (prop === "listDocuments") return async () => ({ documents: [] })
          if (prop === "listFiles") return async () => ({ entries: [], skipped: 0 })
          if (prop === "readFiles") return async () => ({ results: [] })
          if (prop === "listApprovals") return async () => ({ approvals: [] })
          if (prop === "trace") return async () => ({ kind: "trace", events: [], nextCursor: null })
          if (prop === "activity") return async () => ({ kind: "activity", events: [], nextCursor: null })
          if (prop === "searchCapabilities") return async () => ({ records: [] })
          if (prop === "events") return async function* (_workspaceId, _dispatcher, signal) {
            // The design surface subscribes but the mock yields
            // nothing. The stream stays open until the signal
            // aborts (the surface cancels on unmount).
            if (signal) {
              await new Promise((resolve) => {
                if (signal.aborted) return resolve()
                signal.addEventListener("abort", resolve, { once: true })
              })
            }
          }
          if (prop === "current") return () => undefined
          if (prop === "refresh") return async () => ""
          // Default noop for anything else.
          return async () => ({})
        },
      })
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
  await page.addInitScript(({ descriptor }) => {
    ;(window as unknown as { __UNIFIA_MOCK_DESCRIPTOR__: unknown }).__UNIFIA_MOCK_DESCRIPTOR__ = descriptor
  }, descriptor)
  await page.addInitScript({
    content: workbenchMockInitScript(),
  })
}
