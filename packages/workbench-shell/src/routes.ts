/* SPDX-License-Identifier: MIT */

import { WORK_V1_FUNCTIONS, type WorkFunction } from "./modes.js"

export type ArtifactLineage = "work/document" | "design/render"
export type WorkbenchTransportMethod = "GET" | "POST" | "DELETE"

export type WorkbenchRoute = {
  readonly surface: "work" | "design"
  readonly operation: WorkFunction
  readonly method: WorkbenchTransportMethod
  readonly route: `/v1/${string}`
  readonly capability: string
  readonly event: string
  readonly lineage?: ArtifactLineage
}

type RouteByWorkFunction = { readonly [FunctionName in WorkFunction]: WorkbenchRoute }

/**
 * The route matrix is intentionally a total mapped type. Adding a Work V1
 * function without registering its route is a compile-time error.
 */
export const WORKBENCH_ROUTE_REGISTRY: RouteByWorkFunction = {
  "workspace-switcher": { surface: "work", operation: "workspace-switcher", method: "GET", route: "/v1/workspaces", capability: "workspace.open", event: "workspace.changed" },
  "session-chat": { surface: "work", operation: "session-chat", method: "POST", route: "/v1/sessions/:sessionId/prompt", capability: "session.prompt", event: "operation.updated" },
  // C1-2/C2-2: the server only ever accepted POST here (index.ts's #files
  // handler); the client's real readFiles() already sends POST. This entry
  // declared GET, which is what made it drift-detectable in the first place.
  files: { surface: "work", operation: "files", method: "POST", route: "/v1/files/read", capability: "workspace.read", event: "workspace.changed" },
  search: { surface: "work", operation: "search", method: "GET", route: "/v1/files/search", capability: "workspace.read", event: "workspace.changed" },
  artifacts: { surface: "work", operation: "artifacts", method: "GET", route: "/v1/artifacts", capability: "workspace.read", event: "catalog.updated", lineage: "work/document" },
  documents: { surface: "work", operation: "documents", method: "GET", route: "/v1/documents", capability: "workspace.read", event: "catalog.updated", lineage: "work/document" },
  trace: { surface: "work", operation: "trace", method: "GET", route: "/v1/trace", capability: "trace.read", event: "trace.appended" },
  approvals: { surface: "work", operation: "approvals", method: "GET", route: "/v1/approvals", capability: "approval.read", event: "approval.updated" },
  "activity-log": { surface: "work", operation: "activity-log", method: "GET", route: "/v1/activity", capability: "trace.read", event: "trace.appended" },
  "capability-picker": { surface: "work", operation: "capability-picker", method: "GET", route: "/v1/capabilities/search", capability: "package.install", event: "catalog.updated" },
  export: { surface: "design", operation: "export", method: "POST", route: "/v1/artifacts/export", capability: "artifact.export", event: "operation.updated", lineage: "design/render" },
}

export const WORKBENCH_ROUTE_OPERATIONS = Object.keys(WORKBENCH_ROUTE_REGISTRY) as WorkFunction[]

export function routeFor(operation: WorkFunction): WorkbenchRoute {
  return WORKBENCH_ROUTE_REGISTRY[operation]
}

export function routesForLineage(lineage: ArtifactLineage): readonly WorkbenchRoute[] {
  return WORKBENCH_ROUTE_OPERATIONS.map((operation) => WORKBENCH_ROUTE_REGISTRY[operation]).filter((route) => route.lineage === lineage)
}

export type WorkbenchServerRoute = {
  readonly method: WorkbenchTransportMethod
  readonly route: `/v1/${string}`
  readonly capability: string
  readonly event: string
}

/** M6 routes are registered here before the server implementation consumes them. */
export const M6_SERVER_ROUTE_REGISTRY = {
  sessionEvents: { method: "GET", route: "/v1/sessions/:sessionId/events", capability: "workspace.watch", event: "trace.appended" },
  // C2-2/FUNC-001: the client connects once per workspace, not per session
  // (see WorkbenchClient.events()); the server fans in every session's
  // events into one stream for this route.
  workspaceEvents: { method: "GET", route: "/v1/workspaces/:workspaceId/events", capability: "workspace.watch", event: "trace.appended" },
  operationCancel: { method: "POST", route: "/v1/operations/:operationId/cancel", capability: "workspace.watch", event: "operation.updated" },
} as const satisfies Record<string, WorkbenchServerRoute>

/** M7 file index routes are registered before the server implementation consumes them. */
export const M7_SERVER_ROUTE_REGISTRY = {
  filesList: { method: "GET", route: "/v1/files/list", capability: "workspace.read", event: "workspace.changed" },
  filesSearch: { method: "GET", route: "/v1/files/search", capability: "workspace.read", event: "workspace.changed" },
} as const satisfies Record<string, WorkbenchServerRoute>

/** M8 approval and audit read routes are registered before server consumption. */
export const M8_SERVER_ROUTE_REGISTRY = {
  approvalsList: { method: "GET", route: "/v1/approvals", capability: "approval.read", event: "approval.updated" },
  tracePage: { method: "GET", route: "/v1/trace", capability: "trace.read", event: "trace.appended" },
  activityPage: { method: "GET", route: "/v1/activity", capability: "trace.read", event: "trace.appended" },
} as const satisfies Record<string, WorkbenchServerRoute>

/** M9a artifact read routes are registered before server consumption. */
export const M9A_SERVER_ROUTE_REGISTRY = {
  artifactsList: { method: "GET", route: "/v1/artifacts", capability: "workspace.read", event: "catalog.updated" },
  artifactDetail: { method: "GET", route: "/v1/artifacts/:artifactId", capability: "workspace.read", event: "catalog.updated" },
} as const satisfies Record<string, WorkbenchServerRoute>

/** M9b artifact lineage write route is registered before server consumption. */
export const M9B_SERVER_ROUTE_REGISTRY = {
  artifactCreate: { method: "POST", route: "/v1/artifacts", capability: "artifact.create", event: "catalog.updated" },
} as const satisfies Record<string, WorkbenchServerRoute>

/** M10 export route remains approval-gated by the server capability broker. */
export const M10_SERVER_ROUTE_REGISTRY = {
  artifactExport: { method: "POST", route: "/v1/artifacts/export", capability: "artifact.export", event: "operation.updated" },
} as const satisfies Record<string, WorkbenchServerRoute>

/** M11 validates untrusted specs without granting their requested capabilities. */
export const M11_SERVER_ROUTE_REGISTRY = {
  specValidate: { method: "POST", route: "/v1/specs/validate", capability: "workspace.read", event: "catalog.updated" },
} as const satisfies Record<string, WorkbenchServerRoute>

/** M15 capability picker consumes the scoped server search route. */
export const M15_SERVER_ROUTE_REGISTRY = {
  capabilitySearch: { method: "GET", route: "/v1/capabilities/search", capability: "package.install", event: "catalog.updated" },
} as const satisfies Record<string, WorkbenchServerRoute>

/** M20 Design System catalogs are read from the explicit workspace manifest. */
export const M20_SERVER_ROUTE_REGISTRY = {
  designSystems: { method: "GET", route: "/v1/design-systems", capability: "workspace.read", event: "catalog.updated" },
} as const satisfies Record<string, WorkbenchServerRoute>

const missingOperations = WORK_V1_FUNCTIONS.filter((operation) => !WORKBENCH_ROUTE_OPERATIONS.includes(operation))
if (missingOperations.length > 0) throw new Error(`route registry is missing Work V1 operations: ${missingOperations.join(", ")}`)
