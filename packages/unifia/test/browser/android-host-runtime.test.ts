/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { AndroidBrowserHost } from "../../src/browser/android-host-runtime"
import { BrowserHostRuntime } from "../../src/browser/host-runtime"

const BUNDLE = "// the host"

async function device(): Promise<AndroidBrowserHost.Device> {
  const base = (await mkdtemp(path.join(tmpdir(), "unifia-android-host-"))).replaceAll("\\", "/")
  return { linker: `${base}/lib/libmusl_linker.so`, rootfs: `${base}/rootfs`, nativeLibraryDirectory: `${base}/lib` }
}

type Run = { command: string; args: readonly string[]; env?: NodeJS.ProcessEnv }

/** apk "installs" chrome and npm "installs" Playwright by creating the files the real ones would. */
function fakeDeps(target: AndroidBrowserHost.Device, overrides: Partial<AndroidBrowserHost.Dependencies> = {}) {
  const runs: Run[] = []
  const deps: AndroidBrowserHost.Dependencies = {
    root: `${target.rootfs}/../data`,
    env: { HTTPS_PROXY: "http://127.0.0.1:9", LD_PRELOAD: "/bionic/lib.so" },
    loadBundle: async () => BUNDLE,
    log: () => {},
    run: async (command, args, options) => {
      runs.push({ command, args, env: options.env })
      if (args.includes("add")) {
        await mkdir(`${target.rootfs}/usr/lib/chromium`, { recursive: true })
        await writeFile(`${target.rootfs}/usr/lib/chromium/chrome`, "")
      }
      if (args.includes("install")) {
        await mkdir(path.join(options.cwd!, "node_modules", "playwright"), { recursive: true })
        await writeFile(path.join(options.cwd!, "node_modules", "playwright", "cli.js"), "")
      }
    },
    ...overrides,
  }
  return { deps, runs }
}

describe("AndroidBrowserHost", () => {
  test("detect_OutsideAndroid_ReturnsUndefined", () => {
    expect(AndroidBrowserHost.detect({})).toBeUndefined()
    expect(AndroidBrowserHost.detect({ OPENCODE_MOBILE_MUSL_LINKER: "/n/libmusl_linker.so" })).toBeUndefined()
  })

  test("detect_OnAndroid_DerivesNativeLibraryDirectoryFromLinker", () => {
    expect(AndroidBrowserHost.detect({ OPENCODE_MOBILE_MUSL_LINKER: "/n/libmusl_linker.so", OPENCODE_MOBILE_ROOTFS_DIR: "/r" })).toEqual({
      linker: "/n/libmusl_linker.so",
      rootfs: "/r",
      nativeLibraryDirectory: "/n",
    })
  })

  test("resolve_FirstUse_InstallsChromiumAndPlaywrightThroughTheLinker", async () => {
    const target = await device()
    const { deps, runs } = fakeDeps(target)
    const launch = await AndroidBrowserHost.resolve(target, deps)

    expect(runs).toHaveLength(2)
    expect(runs.every((run) => run.command === target.linker)).toBe(true)
    expect(runs[0]!.args).toContain(`${target.rootfs}/sbin/apk`)
    expect(runs[0]!.args.slice(-2)).toEqual(["add", "chromium"])
    expect(runs[1]!.args).toContain(`playwright@${BrowserHostRuntime.PLAYWRIGHT_VERSION}`)
    // Bionic preloads must never reach a musl process, and every musl process gets the seccomp shim.
    expect(runs.every((run) => run.env?.LD_PRELOAD === "")).toBe(true)
    expect(runs.every((run) => run.args.includes(`${target.nativeLibraryDirectory}/libseccomp_enosys.so:${target.nativeLibraryDirectory}/libchromium_exec.so`))).toBe(true)

    expect(launch.nodePath).toBe(target.linker)
    expect(launch.nodeArgs.at(-1)).toBe(`${target.rootfs}/usr/bin/node`)
    expect(launch.chromium.executablePath).toBe(`${target.rootfs}/usr/lib/chromium/chrome`)
    expect(launch.env.UNIFIA_ROOTFS).toBe(target.rootfs)
    expect(launch.env.UNIFIA_MUSL_PRELOAD).toBe(`${target.nativeLibraryDirectory}/libseccomp_enosys.so:${target.nativeLibraryDirectory}/libchromium_exec.so`)
    expect(launch.env.HTTPS_PROXY).toBe("http://127.0.0.1:9")
    expect(await readFile(launch.entry, "utf8")).toBe(BUNDLE)
  })

  test("resolve_AlreadyProvisioned_RunsNothing", async () => {
    const target = await device()
    const first = fakeDeps(target)
    await AndroidBrowserHost.resolve(target, first.deps)
    const second = fakeDeps(target, { root: first.deps.root })
    await AndroidBrowserHost.resolve(target, second.deps)
    expect(second.runs).toHaveLength(0)
  })

  test("resolve_ApkFailsButChromeIsInstalled_Continues", async () => {
    const target = await device()
    const { deps } = fakeDeps(target)
    const run = deps.run
    deps.run = async (command, args, options) => {
      await run(command, args, options)
      if (args.includes("add")) throw new Error("ERROR: 814 errors updating directory permissions")
    }
    await expect(AndroidBrowserHost.resolve(target, deps)).resolves.toBeDefined()
  })

  test("resolve_ApkFailsWithoutChrome_ThrowsProvisionError", async () => {
    const target = await device()
    const { deps } = fakeDeps(target, {
      run: async () => {
        throw new Error("network down")
      },
    })
    await expect(AndroidBrowserHost.resolve(target, deps)).rejects.toBeInstanceOf(BrowserHostRuntime.ProvisionError)
  })

  test("resolve_NoBundle_ThrowsProvisionError", async () => {
    const target = await device()
    const { deps } = fakeDeps(target, { loadBundle: async () => undefined })
    await expect(AndroidBrowserHost.resolve(target, deps)).rejects.toBeInstanceOf(BrowserHostRuntime.ProvisionError)
  })
})
