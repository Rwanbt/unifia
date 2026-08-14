import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { createQuery } from "@tanstack/solid-query"
import { useMode } from "@/context/mode"
import { useWorkspaceWorkbench } from "@/context/workbench/provider"
import { workbenchQueryKey } from "@/context/workbench/query-keys"
import { base64Encode } from "@unifia/util/encode"
import { useNavigate } from "@solidjs/router"
import {
  createDesignPreviewPanelState,
  createDesignSpecPanelState,
  createMobileNavigationModel,
  WORK_V1_FUNCTIONS,
  type WorkFunction,
} from "@unifia/workbench-shell"

const labelFor = (operation: WorkFunction) => operation.replaceAll("-", " ")
const decodeFile = (value: { content: string; encoding: "utf-8" | "base64" }) => value.encoding === "utf-8" ? value.content : new TextDecoder().decode(Uint8Array.from(atob(value.content), (char) => char.charCodeAt(0)))

function WorkSurface() {
  const mode = useMode()
  const workbench = useWorkspaceWorkbench()
  const connection = workbench.connection
  const navigate = useNavigate()
  const retryConnection = workbench.retryConnection
  createEffect(() => { void workbench.ensureConnected().catch(() => undefined) })
  const [activeOperation, setActiveOperation] = createSignal<WorkFunction>("documents")
  const [exportState, setExportState] = createSignal<"idle" | "running" | "success" | "error">("idle")
  const [exportMessage, setExportMessage] = createSignal("")
  const documents = createQuery(() => ({ queryKey: workbenchQueryKey(connection(), "documents"), enabled: !!connection(), queryFn: () => connection()!.client.listDocuments(connection()!.workspaceId) }))
  const artifacts = createQuery(() => ({ queryKey: workbenchQueryKey(connection(), "artifacts"), enabled: !!connection(), queryFn: () => connection()!.client.listArtifacts(connection()!.workspaceId) }))
  const files = createQuery(() => ({ queryKey: workbenchQueryKey(connection(), "files", { prefix: "." }), enabled: !!connection(), queryFn: () => connection()!.client.listFiles(connection()!.workspaceId) }))
  const navigation = createMemo(() =>
    createMobileNavigationModel({ viewportWidth: window.innerWidth, documents: documents.data?.documents.length ?? 0, designPreviews: 0, active: activeOperation() }),
  )

  async function exportFirstArtifact(): Promise<void> {
    const artifact = artifacts.data?.artifacts[0]
    const current = connection()
    if (!artifact || !current || exportState() === "running") return
    setExportState("running")
    setExportMessage("")
    try {
      workbench.beginOperation()
      const result = await current.client.exportArtifact(current.workspaceId, artifact.artifactId)
      if ("approvalId" in result && result.approvalId) {
        setExportState("error")
        setExportMessage(`Approval required: ${result.approvalId}`)
      } else if ("exported" in result) {
        setExportState("success")
        setExportMessage(`Exported ${result.exported.relativePath}`)
      } else {
        setExportState("error")
        setExportMessage("Export was accepted but has no result yet")
      }
    } catch (error) {
      setExportState("error")
      setExportMessage(error instanceof Error ? error.message : "Artifact export failed")
    }
  }

  function openArtifactInCode(): void {
    const artifact = artifacts.data?.artifacts[0]
    if (!artifact || !mode.directory()) return
    const session = mode.sessionId()
    const target = `/${base64Encode(mode.directory())}/session${session ? `/${encodeURIComponent(session)}` : ""}?artifact=${encodeURIComponent(artifact.artifactId)}`
    navigate(target)
  }

  const connectionError = () => { const error = workbench.error(); return error instanceof Error ? error.message : error ? String(error) : "" }

  return (
    <section class="size-full overflow-auto p-6 md:p-10" data-workbench-surface="work">
      <div class="mx-auto max-w-5xl space-y-8">
        <header class="space-y-2">
          <p class="text-12-medium uppercase tracking-wide text-text-weak">Work</p>
          <h1 class="text-24-medium">Workspace operations</h1>
          <p class="max-w-2xl text-14-regular text-text-weak">Read-only workspace surfaces are derived from the shared Work registry and keep their scope explicit.</p>
          <p data-workbench-connection={connection()?.instanceId ? "connected" : workbench.error() ? "failed" : workbench.loading() ? "connecting" : "unavailable"} class="text-12-regular text-text-weak">
            {connection()?.instanceId ? `Connected to Workbench instance ${connection()!.instanceId}` : workbench.loading() ? "Connecting to the native Workbench bridge" : connectionError() || "Native Workbench bridge unavailable"}
          </p>
          <Show when={workbench.error()}>
            <button type="button" data-workbench-retry class="rounded border border-border-base px-3 py-2 text-12-medium" onClick={() => retryConnection()}>Retry connection</button>
          </Show>
        </header>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-workbench-navigation={navigation().layout}>
          <For each={WORK_V1_FUNCTIONS}>
            {(operation) => (
              <button
                type="button"
                class="w-full rounded-lg border border-border-base bg-background-stronger p-4 text-left transition-colors hover:bg-background-strong"
                classList={{ "border-border-focus": activeOperation() === operation }}
                data-workbench-operation={operation}
                aria-pressed={activeOperation() === operation}
                onClick={() => setActiveOperation(operation)}
              >
                <div class="flex items-center justify-between gap-3">
                  <h2 class="text-14-medium capitalize">{labelFor(operation)}</h2>
                  <Show when={activeOperation() === operation}>
                    <span class="text-12-medium text-text-success">Active</span>
                  </Show>
                </div>
                <p class="mt-2 text-12-regular text-text-weak">
                  {operation === "documents" ? `${navigation().workCount} documents` : operation === "artifacts" ? `${artifacts.data?.artifacts.length ?? 0} artifacts` : operation === "files" ? `${files.data?.entries.length ?? 0} files` : operation === "export" ? "Exports the first persisted artifact" : "Scoped to this workspace"}
                </p>
              </button>
            )}
          </For>
        </div>
        <div class="rounded-lg border border-border-base bg-background-stronger p-5" data-workbench-selected-operation={activeOperation()}>
          <p class="text-12-medium uppercase tracking-wide text-text-weak">Selected operation</p>
          <h2 class="mt-2 text-18-medium capitalize">{labelFor(activeOperation())}</h2>
          <p class="mt-2 text-14-regular text-text-weak">This surface keeps the operation scoped to the active workspace and routes writes through the existing approval boundary.</p>
          <Show when={activeOperation() === "export"}>
            <button type="button" data-workbench-open-artifact class="mt-4 mr-2 rounded border border-border-base px-3 py-2 text-12-medium disabled:opacity-50" disabled={!artifacts.data?.artifacts.length} onClick={openArtifactInCode}>
              Open artifact in Code
            </button>
            <button type="button" data-workbench-export class="mt-4 rounded border border-border-base px-3 py-2 text-12-medium disabled:opacity-50" disabled={!artifacts.data?.artifacts.length || exportState() === "running"} onClick={() => void exportFirstArtifact()}>
              {exportState() === "running" ? "Exporting…" : "Export first artifact"}
            </button>
            <Show when={exportMessage()}>
              <p data-workbench-export-result={exportState()} class="mt-3 text-12-regular text-text-weak">{exportMessage()}</p>
            </Show>
          </Show>
        </div>
      </div>
    </section>
  )
}

