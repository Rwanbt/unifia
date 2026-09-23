import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./websearch.txt"
import { abortAfterAny } from "../util/abort"
import { Config } from "../config/config"
import { SearXNG } from "./searxng"

const SEARCH_TIMEOUT_MS = 25000

// Queries the user's own SearXNG instance; no hosted search API receives the
// query (ADR-044). The registry only offers this tool when an instance is
// configured.
export const WebSearchTool = Tool.define("websearch", async () => {
  return {
    get description() {
      return DESCRIPTION.replace("{{year}}", new Date().getFullYear().toString())
    },
    parameters: z.object({
      query: z.string().describe("Websearch query"),
      numResults: z
        .number()
        .int()
        .positive()
        .max(20)
        .optional()
        .describe(`Number of search results to return (default: ${SearXNG.DEFAULT_RESULTS})`),
    }),
    async execute(params, ctx) {
      await ctx.ask({
        permission: "websearch",
        patterns: [params.query],
        always: ["*"],
        metadata: { query: params.query, numResults: params.numResults },
      })

      const base = SearXNG.url(await Config.get())
      if (!base) throw new Error("Web search is not configured: set websearch.searxng_url or UNIFIA_SEARXNG_URL")

      const { signal, clearTimeout } = abortAfterAny(SEARCH_TIMEOUT_MS, ctx.abort)
      try {
        const results = await SearXNG.search(base, params.query, params.numResults ?? SearXNG.DEFAULT_RESULTS, signal)
        return {
          output: SearXNG.format(params.query, results),
          title: `Web search: ${params.query}`,
          metadata: { numResults: results.length },
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw new Error("Search request timed out")
        throw error
      } finally {
        clearTimeout()
      }
    },
  }
})
