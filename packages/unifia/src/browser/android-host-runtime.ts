/* SPDX-License-Identifier: MIT */
/**
 * The Browser host on Android: the same Node host as on the desktop, but the
 * Node, the Chromium and the linker all come from the Alpine rootfs.
 *
 * Nothing the desktop provisions runs here. The pinned Node releases are glibc
 * builds and Playwright's Chromium download has no musl/aarch64 build, while the
 * rootfs already has Node and Alpine packages Chromium. Android refuses to
 * execve a file from app data, so every rootfs program is started as
 * `libmusl_linker.so <program>`; libchromium_exec.so (jni/chromium_exec.c) keeps
 * that working for the processes Chromium and Node start themselves.
 *
 * Chromium (~200 MB installed) is added to the rootfs on first use rather than
 * shipped in the APK, the way the desktop downloads Playwright's Chromium.
 */
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { BrowserHostRuntime } from "./host-runtime"

export namespace AndroidBrowserHost {
  /** Same servers as mobile-entry.ts: musl has no resolv.conf on Android, so the host asks these directly. */
  export const DNS_SERVERS = ["8.8.8.8", "8.8.4.4", "1.1.1.1"] as const
  const CHROMIUM_PACKAGE = "chromium"
  /** Chromium finds its children's libraries here; pulseaudio holds libpulsecommon, which libpulse needs. */
  const LIBRARY_DIRECTORIES = ["usr/lib/chromium", "usr/lib", "lib", "usr/lib/pulseaudio"]
  /**
   * The host is headless and reaches Chromium through Playwright's pipe. No zygote: it forks children that
   * re-exec /proc/self/exe without going through the libc calls libchromium_exec.so rewrites.
   */
  const CHROMIUM_ARGUMENTS = ["--no-zygote", "--disable-dev-shm-usage", "--disable-gpu"]

  export type Device = {
    linker: string
    rootfs: string
    nativeLibraryDirectory: string
  }

  /** The Android runtime, or undefined anywhere else. The sidecar's env names both on Android only. */
  export function detect(env: NodeJS.ProcessEnv): Device | undefined {
    const linker = env.OPENCODE_MOBILE_MUSL_LINKER
    const rootfs = env.OPENCODE_MOBILE_ROOTFS_DIR
    if (!linker || !rootfs) return undefined
    return { linker, rootfs, nativeLibraryDirectory: path.posix.dirname(linker) }
  }

  export type Launch = BrowserHostRuntime.Launch & {
    nodeArgs: readonly string[]
    chromium: { executablePath: string; args: readonly string[] }
    dnsServers: readonly string[]
  }

  export type Dependencies = Pick<BrowserHostRuntime.Dependencies, "root" | "env" | "run" | "loadBundle" | "log">

  export async function resolve(device: Device, deps: Dependencies): Promise<Launch> {
    const bundle = await deps.loadBundle()
    if (!bundle) throw new BrowserHostRuntime.ProvisionError("this build carries no Browser host")
    const loader = loaderArguments(device)
    const executablePath = path.posix.join(device.rootfs, "usr/lib/chromium/chrome")
    await ensureChromium(device, executablePath, deps)

    const directory = path.posix.join(deps.root, `host-${BrowserHostRuntime.PLAYWRIGHT_VERSION}`)
    const env = programEnvironment(device, deps.env)
    await ensurePlaywright(device, loader, directory, env, deps)
    const entry = path.posix.join(directory, "browser-host.mjs")
    if (!existsSync(entry) || (await readFile(entry, "utf8").catch(() => "")) !== bundle) await writeFile(entry, bundle)

    return {
      nodePath: device.linker,
      nodeArgs: [...loader, path.posix.join(device.rootfs, "usr/bin/node")],
      entry,
      stripTypes: false,
      env,
      chromium: { executablePath, args: CHROMIUM_ARGUMENTS },
      dnsServers: DNS_SERVERS,
    }
  }

  /** `--library-path` and `--preload` for the musl linker, ahead of the program path. */
  export function loaderArguments(device: Device): string[] {
    return ["--library-path", libraryPath(device), "--preload", preloadPath(device)]
  }

  function libraryPath(device: Device): string {
    return LIBRARY_DIRECTORIES.map((directory) => path.posix.join(device.rootfs, directory)).join(":")
  }

  /** The seccomp shim turns a SIGSYS from Android's filter into ENOSYS, which Chromium survives. */
  function preloadPath(device: Device): string {
    return ["libseccomp_enosys.so", "libchromium_exec.so"].map((name) => path.posix.join(device.nativeLibraryDirectory, name)).join(":")
  }

  /** What libchromium_exec.so reads, plus what Chromium needs to find its ICU data and fonts inside the rootfs. */
  export function programEnvironment(device: Device, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return {
      ...env,
      UNIFIA_ROOTFS: device.rootfs,
      UNIFIA_MUSL_LINKER: device.linker,
      UNIFIA_MUSL_LIBRARY_PATH: libraryPath(device),
      UNIFIA_MUSL_PRELOAD: preloadPath(device),
      FONTCONFIG_SYSROOT: device.rootfs,
      FONTCONFIG_FILE: path.posix.join(device.rootfs, "etc/fonts/fonts.conf"),
      // Bionic paths in these would be loaded into the musl processes; the linker arguments carry the musl ones.
      LD_LIBRARY_PATH: "",
      LD_PRELOAD: "",
    }
  }

  async function ensureChromium(device: Device, executablePath: string, deps: Dependencies): Promise<void> {
    if (existsSync(executablePath)) return
    deps.log("installing Chromium into the rootfs")
    const apk = path.posix.join(device.rootfs, "sbin/apk")
    // The loader arguments carry the seccomp shim: without it Android's filter kills apk with SIGSYS.
    const args = [...loaderArguments(device), apk, "--root", device.rootfs, "--no-scripts", "--no-cache", "add", CHROMIUM_PACKAGE]
    try {
      await deps.run(device.linker, args, { env: programEnvironment(device, deps.env) })
    } catch (error) {
      // WHY: apk cannot chown to root as an app uid and reports it as errors with a failing exit status, after
      // installing every file. The binary being there is the real outcome; without it the error stands.
      if (!existsSync(executablePath)) throw new BrowserHostRuntime.ProvisionError("installing Chromium failed", { cause: error })
    }
  }

  async function ensurePlaywright(device: Device, loader: readonly string[], directory: string, env: NodeJS.ProcessEnv, deps: Dependencies) {
    if (existsSync(path.posix.join(directory, "node_modules", "playwright", "cli.js"))) return
    deps.log(`installing Playwright ${BrowserHostRuntime.PLAYWRIGHT_VERSION}`)
    await mkdir(directory, { recursive: true })
    await writeFile(path.posix.join(directory, "package.json"), JSON.stringify({ name: "unifia-browser-host", private: true }))
    const npmCli = path.posix.join(device.rootfs, "usr/lib/node_modules/npm/bin/npm-cli.js")
    const node = path.posix.join(device.rootfs, "usr/bin/node")
    await deps.run(
      device.linker,
      [...loader, node, npmCli, "install", `playwright@${BrowserHostRuntime.PLAYWRIGHT_VERSION}`, "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock"],
      { cwd: directory, env },
    )
  }
}
