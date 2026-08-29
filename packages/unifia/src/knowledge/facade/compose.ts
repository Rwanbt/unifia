/* SPDX-License-Identifier: MIT */
/**
 * Production composition point (card C4).
 *
 * This is the only place that turns a workspace path into a working
 * `KnowledgeService`. It exists because the operator-editable policy at
 * `<workspace>/.unifia/policy.json` had no effect on retrieval: `readPolicy`
 * was called only by the `policy` CLI subcommand and a read-only report,
 * while the CLI built its plan with a hardcoded
 * `{ providerId: "x", defaultRestriction: "allow" }`.
 *
 * Everything that reaches a provider is now derived from the policy on disk,
 * and a missing or malformed policy file fails closed (see `readPolicy`).
 */

import { isAbsolute, join } from "node:path"
import { existsSync } from "node:fs"
import type { ProviderDestinationPlan, DestinationKind } from "@unifia/contracts/knowledge"
import { SourceRegistry } from "../source/source.js"
import { VaultSource } from "../source/vault.js"
import { PersonalSource } from "../source/personal.js"
import { ProjectSource } from "../source/project.js"
import { readPolicy, isDestinationAllowed, type KnowledgePolicy } from "../policy/store.js"
import { KnowledgeFailure } from "../domain/errors.js"
import { DefaultKnowledgeService } from "./service.js"

/** Where the personal space lives inside a workspace. */
export const PERSONAL_SUBDIR = "memory"

export interface ComposeInput {
  /** Absolute path to the workspace root. */
  workspaceRoot: string
  /** Destination the resulting packs are bound for. */
  providerId: string
  /**
   * Whether that destination stays on the machine. Omitted means remote,
   * so an unspecified destination is treated as leaving the workspace.
   */
  destinationKind?: DestinationKind
}

export interface Composed {
  service: DefaultKnowledgeService
  registry: SourceRegistry
  policy: KnowledgePolicy
  plan: ProviderDestinationPlan
  /** Spaces that were actually mounted, for `status` to report honestly. */
  mounted: string[]
  /** True when a policy file existed; false when the built-in default applied. */
  policyFromFile: boolean
}

/**
 * Build the `ProviderDestinationPlan` from the workspace policy.
 *
 * The policy decides; nothing downstream may widen it. A destination with no
 * explicit entry inherits `policy.egress`, which defaults to `deny`.
 */
export function planFromPolicy(
  policy: KnowledgePolicy,
  providerId: string,
  destinationKind?: DestinationKind,
): ProviderDestinationPlan {
  const key =
    destinationKind === "local" ? `provider:${providerId}` : `provider:${providerId}:remote`
  const explicit = policy.egressByDestination[key] ?? policy.egressByDestination[providerId]

  let defaultRestriction: ProviderDestinationPlan["defaultRestriction"]
  if (explicit !== undefined) {
    defaultRestriction = explicit
  } else if (destinationKind === "local") {
    // PERMISSIONS.md §3: a local provider defaults to allow. `policy.egress`
    // governs what leaves the machine; reading one's own vault on-device is
    // not egress, and gating it on that switch would make an unconfigured
    // workspace unreadable. The note's own `local_model` restriction still
    // applies, and an operator can still deny a local destination by name.
    defaultRestriction = "allow"
  } else {
    defaultRestriction = policy.egress
  }

  const plan: ProviderDestinationPlan = { providerId, defaultRestriction }
  if (destinationKind !== undefined) plan.destinationKind = destinationKind
  return plan
}

/**
 * Compose the service for a workspace.
 *
 * Only spaces that exist on disk are mounted. A workspace without a
 * `memory/` directory mounts the project space alone rather than
 * advertising a personal space that would answer nothing.
 */
export function composeKnowledgeService(input: ComposeInput): Composed {
  if (!isAbsolute(input.workspaceRoot)) {
    throw KnowledgeFailure.pathUnresolved(
      `workspaceRoot must be absolute, got ${input.workspaceRoot}`,
    )
  }
  if (!existsSync(input.workspaceRoot)) {
    throw KnowledgeFailure.pathUnresolved(`workspace does not exist: ${input.workspaceRoot}`)
  }

  const policyFromFile = existsSync(join(input.workspaceRoot, ".unifia", "policy.json"))
  const policy = readPolicy(input.workspaceRoot)
  const plan = planFromPolicy(policy, input.providerId, input.destinationKind)

  const registry = new SourceRegistry()
  const mounted: string[] = []

  const personalRoot = join(input.workspaceRoot, PERSONAL_SUBDIR)
  if (existsSync(personalRoot)) {
    registry.register(
      new PersonalSource(
        { spaceId: "personal" },
        new VaultSource({
          root: personalRoot,
          space: { kind: "personal", id: "personal", label: "Personal" },
        }),
      ),
    )
    mounted.push("personal")
  }

  // The workspace root itself is the project space. When `memory/` exists it
  // is nested inside; VaultSource skips no ordinary directory, so a note
  // under memory/ is reachable from both — which is correct, they are two
  // views of the same Class A, and retrieval dedupes by locator ranking.
  registry.register(
    new ProjectSource(
      { projectRef: input.providerId },
      new VaultSource({
        root: input.workspaceRoot,
        space: { kind: "project", id: "project", label: "Project" },
      }),
    ),
  )
  mounted.push("project")

  const service = new DefaultKnowledgeService(registry, { providerPlan: plan }, {
    // V1 has no FTS5 runtime and no embedding model. These stay false until
    // a real backend is wired; `status` reports them verbatim.
    ftsEnabled: false,
    vectorEnabled: policy.features.embedding,
  })

  return { service, registry, policy, plan, mounted, policyFromFile }
}
