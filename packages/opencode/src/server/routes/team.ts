// =============================================================================
// routes/team.ts — TEAM-L02
//
// Versioned, paginated, redacted HTTP surface over persisted Team state.
//
// Read-only on purpose. The Team runtime in src/team/ has no owner in the
// running application today (see R-WIRING-001): nothing constructs a run, so
// there is nothing here to start, pause or cancel. Exposing a POST /runs that
// cannot start a run would be a worse lie than exposing none. What this does
// expose is real: whatever has been written to the team store, readable with a
// stable contract, so the SDK, CLI and UI cards can be built against it and
// become live the moment a producer writes.
//
//   Versioned      Every response carries `schemaVersion`. A client that
//                  cannot read a version can say so instead of guessing at a
//                  shape it half-recognises.
//
//   Paginated      Keyset, never OFFSET. Cursors are opaque to the caller and
//                  rejected loudly when unusable — an unknown cursor returns
//                  400, never an empty page that reads as "you are at the end".
//
//   Redacted       Event payloads and task scopes are arbitrary JSON written
//                  by producers. They cross this boundary through the DLP
//                  redactor, because the one place a secret must not reach is
//                  an HTTP response.
// =============================================================================

import { Hono, type Context } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import path from "node:path"
import z from "zod"
import { Global } from "../../global"
import { lazy } from "../../util/lazy"
import { Log } from "../../util/log"
import * as DLP from "../../security/dlp"
import {
  TEAM_STORE_MAX_PAGE_SIZE,
  TeamStore,
  TeamStoreCursorError,
  type PageOf,
} from "../../team/team-store"
import { TEAM_STORE_SCHEMA_VERSION } from "../../team/team-store.sql"
import { invalidQuery, rejectUnknownQuery } from "./query"

const log = Log.create({ service: "server.team" })

/** One store per process, opened lazily so a server that never asks pays nothing. */
const store = lazy(() => TeamStore.open(path.join(Global.Path.data, "team.db")))
let opened = false

function teamStore(): TeamStore {
  opened = true
  return store()
}

/**
 * Release the store's SQLite handle.
 *
 * A module-level connection lives as long as the process, which is right for a
 * server and wrong for a test run: an open WAL handle keeps the data directory
 * locked and teardown fails. Exported so a caller that owns the process
 * lifetime can end it deliberately.
 */
export function closeTeamStore(): void {
  if (!opened) return
  store().close()
  store.reset()
  opened = false
}

