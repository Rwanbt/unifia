/* SPDX-License-Identifier: MIT */
/**
 * Read-only knowledge routes (Sovereign Knowledge, slice 1).
 *
 * These hit the real server through the real router, so what is pinned is
 * what a client receives: the status codes, the refusals, and the fact that
 * a withheld note answers exactly like a missing one. Each project gets its
 * own temporary repository, so the isolation between projects is tested with
 * real directories rather than with mocks.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs"
import path from "node:path"
import { withInProcessServer, type InProcessServer } from "../lib/in-process-server"
import { tmpdir } from "../fixture/fixture"
import { resetMemoryCache } from "../../src/knowledge/app/memory"
import { CONTROL_LOG_FILE } from "../../src/knowledge/policy/control-log"
import { Flag } from "../../src/flag/flag"
import { KnowledgeRoutes, parseNoteId } from "../../src/server/routes/knowledge"

const PASSWORD = "knowledge-routes-test-pw"
const AUTH = "Basic " + Buffer.from("opencode:" + PASSWORD).toString("base64")

const VISIBLE_ID = "0190d2c0-7b00-7000-8000-00000000000a"
const WITHHELD_ID = "0190d2c0-7b00-7000-8000-00000000000b"
const TARGET_ID = "0190d2c0-7b00-7000-8000-00000000000c"
const LINKING_ID = "0190d2c0-7b00-7000-8000-00000000000d"
const OTHER_PROJECT_ID = "0190d2c0-7b00-7000-8000-0000000000ff"

const VISIBLE_BODY = "alpha the decisive fact"
const WITHHELD_BODY = "alpha the withheld secret"

let server: InProcessServer

beforeAll(async () => {
  server = await withInProcessServer({ password: PASSWORD })
})

afterAll(async () => {
  await server.close()
  resetMemoryCache()
})

/** A note with the frontmatter the vault reads. Restrictions default to local-allow. */
function note(input: { id: string; body: string; restrictions?: readonly string[] }): string {
  return [
    "---",
    "unifia_schema: 1",
    `unifia_id: "${input.id}"`,
    'unifia_type: "decision"',
    'unifia_lifecycle: "active"',
    'unifia_created_at: "2026-01-01T00:00:00Z"',
    'unifia_updated_at: "2026-08-01T00:00:00Z"',
    'unifia_project_ref: "unifia"',
    "unifia_supersedes: []",
    "unifia_tags: []",
    "unifia_restrictions:",
    ...(input.restrictions ?? ["  remote_model: allow", "  local_model: allow"]),
    "---",
    input.body,
  ].join("\n")
}

/** Write notes into a project's memory vault, creating it. */
function seedVault(project: string, notes: Record<string, string>): void {
  const root = path.join(project, ".unifia", "memory")
  mkdirSync(root, { recursive: true })
  for (const [name, content] of Object.entries(notes)) {
    writeFileSync(path.join(root, `${name}.md`), content, "utf8")
  }
}

/** Every file under the vault, with its bytes, so a test can prove nothing changed. */
function snapshotVault(project: string): Record<string, string> {
  const root = path.join(project, ".unifia", "memory")
  const out: Record<string, string> = {}
  if (!existsSync(root)) return out
  for (const entry of readdirSync(root, { recursive: true })) {
    const rel = String(entry)
    const full = path.join(root, rel)
    // Keys use "/" on every platform, so they can be compared with CONTROL_LOG_FILE.
    if (statSync(full).isFile()) out[rel.split(path.sep).join("/")] = readFileSync(full, "utf8")
  }
  return out
}

function get(route: string, project: string) {
  const sep = route.includes("?") ? "&" : "?"
  return server.fetch(`${route}${sep}directory=${encodeURIComponent(project)}`, {
    headers: { Authorization: AUTH },
  })
}

describe("parseNoteId", () => {
  test("accepts a UUID and refuses anything that could address a path", () => {
    expect(parseNoteId(VISIBLE_ID)).toBe(VISIBLE_ID)
    for (const bad of ["", ".", "..", "../x", "a/b", "a\\b", ".hidden", "-flag", "a b", "x".repeat(129)]) {
      expect(parseNoteId(bad)).toBeNull()
    }
  })
})

