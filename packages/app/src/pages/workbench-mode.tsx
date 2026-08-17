/* SPDX-License-Identifier: MIT */

import { For, Show, createEffect, createMemo, createSignal, type JSX } from "solid-js"
import { createQuery } from "@tanstack/solid-query"
import { useMode } from "@/context/mode"
import { useLanguage } from "@/context/language"
import { useWorkspaceWorkbench } from "@/context/workbench/provider"
import { workbenchQueryKey } from "@/context/workbench/query-keys"
import { base64Encode } from "@unifia/util/encode"
import { useNavigate } from "@solidjs/router"
import { WorkbenchChat } from "./workbench-chat"
import {
  createDesignPreviewPanelState,
  createDesignSpecPanelState,
  createMobileNavigationModel,
  WORK_V1_FUNCTIONS,
  type WorkFunction,
} from "@unifia/workbench-shell"

const decodeFile = (value: { content: string; encoding: "utf-8" | "base64" }) => value.encoding === "utf-8" ? value.content : new TextDecoder().decode(Uint8Array.from(atob(value.content), (char) => char.charCodeAt(0)))

const OPERATION_I18N_KEY: Record<WorkFunction, string> = {
  "workspace-switcher": "workbench.operations.workspaceSwitcher",
  "session-chat": "workbench.operations.sessionChat",
  "files": "workbench.operations.files",
  "search": "workbench.operations.search",
  "artifacts": "workbench.operations.artifacts",
  "documents": "workbench.operations.documents",
  "trace": "workbench.operations.trace",
  "approvals": "workbench.operations.approvals",
  "activity-log": "workbench.operations.activityLog",
  "capability-picker": "workbench.operations.capabilityPicker",
  "export": "workbench.operations.export",
}

const labelFor = (t: (key: string) => string, operation: WorkFunction) => t(OPERATION_I18N_KEY[operation])

function ConnectionBanner(props: { dataAttr: "workbench-connection" | "design-connection" | "automate-connection"; dataRetryAttr: "workbench-retry" | "design-retry" | "automate-retry" }): JSX.Element {
  const language = useLanguage()
  const workbench = useWorkspaceWorkbench()
  const t = language.t
  const connection = workbench.connection
  const phase = () => connection()?.instanceId ? "connected" : workbench.error() ? "failed" : workbench.loading() ? "connecting" : "unavailable"
  const phaseText = () => {
    switch (phase()) {
      case "connected": return t("workbench.connection.connected", { instanceId: connection()!.instanceId })
      case "connecting": return t("workbench.connection.connecting")
      case "failed": return t("workbench.connection.failed")
      default: return t("workbench.connection.unavailable")
    }
  }
  return (
    <>
      <p
        data-workbench-connection={props.dataAttr === "workbench-connection" ? phase() : undefined}
        data-design-connection={props.dataAttr === "design-connection" ? phase() : undefined}
        data-automate-connection={props.dataAttr === "automate-connection" ? phase() : undefined}
        class="text-12-regular text-text-weak"
      >
        {phaseText()}
      </p>
      <Show when={workbench.error()}>
        <button
          type="button"
          data-workbench-retry={props.dataRetryAttr === "workbench-retry" ? "" : undefined}
          data-design-retry={props.dataRetryAttr === "design-retry" ? "" : undefined}
          data-automate-retry={props.dataRetryAttr === "automate-retry" ? "" : undefined}
          class="rounded border border-border-base px-3 py-2 text-12-medium"
          aria-label={t("workbench.connection.retryHint")}
          onClick={() => workbench.retryConnection()}
        >
          {t("workbench.connection.retry")}
        </button>
      </Show>
    </>
  )
}

