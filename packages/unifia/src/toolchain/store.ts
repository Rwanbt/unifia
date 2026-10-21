// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { chmod, mkdir, readdir, readFile, readlink, rename, rm, stat, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { extract } from "./archive"
import { unpackDeb } from "./deb"
import { artifactFor, closure, type Artifact, type Entry, type Platform } from "./catalog"
import { h1 } from "./digest"
import { download } from "./download"
import { capture } from "./exec"
import { withLock } from "./lock"
import { ownerMarker } from "./proc"

export type Config = { root: string; platform: Platform; launcher: string[]; budget: number }
export type Status = { current?: string; previous?: string; versions: string[] }
type Meta = {
  id: string
  version: string
  bindir: string
  bins: string[]
  libdirs: string[]
  env: Record<string, string[]>
  bytes: number
  installedAt: string
  dropped: string[]
}

const META = ".unifia.json"
const PROBE_TIMEOUT_MS = 30_000

const idDir = (cfg: Config, id: string) => path.join(cfg.root, id)
const versionDir = (cfg: Config, id: string, version: string) => path.join(cfg.root, id, version)
const pointer = (cfg: Config, id: string, name: "current" | "previous") => path.join(cfg.root, id, name)

// Replaces a link atomically: the new link is created beside it and renamed over the old one.
async function point(link: string, target: string) {
  const staged = `${link}.${randomUUID()}`
  await symlink(target, staged)
  await rename(staged, link)
}

async function linkTarget(link: string) {
  return readlink(link).catch(() => undefined)
}

async function readMeta(dir: string): Promise<Meta | undefined> {
  const raw = await readFile(path.join(dir, META), "utf8").catch(() => undefined)
  return raw === undefined ? undefined : (JSON.parse(raw) as Meta)
}

// Plain (non-hidden) directories are toolchain ids; hidden ones hold staging and locks.
async function idsOf(root: string) {
  if (!existsSync(root)) return []
  const items = await readdir(root, { withFileTypes: true })
  return items.filter((item) => item.isDirectory() && !item.name.startsWith(".")).map((item) => item.name)
}

async function metasOf(cfg: Config) {
  const ids = await idsOf(cfg.root)
  const nested = await Promise.all(
    ids.map(async (id) => {
      const versions = await readdir(idDir(cfg, id), { withFileTypes: true })
      const dirs = versions.filter((item) => item.isDirectory()).map((item) => item.name)
      return Promise.all(dirs.map((dir) => readMeta(path.join(idDir(cfg, id), dir))))
    }),
  )
  return nested.flat().filter((meta): meta is Meta => meta !== undefined)
}

// The bytes an artifact occupies on the wire: one archive, or the sum of a deb-set's packages.
function bytesOf(artifact: Artifact) {
  return artifact.packages?.reduce((sum, item) => sum + item.size, 0) ?? artifact.size ?? 0
}

// The variables a run needs, with every path made absolute under the install. A package built for a
// system prefix finds its libraries through the system cache, which is absent here, so LD_LIBRARY_PATH
// names the library directories; a stdlib compiled for /usr is named through its own variable (RUBYLIB).
function installEnv(dir: string, libdirs: string[], vars: Record<string, string[]>) {
  const out: Record<string, string> = {}
  if (libdirs.length > 0) out.LD_LIBRARY_PATH = libdirs.map((item) => path.join(dir, item)).join(":")
  for (const [name, dirs] of Object.entries(vars)) out[name] = dirs.map((item) => path.join(dir, item)).join(":")
  return out
}

// Refuses an artifact that would push the installed bytes over the budget, before any download.
async function reserve(cfg: Config, bytes: number) {
  const used = (await metasOf(cfg)).reduce((sum, meta) => sum + meta.bytes, 0)
  if (used + bytes > cfg.budget) {
    throw new Error(`quota exceeded: ${used} bytes installed, ${bytes} requested, budget ${cfg.budget}`)
  }
}

// Downloads a deb-set package by package, verifies each .deb, and unpacks them into one tree.
// An absolute link that names a path present in this same set becomes a relative link, which is what
// the system does: the JDK keeps its configuration under /etc through one. Any other absolute link would
// reach the host's root, so it is dropped and reported with the package that shipped it.
async function relocate(tree: string, links: { pkg: string; link: string; target: string }[]) {
  const dropped: string[] = []
  for (const item of links) {
    const inside = item.target.slice(1)
    const present = await stat(path.join(tree, inside)).then(() => true, () => false)
    if (!present) {
      dropped.push(`${item.pkg}: ${item.link} -> ${item.target}`)
      continue
    }
    await symlink(path.posix.relative(path.posix.dirname(item.link), inside), path.join(tree, item.link))
  }
  return dropped
}

