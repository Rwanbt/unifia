/* SPDX-License-Identifier: MIT */
/**
 * `unifia knowledge` — CLI surface for the Sovereign Knowledge Core.
 *
 * Standalone script (not registered in the main yargs tree in
 * `index.ts`). Invoked as `bun run packages/unifia/bin/unifia-knowledge.ts
 * <subcommand> [args]`. The V1 commands are:
 *
 *   status      — print the status of the knowledge subsystem.
 *   doctor      — run the doctor over the canonical knowledge.
 *   search      — search the corpus (uses the default in-memory
 *                 registry; full FTS needs the runtime).
 *   sources     — list the registered sources.
 *   bench       — run the semantic benchmark on a synthetic corpus.
 *
 * This is the in-process surface; the same logic backs the
 * `McpKnowledgeServer` and the `KnowledgeService` facade.
 */

import { doctor, type DoctorInput } from "../src/knowledge/admin/doctor.js"
import { ContextRouter } from "../src/knowledge/context/router.js"
import {
  SourceRegistry,
  PersonalSource,
  ProjectSource,
  type KnowledgeSource,
} from "../src/knowledge/source/index.js"
import {
  benchmarkOne,
  summarise,
} from "../src/knowledge/semantic/benchmark.js"
import { simulateLargeVault } from "../src/knowledge/hardening/large-vault.js"
import { planRecovery, simulateRecovery } from "../src/knowledge/hardening/disaster-recovery.js"
import { runSovereigntyProbes } from "../src/knowledge/hardening/sovereignty-runner.js"
import { dryRunMigration, planRollback, MIGRATION_V1_TO_V2 } from "../src/knowledge/hardening/migration.js"
import { scanStaged, installPrecommitHook } from "../src/knowledge/git/precommit.js"
import type { KnowledgeId, KnowledgeLocator } from "@unifia/contracts/knowledge"

function printUsage(): void {
  process.stdout.write(
    [
      "unifia knowledge — Sovereign Knowledge Core V1 CLI",
      "",
      "Usage:",
      "  unifia knowledge status",
      "  unifia knowledge sources",
      "  unifia knowledge doctor  (needs a corpus directory)",
      "  unifia knowledge search <query>",
      "  unifia knowledge bench",
      "  unifia knowledge bench-large <count> <bodySize>",
      "  unifia knowledge sovereignty [--vault=DIR] [--derived=PATH]",
      "  unifia knowledge disaster-recovery [--vault=DIR]",
      "  unifia knowledge migrate [--dry-run] [--rollback]",
      "  unifia knowledge precommit install <workspace>",
      "  unifia knowledge precommit scan <staged-file>...",
      "",
    ].join("\n"),
  )
}

interface ParsedArgs {
  cmd: string | null
  rest: string[]
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  if (argv.length === 0) return { cmd: null, rest: [] }
  const [first, ...rest] = argv
  return { cmd: first ?? null, rest: rest as string[] }
}

function makeRegistry(): { registry: SourceRegistry; sources: KnowledgeSource[] } {
  const reg = new SourceRegistry()
  const notes = (n: number) => [
    {
      ref: { id: `0190d2c0-7b00-7000-8000-${String(n).padStart(12, "0")}` as KnowledgeId, locator: `m/${n}.md` as KnowledgeLocator },
      type: "decision" as const,
      lifecycle: "active" as const,
      updatedAt: "2026-08-29T00:00:00Z",
    },
  ]
  const s1: KnowledgeSource = {
    space: { kind: "personal", id: "p", label: "Personal" },
    list: async () => notes(1),
    read: async () => null,
    watch: () => () => undefined,
  }
  const s2: KnowledgeSource = {
    space: { kind: "project", id: "pr", label: "unifia" },
    list: async () => notes(2),
    read: async () => null,
    watch: () => () => undefined,
  }
  reg.register(new PersonalSource({ spaceId: "p" }, s1))
  reg.register(new ProjectSource({ projectRef: "unifia" }, s2))
  return { registry: reg, sources: [s1, s2] }
}

async function cmdStatus(): Promise<number> {
  const { registry } = makeRegistry()
  const all = registry.all()
  process.stdout.write(
    [
      "Sovereign Knowledge Core V1 — status",
      `  sources:  ${all.length}`,
      `  kinds:    ${all.map((s) => s.space.kind).join(", ") || "(none)"}`,
      `  index:    v1 (in-memory, FTS5 not yet activated)`,
      `  embedding: disabled (no ONNX model downloaded)`,
      "",
    ].join("\n"),
  )
  return 0
}

async function cmdSources(): Promise<number> {
  const { registry } = makeRegistry()
  for (const s of registry.all()) {
    process.stdout.write(`- ${s.space.kind}  id=${s.space.id}  label=${s.space.label}\n`)
  }
  return 0
}

