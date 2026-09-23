/* SPDX-License-Identifier: MIT */

// Client for a self-hosted SearXNG instance's JSON API, used by the
// websearch tool so no hosted search service receives the queries (ADR-044).
import type { Config } from "@/config/config"

export namespace SearXNG {
  export const DEFAULT_RESULTS = 8

  export type Result = {
    url: string
    title?: string
    content?: string
    publishedDate?: string | null
  }

  // The configured instance, without a trailing slash; undefined when web
  // search is not set up. The environment wins so the desktop shell and CI can
  // point at an instance without editing the user's config.
  export function url(config: Pick<Config.Info, "websearch">, env: NodeJS.ProcessEnv = process.env) {
    const raw = env.UNIFIA_SEARXNG_URL?.trim() || config.websearch?.searxng_url
    if (!raw) return undefined
    return raw.endsWith("/") ? raw.slice(0, -1) : raw
  }

  const PROBE_TTL_MS = 30_000
  const PROBE_TIMEOUT_MS = 1_500

  // Whether the instance answers its /healthz endpoint. Unifia must work with
  // SearXNG stopped (Docker Desktop not running): an unreachable instance is
  // simply not offered to the model. The registry rebuilds its tool list on
  // every turn, so answers are cached per URL for PROBE_TTL_MS; the owner
  // creates one probe and keeps it for its lifetime.
  export function createProbe(deps: { fetch?: typeof fetch; now?: () => number } = {}) {
    const request = deps.fetch ?? fetch
    const now = deps.now ?? Date.now
    const cache = new Map<string, { at: number; ok: Promise<boolean> }>()
    return (base: string): Promise<boolean> => {
      const hit = cache.get(base)
      if (hit && now() - hit.at < PROBE_TTL_MS) return hit.ok
      const ok = request(`${base}/healthz`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
        .then((response) => response.ok)
        .catch(() => false)
      cache.set(base, { at: now(), ok })
      return ok
    }
  }

  export async function search(base: string, query: string, limit: number, signal?: AbortSignal): Promise<Result[]> {
    const endpoint = new URL(`${base}/search`)
    endpoint.searchParams.set("q", query)
    endpoint.searchParams.set("format", "json")
    const response = await fetch(endpoint, { headers: { accept: "application/json" }, signal })
    // SearXNG answers 403 when the json format is not enabled, its default.
    if (response.status === 403)
      throw new Error('SearXNG refused the JSON format (403): add "json" to search.formats in its settings.yml')
    if (!response.ok) throw new Error(`SearXNG error (${response.status}): ${(await response.text()).slice(0, 200)}`)
    const body = (await response.json()) as { results?: Partial<Result>[] }
    return (body.results ?? []).filter((result): result is Result => typeof result.url === "string").slice(0, limit)
  }

  export function format(query: string, results: Result[]) {
    if (results.length === 0) return `No search results for "${query}". Try a different query.`
    return results
      .map((result, index) =>
        [
          `${index + 1}. ${result.title?.trim() || result.url}`,
          `   ${result.url}`,
          ...(result.publishedDate ? [`   Published: ${result.publishedDate}`] : []),
          ...(result.content?.trim() ? [`   ${result.content.trim()}`] : []),
        ].join("\n"),
      )
      .join("\n\n")
  }
}
