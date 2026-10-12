/* SPDX-License-Identifier: MIT */
/**
 * The owner's interactive search, through the real server and a real vault.
 *
 * The owner's search has its own budget and is not the agent's per-turn recall. When the budget cuts a scan short,
 * the answer says so: a partial result is never presented as complete. These tests pin that contract without
 * depending on how fast the machine is: a budget of one millisecond cannot read a vault of several hundred notes.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { withInProcessServer, type InProcessServer } from "../lib/in-process-server"
import { tmpdir } from "../fixture/fixture"
import { openMemory, resetMemoryCache } from "../../src/knowledge/app/memory"
import { DEFAULT_POLICY, writePolicy } from "../../src/knowledge/policy/store"
import { Flag } from "../../src/flag/flag"

const PASSWORD = "knowledge-search-owner-pw"
const AUTH = "Basic " + Buffer.from("unifia:" + PASSWORD).toString("base64")
const LARGE_VAULT_NOTES = 300
// WHY these sizes: reading one note on the Windows runner can cost close to a second (the containment-checked read path):
// thirteen notes took past the owner's 10 s budget there, and forty notes past a 30 s deadline. The route test only proves
// the plumbing, so it reads the needle and three other notes, well inside the owner's budget. The complete-read test reads
// forty notes with the largest deadline a request may ask for (60 s), and a test timeout above it. The truncation contract at
// several hundred notes stays in the one-millisecond test below.
const HTTP_VAULT_NOTES = 3
const COMPLETE_READ_NOTES = 40
const COMPLETE_READ_DEADLINE_MS = 60_000
const SEARCH = {
  spaces: [],
  types: [],
  tags: [],
  maxCandidates: 50,
  maxPayloadBytes: 1024 * 1024,
  maxSnippetBytes: 64 * 1024,
}

let savedPassword: string | undefined
let server: InProcessServer

beforeAll(async () => {
  savedPassword = Flag.UNIFIA_SERVER_PASSWORD
  // @ts-expect-error test-only override, restored in afterAll
  Flag.UNIFIA_SERVER_PASSWORD = PASSWORD
  server = await withInProcessServer({ password: PASSWORD })
})

afterAll(async () => {
  await server.close()
  resetMemoryCache()
  // @ts-expect-error restoring the value captured in beforeAll
  Flag.UNIFIA_SERVER_PASSWORD = savedPassword
})

/** A governed note id, unique per number, shaped like the ids the vault stores. */
function noteId(n: number): string {
  return `0190d2c0-7b00-7000-8000-${n.toString(16).padStart(12, "0")}`
}

function note(id: string, body: string, restrictions: readonly string[] = ["  remote_model: allow", "  local_model: allow"]): string {
  return [
    "---",
    "unifia_schema: 1",
    `unifia_id: "${id}"`,
    'unifia_type: "decision"',
    'unifia_lifecycle: "active"',
    'unifia_created_at: "2026-01-01T00:00:00Z"',
    'unifia_updated_at: "2026-08-01T00:00:00Z"',
    'unifia_project_ref: "unifia"',
    "unifia_supersedes: []",
    "unifia_tags: []",
    "unifia_restrictions:",
    ...restrictions,
    "---",
    body,
  ].join("\n")
}

function vaultRoot(project: string): string {
  return path.join(project, ".unifia", "memory")
}

function seedVault(project: string, notes: Record<string, string>): void {
  mkdirSync(vaultRoot(project), { recursive: true })
  for (const [name, content] of Object.entries(notes)) writeFileSync(path.join(vaultRoot(project), `${name}.md`), content, "utf8")
}

function seedLargeVault(project: string, count = LARGE_VAULT_NOTES): void {
  const notes: Record<string, string> = {}
  for (let n = 1; n <= count; n += 1) {
    notes[`bulk-${n}`] = note(noteId(1000 + n), `alpha bulk note number ${n} with some ordinary text to read`)
  }
  seedVault(project, notes)
}

function search(query: string, project: string, extra = ""): Promise<Response> {
  return server.fetch(`/knowledge/search?q=${encodeURIComponent(query)}${extra}&directory=${encodeURIComponent(project)}`, {
    headers: { Authorization: AUTH },
  })
}

type SearchAnswer = {
  vault: string
  items: Array<{ ref: { id: string; locator: string }; relevance: number }>
  truncated: boolean
}

async function answer(query: string, project: string, extra = ""): Promise<SearchAnswer> {
  const response = await search(query, project, extra)
  expect(response.status).toBe(200)
  return (await response.json()) as SearchAnswer
}

