// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

/**
 * Tests for src/toolchain/store.ts: install, execute, update, rollback, remove, quota, locks.
 *
 * Each test serves a real .tar.gz from a local HTTP server and installs it through the real
 * download, digest, extraction, probe and pointer code. The tool inside is a real POSIX shell
 * script that is executed. Only the origin of the URL differs from production, because the
 * manifest refuses plain http; every entry is still produced by parse().
 */
import { afterAll, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { chmod, mkdir, readFile, readlink, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { parse, type Entry } from "../../src/toolchain/catalog"
import {
  execute,
  install,
  installEntry,
  pathFor,
  remove,
  rollback,
  status,
  type Config,
} from "../../src/toolchain/store"

const served = new Map<string, Uint8Array<ArrayBuffer>>()
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    const bytes = served.get(new URL(req.url).pathname)
    return bytes ? new Response(bytes) : new Response("not found", { status: 404 })
  },
})
afterAll(() => server.stop(true))

type Archive = { size: number; sha256: string; url: string }
type Spec = { name: string; version: string; archive?: Archive; depends?: string[] }

// Builds <name>-<version>.tar.gz whose bin/<name> prints "<name> <version>" and exits 0. With
// `broken`, it prints a different version, so the probe must reject it.
async function build(dir: string, name: string, version: string, broken = false): Promise<Archive> {
  const top = path.join(dir, "src", `${name}-${version}`, "bin")
  await mkdir(top, { recursive: true })
  const printed = broken ? `${name} 0.0.0` : `${name} ${version}`
  await writeFile(path.join(top, name), `#!/bin/sh\necho "${printed}"\n`)
  await chmod(path.join(top, name), 0o755)
  const file = path.join(dir, `${name}-${version}.tgz`)
  const proc = Bun.spawn(["tar", "-czf", file, "-C", path.join(dir, "src"), `${name}-${version}`])
  await proc.exited
  const bytes = new Uint8Array(await Bun.file(file).arrayBuffer())
  const key = `/${name}-${version}.tgz`
  served.set(key, bytes)
  return {
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    url: `http://127.0.0.1:${server.port}${key}`,
  }
}

// Parses a manifest for the specs as one catalog, then points each artifact at its served archive.
function catalogFor(specs: Spec[]): Entry[] {
  const parsed = parse(
    specs.map((spec) => ({
      id: spec.name,
      name: spec.name,
      version: spec.version,
      license: "MIT",
      bins: [spec.name],
      depends: spec.depends ?? [],
      probe: { args: ["--version"], expect: `${spec.name} ${spec.version}` },
      artifacts: [
        {
          platform: "linux-x64",
          url: "https://registry.npmjs.org/tool.tgz",
          archive: "tar.gz",
          prefix: `${spec.name}-${spec.version}`,
          size: spec.archive?.size ?? 1,
          sha256: spec.archive?.sha256 ?? "a".repeat(64),
        },
      ],
    })),
  )
  return parsed.map((entry, i) => ({
    ...entry,
    artifacts: entry.artifacts.map((item) => ({ ...item, url: specs[i]!.archive!.url })),
  }))
}

async function config(dir: string, budget = 1_000_000_000): Promise<Config> {
  return { root: path.join(dir, "toolchains"), platform: "linux-x64", launcher: [], budget }
}

// Names left in the staging area; an empty list means nothing half-installed survived.
async function leftovers(cfg: Config) {
  const dir = path.join(cfg.root, ".staging")
  return existsSync(dir) ? Array.fromAsync(new Bun.Glob("*").scan(dir)) : []
}

test("installs a verified tool, probes it and makes it current", async () => {
  await using tmp = await tmpdir()
  const cfg = await config(tmp.path)
  const [tool] = catalogFor([{ name: "tool", version: "1.0.0", archive: await build(tmp.path, "tool", "1.0.0") }])

  expect(await installEntry(cfg, tool!)).toBe("installed")
  expect((await status(cfg, "tool")).current).toBe("1.0.0")

  const out = await execute(cfg, "tool", "tool", ["--version"])
  expect(out.code).toBe(0)
  expect(out.stdout.trim()).toBe("tool 1.0.0")
})

