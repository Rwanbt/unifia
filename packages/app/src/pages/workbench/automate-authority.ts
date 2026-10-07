/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Ownership tokens for Automate runs, resolvable after a reload.
 *
 * Extracted from `automate-surface.tsx` for the same reason `automate-decode.ts`
 * was: the decision "do I have a token for this run, or must I ask the server
 * for one?" is the whole of CR05, and while it lived inside the SolidJS
 * component the only thing that could test it was a regular expression over the
 * component's source text. That is a pin on the shape of the code, not evidence
 * that a reload can be recovered from.
 *
 * The rule is unchanged: a run started in this session uses the token the start
 * returned; a run listed from an earlier session is reclaimed from the server,
 * which hands the current token back only to the principal that started it and
 * refuses anyone else. Tokens are held in memory only — never persisted, never
 * logged — which is why the server has to be the recovery path at all.
 */

import { workflowAuthorityOf, type WorkflowAuthority, type WorkflowState } from "@unifia/workbench-shell"

type ReclaimClient = {
  reclaimWorkflow(workspaceId: string, workflowId: string, signal?: AbortSignal): Promise<{ state: WorkflowState }>
}

type AuthorityStore = {
  /** The token of a run: this session's, or the server's for an earlier one. Throws when the server gives none. */
  resolve(client: ReclaimClient, workspaceId: string, runId: string): Promise<WorkflowAuthority>
  /** Records the token a start returned, so the run it started never needs a round trip. */
  remember(authority: WorkflowAuthority): void
  /** How many tokens are held. Exposed for tests and diagnostics; the tokens themselves never leave this module. */
  readonly size: number
}

export function createAuthorityStore(): AuthorityStore {
  const tokens = new Map<string, WorkflowAuthority>()

  return {
    remember(authority: WorkflowAuthority) {
      tokens.set(authority.workflowRunId, authority)
    },
    async resolve(client: ReclaimClient, workspaceId: string, runId: string) {
      const known = tokens.get(runId)
      if (known) return known
      // A run from an earlier session: the server binds ownership to the
      // principal that started it, so this is the only place a token can come
      // from after a reload. It can legitimately fail — a run owned by another
      // principal is refused — and a refusal must surface as a refusal.
      const reclaimed = workflowAuthorityOf((await client.reclaimWorkflow(workspaceId, runId)).state)
      if (!reclaimed) throw new Error(`the server returned no authority for run ${runId}`)
      tokens.set(runId, reclaimed)
      return reclaimed
    },
    get size() {
      return tokens.size
    },
  }
}

export { workflowAuthorityOf, type WorkflowAuthority, type WorkflowState }