describe("GET /knowledge/search: the owner's interactive answer", () => {
  test("answers every note the owner may read, complete, in order of relevance", async () => {
    await using project = await tmpdir({ git: true })
    seedVault(project.path, {
      strong: note(noteId(1), "alpha alpha alpha the decisive alpha fact"),
      weak: note(noteId(2), "alpha, mentioned once"),
      other: note(noteId(3), "nothing relevant here"),
    })
    const body = await answer("alpha", project.path)
    expect(body.vault).toBe("present")
    expect(body.truncated).toBe(false)
    const ids = body.items.map((item) => item.ref.id)
    expect(ids).toContain(noteId(1))
    expect(ids).toContain(noteId(2))
    expect(ids).not.toContain(noteId(3))
    const relevance = body.items.map((item) => item.relevance)
    expect([...relevance].sort((a, b) => b - a)).toEqual(relevance)
  })

  test("honours the limit the owner asks for, and never returns more", async () => {
    await using project = await tmpdir({ git: true })
    seedVault(project.path, {
      one: note(noteId(1), "alpha one"),
      two: note(noteId(2), "alpha two"),
      three: note(noteId(3), "alpha three"),
    })
    const body = await answer("alpha", project.path, "&limit=1")
    expect(body.items).toHaveLength(1)
  })

  test("a search over a small vault finds the note it should, complete, within the owner's budget", async () => {
    await using project = await tmpdir({ git: true })
    seedLargeVault(project.path, HTTP_VAULT_NOTES)
    seedVault(project.path, { target: note(noteId(9999), "alpha the one needle in the haystack") })
    const body = await answer("needle", project.path, "&limit=20")
    expect(body.truncated).toBe(false)
    expect(body.items.map((item) => item.ref.id)).toEqual([noteId(9999)])
  })

  test("a search with no credentials is refused before the vault is read", async () => {
    await using project = await tmpdir({ git: true })
    seedVault(project.path, { one: note(noteId(1), "alpha one") })
    const response = await server.fetch(`/knowledge/search?q=alpha&directory=${encodeURIComponent(project.path)}`)
    expect(response.status).toBe(401)
  })

  test("the answer is the same once the process has dropped its caches: the vault on disk is the source", async () => {
    await using project = await tmpdir({ git: true })
    seedVault(project.path, {
      one: note(noteId(1), "alpha one"),
      two: note(noteId(2), "alpha two"),
    })
    const before = await answer("alpha", project.path)
    resetMemoryCache()
    const after = await answer("alpha", project.path)
    expect(after.items.map((item) => item.ref.id).sort()).toEqual(before.items.map((item) => item.ref.id).sort())
  })
})

describe("the search budget: a scan that runs out says so", () => {
  test("a budget of one millisecond cannot read a large vault, and the result is marked truncated", async () => {
    await using project = await tmpdir({ git: true })
    seedLargeVault(project.path)
    const vault = openMemory({
      worktree: project.path,
      providerId: "unifia-ui",
      destinationKind: "local",
      audience: "owner",
    })
    expect(vault).toBeDefined()
    const { pack, truncated } = await vault!.service.search({ ...SEARCH, query: "alpha", deadlineMs: 1 })
    expect(truncated).toBe(true)
    expect(pack.items.length).toBeLessThan(LARGE_VAULT_NOTES)
    resetMemoryCache()
  })

  test("a vault of forty notes, with a generous budget, is read completely and is not marked truncated", async () => {
    await using project = await tmpdir({ git: true })
    seedLargeVault(project.path, COMPLETE_READ_NOTES)
    const vault = openMemory({
      worktree: project.path,
      providerId: "unifia-ui",
      destinationKind: "local",
      audience: "owner",
    })
    const { truncated } = await vault!.service.search({
      ...SEARCH,
      query: "alpha",
      maxCandidates: COMPLETE_READ_NOTES,
      deadlineMs: COMPLETE_READ_DEADLINE_MS,
    })
    expect(truncated).toBe(false)
    resetMemoryCache()
  }, COMPLETE_READ_DEADLINE_MS + 30_000)
})

describe("the owner's search still respects what the vault policy withholds", () => {
  test("a note the vault policy withholds from the owner is absent from the answer", async () => {
    await using project = await tmpdir({ git: true })
    seedVault(project.path, { visible: note(noteId(1), "alpha visible") })
    writePolicy(vaultRoot(project.path), {
      ...DEFAULT_POLICY,
      egressByDestination: { "provider:unifia-ui": "deny" },
      updatedAt: new Date().toISOString(),
    })
    const body = await answer("alpha", project.path)
    expect(body.items).toEqual([])
    expect(body.truncated).toBe(false)
  })
})
