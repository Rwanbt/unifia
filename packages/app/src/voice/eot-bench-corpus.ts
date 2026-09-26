/* SPDX-License-Identifier: MIT */
/**
 * Loader for the UNIFIA-EOT-BENCH corpus (ADR-061 / plan §19 / R4).
 *
 * The corpus is a deterministic JSON file shipped under
 * `packages/contracts/corpus/unifia-eot-bench.json`. The loader
 * validates structural invariants (all 5 languages × 17 scenarios
 * present, ids unique, language/scenario enumeration closed) and
 * exposes helpers for downstream benchmark runners.
 */

import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import {
  EOT_BENCH_FILE,
  EOT_BENCH_VERSION,
  EOT_LANGUAGES,
  EOT_SCENARIOS,
  type EotBenchCorpus,
  type EotFixture,
  type EotScenario,
  type SpeechLanguage,
} from "@unifia/contracts/voice-eot-bench"

/** Discriminated union returned by the loader. */
export type EotBenchLoadResult =
  | { ok: true; corpus: EotBenchCorpus; coverage: EotCoverage }
  | { ok: false; error: string }

/** Coverage report: how many fixtures per (language × scenario) cell. */
export interface EotCoverage {
  readonly totalFixtures: number
  readonly perLanguage: Readonly<Record<SpeechLanguage, number>>
  readonly perScenario: Readonly<Record<EotScenario, number>>
  /** Cells missing fixtures — empty array means full coverage. */
  readonly missing: readonly { language: SpeechLanguage; scenario: EotScenario }[]
}

/** Default location of the corpus file relative to the repo root.
 *  Resolved by walking up from `process.cwd()` until we find the
 *  `packages/contracts/corpus/unifia-eot-bench.json` marker, so the
 *  loader works whether the test runner is invoked from the repo
 *  root or from `packages/app`. */
export function resolveEotBenchPath(): string {
  let dir = process.cwd()
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, "packages/contracts/corpus", EOT_BENCH_FILE)
    try {
      // Existence check via fs.statSync — keeps the function sync so
      // it can be exported as a default constant at module top.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("node:fs") as typeof import("node:fs")
      fs.statSync(candidate)
      return candidate
    } catch {
      // not found at this level; climb one directory
      const parent = resolve(dir, "..")
      if (parent === dir) break
      dir = parent
    }
  }
  // Fallback to the original resolution — better than throwing at
  // import time so callers can still override via the function arg.
  return resolve(process.cwd(), "packages/contracts/corpus", EOT_BENCH_FILE)
}

/** Default location of the corpus file relative to the repo root. */
export const EOT_BENCH_PATH = resolveEotBenchPath()

/**
 * Load and validate the UNIFIA-EOT-BENCH corpus from disk.
 *
 * Validation rules:
 *  - `version` matches `EOT_BENCH_VERSION` (else the corpus file is stale
 *    and measurements against it cannot be reproduced).
 *  - `languages` and `scenarios` enumerations match the canonical sets
 *    exactly (order independent, set equality).
 *  - `fixtures` is non-empty.
 *  - Fixture ids are unique.
 *  - Each (language, scenario) cell has at least one fixture.
 */
