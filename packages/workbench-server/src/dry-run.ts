/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Side-effect-free workflow dry run (#594, Automate "Test").
 *
 * Not a second execution model. The definition runs through the same
 * NativeWorkflowRuntimePort, engine, node registry and capability gate as a
 * real run, so traversal, branching, capability refusals and approval stops
 * are the real ones. Two things differ, and only these two:
 *
 * 1. The run lives in a throwaway SQLite database created for this call and
 *    deleted afterwards. A dry run therefore never appears in the run list
 *    and cannot be resumed, completed or mistaken for a committed run.
 * 2. The fetch handed to the driver never touches the network. `io.http` is
 *    the only executor with an external effect (transforms are pure;
 *    approval, wait and manual triggers are external and simply stop). Each
 *    attempted request is recorded and answered with a deterministic
 *    simulated receipt.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NativeWorkflowRuntimePort } from "./native-workflow-port.js"
import type { WorkflowDefinitionPort } from "./workflow-port.js"

export type DryRunEffect = { readonly nodeEffect: "http"; readonly method: string; readonly url: string }

export type DryRunReport = {
  /** Always true: lets every consumer tell a simulation from a committed run. */
  readonly dryRun: true
  readonly status: string
  readonly dispatched: readonly { nodeId: string; family: string; status: string }[]
  /** Nodes the run stopped on because a person must let them through. */
  readonly waitingFor: readonly { nodeId: string; family: string }[]
  /** External effects the run attempted; none of them was performed. */
  readonly simulatedEffects: readonly DryRunEffect[]
}

export const DRY_RUN_RECEIPT = { simulated: true, dryRun: true } as const

const PERSON_RELEASED_FAMILIES: ReadonlySet<string> = new Set(["human.approval", "wait", "trigger.manual"])

/** A fetch that records the request and answers a fixed receipt, without any I/O. */
export function simulatedFetch(effects: DryRunEffect[]): typeof fetch {
  const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    effects.push({ nodeEffect: "http", method: (init?.method ?? "GET").toUpperCase(), url })
    return new Response(JSON.stringify(DRY_RUN_RECEIPT), { status: 200, headers: { "content-type": "application/json" } })
  }
  return fake as typeof fetch
}

export async function dryRunWorkflow(
  definition: WorkflowDefinitionPort,
  ownerId: string,
  options: { authorize: (capabilities: readonly string[], resource: string) => Promise<void>; now?: () => number },
): Promise<DryRunReport> {
  const dir = mkdtempSync(join(tmpdir(), "unifia-dry-run-"))
  const port = new NativeWorkflowRuntimePort({ databasePath: join(dir, "dry-run.sqlite"), now: options.now })
  const effects: DryRunEffect[] = []
  try {
    const started = await port.start(definition, ownerId)
    const ran = await port.run(started.authorityToken, { fetch: simulatedFetch(effects), authorize: options.authorize })
    const nodes = await port.executionNodes(started.authorityToken)
    return {
      dryRun: true,
      status: ran.status,
      dispatched: ran.drive.dispatched.map(({ nodeId, family, status }) => ({ nodeId, family, status })),
      waitingFor: nodes
        .map((node) => ({ nodeId: node.nodeId, family: node.family.split(" ")[0] ?? node.family, status: node.status }))
        .filter((node) => node.status === "RUNNING" && PERSON_RELEASED_FAMILIES.has(node.family))
        .map(({ nodeId, family }) => ({ nodeId, family })),
      simulatedEffects: effects,
    }
  } finally {
    port.close()
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    } catch {
      // WHY: Windows keeps the SQLite file locked for a moment after close; the temp dir is disposable.
    }
  }
}
