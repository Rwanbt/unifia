/* SPDX-License-Identifier: MIT */
/**
 * The Memory panel's requests, replayed against the real server and a real vault on disk.
 *
 * The panel reads the tree, reads a note, saves an edit conditional on the version it read, and proposes
 * moves, copies and deletes. Each test runs that sequence through the router and checks what the vault now
 * holds, so the panel's behaviour is pinned at the boundary it actually crosses. A restart is simulated by
 * stopping the server and clearing the memory cache: what survives it is what is on disk.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { withInProcessServer, type InProcessServer } from "../lib/in-process-server"
import { tmpdir } from "../fixture/fixture"
import { resetMemoryCache } from "../../src/knowledge/app/memory"
import { DEFAULT_POLICY, writePolicy } from "../../src/knowledge/policy/store"
import { Flag } from "../../src/flag/flag"

const PASSWORD = "knowledge-panel-flow-pw"
const AUTH = "Basic " + Buffer.from("unifia:" + PASSWORD).toString("base64")
const SEED_ID = "0190d2c0-7b00-7000-8000-00000000000a"
const SEED_BODY = "# Plan\n\nThe first draft."
const REMOTE_DENY = { remoteModel: "deny", localModel: "allow", embeddable: "allow", exportable: "deny" }

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

function vaultRoot(project: string): string {
  return path.join(project, ".unifia", "memory")
}

/** A seeded note, as the vault stores it: frontmatter the vault reads, then the body. */
function seededNote(body: string): string {
  return [
    "---",
    "unifia_schema: 1",
    `unifia_id: "${SEED_ID}"`,
    'unifia_type: "decision"',
    'unifia_lifecycle: "active"',
    'unifia_created_at: "2026-01-01T00:00:00Z"',
    'unifia_updated_at: "2026-08-01T00:00:00Z"',
    'unifia_project_ref: "unifia"',
    "unifia_supersedes: []",
    "unifia_tags: []",
    "unifia_restrictions:",
    "  remote_model: deny",
    "  local_model: allow",
    "---",
    body,
  ].join("\n")
}

function seedVault(project: string): void {
  mkdirSync(vaultRoot(project), { recursive: true })
  writeFileSync(path.join(vaultRoot(project), "plan.md"), seededNote(SEED_BODY), "utf8")
}

function get(route: string, project: string): Promise<Response> {
  const sep = route.includes("?") ? "&" : "?"
  return server.fetch(`${route}${sep}directory=${encodeURIComponent(project)}`, { headers: { Authorization: AUTH } })
}

