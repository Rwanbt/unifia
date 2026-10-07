/* SPDX-License-Identifier: MIT */
/**
 * The Bun-side `BrowserSessionManager` that talks to the Node Browser host
 * (ADR-089).
 *
 * Playwright never settles under Bun (#279), so the Browser authority runs in a
 * Node child process and this class is the only thing the server sees of it.
 * It owns three things the host cannot:
 * - the process lifecycle: lazy start, typed failure of every in-flight request
 *   when the host dies, restart on the next call (ADR-089 §5);
 * - the synchronous mirror behind `get`, `forChatSession`, `downloads` and
 *   `activity`, which the contract requires to be synchronous and a process
 *   boundary cannot be (ADR-089 §3);
 * - the two decisions only the server may take: the egress allowlist for a
 *   navigation, and the user's consent to a sensitive action (ADR-089 §2).
 *
 * Nothing here imports Playwright, so loading this file under Bun is safe.
 */
import type {
  BrowserActivityEvent,
  BrowserController,
  BrowserDownload,
  BrowserHistoryAction,
  BrowserInteractionAction,
  BrowserObservation,
  BrowserRuntimeProfile,
  BrowserSession,
  BrowserSessionManager,
  BrowserViewport,
  BrowserViewportInput,
  P3Capability,
} from "@unifia/contracts"
import type { BrowserStorageState } from "../playwright-session-pages.ts"
import {
  BrowserHostProtocolError,
  BrowserHostRemoteError,
  BrowserHostUnavailableError,
  HOST_PROTOCOL_VERSION,
  createLineSplitter,
  decodeBytes,
  decodeFrame,
  encodeBytes,
  encodeFrame,
  type HostAsk,
  type HostEvent,
  type HostInbound,
  type HostOutbound,
  type HostMethod,
  type HostResponse,
  type HostSyncEvent,
} from "./protocol.ts"

/** One live connection to a host process. The client never sees the process itself. */
export type HostTransport = {
  send(line: string): void
  /** Raw stdout chunks; framing is the client's job. */
  onData(listener: (chunk: string) => void): void
  /** Called once, whether the host exited or the transport failed. */
  onExit(listener: (reason: string) => void): void
  kill(): void
}

/** What a (re)started host is seeded with; the encrypted store stays on the Bun side (ADR-089 §4). */
export type HostSeed = {
  sessions: readonly BrowserSession[]
  storage: Readonly<Record<string, BrowserStorageState>>
}

export type BrowserHostClientOptions = {
  /** Spawns a host. Called again after a crash, with a fresh seed. */
  start: (seed: HostSeed) => HostTransport
  /** Read at every (re)start, so a restarted host resumes from what the server persisted. */
  seed: () => HostSeed
  /** The egress decision for a navigation the host is about to make. */
  authorize: (url: string, workspaceId: string) => Promise<boolean>
  /** Every state change, for the server to persist. */
  onSync?: (event: HostSyncEvent) => void
  /** Failures nobody awaits (a fire-and-forget call, a malformed frame). */
  onError?: (error: Error) => void
  /** Runs once `shutdown` has finished, whether or not a host was ever started: the owner's store closes here. */
  onShutdown?: () => void
  readyTimeoutMs?: number
  shutdownTimeoutMs?: number
}

type Pending = { method: HostMethod; resolve: (value: unknown) => void; reject: (error: Error) => void }

const DEFAULT_READY_TIMEOUT_MS = 30_000
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000
const SESSION_UNAVAILABLE = "browser session is unavailable"

type Mirrored = {
  session: BrowserSession
  activity: readonly BrowserActivityEvent[]
  downloads: readonly BrowserDownload[]
}

export class BrowserHostClient implements BrowserSessionManager {
  readonly #options: BrowserHostClientOptions
  readonly #mirror = new Map<string, Mirrored>()
  readonly #capabilities = new Map<string, readonly P3Capability[]>()
  /** Approval callbacks of the `act` calls in flight, which the host's approve asks resolve against. */
  readonly #approvers = new Map<string, (reason: string) => Promise<void>>()
  readonly #pending = new Map<number, Pending>()
  #transport: HostTransport | undefined
  #starting: Promise<HostTransport> | undefined
  #nextId = 1

