/* SPDX-License-Identifier: MIT */
/**
 * Read-only access to the memory vault, through the knowledge facade, for the owner of this
 * installation.
 *
 * The Memory panel used to read `.unifia/memory` through the generic file API, which applies no
 * classification, consent or provenance. These routes are the governed path: every answer comes
 * from the facade the agent's tools already use, and a note reaches a response only after the
 * egress guard has cleared it for the owner.
 *
 * Every route first checks that the request comes from the owner (knowledge-authority.ts). A
 * request that is not the owner is refused before any vault is opened. There is no route for
 * writes, administration or raw files, and an unknown note answers exactly like a withheld one.
 */
import { Hono, type Context } from "hono"
import { existsSync, realpathSync } from "node:fs"
import type { KnowledgeId, KnowledgeLocator } from "@unifia/contracts/knowledge"
import { Config } from "../../config/config"
import { Instance } from "../../project/instance"
import {
  DEFAULT_RECALL_DEADLINE_MS,
  memoryEnabled,
  openMemory,
  resolveMemoryRoot,
} from "../../knowledge/app/memory"
import type { Composed } from "../../knowledge/facade/compose"
import { KnowledgeFailure } from "../../knowledge/domain/errors"
import { principalOf } from "../auth-jwt"
import {
  decideOwner,
  isInsideDirectory,
  isTrustedRequestTarget,
  machineAddresses,
  VaultLocationRefused,
} from "../knowledge-authority"

/**
 * The owner's own interface on this machine.
 *
 * The owner is not a model: `audience: "owner"` tells the facade that the note's `local_model`
 * and `remote_model` restrictions do not apply. The vault policy still applies to this destination
 * (`provider:unifia-ui`), so the owner can be refused by the vault itself. Nothing here sends
 * content to a model. The audience is only reached after decideOwner has accepted the request.
 */
const UI_PROVIDER_ID = "unifia-ui"
const UI_DESTINATION = "local" as const
const UI_AUDIENCE = "owner" as const

/**
 * A note id is a UUID in practice. Anything that could be a path segment is refused before it
 * reaches the store, so the id can never address a file outside the vault.
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

/** The port this server listens on, from the Bun server object the request was delivered with. */
function serverPort(c: Context): number | undefined {
  const server = c.env as { port?: number } | undefined
  return typeof server?.port === "number" ? server.port : undefined
}

/**
 * The vault of the project this request acts for, or undefined when the project has none yet.
 * Never creates it: a read must not bring a directory into being.
 */
/**
 * `create` is for a proposal only: the first note of a project creates its vault. A read never does.
 */
async function openVault(options: { writable?: boolean; create?: boolean } = {}): Promise<Composed | undefined> {
  const cfg = await Config.get()
  // The default location must stay inside its project; a location the owner configured is the owner's choice.
  if (cfg.memory?.directory === undefined) assertDefaultVaultInside(Instance.worktree)
  return openMemory({
    worktree: Instance.worktree,
    settings: cfg.memory,
    providerId: UI_PROVIDER_ID,
    destinationKind: UI_DESTINATION,
    audience: UI_AUDIENCE,
    ...(options.writable === true ? { writable: true } : {}),
    ...(options.create === true ? { create: true } : {}),
  })
}

/** The writes the owner's interface proposes are recorded under this source, whatever the request claims. */
const OWNER_SOURCE = "owner-ui"
const PROPOSE_BODY_MAX_BYTES = 1_048_576

interface Proposal {
  intent: Record<string, unknown>
  reason: string
}

function parseProposal(body: unknown): Proposal | null {
  if (typeof body !== "object" || body === null) return null
  const { intent, reason } = body as { intent?: unknown; reason?: unknown }
  if (typeof intent !== "object" || intent === null || Array.isArray(intent)) return null
  if (typeof reason !== "string" || reason.length === 0) return null
  return { intent: intent as Record<string, unknown>, reason }
}

async function proposeChange(c: Context, body: unknown): Promise<Response> {
  const proposal = parseProposal(body)
  if (proposal === null) return c.json({ error: "invalid proposal" }, 400)
  try {
    const vault = await openVault({ writable: true, create: true })
    if (vault === undefined) return c.json({ error: "memory vault is absent" }, 404)
    // Clearance applies to writes as to reads: a note the owner may not read cannot be changed.
    const targetId = proposal.intent.targetId
    if (typeof targetId === "string" && (await vault.service.readOwned(targetId as KnowledgeId)) === null) {
      return c.json({ error: "note not found" }, 404)
    }
    // The intent schema carries its own reason and source: both are the owner's, not the request's.
    const intent = { ...proposal.intent, reason: proposal.reason, source: OWNER_SOURCE }
    const result = await vault.service.propose({ intent, reason: proposal.reason, source: OWNER_SOURCE })
    return c.json(result)
  } catch (error) {
    if (error instanceof VaultLocationRefused) return c.json({ error: "memory vault location refused" }, 403)
    if (error instanceof KnowledgeFailure) {
      return c.json({ error: "proposal refused", kind: error.kind }, error.kind === "cas_mismatch" ? 409 : 422)
    }
    throw error
  }
}