describe("GET /knowledge/status", () => {
  test("reports an absent vault and does not create one", async () => {
    await using project = await tmpdir({ git: true })
    const response = await get("/knowledge/status", project.path)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ enabled: true, vault: "absent" })
    expect(existsSync(path.join(project.path, ".unifia", "memory"))).toBe(false)
  })
})

describe("GET /knowledge/search", () => {
  test("returns the notes the local interface may read, and withholds the rest without naming them", async () => {
    await using project = await tmpdir({ git: true })
    seedVault(project.path, {
      visible: note({ id: VISIBLE_ID, body: VISIBLE_BODY }),
      withheld: note({
        id: WITHHELD_ID,
        body: WITHHELD_BODY,
        restrictions: ["  remote_model: allow", "  local_model: deny"],
      }),
    })
    const response = await get("/knowledge/search?q=alpha", project.path)
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toContain(VISIBLE_ID)
    expect(text).not.toContain(WITHHELD_ID)
    expect(text).not.toContain("withheld secret")
    expect(JSON.parse(text)).toMatchObject({ vault: "present" })
  })

  test("answers an empty vault with no items rather than an error", async () => {
    await using project = await tmpdir({ git: true })
    const response = await get("/knowledge/search?q=alpha", project.path)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ vault: "absent", items: [], truncated: false })
  })

  test("refuses an empty query and an out-of-range limit", async () => {
    await using project = await tmpdir({ git: true })
    expect((await get("/knowledge/search?q=%20%20", project.path)).status).toBe(400)
    expect((await get("/knowledge/search", project.path)).status).toBe(400)
    expect((await get("/knowledge/search?q=alpha&limit=0", project.path)).status).toBe(400)
    expect((await get("/knowledge/search?q=alpha&limit=999", project.path)).status).toBe(400)
    expect((await get("/knowledge/search?q=alpha&limit=2x", project.path)).status).toBe(400)
  })
})

describe("GET /knowledge/notes/:id", () => {
  test("returns a note the local interface may read", async () => {
    await using project = await tmpdir({ git: true })
    seedVault(project.path, { visible: note({ id: VISIBLE_ID, body: VISIBLE_BODY }) })
    const response = await get(`/knowledge/notes/${VISIBLE_ID}`, project.path)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain(VISIBLE_BODY)
  })

  test("answers a withheld note exactly as it answers a missing one", async () => {
    await using project = await tmpdir({ git: true })
    seedVault(project.path, {
      withheld: note({
        id: WITHHELD_ID,
        body: WITHHELD_BODY,
        restrictions: ["  remote_model: allow", "  local_model: deny"],
      }),
    })
    const withheld = await get(`/knowledge/notes/${WITHHELD_ID}`, project.path)
    const missing = await get(`/knowledge/notes/0190d2c0-7b00-7000-8000-0000000000ee`, project.path)
    expect(withheld.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(await withheld.text()).toBe(await missing.text())
  })

  test("refuses ids that could address a path, before any read", async () => {
    await using project = await tmpdir({ git: true })
    seedVault(project.path, { visible: note({ id: VISIBLE_ID, body: VISIBLE_BODY }) })
    // `%2e%2e` is left out on purpose: the URL parser turns it into a `..` segment before the server sees it.
    for (const bad of ["..%2Fsecret", "..%2F..%2Fetc%2Fpasswd", "a%2Fb", "a%20b", "x".repeat(200)]) {
      const response = await get(`/knowledge/notes/${bad}`, project.path)
      expect(response.status).toBe(400)
    }
  })
})

describe("GET /knowledge/notes/:id/backlinks", () => {
  test("lists only the visible notes that link to the target", async () => {
    await using project = await tmpdir({ git: true })
    seedVault(project.path, {
      target: note({ id: TARGET_ID, body: "the target" }),
      linking: note({ id: LINKING_ID, body: `points at [[${TARGET_ID}]]` }),
    })
    const response = await get(`/knowledge/notes/${TARGET_ID}/backlinks`, project.path)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ids: [LINKING_ID] })
  })

  test("answers a withheld target as a missing one, so its backlinks stay hidden", async () => {
    await using project = await tmpdir({ git: true })
    seedVault(project.path, {
      withheld: note({
        id: WITHHELD_ID,
        body: "the withheld target",
        restrictions: ["  remote_model: allow", "  local_model: deny"],
      }),
      linking: note({ id: LINKING_ID, body: `points at [[${WITHHELD_ID}]]` }),
    })
    const response = await get(`/knowledge/notes/${WITHHELD_ID}/backlinks`, project.path)
    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain(LINKING_ID)
  })
})