  #hydrated = false

  constructor(options: BrowserHostClientOptions) {
    this.#options = options
  }

  /**
   * A session persisted by an earlier server run must be readable before the
   * host (started lazily) has announced it. Done on first use rather than at
   * construction, so a server that never opens the Browser never opens the
   * store behind `seed` either.
   */
  #hydrate(): void {
    if (this.#hydrated) return
    this.#hydrated = true
    for (const session of this.#options.seed().sessions) {
      if (session.status !== "closed" && !this.#mirror.has(session.id)) this.#mirror.set(session.id, { session, activity: [], downloads: [] })
    }
  }

  // ── synchronous reads, served from the mirror ───────────────────────────

  get(sessionId: string): BrowserSession {
    this.#hydrate()
    const entry = this.#mirror.get(sessionId)
    if (!entry || entry.session.status === "closed") throw new Error(SESSION_UNAVAILABLE)
    return entry.session
  }

  forChatSession(workspaceId: string, chatSessionId: string): { sessionId: string; capabilities: readonly P3Capability[] } | undefined {
    this.#hydrate()
    for (const { session } of this.#mirror.values()) {
      if (session.workspaceId === workspaceId && session.chatSessionId === chatSessionId && session.status !== "closed") {
        return { sessionId: session.id, capabilities: this.#capabilities.get(session.id) ?? [] }
      }
    }
    return undefined
  }

  downloads(sessionId: string): readonly BrowserDownload[] {
    this.get(sessionId)
    return this.#mirror.get(sessionId)?.downloads ?? []
  }

  activity(sessionId: string, after = 0): readonly BrowserActivityEvent[] {
    this.get(sessionId)
    return (this.#mirror.get(sessionId)?.activity ?? []).filter((event) => event.sequence > after)
  }

  // ── session lifecycle ───────────────────────────────────────────────────

  async create(input: {
    workspaceId: string
    chatSessionId?: string
    runtimeProfile: BrowserRuntimeProfile
    viewport: BrowserViewport
    capabilities?: readonly P3Capability[]
  }): Promise<BrowserSession> {
    this.#hydrate()
    const session = (await this.#call("session.create", input)) as BrowserSession
    this.#capabilities.set(session.id, [...new Set(input.capabilities ?? [])])
    this.#remember(session)
    return session
  }

  bindCapabilities(sessionId: string, capabilities: readonly P3Capability[]): void {
    this.#capabilities.set(sessionId, [...new Set(capabilities)])
    // The contract makes this synchronous. The host only keeps the list for its
    // own gating, so a failure is reported rather than thrown at a caller that
    // has already moved on.
    this.#call("session.bindCapabilities", { sessionId, capabilities }).catch((error) => this.#report(error))
  }

  async openTab(sessionId: string, url?: string): Promise<BrowserSession> {
    return this.#session("session.openTab", { sessionId, ...(url === undefined ? {} : { url }) })
  }

  async navigate(sessionId: string, tabId: string, url: string, controller: "user" | "ai", approvedOrigin?: string): Promise<BrowserSession> {
    return this.#session("session.navigate", { sessionId, tabId, url, controller, ...(approvedOrigin === undefined ? {} : { approvedOrigin }) })
  }

  async history(sessionId: string, tabId: string, action: BrowserHistoryAction): Promise<BrowserSession> {
    return this.#session("session.history", { sessionId, tabId, action })
  }

  async resizeViewport(sessionId: string, viewport: BrowserViewport): Promise<BrowserSession> {
    return this.#session("session.resizeViewport", { sessionId, viewport })
  }

  async refreshTab(sessionId: string, tabId: string): Promise<BrowserSession> {
    return this.#session("session.refreshTab", { sessionId, tabId })
  }

  async selectTab(sessionId: string, tabId: string): Promise<BrowserSession> {
    return this.#session("session.selectTab", { sessionId, tabId })
  }

  async closeTab(sessionId: string, tabId: string): Promise<BrowserSession> {
    return this.#session("session.closeTab", { sessionId, tabId })
  }

  async takeControl(sessionId: string, controller: BrowserController): Promise<BrowserSession> {
    return this.#session("session.takeControl", { sessionId, controller })
  }

  async close(sessionId: string): Promise<void> {
    await this.#call("session.close", { sessionId })
    this.#capabilities.delete(sessionId)
  }

  // ── page interaction ────────────────────────────────────────────────────

  async observe(sessionId: string, tabId: string): Promise<{ receipt: BrowserObservation; modelText: string }> {
    return (await this.#call("session.observe", { sessionId, tabId })) as { receipt: BrowserObservation; modelText: string }
  }

  async actionApprovalRequirement(sessionId: string, tabId: string, observationId: string, action: BrowserInteractionAction): Promise<string | undefined> {
    const reason = await this.#call("session.actionApprovalRequirement", { sessionId, tabId, observationId, action })
    return typeof reason === "string" ? reason : undefined
  }

  async act(
    sessionId: string,
    tabId: string,
    observationId: string,
    action: BrowserInteractionAction,
    approveSensitiveAction?: (reason: string) => Promise<void>,
  ): Promise<void> {
    // The host asks for consent by session, and the callback belongs to this
    // call, so it is registered for exactly as long as the call is in flight.
    if (approveSensitiveAction) this.#approvers.set(sessionId, approveSensitiveAction)
    try {
      await this.#call("session.act", { sessionId, tabId, observationId, action })
    } finally {
      if (approveSensitiveAction && this.#approvers.get(sessionId) === approveSensitiveAction) this.#approvers.delete(sessionId)
    }
  }

  async input(sessionId: string, tabId: string, action: BrowserViewportInput): Promise<void> {
    await this.#call("session.input", { sessionId, tabId, action })
  }

  async upload(sessionId: string, tabId: string, file: { name: string; mediaType: string; bytes: Uint8Array }): Promise<void> {
    await this.#call("session.upload", { sessionId, tabId, name: file.name, mediaType: file.mediaType, base64: encodeBytes(file.bytes) })
  }

  async screenshot(sessionId: string, tabId: string): Promise<Uint8Array> {
    const result = (await this.#call("session.screenshot", { sessionId, tabId })) as { base64: string }
    return decodeBytes(result.base64)
  }

  async releaseDownload(sessionId: string, downloadId: string): Promise<BrowserDownload> {
    return (await this.#call("session.releaseDownload", { sessionId, downloadId })) as BrowserDownload
  }

  /** Stops the host. Safe to call when it never started. */
  async shutdown(): Promise<void> {
    const transport = this.#transport
    if (!transport) {
      this.#options.onShutdown?.()
      return
    }
    const timeoutMs = this.#options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        this.#call("host.shutdown", {}),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs)
        }),
      ])
    } catch (error) {
      // The host dying while it shuts down is the outcome we wanted.
      if (!(error instanceof BrowserHostUnavailableError)) this.#report(error)
    } finally {
      clearTimeout(timer)
      transport.kill()
      this.#options.onShutdown?.()
    }
  }

  // ── host plumbing ───────────────────────────────────────────────────────

  async #session(method: HostMethod, params: Record<string, unknown>): Promise<BrowserSession> {
    const session = (await this.#call(method, params)) as BrowserSession
    this.#remember(session)
    return session
  }

  /** A response can overtake the sync that describes it; recording both keeps `get` right either way. */
  #remember(session: BrowserSession): void {
    const entry = this.#mirror.get(session.id)
    if (!entry || entry.session.updatedAt <= session.updatedAt) {
      this.#mirror.set(session.id, { session, activity: entry?.activity ?? [], downloads: entry?.downloads ?? [] })
    }
  }

  async #call(method: HostMethod, params: unknown): Promise<unknown> {
    const transport = await this.#ensureStarted()
    const id = this.#nextId++
    return new Promise<unknown>((resolve, reject) => {
      this.#pending.set(id, { method, resolve, reject })
      try {
        transport.send(encodeFrame({ id, method, params }))
      } catch (error) {
        this.#pending.delete(id)
        reject(new BrowserHostUnavailableError(`the Browser host rejected ${method}`, { cause: error }))
      }
    })
  }

  #ensureStarted(): Promise<HostTransport> {
    if (this.#transport) return Promise.resolve(this.#transport)
    this.#starting ??= this.#start().finally(() => {
      this.#starting = undefined
    })
    return this.#starting
  }

  #start(): Promise<HostTransport> {
    this.#hydrate()
    return new Promise<HostTransport>((resolve, reject) => {
      let transport: HostTransport
      try {
        transport = this.#options.start(this.#options.seed())
      } catch (error) {
        reject(new BrowserHostUnavailableError("the Browser host could not be started", { cause: error }))
        return
      }
      const timeoutMs = this.#options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS
      let ready = false
      const timer = setTimeout(() => {
        if (ready) return
        transport.kill()
        reject(new BrowserHostUnavailableError(`the Browser host was not ready after ${timeoutMs} ms`))
      }, timeoutMs)
      const settleReady = () => {
        ready = true
        clearTimeout(timer)
        this.#transport = transport
        resolve(transport)
      }
      const split = createLineSplitter((line) => this.#receive(transport, line, settleReady))
      transport.onData((chunk) => {
        split(chunk)
      })
      transport.onExit((reason) => {
        clearTimeout(timer)
        if (!ready) reject(new BrowserHostUnavailableError(`the Browser host exited before it was ready: ${reason}`))
        this.#lost(transport, reason)
      })
    })
  }

  #receive(transport: HostTransport, line: string, onReady: () => void): void {
    let frame: HostInbound | HostOutbound
    try {
      frame = decodeFrame(line)
    } catch (error) {
      // A stream that stops parsing cannot be trusted for the next frame either.
      this.#report(error)
      transport.kill()
      return
    }
    if ("event" in frame) {
      this.#onEvent(frame, onReady)
      return
    }
    if ("request" in frame) {
      void this.#answer(transport, frame)
      return
    }
    if ("method" in frame) {
      this.#report(new BrowserHostProtocolError("the Browser host sent a request, which only the server may send"))
      transport.kill()
      return
    }
    this.#settle(frame)
  }

  #onEvent(event: HostEvent, onReady: () => void): void {
    if (event.event === "ready") {
      if (event.version !== HOST_PROTOCOL_VERSION) {
        this.#report(new BrowserHostProtocolError(`the Browser host speaks protocol ${event.version}, expected ${HOST_PROTOCOL_VERSION}`))
        this.#transport?.kill()
        return
      }
      onReady()
      return
    }
    this.#mirror.set(event.session.id, { session: event.session, activity: event.activity, downloads: event.downloads })
    this.#options.onSync?.(event)
  }

  #settle(response: HostResponse): void {
    const pending = this.#pending.get(response.id)
    if (!pending) return
    this.#pending.delete(response.id)
    if (response.error) pending.reject(new BrowserHostRemoteError(response.error))
    else pending.resolve(response.result)
  }

  async #answer(transport: HostTransport, ask: HostAsk): Promise<void> {
    const approved = await this.#decide(ask).catch((error) => {
      // An ask that cannot be answered is a refusal: consent is never assumed.
      this.#report(error)
      return false
    })
    try {
      transport.send(encodeFrame({ id: ask.id, result: { approved } }))
    } catch (error) {
      this.#report(error)
    }
  }

  async #decide(ask: HostAsk): Promise<boolean> {
    if (ask.request === "authorize") return this.#options.authorize(ask.url, ask.workspaceId)
    const approver = this.#approvers.get(ask.sessionId)
    if (!approver) return false
    try {
      await approver(ask.reason)
      return true
    } catch {
      return false
    }
  }

  /** The host is gone: fail what was waiting, mark what it owned, and let the next call restart it. */
  #lost(transport: HostTransport, reason: string): void {
    if (this.#transport === transport) this.#transport = undefined
    const error = new BrowserHostUnavailableError(`the Browser host stopped: ${reason}`)
    for (const [id, pending] of this.#pending) {
      this.#pending.delete(id)
      pending.reject(error)
    }
    this.#approvers.clear()
    for (const [id, entry] of this.#mirror) {
      if (entry.session.status === "closed") continue
      this.#mirror.set(id, { ...entry, session: { ...entry.session, status: "error" } })
    }
  }

  #report(error: unknown): void {
    this.#options.onError?.(error instanceof Error ? error : new Error(String(error)))
  }
}
