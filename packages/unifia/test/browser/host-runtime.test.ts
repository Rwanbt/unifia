/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { BrowserHostRuntime } from "../../src/browser/host-runtime"

const { NODE_PINS, NODE_VERSION, PLAYWRIGHT_VERSION } = BrowserHostRuntime

async function root() {
  return mkdtemp(path.join(tmpdir(), "unifia-host-runtime-"))
}

/**
 * Every effect is faked: the archive is a few known bytes whose hash the test
 * pins, `tar` "extracts" by creating the files the layout expects, and the
 * Playwright installs only create what the real ones would.
 */
function fakeDeps(overrides: Partial<BrowserHostRuntime.Dependencies> & { root: string }) {
  const runs: Array<{ command: string; args: readonly string[]; env?: NodeJS.ProcessEnv }> = []
  const fetched: string[] = []
  const platform = "linux"
  const arch = "x64"
  const archive = new TextEncoder().encode("pretend node archive")
  const deps: BrowserHostRuntime.Dependencies = {
    platform,
    arch,
    env: {},
    fetchBytes: async (url) => {
      fetched.push(url)
      return archive
    },
    run: async (command, args, options) => {
      runs.push({ command, args, env: options.env })
      if (command === "tar") {
        const target = options.cwd!
        const paths = BrowserHostRuntime.layout(target, NODE_PINS["linux-x64"]!.archive, "linux")
        await mkdir(path.dirname(paths.node), { recursive: true })
        await writeFile(paths.node, "")
        await mkdir(path.dirname(paths.npmCli), { recursive: true })
        await writeFile(paths.npmCli, "")
      } else if (args.includes("install") && args.some((arg) => arg.startsWith("playwright@"))) {
        const cwd = path.join(overrides.root, `host-${PLAYWRIGHT_VERSION}`, "node_modules", "playwright")
        await mkdir(cwd, { recursive: true })
        await writeFile(path.join(cwd, "cli.js"), "")
      }
    },
    loadBundle: async () => "export const host = true",
    sourceEntry: () => undefined,
    log: () => {},
    ...overrides,
  }
  return { deps, runs, fetched, archive }
}

describe("BrowserHostRuntime", () => {
  test("every supported platform has a pin shaped like a SHA-256", () => {
    for (const [key, pin] of Object.entries(NODE_PINS)) {
      expect(pin.sha256, key).toMatch(/^[a-f0-9]{64}$/)
      expect(pin.archive, key).toContain(NODE_VERSION)
    }
  })

  test("runs from source on the Node of the environment when the workspace is on disk", async () => {
    const { deps, fetched } = fakeDeps({ root: await root(), sourceEntry: () => "/repo/host-entry.ts", env: { UNIFIA_NODE_PATH: "/opt/node" } })
    const launch = await BrowserHostRuntime.resolve(deps)
    expect(launch).toMatchObject({ nodePath: "/opt/node", entry: "/repo/host-entry.ts", stripTypes: true })
    expect(fetched).toEqual([])
  })

  test("UNIFIA_BROWSER_HOST_ENTRY wins over everything and provisions nothing", async () => {
    const { deps, fetched } = fakeDeps({ root: await root(), env: { UNIFIA_BROWSER_HOST_ENTRY: "/custom/entry.ts" } })
    const launch = await BrowserHostRuntime.resolve(deps)
    expect(launch.entry).toBe("/custom/entry.ts")
    expect(fetched).toEqual([])
  })

  test("a build without the host bundle says so instead of guessing", async () => {
    const { deps } = fakeDeps({ root: await root(), loadBundle: async () => undefined })
    await expect(BrowserHostRuntime.resolve(deps)).rejects.toThrow("carries no Browser host")
  })

  test("refuses a Node archive whose hash is not the pinned one, and extracts nothing", async () => {
    const { deps, runs } = fakeDeps({ root: await root() })
    await expect(BrowserHostRuntime.resolve(deps)).rejects.toThrow("pinned SHA-256")
    expect(runs).toEqual([])
  })

  describe("with an archive that matches its pin", () => {
    function matching(directory: string) {
      const archive = new TextEncoder().encode("pretend node archive")
      const pins = { "linux-x64": { ...NODE_PINS["linux-x64"]!, sha256: BrowserHostRuntime.sha256Hex(archive) } }
      return { ...fakeDeps({ root: directory, pins }), restore: () => {} }
    }

    test("downloads Node, installs Playwright, installs Chromium into the runtime directory and writes the host", async () => {
      const directory = await root()
      const { deps, runs, fetched, restore } = matching(directory)
      try {
        const launch = await BrowserHostRuntime.resolve(deps)
        expect(fetched).toEqual([`https://nodejs.org/dist/${NODE_VERSION}/${NODE_PINS["linux-x64"]!.archive}`])
        const summary = runs.map((run) => (run.command === "tar" ? "tar" : run.args.filter((arg) => !arg.startsWith("-") && !arg.endsWith(".js")).join(" ")))
        expect(summary).toEqual(["tar", `install playwright@${PLAYWRIGHT_VERSION}`, "install chromium"])
        const chromium = runs.at(-1)!
        expect(chromium.env?.PLAYWRIGHT_BROWSERS_PATH).toBe(path.join(directory, "browsers"))
        expect(launch.stripTypes).toBe(false)
        expect(launch.env.PLAYWRIGHT_BROWSERS_PATH).toBe(path.join(directory, "browsers"))
        expect(await readFile(launch.entry, "utf8")).toBe("export const host = true")
      } finally {
        restore()
      }
    })

    test("a second call reuses everything and runs no command", async () => {
      const directory = await root()
      const { deps, runs, fetched, restore } = matching(directory)
      try {
        await BrowserHostRuntime.resolve(deps)
        const before = { runs: runs.length, fetched: fetched.length }
        await BrowserHostRuntime.resolve(deps)
        expect({ runs: runs.length, fetched: fetched.length }).toEqual(before)
      } finally {
        restore()
      }
    })

    test("a different host bundle is written again without downloading Node twice", async () => {
      const directory = await root()
      const { deps, fetched, restore } = matching(directory)
      try {
        await BrowserHostRuntime.resolve(deps)
        const launch = await BrowserHostRuntime.resolve({ ...deps, loadBundle: async () => "export const host = 2" })
        expect(await readFile(launch.entry, "utf8")).toBe("export const host = 2")
        expect(fetched).toHaveLength(1)
      } finally {
        restore()
      }
    })
  })
})
