/* SPDX-License-Identifier: MIT */
/**
 * The vault's doctor and egress audit, through the owner's routes and a real vault.
 *
 * The doctor reports on the notes the owner may read, and never names a note the owner may not read. The
 * audit records the decisions the vault made, with a hash of what was considered and never its text.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { withInProcessServer, type InProcessServer } from "../lib/in-process-server"
import { tmpdir } from "../fixture/fixture"
import { resetMemoryCache } from "../../src/knowledge/app/memory"
import { DEFAULT_POLICY, writePolicy } from "../../src/knowledge/policy/store"
import { Flag } from "../../src/flag/flag"

const PASSWORD = "knowledge-diagnostics-pw"
const AUTH = "Basic " + Buffer.from("unifia:" + PASSWORD).toString("base64")
const LINKING_ID = "0190d2c0-7b00-7000-8000-00000000000a"
const PLAIN_ID = "0190d2c0-7b00-7000-8000-00000000000b"
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

interface Finding {
  category: string
  locator?: string
}

async function doctorFindings(project: string): Promise<Finding[]> {
  const response = await get("/knowledge/doctor", project)
  expect(response.status).toBe(200)
  return ((await response.json()) as { findings: Finding[] }).findings
}

describe("GET /knowledge/doctor", () => {
  test("reports nothing on a clean vault, and does not create one when there is none", async () => {
    await using project = await tmpdir({ git: true })
    const absent = await get("/knowledge/doctor", project.path)
    expect(await absent.json()).toMatchObject({ vault: "absent", findings: [] })
    expect(existsSync(vaultRoot(project.path))).toBe(false)

    seedVault(project.path, { plain: noteFile(PLAIN_ID, "A note with no link.") })
    expect(await doctorFindings(project.path)).toEqual([])
  })

  test("reports a link to a note that does not exist, on the note that holds it", async () => {
    await using project = await tmpdir({ git: true })
    seedVault(project.path, {
      linking: noteFile(LINKING_ID, LINKING_BODY),
      plain: noteFile(PLAIN_ID, "A note with no link."),
    })
    const findings = await doctorFindings(project.path)
    expect(findings).toContainEqual(expect.objectContaining({ category: "broken_wikilink", locator: "linking.md" }))
    expect(findings.some((finding) => finding.locator === "plain.md")).toBe(false)
  })

  test("a note the owner may not read is neither checked nor named in a finding", async () => {
    await using project = await tmpdir({ git: true })
    seedVault(project.path, { linking: noteFile(LINKING_ID, LINKING_BODY) })
    writePolicy(vaultRoot(project.path), {
      ...DEFAULT_POLICY,
      egressByDestination: { "provider:unifia-ui": "deny" },
      updatedAt: new Date().toISOString(),
    })
    const response = await get("/knowledge/doctor", project.path)
    const text = await response.text()
    expect(text).not.toContain("linking")
    expect(text).not.toContain(LINKING_ID)
    expect(JSON.parse(text)).toMatchObject({ vault: "present", scope: "visible", findings: [] })
  })
})

describe("GET /knowledge/audit", () => {
  test("an absent vault has no decisions, and none is recorded for it", async () => {
    await using project = await tmpdir({ git: true })
    const response = await get("/knowledge/audit", project.path)
    expect(await response.json()).toEqual({ vault: "absent", tally: { allow: 0, deny: 0 }, entries: [] })
    expect(existsSync(vaultRoot(project.path))).toBe(false)
  })

  test("the decisions carry a hash and a destination, and never the text of a note", async () => {
    await using project = await tmpdir({ git: true })
    const secret = "the body the audit must never carry"
    seedVault(project.path, { plain: noteFile(PLAIN_ID, secret) })
    // Retrieving the note through search is an egress decision for the owner's destination.
    expect((await get("/knowledge/search?q=carry", project.path)).status).toBe(200)

    const response = await get("/knowledge/audit", project.path)
    const text = await response.text()
    const body = JSON.parse(text) as { vault: string; tally: { allow: number; deny: number }; entries: Array<Record<string, unknown>> }
    expect(body.vault).toBe("present")
    // Without this, a read that recorded nothing would pass every check below.
    expect(body.entries.length).toBeGreaterThan(0)
    expect(body.entries.some((entry) => String(entry.destination).includes("unifia-ui"))).toBe(true)
    expect(body.tally.allow + body.tally.deny).toBe(body.entries.length)
    for (const entry of body.entries) {
      expect(typeof entry.hash).toBe("string")
      expect(typeof entry.destination).toBe("string")
    }
    expect(text).not.toContain(secret)
  })
})

describe("GET /knowledge/audit/verify", () => {
  test("an absent vault has no trail to verify, and none is created for it", async () => {
    await using project = await tmpdir({ git: true })
    const response = await get("/knowledge/audit/verify", project.path)
    expect(await response.json()).toEqual({ vault: "absent" })
    expect(existsSync(vaultRoot(project.path))).toBe(false)
  })

  test("the trail is reported read-only: its chain, its size, and no absolute path", async () => {
    await using project = await tmpdir({ git: true })
    seedVault(project.path, { plain: noteFile(PLAIN_ID, "the body the verifier must never carry") })
    expect((await get("/knowledge/search?q=carry", project.path)).status).toBe(200)
    // Flush the composition's buffer to the trail, as a request boundary does, so the verifier has something on disk.
    resetMemoryCache()

    const response = await get("/knowledge/audit/verify", project.path)
    const text = await response.text()
    const body = JSON.parse(text) as {
      vault: string
      trail: string
      pending: number
      report: { ok: boolean; chain: string; generationCount: number; bytes: number }
    }
    expect(body.vault).toBe("present")
    expect(body.trail).toBe("persisted")
    expect(body.pending).toBe(0)
    expect(body.report.ok).toBe(true)
    expect(body.report.chain).toBe("verified")
    expect(body.report.generationCount).toBeGreaterThanOrEqual(1)
    expect(body.report.bytes).toBeGreaterThan(0)
    expect(text).not.toContain(project.path)
  })
})

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
