/* SPDX-License-Identifier: MIT */
/**
 * The access and WebSocket tokens are verified with the process secret. It must not change while the server runs, and it
 * must be the same in every process that is meant to accept the other's tokens.
 *
 * The configured secret comes from the operator's channel (`UNIFIA_JWT_SECRET`), read once, at start. It is never read from a
 * configuration file: a file is writable by every process of the user. The tests that depend on the secret run in child
 * processes, each importing the real module: a child is a restart, and this process's own secret stays out of the question.
 * A child reports through a file, not stdout: stdout is asynchronous when it is a pipe, and a child that exits right after
 * writing to it can lose the line.
 */
import { describe, expect, setSystemTime, test } from "bun:test"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { JwtAuth } from "../../src/server/auth-jwt"
import { Global } from "../../src/global/path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const USER = { id: "u-secret", username: "owner", role: "owner" } as const
const SECRET = "configured-jwt-secret-for-the-test-0123456789"
// A file URL, not a path: the child's source embeds this string, and a Windows path carries backslashes into a JS string
// literal, where `\u` begins an escape sequence and the child fails to parse.
const SRC = pathToFileURL(path.resolve(import.meta.dir, "../../src")).href
const GLOBAL_CONFIG = path.join(Global.Path.config, "config.json")

/**
 * The user's global configuration. A secret written here must not be read: a process of the user can write it, so it is the
 * one place the process secret must never come from.
 */
async function setGlobalSecret(secret: string | undefined): Promise<void> {
  await mkdir(Global.Path.config, { recursive: true })
  if (secret === undefined) {
    await rm(GLOBAL_CONFIG, { force: true })
    return
  }
  await Bun.write(GLOBAL_CONFIG, JSON.stringify({ experimental: { collaborative: { jwt_secret: secret } } }))
}

/**
 * A child process that uses the real JwtAuth. Modes: `issue` writes a ticket to `file`; `check` reads the ticket in
 * `file`; `switch` times the start. Every mode writes its result to `result.json` in the project.
 */
async function writeChild(directory: string): Promise<string> {
  const script = path.join(directory, "jwt-child.ts")
  await Bun.write(
    script,
    [
      `import { Instance } from "${SRC}/project/instance.ts"`,
      `import { JwtAuth } from "${SRC}/server/auth-jwt.ts"`,
      `const [mode, directory, file] = process.argv.slice(2)`,
      `const user = { id: "u-secret", username: "owner", role: "owner" }`,
      `const result: Record<string, boolean> = {}`,
      `await Instance.provide({`,
      `  directory,`,
      `  fn: async () => {`,
      `    if (mode === "issue") {`,
      `      await JwtAuth.init()`,
      `      await Bun.write(file, JwtAuth.issueWsTicket(user))`,
      `    }`,
      `    if (mode === "check") {`,
      `      await JwtAuth.init()`,
      `      result.accepted = JwtAuth.verifyWsTicket(await Bun.file(file).text()) !== null`,
      `    }`,
      `    if (mode === "switch") {`,
      `      const before = JwtAuth.issueWsTicket(user)`,
      `      result.verifiedAtIssue = JwtAuth.verifyWsTicket(before) !== null`,
      `      await JwtAuth.init()`,
      `      result.refusedAfterStart = JwtAuth.verifyWsTicket(before) === null`,
      `      result.acceptedAfterStart = JwtAuth.verifyWsTicket(JwtAuth.issueWsTicket(user)) !== null`,
      `    }`,
      `  },`,
      `})`,
      `await Bun.write(directory + "/result.json", JSON.stringify(result))`,
      `process.exit(0)`,
      ``,
    ].join("\n"),
  )
  return script
}

/**
 * Run one child in `mode` and return the result it wrote. The child gets this process's environment passed explicitly: the
 * test isolation (XDG directories, database) is set on process.env at run time, and the child must read the same paths.
 * A failing child fails the test with its own output.
 */
