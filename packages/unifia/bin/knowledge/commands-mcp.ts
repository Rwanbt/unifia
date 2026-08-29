/* SPDX-License-Identifier: MIT */
/**
 * `mcp-token` subcommands (cards C22 and C16).
 *
 * Every invocation used to build its own `McpTokenRegistry`, so `issue`
 * printed a token that no later command could see, `check` always answered
 * "invalid" and exited 1, and `revoke` always threw "unknown token". The
 * three commands could not work as written: a token lives in the memory of
 * the server that will honour it, and V1 has no daemon to hold one.
 *
 * `session` is the honest replacement — it composes a real server, issues a
 * token against it, exercises a call, revokes, and shows the refusal, all in
 * the one process where those steps mean something. `issue`, `check` and
 * `revoke` now say why they cannot work across invocations instead of
 * printing a misleading answer.
 */

import { composeMcpServer } from "../../src/knowledge/mcp/compose.js"
import { McpUnauthorized } from "../../src/knowledge/mcp/server.js"
import { resolveWorkspace } from "./runtime.js"

const CROSS_PROCESS_NOTE =
  "mcp-token: a token lives in the memory of the server that honours it, and\n" +
  "V1 ships no MCP daemon to hold one. A token issued by a CLI invocation is\n" +
  "gone when that invocation exits, so issue/check/revoke cannot be composed\n" +
  "across calls. Use `mcp-token session <workspace>` to exercise the real\n" +
  "server, or embed composeMcpServer() in the process that serves MCP.\n"

/** Run the full token lifecycle against a real server, in one process. */
async function session(workspace: string): Promise<number> {
  const root = resolveWorkspace(workspace)
  const { server, tokens, config, issue } = composeMcpServer({ workspaceRoot: root })

  const token = issue({ ttlMs: 60_000 })
  process.stdout.write(
    [
      `workspace:   ${config.workspace}`,
      `rate limit:  ${config.rateLimitPerMinute}/min`,
      `issued:      ${token.id}`,
      `expires:     ${token.expiresAt}`,
      `methods:     ${token.methods.join(", ")}`,
      "",
    ].join("\n"),
  )

  const status = await server.status({ tokenId: token.id })
  process.stdout.write(
    `status call: ok (${status.candidatesCount} note(s), fts=${status.enabled.fts})\n`,
  )

  tokens.revoke(token.id)
  try {
    await server.status({ tokenId: token.id })
    process.stderr.write("revocation had no effect — this is a defect\n")
    return 1
  } catch (e) {
    if (e instanceof McpUnauthorized) {
      process.stdout.write("after revoke: refused, as expected\n")
      return 0
    }
    throw e
  }
}

export async function cmdMcpToken(rest: readonly string[]): Promise<number> {
  const sub = rest[0]
  try {
    switch (sub) {
      case "session": {
        const ws = rest[1]
        if (!ws) {
          process.stderr.write("mcp-token session: missing workspace\n")
          return 2
        }
        return await session(ws)
      }
      case "issue":
      case "check":
      case "revoke":
        process.stderr.write(CROSS_PROCESS_NOTE)
        return 2
      default:
        process.stderr.write(`mcp-token: unknown subcommand: ${sub ?? "(missing)"}\n`)
        process.stderr.write("usage: mcp-token session <workspace>\n")
        return 2
    }
  } catch (e) {
    process.stderr.write(`mcp-token error: ${(e as Error).message}\n`)
    return 1
  }
}
