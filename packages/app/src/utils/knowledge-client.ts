/* SPDX-License-Identifier: MIT */
/**
 * The client of the owner's knowledge routes (`/knowledge/*`), on the same transport as the SDK.
 *
 * The SDK builds its requests from the server connection: its URL, its Basic credentials, the
 * platform's fetch, and the project directory. This client takes the same four inputs, applies them
 * in the same order (explicit headers, such as a session's Bearer token, take precedence over the
 * Basic credentials), and sends the project directory as the `directory` query parameter, which is
 * how the server selects the vault. It never builds a path from a note's content: a note is named by
 * its id or by its vault-relative locator, passed as a query value.
 */
import type { ServerConnection } from "@/context/server"
import { serverBasicAuthorization } from "./server"

export interface KnowledgeStatus {
  enabled: boolean
  vault: "absent" | "present"
  status?: unknown
}

/** A note described without its body: what the tree lists and selects. */
export interface KnowledgeNoteDescription {
  id: string
  locator: string
  type: string
  space: string
  lifecycle: string
}

export interface KnowledgeTree {
  vault: "absent" | "present"
  notes: KnowledgeNoteDescription[]
}

/** A note as the facade serves it: the body, its id and locator, after the egress guard. */
export interface KnowledgeNote {
  candidates: Array<{
    id: string
    locator: string
    type: string
    space: string
    trust: string
    authority: string
    restriction: string
    snippet: string
    snippetHash: string
  }>
}

export interface KnowledgeLink {
  target: string
  resolvedId: string | null
}

/** A refusal or failure of a knowledge route, with the status the server answered. */
export class KnowledgeRequestError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, body: unknown) {
    super(`knowledge request failed with status ${status}`)
    this.name = "KnowledgeRequestError"
    this.status = status
    this.body = body
  }
}

export interface KnowledgeClientInput {
  server: ServerConnection.HttpBase
  fetch: typeof globalThis.fetch
  /** The project whose vault is read. */
  directory: string
  /** Explicit headers, such as a session's Bearer token; they take precedence over the Basic credentials. */
  headers?: Record<string, string>
}

export function createKnowledgeClient(input: KnowledgeClientInput) {
  const basic = serverBasicAuthorization(input.server)
  const headers: Record<string, string> = { ...(basic ? { Authorization: basic } : {}), ...input.headers }

  async function request<T>(path: string, query: Record<string, string> = {}): Promise<T> {
    const url = new URL(path, input.server.url)
    url.searchParams.set("directory", input.directory)
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    const response = await input.fetch(url, { headers })
    const body = await response.json().catch(() => null)
    if (!response.ok) throw new KnowledgeRequestError(response.status, body)
    return body as T
  }

  return {
    status: () => request<KnowledgeStatus>("/knowledge/status"),
    tree: () => request<KnowledgeTree>("/knowledge/tree"),
    note: (locator: string) => request<KnowledgeNote>("/knowledge/note", { locator }),
    search: (query: string, limit?: number) =>
      request<{ vault: string; items: unknown[]; truncated: boolean }>(
        "/knowledge/search",
        limit === undefined ? { q: query } : { q: query, limit: String(limit) },
      ),
    backlinks: (id: string) =>
      request<{ ids: string[] }>(`/knowledge/notes/${encodeURIComponent(id)}/backlinks`),
    links: (id: string) => request<{ links: KnowledgeLink[] }>(`/knowledge/notes/${encodeURIComponent(id)}/links`),
  }
}
