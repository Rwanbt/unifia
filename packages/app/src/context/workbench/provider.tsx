/* SPDX-License-Identifier: MIT */

import { createSimpleContext } from "@unifia/ui/context"
import { createWorkbenchTaskIdentity, WorkbenchLifecycle, type WorkbenchConnection, type WorkbenchLifecyclePhase, type WorkbenchTaskIdentity } from "@unifia/workbench-shell"
import { createEffect, createSignal, onCleanup, type ParentProps } from "solid-js"
import { usePlatform } from "@/context/platform"

const READ_CAPABILITIES = ["workspace.read", "workspace.watch", "artifact.export"] as const

const { use, provider: WorkbenchContextProvider } = createSimpleContext({
  name: "WorkspaceWorkbench",
  init: (props: { workspacePath: string; codeSessionId?: string }) => {
    const platform = usePlatform()
    const lifecycle = new WorkbenchLifecycle()
    const [connection, setConnection] = createSignal<WorkbenchConnection>()
    const [phase, setPhase] = createSignal<WorkbenchLifecyclePhase>("initializing")
    const [error, setError] = createSignal<unknown>()
    let pending: Promise<WorkbenchConnection> | undefined
    const [identity, setIdentity] = createSignal<WorkbenchTaskIdentity>(createWorkbenchTaskIdentity({ codeSessionId: props.codeSessionId, workbenchSessionId: crypto.randomUUID() }))

    const unsubscribe = lifecycle.subscribe((state) => {
      setPhase(state.phase)
      if (state.error !== undefined) setError(state.error)
    })

    const ensureConnected = (): Promise<WorkbenchConnection> => {
      const current = connection()
      if (current) return Promise.resolve(current)
      if (pending) return pending
      if (!platform.workbench) {
        const unavailable = new Error("Workbench bridge is unavailable for this workspace")
        setError(unavailable)
        setPhase("failed")
        return Promise.reject(unavailable)
      }
      setError(undefined)
      pending = lifecycle.connect(props.workspacePath, async ({ signal, setPhase: updatePhase, acquire }) => {
        updatePhase("initializing")
        if (signal.aborted) throw signal.reason
        updatePhase("opening")
        const value = await platform.workbench!.connect({ workspacePath: props.workspacePath, capabilities: READ_CAPABILITIES })
        acquire(value.revoke)
        setIdentity(createWorkbenchTaskIdentity({ codeSessionId: props.codeSessionId, workbenchSessionId: crypto.randomUUID() }))
        updatePhase("handshaking")
        setConnection(value)
        return value
      })
      const currentPending = pending
      void currentPending.catch((reason) => { setError(reason) }).finally(() => {
        if (pending === currentPending) pending = undefined
      })
      return currentPending
    }

    const retryConnection = async (): Promise<void> => {
      await lifecycle.retry(props.workspacePath)
      setConnection(undefined)
      setError(undefined)
      setPhase("initializing")
    }

    onCleanup(() => {
      unsubscribe()
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
