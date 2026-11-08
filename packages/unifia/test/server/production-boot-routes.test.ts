/* SPDX-License-Identifier: MIT */
// Boots the real `unifia serve` the way the desktop does, without any e2e
// seed flag, and calls every parameterless GET route the server publishes in
// its own OpenAPI document. No route may answer 5xx or hang.
//
// WHY: unit and e2e suites both missed that the model registry was never
// filled in production (#1066). Route tests build their own app, and the e2e
// backend sets UNIFIA_E2E_SEED_EMPTY_REGISTRY, so nothing ever exercised the
// boot path the shipped app takes. Reading the routes from the SDK contract
// keeps this test current as routes are added.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { spawn, type ChildProcess } from "node:child_process"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import net from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"

const SERVER_DIR = path.resolve(import.meta.dir, "../..")
// The SDK contract is what the UI calls; openapi-compat.test.ts keeps it in
// step with the server. The runtime /doc only lists routes mounted before it.
const SDK_CONTRACT = path.resolve(SERVER_DIR, "../sdk/openapi.json")
const BOOT_TIMEOUT_MS = 90_000
const ROUTE_TIMEOUT_MS = 15_000

// Routes that hold the connection open by design (event streams, long polls).
// A response that never ends is their contract, not a hang.
const STREAMING_ROUTES = new Set(["/event", "/global/event", "/global/sync-event", "/tui/control/next"])

type OpenApiDocument = { paths: Record<string, Record<string, unknown>> }
type RouteResult = { route: string; status: number | "timeout" | "network-error"; detail?: string }

let server: ChildProcess | undefined
let sandbox = ""
let baseUrl = ""
const serverOutput: string[] = []

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address()
      if (address === null || typeof address === "string") return reject(new Error("no port assigned"))
      probe.close(() => resolve(address.port))
    })
  })
}

async function waitForHealth(url: string): Promise<void> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`serve exited with ${server.exitCode} before answering:\n${serverOutput.join("").slice(-4000)}`)
    }
    const healthy = await fetch(`${url}/global/health`)
      .then((response) => response.ok)
      .catch(() => false)
    if (healthy) return
    await Bun.sleep(250)
  }
  throw new Error(`serve did not answer /global/health within ${BOOT_TIMEOUT_MS} ms:\n${serverOutput.join("").slice(-4000)}`)
}

async function callRoute(route: string, projectDir: string): Promise<RouteResult> {
  const url = `${baseUrl}${route}?directory=${encodeURIComponent(projectDir)}`
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS) })
    const body = response.status >= 500 ? (await response.text()).slice(0, 300) : undefined
    if (response.status < 500) await response.body?.cancel()
    return { route, status: response.status, detail: body }
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError"
    return { route, status: timedOut ? "timeout" : "network-error", detail: String(error) }
  }
}

describe("production boot", () => {
  beforeAll(async () => {
    sandbox = await mkdtemp(path.join(tmpdir(), "unifia-production-boot-"))
    for (const dir of ["home", "share", "cache", "config", "state", "project"]) {
      await mkdir(path.join(sandbox, dir), { recursive: true })
    }
    // A git root stops the upward config search at the project. Without one it
    // climbs to the developer's real home and can install their plugins (45 s
    // measured for one npm plugin), which is neither hermetic nor this test.
    const init = Bun.spawnSync(["git", "init", "-q"], { cwd: path.join(sandbox, "project") })
    if (init.exitCode !== 0) throw new Error(`git init failed: ${init.stderr.toString()}`)
    const port = await freePort()
    baseUrl = `http://127.0.0.1:${port}`
    const env: Record<string, string | undefined> = {
      ...process.env,
      UNIFIA_DISABLE_LSP_DOWNLOAD: "true",
      UNIFIA_DISABLE_DEFAULT_PLUGINS: "true",
      UNIFIA_EXPERIMENTAL_DISABLE_FILEWATCHER: "true",
      UNIFIA_TEST_HOME: path.join(sandbox, "home"),
      XDG_DATA_HOME: path.join(sandbox, "share"),
      XDG_CACHE_HOME: path.join(sandbox, "cache"),
      XDG_CONFIG_HOME: path.join(sandbox, "config"),
      XDG_STATE_HOME: path.join(sandbox, "state"),
      UNIFIA_CLIENT: "app",
    }
    // The point of this test: boot exactly as production does.
    delete env.UNIFIA_E2E_SEED_EMPTY_REGISTRY
    server = spawn(
      process.execPath,
      ["run", "--conditions=browser", "./src/index.ts", "serve", "--port", String(port), "--hostname", "127.0.0.1"],
      // stdin stays open: the parent watchdog reads end-of-stdin as a dead host.
      { cwd: SERVER_DIR, env, stdio: ["pipe", "pipe", "pipe"] },
    )
    server.stdout?.on("data", (chunk) => serverOutput.push(String(chunk)))
    server.stderr?.on("data", (chunk) => serverOutput.push(String(chunk)))
    await waitForHealth(baseUrl)
  }, BOOT_TIMEOUT_MS + 10_000)

  afterAll(async () => {
    if (server && server.exitCode === null) {
      const exited = new Promise((resolve) => server?.once("exit", resolve))
      server.kill()
      await Promise.race([exited, Bun.sleep(10_000)])
    }
    if (sandbox) await rm(sandbox, { recursive: true, force: true }).catch(() => undefined)
  }, 30_000)

  test("ProductionBoot_EveryParameterlessGetRoute_AnswersWithout5xx", async () => {
    const document = (await Bun.file(SDK_CONTRACT).json()) as OpenApiDocument
    const routes = Object.entries(document.paths)
      .filter(([route, operations]) => "get" in operations && !route.includes("{"))
      .map(([route]) => route)
      .filter((route) => !STREAMING_ROUTES.has(route))
      .sort()
    expect(routes.length).toBeGreaterThan(50)

    const projectDir = path.join(sandbox, "project")
    const results: RouteResult[] = []
    for (const route of routes) results.push(await callRoute(route, projectDir))

    const failures = results.filter((result) => typeof result.status !== "number" || result.status >= 500)
    const report = failures.map((failure) => `${failure.route} -> ${failure.status} ${failure.detail ?? ""}`).join("\n")
    expect(report).toBe("")
  }, 600_000)
})
