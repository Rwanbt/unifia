/* SPDX-License-Identifier: MIT */
// Runs containers from stored images under PRoot (ADR-098). Each container
// gets its own writable copy of the image rootfs. PRoot gives it that root
// and emulates root (-0); there is no kernel isolation, and the container
// shares the app's network.
import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import type { ImageConfig, ImageStore } from "./store"

export interface ContainerRuntimeOptions {
  readonly state: string
  readonly store: ImageStore
  // libproot_exec.so on Android (nativeLibraryDir), a host build elsewhere.
  readonly proot: string
  // Set on Android, where the loader cannot be extracted to app data and exec'd.
  readonly loader?: string
  readonly nameservers?: readonly string[]
}

export interface RunOptions {
  readonly command?: readonly string[]
  readonly env?: readonly string[]
  readonly workdir?: string
  readonly name?: string
}

export interface ContainerRecord {
  readonly id: string
  readonly name: string
  readonly image: string
  readonly digest: string
  readonly command: readonly string[]
  readonly created: string
  readonly exitCode?: number
}

const DEFAULT_NAMESERVERS = ["1.1.1.1", "8.8.8.8"]
const CONTAINER_ID_BYTES = 6
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/

// Docker's rule: Entrypoint, then Cmd unless the caller gave a command.
export function containerCommand(config: ImageConfig, command?: readonly string[]): string[] {
  const args = command?.length ? command : (config.Cmd ?? [])
  const full = [...(config.Entrypoint ?? []), ...args]
  if (full.length === 0) throw new Error("the image has no command; pass one")
  return full
}

// Later entries win, as with docker run -e over the image's ENV.
export function containerEnvironment(config: ImageConfig, overrides: readonly string[] = []): Record<string, string> {
  const env: Record<string, string> = { PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", HOME: "/root" }
  for (const entry of [...(config.Env ?? []), ...overrides]) {
    const equals = entry.indexOf("=")
    if (equals > 0) env[entry.slice(0, equals)] = entry.slice(equals + 1)
  }
  return env
}

export function prootArguments(rootfs: string, workdir: string, command: readonly string[]): string[] {
  return ["-0", "-r", rootfs, "-b", "/dev", "-b", "/proc", "-b", "/sys", "-w", workdir, "--kill-on-exit", ...command]
}

export class ContainerRuntime {
  readonly #options: ContainerRuntimeOptions
  readonly #dir: string

  constructor(options: ContainerRuntimeOptions) {
    this.#options = options
    this.#dir = path.join(options.state, "containers")
    fs.mkdirSync(this.#dir, { recursive: true })
  }

  list(): ContainerRecord[] {
    return fs
      .readdirSync(this.#dir)
      .filter((id) => fs.existsSync(path.join(this.#dir, id, "container.json")))
      .map((id) => JSON.parse(fs.readFileSync(path.join(this.#dir, id, "container.json"), "utf8")) as ContainerRecord)
  }

  #save(record: ContainerRecord) {
    const file = path.join(this.#dir, record.id, "container.json")
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(record))
    fs.renameSync(`${file}.tmp`, file)
  }

  #create(image: string, options: RunOptions): { record: ContainerRecord; rootfs: string; config: ImageConfig } {
    const found = this.#options.store.images().find((entry) => entry.name === image || entry.name.endsWith(`/${image}`) || entry.name.endsWith(`/library/${image}`))
    if (!found) throw new Error(`image ${image} is not pulled`)
    const id = randomBytes(CONTAINER_ID_BYTES).toString("hex")
    const name = options.name ?? `unifia-${id}`
    if (!NAME.test(name) || this.list().some((entry) => entry.name === name)) throw new Error(`invalid or taken container name "${name}"`)
    const config = this.#options.store.config(found.digest)
    const rootfs = path.join(this.#dir, id, "rootfs")
    fs.mkdirSync(path.dirname(rootfs))
    fs.cpSync(this.#options.store.rootfs(found.digest), rootfs, { recursive: true, verbatimSymlinks: true })
    // Android has no /etc/resolv.conf to bind, so the container gets its own.
    fs.mkdirSync(path.join(rootfs, "etc"), { recursive: true })
    fs.rmSync(path.join(rootfs, "etc/resolv.conf"), { force: true })
    fs.writeFileSync(path.join(rootfs, "etc/resolv.conf"), (this.#options.nameservers ?? DEFAULT_NAMESERVERS).map((ip) => `nameserver ${ip}\n`).join(""))
    const record = { id, name, image: found.name, digest: found.digest, command: containerCommand(config, options.command), created: new Date().toISOString() }
    this.#save(record)
    return { record, rootfs, config }
  }

  // Runs to completion and returns the exit code; output goes to `onOutput`.
  async run(image: string, options: RunOptions = {}, onOutput: (chunk: string) => void = () => {}): Promise<ContainerRecord> {
    const { record, rootfs, config } = this.#create(image, options)
    const env = {
      ...containerEnvironment(config, options.env),
      PROOT_TMP_DIR: path.join(this.#dir, record.id),
      ...(this.#options.loader ? { PROOT_LOADER: this.#options.loader } : {}),
    }
    const child = spawn(this.#options.proot, prootArguments(rootfs, options.workdir ?? config.WorkingDir ?? "/", record.command), { env, stdio: ["ignore", "pipe", "pipe"] })
    child.stdout.on("data", (chunk) => onOutput(String(chunk)))
    child.stderr.on("data", (chunk) => onOutput(String(chunk)))
    return new Promise((resolve, reject) => {
      child.on("error", reject)
      child.on("close", (code) => {
        const done = { ...record, exitCode: code ?? -1 }
        this.#save(done)
        resolve(done)
      })
    })
  }

  remove(nameOrId: string) {
    const record = this.list().find((entry) => entry.id === nameOrId || entry.name === nameOrId)
    if (!record) throw new Error(`no container ${nameOrId}`)
    fs.rmSync(path.join(this.#dir, record.id), { recursive: true, force: true })
  }
}
