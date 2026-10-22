/* SPDX-License-Identifier: MIT */
// Installs, updates, removes and rolls back Alpine toolchains inside the
// on-device rootfs. Every change is: resolve against signed indexes ->
// check the quota -> download -> verify the full trust chain -> extract to
// staging -> one journaled transaction. The previous database is kept so a
// rollback can be replayed from the verified package cache, offline.
import fs from "node:fs"
import path from "node:path"
import { extractEntries } from "./archive"
import { type IndexPackage, loadIndex, resolve, type SigningKey, verifyPackage } from "./repository"
import {
  acquireLock,
  commitTransaction,
  type Database,
  type PackageRecord,
  readDatabase,
  recoverTransaction,
  type StagedPackage,
} from "./transaction"

export interface ToolchainManagerOptions {
  readonly root: string
  readonly state: string
  readonly arch: "aarch64" | "x86_64"
  readonly repositories: readonly string[]
  readonly keys: readonly SigningKey[]
  // Upper bound on the installed size of everything this manager owns.
  readonly quotaBytes: number
  readonly fetchBytes: (url: string) => Promise<Uint8Array>
}

export interface ChangeSummary {
  readonly installed: readonly string[]
  readonly removed: readonly string[]
}

export interface InstalledToolchain {
  readonly name: string
  readonly version: string
  readonly explicit: boolean
  readonly license: string
}

export class ToolchainError extends Error {
  override name = "ToolchainError"
}

const FREE_SPACE_MARGIN_BYTES = 64 * 1024 * 1024

export class ToolchainManager {
  readonly #options: ToolchainManagerOptions
  readonly #cache: string
  readonly #history: string

  constructor(options: ToolchainManagerOptions) {
    this.#options = options
    this.#cache = path.join(options.state, "cache")
    this.#history = path.join(options.state, "previous-db.json")
    for (const dir of [options.root, options.state, this.#cache]) fs.mkdirSync(dir, { recursive: true })
  }

  list(): InstalledToolchain[] {
    return Object.values(readDatabase(this.#options.state).packages).map((record) => ({
      name: record.entry.name,
      version: record.entry.version,
      explicit: record.explicit,
      license: record.entry.license,
    }))
  }

  environment(): { PATH: string } {
    const bins = ["usr/bin", "usr/sbin", "bin", "sbin"].map((dir) => path.join(this.#options.root, dir))
    return { PATH: bins.join(path.delimiter) }
  }

  install(names: readonly string[]): Promise<ChangeSummary> {
    return this.#change((explicit) => [...new Set([...explicit, ...names])])
  }

  remove(names: readonly string[]): Promise<ChangeSummary> {
    return this.#change((explicit) => {
      const missing = names.filter((name) => !explicit.includes(name))
      if (missing.length) throw new ToolchainError(`${missing.join(", ")} is not explicitly installed`)
      return explicit.filter((name) => !names.includes(name))
    })
  }

  update(): Promise<ChangeSummary> {
    return this.#change((explicit) => explicit)
  }

  async rollback(): Promise<ChangeSummary> {
    if (!fs.existsSync(this.#history)) throw new ToolchainError("no previous state to roll back to")
    const previous = JSON.parse(fs.readFileSync(this.#history, "utf8")) as Database
    return this.#locked(async (current) => {
      const records = Object.values(previous.packages)
      // The cached package is re-verified end to end; the network is not used.
      const staged = await this.#stage(records.map((record) => record.entry), current, async (entry) => this.#cached(entry))
      return this.#commit(current, previous, staged)
    })
  }

  async #change(select: (requests: string[]) => string[]): Promise<ChangeSummary> {
    return this.#locked(async (current) => {
      const requests = select([...(current.requests ?? [])])
      const located = await this.#indexes()
      const index = [...located.keys()]
      const closure = resolve(index, requests)
      // resolve() lists dependencies first, so a request's provider is the last entry of its own closure.
      const requested = new Set(requests.map((request) => resolve(index, [request]).at(-1)!.name))
      this.#checkQuota(closure, current)
      const staged = await this.#stage(closure, current, (entry) => this.#download(entry, located.get(entry)!))
      const packages: Record<string, PackageRecord> = {}
      for (const entry of closure) {
        const record = staged.find((item) => item.record.entry.name === entry.name)?.record ?? current.packages[entry.name]!
        packages[entry.name] = { ...record, explicit: requested.has(entry.name) }
      }
      return this.#commit(current, { version: 1, packages, requests }, staged)
    })
  }

