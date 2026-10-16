/* SPDX-License-Identifier: MIT */
/**
 * Durable workflow surface (directive 35, E2E layer): POST /v1/workflows
 * (start from a canonical definition), POST /v1/workflows/:id/resume,
 * POST /v1/workflows/:id/cancel, GET /v1/workflows/:id — all through
 * the injected substrate-backed NativeWorkflowRuntimePort. No second
 * authority: the port IS the native durable kernel boundary.
 */
import { AuthorityError, NodeExecutionError } from "@unifia/workflow-runtime"
import { body, json, workflowAuthority } from "../http.js"
import { userAudit } from "../audit-context.js"
import type { ServerContext } from "../server-context.js"
import type { Principal } from "../auth.js"
import type { AuthorityToken } from "@unifia/workflow-runtime"
import type { P3Capability } from "@unifia/contracts"
import type { WorkflowDefinitionPort } from "../workflow-port.js"
import { hasValidEdges } from "../workflow-edges.js"
// WHY a typed 409 instead of the generic 500 catch-all: a superseded
// authority token is an expected fencing outcome (#47), not a server
// fault - callers must be able to distinguish it from transport failure.
function staleAuthorityResponse(error: unknown): Response | undefined {
  if (error instanceof AuthorityError && error.code === "STALE_AUTHORITY") return json(409, { error: "STALE_AUTHORITY" })
  return undefined
}

/** Native workflow routes share the same principal/workspace boundary as Automate. */
function ownsWorkspace(principal: Principal, workspaceId: string): boolean {
  return principal.workspaces === "*" || principal.workspaces?.has(workspaceId) === true
}

/** Run fencing is not a principal grant; inspect the canonical run before exposing or mutating it. */
async function scoped(ctx: ServerContext, principal: Principal, token: AuthorityToken) {
  const state = await ctx.workflow!.inspect(token)
  if (ownsWorkspace(principal, state.definition.workspaceId)) return state
  return ctx.deny(principal, "workflow.scope", 403, { resource: state.definition.workspaceId })
}

export async function start(ctx: ServerContext, request: Request): Promise<Response> {
  const principal = await ctx.authenticate(request)
  if (!principal) return ctx.deny(null, "workflow.principal", 401)
  if (!ctx.workflow) return ctx.deny(principal, "workflow.unavailable", 501)
  const input = (await body(request)) as WorkflowDefinitionPort
  // fail-closed: a workflow with no steps is meaningless (no entry node)
  if (!input?.id || !Array.isArray(input?.steps) || input.steps.length === 0) return ctx.deny(principal, "workflow.definition", 400)
  if (!hasValidEdges(input)) return ctx.deny(principal, "workflow.definition.edges", 400)
  if (!input.workspaceId || !ownsWorkspace(principal, input.workspaceId)) {
    return ctx.deny(principal, "workflow.scope", 403, { resource: input.workspaceId })
  }
  const gate = await ctx.checkCapability("workflow.run", input.workspaceId, principal)
  if (gate) return gate
  const state = await ctx.workflow.start(input, principal.id)
  userAudit(ctx, principal, "workflow.start", "allow", { resource: input.id, reason: state.status })
  return json(201, state)
}

export async function resume(ctx: ServerContext, request: Request, id: string): Promise<Response> {
  const principal = await ctx.authenticate(request)
  if (!principal) return ctx.deny(null, "workflow.principal", 401)
  if (!ctx.workflow) return ctx.deny(principal, "workflow.unavailable", 501)
  const token = workflowAuthority(request)
  if (!token || token.workflowRunId !== id) return ctx.deny(principal, "workflow.authority", 400)
  try {
  const access = await scoped(ctx, principal, token)
  if (access instanceof Response) return access
  const gate = await ctx.checkCapability("workflow.run", access.definition.workspaceId, principal)
  if (gate) return gate
  const state = await ctx.workflow.resume(token)
  userAudit(ctx, principal, "workflow.resume", "allow", { resource: id, reason: state.status })
  return json(200, state) } catch (error) { const stale = staleAuthorityResponse(error); if (stale) return stale; throw error }
}

export async function cancel(ctx: ServerContext, request: Request, id: string): Promise<Response> {
  const principal = await ctx.authenticate(request)
  if (!principal) return ctx.deny(null, "workflow.principal", 401)
  if (!ctx.workflow) return ctx.deny(principal, "workflow.unavailable", 501)
  const token = workflowAuthority(request)
  if (!token || token.workflowRunId !== id) return ctx.deny(principal, "workflow.authority", 400)
  try {
  const access = await scoped(ctx, principal, token)
  if (access instanceof Response) return access
  const state = await ctx.workflow.cancel(token)
  userAudit(ctx, principal, "workflow.cancel", "deny", { resource: id, reason: state.status })
  return json(200, state) } catch (error) { const stale = staleAuthorityResponse(error); if (stale) return stale; throw error }
}

