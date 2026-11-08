// SPDX-License-Identifier: MIT
// Starts the real `unifia serve` in an isolated home, the way the desktop app
// does (no e2e seed flags), for component tests that mount real pages.
import { spawn, type ChildProcess } from "node:child_process"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import http from "node:http"
import net from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"

const SERVER_DIR = path.resolve(import.meta.dir, "../../../unifia")
const BOOT_TIMEOUT_MS = 90_000

export type RealServer = {
  url: string
  projectDir: string
  output: () => string
  stop: () => Promise<void>
}

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

async function waitForHealth(url: string, child: ChildProcess, output: () => string): Promise<void> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`serve exited with ${child.exitCode}:\n${output()}`)
    if (await isHealthy(`${url}/global/health`)) return
    await Bun.sleep(250)
  }
  throw new Error(`serve did not become healthy within ${BOOT_TIMEOUT_MS} ms:\n${output()}`)
}

// node:http, not fetch: the happy-dom preload has already replaced the global
// fetch, which applies CORS and logs every refused connection while booting.
function isHealthy(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume()
      resolve(response.statusCode === 200)
    })
    request.on("error", () => resolve(false))
    // A destroyed request does not always emit "error" under Bun on Windows; without
    // these the probe never settles and the boot loop hangs past its own deadline.
    request.on("close", () => resolve(false))
    request.setTimeout(2000, () => {
      resolve(false)
      request.destroy()
    })
  })
}

export async function startRealServer(input: { corsOrigin: string }): Promise<RealServer> {
  const sandbox = await mkdtemp(path.join(tmpdir(), "unifia-component-"))
  for (const dir of ["home", "share", "cache", "config", "state", "project"]) {
    await mkdir(path.join(sandbox, dir), { recursive: true })
  }
  const projectDir = path.join(sandbox, "project")
  // A git root stops the upward config search at the project instead of the
  // developer's real home (see production-boot-routes.test.ts).
  const init = Bun.spawnSync(["git", "init", "-q"], { cwd: projectDir })
  if (init.exitCode !== 0) throw new Error(`git init failed: ${init.stderr.toString()}`)

  const port = await freePort()
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
  delete env.UNIFIA_E2E_SEED_EMPTY_REGISTRY
  const lines: string[] = []
  const output = () => lines.join("").slice(-4000)
  const child = spawn(
    process.execPath,
    [
      "run",
      "--conditions=browser",
      "./src/index.ts",
      "serve",
      "--port",
      String(port),
      "--hostname",
      "127.0.0.1",
      "--cors",
      input.corsOrigin,
    ],
    { cwd: SERVER_DIR, env, stdio: ["pipe", "pipe", "pipe"] },
  )
  child.stdout?.on("data", (chunk) => lines.push(String(chunk)))
  child.stderr?.on("data", (chunk) => lines.push(String(chunk)))
  const url = `http://127.0.0.1:${port}`
  await waitForHealth(url, child, output)

  return {
    url,
    projectDir,
    output,
    stop: async () => {
      if (child.exitCode === null) {
        const exited = new Promise((resolve) => child.once("exit", resolve))
        child.kill()
        await Promise.race([exited, Bun.sleep(10_000)])
      }
      await rm(sandbox, { recursive: true, force: true }).catch(() => undefined)
    },
  }
}