test("an update keeps the previous version and rollback restores it", async () => {
  await using tmp = await tmpdir()
  const cfg = await config(tmp.path)
  const [v1] = catalogFor([{ name: "tool", version: "1.0.0", archive: await build(tmp.path, "tool", "1.0.0") }])
  const [v2] = catalogFor([{ name: "tool", version: "2.0.0", archive: await build(tmp.path, "tool", "2.0.0") }])
  await installEntry(cfg, v1!)
  await installEntry(cfg, v2!)
  expect(await status(cfg, "tool")).toEqual({ current: "2.0.0", previous: "1.0.0", versions: ["1.0.0", "2.0.0"] })
  expect((await execute(cfg, "tool", "tool", ["--version"])).stdout.trim()).toBe("tool 2.0.0")

  await rollback(cfg, "tool")
  expect((await status(cfg, "tool")).current).toBe("1.0.0")
  expect((await execute(cfg, "tool", "tool", ["--version"])).stdout.trim()).toBe("tool 1.0.0")
})

test("reinstalling a version that is already present changes no pointer", async () => {
  await using tmp = await tmpdir()
  const cfg = await config(tmp.path)
  const [v1] = catalogFor([{ name: "tool", version: "1.0.0", archive: await build(tmp.path, "tool", "1.0.0") }])
  const [v2] = catalogFor([{ name: "tool", version: "2.0.0", archive: await build(tmp.path, "tool", "2.0.0") }])
  await installEntry(cfg, v1!)
  await installEntry(cfg, v2!)
  expect(await installEntry(cfg, v1!)).toBe("present")
  expect((await status(cfg, "tool")).current).toBe("2.0.0")
})

test("removing the current version re-points current to the previous one", async () => {
  await using tmp = await tmpdir()
  const cfg = await config(tmp.path)
  const [v1] = catalogFor([{ name: "tool", version: "1.0.0", archive: await build(tmp.path, "tool", "1.0.0") }])
  const [v2] = catalogFor([{ name: "tool", version: "2.0.0", archive: await build(tmp.path, "tool", "2.0.0") }])
  await installEntry(cfg, v1!)
  await installEntry(cfg, v2!)
  await remove(cfg, "tool", "2.0.0")
  expect(await status(cfg, "tool")).toEqual({ current: "1.0.0", previous: undefined, versions: ["1.0.0"] })
  expect(existsSync(path.join(cfg.root, "tool", "2.0.0"))).toBe(false)
  expect((await execute(cfg, "tool", "tool", ["--version"])).stdout.trim()).toBe("tool 1.0.0")
})

test("a version that fails its probe is never published and leaves the current pointer alone", async () => {
  await using tmp = await tmpdir()
  const cfg = await config(tmp.path)
  const [good] = catalogFor([{ name: "tool", version: "1.0.0", archive: await build(tmp.path, "tool", "1.0.0") }])
  await installEntry(cfg, good!)
  const bad = await build(tmp.path, "tool", "2.0.0", true)
  const [broken] = catalogFor([{ name: "tool", version: "2.0.0", archive: bad }])
  await expect(installEntry(cfg, broken!)).rejects.toThrow("probe")
  expect(existsSync(path.join(cfg.root, "tool", "2.0.0"))).toBe(false)
  expect((await status(cfg, "tool")).current).toBe("1.0.0")
  expect(await leftovers(cfg)).toEqual([])
})

test("a digest mismatch installs nothing and leaves no staging residue", async () => {
  await using tmp = await tmpdir()
  const cfg = await config(tmp.path)
  const archive = await build(tmp.path, "tool", "1.0.0")
  const [wrong] = catalogFor([{ name: "tool", version: "1.0.0", archive: { ...archive, sha256: "0".repeat(64) } }])
  await expect(installEntry(cfg, wrong!)).rejects.toThrow("sha256 mismatch")
  expect(existsSync(path.join(cfg.root, "tool", "1.0.0"))).toBe(false)
  expect(await leftovers(cfg)).toEqual([])
})

