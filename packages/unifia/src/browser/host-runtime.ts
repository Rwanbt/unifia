/* SPDX-License-Identifier: MIT */
/**
 * Finds, or on first use provisions, what the Node Browser host needs to run
 * (ADR-089 §6): a Node binary, Playwright, a Chromium, and the host itself.
 *
 * The sidecar is a compiled Bun binary, so none of those exist next to it.
 * They are fetched once into the app data directory, the same arrangement the
 * LiveKit server uses for Live voice: an official release, checked against a
 * SHA-256 pinned in this file, never executed unverified.
 *
 * Development is unchanged: with `UNIFIA_BROWSER_HOST_ENTRY` set, or the host
 * source on disk next to the workspace packages, the host runs from source on
 * the Node found through `UNIFIA_NODE_PATH` or `PATH`.
 */
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

export namespace BrowserHostRuntime {
  export const NODE_VERSION = "v22.23.3"
  /** Same version as `packages/browser-runtime/package.json`; the host is tested against exactly it. */
  export const PLAYWRIGHT_VERSION = "1.57.0"

  type Pin = { archive: string; sha256: string }

  /** From https://nodejs.org/dist/v22.23.3/SHASUMS256.txt */
  export const NODE_PINS: Readonly<Record<string, Pin>> = {
    "win32-x64": { archive: `node-${NODE_VERSION}-win-x64.zip`, sha256: "2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71" },
    "win32-arm64": { archive: `node-${NODE_VERSION}-win-arm64.zip`, sha256: "33dad22e4cef5ee8f9fbb1b0d037fdacd0e56d12a4580f0d63f68b894deab535" },
    "linux-x64": { archive: `node-${NODE_VERSION}-linux-x64.tar.xz`, sha256: "df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de" },
    "linux-arm64": { archive: `node-${NODE_VERSION}-linux-arm64.tar.xz`, sha256: "a44aeb94849a299b22df10b9e622ec2f605c2183501bc40590705131de7c740f" },
    "darwin-x64": { archive: `node-${NODE_VERSION}-darwin-x64.tar.gz`, sha256: "8a677b0219178efd6eb0e475457c4afb452b521a92f6e67845a73bd85727f2a8" },
    "darwin-arm64": { archive: `node-${NODE_VERSION}-darwin-arm64.tar.gz`, sha256: "23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53" },
  }

  export type Launch = {
    nodePath: string
    entry: string
    /** A source entry needs `--experimental-strip-types`; the provisioned bundle is plain JavaScript. */
    stripTypes: boolean
    env: NodeJS.ProcessEnv
  }

  export class ProvisionError extends Error {
    constructor(message: string, options?: { cause?: unknown }) {
      super(message, options)
      this.name = "BrowserHostProvisionError"
    }
  }

  export type Dependencies = {
    /** Where provisioned files live. */
    root: string
    platform: string
    arch: string
    env: NodeJS.ProcessEnv
    fetchBytes: (url: string) => Promise<Uint8Array>
    /** Runs a command to completion and rejects with its stderr on a non-zero exit. */
    run: (command: string, args: readonly string[], options: { cwd?: string; env?: NodeJS.ProcessEnv }) => Promise<void>
    /** The host compiled to one JavaScript file by the sidecar build, absent when running from source. */
    loadBundle: () => Promise<string | undefined>
    /** The host source entry, when the workspace is on disk. */
    sourceEntry: () => string | undefined
    log: (message: string) => void
    /** The trust anchor; replaceable only so a test can pin a fake archive. */
    pins?: Readonly<Record<string, Pin>>
  }

  const READY_MARKER = ".ready"

  export function resolveNodeArchive(platform: string, arch: string, pins: Readonly<Record<string, Pin>> = NODE_PINS): Pin {
    const pin = pins[`${platform}-${arch}`]
    if (!pin) throw new ProvisionError(`no pinned Node release for ${platform}-${arch}`)
    return pin
  }

  export function sha256Hex(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex")
  }

  /** Where the extracted archive puts `node` and the npm CLI, which differs on Windows. */
  export function layout(nodeDirectory: string, archive: string, platform: string) {
    const folder = path.join(nodeDirectory, archive.replace(/\.(zip|tar\.xz|tar\.gz)$/, ""))
    return platform === "win32"
      ? { node: path.join(folder, "node.exe"), npmCli: path.join(folder, "node_modules", "npm", "bin", "npm-cli.js") }
      : { node: path.join(folder, "bin", "node"), npmCli: path.join(folder, "lib", "node_modules", "npm", "bin", "npm-cli.js") }
  }