function WorkSurface() {
  const mode = useMode()
  const language = useLanguage()
  const t = language.t
  const workbench = useWorkspaceWorkbench()
  const connection = workbench.connection
  const navigate = useNavigate()
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
        setExportMessage(t("workbench.export.approvalRequired", { approvalId: result.approvalId }))
      } else if ("exported" in result) {
        setExportState("success")
        setExportMessage(t("workbench.export.exported", { path: result.exported.relativePath }))
      } else {
        setExportState("error")
        setExportMessage(t("workbench.export.noResult"))
      }
    } catch (error) {
      setExportState("error")
      setExportMessage(error instanceof Error ? error.message : t("workbench.export.failed"))
    }
  }

  function openArtifactInCode(): void {
    const artifact = artifacts.data?.artifacts[0]
    if (!artifact || !mode.directory()) return
    const session = mode.sessionId()
    const target = `/${base64Encode(mode.directory())}/session${session ? `/${encodeURIComponent(session)}` : ""}?artifact=${encodeURIComponent(artifact.artifactId)}`
    navigate(target)
  }

  return (
    <section class="size-full overflow-auto p-6 md:p-10" data-workbench-surface="work">
      <div class="mx-auto max-w-5xl space-y-8">
        <header class="space-y-2">
          <p class="text-12-medium uppercase tracking-wide text-text-weak">{t("workbench.work.title")}</p>
          <h1 class="text-24-medium">{t("workbench.work.heading")}</h1>
          <p class="max-w-2xl text-14-regular text-text-weak">{t("workbench.work.description")}</p>
          <ConnectionBanner dataAttr="workbench-connection" dataRetryAttr="workbench-retry" />
        </header>
        <WorkbenchChat
          mode="work"
          directory={mode.directory()}
          sessionId={mode.sessionId()}
          prompt={t("workbench.work.chatPrompt")}
          description={t("workbench.work.chatDescription")}
        />
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
                  <h2 class="text-14-medium">{labelFor(t, operation)}</h2>
                  <Show when={activeOperation() === operation}>
                    <span class="text-12-medium text-text-success">{t("workbench.operations.active")}</span>
                  </Show>
                </div>
                <p class="mt-2 text-12-regular text-text-weak">
                  {operation === "documents" ? t("workbench.operations.documentsCount", { count: navigation().workCount })
                    : operation === "artifacts" ? t("workbench.operations.artifactsCount", { count: artifacts.data?.artifacts.length ?? 0 })
                    : operation === "files" ? t("workbench.operations.filesCount", { count: files.data?.entries.length ?? 0 })
                    : operation === "export" ? t("workbench.operations.exportDescription")
                    : t("workbench.operations.scopedToWorkspace")}
                </p>
              </button>
            )}
          </For>
        </div>
        <div class="rounded-lg border border-border-base bg-background-stronger p-5" data-workbench-selected-operation={activeOperation()}>
          <p class="text-12-medium uppercase tracking-wide text-text-weak">{t("workbench.operations.selectedLabel")}</p>
          <h2 class="mt-2 text-18-medium">{labelFor(t, activeOperation())}</h2>
          <p class="mt-2 text-14-regular text-text-weak">{t("workbench.operations.selectedDescription")}</p>
          <Show when={activeOperation() === "export"}>
            <button type="button" data-workbench-open-artifact class="mt-4 mr-2 rounded border border-border-base px-3 py-2 text-12-medium disabled:opacity-50" disabled={!artifacts.data?.artifacts.length} onClick={openArtifactInCode}>
              {t("workbench.export.openInCode")}
            </button>
            <button type="button" data-workbench-export class="mt-4 rounded border border-border-base px-3 py-2 text-12-medium disabled:opacity-50" disabled={!artifacts.data?.artifacts.length || exportState() === "running"} onClick={() => void exportFirstArtifact()}>
              {exportState() === "running" ? t("workbench.export.exporting") : t("workbench.export.exportFirst")}
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
  const language = useLanguage()
  const t = language.t
  const workbench = useWorkspaceWorkbench()
  const connection = workbench.connection
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
  return (
    <section class="size-full overflow-auto p-6 md:p-10" data-workbench-surface="design">
      <div class="mx-auto max-w-6xl space-y-8">
        <header class="space-y-2">
          <p class="text-12-medium uppercase tracking-wide text-text-weak">{t("workbench.design.title")}</p>
          <h1 class="text-24-medium">{t("workbench.design.heading")}</h1>
          <p class="max-w-2xl text-14-regular text-text-weak">{t("workbench.design.description")}</p>
        </header>
        <WorkbenchChat
          mode="design"
          directory={mode.directory()}
          sessionId={mode.sessionId()}
          prompt={t("workbench.design.chatPrompt")}
          description={t("workbench.design.chatDescription")}
        />
        <ConnectionBanner dataAttr="design-connection" dataRetryAttr="design-retry" />
        <Show when={manifest.error}>
          <p data-design-manifest="failed" class="text-14-regular text-text-danger">{manifest.error instanceof Error ? manifest.error.message : String(manifest.error)}</p>
        </Show>
        <Show when={manifest.data?.designSystems.length}>
          <div class="grid gap-3 md:grid-cols-2" data-design-catalog-count={manifest.data!.designSystems.length}>
            <For each={manifest.data!.designSystems}>
              {(catalog) => (
                <article class="rounded-lg border border-border-base bg-background-stronger p-4" data-design-catalog={catalog.id}>
                  <h2 class="text-14-medium">{catalog.name} · {catalog.version}</h2>
                  <p class="mt-2 text-12-regular text-text-weak">{t("workbench.design.source", { source: catalog.source })}</p>
                </article>
              )}
            </For>
          </div>
        </Show>
        <Show when={!manifest.isLoading && !manifest.error && manifest.data?.designSystems.length === 0}>
          <p data-design-manifest="empty" class="text-14-regular text-text-danger">{t("workbench.design.noManifest")}</p>
        </Show>
        <label class="block space-y-2" for="workbench-design-spec">
          <span class="text-14-medium">{t("workbench.design.specLabel")}</span>
          <textarea
            id="workbench-design-spec"
            class="min-h-48 w-full rounded-lg border border-border-base bg-background-stronger p-4 font-mono text-12-regular text-text-base"
            placeholder={t("workbench.design.specPlaceholder")}
            value={source()}
            onInput={(event) => setSource(event.currentTarget.value)}
            spellcheck={false}
          />
        </label>
        <Show when={spec().diagnostics.length > 0}>
          <aside class="rounded-lg border border-border-danger bg-background-stronger p-4" data-workbench-diagnostics>
            <h2 class="text-14-medium text-text-danger">{t("workbench.design.diagnostics")}</h2>
            <For each={spec().diagnostics}>
              {(diagnostic) => <p class="mt-2 text-12-regular text-text-weak">{t("workbench.design.diagnosticLine", { line: diagnostic.line, column: diagnostic.column, message: diagnostic.message })}</p>}
            </For>
          </aside>
        </Show>
        <Show when={validation.isLoading}>
          <p data-design-validation="loading" class="text-12-regular text-text-weak">{t("workbench.design.validating")}</p>
        </Show>
        <Show when={validation.error}>
          <p data-design-validation="failed" class="text-14-regular text-text-danger">{validation.error instanceof Error ? validation.error.message : String(validation.error)}</p>
        </Show>
        <Show when={validation.data?.capabilities.denied.length}>
          <p data-design-validation="denied" class="text-14-regular text-text-danger">{t("workbench.design.capabilitiesDenied", { list: validation.data!.capabilities.denied.join(", ") })}</p>
        </Show>
        <Show when={validation.data?.valid === true && validation.data.capabilities.denied.length === 0 && preview().previews.length > 0} fallback={<p class="text-14-regular text-text-danger">{spec().diagnostics[0]?.message ?? t("workbench.design.specEmpty")}</p>}>
          <div class="grid gap-5 md:grid-cols-3" data-workbench-preview-count={preview().previews.length}>
            <For each={preview().previews}>
              {(item) => (
                <figure class="overflow-hidden rounded-lg border border-border-base bg-background-stronger p-3">
                  <img class="w-full rounded-md" src={item.src} width={item.width} alt={t("workbench.design.previewAlt", { label: item.label })} />
                  <figcaption class="mt-3 text-12-medium text-text-weak">{t("workbench.design.previewCaption", { label: item.label, width: item.width })}</figcaption>
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
  const language = useLanguage()
  const t = language.t
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
      if (typeof definition.id !== "string" || definition.version !== 1 || !Array.isArray(definition.steps)) throw new Error(t("workbench.automate.invalidDefinition"))
      await startDefinition(definition)
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : t("workbench.automate.startFailed"))
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
      setWorkflowError(error instanceof Error ? error.message : t("workbench.automate.approvalFailed"))
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
      setWorkflowError(error instanceof Error ? error.message : t("workbench.automate.cancelFailed"))
    }
  }
  return (
    <section class="size-full overflow-auto p-6 md:p-10" data-workbench-surface="automate">
      <div class="mx-auto max-w-5xl space-y-8">
        <header class="space-y-2">
          <p class="text-12-medium uppercase tracking-wide text-text-weak">{t("workbench.automate.title")}</p>
          <h1 class="text-24-medium">{t("workbench.automate.heading")}</h1>
          <p class="max-w-2xl text-14-regular text-text-weak">{t("workbench.automate.description")}</p>
        </header>
        <WorkbenchChat
          mode="automate"
          directory={mode.directory()}
          sessionId={mode.sessionId()}
          prompt={t("workbench.automate.chatPrompt")}
          description={t("workbench.automate.chatDescription")}
        />
        <ConnectionBanner dataAttr="automate-connection" dataRetryAttr="automate-retry" />
        <Show when={definitions.error}>
          <p data-automate-definitions="failed" class="text-14-regular text-text-danger">{definitions.error instanceof Error ? definitions.error.message : String(definitions.error)}</p>
        </Show>
        <Show when={definitions.data?.entries.length}>
          <ul class="space-y-2" data-automate-definition-count={definitions.data!.entries.length}>
            <For each={definitions.data!.entries.filter((entry) => entry.kind === "file")}>
              {(entry) => (
                <li class="rounded-lg border border-border-base bg-background-stronger p-4" data-automate-definition={entry.path}>
                  <div class="flex items-center justify-between gap-3"><span>{entry.path}</span><button type="button" class="rounded border border-border-base px-2 py-1 text-12-medium" onClick={() => { setSelectedDefinition(entry.path); setWorkflowError(undefined) }}>{t("workbench.automate.inspect")}</button></div>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={selectedDefinition()}>
          <div class="rounded-lg border border-border-base bg-background-stronger p-4" data-automate-selected={selectedDefinition()}>
            <p class="text-12-regular text-text-weak">{t("workbench.automate.selectedDescription")}</p>
            <button type="button" class="mt-3 rounded border border-border-base px-3 py-2 text-12-medium" disabled={definitionFile.isLoading || !definitionFile.data} onClick={() => void startSelectedWorkflow()}>{t("workbench.automate.startWithApproval")}</button>
            <Show when={approvalId()}>
              <div class="mt-3 flex flex-wrap gap-2" data-automate-approval={approvalId()}>
                <button type="button" class="rounded border border-border-base px-3 py-2 text-12-medium" onClick={() => void resolveWorkflowApproval("allow")}>{t("workbench.automate.allow")}</button>
                <button type="button" class="rounded border border-border-base px-3 py-2 text-12-medium" onClick={() => void resolveWorkflowApproval("deny")}>{t("workbench.automate.deny")}</button>
                <button type="button" class="rounded border border-border-base px-3 py-2 text-12-medium" onClick={() => void cancelWorkflowApproval()}>{t("workbench.automate.cancel")}</button>
              </div>
            </Show>
            <Show when={workflowState()}><p class="mt-2 text-12-regular text-text-success">{t("workbench.automate.workflowState", { state: workflowState() ?? "" })}</p></Show>
            <Show when={workflowError()}><p class="mt-2 text-12-regular text-text-danger">{workflowError()}</p></Show>
          </div>
        </Show>
        <Show when={!definitions.isLoading && !definitions.error && definitions.data?.entries.length === 0}>
          <p data-automate-definitions="empty" class="text-14-regular text-text-weak">{t("workbench.automate.noDefinitions")}</p>
        </Show>
      </div>
    </section>
  )
}

export default function WorkbenchMode() {
  const mode = useMode()
  const language = useLanguage()
  const t = language.t
  return (
    <main class="size-full min-h-0 bg-background-base" data-workbench-mode={mode.active()}>
      <Show when={mode.routeKind() === "invalid"}>
        <section class="size-full p-6" data-workbench-error="invalid-route">
          <h1 class="text-18-medium">{t("workbench.errors.invalidMode")}</h1>
          <p class="mt-2 text-14-regular text-text-weak">{t("workbench.errors.invalidModeDescription")}</p>
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
