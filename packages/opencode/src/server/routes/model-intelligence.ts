// =============================================================================
// routes/model-intelligence.ts — TEAM-L02
//
// HTTP surface over the model-intelligence registry: which providers and
// models exist, what they cost, what state they are in.
//
//   Versioned      Responses carry the registry's own `schemaVersion`, not the
//                  server's. A client pinned to N-1 needs to know which schema
//                  produced the rows it is holding, not when it fetched them.
//
//   Paginated      The registry is a few thousand models and grows with every
//                  provider. An unpaginated list is a route that works in
//                  development and times out in production.
//
//   Not initialised is a 503, not a 500. The registry is loaded on demand; a
//   client that asks too early should retry, and a 500 tells it not to.
//
// No route here mutates a model. `POST /sync` refreshes from the configured
// source and is the one write: it is idempotent by construction — syncing an
// already-current registry is a no-op that reports zero changes.
// =============================================================================

import { Hono, type Context } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import z from "zod"
import { Effect } from "effect"
import { lazy } from "../../util/lazy"
import { Log } from "../../util/log"
import { makeRuntime } from "../../effect/run-service"
import { Registry, LiveRegistryLayer, type ModelFilter } from "../../model-intelligence/registry"
import { RegistryNotInitializedError } from "../../model-intelligence/errors"
import { Model, Provider } from "../../model-intelligence/schema"
import { SCHEMA_VERSION } from "../../model-intelligence/schema-version"

const log = Log.create({ service: "server.model-intelligence" })

const { runPromise } = makeRuntime(Registry, LiveRegistryLayer)

const MAX_PAGE_SIZE = 500
const DEFAULT_PAGE_SIZE = 100

const ErrorSchema = z.object({ error: z.string() })

const PageSchema = z.object({
  schemaVersion: z.string(),
  items: z.array(z.unknown()),
  nextCursor: z.string().nullable(),
  total: z.number(),
})

/** Query params each route accepts; anything else is answered with 400. */
const MODEL_QUERY = ["providerID", "status", "lifecycleStage", "modality", "limit", "cursor"] as const
const PROVIDER_QUERY = ["status", "limit", "cursor"] as const

// Derived from the registry schema, never re-typed here. A hand-written copy
// drifts the moment a status is added, and the drift shows up as a 400 on a
// value the registry considers perfectly valid.
const MODEL_STATUS = Model.shape.status.options
const PROVIDER_STATUS = Provider.shape.status.options
const MODALITY = ["text", "audio", "image", "video", "pdf"] as const

function rejectUnknownQuery(url: string, allowed: readonly string[]): string | null {
  const params = new URL(url).searchParams
  for (const key of params.keys()) {
    if (key === "directory" || allowed.includes(key)) continue
    return `unknown query parameter: ${key}`
  }
  return null
}

/**
 * A filter value the registry does not know is rejected, not dropped.
 *
 * Silently ignoring `status=availabel` returns the full list and the caller
 * reads it as "every model is available" — the exact opposite of what they
 * asked.
 */
function rejectUnknownValue(value: string | undefined, allowed: readonly string[], name: string): string | null {
  if (value === undefined) return null
  return allowed.includes(value) ? null : `unknown ${name}: ${value} (expected one of ${allowed.join(", ")})`
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PAGE_SIZE
  const limit = Number(raw)
  if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_PAGE_SIZE) {
    throw new TypeError(`limit must be an integer between 1 and ${MAX_PAGE_SIZE}`)
  }
  return limit
}

function parseCursor(raw: string | undefined): number {
  if (raw === undefined) return 0
  const offset = Number(raw)
  if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError(`cursor must be a non-negative integer, got ${raw}`)
  return offset
}

/**
 * Slice an in-memory list into a page.
 *
 * The registry is held whole in memory and is not append-ordered, so there is
 * no key to seek on: an offset cursor is what the underlying data supports.
 * `total` is returned alongside so a client can tell a short last page from a
 * truncated one.
 */
function page<T>(items: readonly T[], offset: number, limit: number) {
  const visible = items.slice(offset, offset + limit)
  const nextOffset = offset + visible.length
  return {
    schemaVersion: SCHEMA_VERSION,
    items: visible,
    nextCursor: nextOffset < items.length ? String(nextOffset) : null,
    total: items.length,
  }
}

/**
 * The registry not being loaded yet is a temporary condition, so it is a 503
 * with a retry hint rather than a 500 the client will give up on.
 */
