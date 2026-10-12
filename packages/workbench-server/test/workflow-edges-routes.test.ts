/* SPDX-License-Identifier: MIT */

// CR04: both workflow start routes must refuse malformed drawn edges with 400
// before the engine sees the definition. hasValidEdges is unit-tested in
// workflow-edges.test.ts; this pins that each route actually calls it, and
// that a valid graph reaches the engine with its edges intact.

import { describe, expect, it } from "vitest"
import { ScopedTokenIssuer, WorkbenchServer } from "../src/index.js"
import type { WorkflowDefinitionPort } from "../src/workflow-port.js"

const WORKSPACE_ID = "ws-1"
const STEPS = [
  { id: "a", capability: "workspace.read", input: {} },
  { id: "b", capability: "workspace.read", input: {} },
]
const VALID_EDGES = [{ from: "a", to: "b", kind: "branch-true" }]
const INVALID_EDGE_SETS: ReadonlyArray<{ name: string; edges: unknown }> = [
  { name: "an edge to an unknown step", edges: [{ from: "a", to: "ghost" }] },
  { name: "a self loop", edges: [{ from: "a", to: "a" }] },
  { name: "an unknown edge kind", edges: [{ from: "a", to: "b", kind: "teleport" }] },
  { name: "edges that are not a list", edges: "a-to-b" },
]

function makeServer(started: WorkflowDefinitionPort[]) {
  return new WorkbenchServer({
    auth: { authenticate: async () => ({ id: "principal-1", scopes: new Set(["workflow.run"]), workspaces: "*" }) },
    tokenIssuer: new ScopedTokenIssuer("x".repeat(32), 60_000, 30_000),
    workspace: { open: async (id: string) => ({ id, token: `runtime-${id}` }), close: async () => undefined } as never,
    runtime: {} as never,
    workflow: {
      start: async (definition: WorkflowDefinitionPort) => {
        started.push(definition)
        return { id: "run-1", status: "running" }
      },
    } as never,
    audit: { record: () => undefined },
    capability: { check: async () => "allow" } as never,
  })
}

async function scopedToken(server: WorkbenchServer) {
  const issued = await server.issueNativeScopedToken({ principalId: "principal-1", workspaceId: WORKSPACE_ID, capabilities: ["workflow.run"] })
  return issued.token
}

const postJson = (server: WorkbenchServer, path: string, token: string, payload: unknown) =>
  server.fetch(new Request(`http://localhost${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(payload) }))

describe("POST /v1/workflows/start (Automate surface)", () => {
  it.each([...INVALID_EDGE_SETS])("refuses $name with 400 and starts no run", async ({ edges }) => {
    const started: WorkflowDefinitionPort[] = []
    const server = makeServer(started)
    const response = await postJson(server, "/v1/workflows/start", await scopedToken(server), { workspaceId: WORKSPACE_ID, definition: { id: "wf", version: 1, steps: STEPS, edges } })

    expect(response.status).toBe(400)
    expect(started).toHaveLength(0)
  })

  it("hands a valid drawn graph to the engine with its edges and workspace", async () => {
    const started: WorkflowDefinitionPort[] = []
    const server = makeServer(started)
    const response = await postJson(server, "/v1/workflows/start", await scopedToken(server), { workspaceId: WORKSPACE_ID, definition: { id: "wf", version: 1, steps: STEPS, edges: VALID_EDGES } })

    expect(response.status).toBe(202)
    expect(started).toHaveLength(1)
    expect(started[0]).toMatchObject({ workspaceId: WORKSPACE_ID, edges: VALID_EDGES })
  })

  it("keeps the legacy linear chain when no edges are drawn", async () => {
    const started: WorkflowDefinitionPort[] = []
    const server = makeServer(started)
    const response = await postJson(server, "/v1/workflows/start", await scopedToken(server), { workspaceId: WORKSPACE_ID, definition: { id: "wf", version: 1, steps: STEPS } })

    expect(response.status).toBe(202)
    expect(started[0]?.edges).toBeUndefined()
  })
})

describe("POST /v1/workflows (native start)", () => {
  it.each([...INVALID_EDGE_SETS])("refuses $name with 400 and starts no run", async ({ edges }) => {
    const started: WorkflowDefinitionPort[] = []
    const server = makeServer(started)
    const response = await postJson(server, "/v1/workflows", "t", { id: "wf", version: 1, workspaceId: WORKSPACE_ID, steps: STEPS, edges })

    expect(response.status).toBe(400)
    expect(started).toHaveLength(0)
  })

  it("starts a run for a valid drawn graph", async () => {
    const started: WorkflowDefinitionPort[] = []
    const server = makeServer(started)
    const response = await postJson(server, "/v1/workflows", "t", { id: "wf", version: 1, workspaceId: WORKSPACE_ID, steps: STEPS, edges: VALID_EDGES })

    expect(response.status).toBe(201)
    expect(started[0]?.edges).toEqual(VALID_EDGES)
  })
})