function propose(project: string, intent: unknown): Promise<Response> {
  return server.fetch(`/knowledge/propose?directory=${encodeURIComponent(project)}`, {
    method: "POST",
    headers: { Authorization: AUTH, "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "panel flow test", intent }),
  })
}

interface TreeNote {
  id: string
  locator: string
}

async function treeLocators(project: string): Promise<string[]> {
  const body = (await (await get("/knowledge/tree", project)).json()) as { notes: TreeNote[] }
  return body.notes.map((note) => note.locator).sort()
}

interface NoteRead {
  id: string
  locator: string
  type: string
  restrictions: { remoteModel: string; localModel: string; embeddable: string; exportable: string }
  body: string
  versionHash: string
}

async function readNote(project: string, locator: string): Promise<NoteRead> {
  const response = await get(`/knowledge/note?locator=${encodeURIComponent(locator)}`, project)
  expect(response.status).toBe(200)
  return (await response.json()) as NoteRead
}

describe("create, read and edit", () => {
  test("a new note is written inside the vault, unclassified, and reads back with its body", async () => {
    await using project = await tmpdir({ git: true })
    const created = await propose(project.path, {
      kind: "create",
      targetLocator: "Nouvelle note.md",
      newContent: { type: "reference", restrictions: REMOTE_DENY, body: "# Nouvelle note\n\n" },
    })
    expect(created.status).toBe(200)
    expect(await treeLocators(project.path)).toEqual(["Nouvelle note.md"])
    const read = await readNote(project.path, "Nouvelle note.md")
    expect(read.body.trimEnd()).toBe("# Nouvelle note")
    expect(read.restrictions).toMatchObject(REMOTE_DENY)
  })

  test("an edit conditional on the version read is saved, and the next save must present the new version", async () => {
    await using project = await tmpdir({ git: true })
    seedVault(project.path)
    const first = await readNote(project.path, "plan.md")
    const saved = await propose(project.path, {
      kind: "update",
      targetId: first.id,
      expectedVersionHash: first.versionHash,
      newContent: { type: first.type, restrictions: first.restrictions, body: "# Plan\n\nThe second draft." },
    })
    expect(saved.status).toBe(200)

    const second = await readNote(project.path, "plan.md")
    // The vault stores the body with one line ending: the panel adopts that text (see memory-panel.tsx).
    expect(second.body).toBe("# Plan\n\nThe second draft.\n")
    expect(second.versionHash).not.toBe(first.versionHash)
    // The type and restrictions the panel sent back are the note's own: an edit cannot widen them.
    expect(second.restrictions).toMatchObject({ remoteModel: "deny" })
  })

  test("a save made from a stale version is refused as a conflict, and the newer edit stays", async () => {
    await using project = await tmpdir({ git: true })
    seedVault(project.path)
    const stale = await readNote(project.path, "plan.md")
    // Another writer (the agent, or another window) saves first.
    const winner = await propose(project.path, {
      kind: "update",
      targetId: stale.id,
      expectedVersionHash: stale.versionHash,
      newContent: { type: stale.type, restrictions: stale.restrictions, body: "# Plan\n\nWritten first." },
    })
    expect(winner.status).toBe(200)

    const loser = await propose(project.path, {
      kind: "update",
      targetId: stale.id,
      expectedVersionHash: stale.versionHash,
      newContent: { type: stale.type, restrictions: stale.restrictions, body: "# Plan\n\nWritten second." },
    })
    expect(loser.status).toBe(409)
    expect((await readNote(project.path, "plan.md")).body.trimEnd()).toBe("# Plan\n\nWritten first.")
  })
})

describe("move, copy and delete", () => {
  test("a move under a new name relocates the note and keeps its identity", async () => {
    await using project = await tmpdir({ git: true })
    seedVault(project.path)
    const note = await readNote(project.path, "plan.md")
    const moved = await propose(project.path, {
      kind: "move",
      targetId: note.id,
      expectedVersionHash: note.versionHash,
      targetLocator: "Plan renamed.md",
    })
    expect(moved.status).toBe(200)
    expect(await treeLocators(project.path)).toEqual(["Plan renamed.md"])
    expect((await readNote(project.path, "Plan renamed.md")).id).toBe(SEED_ID)
  })

  test("a move from a stale version is refused, and the note stays where it was", async () => {
    await using project = await tmpdir({ git: true })
    seedVault(project.path)
    const moved = await propose(project.path, {
      kind: "move",
      targetId: SEED_ID,
      expectedVersionHash: "0".repeat(64),
      targetLocator: "elsewhere.md",
    })
    // A move has no conflict answer of its own: its version check shares the answer of a locator collision, so it is generic.
    expect(moved.status).toBe(422)
    expect(await moved.text()).not.toContain("cas_mismatch")
    expect(await treeLocators(project.path)).toEqual(["plan.md"])
  })

  test("a create over a locator the owner cannot read answers as any refusal, and reveals nothing", async () => {
    await using project = await tmpdir({ git: true })
    seedVault(project.path)
    writePolicy(vaultRoot(project.path), {
      ...DEFAULT_POLICY,
      egressByDestination: { "provider:unifia-ui": "deny" },
      updatedAt: new Date().toISOString(),
    })
    // plan.md exists on disk, but the owner cannot read it: the create must not say so.
    const created = await propose(project.path, {
      kind: "create",
      targetLocator: "plan.md",
      newContent: { type: "reference", restrictions: REMOTE_DENY, body: "over the withheld note" },
    })
    expect(created.status).toBe(422)
    expect(await created.json()).toEqual({ error: "proposal refused" })
    expect(readFileSync(path.join(vaultRoot(project.path), "plan.md"), "utf8")).toContain("The first draft.")
  })

  test("a copy keeps its source's restrictions, so it is never more open than the note", async () => {
    await using project = await tmpdir({ git: true })
    seedVault(project.path)
    const source = await readNote(project.path, "plan.md")
    const copied = await propose(project.path, {
      kind: "create",
      targetLocator: "plan copy.md",
      newContent: { type: source.type, restrictions: source.restrictions, body: source.body },
    })
    expect(copied.status).toBe(200)
    const copy = await readNote(project.path, "plan copy.md")
    expect(copy.restrictions).toMatchObject({ remoteModel: "deny" })
    expect(copy.body.trimEnd()).toBe(SEED_BODY)
  })

  test("a delete from the current version removes the note from the tree and from reads", async () => {
    await using project = await tmpdir({ git: true })
    seedVault(project.path)
    const note = await readNote(project.path, "plan.md")
    const deleted = await propose(project.path, { kind: "delete", targetId: note.id, expectedVersionHash: note.versionHash })
    expect(deleted.status).toBe(200)
    expect(await treeLocators(project.path)).toEqual([])
    expect((await get("/knowledge/note?locator=plan.md", project.path)).status).toBe(404)
    expect(existsSync(path.join(vaultRoot(project.path), "plan.md"))).toBe(false)
  })
})

describe("the vault policy holds for the panel's writes too", () => {
  test("a note the policy withholds from the owner is neither read, edited, moved nor deleted", async () => {
    await using project = await tmpdir({ git: true })
    seedVault(project.path)
    const before = readFileSync(path.join(vaultRoot(project.path), "plan.md"), "utf8")
    writePolicy(vaultRoot(project.path), {
      ...DEFAULT_POLICY,
      egressByDestination: { "provider:unifia-ui": "deny" },
      updatedAt: new Date().toISOString(),
    })
    // The owner read a note before the policy changed; each write now answers as for a missing note.
    expect((await get("/knowledge/note?locator=plan.md", project.path)).status).toBe(404)
    expect(await treeLocators(project.path)).toEqual([])
    const edit = await propose(project.path, {
      kind: "update",
      targetId: SEED_ID,
      expectedVersionHash: "a".repeat(64),
      newContent: { type: "decision", restrictions: REMOTE_DENY, body: "edited behind the policy" },
    })
    expect(edit.status).toBe(404)
    const move = await propose(project.path, { kind: "move", targetId: SEED_ID, expectedVersionHash: "a".repeat(64), targetLocator: "x.md" })
    expect(move.status).toBe(404)
    expect(readFileSync(path.join(vaultRoot(project.path), "plan.md"), "utf8")).toBe(before)
  })
})

describe("persistence across a restart", () => {
  test("an edit saved before the server stops is read back after it starts again", async () => {
    await using project = await tmpdir({ git: true })
    seedVault(project.path)
    const note = await readNote(project.path, "plan.md")
    const saved = await propose(project.path, {
      kind: "update",
      targetId: note.id,
      expectedVersionHash: note.versionHash,
      newContent: { type: note.type, restrictions: note.restrictions, body: "# Plan\n\nKept across a restart." },
    })
    expect(saved.status).toBe(200)

    await server.close()
    resetMemoryCache()
    server = await withInProcessServer({ password: PASSWORD })

    const afterRestart = await readNote(project.path, "plan.md")
    expect(afterRestart.body.trimEnd()).toBe("# Plan\n\nKept across a restart.")
    expect(afterRestart.id).toBe(SEED_ID)
  })
})
