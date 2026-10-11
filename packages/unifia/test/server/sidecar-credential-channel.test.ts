/* SPDX-License-Identifier: MIT */
/**
 * What a held, withheld or assigned credential answers (ADR-094, second review, round 3).
 *
 * The cases that depend on the environment at load run in a child process: the module reads the environment once, when it
 * is first imported, and that is the state being tested.
 */

import { describe, it, expect, afterEach } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parseCredentialLine } from "../../src/server/sidecar-credentials"
import { createWorkbenchBridge } from "../../src/server/workbench"
import { heldCredentials, holdCredentials } from "../../src/flag/held-credentials"

const SRC = path.join(import.meta.dir, "..", "..", "src")
const ipcBearer = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
const savedEnv = { ...process.env }

afterEach(() => {
  holdCredentials({})
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key]
  Object.assign(process.env, savedEnv)
})

/** Run a script in a child process whose environment is `env`, and return the JSON it prints on its last line. */
function runInChild(script: string, env: Record<string, string>): unknown {
  const run = Bun.spawnSync([process.execPath, "-e", `(async () => {\n${script}\n})()`], {
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    stdout: "pipe",
    stderr: "pipe",
  })
  const out = run.stdout.toString().trim().split("\n").at(-1) ?? ""
  if (run.exitCode !== 0 || out === "") throw new Error(`child failed: ${run.stderr.toString()}`)
  return JSON.parse(out)
}

describe("a blank credential is refused, and a value is kept as sent", () => {
  it("a whitespace-only password is refused, and the refusal names neither the key nor the value", () => {
    let message = ""
    try {
      parseCredentialLine(JSON.stringify({ password: "   " }))
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toBe("a credential field is empty")
    expect(message).not.toContain("password")
  })

  it("a password with spaces inside it is held exactly as the host sent it", () => {
    expect(parseCredentialLine(JSON.stringify({ password: " a b " })).password).toBe(" a b ")
  })
})

describe("the Workbench bridge reads the credentials the desktop held", () => {
  it("the native route answers for the keychain token the host sent on stdin, with no environment copy", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "unifia-credential-channel-"))
    try {
      delete process.env.UNIFIA_KEYCHAIN_TOKEN
      delete process.env.UNIFIA_WORKBENCH_BEARER
      process.env.UNIFIA_WORKBENCH_AUDIT_LOG = path.join(root, "audit.jsonl")
      holdCredentials({ password: "held-password-0123456789abcdef", keychainToken: ipcBearer })

      const bridge = createWorkbenchBridge()
      if (!bridge) throw new Error("the bridge did not initialize from the held credentials")
      const url = "http://127.0.0.1/workbench/native/token"
      const wrong = await bridge.native(new Request(url, { method: "POST", headers: { "x-unifia-keychain-token": "wrong" } }))
      const right = await bridge.native(new Request(url, { method: "POST", headers: { "x-unifia-keychain-token": ipcBearer } }))

      expect(wrong.status).toBe(401)
      expect(right.status).not.toBe(404)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe("withholding a headless start moves every credential out of the environment, the bearer included", () => {
  it("the Workbench bearer is held, and no longer in the environment, after withholding", () => {
    const result = runInChild(
      `const { withholdServerCredentials } = await import(${JSON.stringify(path.join(SRC, "flag", "flag.ts"))})
       const { heldCredentials } = await import(${JSON.stringify(path.join(SRC, "flag", "held-credentials.ts"))})
       withholdServerCredentials()
       console.log(JSON.stringify({ env: process.env.UNIFIA_WORKBENCH_BEARER ?? null, held: heldCredentials().workbenchBearer ?? null }))`,
      { UNIFIA_WORKBENCH_BEARER: "bearer-value-from-the-environment" },
    )
    expect(result).toEqual({ env: null, held: "bearer-value-from-the-environment" })
  })
})

describe("assigning a credential answers for itself", () => {
  it("assigning undefined clears a password that was in the environment at load, and does not fall back to it", () => {
    const result = runInChild(
      `const { Flag } = await import(${JSON.stringify(path.join(SRC, "flag", "flag.ts"))})
       const before = Flag.UNIFIA_SERVER_PASSWORD
       Flag.UNIFIA_SERVER_PASSWORD = undefined
       console.log(JSON.stringify({ before: before ?? null, after: Flag.UNIFIA_SERVER_PASSWORD ?? null }))`,
      { UNIFIA_SERVER_PASSWORD: "password-from-the-environment-at-load" },
    )
    expect(result).toEqual({ before: "password-from-the-environment-at-load", after: null })
  })
})
