import { For, Show, createMemo, createResource, createSignal } from "solid-js"
import { useMode } from "@/context/mode"
import {
  createDesignPreviewPanelState,
  createDesignSpecPanelState,
  createMobileNavigationModel,
  WORK_V1_FUNCTIONS,
  type WorkFunction,
} from "@unifia/workbench-shell"

const labelFor = (operation: WorkFunction) => operation.replaceAll("-", " ")

function WorkSurface() {
  const mode = useMode()
  const connection = mode.connection
  const retryConnection = mode.retryConnection
  const [activeOperation, setActiveOperation] = createSignal<WorkFunction>("documents")
  const [exportState, setExportState] = createSignal<"idle" | "running" | "success" | "error">("idle")
  const [exportMessage, setExportMessage] = createSignal("")
  const [documents] = createResource(
    () => connection()?.workspaceId,
    (workspaceId) => connection()!.client.listDocuments(workspaceId),
  )
  const [artifacts] = createResource(
    () => connection()?.workspaceId,
    (workspaceId) => connection()!.client.listArtifacts(workspaceId),
  )
  const [files] = createResource(
    () => connection()?.workspaceId,
    (workspaceId) => connection()!.client.listFiles(workspaceId),
  )
  const navigation = createMemo(() =>
    createMobileNavigationModel({ viewportWidth: window.innerWidth, documents: documents()?.documents.length ?? 0, designPreviews: 0, active: activeOperation() }),
  )

  async function exportFirstArtifact(): Promise<void> {
    const artifact = artifacts()?.artifacts[0]
    const current = connection()
    if (!artifact || !current || exportState() === "running") return
    setExportState("running")
    setExportMessage("")
    try {
      const result = await current.client.exportArtifact(current.workspaceId, artifact.artifactId)
      setExportState("success")
      setExportMessage(`Exported ${result.exported.relativePath}`)
    } catch (error) {
      setExportState("error")
      setExportMessage(error instanceof Error ? error.message : "Artifact export failed")
    }
  }

  const connectionError = () => connection.error instanceof Error ? connection.error.message : connection.error ? String(connection.error) : ""

  return (
    <section class="size-full overflow-auto p-6 md:p-10" data-workbench-surface="work">
      <div class="mx-auto max-w-5xl space-y-8">
        <header class="space-y-2">
          <p class="text-12-medium uppercase tracking-wide text-text-weak">Work</p>
          <h1 class="text-24-medium">Workspace operations</h1>
          <p class="max-w-2xl text-14-regular text-text-weak">Read-only workspace surfaces are derived from the shared Work registry and keep their scope explicit.</p>
          <p data-workbench-connection={connection()?.instanceId ? "connected" : connection.error ? "failed" : connection.loading ? "connecting" : "unavailable"} class="text-12-regular text-text-weak">
            {connection()?.instanceId ? `Connected to Workbench instance ${connection()!.instanceId}` : connection.loading ? "Connecting to the native Workbench bridge" : connectionError() || "Native Workbench bridge unavailable"}
          </p>
          <Show when={connection.error}>
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
                  {operation === "documents" ? `${navigation().workCount} documents` : operation === "artifacts" ? `${artifacts()?.artifacts.length ?? 0} artifacts` : operation === "files" ? `${files()?.entries.length ?? 0} files` : operation === "export" ? "Exports the first persisted artifact" : "Scoped to this workspace"}
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
            <button type="button" data-workbench-export class="mt-4 rounded border border-border-base px-3 py-2 text-12-medium disabled:opacity-50" disabled={!artifacts()?.artifacts.length || exportState() === "running"} onClick={() => void exportFirstArtifact()}>
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
  const mode = useMode()
  const connection = mode.connection
  const retryConnection = mode.retryConnection
  const [manifest] = createResource(
    () => {
      const current = connection()
      return current ? { client: current.client, workspaceId: current.workspaceId } : undefined
    },
    ({ client, workspaceId }) => client.listDesignSystems(workspaceId),
  )
  const [source, setSource] = createSignal("")
  const spec = createMemo(() => createDesignSpecPanelState({ kind: "inline", value: source() }))
  const preview = createMemo(() => createDesignPreviewPanelState(spec()))
  const connectionError = () => connection.error instanceof Error ? connection.error.message : connection.error ? String(connection.error) : ""

  return (
    <section class="size-full overflow-auto p-6 md:p-10" data-workbench-surface="design">
      <div class="mx-auto max-w-6xl space-y-8">
        <header class="space-y-2">
          <p class="text-12-medium uppercase tracking-wide text-text-weak">Design</p>
          <h1 class="text-24-medium">Validated responsive preview</h1>
          <p class="max-w-2xl text-14-regular text-text-weak">The preview is produced only after workspace manifest and spec validation and is loaded as an inert image source.</p>
        </header>
        <p data-design-connection={connection()?.instanceId ? "connected" : connection.error ? "failed" : connection.loading ? "connecting" : "unavailable"} class="text-12-regular text-text-weak">
          {connection()?.instanceId ? `Connected to Workbench instance ${connection()!.instanceId}` : connection.loading ? "Connecting to the native Workbench bridge" : connectionError() || "Native Workbench bridge unavailable"}
        </p>
        <Show when={connection.error}>
          <button type="button" data-design-retry class="rounded border border-border-base px-3 py-2 text-12-medium" onClick={() => retryConnection()}>Retry connection</button>
        </Show>
        <Show when={manifest.error}>
          <p data-design-manifest="failed" class="text-14-regular text-text-danger">{manifest.error instanceof Error ? manifest.error.message : String(manifest.error)}</p>
        </Show>
        <Show when={manifest()?.designSystems.length}>
          <div class="grid gap-3 md:grid-cols-2" data-design-catalog-count={manifest()!.designSystems.length}>
            <For each={manifest()!.designSystems}>
              {(catalog) => (
                <article class="rounded-lg border border-border-base bg-background-stronger p-4" data-design-catalog={catalog.id}>
                  <h2 class="text-14-medium">{catalog.name} · {catalog.version}</h2>
                  <p class="mt-2 text-12-regular text-text-weak">Source: {catalog.source}</p>
                </article>
              )}
            </For>
          </div>
        </Show>
        <Show when={!manifest.loading && !manifest.error && manifest()?.designSystems.length === 0}>
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
        <Show when={preview().previews.length > 0} fallback={<p class="text-14-regular text-text-danger">{spec().diagnostics[0]?.message}</p>}>
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
  const mode = useMode()
  const connection = mode.connection
  const [definitions] = createResource(
    () => {
      const current = connection()
      return current ? { client: current.client, workspaceId: current.workspaceId } : undefined
    },
    ({ client, workspaceId }) => client.listFiles(workspaceId, ".unifia/workflows"),
  )
  const connectionError = () => connection.error instanceof Error ? connection.error.message : connection.error ? String(connection.error) : ""

  return (
    <section class="size-full overflow-auto p-6 md:p-10" data-workbench-surface="automate">
      <div class="mx-auto max-w-5xl space-y-8">
        <header class="space-y-2">
          <p class="text-12-medium uppercase tracking-wide text-text-weak">Automate</p>
          <h1 class="text-24-medium">Workspace automation definitions</h1>
          <p class="max-w-2xl text-14-regular text-text-weak">Automation v0 reads only validated workflow definitions from the active workspace. Execution is unavailable until an explicit workflow contract is provided.</p>
          <p data-automate-connection={connection()?.instanceId ? "connected" : connection.error ? "failed" : connection.loading ? "connecting" : "unavailable"} class="text-12-regular text-text-weak">
            {connection()?.instanceId ? `Connected to Workbench instance ${connection()!.instanceId}` : connection.loading ? "Connecting to the native Workbench bridge" : connectionError() || "Native Workbench bridge unavailable"}
          </p>
        </header>
        <Show when={definitions.error}>
          <p data-automate-definitions="failed" class="text-14-regular text-text-danger">{definitions.error instanceof Error ? definitions.error.message : String(definitions.error)}</p>
        </Show>
        <Show when={definitions()?.entries.length}>
          <ul class="space-y-2" data-automate-definition-count={definitions()!.entries.length}>
            <For each={definitions()!.entries.filter((entry) => entry.kind === "file")}>
              {(entry) => <li class="rounded-lg border border-border-base bg-background-stronger p-4" data-automate-definition={entry.path}>{entry.path}</li>}
            </For>
          </ul>
        </Show>
        <Show when={!definitions.loading && !definitions.error && definitions()?.entries.length === 0}>
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
