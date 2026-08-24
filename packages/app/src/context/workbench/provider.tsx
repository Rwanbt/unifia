/* SPDX-License-Identifier: MIT */

import { createSimpleContext } from "@unifia/ui/context"
import { SURFACE_LEASE_CAPABILITIES, WorkbenchEventDispatcher, createWorkbenchTaskIdentity, WorkbenchLifecycle, type WorkbenchConnection, type WorkbenchLifecyclePhase, type WorkbenchTaskIdentity } from "@unifia/workbench-shell"
import { useQueryClient } from "@tanstack/solid-query"
import { createSignal, onCleanup, type ParentProps } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { decideEventRetry } from "./event-retry"
import { createCoalescedInvalidate } from "./query-invalidation"

/** Delay before reconnecting after the stream closes cleanly (not an error, so decideEventRetry's backoff does not apply). */
const EVENT_RECONNECT_DELAY_MS = 1_000

const { use, provider: WorkbenchContextProvider } = createSimpleContext({
  name: "WorkspaceWorkbench",
  init: (props: { workspacePath: string; codeSessionId?: string }) => {
    const platform = usePlatform()
    const queryClient = useQueryClient()
    const language = useLanguage()
    const t = language.t
    const lifecycle = new WorkbenchLifecycle()
    const [connection, setConnection] = createSignal<WorkbenchConnection>()
    const [phase, setPhase] = createSignal<WorkbenchLifecyclePhase>("initializing")
    const [error, setError] = createSignal<unknown>()
    let pending: Promise<WorkbenchConnection> | undefined
    let eventsAbort = new AbortController()
    let eventsTask: Promise<void> | undefined
    // E14: one coalescer per provider instance. The window (50 ms by
    // default) collapses bursts of identical events into a single
    // invalidation batch, satisfying the E14 oracle
    // « 100 événements identiques produisent un fetch utile ».
    const coalesced = createCoalescedInvalidate(queryClient)
    const [identity, setIdentity] = createSignal<WorkbenchTaskIdentity>(createWorkbenchTaskIdentity({ codeSessionId: props.codeSessionId, workbenchSessionId: crypto.randomUUID() }))

    const unsubscribe = lifecycle.subscribe((state) => {
      setPhase(state.phase)
      if (state.error !== undefined) setError(state.error)
    })

    const startEvents = (value: WorkbenchConnection) => {
      if (eventsTask) return
      const dispatcher = new WorkbenchEventDispatcher()
      eventsTask = (async () => {
        let attempt = 0
        while (!eventsAbort.signal.aborted) {
          try {
            for await (const event of value.client.events(value.workspaceId, dispatcher, eventsAbort.signal)) {
              if (event.workspaceId !== value.workspaceId) continue
              attempt = 0
              // E12 + E14: invalidation is scoped by `event.resource`
              // (E12) AND batched within a 50 ms window (E14). The
              // mapping is pure and unit-tested in
              // query-invalidation.test.ts; this call site is
              // intentionally a single line so the side-effecting
              // path cannot drift.
              coalesced.enqueue(value, event)
            }
            attempt = 0
          } catch (reason) {
            if (eventsAbort.signal.aborted) return
            console.warn(t("workbench.errors.eventStreamDisconnected"), reason)
            attempt += 1
            const decision = decideEventRetry(attempt, reason)
            if (decision.action === "stop") {
              setError(reason)
              return
            }
            if (eventsAbort.signal.aborted) return
            await new Promise((resolve) => setTimeout(resolve, decision.delayMs))
            continue
          }
          if (eventsAbort.signal.aborted) return
          await new Promise((resolve) => setTimeout(resolve, EVENT_RECONNECT_DELAY_MS))
        }
      })().finally(() => { eventsTask = undefined })
    }

    const ensureConnected = (): Promise<WorkbenchConnection> => {
      const current = connection()
      if (current) return Promise.resolve(current)
      if (pending) return pending
      if (!platform.workbench) {
        const unavailable = new Error(t("workbench.errors.bridgeUnavailable"))
        setError(unavailable)
        setPhase("failed")
        return Promise.reject(unavailable)
      }
      setError(undefined)
      pending = lifecycle.connect(props.workspacePath, async ({ signal, setPhase: updatePhase, acquire }) => {
        updatePhase("initializing")
        if (signal.aborted) throw signal.reason
        updatePhase("opening")
        const value = await platform.workbench!.connect({ workspacePath: props.workspacePath, capabilities: SURFACE_LEASE_CAPABILITIES })
        acquire(value.revoke)
        setIdentity(createWorkbenchTaskIdentity({ codeSessionId: props.codeSessionId, workbenchSessionId: crypto.randomUUID() }))
        updatePhase("handshaking")
        setConnection(value)
        startEvents(value)
        return value
      })
      const currentPending = pending
      void currentPending.catch((reason) => { setError(reason) }).finally(() => {
        if (pending === currentPending) pending = undefined
      })
      return currentPending
    }

    const retryConnection = async (): Promise<void> => {
      eventsAbort.abort()
      await eventsTask?.catch(() => undefined)
      eventsAbort = new AbortController()
      await lifecycle.retry(props.workspacePath)
      setConnection(undefined)
      setError(undefined)
      setPhase("initializing")
    }

    onCleanup(() => {
      unsubscribe()
      eventsAbort.abort()
      coalesced.stop()
      void lifecycle.shutdown()
    })

    const loading = () => pending !== undefined || ["initializing", "opening", "issuing", "handshaking", "rolling_back"].includes(phase())
    return {
      connection,
      phase,
      loading,
      error,
      identity,
      beginOperation: () => setIdentity({ ...identity(), operationId: crypto.randomUUID() }),
      ensureConnected,
      retryConnection,
    }
  },
})

export const WorkspaceWorkbenchProvider = (props: ParentProps<{ workspacePath: string; codeSessionId?: string }>) => (
  <WorkbenchContextProvider workspacePath={props.workspacePath} codeSessionId={props.codeSessionId}>{props.children}</WorkbenchContextProvider>
)

export const useWorkspaceWorkbench = use