export async function loadEotBench(corpusPath: string = EOT_BENCH_PATH): Promise<EotBenchLoadResult> {
  let raw: string
  try {
    raw = await readFile(corpusPath, "utf8")
  } catch (error) {
    return {
      ok: false,
      error: `Failed to read corpus file at ${corpusPath}: ${(error as Error).message}`,
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return {
      ok: false,
      error: `Corpus file is not valid JSON: ${(error as Error).message}`,
    }
  }
  const validation = validateEotBenchCorpus(parsed)
  if (!validation.ok) {
    return { ok: false, error: validation.error }
  }
  const corpus = validation.corpus
  return {
    ok: true,
    corpus,
    coverage: computeCoverage(corpus),
  }
}

/** Synchronous validator — exposed for unit tests and for callers
 *  that already have the corpus content in memory. */
export function validateEotBenchCorpus(value: unknown):
  | { ok: true; corpus: EotBenchCorpus }
  | { ok: false; error: string } {
  if (typeof value !== "object" || value === null) {
    return { ok: false, error: "Corpus root must be an object" }
  }
  const root = value as Record<string, unknown>
  if (typeof root.version !== "string") {
    return { ok: false, error: "Corpus missing string `version`" }
  }
  if (root.version !== EOT_BENCH_VERSION) {
    return {
      ok: false,
      error: `Corpus version mismatch: expected ${EOT_BENCH_VERSION}, got ${String(root.version)}`,
    }
  }
  if (typeof root.description !== "string") {
    return { ok: false, error: "Corpus missing string `description`" }
  }
  if (!Array.isArray(root.languages)) {
    return { ok: false, error: "Corpus `languages` must be an array" }
  }
  if (!Array.isArray(root.scenarios)) {
    return { ok: false, error: "Corpus `scenarios` must be an array" }
  }
  if (!Array.isArray(root.fixtures)) {
    return { ok: false, error: "Corpus `fixtures` must be an array" }
  }
  const langSet = new Set(root.languages as unknown[])
  const canonSet = new Set<SpeechLanguage>(EOT_LANGUAGES)
  if (langSet.size !== canonSet.size || ![...langSet].every((l) => canonSet.has(l as SpeechLanguage))) {
    return {
      ok: false,
      error: `Corpus languages must equal EOT_LANGUAGES (${EOT_LANGUAGES.join(",")}); got ${[...langSet].join(",")}`,
    }
  }
  const scenSet = new Set(root.scenarios as unknown[])
  const canonScenSet = new Set<EotScenario>(EOT_SCENARIOS)
  if (scenSet.size !== canonScenSet.size || ![...scenSet].every((s) => canonScenSet.has(s as EotScenario))) {
    return {
      ok: false,
      error: `Corpus scenarios must equal EOT_SCENARIOS; got ${[...scenSet].join(",")}`,
    }
  }
  const fixtures = root.fixtures as unknown[]
  if (fixtures.length === 0) {
    return { ok: false, error: "Corpus `fixtures` is empty" }
  }
  const seenIds = new Set<string>()
  const seenCells = new Set<string>()
  const typedFixtures: EotFixture[] = []
  for (const item of fixtures) {
    if (typeof item !== "object" || item === null) {
      return { ok: false, error: "Each fixture must be an object" }
    }
    const f = item as Record<string, unknown>
    if (typeof f.id !== "string" || !f.id.trim()) {
      return { ok: false, error: "Each fixture needs a non-empty string `id`" }
    }
    if (seenIds.has(f.id)) {
      return { ok: false, error: `Duplicate fixture id: ${f.id}` }
    }
    seenIds.add(f.id)
    if (typeof f.language !== "string" || !canonSet.has(f.language as SpeechLanguage)) {
      return { ok: false, error: `Fixture ${f.id} has invalid language: ${String(f.language)}` }
    }
    if (typeof f.scenario !== "string" || !canonScenSet.has(f.scenario as EotScenario)) {
      return { ok: false, error: `Fixture ${f.id} has invalid scenario: ${String(f.scenario)}` }
    }
    if (typeof f.transcript !== "string") {
      return { ok: false, error: `Fixture ${f.id} missing string \`transcript\`` }
    }
    if (typeof f.expectedTurnComplete !== "boolean") {
      return { ok: false, error: `Fixture ${f.id} missing boolean \`expectedTurnComplete\`` }
    }
    if (f.expectedDurationMs !== undefined && typeof f.expectedDurationMs !== "number") {
      return { ok: false, error: `Fixture ${f.id} has non-numeric expectedDurationMs` }
    }
    const cell = `${f.language}|${f.scenario}`
    seenCells.add(cell)
    typedFixtures.push({
      id: f.id,
      language: f.language as SpeechLanguage,
      scenario: f.scenario as EotScenario,
      transcript: f.transcript,
      expectedTurnComplete: f.expectedTurnComplete,
      expectedDurationMs:
        typeof f.expectedDurationMs === "number" ? f.expectedDurationMs : undefined,
      notes: typeof f.notes === "string" ? f.notes : undefined,
    })
  }
  const missing: { language: SpeechLanguage; scenario: EotScenario }[] = []
  for (const language of EOT_LANGUAGES) {
    for (const scenario of EOT_SCENARIOS) {
      if (!seenCells.has(`${language}|${scenario}`)) {
        missing.push({ language, scenario })
      }
    }
  }
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Corpus missing ${missing.length} (language, scenario) cells: ${missing
        .map((m) => `${m.language}/${m.scenario}`)
        .join(", ")}`,
    }
  }
  const corpus: EotBenchCorpus = {
    version: EOT_BENCH_VERSION,
    description: root.description,
    languages: [...EOT_LANGUAGES],
    scenarios: [...EOT_SCENARIOS],
    fixtures: typedFixtures,
  }
  return { ok: true, corpus }
}

/** Aggregate coverage statistics from a validated corpus. */
export function computeCoverage(corpus: EotBenchCorpus): EotCoverage {
  const perLanguage: Record<SpeechLanguage, number> = {
    en: 0,
    fr: 0,
    es: 0,
    it: 0,
    de: 0,
  }
  const perScenario: Record<EotScenario, number> = {
    "short-statement": 0,
    "question": 0,
    "long-sentence": 0,
    "pause": 0,
    "hesitation": 0,
    "filler": 0,
    "false-ending": 0,
    "conjunction-continuation": 0,
    "enumeration": 0,
    "correction": 0,
    "incomplete-utterance": 0,
    "background-noise": 0,
    "speech-over-assistant": 0,
    "whisper": 0,
    "clipping": 0,
    "rapid-interruption": 0,
    "multilingual-switch": 0,
  }
  for (const fixture of corpus.fixtures) {
    perLanguage[fixture.language] += 1
    perScenario[fixture.scenario] += 1
  }
  return {
    totalFixtures: corpus.fixtures.length,
    perLanguage,
    perScenario,
    missing: [],
  }
}

/** Filter helpers — used by the bench runner for per-language /
 *  per-scenario sub-runs. */
export function fixturesByLanguage(corpus: EotBenchCorpus, language: SpeechLanguage): EotFixture[] {
  return corpus.fixtures.filter((f) => f.language === language)
}

export function fixturesByScenario(corpus: EotBenchCorpus, scenario: EotScenario): EotFixture[] {
  return corpus.fixtures.filter((f) => f.scenario === scenario)
}
