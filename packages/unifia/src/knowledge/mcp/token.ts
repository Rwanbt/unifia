/* SPDX-License-Identifier: MIT */
/**
 * MCP knowledge token (P9.2).
 *
 * Per runbook §19: "Tokens locaux, révocables, scoped workspace,
 * quotas, rate limit, taille et deadline bornées." The V1
 * `McpKnowledgeServer` enforces rate limit and byte cap; this
 * module adds the token concept, scoped to a single workspace,
 * revocable immediately, with a hard TTL.
 *
 * The token model is intentionally minimal: a string id, a
 * workspace scope, an issuedAt timestamp, an optional expiresAt,
 * and an optional revokedAt. A token is "valid" if and only if:
 *   - it exists;
 *   - it is not revoked;
 *   - it is not expired (now < expiresAt).
 */

export interface McpKnowledgeToken {
  id: string
  workspace: string
  issuedAt: string
  expiresAt: string | null
  revokedAt: string | null
}

export class McpTokenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "McpTokenError"
  }
}

export class McpTokenRegistry {
  private tokens = new Map<string, McpKnowledgeToken>()
  private nextSeq = 1

  /** Issue a new token. */
  issue(input: { workspace: string; ttlMs?: number }): McpKnowledgeToken {
    if (input.workspace.length === 0) {
      throw new McpTokenError("workspace must be non-empty")
    }
    const id = `tok-${Date.now().toString(36)}-${this.nextSeq.toString(36)}`
    this.nextSeq += 1
    const now = Date.now()
    const token: McpKnowledgeToken = {
      id,
      workspace: input.workspace,
      issuedAt: new Date(now).toISOString(),
      expiresAt:
        input.ttlMs !== undefined
          ? new Date(now + input.ttlMs).toISOString()
          : null,
      revokedAt: null,
    }
    this.tokens.set(id, token)
    return token
  }

  /** Revoke a token. No-op if already revoked. */
  revoke(id: string): void {
    const t = this.tokens.get(id)
    if (t === undefined) {
      throw new McpTokenError(`unknown token: ${id}`)
    }
    if (t.revokedAt !== null) return
    t.revokedAt = new Date().toISOString()
  }

  /** True if the token is not revoked and not expired. */
  isValid(id: string, now: number = Date.now()): boolean {
    const t = this.tokens.get(id)
    if (t === undefined) return false
    if (t.revokedAt !== null) return false
    if (t.expiresAt !== null) {
      const expiresAtMs = Date.parse(t.expiresAt)
      if (Number.isFinite(expiresAtMs) && now >= expiresAtMs) return false
    }
    return true
  }

  /** Look up a token. Returns null if unknown. */
  get(id: string): McpKnowledgeToken | null {
    return this.tokens.get(id) ?? null
  }

  /** Total active (valid) tokens for a workspace. */
  countActive(workspace: string, now: number = Date.now()): number {
    let n = 0
    for (const t of this.tokens.values()) {
      if (t.workspace !== workspace) continue
      if (!this.isValid(t.id, now)) continue
      n += 1
    }
    return n
  }
}
