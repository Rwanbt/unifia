/* SPDX-License-Identifier: MIT */
import { WorkspaceStorage } from "./storage.js"
import { createHash, randomBytes } from "node:crypto"
import { promises as fs, watch as watchFiles, type FSWatcher } from "node:fs"
import path from "node:path"
import type {
  FileEvent,
  FileReadResult,
  FileSessionId,
  FileWrite,
  FileWriteResult,
  Workspace,
  WorkspaceHandle,
  WorkspaceId,
  WorkspacePort,
} from "@unifia/contracts"

type Session = { workspace: Workspace; token: string; closed: boolean; watchers: Set<() => void> }

export type WorkspaceRuntimeOptions = {
  maxReadBytes?: number
  maxWriteBytes?: number
  now?: () => number
}

const DEFAULT_MAX_READ_BYTES = 4 * 1024 * 1024
const DEFAULT_MAX_WRITE_BYTES = 4 * 1024 * 1024

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}

function assertRelative(input: string): void {
  if (!input || input.includes("\0") || path.isAbsolute(input)) throw new Error("workspace path must be relative")
  const normalized = path.posix.normalize(input.replaceAll("\\", "/"))
  if (normalized === ".." || normalized.startsWith("../")) throw new Error("workspace path escapes root")
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function mimeFor(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === ".json") return "application/json"
  if (extension === ".md" || extension === ".txt") return "text/plain; charset=utf-8"
  if (extension === ".ts" || extension === ".tsx" || extension === ".js") return "text/plain; charset=utf-8"
  return "application/octet-stream"
}

export class WorkspaceRuntime implements WorkspacePort {
  readonly #workspaces = new Map<WorkspaceId, Workspace>()
  readonly #sessions = new Map<FileSessionId, Session>()
  readonly #now: () => number
  readonly #maxReadBytes: number
  readonly #maxWriteBytes: number

  constructor(options: WorkspaceRuntimeOptions = {}) {
    this.#now = options.now ?? Date.now
    this.#maxReadBytes = options.maxReadBytes ?? DEFAULT_MAX_READ_BYTES
    this.#maxWriteBytes = options.maxWriteBytes ?? DEFAULT_MAX_WRITE_BYTES
  }

  async register(input: { name: string; path: string }): Promise<Workspace> {
    const root = await fs.realpath(input.path)
    const stat = await fs.stat(root)
    if (!stat.isDirectory()) throw new Error("workspace root must be a directory")
    const id = `workspace-${sha256(root).slice(0, 24)}`
    const existing = this.#workspaces.get(id)
    if (existing) return { ...existing, updatedAt: this.#now() }
    const workspace: Workspace = { id, name: input.name.trim() || path.basename(root), path: root, createdAt: this.#now(), updatedAt: this.#now() }
    this.#workspaces.set(id, workspace)
    return { ...workspace }
  }

  async open(id: WorkspaceId): Promise<WorkspaceHandle> {
    const workspace = this.#workspaces.get(id)
    if (!workspace) throw new Error("workspace is not registered")
    const token = randomBytes(24).toString("base64url")
    this.#sessions.set(token, { workspace, token, closed: false, watchers: new Set() })
    return { id, token }
  }

  async read(sessionId: FileSessionId, paths: string[]): Promise<FileReadResult[]> {
    const session = this.#session(sessionId)
    const results: FileReadResult[] = []
    let total = 0
    for (const relative of paths) {
      const absolute = await this.#resolveExisting(session.workspace.path, relative)
      const content = await fs.readFile(absolute)
      total += content.byteLength
      if (total > this.#maxReadBytes) throw new Error("workspace read quota exceeded")
      results.push({ path: relative, content, mime: mimeFor(relative), size: content.byteLength })
    }
    return results
  }

  async write(sessionId: FileSessionId, writes: FileWrite[]): Promise<FileWriteResult[]> {
    const session = this.#session(sessionId)
    const prepared: Array<{ input: FileWrite; absolute: string; content: Buffer }> = []
    let total = 0
    for (const input of writes) {
      const absolute = await this.#resolveExisting(session.workspace.path, input.path)
      const content = typeof input.content === "string" ? Buffer.from(input.content) : Buffer.from(input.content)
      total += content.byteLength
      if (total > this.#maxWriteBytes) throw new Error("workspace write quota exceeded")
      prepared.push({ input, absolute, content })
    }
    const results: FileWriteResult[] = []
    for (const { input, absolute, content } of prepared) {
      const temporary = path.join(path.dirname(absolute), `.${path.basename(absolute)}.${randomBytes(8).toString("hex")}.tmp`)
      await fs.writeFile(temporary, content, { flag: "wx" })
      try {
        await fs.rename(temporary, absolute)
      } catch (error) {
        await fs.rm(temporary, { force: true })
        throw error
      }
      results.push({ path: input.path, bytesWritten: content.byteLength, sha: sha256(content) })
    }
    return results
  }
  watch(sessionId: FileSessionId): AsyncIterable<FileEvent> {
    const session = this.#session(sessionId)
    const queue: FileEvent[] = []
    const waiters: Array<(result: IteratorResult<FileEvent>) => void> = []
    let closed = false
    let sequence = 0
    const watcher: FSWatcher = watchFiles(session.workspace.path, { recursive: true }, (eventType, filename) => {
      if (closed || !filename) return
      const relative = filename.toString().replaceAll("\\", "/")
      const event: FileEvent = { type: eventType === "rename" ? "renamed" : "modified", path: relative, timestamp: this.#now() + sequence++ / 1000 }
      const waiter = waiters.shift()
      if (waiter) waiter({ done: false, value: event })
      else queue.push(event)
    })
    const close = () => {
      if (closed) return
      closed = true
      watcher.close()
      for (const waiter of waiters.splice(0)) waiter({ done: true, value: undefined })
    }
    return {
      [Symbol.asyncIterator]: () => ({
        next: (): Promise<IteratorResult<FileEvent>> => {
          const event = queue.shift()
          if (event) return Promise.resolve({ done: false, value: event })
          if (closed) return Promise.resolve({ done: true, value: undefined })
          return new Promise((resolve) => waiters.push(resolve))
        },
        return: async (): Promise<IteratorResult<FileEvent>> => { close(); return { done: true, value: undefined } },
      }),
    }
  }

  async health(workspaceId: WorkspaceId) {
    const workspace = this.#workspaces.get(workspaceId)
    if (!workspace) throw new Error("workspace is not registered")
    return new WorkspaceStorage(workspace.path).health(workspace.id)
  }

  async close(sessionId: FileSessionId): Promise<void> {
    const session = this.#sessions.get(sessionId)
    if (!session) return
    session.closed = true
    this.#sessions.delete(sessionId)
  }

  async #resolveExisting(root: string, relative: string): Promise<string> {
    assertRelative(relative)
    const candidate = await fs.realpath(path.resolve(root, relative))
    if (!isInside(root, candidate)) throw new Error("workspace path escapes root")
    const stat = await fs.stat(candidate)
    if (!stat.isFile()) throw new Error("workspace path is not a file")
    return candidate
  }

  #session(id: FileSessionId): Session {
    const session = this.#sessions.get(id)
    if (!session || session.closed) throw new Error("file session is closed or unknown")
    return session
  }
}
export * from "./storage.js"
