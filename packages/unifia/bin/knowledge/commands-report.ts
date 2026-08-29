/* SPDX-License-Identifier: MIT */
/**
 * Read-only vault reporting commands (card C16).
 *
 * Extracted from `unifia-knowledge.ts`, which stood at 2048 lines against a
 * 1500-line blocking budget. These are all pure reporters: they walk Class A
 * and print. No mutation, no policy decision, no egress.
 */
import { LCD_TYPES, LCD_LIFECYCLES, parseFlags, join_, hasFlag } from "./shared.js"
import { doctor, type DoctorInput } from "../../src/knowledge/admin/doctor.js"
import { ContextRouter } from "../../src/knowledge/context/router.js"
import {
  SourceRegistry,
  PersonalSource,
  ProjectSource,
  type KnowledgeSource,
} from "../../src/knowledge/source/index.js"
import {
  benchmarkOne,
  summarise,
} from "../../src/knowledge/semantic/benchmark.js"
import { simulateLargeVault } from "../../src/knowledge/hardening/large-vault.js"
import { planRecovery, simulateRecovery } from "../../src/knowledge/hardening/disaster-recovery.js"
import { runSovereigntyProbes } from "../../src/knowledge/hardening/sovereignty-runner.js"
import { dryRunMigration, planRollback, MIGRATION_V1_TO_V2 } from "../../src/knowledge/hardening/migration.js"
import { scanStaged, installPrecommitHook } from "../../src/knowledge/git/precommit.js"
import {
  readPortableStore,
  upsertPortableEntry,
  removePortableEntry,
  listPortableEntries,
} from "../../src/knowledge/classb/portable-store.js"
import { scanReachability } from "../../src/knowledge/classb/reachability.js"
import { McpTokenRegistry } from "../../src/knowledge/mcp/token.js"
import { classifyCorpus } from "../../src/knowledge/admin/corpus-classify.js"
import { runVerify } from "../../src/knowledge/hardening/verify.js"
import { readPolicy, patchPolicy, type KnowledgePolicy } from "../../src/knowledge/policy/store.js"
import { recommendGc, applyGcRecommendation } from "../../src/knowledge/classb/gc.js"
import { simulateSimilarity } from "../../src/knowledge/semantic/simulate.js"
import { summarise as summariseWorkspace, formatSummaryOneLine } from "../../src/knowledge/admin/summary.js"
import { runDrill, stubFsWithClassA } from "../../src/knowledge/hardening/drill.js"
import { validate } from "../../src/knowledge/admin/validate.js"
import { generateReport } from "../../src/knowledge/admin/report.js"
import { tagSearch } from "../../src/knowledge/admin/tag-search.js"
import { findBacklinks } from "../../src/knowledge/admin/backlinks.js"
import { computeStats } from "../../src/knowledge/admin/stats.js"
import { listByType } from "../../src/knowledge/admin/by-type.js"
import { scanBrokenLinks } from "../../src/knowledge/admin/broken-links.js"
import { listHeadings } from "../../src/knowledge/admin/headings.js"
import { listNotes } from "../../src/knowledge/admin/list.js"
import { showNote } from "../../src/knowledge/admin/show.js"
import { allTags } from "../../src/knowledge/admin/tags.js"
import { allProjects } from "../../src/knowledge/admin/projects.js"
import { planSupersede } from "../../src/knowledge/admin/supersede.js"
import { listByLifecycle } from "../../src/knowledge/admin/by-lifecycle.js"
import { listByProject } from "../../src/knowledge/admin/by-project.js"
import { findOrphans } from "../../src/knowledge/admin/orphans.js"
import { lifecycleDistribution } from "../../src/knowledge/admin/lifecycle-distribution.js"
import { findStale } from "../../src/knowledge/admin/stale.js"
import { findReferences } from "../../src/knowledge/admin/references.js"
import { vaultFingerprint } from "../../src/knowledge/admin/fingerprint.js"
import { listByTag } from "../../src/knowledge/admin/by-tag.js"
import { compareVaults } from "../../src/knowledge/admin/vault-compare.js"
import { findRecent } from "../../src/knowledge/admin/recent.js"
import { supersedeGraph } from "../../src/knowledge/admin/supersede-graph.js"
import { findDuplicates } from "../../src/knowledge/admin/duplicates.js"
import { buildTimeline, formatTimeline } from "../../src/knowledge/admin/timeline.js"
import { tagCooccurrence } from "../../src/knowledge/admin/tag-cooccurrence.js"
import { classifySupersede } from "../../src/knowledge/admin/supersede-classify.js"
import { noteDiff } from "../../src/knowledge/admin/note-diff.js"
import { buildTransitionMatrix, formatTransitionMatrix } from "../../src/knowledge/admin/lifecycle-transitions.js"
import { noteStats } from "../../src/knowledge/admin/note-stats.js"
import { sizeDistribution } from "../../src/knowledge/admin/size-distribution.js"
import { weekdayDistribution } from "../../src/knowledge/admin/weekday-distribution.js"
import { edgeDensity } from "../../src/knowledge/admin/edge-density.js"
import { frontmatterDiff } from "../../src/knowledge/admin/frontmatter-diff.js"
import type { KnowledgeId, KnowledgeLocator } from "@unifia/contracts/knowledge"