async function cmdSearch(rest: readonly string[]): Promise<number> {
  const query = rest.join(" ").trim()
  if (query.length === 0) {
    process.stderr.write("search: missing query\n")
    return 2
  }
  const { registry } = makeRegistry()
  const router = new ContextRouter(registry, {
    providerPlan: { providerId: "x", defaultRestriction: "allow" },
  })
  const { pack } = await router.route({
    query,
    spaces: [],
    types: [],
    tags: [],
    maxCandidates: 50,
    maxPayloadBytes: 1024 * 1024,
    maxSnippetBytes: 64 * 1024,
    deadlineMs: 2_000,
  })
  process.stdout.write(
    `query=${JSON.stringify(query)}  hits=${pack.items.length}  scanned=${pack.diagnostics.candidatesScanned}\n`,
  )
  return 0
}

async function cmdDoctor(): Promise<number> {
  const input: DoctorInput = {
    byId: new Map(),
    knownLocators: new Set(),
    edges: [],
    index: { rebuiltAt: new Date().toISOString(), candidatesCount: 0 },
    indexedLocators: new Set(),
  }
  const r = doctor(input)
  process.stdout.write(`doctor: ${r.findings.length} finding(s)\n`)
  for (const f of r.findings) process.stdout.write(`  - ${f.category}: ${f.message}\n`)
  return 0
}

async function cmdBench(): Promise<number> {
  const candidates = ["a", "b", "c"].map((id, i) => ({
    id: id as never,
    locator: `m/${id}.md` as never,
    type: "decision" as const,
    space: "personal" as const,
    trust: "verified" as const,
    authority: "user" as const,
    restriction: "allow" as const,
    relevance: 1 - i * 0.1,
    snippet: "",
    snippetBytes: 0,
    snippetHash: "0".repeat(64),
  }))
  const r = benchmarkOne(
    { query: "q", expected: ["a"] as never },
    candidates,
    5,
  )
  const s = summarise([r])
  process.stdout.write(
    `recall@5=${s.meanRecallAt5.toFixed(3)}  recall@10=${s.meanRecallAt10.toFixed(3)}  mrr=${s.meanMrr.toFixed(3)}  ndcg@10=${s.meanNdcgAt10.toFixed(3)}  forbidden=${s.meanForbiddenRate}  activate=${s.activate}\n`,
  )
  return 0
}

async function cmdBenchLarge(rest: readonly string[]): Promise<number> {
  const count = Number(rest[0] ?? "100")
  const bodySize = Number(rest[1] ?? "256")
  if (!Number.isFinite(count) || !Number.isFinite(bodySize) || count <= 0 || bodySize <= 0) {
    process.stderr.write("bench-large: count and bodySize must be positive numbers\n")
    return 2
  }
  const r = simulateLargeVault(count, bodySize, 1024)
  process.stdout.write(
    `simulated ${r.count} notes, parse=${r.totalParseMs}ms (mean ${r.meanParseMs.toFixed(2)}ms), index=${r.totalIndexMs}ms (mean ${r.meanIndexMs.toFixed(2)}ms), peak body bytes=${r.peakBodyBytes}\n`,
  )
  return 0
}

function parseFlags(rest: readonly string[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const arg of rest) {
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=")
      if (eq > 0) m.set(arg.slice(2, eq), arg.slice(eq + 1))
    }
  }
  return m
}

async function cmdSovereignty(rest: readonly string[]): Promise<number> {
  const flags = parseFlags(rest)
  const vaultRoot = flags.get("vault") ?? "."
  const derivedDb = flags.get("derived") ?? "./derived.db"
  const report = await runSovereigntyProbes({
    vaultRoot,
    derivedDbPath: derivedDb,
    // In V1 the operator is asked once at install time. The CLI
    // defaults assume offline; pass --online to override.
    internetOff: !flags.has("online"),
    cloudOff: !flags.has("cloud"),
    deviceIsolated: !flags.has("device"),
  })
  process.stdout.write(
    `vault:      ${report.vaultRoot}\nderived:    ${report.derivedDbPath}\n`,
  )
  for (const p of report.probes) {
    process.stdout.write(
      `  ${p.ok ? "PASS" : "FAIL"}  ${p.kind.padEnd(22)}  ${p.message}  (${p.durationMs}ms)\n`,
    )
  }
  process.stdout.write(`\nverdict:    ${report.ok ? "OK" : "FAIL"}  (total ${report.totalMs}ms)\n`)
  return report.ok ? 0 : 1
}