describe("project isolation", () => {
  test("a note of one project is not readable from another project", async () => {
    await using projectA = await tmpdir({ git: true })
    await using projectB = await tmpdir({ git: true })
    seedVault(projectA.path, { visible: note({ id: VISIBLE_ID, body: VISIBLE_BODY }) })
    seedVault(projectB.path, { other: note({ id: OTHER_PROJECT_ID, body: "only in B" }) })

    expect((await get(`/knowledge/notes/${VISIBLE_ID}`, projectB.path)).status).toBe(404)
    expect((await get(`/knowledge/notes/${OTHER_PROJECT_ID}`, projectA.path)).status).toBe(404)
    expect((await get(`/knowledge/notes/${VISIBLE_ID}`, projectA.path)).status).toBe(200)
    const searchB = await get("/knowledge/search?q=alpha", projectB.path)
    expect(await searchB.text()).not.toContain(VISIBLE_ID)
  })
})

describe("read-only guarantee", () => {
  test("no request changes a note, and no write route exists", async () => {
    await using project = await tmpdir({ git: true })
    seedVault(project.path, {
      visible: note({ id: VISIBLE_ID, body: VISIBLE_BODY }),
      withheld: note({
        id: WITHHELD_ID,
        body: WITHHELD_BODY,
        restrictions: ["  remote_model: allow", "  local_model: deny"],
      }),
      target: note({ id: TARGET_ID, body: "the target" }),
      linking: note({ id: LINKING_ID, body: `points at [[${TARGET_ID}]]` }),
    })
    const before = snapshotVault(project.path)

    await get("/knowledge/status", project.path)
    await get("/knowledge/search?q=alpha", project.path)
    await get(`/knowledge/notes/${VISIBLE_ID}`, project.path)
    await get(`/knowledge/notes/${WITHHELD_ID}`, project.path)
    await get(`/knowledge/notes/${TARGET_ID}/backlinks`, project.path)

    const after = snapshotVault(project.path)
    // The egress trail is appended by design (ADR-KNOW-0006 §6). Only that file may differ.
    const notes = (snapshot: Record<string, string>) =>
      Object.fromEntries(Object.entries(snapshot).filter(([name]) => name !== CONTROL_LOG_FILE))
    expect(notes(after)).toEqual(notes(before))
  })

  test("the router exposes no method other than GET", () => {
    // Checked on the router, not by sending a write: an unknown path falls through to the
    // server's catch-all, which must not be exercised with a request body from a test.
    const methods = new Set(KnowledgeRoutes().routes.map((route) => route.method))
    expect([...methods]).toEqual(["GET"])
  })
})

describe("authentication", () => {
  test("a request without credentials is refused", async () => {
    await using project = await tmpdir({ git: true })
    // WHY: the in-process harness captures the password at import, so it is enforced only when set here.
    const saved = Flag.UNIFIA_SERVER_PASSWORD
    try {
      // @ts-expect-error test-only override, restored below
      Flag.UNIFIA_SERVER_PASSWORD = PASSWORD
      const response = await server.fetch(`/knowledge/status?directory=${encodeURIComponent(project.path)}`)
      expect(response.status).toBe(401)
    } finally {
      // @ts-expect-error restoring the value captured above
      Flag.UNIFIA_SERVER_PASSWORD = saved
    }
  })
})
