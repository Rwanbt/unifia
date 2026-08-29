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
import {
  readPortableStore,
  upsertPortableEntry,
  removePortableEntry,
  listPortableEntries,
} from "../src/knowledge/classb/portable-store.js"
import { scanReachability } from "../src/knowledge/classb/reachability.js"
import { McpTokenRegistry } from "../src/knowledge/mcp/token.js"
import { classifyCorpus } from "../src/knowledge/admin/corpus-classify.js"
import { runVerify } from "../src/knowledge/hardening/verify.js"
import { readPolicy, patchPolicy, type KnowledgePolicy } from "../src/knowledge/policy/store.js"
import { recommendGc, applyGcRecommendation } from "../src/knowledge/classb/gc.js"
import { simulateSimilarity } from "../src/knowledge/semantic/simulate.js"
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
      "  unifia knowledge portable <workspace> list",
      "  unifia knowledge portable <workspace> upsert <alias> <locator> [<external>]",
      "  unifia knowledge portable <workspace> remove <alias>",
      "  unifia knowledge portable <workspace> show",
      "  unifia knowledge reachability <workspace>",
      "  unifia knowledge mcp-token issue <workspace> [--ttl=MS]",
      "  unifia knowledge mcp-token revoke <token-id>",
      "  unifia knowledge mcp-token check <token-id>",
      "  unifia knowledge classify <workspace>",
      "  unifia knowledge verify <workspace> [--derived=PATH]",
      "  unifia knowledge policy <workspace> show",
      "  unifia knowledge policy <workspace> set-egress <allow|deny>",
      "  unifia knowledge policy <workspace> set-feature <feature> <true|false>",
      "  unifia knowledge gc <workspace> recommend",
      "  unifia knowledge gc <workspace> apply",
      "  unifia knowledge similarity <workspace> [--topk=N]",
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

async function cmdPortable(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("portable: missing workspace path\n")
    return 2
  }
  const sub = rest[1]
  try {
    switch (sub) {
      case "list":
      case "show": {
        const entries = listPortableEntries(ws)
        if (entries.length === 0) {
          process.stdout.write("(empty portable store)\n")
          return 0
        }
        for (const e of entries) {
          process.stdout.write(
            `- ${e.alias}  locator=${e.locator}  revision=${e.revision}${e.externalSource ? `  external=${e.externalSource}` : ""}\n`,
          )
        }
        return 0
      }
      case "upsert": {
        const alias = rest[2]
        const locator = rest[3]
        const external = rest[4]
        if (!alias || !locator) {
          process.stderr.write("portable upsert: missing alias or locator\n")
          return 2
        }
        const s = upsertPortableEntry(ws, alias, locator, external)
        process.stdout.write(`upserted ${alias} -> ${locator} (revision=${s.entries[alias]?.revision})\n`)
        return 0
      }
      case "remove": {
        const alias = rest[2]
        if (!alias) {
          process.stderr.write("portable remove: missing alias\n")
          return 2
        }
        removePortableEntry(ws, alias)
        process.stdout.write(`removed ${alias}\n`)
        return 0
      }
      default:
        process.stderr.write(`portable: unknown subcommand: ${sub ?? "(missing)"}\n`)
        return 2
    }
  } catch (e) {
    process.stderr.write(`portable error: ${(e as Error).message}\n`)
    return 1
  }
}

async function cmdReachability(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("reachability: missing workspace path\n")
    return 2
  }
  try {
    const r = scanReachability(ws)
    process.stdout.write(`vault:      ${r.workspaceRoot}\n`)
    process.stdout.write(`class A:    ${r.classALocators.length} note(s)\n`)
    process.stdout.write(`class B:    ${r.classBEntries.length} entry(ies)\n`)
    process.stdout.write(`reachable:  ${r.reachable.length}\n`)
    process.stdout.write(`orphans:    ${r.orphans.length}\n`)
    process.stdout.write(`missing:    ${r.missingSidecars.length} (no sidecar)\n`)
    if (r.orphans.length > 0) {
      process.stdout.write(`\norphans (Class B without Class A):\n`)
      for (const o of r.orphans) process.stdout.write(`  - ${o}\n`)
    }
    if (r.missingSidecars.length > 0) {
      process.stdout.write(`\nmissing sidecars (Class A without Class B):\n`)
      for (const m of r.missingSidecars) process.stdout.write(`  - ${m}\n`)
    }
    process.stdout.write(`\nelapsed:    ${r.durationMs}ms\n`)
    return 0
  } catch (e) {
    process.stderr.write(`reachability error: ${(e as Error).message}\n`)
    return 1
  }
}

