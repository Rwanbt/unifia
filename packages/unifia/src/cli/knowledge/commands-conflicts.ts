/* SPDX-License-Identifier: MIT */
/**
 * `unifia knowledge conflicts list|show|plan|apply` (ADR-092, conflict resolution).
 *
 * The owner's local operation on the writes a crash left held in a vault. `list` and `show` read; `plan` records a choice with the
 * hashes it is made against; `apply` executes a plan under the write lock. Every refusal is printed with its reason and exits 1.
 */

import { KnowledgeFailure } from "../../knowledge/domain/errors.js"
import { applyConflict } from "../../knowledge/admin/conflict-apply.js"
import {
  KEEP_CHOICES,
  type ConflictDetail,
  type KeepChoice,
  listConflicts,
  planConflict,
  showConflict,
} from "../../knowledge/admin/conflicts.js"
import { VaultMutationWriter } from "../../knowledge/mutation/writer.js"
import { parseFlags } from "./shared.js"
import { vaultRootOf } from "./runtime.js"

const ACTIONS = ["list", "show", "plan", "apply"] as const

const USAGE =
  "usage: conflicts <list|show|plan|apply> <workspace> [<id>] [--keep=pending|current|both] [--as=<locator>] [--plan=<planId>]"

/** Dispatch one `unifia knowledge conflicts` action. The workspace is named explicitly, as the other admin commands name it. */
export async function cmdConflicts(rest: readonly string[]): Promise<number> {
  const action = rest[0]
  if (action === undefined || !(ACTIONS as readonly string[]).includes(action)) {
    process.stderr.write(`conflicts: expected one of ${ACTIONS.join(", ")}\n${USAGE}\n`)
    return 2
  }
  const workspace = rest[1]
  if (!workspace) {
    process.stderr.write(`conflicts ${action}: missing workspace path\n${USAGE}\n`)
    return 2
  }
  const args = rest.slice(2)
  const positional = args.filter((a) => !a.startsWith("--"))
  const flags = parseFlags(args)
  try {
    const root = await vaultRootOf(workspace)
    if (action === "list") return printList(root)
    const id = positional[0]
    if (!id) {
      process.stderr.write(`conflicts ${action}: missing conflict id\n${USAGE}\n`)
      return 2
    }
    if (action === "show") return printShow(root, id)
    if (action === "plan") return runPlan(root, id, flags.get("keep"), flags.get("as"))
    return runApply(root, id, flags.get("plan"))
  } catch (error) {
    if (error instanceof KnowledgeFailure) {
      process.stderr.write(`conflicts ${action}: ${error.message}\n`)
      return 1
    }
    throw error
  }
}

function printList(root: string): number {
  const rows = listConflicts(root)
  if (rows.length === 0) {
    process.stdout.write("no unresolved conflicts\n")
    return 0
  }
  for (const row of rows) {
    const status = [row.held ? "held" : "not held", row.openApply ? "apply interrupted" : ""].filter((s) => s !== "").join(", ")
    process.stdout.write(
      `${row.id}  ${row.locator}  ${row.operation ?? "unknown"}  seq ${row.seq ?? "-"}  current ${row.currentState}  ${status}\n`,
    )
  }
  return 0
}

function printShow(root: string, id: string): number {
  const d: ConflictDetail = showConflict(root, id)
  const lines = [
    `conflict:  ${d.id}`,
    `note:      ${d.locator}`,
    `operation: ${d.operation ?? "unknown"}`,
    `seq:       ${d.seq ?? "-"}${d.auditId ? `  audit ${d.auditId}` : ""}`,
    d.source ? `source:    ${d.source}${d.reason ? `  (${d.reason})` : ""}` : "",
    d.later ? `later:     seq ${d.later.seq} ${d.later.kind} touches the note after the pending write` : "",
    `status:    ${[d.held ? "held: writes to the note are refused" : "not held", d.openApply ? "an apply is interrupted: writes stay refused until it is finished" : ""].filter((s) => s !== "").join("; ")}`,
    `pending:   ${d.pending.hash}  ${d.pending.size} bytes`,
    d.pending.preview === null ? "" : `           ${d.pending.preview}`,
    `current:   ${d.current.state}${d.current.hash ? `  ${d.current.hash}  ${d.current.size} bytes` : ""}`,
    d.current.preview === null ? "" : `           ${d.current.preview}`,
    d.latestPlan
      ? `plan:      ${d.latestPlan.planId}  keep ${d.latestPlan.keep}  by ${d.latestPlan.actor.user}  at ${d.latestPlan.at}`
      : "plan:      none",
  ]
  process.stdout.write(`${lines.filter((l) => l !== "").join("\n")}\n`)
  return 0
}

function runPlan(root: string, id: string, keep: string | undefined, as: string | undefined): number {
  if (keep === undefined || !(KEEP_CHOICES as readonly string[]).includes(keep)) {
    process.stderr.write("conflicts plan: --keep=pending|current|both is required\n")
    return 2
  }
  const plan = planConflict(root, { id, keep: keep as KeepChoice, ...(as ? { as } : {}) })
  const lines = [
    `planned:   ${plan.planId}  keep ${plan.keep}  note ${plan.locator}`,
    `current:   ${plan.currentHash ?? "absent"}`,
    `pending:   ${plan.pendingHash}`,
    plan.keepLocator ? `new note:  ${plan.keepLocator}` : "",
    `apply with: unifia knowledge conflicts apply <workspace> ${id} --plan=${plan.planId}`,
  ]
  process.stdout.write(`${lines.filter((l) => l !== "").join("\n")}\n`)
  return 0
}

function runApply(root: string, id: string, planId: string | undefined): number {
  const writer = new VaultMutationWriter({ root })
  const out = applyConflict(writer, root, { id, ...(planId ? { planId } : {}) })
  if (out.outcome === "noop") {
    process.stdout.write(`no-op: plan ${out.planId} was already applied; nothing changed\n`)
    return 0
  }
  const verb = out.outcome === "finished" ? "finished an interrupted apply" : "applied"
  process.stdout.write(`${verb}: plan ${out.planId}, kept ${out.keep} on ${out.locator}\n`)
  for (const preserved of out.preserved) process.stdout.write(`  preserved: ${preserved}\n`)
  if (out.newLocator) process.stdout.write(`  new note:  ${out.newLocator}\n`)
  return 0
}
