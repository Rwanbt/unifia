/* SPDX-License-Identifier: MIT */
/**
 * The server's password reaches the server through its environment, once. A command the agent runs inherits that
 * environment, and the password is the owner's authority on the server's routes, so it must not travel on to children.
 *
 * The test runs a controlled child process: it holds the password, withholds it as the server does, and starts a
 * grandchild that prints its whole environment. The password never appears in the grandchild's output. A control run
 * that does not withhold it shows the grandchild would otherwise have inherited it, so the assertion is not vacuous.
 *
 * The value is never printed: an assertion reports a boolean, not the password.
 */
import { describe, expect, test } from "bun:test"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"

const CANARY = "canary-server-password-0123456789"
const SRC = path.resolve(import.meta.dir, "../../src")

interface BoundaryResult {
  childSawPassword: boolean
  flagHoldsPassword: boolean
}

/** The controlled child: `withhold` removes the password first, `keep` leaves it in the environment. */
async function writeBoundary(directory: string): Promise<string> {
  const script = path.join(directory, "boundary.ts")
  await Bun.write(
    script,
    [
      `import { Flag, withholdServerCredentials } from "${SRC}/flag/flag.ts"`,
      `const [mode, out] = process.argv.slice(2)`,
      `if (mode === "withhold") withholdServerCredentials()`,
      `const grandchild = Bun.spawn([process.execPath, "-e", "process.stdout.write(JSON.stringify(process.env))"], {`,
      `  env: { ...process.env },`,
      `  stdout: "pipe",`,
      `  stderr: "pipe",`,
      `})`,
      `const seen = await new Response(grandchild.stdout).text()`,
      `await grandchild.exited`,
      `const result = { childSawPassword: seen.includes(${JSON.stringify(CANARY)}), flagHoldsPassword: Flag.UNIFIA_SERVER_PASSWORD === ${JSON.stringify(CANARY)} }`,
      `await Bun.write(out, JSON.stringify(result))`,
      `process.exit(0)`,
      ``,
    ].join("\n"),
  )
  return script
}

/** Run the controlled child with the password in its environment, as the desktop application starts the sidecar. */
async function runBoundary(mode: "withhold" | "keep"): Promise<BoundaryResult> {
  await using project = await tmpdir()
  const script = await writeBoundary(project.path)
  const out = path.join(project.path, "result.json")
  const proc = Bun.spawn([process.execPath, script, mode, out], {
    env: { ...process.env, UNIFIA_SERVER_PASSWORD: CANARY },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) throw new Error(`controlled child exited ${code}: ${stderr.slice(-600)}`)
  return JSON.parse(await Bun.file(out).text()) as BoundaryResult
}

describe("the server's password is withheld from the processes it starts", () => {
  test("a process the server starts does not inherit the password, and the server keeps it", async () => {
    const result = await runBoundary("withhold")
    expect(result.childSawPassword).toBe(false)
    expect(result.flagHoldsPassword).toBe(true)
  })

  test("without withholding, the same grandchild would inherit the password (control)", async () => {
    const result = await runBoundary("keep")
    expect(result.childSawPassword).toBe(true)
  })
})