test("the quota refuses an artifact before anything is downloaded", async () => {
  await using tmp = await tmpdir()
  const cfg = await config(tmp.path, 10)
  const [tool] = catalogFor([{ name: "tool", version: "1.0.0", archive: await build(tmp.path, "tool", "1.0.0") }])
  await expect(installEntry(cfg, tool!)).rejects.toThrow("quota")
  expect(existsSync(path.join(cfg.root, "tool", "1.0.0"))).toBe(false)
})

test("a lock left by a dead process is reclaimed", async () => {
  await using tmp = await tmpdir()
  const cfg = await config(tmp.path)
  const lock = path.join(cfg.root, ".locks", "tool")
  await mkdir(lock, { recursive: true })
  await writeFile(path.join(lock, "owner.json"), JSON.stringify({ pid: 2147483646, start: 1 }))
  const [tool] = catalogFor([{ name: "tool", version: "1.0.0", archive: await build(tmp.path, "tool", "1.0.0") }])
  expect(await installEntry(cfg, tool!)).toBe("installed")
  expect(existsSync(lock)).toBe(false)
})

test("pathFor lists the bin directory of every current toolchain", async () => {
  await using tmp = await tmpdir()
  const cfg = await config(tmp.path)
  const [tool] = catalogFor([{ name: "tool", version: "1.0.0", archive: await build(tmp.path, "tool", "1.0.0") }])
  await installEntry(cfg, tool!)
  expect(await pathFor(cfg)).toEqual([path.join(cfg.root, "tool", "current", "bin")])
  expect(await readlink(path.join(cfg.root, "tool", "current"))).toBe("1.0.0")
})

test("install resolves the dependency closure and installs dependencies first", async () => {
  await using tmp = await tmpdir()
  const cfg = await config(tmp.path)
  const catalog = catalogFor([
    { name: "app", version: "1.0.0", archive: await build(tmp.path, "app", "1.0.0"), depends: ["lib"] },
    { name: "lib", version: "1.0.0", archive: await build(tmp.path, "lib", "1.0.0") },
  ])
  expect(await install(cfg, catalog, "app")).toEqual(["lib", "app"])
  expect((await execute(cfg, "app", "app", ["--version"])).stdout.trim()).toBe("app 1.0.0")
})

// Builds a real .deb in the Debian layout: data.tar.zst with ./-prefixed paths, wrapped by ar.
async function buildDeb(dir: string, name: string, files: Record<string, string>, links: Record<string, string> = {}) {
  const src = path.join(dir, "debsrc", name)
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(src, rel)), { recursive: true })
    await writeFile(path.join(src, rel), body)
    if (rel.includes("/bin/")) await chmod(path.join(src, rel), 0o755)
  }
  for (const [rel, target] of Object.entries(links)) {
    await mkdir(path.dirname(path.join(src, rel)), { recursive: true })
    await symlink(target, path.join(src, rel))
  }
  const run = async (cmd: string[], cwd: string) => (await Bun.spawn(cmd, { cwd }).exited) === 0
  await writeFile(path.join(src, "debian-binary"), "2.0\n")
  await run(["tar", "-cf", "data.tar", "-C", src, "."], src)
  await run(["zstd", "-q", "-f", "--rm", "data.tar"], src)
  const file = path.join(dir, `${name}.deb`)
  await run(["ar", "rcs", file, "debian-binary", "data.tar.zst"], src)
  const bytes = new Uint8Array(await Bun.file(file).arrayBuffer())
  const key = `/${name}.deb`
  served.set(key, bytes)
  return { size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex"), url: `http://127.0.0.1:${server.port}${key}` }
}