export async function cmdShow(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  const loc = rest[1]
  if (!ws || !loc) {
    process.stderr.write("show: usage: show <workspace> <locator>\n")
    return 2
  }
  try {
    const text = showNote({ workspaceRoot: ws, locator: loc })
    process.stdout.write(text)
    if (!text.endsWith("\n")) process.stdout.write("\n")
    return 0
  } catch (e) {
    process.stderr.write(`show error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdTags(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("tags: missing workspace path\n")
    return 2
  }
  try {
    const r = allTags({ vaultRoot: ws })
    process.stdout.write(`vault:    ${r.vaultRoot}` + "\n")
    process.stdout.write(`scanned:  ${r.scanned}` + "\n")
    process.stdout.write(`unique:   ${r.tags.length}` + "\n")
    for (const t of r.tags) {
      process.stdout.write(`  - ${t.tag.padEnd(20)} ${t.count}` + "\n")
    }
    return 0
  } catch (e) {
    process.stderr.write(`tags error: ${(e as Error).message}` + "\n")
    return 1
  }
}


export async function cmdProjects(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("projects: missing workspace path\n")
    return 2
  }
  try {
    const r = allProjects({ vaultRoot: ws })
    process.stdout.write(`vault:    ${r.vaultRoot}` + "\n")
    process.stdout.write(`scanned:  ${r.scanned}` + "\n")
    process.stdout.write(`unique:   ${r.projects.length}` + "\n")
    for (const p of r.projects) {
      process.stdout.write(`  - ${p.projectRef.padEnd(20)} ${p.count}` + "\n")
    }
    return 0
  } catch (e) {
    process.stderr.write(`projects error: ${(e as Error).message}` + "\n")
    return 1
  }
}


export async function cmdSupersede(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("supersede: missing workspace path\n")
    return 2
  }
  const flags = parseFlags(rest.slice(1))
  const targetLocator = flags.get("target")
  const targetId = flags.get("target-id")
  const source = flags.get("source") ?? "cli"
  const reason = flags.get("reason")
  const successorLocator = flags.get("successor")
  if (!reason) {
    process.stderr.write("supersede: --reason=<r> is required\n")
    return 2
  }
  if (!targetLocator && !targetId) {
    process.stderr.write("supersede: --target=<locator> or --target-id=<uuid> is required\n")
    return 2
  }
  try {
    const plan = planSupersede({
      vaultRoot: ws,
      ...(targetLocator !== undefined ? { targetLocator } : {}),
      ...(targetId !== undefined ? { targetId: targetId as never } : {}),
      ...(successorLocator !== undefined ? { successorLocator } : {}),
      source,
      reason,
    })
    if (!plan.ok) {
      process.stderr.write(`supersede: ${plan.reason ?? "unknown error"}\n`)
      return 1
    }
    process.stdout.write(`ok:        true\n`)
    process.stdout.write(`target:    ${plan.target?.id}  (${plan.target?.locator})\n`)
    process.stdout.write(`lifecycle: ${plan.target?.lifecycle}\n`)
    process.stdout.write(`hash:      ${plan.target?.versionHash}\n`)
    if (plan.successor) {
      process.stdout.write(`successor: ${plan.successor.id}  (${plan.successor.locator})\n`)
    }
    if (plan.warnings && plan.warnings.length > 0) {
      process.stdout.write(`warnings:\n`)
      for (const w of plan.warnings) {
        process.stdout.write(`  - ${w}\n`)
      }
    }
    if (plan.intent) {
      process.stdout.write(`intent:\n`)
      process.stdout.write(`  kind:                ${plan.intent.kind}\n`)
      process.stdout.write(`  targetId:            ${plan.intent.targetId}\n`)
      process.stdout.write(`  expectedVersionHash: ${plan.intent.expectedVersionHash}\n`)
      process.stdout.write(`  reason:              ${plan.intent.reason}\n`)
      process.stdout.write(`  source:              ${plan.intent.source}\n`)
    }
    return 0
  } catch (e) {
    process.stderr.write(`supersede error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdByLifecycle(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  const lc = rest[1]
  if (!ws || !lc) {
    process.stderr.write("by-lifecycle: usage: by-lifecycle <workspace> <candidate|active|superseded|archived> [--limit=N]\n")
    return 2
  }
  const flags = parseFlags(rest.slice(2))
  const limit = flags.get("limit") !== undefined ? Number(flags.get("limit")) : undefined
  try {
    const r = listByLifecycle({ vaultRoot: ws, lifecycle: lc as never, ...(limit !== undefined ? { limit } : {}) })
    process.stdout.write(`vault:    ${r.vaultRoot}` + "\n")
    process.stdout.write(`lifecycle: ${r.lifecycle}` + "\n")
    process.stdout.write(`scanned:  ${r.scanned}` + "\n")
    process.stdout.write(`hits:     ${r.hits.length}` + "\n")
    for (const h of r.hits) {
      process.stdout.write(`  - ${h.locator.padEnd(28)} ${h.type}  ${h.updatedAt}` + "\n")
    }
    return 0
  } catch (e) {
    process.stderr.write(`by-lifecycle error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdByProject(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  const pr = rest[1]
  if (!ws || !pr) {
    process.stderr.write("by-project: usage: by-project <workspace> <project_ref> [--limit=N]\n")
    return 2
  }
  const flags = parseFlags(rest.slice(2))
  const limit = flags.get("limit") !== undefined ? Number(flags.get("limit")) : undefined
  try {
    const r = listByProject({ vaultRoot: ws, projectRef: pr, ...(limit !== undefined ? { limit } : {}) })
    process.stdout.write(`vault:      ${r.vaultRoot}` + "\n")
    process.stdout.write(`project:    ${r.projectRef}` + "\n")
    process.stdout.write(`scanned:    ${r.scanned}` + "\n")
    process.stdout.write(`hits:       ${r.hits.length}` + "\n")
    for (const h of r.hits) {
      process.stdout.write(`  - ${h.locator.padEnd(28)} ${h.type}  ${h.lifecycle}  ${h.updatedAt}` + "\n")
    }
    return 0
  } catch (e) {
    process.stderr.write(`by-project error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdOrphans(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("orphans: missing workspace path\n")
    return 2
  }
  const flags = parseFlags(rest.slice(1))
  const maxLinks = flags.get("max-links") !== undefined ? Number(flags.get("max-links")) : undefined
  const limit = flags.get("limit") !== undefined ? Number(flags.get("limit")) : undefined
  try {
    const r = findOrphans({
      vaultRoot: ws,
      ...(maxLinks !== undefined ? { maxLinks } : {}),
      ...(limit !== undefined ? { limit } : {}),
    })
    process.stdout.write(`vault:     ${r.vaultRoot}` + "\n")
    process.stdout.write(`max-links: ${r.maxLinks}` + "\n")
    process.stdout.write(`scanned:   ${r.scanned}` + "\n")
    process.stdout.write(`orphans:   ${r.hits.length}` + "\n")
    for (const h of r.hits) {
      process.stdout.write(`  - ${h.locator.padEnd(28)} ${h.type}  ${h.lifecycle}  (out=${h.outboundCount})` + "\n")
    }
    return 0
  } catch (e) {
    process.stderr.write(`orphans error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdLifecycleDistribution(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("lifecycle-distribution: missing workspace path\n")
    return 2
  }
  try {
    const r = lifecycleDistribution({ vaultRoot: ws })
    process.stdout.write(`vault:    ${r.vaultRoot}\n`)
    process.stdout.write(`scanned:  ${r.scanned}\n`)
    process.stdout.write(`total:    ${r.total}\n\n`)
    // Header
    const header = ["          "]
    for (const t of LCD_TYPES) header.push(t.padStart(11))
    header.push("TOTAL".padStart(11))
    process.stdout.write(header.join(" ") + "\n")
    // Rows
    for (const lc of LCD_LIFECYCLES) {
      const row = [lc.padEnd(10)]
      let rowTotal = 0
      for (const t of LCD_TYPES) {
        const v = r.matrix[lc]?.[t] ?? 0
        row.push(String(v).padStart(11))
        rowTotal += v
      }
      row.push(String(rowTotal).padStart(11))
      process.stdout.write(row.join(" ") + "\n")
    }
    // Totals row
    const totalsRow = ["TOTAL".padEnd(10)]
    let grandTotal = 0
    for (const t of LCD_TYPES) {
      const v = r.typeTotals[t] ?? 0
      totalsRow.push(String(v).padStart(11))
      grandTotal += v
    }
    totalsRow.push(String(grandTotal).padStart(11))
    process.stdout.write(totalsRow.join(" ") + "\n")
    if (r.unknownTypeCount > 0 || r.unknownLifecycleCount > 0) {
      process.stdout.write(`\nunknowns: type=${r.unknownTypeCount}  lifecycle=${r.unknownLifecycleCount}\n`)
    }
    return 0
  } catch (e) {
    process.stderr.write(`lifecycle-distribution error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdStale(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("stale: missing workspace path\n")
    return 2
  }
  const flags = parseFlags(rest.slice(1))
  const threshold = flags.get("threshold-days") !== undefined ? Number(flags.get("threshold-days")) : undefined
  const limit = flags.get("limit") !== undefined ? Number(flags.get("limit")) : undefined
  const onlyActive = flags.has("only-active")
  try {
    const r = findStale({
      vaultRoot: ws,
      ...(threshold !== undefined ? { thresholdDays: threshold } : {}),
      ...(limit !== undefined ? { limit } : {}),
      onlyActive,
    })
    process.stdout.write(`vault:           ${r.vaultRoot}\n`)
    process.stdout.write(`threshold:       ${r.thresholdDays} days\n`)
    process.stdout.write(`reference-date:  ${r.referenceDate}\n`)
    process.stdout.write(`scanned:         ${r.scanned}\n`)
    process.stdout.write(`stale:           ${r.hits.length}\n`)
    for (const h of r.hits) {
      process.stdout.write(`  - ${h.locator.padEnd(28)} age=${String(h.ageDays).padStart(4)}d  ${h.lifecycle}  ${h.updatedAt}\n`)
    }
    return 0
  } catch (e) {
    process.stderr.write(`stale error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdReferences(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("references: missing workspace path\n")
    return 2
  }
  const flags = parseFlags(rest.slice(1))
  const targetLocator = flags.get("target")
  const targetId = flags.get("target-id")
  if (!targetLocator && !targetId) {
    process.stderr.write("references: --target=<locator> or --target-id=<uuid> is required\n")
    return 2
  }
  try {
    const r = findReferences({
      vaultRoot: ws,
      ...(targetLocator !== undefined ? { targetLocator } : {}),
      ...(targetId !== undefined ? { targetId: targetId as never } : {}),
    })
    if (!r.target) {
      process.stderr.write("references: target not found\n")
      return 1
    }
    process.stdout.write(`target:    ${r.target.id}  (${r.target.locator})\n`)
    process.stdout.write(`refs:      ${r.references.length}\n`)
    for (const w of r.references) {
      const heading = w.heading !== undefined ? `#${w.heading}` : ""
      const alias = w.alias !== undefined ? `|${w.alias}` : ""
      process.stdout.write(`  - [[${w.target}${heading}${alias}]]  (offset=${w.start})\n`)
    }
    return 0
  } catch (e) {
    process.stderr.write(`references error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdFingerprint(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("fingerprint: missing workspace path\n")
    return 2
  }
  const flags = parseFlags(rest.slice(1))
  const verbose = hasFlag(rest, "verbose") || flags.has("verbose")
  try {
    const r = vaultFingerprint({ vaultRoot: ws, skipMissing: true })
    process.stdout.write(`vault:       ${r.vaultRoot}\n`)
    process.stdout.write(`files:       ${r.fileCount}\n`)
    process.stdout.write(`fingerprint: ${r.fingerprint}\n`)
    if (verbose) {
      process.stdout.write(`\nper-file hashes:\n`)
      for (const f of r.perFile) {
        process.stdout.write(`  ${f.hash}  ${String(f.bytes).padStart(6)}  ${f.locator}\n`)
      }
    }
    return 0
  } catch (e) {
    process.stderr.write(`fingerprint error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdByTag(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  const tag = rest[1]
  if (!ws || !tag) {
    process.stderr.write("by-tag: usage: by-tag <workspace> <tag> [--limit=N]\n")
    return 2
  }
  const flags = parseFlags(rest.slice(2))
  const limit = flags.get("limit") !== undefined ? Number(flags.get("limit")) : undefined
  try {
    const r = listByTag({ vaultRoot: ws, tag, ...(limit !== undefined ? { limit } : {}) })
    process.stdout.write(`vault:    ${r.vaultRoot}\n`)
    process.stdout.write(`tag:      ${r.tag}\n`)
    process.stdout.write(`scanned:  ${r.scanned}\n`)
    process.stdout.write(`hits:     ${r.hits.length}\n`)
    for (const h of r.hits) {
      process.stdout.write(`  - ${h.locator.padEnd(28)} ${h.type}  ${h.lifecycle}  tags=[${h.tags.join(", ")}]\n`)
    }
    return 0
  } catch (e) {
    process.stderr.write(`by-tag error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdVaultCompare(rest: readonly string[]): Promise<number> {
  const a = rest[0]
  const b = rest[1]
  if (!a || !b) {
    process.stderr.write("vault-compare: usage: vault-compare <workspace_a> <workspace_b>\n")
    return 2
  }
  try {
    const r = compareVaults({ vaultA: a, vaultB: b })
    process.stdout.write(`vault A: ${r.vaultA}  (${r.fileCountA} files)\n`)
    process.stdout.write(`vault B: ${r.vaultB}  (${r.fileCountB} files)\n\n`)
    process.stdout.write(`identical: ${r.identical.length}\n`)
    process.stdout.write(`changed:   ${r.changed.length}\n`)
    process.stdout.write(`only-A:    ${r.onlyA.length}\n`)
    process.stdout.write(`only-B:    ${r.onlyB.length}\n`)
    if (r.changed.length > 0) {
      process.stdout.write(`\nchanged files:\n`)
      for (const f of r.changed) process.stdout.write(`  ${f}\n`)
    }
    if (r.onlyA.length > 0) {
      process.stdout.write(`\nonly in A:\n`)
      for (const f of r.onlyA) process.stdout.write(`  ${f}\n`)
    }
    if (r.onlyB.length > 0) {
      process.stdout.write(`\nonly in B:\n`)
      for (const f of r.onlyB) process.stdout.write(`  ${f}\n`)
    }
    return 0
  } catch (e) {
    process.stderr.write(`vault-compare error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdRecent(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("recent: missing workspace path\n")
    return 2
  }
  const flags = parseFlags(rest.slice(1))
  const window = flags.get("window-days") !== undefined ? Number(flags.get("window-days")) : undefined
  const limit = flags.get("limit") !== undefined ? Number(flags.get("limit")) : undefined
  const onlyActive = hasFlag(rest, "only-active") || flags.has("only-active")
  try {
    const r = findRecent({
      vaultRoot: ws,
      ...(window !== undefined ? { windowDays: window } : {}),
      ...(limit !== undefined ? { limit } : {}),
      onlyActive,
    })
    process.stdout.write(`vault:           ${r.vaultRoot}\n`)
    process.stdout.write(`window:          ${r.windowDays} days\n`)
    process.stdout.write(`reference-date:  ${r.referenceDate}\n`)
    process.stdout.write(`scanned:         ${r.scanned}\n`)
    process.stdout.write(`recent:          ${r.hits.length}\n`)
    for (const h of r.hits) {
      process.stdout.write(`  - ${h.locator.padEnd(28)} age=${String(h.ageDays).padStart(4)}d  ${h.lifecycle}  ${h.updatedAt}\n`)
    }
    return 0
  } catch (e) {
    process.stderr.write(`recent error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdSupersedeGraph(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("supersede-graph: missing workspace path\n")
    return 2
  }
  try {
    const r = supersedeGraph({ vaultRoot: ws })
    process.stdout.write(`vault:    ${r.vaultRoot}\n`)
    process.stdout.write(`edges:    ${r.edges.length}\n`)
    process.stdout.write(`dangling: ${r.dangling.length}\n`)
    if (r.edges.length > 0) {
      process.stdout.write(`\nedges (from -> to):\n`)
      for (const e of r.edges) {
        process.stdout.write(`  ${e.fromLocator.padEnd(28)} supersedes -> ${e.to}\n`)
      }
    }
    if (r.deepest.length > 0) {
      process.stdout.write(`\ntop-3 deepest lineages:\n`)
      for (const d of r.deepest) {
        process.stdout.write(`  ${d.locator.padEnd(28)} depth=${d.depth}\n`)
      }
    }
    if (r.dangling.length > 0) {
      process.stdout.write(`\ndangling references:\n`)
      for (const d of r.dangling) {
        process.stdout.write(`  ${d.locator.padEnd(28)} -> ${d.missingId}\n`)
      }
    }
    return 0
  } catch (e) {
    process.stderr.write(`supersede-graph error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdDuplicates(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("duplicates: missing workspace path\n")
    return 2
  }
  try {
    const r = findDuplicates({ vaultRoot: ws })
    process.stdout.write(`vault:          ${r.vaultRoot}\n`)
    process.stdout.write(`groups:         ${r.groups.length}\n`)
    process.stdout.write(`duplicates:     ${r.duplicateCount}\n`)
    process.stdout.write(`wasted-bytes:   ${r.wastedBytes}\n`)
    if (r.groups.length > 0) {
      process.stdout.write(`\nduplicate groups:\n`)
      for (const g of r.groups) {
        process.stdout.write(`  hash=${g.hash.slice(0, 12)}...  (${g.locators.length} copies, ${g.bytes}B each)\n`)
        for (const loc of g.locators) {
          process.stdout.write(`    - ${loc}\n`)
        }
      }
    }
    return 0
  } catch (e) {
    process.stderr.write(`duplicates error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdTimeline(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("timeline: missing workspace path\n")
    return 2
  }
  const flags = parseFlags(rest.slice(1))
  const window = flags.get("window-days") !== undefined ? Number(flags.get("window-days")) : undefined
  const maxPerDay = flags.get("max-per-day") !== undefined ? Number(flags.get("max-per-day")) : 5
  try {
    const r = buildTimeline({
      vaultRoot: ws,
      ...(window !== undefined ? { windowDays: window } : {}),
    })
    process.stdout.write(formatTimeline(r, maxPerDay) + "\n")
    return 0
  } catch (e) {
    process.stderr.write(`timeline error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdTagCooccurrence(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("tag-cooccurrence: missing workspace path\n")
    return 2
  }
  const flags = parseFlags(rest.slice(1))
  const minCount = flags.get("min-count") !== undefined ? Number(flags.get("min-count")) : undefined
  const limit = flags.get("limit") !== undefined ? Number(flags.get("limit")) : undefined
  try {
    const r = tagCooccurrence({
      vaultRoot: ws,
      ...(minCount !== undefined ? { minCount } : {}),
      ...(limit !== undefined ? { limit } : {}),
    })
    process.stdout.write(`vault:        ${r.vaultRoot}\n`)
    process.stdout.write(`scanned:      ${r.scanned}\n`)
    process.stdout.write(`unique-tags:  ${r.uniqueTags}\n`)
    process.stdout.write(`pairs:        ${r.pairs.length}\n`)
    if (r.pairs.length > 0) {
      process.stdout.write(`\nco-occurrence pairs:\n`)
      for (const p of r.pairs) {
        process.stdout.write(`  ${String(p.count).padStart(3)}  ${p.a.padEnd(20)} <-> ${p.b}\n`)
      }
    }
    return 0
  } catch (e) {
    process.stderr.write(`tag-cooccurrence error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdSupersedeClassify(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("supersede-classify: missing workspace path\n")
    return 2
  }
  try {
    const r = classifySupersede({ vaultRoot: ws })
    process.stdout.write(`vault:     ${r.vaultRoot}\n`)
    process.stdout.write(`scanned:   ${r.scanned}\n\n`)
    process.stdout.write(`isolated:  ${r.totalByRole.isolated}  (no supersedes, no successor)\n`)
    process.stdout.write(`root:      ${r.totalByRole.root}  (has supersedes, no successor)\n`)
    process.stdout.write(`leaf:      ${r.totalByRole.leaf}  (no supersedes, has successor)\n`)
    process.stdout.write(`chain:     ${r.totalByRole.chain}  (has both)\n`)
    for (const role of ["isolated", "root", "leaf", "chain"] as const) {
      if (r.byRole[role].length === 0) continue
      process.stdout.write(`\n${role} (${r.byRole[role].length}):\n`)
      for (const n of r.byRole[role]) {
        process.stdout.write(`  - ${n.locator.padEnd(28)} ${n.type}  ${n.lifecycle}  (preds=${n.supersedesCount} succ=${n.successorCount})\n`)
      }
    }
    return 0
  } catch (e) {
    process.stderr.write(`supersede-classify error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdNoteDiff(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("note-diff: missing workspace path\n")
    return 2
  }
  const flags = parseFlags(rest.slice(1))
  const aLoc = flags.get("target-a")
  const aId = flags.get("target-id-a")
  const bLoc = flags.get("target-b")
  const bId = flags.get("target-id-b")
  if (!aLoc && !aId) {
    process.stderr.write("note-diff: --target-a=<loc> or --target-id-a=<uuid> is required\n")
    return 2
  }
  if (!bLoc && !bId) {
    process.stderr.write("note-diff: --target-b=<loc> or --target-id-b=<uuid> is required\n")
    return 2
  }
  try {
    const r = noteDiff({
      vaultRoot: ws,
      ...(aLoc !== undefined ? { noteALocator: aLoc as never } : {}),
      ...(aId !== undefined ? { noteAId: aId as never } : {}),
      ...(bLoc !== undefined ? { noteBLocator: bLoc as never } : {}),
      ...(bId !== undefined ? { noteBId: bId as never } : {}),
    })
    process.stdout.write(`vault:    ${r.vaultRoot}\n`)
    process.stdout.write(`note-a:   ${r.noteA?.id}  (${r.noteA?.locator})\n`)
    process.stdout.write(`note-b:   ${r.noteB?.id}  (${r.noteB?.locator})\n`)
    process.stdout.write(`added:    ${r.added}\n`)
    process.stdout.write(`removed:  ${r.removed}\n`)
    const printSection = (label: string, lines: typeof r.frontmatterDiff) => {
      if (lines.length === 0) return
      process.stdout.write(`\n--- ${label} ---\n`)
      for (const l of lines) {
        const prefix = l.kind === "add" ? "+" : l.kind === "remove" ? "-" : " "
        process.stdout.write(`${prefix} ${l.content}\n`)
      }
    }
    printSection("frontmatter", r.frontmatterDiff)
    printSection("body", r.bodyDiff)
    return 0
  } catch (e) {
    process.stderr.write(`note-diff error: ${(e as Error).message}\n`)
    return 1
  }
}


export async function cmdLifecycleTransitions(_rest: readonly string[]): Promise<number> {
  try {
    const m = buildTransitionMatrix()
    process.stdout.write("V1 lifecycle transition matrix (per ADR-KNOW-0009):\n\n")
    process.stdout.write(formatTransitionMatrix(m) + "\n")
    process.stdout.write("\nLegend: OK = transition allowed, - = transition refused\n")
    return 0
  } catch (e) {
    process.stderr.write(`lifecycle-transitions error: ${(e as Error).message}\n`)
    return 1
  }
}

export async function cmdNoteStats(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("note-stats: usage: note-stats <workspace> <locator>|--id=<uuid>\n")
    return 2
  }
  const idFlag = rest.find((a) => a.startsWith("--id="))
  const id = idFlag ? idFlag.slice("--id=".length) : undefined
  const locator = idFlag ? undefined : rest[1]
  if (!id && !locator) {
    process.stderr.write("note-stats: usage: note-stats <workspace> <locator>|--id=<uuid>\n")
    return 2
  }
  try {
    const r = noteStats({ vaultRoot: ws, locator, id })
    process.stdout.write(`locator:          ${r.locator}\n`)
    process.stdout.write(`id:               ${r.id ?? "-"}\n`)
    process.stdout.write(`type:             ${r.type}\n`)
    process.stdout.write(`lifecycle:        ${r.lifecycle}\n`)
    process.stdout.write(`project_ref:      ${r.projectRef ?? "-"}\n`)
    process.stdout.write(`updated_at:       ${r.updatedAt ?? "-"}\n`)
    process.stdout.write(`body:             ${r.bodyChars} chars / ${r.bodyLines} lines / ${r.bytes} bytes\n`)
    process.stdout.write(`frontmatter:      ${r.frontmatterFieldCount} fields (${r.frontmatterFieldNames.join(", ")})\n`)
    process.stdout.write(`headings:         ${r.headingCount} (max depth ${r.maxHeadingDepth})\n`)
    process.stdout.write(`wikilinks:        ${r.wikilinkOutCount} out / ${r.wikilinkInCount} in\n`)
    process.stdout.write(`tags:             ${r.tagCount} (${r.distinctTagCount} distinct)\n`)
    return 0
  } catch (e) {
    process.stderr.write(`note-stats error: ${(e as Error).message}\n`)
    return 1
  }
}

export async function cmdSizeDistribution(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("size-distribution: usage: size-distribution <workspace>\n")
    return 2
  }
  try {
    const r = sizeDistribution({ vaultRoot: ws })
    process.stdout.write(`vault:        ${r.vaultRoot}\n`)
    process.stdout.write(`scanned:      ${r.scanned}\n`)
    process.stdout.write(`total:        ${r.totalBytes} bytes\n`)
    process.stdout.write(`mean:         ${r.meanBytes} bytes\n`)
    process.stdout.write(`median:       ${r.medianBytes} bytes\n`)
    process.stdout.write(`min/max:      ${r.minBytes} / ${r.maxBytes}\n\n`)
    process.stdout.write("distribution:\n")
    for (const [label, count] of Object.entries(r.bins)) {
      const bar = "#".repeat(count)
      process.stdout.write(`  ${label.padEnd(12)} ${String(count).padStart(4)} ${bar}\n`)
    }
    return 0
  } catch (e) {
    process.stderr.write(`size-distribution error: ${(e as Error).message}\n`)
    return 1
  }
}

export async function cmdWeekdayDistribution(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("weekday-distribution: usage: weekday-distribution <workspace>\n")
    return 2
  }
  try {
    const r = weekdayDistribution({ vaultRoot: ws })
    process.stdout.write(`vault:    ${r.vaultRoot}\n`)
    process.stdout.write(`scanned:  ${r.scanned}\n`)
    process.stdout.write(`total:    ${r.total}\n\n`)
    process.stdout.write("by weekday (UTC, Mon=0 .. Sun=6):\n")
    for (const [label, count] of Object.entries(r.byWeekday)) {
      const bar = "#".repeat(count)
      process.stdout.write(`  ${label.padEnd(4)} ${String(count).padStart(4)} ${bar}\n`)
    }
    return 0
  } catch (e) {
    process.stderr.write(`weekday-distribution error: ${(e as Error).message}\n`)
    return 1
  }
}

export async function cmdEdgeDensity(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("edge-density: usage: edge-density <workspace>\n")
    return 2
  }
  try {
    const r = edgeDensity({ vaultRoot: ws })
    process.stdout.write(`vault:        ${r.vaultRoot}\n`)
    process.stdout.write(`scanned:      ${r.scanned}\n`)
    process.stdout.write(`mean degree:  ${r.meanDegree}\n`)
    process.stdout.write(`max degree:   ${r.maxDegree}\n`)
    process.stdout.write(`isolated:     ${r.isolatedCount}\n\n`)
    process.stdout.write("degree histogram (in + out):\n")
    for (const [label, count] of Object.entries(r.buckets)) {
      const bar = "#".repeat(count)
      process.stdout.write(`  ${label.padEnd(6)} ${String(count).padStart(4)} ${bar}\n`)
    }
    return 0
  } catch (e) {
    process.stderr.write(`edge-density error: ${(e as Error).message}\n`)
    return 1
  }
}

export async function cmdFrontmatterDiff(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write(
      "frontmatter-diff: usage: frontmatter-diff <workspace> --target-a=<loc>|--id-a=<uuid> --target-b=<loc>|--id-b=<uuid>\n",
    )
    return 2
  }
  const targetA = rest.find((a) => a.startsWith("--target-a="))?.slice("--target-a=".length)
  const idA = rest.find((a) => a.startsWith("--id-a="))?.slice("--id-a=".length)
  const targetB = rest.find((a) => a.startsWith("--target-b="))?.slice("--target-b=".length)
  const idB = rest.find((a) => a.startsWith("--id-b="))?.slice("--id-b=".length)
  if (!targetA && !idA) {
    process.stderr.write("frontmatter-diff: missing --target-a or --id-a\n")
    return 2
  }
  if (!targetB && !idB) {
    process.stderr.write("frontmatter-diff: missing --target-b or --id-b\n")
    return 2
  }
  try {
    const r = frontmatterDiff({
      vaultRoot: ws,
      targetA,
      idA,
      targetB,
      idB,
    })
    process.stdout.write(`A: ${r.aLocator}\n`)
    process.stdout.write(`B: ${r.bLocator}\n\n`)
    process.stdout.write(`added (in B only):     ${r.added.length === 0 ? "(none)" : r.added.join(", ")}\n`)
    process.stdout.write(`removed (in A only):   ${r.removed.length === 0 ? "(none)" : r.removed.join(", ")}\n`)
    process.stdout.write(`changed:               ${r.changed.length}\n`)
    for (const c of r.changed) {
      process.stdout.write(`  ${c.key}: ${JSON.stringify(c.a)} -> ${JSON.stringify(c.b)}\n`)
    }
    process.stdout.write(`unchanged:             ${r.unchanged.length === 0 ? "(none)" : r.unchanged.join(", ")}\n`)
    return 0
  } catch (e) {
    process.stderr.write(`frontmatter-diff error: ${(e as Error).message}\n`)
    return 1
  }
}