  /** Downloads, verifies and unpacks Node. A hash mismatch deletes the download and refuses to run it. */
  async function ensureNode(deps: Dependencies): Promise<ReturnType<typeof layout>> {
    const pin = resolveNodeArchive(deps.platform, deps.arch, deps.pins)
    const directory = path.join(deps.root, `node-${NODE_VERSION}`)
    const paths = layout(directory, pin.archive, deps.platform)
    if (existsSync(paths.node) && existsSync(paths.npmCli)) return paths

    deps.log(`downloading Node ${NODE_VERSION}`)
    const bytes = await deps.fetchBytes(`https://nodejs.org/dist/${NODE_VERSION}/${pin.archive}`)
    const actual = sha256Hex(bytes)
    if (actual !== pin.sha256) {
      throw new ProvisionError(`${pin.archive} does not match its pinned SHA-256 (got ${actual}); refusing to run it`)
    }
    await rm(directory, { recursive: true, force: true })
    await mkdir(directory, { recursive: true })
    const archivePath = path.join(directory, pin.archive)
    await writeFile(archivePath, bytes)
    // Windows 10+ ships bsdtar, which reads zip. A bare `tar` there can be the GNU
    // one from Git for Windows, which cannot read zip and reads `C:\...` as a
    // remote host. Relative names with the directory as cwd also keep any drive
    // letter out of the arguments.
    const tar = deps.platform === "win32" ? path.join(deps.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar"
    await deps.run(tar, ["-xf", pin.archive], { cwd: directory })
    await rm(archivePath, { force: true })
    if (!existsSync(paths.node)) throw new ProvisionError(`${pin.archive} did not contain ${paths.node}`)
    return paths
  }

  async function ensurePlaywright(deps: Dependencies, node: ReturnType<typeof layout>, directory: string, browsers: string) {
    const cli = path.join(directory, "node_modules", "playwright", "cli.js")
    if (!existsSync(cli)) {
      deps.log(`installing Playwright ${PLAYWRIGHT_VERSION}`)
      await mkdir(directory, { recursive: true })
      await writeFile(path.join(directory, "package.json"), JSON.stringify({ name: "unifia-browser-host", private: true }))
      await deps.run(
        node.node,
        [node.npmCli, "install", `playwright@${PLAYWRIGHT_VERSION}`, "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock"],
        { cwd: directory },
      )
    }
    deps.log("ensuring Chromium")
    // Idempotent: Playwright skips a browser it already has under this path.
    await deps.run(node.node, [cli, "install", "chromium"], { cwd: directory, env: { ...deps.env, PLAYWRIGHT_BROWSERS_PATH: browsers } })
  }

  /** The launch description for the host, provisioning what is missing. */
  export async function resolve(deps: Dependencies): Promise<Launch> {
    const override = deps.env.UNIFIA_BROWSER_HOST_ENTRY
    const source = override ?? deps.sourceEntry()
    if (source) return { nodePath: deps.env.UNIFIA_NODE_PATH ?? "node", entry: source, stripTypes: true, env: deps.env }

    const bundle = await deps.loadBundle()
    if (!bundle) throw new ProvisionError("this build carries no Browser host; set UNIFIA_BROWSER_HOST_ENTRY to run one")

    const directory = path.join(deps.root, `host-${PLAYWRIGHT_VERSION}`)
    const browsers = path.join(deps.root, "browsers")
    const entry = path.join(directory, "browser-host.mjs")
    const marker = path.join(directory, READY_MARKER)
    const stamp = `${NODE_VERSION}:${PLAYWRIGHT_VERSION}:${sha256Hex(new TextEncoder().encode(bundle))}`
    const launch = (node: string): Launch => ({ nodePath: node, entry, stripTypes: false, env: { ...deps.env, PLAYWRIGHT_BROWSERS_PATH: browsers } })

    const nodePaths = layout(path.join(deps.root, `node-${NODE_VERSION}`), resolveNodeArchive(deps.platform, deps.arch, deps.pins).archive, deps.platform)
    if (existsSync(marker) && (await readFile(marker, "utf8").catch(() => "")) === stamp && existsSync(nodePaths.node)) {
      return launch(nodePaths.node)
    }

    const node = await ensureNode(deps)
    await ensurePlaywright(deps, node, directory, browsers)
    // Written last and atomically: a half-provisioned directory must not look ready.
    await writeFile(entry, bundle)
    const pending = `${marker}.tmp`
    await writeFile(pending, stamp)
    await rename(pending, marker)
    return launch(node.node)
  }

  /** The real dependencies: network, child processes and the embedded host bundle. */
  export function systemDependencies(root: string): Dependencies {
    return {
      root,
      platform: process.platform,
      arch: process.arch,
      env: process.env,
      fetchBytes: async (url) => {
        const response = await fetch(url)
        if (!response.ok) throw new ProvisionError(`GET ${url} answered ${response.status}`)
        return new Uint8Array(await response.arrayBuffer())
      },
      run: async (command, args, options) => {
        const child = Bun.spawn([command, ...args], {
          cwd: options.cwd,
          env: { ...process.env, ...options.env },
          stdout: "ignore",
          stderr: "pipe",
        })
        const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
        if (code !== 0) throw new ProvisionError(`${command} ${args[0] ?? ""} exited with ${code}: ${stderr.trim().slice(-500)}`)
      },
      loadBundle: async () => {
        // Written by script/build.ts and gitignored, like models-snapshot.js.
        const module = await import("./host-bundle.generated.js" as string).catch(() => undefined)
        return typeof module?.source === "string" && module.source.length > 0 ? module.source : undefined
      },
      sourceEntry: () => {
        try {
          const resolved = fileURLToPath(import.meta.resolve("@unifia/browser-runtime/host-entry"))
          return existsSync(resolved) ? resolved : undefined
        } catch {
          return undefined
        }
      },
      log: (message) => process.stderr.write(`[browser-host] ${message}\n`),
    }
  }
}