test("installs a deb-set: each package is verified, unpacked into one tree, and run with its library path", async () => {
  await using tmp = await tmpdir()
  const cfg = await config(tmp.path)
  const bin = await buildDeb(tmp.path, "tool", { "usr/bin/tool": '#!/bin/sh\necho "tool 1.0.0 $LD_LIBRARY_PATH"\n' })
  const lib = await buildDeb(tmp.path, "tool-lib", { "usr/lib/tool/libtool.so.1": "x" })
  const [parsed] = parse([
    {
      id: "tool",
      name: "Tool",
      version: "1.0.0",
      license: "MIT",
      bindir: "usr/bin",
      bins: ["tool"],
      libdirs: ["usr/lib/tool"],
      probe: { args: ["--version"], expect: "tool 1.0.0" },
      artifacts: [
        {
          platform: "linux-x64",
          archive: "deb-set",
          packages: [
            { name: "tool", version: "1.0.0", url: "https://ports.ubuntu.com/ubuntu-ports/pool/main/t/tool.deb", size: bin.size, sha256: bin.sha256 },
            { name: "tool-lib", version: "1.0.0", url: "https://ports.ubuntu.com/ubuntu-ports/pool/main/t/tool-lib.deb", size: lib.size, sha256: lib.sha256 },
          ],
        },
      ],
    },
  ])
  const tool: Entry = {
    ...parsed!,
    artifacts: parsed!.artifacts.map((item) => ({
      ...item,
      packages: item.packages?.map((pkg) => ({ ...pkg, url: pkg.name === "tool" ? bin.url : lib.url })),
    })),
  }

  expect(await installEntry(cfg, tool)).toBe("installed")
  expect(await Bun.file(path.join(cfg.root, "tool", "1.0.0", "usr", "lib", "tool", "libtool.so.1")).exists()).toBe(true)
  const out = await execute(cfg, "tool", "tool", ["--version"])
  expect(out.stdout).toContain(path.join(cfg.root, "tool", "current", "usr", "lib", "tool"))
})

test("an absolute link into the same package set becomes a relative link; any other absolute link is dropped and recorded", async () => {
  await using tmp = await tmpdir()
  const cfg = await config(tmp.path)
  const conf = await buildDeb(tmp.path, "app-conf", { "etc/app/app.conf": "x=1\n" })
  const tool = await buildDeb(
    tmp.path,
    "tool",
    { "usr/bin/tool": '#!/bin/sh\necho "tool 1.0.0"\n' },
    { "usr/share/tool/conf": "/etc/app", "etc/rmt": "/usr/sbin/rmt" },
  )
  const [parsed] = parse([
    {
      id: "tool",
      name: "Tool",
      version: "1.0.0",
      license: "MIT",
      bins: ["tool"],
      bindir: "usr/bin",
      probe: { args: ["--version"], expect: "tool 1.0.0" },
      artifacts: [
        {
          platform: "linux-x64",
          archive: "deb-set",
          packages: [
            { name: "tool", version: "1.0.0", url: "https://ports.ubuntu.com/t.deb", size: tool.size, sha256: tool.sha256 },
            { name: "app-conf", version: "1.0.0", url: "https://ports.ubuntu.com/c.deb", size: conf.size, sha256: conf.sha256 },
          ],
        },
      ],
    },
  ])
  const entry: Entry = {
    ...parsed!,
    artifacts: parsed!.artifacts.map((item) => ({
      ...item,
      packages: item.packages?.map((pkg) => ({ ...pkg, url: pkg.name === "tool" ? tool.url : conf.url })),
    })),
  }
  expect(await installEntry(cfg, entry)).toBe("installed")
  const root = path.join(cfg.root, "tool", "1.0.0")
  expect(await readFile(path.join(root, "usr", "share", "tool", "conf", "app.conf"), "utf8")).toBe("x=1\n")
  expect(await readlink(path.join(root, "usr", "share", "tool", "conf"))).toBe("../../../etc/app")
  const meta = JSON.parse(await readFile(path.join(root, ".unifia.json"), "utf8")) as { dropped: string[] }
  expect(meta.dropped).toEqual(["tool: etc/rmt -> /usr/sbin/rmt"])
  expect(existsSync(path.join(root, "etc", "rmt"))).toBe(false)
})