const RunSchema = z.object({
  runId: z.string(),
  schemaVersion: z.string(),
  planId: z.string(),
  status: z.enum(["pending", "running", "completed", "failed", "aborted"]),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const TaskSchema = z.object({
  taskId: z.string(),
  runId: z.string(),
  status: z.enum(["pending", "assigned", "running", "completed", "blocked", "cancelled"]),
  dependsOn: z.array(z.string()),
  scope: z.unknown(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const EventSchema = z.object({
  eventId: z.string(),
  runId: z.string(),
  sequence: z.number(),
  kind: z.string(),
  payload: z.unknown(),
  occurredAt: z.string(),
})

const GateSchema = z.object({
  gateId: z.string(),
  runId: z.string(),
  taskId: z.string().nullable(),
  verdict: z.enum(["APPROVED", "APPROVED_WITH_FOLLOWUP", "CHANGES_REQUESTED"]),
  findings: z.unknown(),
  decidedAt: z.string(),
})

function envelope<T extends z.ZodType>(item: T) {
  return z.object({
    schemaVersion: z.string(),
    items: z.array(item),
    nextCursor: z.string().nullable(),
  })
}

const ErrorSchema = z.object({ error: z.string() })

/**
 * Strip anything that looks like a credential out of producer-supplied JSON.
 *
 * Applied to the serialized form rather than key by key: a token does not
 * become safe by sitting in a field called `notes`, and the DLP rules match on
 * the shape of the value, which is the only thing that actually identifies it.
 */
function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value
  const encoded = JSON.stringify(value)
  if (encoded === undefined) return null
  const result = DLP.redact(encoded)
  if (result.redactions === 0) return value
  try {
    return JSON.parse(result.text)
  } catch {
    // Redaction can break JSON syntax if a replacement lands inside a string
    // escape. Returning the marker beats returning the unredacted original.
    return { redacted: true, reason: "payload contained credentials and could not be re-parsed" }
  }
}

/**
 * The pagination contract, declared rather than read ad hoc from the request.
 *
 * Going through `validator` is what puts `limit` and `cursor` into the OpenAPI
 * document, and through it into the generated SDK. Parsing them by hand from
 * `c.req.query()` works at runtime and is invisible to codegen: the SDK method
 * ends up with no way to express a page, so every client silently reads the
 * first one and calls it the whole list.
 */
const PageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(TEAM_STORE_MAX_PAGE_SIZE).optional(),
  cursor: z.string().min(1).optional(),
})

/**
 * Read a path parameter the router has already guaranteed.
 *
 * `c.req.param()` loses its literal-path typing as soon as a validator sits in
 * the middleware chain, so the compiler stops knowing that `:runID` is always
 * present. The route cannot match without it, but this checks rather than
 * casts: if that ever stops holding, the request fails loudly instead of
 * reaching SQLite with `undefined` and returning "no such run".
 */
function pathParam(c: Context, name: string): string {
  const value = c.req.param(name)
  if (value === undefined) throw new TypeError(`missing path parameter: ${name}`)
  return value
}

function paged<T>(result: PageOf<T>, map: (item: T) => unknown) {
  return {
    schemaVersion: TEAM_STORE_SCHEMA_VERSION,
    items: result.items.map(map),
    nextCursor: result.nextCursor,
  }
}

export const TeamRoutes = lazy(() =>
  new Hono()
    .get(
      "/runs",
      describeRoute({
        summary: "List team runs",
        description: "List persisted team runs, newest first. Keyset pagination via an opaque cursor.",
        operationId: "team.listRuns",
        responses: {
          200: {
            description: "A page of runs",
            content: { "application/json": { schema: resolver(envelope(RunSchema)) } },
          },
          400: { description: "Bad cursor, limit or query parameter", content: { "application/json": { schema: resolver(ErrorSchema) } } },
        },
      }),
      validator("query", PageQuerySchema, invalidQuery),
      async (c) => {
        const unknown = rejectUnknownQuery(c.req.url, ["limit", "cursor"])
        if (unknown) return c.json({ error: unknown }, 400)
        const query = c.req.valid("query")
        try {
          const result = teamStore().listRuns({ limit: query.limit, cursor: query.cursor ?? null })
          return c.json(paged(result, (run) => run))
        } catch (e) {
          return badRequestOr500(c, e, "list runs failed")
        }
      },
    )
    .get(
      "/runs/:runID",
      describeRoute({
        summary: "Get a team run",
        description: "Fetch a single run by id.",
        operationId: "team.getRun",
        responses: {
          200: { description: "The run", content: { "application/json": { schema: resolver(RunSchema) } } },
          404: { description: "No such run", content: { "application/json": { schema: resolver(ErrorSchema) } } },
        },
      }),
      async (c) => {
        const run = teamStore().getRun(c.req.param("runID"))
        if (run === null) return c.json({ error: `run ${c.req.param("runID")} not found` }, 404)
        // The row carries the schema version it was written under, which is
        // what a client needs — not the version this server happens to run.
        return c.json(run)
      },
    )
    .get(
      "/runs/:runID/tasks",
      describeRoute({
        summary: "List a run's tasks",
        description: "Tasks belonging to a run, in creation order, with their declared scope redacted.",
        operationId: "team.listTasks",
        responses: {
          200: { description: "The run's tasks", content: { "application/json": { schema: resolver(envelope(TaskSchema)) } } },
          404: { description: "No such run", content: { "application/json": { schema: resolver(ErrorSchema) } } },
        },
      }),
      async (c) => {
        const runID = c.req.param("runID")
        // Distinguishing "no such run" from "a run with no tasks" is the whole
        // point of the check: both would otherwise return an empty list.
        if (teamStore().getRun(runID) === null) return c.json({ error: `run ${runID} not found` }, 404)
        const tasks = teamStore().listTasks(runID)
        return c.json({
          schemaVersion: TEAM_STORE_SCHEMA_VERSION,
          items: tasks.map((task) => ({ ...task, scope: redact(task.scope) })),
          nextCursor: null,
        })
      },
    )
    .get(
      "/runs/:runID/events",
      describeRoute({
        summary: "Replay a run's events",
        description:
          "Events for a run in append order. The cursor is the last sequence seen, so an interrupted stream resumes exactly where it stopped rather than restarting.",
        operationId: "team.listEvents",
        responses: {
          200: { description: "A page of events", content: { "application/json": { schema: resolver(envelope(EventSchema)) } } },
          400: { description: "Bad cursor, limit or query parameter", content: { "application/json": { schema: resolver(ErrorSchema) } } },
          404: { description: "No such run", content: { "application/json": { schema: resolver(ErrorSchema) } } },
        },
      }),
      validator("query", PageQuerySchema, invalidQuery),
      async (c) => {
        const unknown = rejectUnknownQuery(c.req.url, ["limit", "cursor"])
        if (unknown) return c.json({ error: unknown }, 400)
        const runID = pathParam(c, "runID")
        if (teamStore().getRun(runID) === null) return c.json({ error: `run ${runID} not found` }, 404)
        const query = c.req.valid("query")
        try {
          const result = teamStore().listEvents(runID, { limit: query.limit, cursor: query.cursor ?? null })
          return c.json(paged(result, (event) => ({ ...event, payload: redact(event.payload) })))
        } catch (e) {
          return badRequestOr500(c, e, "list events failed")
        }
      },
    )
    .get(
      "/runs/:runID/gates",
      describeRoute({
        summary: "List a run's review gates",
        description: "Review verdicts recorded for a run, with findings redacted.",
        operationId: "team.listGates",
        responses: {
          200: { description: "The run's gates", content: { "application/json": { schema: resolver(envelope(GateSchema)) } } },
          404: { description: "No such run", content: { "application/json": { schema: resolver(ErrorSchema) } } },
        },
      }),
      async (c) => {
        const runID = c.req.param("runID")
        if (teamStore().getRun(runID) === null) return c.json({ error: `run ${runID} not found` }, 404)
        return c.json({
          schemaVersion: TEAM_STORE_SCHEMA_VERSION,
          items: teamStore()
            .listGates(runID)
            .map((gate) => ({ ...gate, findings: redact(gate.findings) })),
          nextCursor: null,
        })
      },
    ),
)

/**
 * A malformed cursor or limit is the caller's mistake, not the server's.
 * Returning 500 for it would send a client retrying a request that can only
 * ever fail the same way.
 */
function badRequestOr500(c: Context, error: unknown, context: string) {
  if (error instanceof TeamStoreCursorError || error instanceof TypeError || error instanceof RangeError) {
    return c.json({ error: error.message }, 400)
  }
  log.error(context, { error: error instanceof Error ? error.message : String(error) })
  return c.json({ error: "internal error" }, 500)
}
