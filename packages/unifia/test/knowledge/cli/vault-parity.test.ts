/* SPDX-License-Identifier: MIT */
/**
 * The CLI and the server read one vault (ADR-090).
 *
 * The same governed note, persisted on disk, must be answered the same way by the CLI commands and by
 * the server's knowledge tree for the same project. Before this, the CLI composed `<workspace>/memory`
 * and the project root, so `knowledge status` reported no note beside a server that listed one.
 */
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { withInProcessServer, type InProcessServer } from "../../lib/in-process-server"
import { tmpdir } from "../../fixture/fixture"
import { cmdSearch, cmdStatus } from "../../../src/cli/knowledge/runtime"
import { resetMemoryCache } from "../../../src/knowledge/app/memory"
import { Flag } from "../../../src/flag/flag"

const PASSWORD = "cli-vault-parity-pw"
const AUTH = "Basic " + Buffer.from("unifia:" + PASSWORD).toString("base64")
const SEED_ID = "0190d2c0-7b00-7000-8000-00000000000b"
const SEED_LOCATOR = "plan.md"
const SEED_BODY = "# Plan\n\nThe parity draft."

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

/** A governed note, as the vault stores it: the frontmatter the vault reads, then the body. */
function seededNote(): string {
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
    SEED_BODY,
  ].join("\n")
}

function seedVault(vaultRoot: string): void {
  mkdirSync(vaultRoot, { recursive: true })
  writeFileSync(path.join(vaultRoot, SEED_LOCATOR), seededNote(), "utf8")
}

/** Runs a CLI command and returns what it printed, so the assertions read the user's own view. */
async function runCli(command: () => Promise<number>): Promise<string> {
  const chunks: string[] = []
  const spy = spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    chunks.push(String(chunk))
    return true
  })
  try {
    await command()
    return chunks.join("")
  } finally {
    spy.mockRestore()
  }
}

/** The server's answer to a knowledge route for one project, which must succeed. */
async function serverJson(route: string, project: string): Promise<unknown> {
  const sep = route.includes("?") ? "&" : "?"
  const response = await server.fetch(`${route}${sep}directory=${encodeURIComponent(project)}`, {
    headers: { Authorization: AUTH },
  })
  expect(response.status).toBe(200)
  return response.json()
}

/** The server's view of the vault: whether it is present, how many notes it counts, and what its search finds. */
async function serverView(project: string) {
  const status = (await serverJson("/knowledge/status", project)) as {
    vault: string
    status?: { candidatesCount: number }
  }
  const search = (await serverJson("/knowledge/search?q=parity", project)) as {
    items: Array<{ ref: { locator: string } }>
  }
  return {
    vault: status.vault,
    notes: status.status?.candidatesCount,
    locators: search.items.map((item) => item.ref.locator),
  }
}

describe("CLI and server read one vault", () => {
  it("the default vault is the one the server reads, in the same place", async () => {
    await using tmp = await tmpdir()
    const vaultRoot = path.join(tmp.path, ".unifia", "memory")
    seedVault(vaultRoot)

    const status = await runCli(() => cmdStatus([tmp.path]))
    expect(status).toContain(`vault:      ${vaultRoot}`)
    expect(status).toContain("notes:      1")

    const search = await runCli(() => cmdSearch(["--workspace", tmp.path, "parity"]))
    expect(search).toContain(SEED_LOCATOR)

    expect(await serverView(tmp.path)).toEqual({ vault: "present", notes: 1, locators: [SEED_LOCATOR] })
  })

  it("a configured memory directory is the one both read", async () => {
    await using tmp = await tmpdir({ config: { memory: { directory: "vault" } } })
    const vaultRoot = path.join(tmp.path, "vault")
    seedVault(vaultRoot)

    const status = await runCli(() => cmdStatus([tmp.path]))
    expect(status).toContain(`vault:      ${vaultRoot}`)
    expect(status).toContain("notes:      1")

    expect(await serverView(tmp.path)).toEqual({ vault: "present", notes: 1, locators: [SEED_LOCATOR] })
  })

  it("a project with no vault yet is reported as having none, by both surfaces", async () => {
    await using tmp = await tmpdir()

    const status = await runCli(() => cmdStatus([tmp.path]))
    expect(status).toContain(`vault:      no memory vault at ${path.join(tmp.path, ".unifia", "memory")} yet`)

    expect(await serverView(tmp.path)).toEqual({ vault: "absent", notes: undefined, locators: [] })
  })
})