async function cmdDisasterRecovery(rest: readonly string[]): Promise<number> {
  const flags = parseFlags(rest)
  const vaultRoot = flags.get("vault") ?? "."
  const plan = planRecovery({
    classAReadable: true,
    classBReachable: true,
    classCPresent: !flags.has("no-class-c"),
    classDPresent: !flags.has("no-class-d"),
    unifiaBinaryPresent: !flags.has("no-unifia"),
    networkAvailable: !flags.has("offline"),
  })
  process.stdout.write(`detected missing: [${plan.missing.join(", ")}]\n`)
  process.stdout.write(`requires network: ${plan.requiresNetwork}\n`)
  process.stdout.write(`requires unifia:  ${plan.requiresUnifiaBinary}\n\n`)
  for (const step of plan.steps) {
    process.stdout.write(`- [${step.kind}] ${step.description}\n`)
  }
  // Simulate against a stub fs.
  const sim = simulateRecovery(plan, {
    read: (loc) => (loc === "memory/any.md" ? "# hello" : null),
    exists: (loc) => loc === "memory/any.md" || loc === "memory/any.md.unifia.json",
  })
  process.stdout.write(
    `\nsimulation: ${sim.ok ? "OK" : "FAIL"} (classA=${sim.classAStillReadable} classB=${sim.classBStillReachable} steps=${sim.stepsExecuted})\n`,
  )
  return sim.ok ? 0 : 1
}

async function cmdMigrate(rest: readonly string[]): Promise<number> {
  const dryRun = rest.includes("--dry-run")
  const rollback = rest.includes("--rollback")
  if (rollback) {
    const p = planRollback(MIGRATION_V1_TO_V2)
    process.stdout.write(
      `rollback plan: ${p.reversibleOps} reversible op(s), ${p.nonReversibleOps} reconstructible op(s), fullRollback=${p.fullRollback}\n`,
    )
    for (const op of p.reverseOps) {
      process.stdout.write(`  - ${op.kind} ${op.target} :: ${op.details}\n`)
    }
    // We are only printing a plan; we never apply it from the CLI in V1.
    return 0
  }
  const r = dryRunMigration(MIGRATION_V1_TO_V2)
  process.stdout.write(
    `V1→V2 migration (${dryRun ? "DRY-RUN" : "REVIEW"}): ${r.totalOps} op(s), ${r.additiveOps} additive, ${r.destructiveOps} destructive\n`,
  )
  process.stdout.write(`all reconstructible: ${r.allReconstructible}\n`)
  for (const label of r.stepLabels) process.stdout.write(`  - ${label}\n`)
  if (dryRun) {
    process.stdout.write(`\nNo state was mutated. Apply with caution after review.\n`)
    return 0
  }
  process.stdout.write(
    `\nRun with --dry-run for a safe preview or --rollback to see the reverse plan.\n`,
  )
  return 0
}

async function cmdPrecommit(rest: readonly string[]): Promise<number> {
  const sub = rest[0]
  if (sub === "install") {
    const ws = rest[1]
    if (!ws) {
      process.stderr.write("precommit install: missing workspace path\n")
      return 2
    }
    const r = installPrecommitHook(ws)
    if (!r.ok) {
      process.stderr.write(`precommit install failed: ${r.reason}\n`)
      return 1
    }
    process.stdout.write(`installed hook at ${r.hookPath}\n`)
    return 0
  }
  if (sub === "scan") {
    const staged = rest.slice(1)
    const ws = process.cwd()
    const r = scanStaged({
      workspaceRoot: ws,
      staged,
      read: (loc) => {
        try {
          return require("node:fs").readFileSync(loc, "utf8") as string
        } catch {
          return null
        }
      },
    })
    if (!r.ok) {
      for (const f of r.findings) {
        process.stderr.write(`DENY  ${f.locator}  :: ${f.classification}\n`)
      }
      return 1
    }
    process.stdout.write(`scanned ${r.scanned} staged file(s), no secrets found\n`)
    return 0
  }
  process.stderr.write(`precommit: unknown subcommand: ${sub ?? "(missing)"}\n`)
  return 2
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const { cmd, rest } = parseArgs(argv)
  switch (cmd) {
    case null:
    case "help":
    case "-h":
    case "--help":
      printUsage()
      return 0
    case "status":
      return cmdStatus()
    case "sources":
      return cmdSources()
    case "search":
      return cmdSearch(rest)
    case "doctor":
      return cmdDoctor()
    case "bench":
      return cmdBench()
    case "bench-large":
      return cmdBenchLarge(rest)
    case "sovereignty":
      return cmdSovereignty(rest)
    case "disaster-recovery":
      return cmdDisasterRecovery(rest)
    case "migrate":
      return cmdMigrate(rest)
    case "precommit":
      return cmdPrecommit(rest)
    default:
      process.stderr.write(`unknown subcommand: ${cmd}\n\n`)
      printUsage()
      return 2
  }
}

await main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`error: ${(err as Error).message}\n`)
    process.exit(1)
  })
