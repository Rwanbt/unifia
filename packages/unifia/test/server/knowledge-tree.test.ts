/* SPDX-License-Identifier: MIT */
/**
 * The vault's tree, through the owner's route and a real vault.
 *
 * The tree lists the notes the owner may read, and names the Markdown files that are not governed notes,
 * without any part of their text. A note the owner may not read is named nowhere.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { withInProcessServer, type InProcessServer } from "../lib/in-process-server"
import { tmpdir } from "../fixture/fixture"
import { resetMemoryCache } from "../../src/knowledge/app/memory"
import { DEFAULT_POLICY, writePolicy } from "../../src/knowledge/policy/store"
import { Flag } from "../../src/flag/flag"

const PASSWORD = "knowledge-tree-pw"
const AUTH = "Basic " + Buffer.from("unifia:" + PASSWORD).toString("base64")
const LINKING_ID = "0190d2c0-7b00-7000-8000-00000000000a"
const LINKING_BODY = "Look at [[Missing note]] before deciding."

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

function noteFile(id: string, body: string): string {
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
    "  remote_model: allow",
    "  local_model: allow",
    "---",
    body,
  ].join("\n")
}

function seedVault(project: string, notes: Record<string, string>): void {
  mkdirSync(vaultRoot(project), { recursive: true })
  for (const [name, content] of Object.entries(notes)) writeFileSync(path.join(vaultRoot(project), `${name}.md`), content, "utf8")
}

function get(route: string, project: string): Promise<Response> {
  const sep = route.includes("?") ? "&" : "?"
  return server.fetch(`${route}${sep}directory=${encodeURIComponent(project)}`, { headers: { Authorization: AUTH } })
}

describe("GET /knowledge/tree names the files that are not governed notes", () => {
  test("a hand-written note without governance metadata is named, with no part of its text", async () => {
    await using project = await tmpdir({ git: true })
    const handWritten = "# Written by hand\n\nA sentence that must never reach the tree answer."
    seedVault(project.path, {
      "hand-written": handWritten,
      linking: noteFile(LINKING_ID, LINKING_BODY),
    })
    const response = await get("/knowledge/tree", project.path)
    const text = await response.text()
    const body = JSON.parse(text) as { notes: Array<{ locator: string }>; unmanaged: Array<{ locator: string; reason: string }> }
    expect(body.unmanaged).toEqual([{ locator: "hand-written.md", reason: "not a governed note" }])
    expect(body.notes.map((note) => note.locator)).toEqual(["linking.md"])
    expect(text).not.toContain("A sentence that must never reach")
  })

  test("a governed note the owner may not read is not named as unmanaged", async () => {
    await using project = await tmpdir({ git: true })
    seedVault(project.path, { linking: noteFile(LINKING_ID, LINKING_BODY) })
    writePolicy(vaultRoot(project.path), {
      ...DEFAULT_POLICY,
      egressByDestination: { "provider:unifia-ui": "deny" },
      updatedAt: new Date().toISOString(),
    })
    const body = (await (await get("/knowledge/tree", project.path)).json()) as { unmanaged: unknown[]; notes: unknown[] }
    expect(body.notes).toEqual([])
    expect(body.unmanaged).toEqual([])
  })
})
