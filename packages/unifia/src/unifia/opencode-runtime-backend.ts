import { Bus } from "@/bus"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionID } from "@/session/schema"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { SessionEventHubRegistry, type OpenCodeRuntimeBackend } from "@unifia/contracts"
import type { RuntimeEvent, SendPromptInput, Session as UnifiaSession } from "@unifia/contracts"

type BusEvent = { type?: string; properties?: Record<string, unknown> }

const log = Log.create({ service: "workbench-opencode-backend" })

/** Where a Workbench workspace lives on disk; undefined until the client opened it. */
export type WorkspaceDirectoryResolver = (workspaceId: string) => string | undefined

// The events stream subscribes to every listed session; a project's most
// recent sessions are the ones a Workbench surface can be showing.
const LISTED_SESSIONS = 100

function toSession(info: Session.Info, workspaceId: string): UnifiaSession {
  return {
    id: info.id,
    workspaceId,
    runtimeId: "opencode",
    createdAt: info.time.created,
    messageCount: 0,
  }
}

function toRuntimeEvent(event: BusEvent, sessionId: string): Omit<RuntimeEvent, "sequence"> {
  const eventType = event.type ?? "opencode.event"
  const type: RuntimeEvent["type"] = eventType.includes("error")
    ? "error"
    : eventType.includes("permission")
      ? "permission"
      : eventType.includes("message") || eventType.includes("part")
        ? "text"
        : "tool-result"
  return { sessionId, type, data: { source: eventType, properties: event.properties ?? {} }, timestamp: Date.now() }
}

/** Concrete OpenCode backend. Policy and audit remain outside this compatibility boundary. */
export class OpenCodeSessionBackend implements OpenCodeRuntimeBackend {
  /**
   * WHY a hub per session: this backend used to create a fresh Bus subscription
   * per call, emit events with no `sequence`, and ignore `afterSequence`
   * entirely. The server therefore never wrote an SSE `id:` line, so a client
   * had nothing to resume from, and a client that reconnected anyway received
   * only what happened next — silently losing everything that arrived while it
   * was away. "Les événements sont rejouables" is a Phase 2 exit criterion and
   * this was the one place it was not met.
   */
  readonly #hubs = new SessionEventHubRegistry()
  readonly #busSubscriptions = new Map<string, () => void>()
  readonly #sessionDirectories = new Map<string, string>()

  /**
   * WHY a resolver: sessions, prompts and the bus are all scoped to a project
   * instance (Instance.provide). The Workbench routes are served outside any
   * instance, so every call here used to throw "No context found for
   * instance" -- the events stream answered 400 on every retry.
   */
  constructor(private readonly directoryOf: WorkspaceDirectoryResolver = () => undefined) {}

  #within<R>(directory: string, fn: () => R): Promise<R> {
    return Instance.provide({ directory, fn, owner: "workbench", reason: "workbench runtime backend" })
  }

  #workspaceDirectory(workspaceId: string): string {
    const directory = this.directoryOf(workspaceId)
    if (!directory) throw new Error(`workspace ${workspaceId} has not been opened on this server`)
    return directory
  }

  #sessionDirectory(sessionId: string): string {
    const directory = this.#sessionDirectories.get(sessionId)
    if (!directory) throw new Error(`session ${sessionId} is unknown to this workbench backend`)
    return directory
  }

  public async listSessions(workspaceId: string): Promise<UnifiaSession[]> {
    const directory = this.#workspaceDirectory(workspaceId)
    return this.#within(directory, () => {
      const sessions: UnifiaSession[] = []
      // A Workbench workspace id ("workspace-...") is not an OpenCode
      // WorkspaceID ("wrk..."): the workspace is the instance's directory.
      for (const info of Session.list({ limit: LISTED_SESSIONS })) {
        this.#sessionDirectories.set(info.id, directory)
        sessions.push(toSession(info, workspaceId))
      }
      return sessions
    })
  }

  public async createSession(workspaceId: string): Promise<UnifiaSession> {
    const directory = this.#workspaceDirectory(workspaceId)
    const info = await this.#within(directory, () => Session.create({}))
    this.#sessionDirectories.set(info.id, directory)
    return toSession(info, workspaceId)
  }

  public async sendPrompt(input: SendPromptInput): Promise<void> {
    await this.#within(this.#sessionDirectory(input.sessionId), () =>
      SessionPrompt.prompt({ sessionID: SessionID.make(input.sessionId), parts: [{ type: "text", text: input.prompt }] }),
    )
  }

  public subscribeEvents(sessionId: string, afterSequence?: number): AsyncIterable<RuntimeEvent> {
    this.#ensureBusSubscription(sessionId)
    return this.#hubs.for(sessionId).subscribe(afterSequence ?? 0)
  }

  /**
   * Attaches to the bus once per session.
   *
   * The subscription outlives any individual reader: a reader that disconnects
   * must not stop the hub from recording what happens while it is away, or the
   * replay it reconnects for would be empty by construction.
   */
  #ensureBusSubscription(sessionId: string): void {
    if (this.#busSubscriptions.has(sessionId)) return
    const directory = this.#sessionDirectories.get(sessionId)
    // A session never listed or created here has no known instance: its hub
    // stays empty rather than failing the whole workspace stream.
    if (!directory) {
      log.warn("event subscription for a session with no known directory", { sessionId })
      return
    }
    const hub = this.#hubs.for(sessionId)
    // The bus is per instance: attach inside the session's own instance. The
    // slot is taken synchronously so a second reader does not attach twice.
    let unsubscribe: (() => void) | undefined
    let released = false
    this.#busSubscriptions.set(sessionId, () => {
      released = true
      unsubscribe?.()
    })
    this.#within(directory, () =>
      Bus.subscribeAll((event: BusEvent) => {
        if ((event.properties ?? {}).sessionID !== sessionId) return
        hub.publish(toRuntimeEvent(event, sessionId))
      }),
    ).then(
      (stop) => {
        if (released) stop()
        else unsubscribe = stop
      },
      (error: unknown) => {
        log.error("bus subscription failed", { sessionId, error: error instanceof Error ? error.message : String(error) })
        this.#busSubscriptions.delete(sessionId)
      },
    )
  }

  public async cancelSession(sessionId: string): Promise<void> {
    await this.#within(this.#sessionDirectory(sessionId), () => SessionPrompt.cancel(SessionID.make(sessionId)))
    this.#release(sessionId)
  }

  /** Releases every session. Call when the backend itself is torn down. */
  public close(): void {
    for (const sessionId of [...this.#busSubscriptions.keys()]) this.#release(sessionId)
  }

  #release(sessionId: string): void {
    this.#busSubscriptions.get(sessionId)?.()
    this.#busSubscriptions.delete(sessionId)
    this.#hubs.close(sessionId)
  }
}
