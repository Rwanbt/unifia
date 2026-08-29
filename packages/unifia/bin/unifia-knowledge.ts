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