async function runChild(
  script: string,
  mode: string,
  directory: string,
  file = "",
  extraEnv: Record<string, string> = {},
): Promise<Record<string, boolean>> {
  const proc = Bun.spawn([process.execPath, script, mode, directory, file], {
    env: { ...process.env, ...extraEnv },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) throw new Error(`child exited ${code}: ${stderr.slice(-800)}`)
  return JSON.parse(await Bun.file(path.join(directory, "result.json")).text()) as Record<string, boolean>
}

describe("JwtAuth: a token is refused once its lifetime has passed", () => {
  test("a ticket verifies at issue and is refused a day later", async () => {
    await using project = await tmpdir({ git: true })
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const issuedAt = new Date("2026-10-11T12:00:00Z")
        setSystemTime(issuedAt)
        try {
          const ticket = JwtAuth.issueWsTicket(USER as never)
          expect(JwtAuth.verifyWsTicket(ticket)).not.toBeNull()
          setSystemTime(new Date(issuedAt.getTime() + 24 * 60 * 60 * 1000))
          expect(JwtAuth.verifyWsTicket(ticket)).toBeNull()
        } finally {
          setSystemTime()
        }
      },
    })
  })
})

describe("JwtAuth: the process secret is stable", () => {
  test("a ticket keeps verifying for as long as the process runs", async () => {
    await using project = await tmpdir({ git: true })
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const ticket = JwtAuth.issueWsTicket(USER as never)
        const results: boolean[] = []
        for (let i = 0; i < 40; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 5))
          results.push(JwtAuth.verifyWsTicket(ticket) !== null)
        }
        expect(results.every(Boolean)).toBe(true)
      },
    })
  })
})

describe("JwtAuth: a WebSocket ticket is not an access token", () => {
  test("the access check refuses a ticket, and the ticket check still accepts it", async () => {
    await using project = await tmpdir({ git: true })
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const ticket = JwtAuth.issueWsTicket(USER as never)
        expect(JwtAuth.verifyAccessToken(ticket)).toBeNull()
        expect(JwtAuth.verifyWsTicket(ticket)).not.toBeNull()
      },
    })
  })
})

describe("JwtAuth: the secret across a start, and between processes", () => {
  test("a configured secret is applied at start: a ticket issued before is refused after, and a new one verifies", async () => {
    await using project = await tmpdir({ git: true })
    const script = await writeChild(project.path)
    const result = await runChild(script, "switch", project.path, "", { UNIFIA_JWT_SECRET: SECRET })
    expect(result).toEqual({ verifiedAtIssue: true, refusedAfterStart: true, acceptedAfterStart: true })
  })

  test("a restarted process accepts the tickets of the one before when the operator's secret is the same", async () => {
    await using project = await tmpdir({ git: true })
    const script = await writeChild(project.path)
    const ticket = path.join(project.path, "ticket.txt")
    await runChild(script, "issue", project.path, ticket, { UNIFIA_JWT_SECRET: SECRET })
    expect(await runChild(script, "check", project.path, ticket, { UNIFIA_JWT_SECRET: SECRET })).toEqual({
      accepted: true,
    })
  })

  test("a secret in the user's global configuration is not read: a restarted process refuses tickets signed with it", async () => {
    await using project = await tmpdir({ git: true })
    const script = await writeChild(project.path)
    const ticket = path.join(project.path, "ticket.txt")
    await setGlobalSecret(SECRET)
    try {
      await runChild(script, "issue", project.path, ticket)
      expect(await runChild(script, "check", project.path, ticket)).toEqual({ accepted: false })
    } finally {
      await setGlobalSecret(undefined)
    }
  })

  test("a configured secret that is too short stops the start", async () => {
    await using project = await tmpdir({ git: true })
    const script = await writeChild(project.path)
    await expect(runChild(script, "check", project.path, "", { UNIFIA_JWT_SECRET: "too-short" })).rejects.toThrow(
      "at least 32 characters",
    )
  })

  test("a restarted process refuses the tickets of the one before when no secret is configured", async () => {
    await using project = await tmpdir({ git: true })
    const script = await writeChild(project.path)
    const ticket = path.join(project.path, "ticket.txt")
    await setGlobalSecret(undefined)
    await runChild(script, "issue", project.path, ticket)
    expect(await runChild(script, "check", project.path, ticket)).toEqual({ accepted: false })
  })

  test("a secret in the project's own configuration does not choose the process secret", async () => {
    await using project = await tmpdir({ git: true })
    const script = await writeChild(project.path)
    const ticket = path.join(project.path, "ticket.txt")
    await Bun.write(
      path.join(project.path, "unifia.json"),
      JSON.stringify({ experimental: { collaborative: { jwt_secret: SECRET } } }),
    )
    await setGlobalSecret(undefined)
    await runChild(script, "issue", project.path, ticket)
    expect(await runChild(script, "check", project.path, ticket)).toEqual({ accepted: false })
  })
})