function registryError(c: Context, error: unknown, context: string) {
  if (error instanceof RegistryNotInitializedError || (error as { _tag?: string })?._tag === "RegistryNotInitializedError") {
    return c.json({ error: "model registry is not loaded yet; sync it or retry" }, 503)
  }
  if (error instanceof TypeError || error instanceof RangeError) return c.json({ error: error.message }, 400)
  log.error(context, { error: error instanceof Error ? error.message : String(error) })
  return c.json({ error: "internal error" }, 500)
}

export const ModelIntelligenceRoutes = lazy(() =>
  new Hono()
    .get(
      "/models",
      describeRoute({
        summary: "List models",
        description: "List models known to the registry, optionally filtered by provider, status, lifecycle or modality.",
        operationId: "modelIntelligence.listModels",
        responses: {
          200: { description: "A page of models", content: { "application/json": { schema: resolver(PageSchema) } } },
          400: { description: "Unknown filter, cursor or limit", content: { "application/json": { schema: resolver(ErrorSchema) } } },
          503: { description: "Registry not loaded", content: { "application/json": { schema: resolver(ErrorSchema) } } },
        },
      }),
      async (c) => {
        const unknown =
          rejectUnknownQuery(c.req.url, MODEL_QUERY) ??
          rejectUnknownValue(c.req.query("status"), MODEL_STATUS, "status") ??
          rejectUnknownValue(c.req.query("modality"), MODALITY, "modality")
        if (unknown) return c.json({ error: unknown }, 400)
        try {
          const limit = parseLimit(c.req.query("limit"))
          const offset = parseCursor(c.req.query("cursor"))
          const filter: ModelFilter = {}
          const providerID = c.req.query("providerID")
          if (providerID) filter.providerID = providerID
          const status = c.req.query("status")
          if (status) filter.status = status as NonNullable<ModelFilter["status"]>
          const lifecycleStage = c.req.query("lifecycleStage")
          if (lifecycleStage) filter.lifecycleStage = lifecycleStage as NonNullable<ModelFilter["lifecycleStage"]>
          const modality = c.req.query("modality")
          if (modality) filter.modality = modality as NonNullable<ModelFilter["modality"]>

          const models = await runPromise((svc) => svc.listModels(filter))
          return c.json(page(models, offset, limit))
        } catch (e) {
          return registryError(c, e, "list models failed")
        }
      },
    )
    .get(
      "/providers",
      describeRoute({
        summary: "List providers",
        description: "List providers known to the registry.",
        operationId: "modelIntelligence.listProviders",
        responses: {
          200: { description: "A page of providers", content: { "application/json": { schema: resolver(PageSchema) } } },
          400: { description: "Unknown filter, cursor or limit", content: { "application/json": { schema: resolver(ErrorSchema) } } },
          503: { description: "Registry not loaded", content: { "application/json": { schema: resolver(ErrorSchema) } } },
        },
      }),
      async (c) => {
        const unknown =
          rejectUnknownQuery(c.req.url, PROVIDER_QUERY) ??
          rejectUnknownValue(c.req.query("status"), PROVIDER_STATUS, "provider status")
        if (unknown) return c.json({ error: unknown }, 400)
        try {
          const limit = parseLimit(c.req.query("limit"))
          const offset = parseCursor(c.req.query("cursor"))
          const status = c.req.query("status")
          const providers = await runPromise((svc) => svc.listProviders(status ? { status: status as never } : undefined))
          return c.json(page(providers, offset, limit))
        } catch (e) {
          return registryError(c, e, "list providers failed")
        }
      },
    )
    .get(
      "/models/:providerID/:modelID",
      describeRoute({
        summary: "Get a model",
        description: "Fetch one model by provider and model id.",
        operationId: "modelIntelligence.getModel",
        responses: {
          200: { description: "The model", content: { "application/json": { schema: resolver(z.unknown()) } } },
          404: { description: "No such model", content: { "application/json": { schema: resolver(ErrorSchema) } } },
          503: { description: "Registry not loaded", content: { "application/json": { schema: resolver(ErrorSchema) } } },
        },
      }),
      async (c) => {
        const providerID = c.req.param("providerID")
        const modelID = c.req.param("modelID")
        try {
          const model = await runPromise((svc) => svc.getModel(providerID, modelID))
          if (model === null) return c.json({ error: `model ${providerID}/${modelID} not found` }, 404)
          return c.json({ schemaVersion: SCHEMA_VERSION, model })
        } catch (e) {
          return registryError(c, e, "get model failed")
        }
      },
    )
    .get(
      "/aliases/:alias",
      describeRoute({
        summary: "Resolve a model alias",
        description: "Resolve an alias such as a vendor shorthand to the concrete provider and model it names.",
        operationId: "modelIntelligence.resolveAlias",
        responses: {
          200: { description: "The resolved alias", content: { "application/json": { schema: resolver(z.unknown()) } } },
          404: { description: "No such alias", content: { "application/json": { schema: resolver(ErrorSchema) } } },
          503: { description: "Registry not loaded", content: { "application/json": { schema: resolver(ErrorSchema) } } },
        },
      }),
      async (c) => {
        const alias = c.req.param("alias")
        try {
          const resolved = await runPromise((svc) => svc.resolveAlias(alias))
          if (resolved === null) return c.json({ error: `alias ${alias} not found` }, 404)
          return c.json({ schemaVersion: SCHEMA_VERSION, resolved })
        } catch (e) {
          return registryError(c, e, "resolve alias failed")
        }
      },
    )
    .get(
      "/snapshot",
      describeRoute({
        summary: "Get the registry snapshot hash",
        description:
          "Return the registry's content hash and schema version. A client that already holds this hash needs no further fetch.",
        operationId: "modelIntelligence.snapshot",
        responses: {
          200: {
            description: "Snapshot identity",
            content: {
              "application/json": {
                schema: resolver(z.object({ schemaVersion: z.string(), hash: z.string(), byteLength: z.number() })),
              },
            },
          },
          503: { description: "Registry not loaded", content: { "application/json": { schema: resolver(ErrorSchema) } } },
        },
      }),
      async (c) => {
        try {
          const snapshot = await runPromise((svc) => svc.snapshot())
          // The snapshot body itself is not returned here: it is megabytes,
          // and every consumer that wants rows wants them filtered anyway.
          return c.json({ schemaVersion: SCHEMA_VERSION, hash: snapshot.hash, byteLength: snapshot.json.length })
        } catch (e) {
          return registryError(c, e, "snapshot failed")
        }
      },
    )
    .get(
      "/licenses",
      describeRoute({
        summary: "Get registry license notices",
        description: "Attribution and license notices for the data sources the registry ingests.",
        operationId: "modelIntelligence.licenses",
        responses: {
          200: {
            description: "License notices",
            content: { "application/json": { schema: resolver(z.object({ schemaVersion: z.string(), notices: z.string() })) } },
          },
          503: { description: "Registry not loaded", content: { "application/json": { schema: resolver(ErrorSchema) } } },
        },
      }),
      async (c) => {
        try {
          const notices = await runPromise((svc) => svc.licenseNotices())
          return c.json({ schemaVersion: SCHEMA_VERSION, notices })
        } catch (e) {
          return registryError(c, e, "license notices failed")
        }
      },
    )
    .get(
      "/health",
      describeRoute({
        summary: "Registry load state",
        description: "Whether the registry has been loaded. Always 200, so a client can poll it without treating it as an error.",
        operationId: "modelIntelligence.health",
        responses: {
          200: {
            description: "Load state",
            content: { "application/json": { schema: resolver(z.object({ schemaVersion: z.string(), loaded: z.boolean() })) } },
          },
        },
      }),
      async (c) => {
        const loaded = await runPromise((svc) => svc.isLoaded()).catch(() => false)
        return c.json({ schemaVersion: SCHEMA_VERSION, loaded })
      },
    )
    .post(
      "/sync",
      describeRoute({
        summary: "Sync the registry from its source",
        description:
          "Refresh the registry. Idempotent: syncing an already-current registry reports zero changes rather than duplicating rows.",
        operationId: "modelIntelligence.sync",
        responses: {
          200: { description: "Sync result", content: { "application/json": { schema: resolver(z.unknown()) } } },
          400: { description: "Unknown query parameter", content: { "application/json": { schema: resolver(ErrorSchema) } } },
          502: { description: "The source could not be fetched, parsed or validated", content: { "application/json": { schema: resolver(ErrorSchema) } } },
        },
      }),
      async (c) => {
        const unknown = rejectUnknownQuery(c.req.url, ["force", "validate"])
        if (unknown) return c.json({ error: unknown }, 400)
        const force = c.req.query("force") === "true"
        const validate = c.req.query("validate") !== "false"
        try {
          const result = await runPromise((svc) => svc.sync({ force, validate }).pipe(Effect.orDie))
          return c.json({ schemaVersion: SCHEMA_VERSION, ...result })
        } catch (e) {
          // A failing upstream source is not this server failing: 502 tells the
          // caller the fault is downstream of us and retrying may help.
          const message = e instanceof Error ? e.message : String(e)
          log.error("registry sync failed", { error: message })
          return c.json({ error: `registry source failed: ${message}` }, 502)
        }
      },
    ),
)