export async function inspect(ctx: ServerContext, request: Request, id: string): Promise<Response> {
  const principal = await ctx.authenticate(request)
  if (!principal) return ctx.deny(null, "workflow.principal", 401)
  if (!ctx.workflow) return ctx.deny(principal, "workflow.unavailable", 501)
  const token = workflowAuthority(request)
  if (!token || token.workflowRunId !== id) return ctx.deny(principal, "workflow.authority", 400)
  try {
  const state = await scoped(ctx, principal, token)
  if (state instanceof Response) return state
  // Directive 37: the diagnosis surface is the READ-ONLY durable journal.
  const events = await ctx.workflow.history(token)
  return json(200, { ...state, events }) } catch (error) { const stale = staleAuthorityResponse(error); if (stale) return stale; throw error }
}
export async function runWorkflow(ctx: ServerContext, request: Request, id: string): Promise<Response> {
  const principal = await ctx.authenticate(request)
  if (!principal) return ctx.deny(null, "workflow.principal", 401)
  if (!ctx.workflow) return ctx.deny(principal, "workflow.unavailable", 501)
  const token = workflowAuthority(request)
  if (!token || token.workflowRunId !== id) return ctx.deny(principal, "workflow.authority", 400)
  try {
    // Inspect validates authority and recovers the immutable workspace;
    // keep stale-token failures inside the typed 409 error boundary.
    const current = await ctx.workflow.inspect(token)
    if (!ownsWorkspace(principal, current.definition.workspaceId)) {
      return ctx.deny(principal, "workflow.scope", 403, { resource: current.definition.workspaceId })
    }
    const gate = await ctx.checkCapability("workflow.run", current.definition.workspaceId, principal)
    if (gate) return gate
    // Preserve per-node broker checks; a denied node cannot dispatch an effect.
    const authorize = async (capabilities: readonly string[], resource: string): Promise<void> => {
      for (const capability of capabilities) {
        const decision = await ctx.capability.check(capability as P3Capability, resource, principal.id)
        if (decision !== "allow") {
          throw new NodeExecutionError("NODE_CAPABILITY_DENIED", `capability denied for ${resource}: ${capability}`, false)
        }
      }
    }
    const state = await ctx.workflow.run(token, { authorize })
    userAudit(ctx, principal, "workflow.run", "allow", { resource: id, reason: state.status })
    return json(200, state)
  } catch (error) {
    const stale = staleAuthorityResponse(error)
    if (stale) return stale
    if (error instanceof NodeExecutionError && error.code === "NODE_CAPABILITY_DENIED") {
      return json(403, { error: "NODE_CAPABILITY_DENIED" })
    }
    if (error instanceof NodeExecutionError) {
      // Authoring/validation failures (unknown refs, unknown families,
      // driver budget): the definition is unusable, not a server fault.
      return json(422, { error: error.code })
    }
    throw error
  }
}

export async function listWorkflows(ctx: ServerContext, request: Request): Promise<Response> {
  const principal = await ctx.authenticate(request)
  if (!principal) return ctx.deny(null, "workflow.principal", 401)
  if (!ctx.workflow) return ctx.deny(principal, "workflow.unavailable", 501)
  // No scope is not the global grant: legacy or malformed principals fail closed.
  if (!principal.workspaces) return ctx.deny(principal, "workflow.scope", 403)
  const scope = principal.workspaces
  const workflows = await ctx.workflow.listWorkflows(scope === "*" ? undefined : [...scope])
  return json(200, { workflows })
}

export async function nodeDetails(ctx: ServerContext, request: Request, id: string): Promise<Response> {
  const principal = await ctx.authenticate(request)
  if (!principal) return ctx.deny(null, "workflow.principal", 401)
  if (!ctx.workflow) return ctx.deny(principal, "workflow.unavailable", 501)
  const token = workflowAuthority(request)
  if (!token || token.workflowRunId !== id) return ctx.deny(principal, "workflow.authority", 400)
  try {
    const access = await scoped(ctx, principal, token)
    if (access instanceof Response) return access
    const nodes = await ctx.workflow.executionNodes(token)
    return json(200, { nodes })
  } catch (error) {
    const stale = staleAuthorityResponse(error)
    if (stale) return stale
    throw error
  }
}