async function cmdClassify(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("classify: missing workspace path\n")
    return 2
  }
  try {
    const r = classifyCorpus(ws)
    process.stdout.write(`vault:        ${r.vaultRoot}\n`)
    process.stdout.write(`notes parsed: ${r.notesParsed}\n`)
    process.stdout.write(`notes failed: ${r.notesFailed}\n`)
    process.stdout.write(`total chunks: ${r.totalChunks}\n`)
    process.stdout.write(`total edges:  ${r.totalEdges}\n`)
    process.stdout.write(`duration:     ${r.durationMs}ms\n`)
    process.stdout.write(`findings:     ${r.findings.length}\n`)
    for (const f of r.findings) {
      process.stdout.write(`  - [${f.category}] ${f.message}\n`)
    }
    return r.findings.length === 0 ? 0 : 1
  } catch (e) {
    process.stderr.write(`classify error: ${(e as Error).message}\n`)
    return 1
  }
}

async function cmdVerify(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("verify: missing workspace path\n")
    return 2
  }
  const flags = parseFlags(rest.slice(1))
  const derived = flags.get("derived") ?? join_(ws, "derived.db")
  const r = await runVerify({
    vaultRoot: ws,
    derivedDbPath: derived,
    internetOff: !flags.has("online"),
    cloudOff: !flags.has("cloud"),
    deviceIsolated: !flags.has("device"),
    classCPresent: !flags.has("no-class-c"),
    classDPresent: !flags.has("no-class-d"),
    unifiaBinaryPresent: !flags.has("no-unifia"),
  })
  process.stdout.write(`vault:  ${r.vaultRoot}\n\n`)
  for (const c of r.checks) {
    process.stdout.write(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name.padEnd(20)}  ${c.details}  (${c.durationMs}ms)\n`)
  }
  process.stdout.write(`\nverdict: ${r.ok ? "OK" : "FAIL"}  (total ${r.totalMs}ms)\n`)
  return r.ok ? 0 : 1
}

// Tiny helper for joining paths without importing node:path
// at the top of this file (kept in one place for clarity).
function join_(...parts: string[]): string {
  return parts.join("/").replace(/[\\/]+/g, "/")
}

async function cmdPolicy(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("policy: missing workspace path\n")
    return 2
  }
  const sub = rest[1]
  try {
    switch (sub) {
      case "show": {
        const p = readPolicy(ws)
        process.stdout.write(`workspace: ${ws}\n`)
        process.stdout.write(`egress:    ${p.egress}\n`)
        process.stdout.write(`features:  embedding=${p.features.embedding} mcpServer=${p.features.mcpServer} gitAutoPush=${p.features.gitAutoPush}\n`)
        process.stdout.write(`token TTL: ${p.defaultTokenTtlMs}ms\n`)
        process.stdout.write(`devices:   ${p.trustedDevices.length}\n`)
        process.stdout.write(`updatedAt: ${p.updatedAt}\n`)
        if (Object.keys(p.egressByDestination).length > 0) {
          process.stdout.write(`\ndestination overrides:\n`)
          for (const [k, v] of Object.entries(p.egressByDestination)) {
            process.stdout.write(`  - ${k}: ${v}\n`)
          }
        }
        return 0
      }
      case "set-egress": {
        const value = rest[2]
        if (value !== "allow" && value !== "deny") {
          process.stderr.write("policy set-egress: value must be 'allow' or 'deny'\n")
          return 2
        }
        const next = patchPolicy(ws, { egress: value })
        process.stdout.write(`egress: ${value}\n`)
        process.stdout.write(`updatedAt: ${next.updatedAt}\n`)
        return 0
      }
      case "set-feature": {
        const feature = rest[2]
        const value = rest[3]
        if (value !== "true" && value !== "false") {
          process.stderr.write("policy set-feature: value must be 'true' or 'false'\n")
          return 2
        }
        if (feature !== "embedding" && feature !== "mcpServer" && feature !== "gitAutoPush") {
          process.stderr.write("policy set-feature: feature must be 'embedding', 'mcpServer', or 'gitAutoPush'\n")
          return 2
        }
        const current = readPolicy(ws)
        const next = patchPolicy(ws, {
          features: { ...current.features, [feature]: value === "true" },
        })
        process.stdout.write(`${feature}: ${value}\n`)
        process.stdout.write(`updatedAt: ${next.updatedAt}\n`)
        return 0
      }
      default:
        process.stderr.write(`policy: unknown subcommand: ${sub ?? "(missing)"}\n`)
        return 2
    }
  } catch (e) {
    process.stderr.write(`policy error: ${(e as Error).message}\n`)
    return 1
  }
}

async function cmdMcpToken(rest: readonly string[]): Promise<number> {
  const sub = rest[0]
  // The token registry is process-local. In V1 it is recreated
  // per CLI invocation; tokens issued by one CLI call are not
  // visible from another. For an in-process smoke test, use
  // `mcp-token demo <workspace>` which issues, checks, revokes,
  // and re-checks in a single call.
  const reg = new McpTokenRegistry()
  try {
    switch (sub) {
      case "issue": {
        const ws = rest[1]
        if (!ws) {
          process.stderr.write("mcp-token issue: missing workspace\n")
          return 2
        }
        const flags = parseFlags(rest.slice(2))
        const ttlStr = flags.get("ttl")
        const ttlMs = ttlStr ? Number(ttlStr) : undefined
        const t = reg.issue({ workspace: ws, ttlMs: ttlMs && Number.isFinite(ttlMs) ? ttlMs : undefined })
        process.stdout.write(`issued ${t.id} for ${t.workspace} (expires=${t.expiresAt ?? "never"})\n`)
        process.stdout.write(`NOTE: token registry is process-local; not visible from another CLI call.\n`)
        return 0
      }
      case "demo": {
        const ws = rest[1]
        if (!ws) {
          process.stderr.write("mcp-token demo: missing workspace\n")
          return 2
        }
        const t = reg.issue({ workspace: ws, ttlMs: 60_000 })
        process.stdout.write(`issued   ${t.id}\n`)
        process.stdout.write(`check 1: ${reg.isValid(t.id) ? "valid" : "invalid"}\n`)
        reg.revoke(t.id)
        process.stdout.write(`revoked  ${t.id}\n`)
        process.stdout.write(`check 2: ${reg.isValid(t.id) ? "valid" : "invalid"}\n`)
        return 0
      }
      case "revoke": {
        const id = rest[1]
        if (!id) {
          process.stderr.write("mcp-token revoke: missing token id\n")
          return 2
        }
        reg.revoke(id)
        process.stdout.write(`revoked ${id}\n`)
        return 0
      }
      case "check": {
        const id = rest[1]
        if (!id) {
          process.stderr.write("mcp-token check: missing token id\n")
          return 2
        }
        const ok = reg.isValid(id)
        process.stdout.write(`${id}: ${ok ? "valid" : "invalid"}\n`)
        return ok ? 0 : 1
      }
      default:
        process.stderr.write(`mcp-token: unknown subcommand: ${sub ?? "(missing)"}\n`)
        return 2
    }
  } catch (e) {
    process.stderr.write(`mcp-token error: ${(e as Error).message}\n`)
    return 1
  }
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
    case "portable":
      return cmdPortable(rest)
    case "reachability":
      return cmdReachability(rest)
    case "mcp-token":
      return cmdMcpToken(rest)
    case "classify":
      return cmdClassify(rest)
    case "verify":
      return cmdVerify(rest)


async function cmdGc(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("gc: missing workspace path\n")
    return 2
  }
  const sub = rest[1]
  try {
    switch (sub) {
      case "recommend": {
        const r = recommendGc(ws)
        process.stdout.write(`vault:        ${r.workspaceRoot}\n`)
        process.stdout.write(`action:       ${r.action}\n`)
        process.stdout.write(`safe to apply: ${r.safeToApply}\n`)
        process.stdout.write(`orphans:      ${r.orphanAliases.length}\n`)
        process.stdout.write(`reachable:    ${r.reachableAliases.length}\n`)
        process.stdout.write(`missing:      ${r.missingSidecarLocators.length}\n`)
        if (r.orphanAliases.length > 0) {
          process.stdout.write(`\norphan aliases (Class B without Class A):\n`)
          for (const a of r.orphanAliases) process.stdout.write(`  - ${a}\n`)
        }
        if (r.missingSidecarLocators.length > 0) {
          process.stdout.write(`\nmissing sidecars (Class A without Class B):\n`)
          for (const m of r.missingSidecarLocators) process.stdout.write(`  - ${m}\n`)
        }
        return 0
      }
      case "apply": {
        const r = recommendGc(ws)
        if (!r.safeToApply) {
          process.stderr.write(`gc: not safe to apply (missing sidecars present); rebuild Class B first\n`)
          return 1
        }
        const after = applyGcRecommendation(ws, r)
        process.stdout.write(`applied. remaining entries: ${Object.keys(after.entries).length}\n`)
        return 0
      }
      default:
        process.stderr.write(`gc: unknown subcommand: ${sub ?? "(missing)"}\n`)
        return 2
    }
  } catch (e) {
    process.stderr.write(`gc error: ${(e as Error).message}\n`)
    return 1
  }
}
    case "policy":
      return cmdPolicy(rest)


async function cmdSimilarity(rest: readonly string[]): Promise<number> {
  const ws = rest[0]
  if (!ws) {
    process.stderr.write("similarity: missing workspace path\n")
    return 2
  }
  const flags = parseFlags(rest.slice(1))
  const topKStr = flags.get("topk")
  const topK = topKStr && Number.isFinite(Number(topKStr)) ? Number(topKStr) : 5
  try {
    const r = simulateSimilarity({ vaultRoot: ws, topK })
    process.stdout.write(`vault:    ${r.vaultRoot}\n`)
    process.stdout.write(`notes:    ${r.notes}\n`)
    process.stdout.write(`index:    ${r.indexMs}ms\n`)
    process.stdout.write(`query:    ${r.queryMs}ms\n`)
    process.stdout.write(`top pairs (${r.topPairs.length}):\n`)
    for (const p of r.topPairs) {
      process.stdout.write(`  - ${p.a} ~ ${p.b}  cosine=${p.cosine.toFixed(4)}\n`)
    }
    return 0
  } catch (e) {
    process.stderr.write(`similarity error: ${(e as Error).message}\n`)
    return 1
  }
}
    case "gc":
      return cmdGc(rest)
    case "similarity":
      return cmdSimilarity(rest)
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
