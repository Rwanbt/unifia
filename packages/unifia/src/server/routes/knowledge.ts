/* SPDX-License-Identifier: MIT */
/**
 * Read-only access to the memory vault, through the knowledge facade.
 *
 * The Memory panel used to read `.unifia/memory` through the generic file
 * API, which applies no classification, consent or provenance. These routes
 * are the governed path: every answer comes from the facade the agent's tools
 * already use, and a note reaches a response only after the egress guard has
 * cleared it. There is no route for writes, administration or raw files, and
 * an unknown note answers exactly like a withheld one.
 */
import { Hono, type Context } from "hono"
import type { KnowledgeId } from "@unifia/contracts/knowledge"
import { Config } from "../../config/config"
import { Instance } from "../../project/instance"
import { DEFAULT_RECALL_DEADLINE_MS, memoryEnabled, openMemory } from "../../knowledge/app/memory"
import type { Composed } from "../../knowledge/facade/compose"
import { KnowledgeFailure } from "../../knowledge/domain/errors"

/**
 * The destination a response is bound for: this machine's own interface.
 *
 * Reading one's own vault on-device is not egress (see `planFromPolicy`), so
 * the note's `local_model` restriction governs and nothing here reaches a
 * model. A remote destination would also hide notes the user wrote for this
 * machine, which is not the question the panel asks.
 */
const UI_PROVIDER_ID = "unifia-ui"
const UI_DESTINATION = "local" as const

/**
 * A note id is a UUID in practice. Anything that could be a path segment is
 * refused before it reaches the store, so the id can never address a file
 * outside the vault.
 */
const NOTE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

const SEARCH_QUERY_MAX_LENGTH = 512
const SEARCH_LIMIT_DEFAULT = 5
const SEARCH_LIMIT_MAX = 20
const SEARCH_PAYLOAD_MAX_BYTES = 65_536
const SEARCH_SNIPPET_MAX_BYTES = 8_192

export function parseNoteId(raw: string): string | null {
  return NOTE_ID_PATTERN.test(raw) ? raw : null
}

function parseLimit(raw: string | undefined): number | null {
  if (raw === undefined) return SEARCH_LIMIT_DEFAULT
  if (!/^\d+$/.test(raw)) return null
  const limit = Number(raw)
  return limit >= 1 && limit <= SEARCH_LIMIT_MAX ? limit : null
}

/**
 * The vault of the project this request acts for, or undefined when the
 * project has none yet. Never creates it: a read must not bring a directory
 * into being.
 */
async function openVault(): Promise<Composed | undefined> {
  const cfg = await Config.get()
  return openMemory({
    worktree: Instance.worktree,
    settings: cfg.memory,
    providerId: UI_PROVIDER_ID,
    destinationKind: UI_DESTINATION,
  })
}

/**
 * A policy or vault the facade cannot open is reported as unavailable, with
 * the failure kind and nothing else. Any other error is a real fault and
 * stays with the server's error handler.
 */
async function guardVault(c: Context, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof KnowledgeFailure) {
      return c.json({ error: "memory vault unavailable", kind: error.kind }, 503)
    }
    throw error
  }
}

export const KnowledgeRoutes = () =>
  new Hono()
    .get("/status", (c) =>
      guardVault(c, async () => {
        const cfg = await Config.get()
        const enabled = memoryEnabled(cfg.memory)
        const vault = await openVault()
        if (vault === undefined) return c.json({ enabled, vault: "absent" })
        return c.json({ enabled, vault: "present", status: await vault.service.status() })
      }),
    )
    .get("/search", (c) => {
      const query = c.req.query("q") ?? ""
      const limit = parseLimit(c.req.query("limit"))
      if (query.trim() === "" || query.length > SEARCH_QUERY_MAX_LENGTH || limit === null) {
        return c.json({ error: "invalid search request" }, 400)
      }
      return guardVault(c, async () => {
        const vault = await openVault()
        if (vault === undefined) return c.json({ vault: "absent", items: [], truncated: false })
        const out = await vault.service.search({
          query,
          spaces: [],
          types: [],
          tags: [],
          maxCandidates: limit,
          maxPayloadBytes: SEARCH_PAYLOAD_MAX_BYTES,
          maxSnippetBytes: SEARCH_SNIPPET_MAX_BYTES,
          deadlineMs: DEFAULT_RECALL_DEADLINE_MS,
        })
        // The withheld notes are not listed: their locators would tell the
        // caller that they exist.
        return c.json({ vault: "present", items: out.pack.items, truncated: out.truncated })
      })
    })
    .get("/notes/:id", (c) => {
      const id = parseNoteId(c.req.param("id"))
      if (id === null) return c.json({ error: "invalid note id" }, 400)
      return guardVault(c, async () => {
        const vault = await openVault()
        const found = vault === undefined ? null : await vault.service.get(id as KnowledgeId)
        if (found === null) return c.json({ error: "note not found" }, 404)
        return c.json(found)
      })
    })
    .get("/notes/:id/backlinks", (c) => {
      const id = parseNoteId(c.req.param("id"))
      if (id === null) return c.json({ error: "invalid note id" }, 400)
      return guardVault(c, async () => {
        const vault = await openVault()
        // Asked about a note this caller may not read, the answer is the same as
        // for a missing note, so the backlinks cannot reveal it either.
        const visible = vault === undefined ? null : await vault.service.get(id as KnowledgeId)
        if (vault === undefined || visible === null) return c.json({ error: "note not found" }, 404)
        return c.json({ ids: await vault.service.backlinks({ id: id as KnowledgeId }) })
      })
    })