  async #locked(work: (current: Database) => Promise<ChangeSummary>): Promise<ChangeSummary> {
    const release = acquireLock(this.#options.state)
    try {
      recoverTransaction(this.#options.root, this.#options.state)
      return await work(readDatabase(this.#options.state))
    } finally {
      release()
    }
  }

  async #indexes(): Promise<Map<IndexPackage, string>> {
    const located = new Map<IndexPackage, string>()
    for (const repository of this.#options.repositories) {
      const bytes = await this.#options.fetchBytes(`${repository}/${this.#options.arch}/APKINDEX.tar.gz`)
      for (const entry of loadIndex(bytes, this.#options.keys)) {
        if (entry.arch === this.#options.arch || entry.arch === "noarch") located.set(entry, repository)
      }
    }
    return located
  }

  #checkQuota(closure: readonly IndexPackage[], current: Database) {
    const installed = closure.reduce((total, entry) => total + entry.installedSize, 0)
    if (installed > this.#options.quotaBytes) {
      throw new ToolchainError(`toolchains would use ${installed} bytes, over the ${this.#options.quotaBytes}-byte quota`)
    }
    const fresh = closure.filter((entry) => current.packages[entry.name]?.entry.version !== entry.version)
    const needed = fresh.reduce((total, entry) => total + entry.size + entry.installedSize, FREE_SPACE_MARGIN_BYTES)
    const disk = fs.statfsSync(this.#options.state)
    if (disk.bavail * disk.bsize < needed) throw new ToolchainError(`not enough free space: ${needed} bytes needed`)
  }

  // Keyed by the control checksum: Alpine rebuilds packages without bumping the version.
  #cachePath(entry: IndexPackage): string {
    const build = Buffer.from(entry.checksum.slice(2), "base64").toString("hex")
    return path.join(this.#cache, `${entry.name}-${entry.version}-${build}.apk`)
  }

  async #cached(entry: IndexPackage): Promise<Uint8Array> {
    const file = this.#cachePath(entry)
    if (!fs.existsSync(file)) throw new ToolchainError(`${entry.name}-${entry.version} is no longer cached`)
    return new Uint8Array(fs.readFileSync(file))
  }

  // Always from the network: a cached file of the same version may have been rebuilt upstream since.
  async #download(entry: IndexPackage, repository: string): Promise<Uint8Array> {
    return this.#options.fetchBytes(`${repository}/${this.#options.arch}/${entry.name}-${entry.version}.apk`)
  }

  async #stage(
    wanted: readonly IndexPackage[],
    current: Database,
    obtain: (entry: IndexPackage) => Promise<Uint8Array>,
  ): Promise<StagedPackage[]> {
    const staged: StagedPackage[] = []
    try {
      for (const entry of wanted) {
        const installed = current.packages[entry.name]?.entry
        if (installed?.version === entry.version && installed.checksum === entry.checksum) continue
        const bytes = await obtain(entry)
        const verified = verifyPackage(bytes, entry, this.#options.keys)
        // Cache only after verification, through a rename so a reader never sees a partial file.
        const temporary = `${this.#cachePath(entry)}.part`
        fs.writeFileSync(temporary, bytes)
        fs.renameSync(temporary, this.#cachePath(entry))
        const stagingDir = fs.mkdtempSync(path.join(this.#options.state, `staging-${entry.name}-`))
        try {
          const files = extractEntries(verified.entries, stagingDir)
          staged.push({ stagingDir, record: { entry, apkSha256: verified.sha256, files, explicit: false } })
        } catch (error) {
          fs.rmSync(stagingDir, { recursive: true, force: true })
          throw error
        }
      }
      return staged
    } catch (error) {
      for (const item of staged) fs.rmSync(item.stagingDir, { recursive: true, force: true })
      throw error
    }
  }

  #commit(current: Database, next: Database, staged: StagedPackage[]): ChangeSummary {
    commitTransaction(this.#options.root, this.#options.state, current, next, staged)
    fs.writeFileSync(this.#history, JSON.stringify(current))
    this.#collectCache(current, next)
    return {
      installed: staged.map((item) => `${item.record.entry.name}@${item.record.entry.version}`),
      removed: Object.keys(current.packages).filter((name) => !next.packages[name]),
    }
  }

  // Keeps exactly what the current and the previous state need, so a rollback stays offline.
  #collectCache(previous: Database, next: Database) {
    const keep = new Set([...Object.values(previous.packages), ...Object.values(next.packages)].map((record) => path.basename(this.#cachePath(record.entry))))
    for (const file of fs.readdirSync(this.#cache)) if (!keep.has(file)) fs.rmSync(path.join(this.#cache, file), { force: true })
  }
}