function assertDefaultVaultInside(worktree: string): void {
  const root = resolveMemoryRoot(worktree)
  if (!existsSync(root)) return
  // Real paths on both sides: a symbolic link or a junction inside the project cannot point the vault elsewhere.
  if (!isInsideDirectory(realpathSync(root), realpathSync(worktree))) throw new VaultLocationRefused()
}

/**
 * A policy or vault the facade cannot open is reported as unavailable, with the failure kind and
 * nothing else. A vault located outside its project is refused. Any other error is a real fault
 * and stays with the server's error handler.
 */
async function guardVault(c: Context, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof VaultLocationRefused) {
      return c.json({ error: "memory vault location refused" }, 403)
    }
    if (error instanceof KnowledgeFailure) {
      return c.json({ error: "memory vault unavailable", kind: error.kind }, 503)
    }
    throw error
  }
}

const LOCATOR_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,127}$/
const LOCATOR_MAX_LENGTH = 512

/**
 * A note's path relative to the vault: `/`-separated segments that are plain names, ending in `.md`.
 * An absolute path, `.` or `..`, a backslash, a drive letter or a NUL byte is refused before any read.
 */
export function parseLocator(raw: string | undefined): string | null {
  if (raw === undefined || raw.length === 0 || raw.length > LOCATOR_MAX_LENGTH) return null
  if (!raw.endsWith(".md")) return null
  return raw.split("/").every((segment) => LOCATOR_SEGMENT.test(segment)) ? raw : null
}

export const KnowledgeRoutes = () =>
  new Hono()
    .use(async (c, next) => {
      // Before the owner check: a request addressed to another host, or from another origin, is not served at all.
      const trusted = isTrustedRequestTarget({
        host: c.req.header("host") ?? null,
        origin: c.req.header("origin") ?? null,
        serverPort: serverPort(c),
        // Read per request: an interface that comes up or goes down (Wi-Fi, VPN) must take effect at once.
        localAddresses: machineAddresses(),
      })
      if (!trusted) return c.json({ error: "untrusted request target" }, 403)
      return next()
    })
    .use(async (c, next) => {
      const decision = decideOwner({ user: principalOf(c.req.raw) })
      if (!decision.owner) return c.json({ error: "owner authority required" }, 403)
      return next()
    })
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
        // The withheld notes are not listed: their locators would tell the caller that they exist.
        return c.json({ vault: "present", items: out.pack.items, truncated: out.truncated })
      })
    })
    .get("/notes/:id", (c) => {
      const id = parseNoteId(c.req.param("id"))
      if (id === null) return c.json({ error: "invalid note id" }, 400)
      return guardVault(c, async () => {
        const vault = await openVault()
        const found = vault === undefined ? null : await vault.service.readOwned(id as KnowledgeId)
        if (found === null) return c.json({ error: "note not found" }, 404)
        return c.json(found)
      })
    })
    .get("/notes/:id/backlinks", (c) => {
      const id = parseNoteId(c.req.param("id"))
      if (id === null) return c.json({ error: "invalid note id" }, 400)
      return guardVault(c, async () => {
        const vault = await openVault()
        // Asked about a note the owner may not read, the answer is the same as for a missing note.
        const visible = vault === undefined ? null : await vault.service.get(id as KnowledgeId)
        if (vault === undefined || visible === null) return c.json({ error: "note not found" }, 404)
        return c.json({ ids: await vault.service.backlinks({ id: id as KnowledgeId }) })
      })
    })
    .get("/tree", (c) =>
      guardVault(c, async () => {
        const vault = await openVault()
        if (vault === undefined) return c.json({ vault: "absent", notes: [] })
        // Descriptions only: the tree lists and selects notes, it does not carry their bodies.
        return c.json({ vault: "present", notes: await vault.service.listVisible() })
      }),
    )
    .get("/note", (c) => {
      const locator = parseLocator(c.req.query("locator"))
      if (locator === null) return c.json({ error: "invalid note locator" }, 400)
      return guardVault(c, async () => {
        const vault = await openVault()
        const found = vault === undefined ? null : await vault.service.readOwned(undefined, locator as KnowledgeLocator)
        if (found === null) return c.json({ error: "note not found" }, 404)
        return c.json(found)
      })
    })
    .get("/notes/:id/links", (c) => {
      const id = parseNoteId(c.req.param("id"))
      if (id === null) return c.json({ error: "invalid note id" }, 400)
      return guardVault(c, async () => {
        const vault = await openVault()
        const visible = vault === undefined ? null : await vault.service.get(id as KnowledgeId)
        if (vault === undefined || visible === null) return c.json({ error: "note not found" }, 404)
        return c.json({ links: await vault.service.outgoingLinks(id as KnowledgeId) })
      })
    })
    .post("/propose", (c) => {
      if (Number(c.req.header("content-length") ?? 0) > PROPOSE_BODY_MAX_BYTES) {
        return c.json({ error: "request body too large" }, 413)
      }
      return c.req.json().then(
        (body) => proposeChange(c, body),
        () => c.json({ error: "invalid JSON body" }, 400),
      )
    })