function DesignSurface() {
  const workbench = useWorkspaceWorkbench()
  const connection = workbench.connection
  const retryConnection = workbench.retryConnection
  createEffect(() => { void workbench.ensureConnected().catch(() => undefined) })
  const manifest = createQuery(() => ({ queryKey: workbenchQueryKey(connection(), "design-systems"), enabled: !!connection(), queryFn: () => connection()!.client.listDesignSystems(connection()!.workspaceId) }))
  const [source, setSource] = createSignal("")
  const spec = createMemo(() => createDesignSpecPanelState({ kind: "inline", value: source() }))
  const preview = createMemo(() => createDesignPreviewPanelState(spec()))
  const validation = createQuery(() => ({
    queryKey: workbenchQueryKey(connection(), "spec-validation", { source: source() }),
    enabled: !!connection() && source().trim().length > 0 && spec().diagnostics.length === 0,
    staleTime: 5_000,
    queryFn: () => connection()!.client.validateSpec(connection()!.workspaceId, source()),
  }))
  const connectionError = () => { const error = workbench.error(); return error instanceof Error ? error.message : error ? String(error) : "" }

  return (
    <section class="size-full overflow-auto p-6 md:p-10" data-workbench-surface="design">
      <div class="mx-auto max-w-6xl space-y-8">
        <header class="space-y-2">
          <p class="text-12-medium uppercase tracking-wide text-text-weak">Design</p>
          <h1 class="text-24-medium">Validated responsive preview</h1>
          <p class="max-w-2xl text-14-regular text-text-weak">The preview is produced only after workspace manifest and spec validation and is loaded as an inert image source.</p>
        </header>
        <p data-design-connection={connection()?.instanceId ? "connected" : workbench.error() ? "failed" : workbench.loading() ? "connecting" : "unavailable"} class="text-12-regular text-text-weak">
          {connection()?.instanceId ? `Connected to Workbench instance ${connection()!.instanceId}` : workbench.loading() ? "Connecting to the native Workbench bridge" : connectionError() || "Native Workbench bridge unavailable"}
        </p>
        <Show when={workbench.error()}>
          <button type="button" data-design-retry class="rounded border border-border-base px-3 py-2 text-12-medium" onClick={() => retryConnection()}>Retry connection</button>
        </Show>
        <Show when={manifest.error}>
          <p data-design-manifest="failed" class="text-14-regular text-text-danger">{manifest.error instanceof Error ? manifest.error.message : String(manifest.error)}</p>
        </Show>
        <Show when={manifest.data?.designSystems.length}>
          <div class="grid gap-3 md:grid-cols-2" data-design-catalog-count={manifest.data!.designSystems.length}>
            <For each={manifest.data!.designSystems}>
              {(catalog) => (
                <article class="rounded-lg border border-border-base bg-background-stronger p-4" data-design-catalog={catalog.id}>
                  <h2 class="text-14-medium">{catalog.name} · {catalog.version}</h2>
                  <p class="mt-2 text-12-regular text-text-weak">Source: {catalog.source}</p>
                </article>
              )}
            </For>
          </div>
        </Show>
        <Show when={!manifest.isLoading && !manifest.error && manifest.data?.designSystems.length === 0}>
          <p data-design-manifest="empty" class="text-14-regular text-text-danger">No validated design-system manifest is available for this workspace.</p>
        </Show>
        <label class="block space-y-2" for="workbench-design-spec">
          <span class="text-14-medium">Design spec</span>
          <textarea
            id="workbench-design-spec"
            class="min-h-48 w-full rounded-lg border border-border-base bg-background-stronger p-4 font-mono text-12-regular text-text-base"
            placeholder="Paste a validated workspace design spec"
            value={source()}
            onInput={(event) => setSource(event.currentTarget.value)}
            spellcheck={false}
          />
        </label>
        <Show when={spec().diagnostics.length > 0}>
          <aside class="rounded-lg border border-border-danger bg-background-stronger p-4" data-workbench-diagnostics>
            <h2 class="text-14-medium text-text-danger">Spec diagnostics</h2>
            <For each={spec().diagnostics}>
              {(diagnostic) => <p class="mt-2 text-12-regular text-text-weak">Line {diagnostic.line}, column {diagnostic.column}: {diagnostic.message}</p>}
            </For>
          </aside>
        </Show>
        <Show when={validation.isLoading}>
          <p data-design-validation="loading" class="text-12-regular text-text-weak">Validating the spec against the workspace policy…</p>
        </Show>
        <Show when={validation.error}>
          <p data-design-validation="failed" class="text-14-regular text-text-danger">{validation.error instanceof Error ? validation.error.message : String(validation.error)}</p>
        </Show>
        <Show when={validation.data?.capabilities.denied.length}>
          <p data-design-validation="denied" class="text-14-regular text-text-danger">The spec requests capabilities that are not granted: {validation.data!.capabilities.denied.join(", ")}.</p>
        </Show>
        <Show when={validation.data?.valid === true && validation.data.capabilities.denied.length === 0 && preview().previews.length > 0} fallback={<p class="text-14-regular text-text-danger">{spec().diagnostics[0]?.message ?? "Enter a valid workspace design spec to render a preview."}</p>}>
          <div class="grid gap-5 md:grid-cols-3" data-workbench-preview-count={preview().previews.length}>
            <For each={preview().previews}>
              {(item) => (
                <figure class="overflow-hidden rounded-lg border border-border-base bg-background-stronger p-3">
                  <img class="w-full rounded-md" src={item.src} width={item.width} alt={`${item.label} preview`} />
                  <figcaption class="mt-3 text-12-medium capitalize text-text-weak">{item.label} · {item.width}px</figcaption>
                </figure>
              )}
            </For>
          </div>
        </Show>
      </div>
    </section>
  )
}