async function fetchSet(artifact: Artifact, work: string) {
  const tree = path.join(work, "tree")
  const absolute: { pkg: string; link: string; target: string }[] = []
  await mkdir(path.join(work, "debs"), { recursive: true })
  for (const item of artifact.packages ?? []) {
    const file = path.join(work, "debs", `${item.name}.deb`)
    await download(item.url, file, { size: item.size, sha256: item.sha256 })
    const unpacked = await unpackDeb(file, tree)
    absolute.push(...unpacked.absolute.map((link) => ({ pkg: item.name, ...link })))
  }
  const dropped = await relocate(tree, absolute)
  return { root: path.join(tree, artifact.prefix), dropped }
}

// Downloads, verifies and extracts an artifact into `work`, and returns the directory to publish.
async function fetchInto(artifact: Artifact, work: string) {
  if (artifact.archive === "deb-set") return fetchSet(artifact, work)
  const archive = path.join(work, "archive")
  await download(artifact.url ?? "", archive, { size: artifact.size ?? 0, sha256: artifact.sha256, sha512: artifact.sha512 })
  const tree = path.join(work, "tree")
  await extract(archive, artifact.archive, artifact.prefix, tree)
  if (artifact.h1 !== undefined && (await h1(tree)) !== artifact.h1) {
    throw new Error("h1 mismatch: the archive does not match the sum.golang.org record")
  }
  return { root: path.join(tree, artifact.prefix), dropped: [] as string[] }
}

// Marks the declared binaries executable and checks they exist, before the probe runs them.
async function markBins(dir: string, entry: Entry) {
  for (const bin of entry.bins) {
    const file = path.join(dir, entry.bindir, bin)
    if (!existsSync(file)) throw new Error(`missing binary ${bin} for ${entry.id} ${entry.version}`)
    await chmod(file, 0o755)
  }
}

// The probe runs the first declared binary and must print the pinned version. This proves the
// installed file executes and is the expected release, not only that its bytes match a digest.
async function probe(cfg: Config, entry: Entry, dir: string) {
  const bin = path.join(dir, entry.bindir, entry.bins[0]!)
  const env = { ...process.env, ...installEnv(dir, entry.libdirs, entry.env), UNIFIA_OWNER: await ownerMarker() } as Record<string, string>
  const out = await capture([...cfg.launcher, bin, ...entry.probe.args], { timeout: PROBE_TIMEOUT_MS, env })
  return out.code === 0 && `${out.stdout}${out.stderr}`.includes(entry.probe.expect)
}

// A version is published only after its binaries exist and its probe passes. Otherwise it is removed.
async function prove(cfg: Config, entry: Entry, dir: string) {
  await markBins(dir, entry)
  if (await probe(cfg, entry, dir)) return
  await rm(dir, { recursive: true, force: true })
  throw new Error(`probe failed for ${entry.id} ${entry.version}: the installed binary did not print ${entry.probe.expect}`)
}

// Makes `version` current. The previous current becomes `previous`, which is what rollback uses.
async function switchTo(cfg: Config, id: string, version: string) {
  const current = await linkTarget(pointer(cfg, id, "current"))
  if (current !== undefined) await point(pointer(cfg, id, "previous"), current)
  await point(pointer(cfg, id, "current"), version)
}

// Staging residue from an earlier interrupted install of this id is removed under the id's lock.
async function dropResidue(root: string, id: string) {
  const staging = path.join(root, ".staging")
  if (!existsSync(staging)) return
  const names = await readdir(staging)
  await Promise.all(names.filter((name) => name.startsWith(`${id}-`)).map((name) => rm(path.join(staging, name), { recursive: true, force: true })))
}

