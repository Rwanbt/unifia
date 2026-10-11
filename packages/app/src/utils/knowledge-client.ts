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

/** A Markdown file in the vault that is not a governed note: named, never read. */
export interface KnowledgeUnmanagedFile {
  locator: string
  reason: string
}

export interface KnowledgeTree {
  vault: "absent" | "present"
  notes: KnowledgeNoteDescription[]
  /** Files the vault skipped, so the panel can say they exist. Absent in an answer from an older server. */
  unmanaged?: KnowledgeUnmanagedFile[]
}

/** A note as the owner edits it: its body, type and restrictions, and the hash a save must present. */
export interface KnowledgeNote {
  id: string
  locator: string
  type: string
  restrictions: unknown
  body: string
  versionHash: string
}

export interface KnowledgeNewContent {
  type: string
  restrictions: unknown
  body: string
}

/**
 * A change the owner proposes; the server applies it through the vault's governed writer. A change to an
 * existing note names it by id and carries the version hash it was read at, so a stale view is refused.
 */
export type KnowledgeIntent =
  | { kind: "create"; targetLocator: string; newContent: KnowledgeNewContent }
  | { kind: "update"; targetId: string; expectedVersionHash: string; newContent: KnowledgeNewContent }
  | { kind: "move"; targetId: string; expectedVersionHash: string; targetLocator: string }
  | { kind: "delete"; targetId: string; expectedVersionHash: string }

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

  async function send<T>(path: string, init: { method?: string; body?: unknown; query?: Record<string, string> }): Promise<T> {
    const url = new URL(path, input.server.url)
    url.searchParams.set("directory", input.directory)
    for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value)
    const requestHeaders: Record<string, string> = init.body === undefined ? headers : { ...headers, "Content-Type": "application/json" }
    const response = await input.fetch(url, {
      method: init.method ?? "GET",
      headers: requestHeaders,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) throw new KnowledgeRequestError(response.status, body)
    return body as T
  }

  function request<T>(path: string, query: Record<string, string> = {}): Promise<T> {
    return send<T>(path, { query })
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
    /** Proposes one change. The reason is the owner's, recorded with the change; the server adds the source. */
    propose: (intent: KnowledgeIntent, reason: string) =>
      send<{ applied?: boolean; locator?: string }>("/knowledge/propose", { method: "POST", body: { reason, intent } }),
  }
}