function AutomateSurface() {
  const workbench = useWorkspaceWorkbench()
  const connection = workbench.connection
  createEffect(() => { void workbench.ensureConnected().catch(() => undefined) })
  const definitions = createQuery(() => ({ queryKey: workbenchQueryKey(connection(), "files", { prefix: ".unifia/workflows" }), enabled: !!connection(), queryFn: () => connection()!.client.listFiles(connection()!.workspaceId, ".unifia/workflows") }))
  const [selectedDefinition, setSelectedDefinition] = createSignal<string>()
  const [workflowState, setWorkflowState] = createSignal<string>()
  const [workflowError, setWorkflowError] = createSignal<string>()
  const [approvalId, setApprovalId] = createSignal<string>()
  const [pendingDefinition, setPendingDefinition] = createSignal<Record<string, unknown>>()
  const definitionFile = createQuery(() => ({ queryKey: workbenchQueryKey(connection(), "file", { path: selectedDefinition() ?? "" }), enabled: !!connection() && !!selectedDefinition(), queryFn: () => connection()!.client.readFiles(connection()!.workspaceId, [selectedDefinition()!]) }))
  async function startDefinition(definition: Record<string, unknown>): Promise<void> {
    const current = connection()
    if (!current) return
    workbench.beginOperation()
    const result = await current.client.startWorkflow(current.workspaceId, definition)
    if ("approvalRequired" in result) {
      setApprovalId(result.approvalId)
      setPendingDefinition(definition)
      setWorkflowState("approval_required")
      return
    }
    setApprovalId(undefined)
    setPendingDefinition(undefined)
    setWorkflowState(result.state.status)
    setWorkflowError(undefined)
  }

  async function startSelectedWorkflow(): Promise<void> {
    const current = connection()
    const file = definitionFile.data?.results[0]
    if (!current || !file) return
    try {
      const definition = JSON.parse(decodeFile(file)) as Record<string, unknown>
      if (typeof definition.id !== "string" || definition.version !== 1 || !Array.isArray(definition.steps)) throw new Error("Workflow definition must contain id, version 1 and steps")
      await startDefinition(definition)
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : "Workflow start failed")
    }
  }
  async function resolveWorkflowApproval(decision: "allow" | "deny"): Promise<void> {
    const current = connection()
    const id = approvalId()
    if (!current || !id) return
    try {
      const result = await current.client.resolveApproval(id, decision)
      if (decision === "allow" && result.decision.kind === "allow" && pendingDefinition()) await startDefinition(pendingDefinition()!)
      else {
        setApprovalId(undefined)
        setPendingDefinition(undefined)
        setWorkflowState(result.decision.kind)
      }
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : "Approval decision failed")
    }
  }
  async function cancelWorkflowApproval(): Promise<void> {
    const current = connection()
    const id = approvalId()
    if (!current || !id) return
    try {
      await current.client.cancelApproval(id)
      setApprovalId(undefined)
      setPendingDefinition(undefined)
      setWorkflowState("cancelled")
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : "Approval cancellation failed")
    }
  }
  const connectionError = () => { const error = workbench.error(); return error instanceof Error ? error.message : error ? String(error) : "" }

  return (
    <section class="size-full overflow-auto p-6 md:p-10" data-workbench-surface="automate">
      <div class="mx-auto max-w-5xl space-y-8">
        <header class="space-y-2">
          <p class="text-12-medium uppercase tracking-wide text-text-weak">Automate</p>
          <h1 class="text-24-medium">Workspace automation definitions</h1>
          <p class="max-w-2xl text-14-regular text-text-weak">Automation v0 reads only validated workflow definitions from the active workspace. Execution is unavailable until an explicit workflow contract is provided.</p>
          <p data-automate-connection={connection()?.instanceId ? "connected" : workbench.error() ? "failed" : workbench.loading() ? "connecting" : "unavailable"} class="text-12-regular text-text-weak">
            {connection()?.instanceId ? `Connected to Workbench instance ${connection()!.instanceId}` : workbench.loading() ? "Connecting to the native Workbench bridge" : connectionError() || "Native Workbench bridge unavailable"}
          </p>
        </header>
        <Show when={definitions.error}>
          <p data-automate-definitions="failed" class="text-14-regular text-text-danger">{definitions.error instanceof Error ? definitions.error.message : String(definitions.error)}</p>
        </Show>
        <Show when={definitions.data?.entries.length}>
          <ul class="space-y-2" data-automate-definition-count={definitions.data!.entries.length}>
            <For each={definitions.data!.entries.filter((entry) => entry.kind === "file")}>
              {(entry) => (
                <li class="rounded-lg border border-border-base bg-background-stronger p-4" data-automate-definition={entry.path}>
                  <div class="flex items-center justify-between gap-3"><span>{entry.path}</span><button type="button" class="rounded border border-border-base px-2 py-1 text-12-medium" onClick={() => { setSelectedDefinition(entry.path); setWorkflowError(undefined) }}>Inspect</button></div>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={selectedDefinition()}>
          <div class="rounded-lg border border-border-base bg-background-stronger p-4" data-automate-selected={selectedDefinition()}>
            <p class="text-12-regular text-text-weak">Selected workflow definition is read through the shared Workbench session.</p>
            <button type="button" class="mt-3 rounded border border-border-base px-3 py-2 text-12-medium" disabled={definitionFile.isLoading || !definitionFile.data} onClick={() => void startSelectedWorkflow()}>Start with approval gates</button>
            <Show when={approvalId()}>
              <div class="mt-3 flex flex-wrap gap-2" data-automate-approval={approvalId()}>
                <button type="button" class="rounded border border-border-base px-3 py-2 text-12-medium" onClick={() => void resolveWorkflowApproval("allow")}>Allow workflow</button>
                <button type="button" class="rounded border border-border-base px-3 py-2 text-12-medium" onClick={() => void resolveWorkflowApproval("deny")}>Deny workflow</button>
                <button type="button" class="rounded border border-border-base px-3 py-2 text-12-medium" onClick={() => void cancelWorkflowApproval()}>Cancel approval</button>
              </div>
            </Show>
            <Show when={workflowState()}><p class="mt-2 text-12-regular text-text-success">Workflow state: {workflowState()}</p></Show>
            <Show when={workflowError()}><p class="mt-2 text-12-regular text-text-danger">{workflowError()}</p></Show>
          </div>
        </Show>
        <Show when={!definitions.isLoading && !definitions.error && definitions.data?.entries.length === 0}>
          <p data-automate-definitions="empty" class="text-14-regular text-text-weak">No workflow definitions are present in this workspace.</p>
        </Show>
      </div>
    </section>
  )
}

export default function WorkbenchMode() {
  const mode = useMode()
  return (
    <main class="size-full min-h-0 bg-background-base" data-workbench-mode={mode.active()}>
      <Show when={mode.routeKind() === "invalid"}>
        <section class="size-full p-6" data-workbench-error="invalid-route">
          <h1 class="text-18-medium">Invalid workspace mode</h1>
          <p class="mt-2 text-14-regular text-text-weak">The requested workspace mode is not available.</p>
        </section>
      </Show>
      <Show when={mode.active() === "work"}>
        <WorkSurface />
      </Show>
      <Show when={mode.active() === "design"}>
        <DesignSurface />
      </Show>
      <Show when={mode.active() === "automate"}>
        <AutomateSurface />
      </Show>
    </main>
  )
}