// Installs one entry if its version is not already present. A new version becomes current.
export async function installEntry(cfg: Config, entry: Entry): Promise<"installed" | "present"> {
  const artifact = artifactFor(entry, cfg.platform)
  if (artifact === undefined) throw new Error(`no ${cfg.platform} artifact for ${entry.id}`)
  return withLock(cfg.root, entry.id, async () => {
    await dropResidue(cfg.root, entry.id)
    const final = versionDir(cfg, entry.id, entry.version)
    if (existsSync(path.join(final, META))) return "present"
    await rm(final, { recursive: true, force: true })
    await reserve(cfg, bytesOf(artifact))
    const work = path.join(cfg.root, ".staging", `${entry.id}-${entry.version}-${randomUUID()}`)
    await mkdir(work, { recursive: true })
    await mkdir(idDir(cfg, entry.id), { recursive: true })
    let dropped: string[] = []
    try {
      const fetched = await fetchInto(artifact, work)
      await rename(fetched.root, final)
      dropped = fetched.dropped
    } finally {
      await rm(work, { recursive: true, force: true })
    }
    await prove(cfg, entry, final)
    const meta: Meta = {
      id: entry.id,
      version: entry.version,
      bindir: entry.bindir,
      bins: entry.bins,
      libdirs: entry.libdirs,
      env: entry.env,
      bytes: bytesOf(artifact),
      installedAt: new Date().toISOString(),
      dropped,
    }
    await writeFile(path.join(final, META), JSON.stringify(meta))
    await switchTo(cfg, entry.id, entry.version)
    return "installed"
  })
}

// Installs a toolchain and its dependencies, dependencies first. Returns the ids newly installed.
export async function install(cfg: Config, catalog: Entry[], id: string) {
  const installed: string[] = []
  for (const entry of closure(catalog, id)) {
    if ((await installEntry(cfg, entry)) === "installed") installed.push(entry.id)
  }
  return installed
}

export async function rollback(cfg: Config, id: string) {
  await withLock(cfg.root, id, async () => {
    const current = await linkTarget(pointer(cfg, id, "current"))
    const previous = await linkTarget(pointer(cfg, id, "previous"))
    if (previous === undefined || current === undefined) throw new Error(`nothing to roll back to for ${id}`)
    await point(pointer(cfg, id, "current"), previous)
    await point(pointer(cfg, id, "previous"), current)
  })
}

// Removes one version. Removing the current one first re-points current to the previous one.
export async function remove(cfg: Config, id: string, version: string) {
  await withLock(cfg.root, id, async () => {
    const current = await linkTarget(pointer(cfg, id, "current"))
    const previous = await linkTarget(pointer(cfg, id, "previous"))
    if (current === version) {
      if (previous !== undefined) {
        await point(pointer(cfg, id, "current"), previous)
        await rm(pointer(cfg, id, "previous"), { force: true })
      } else {
        await rm(pointer(cfg, id, "current"), { force: true })
      }
    } else if (previous === version) {
      await rm(pointer(cfg, id, "previous"), { force: true })
    }
    await rm(versionDir(cfg, id, version), { recursive: true, force: true })
  })
}

export async function status(cfg: Config, id: string): Promise<Status> {
  const dir = idDir(cfg, id)
  const items = existsSync(dir) ? await readdir(dir, { withFileTypes: true }) : []
  const versions = items
    .filter((item) => item.isDirectory() && existsSync(path.join(dir, item.name, META)))
    .map((item) => item.name)
    .sort()
  return {
    current: await linkTarget(pointer(cfg, id, "current")),
    previous: await linkTarget(pointer(cfg, id, "previous")),
    versions,
  }
}

// The bin directories of every current toolchain, in a stable order.
export async function pathFor(cfg: Config) {
  const ids = await idsOf(cfg.root)
  const dirs = await Promise.all(
    ids.map(async (id) => {
      const current = pointer(cfg, id, "current")
      const meta = await readMeta(current)
      return meta === undefined ? undefined : path.join(current, meta.bindir)
    }),
  )
  return dirs.filter((dir): dir is string => dir !== undefined).sort()
}

// Runs an installed binary through the configured launcher, with the toolchain bin dirs on PATH.
export async function execute(
  cfg: Config,
  id: string,
  bin: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string>; timeout?: number } = {},
) {
  const current = pointer(cfg, id, "current")
  const meta = await readMeta(current)
  if (meta === undefined) throw new Error(`${id} is not installed`)
  const PATH = [...(await pathFor(cfg)), "/usr/bin", "/bin"].join(":")
  return capture([...cfg.launcher, path.join(current, meta.bindir, bin), ...args], {
    cwd: opts.cwd,
    env: {
      ...process.env,
      ...opts.env,
      PATH,
      UNIFIA_OWNER: await ownerMarker(),
      ...installEnv(current, meta.libdirs, meta.env),
    } as Record<string, string>,
    timeout: opts.timeout ?? PROBE_TIMEOUT_MS,
  })
}
