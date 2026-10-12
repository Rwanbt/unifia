// SPDX-License-Identifier: MIT
import { expect, test } from "bun:test"
import { authenticateWellKnownProvider, type WellKnownAuthDependencies } from "../../src/cli/cmd/wellknown-auth"
import { Process } from "../../src/util/process"

const validManifest = { auth: { command: ["provider-login", "--token"], env: "PROVIDER_TOKEN" } }

function fixture(manifest: unknown = validManifest, approved = true, code = 0, token = " token\n") {
  const calls: string[] = []
  const dependencies: WellKnownAuthDependencies = {
    fetch: async (url) => {
      calls.push(String(url))
      return Response.json(manifest)
    },
    approve: async (_url, command) => {
      calls.push(`approve:${JSON.stringify(command)}`)
      return approved
    },
    run: async (command) => {
      calls.push(`run:${JSON.stringify(command)}`)
      return { code, stdout: Buffer.from(token) }
    },
  }
  return { calls, dependencies }
}

test("WellKnownAuth_DeclinedCommand_DoesNotExecute_Unit", async () => {
  const { calls, dependencies } = fixture(validManifest, false)
  expect(await authenticateWellKnownProvider("https://provider.example/", dependencies)).toBeUndefined()
  expect(calls).toEqual([
    "https://provider.example/.well-known/opencode",
    'approve:["provider-login","--token"]',
  ])
})

for (const manifest of [null, {}, { auth: { command: [], env: "TOKEN" } },
  { auth: { command: ["bad\0command"], env: "TOKEN" } },
  { auth: { command: ["login"], env: "BAD=TOKEN" } }]) {
  test(`WellKnownAuth_InvalidManifest_RejectsBeforeApproval_Unit ${JSON.stringify(manifest)}`, async () => {
    const { calls, dependencies } = fixture(manifest)
    await expect(authenticateWellKnownProvider("https://provider.example", dependencies)).rejects.toThrow()
    expect(calls).toHaveLength(1)
  })
}

test("WellKnownAuth_ApprovedCommand_ReturnsValidatedCredential_Unit", async () => {
  const { calls, dependencies } = fixture()
  expect(await authenticateWellKnownProvider("https://provider.example", dependencies))
    .toEqual({ type: "wellknown", key: "PROVIDER_TOKEN", token: "token" })
  expect(calls.slice(1)).toEqual(['approve:["provider-login","--token"]', 'run:["provider-login","--token"]'])
})

test("WellKnownAuth_InvalidProtocol_DoesNotFetch_Unit", async () => {
  const { calls, dependencies } = fixture()
  await expect(authenticateWellKnownProvider("file:///provider", dependencies)).rejects.toThrow("HTTP or HTTPS")
  expect(calls).toHaveLength(0)
})

test("WellKnownAuth_HttpFailure_DoesNotApprove_Unit", async () => {
  const { calls, dependencies } = fixture()
  dependencies.fetch = async () => new Response("denied", { status: 403 })
  await expect(authenticateWellKnownProvider("https://provider.example", dependencies)).rejects.toThrow("HTTP 403")
  expect(calls).toHaveLength(0)
})

for (const [code, token] of [[1, "token"], [0, "  "]] as const) {
  test(`WellKnownAuth_CommandFailure_DoesNotReturnCredential_Unit ${code}`, async () => {
    const { dependencies } = fixture(validManifest, true, code, token)
    await expect(authenticateWellKnownProvider("https://provider.example", dependencies)).rejects.toThrow()
  })
}

test("WellKnownAuth_RealHttpAndProcess_ApprovalPrecedesExecution_Integration", async () => {
  const command = [process.execPath, "-e", 'process.stdout.write("integration-token")']
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () =>
    Response.json({ auth: { command, env: "PROVIDER_TOKEN" } }) })
  let approved = false
  try {
    const result = await authenticateWellKnownProvider(server.url.href, {
      fetch,
      approve: async (_url, proposed) => { expect(proposed).toEqual(command); approved = true; return true },
      run: (proposed) => { expect(approved).toBe(true); return Process.run(proposed) },
    })
    expect(result).toEqual({ type: "wellknown", key: "PROVIDER_TOKEN", token: "integration-token" })
  } finally {
    await server.stop(true)
  }
})
