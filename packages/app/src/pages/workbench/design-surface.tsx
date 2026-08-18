/* SPDX-License-Identifier: MIT */

import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { createQuery } from "@tanstack/solid-query"
import { useMode } from "@/context/mode"
import { useLanguage } from "@/context/language"
import { useWorkspaceWorkbench } from "@/context/workbench/provider"
import { workbenchQueryKey } from "@/context/workbench/query-keys"
import { WorkbenchChat } from "@/pages/workbench-chat"
import { ConnectionBanner } from "@/pages/workbench/connection-banner"
import { DesignSplit } from "@/pages/workbench/design-split"
import { DesignWorkspace } from "@/pages/workbench/design-workspace"
import {
  createDesignPreviewPanelState,
  createDesignSpecPanelState,
  renderDesignSpecSvg,
  createArtifactVersionPanelState,
  diffArtifactVersions,
  createIndexedDbDesignDraftStore,
  DesignDraftConflictError,
} from "@unifia/workbench-shell"

export function DesignSurface(): JSX.Element {
  const mode = useMode()
  const language = useLanguage()
  const t = language.t
  const workbench = useWorkspaceWorkbench()
  const connection = workbench.connection
  createEffect(() => { void workbench.ensureConnected().catch(() => undefined) })
  const manifest = createQuery(() => ({ queryKey: workbenchQueryKey(connection(), "design-systems"), enabled: !!connection(), queryFn: () => connection()!.client.listDesignSystems(connection()!.workspaceId) }))
  const [source, setSource] = createSignal("")
  const [draftRevision, setDraftRevision] = createSignal<number | undefined>()
  const [draftError, setDraftError] = createSignal<string>()
  const [artifactId, setArtifactId] = createSignal<string>()
  const [saveState, setSaveState] = createSignal<"idle" | "saving" | "saved" | "error">("idle")
  const [saveMessage, setSaveMessage] = createSignal("")
  const [exportState, setExportState] = createSignal<"idle" | "exporting" | "exported" | "error">("idle")
  const draftStore = createIndexedDbDesignDraftStore()
  let draftTimer: ReturnType<typeof setTimeout> | undefined
  let draftLoadEpoch = 0
  onMount(() => {
    createEffect(() => {
      const workspaceId = connection()?.workspaceId
      if (!workspaceId) return
      const epoch = ++draftLoadEpoch
      void draftStore.load(workspaceId).then((draft) => {
        if (epoch !== draftLoadEpoch || !draft) return
        setSource(draft.source)
        setDraftRevision(draft.revision)
      }).catch((error) => setDraftError(error instanceof Error ? error.message : "design draft could not be loaded"))
    })
  })
  onCleanup(() => { if (draftTimer) clearTimeout(draftTimer) })
  function updateDraft(value: string): void {
    setSource(value)
    const workspaceId = connection()?.workspaceId
    if (!workspaceId) return
    if (draftTimer) clearTimeout(draftTimer)
    draftTimer = setTimeout(() => {
      void draftStore.save(workspaceId, value, draftRevision()).then((draft) => {
        setDraftRevision(draft.revision)
        setDraftError(undefined)
      }).catch((error) => {
        if (error instanceof DesignDraftConflictError) setDraftError("Design draft changed in another window; reload it before editing again")
        else setDraftError(error instanceof Error ? error.message : "design draft could not be saved")
      })
    }, 250)
  }
  const spec = createMemo(() => createDesignSpecPanelState({ kind: "inline", value: source() }))
  const preview = createMemo(() => createDesignPreviewPanelState(spec()))
  const validation = createQuery(() => ({
    queryKey: workbenchQueryKey(connection(), "spec-validation", { source: source() }),
    enabled: !!connection() && source().trim().length > 0 && spec().diagnostics.length === 0,
    staleTime: 5_000,
    queryFn: () => connection()!.client.validateSpec(connection()!.workspaceId, source()),
  }))
  const history = createQuery(() => ({
    queryKey: workbenchQueryKey(connection(), "design-history", { artifactId: artifactId() ?? "" }),
    enabled: !!connection() && !!artifactId(),
    queryFn: () => connection()!.client.artifactHistory(connection()!.workspaceId, artifactId()!),
  }))
  async function saveDesignVersion(): Promise<void> {
    const current = connection()
    if (!current || !spec().spec || saveState() === "saving") return
    setSaveState("saving")
    setSaveMessage("")
    try {
      const result = await current.client.createArtifact({
        workspaceId: current.workspaceId,
        kind: "text",
        filename: "design-spec.json",
        content: source(),
        ...(artifactId() ? { artifactId: artifactId() } : {}),
        metadata: { target: "design", specId: spec().spec!.id, specVersion: spec().spec!.version },
        provenance: { sourceTool: "design-editor", capabilityPack: "workbench-design" },
      })
      setArtifactId(result.artifact.artifactId)
      setSaveState("saved")
      setSaveMessage(`Version ${result.artifact.version} enregistrée`)
      await history.refetch()
    } catch (error) {
      setSaveState("error")
      setSaveMessage(error instanceof Error ? error.message : "design version could not be saved")
    }
  }
  async function exportDesignRender(): Promise<void> {
    const current = connection()
    const designSpec = spec().spec
    if (!current || !designSpec || exportState() === "exporting") return
    setExportState("exporting")
    setSaveMessage("")
    try {
      const render = await current.client.createArtifact({
        workspaceId: current.workspaceId,
        kind: "svg",
        filename: "design-preview.svg",
        content: renderDesignSpecSvg(designSpec, { width: 1440, height: 1080 }),
        metadata: { derivedFrom: artifactId() ?? "draft", format: "image/svg+xml" },
        provenance: { sourceTool: "design-renderer", capabilityPack: "workbench-design" },
      })
      const result = await current.client.exportArtifact(current.workspaceId, render.artifact.artifactId, { metadata: "keep", outbox: "design" })
      if ("approvalId" in result && result.approvalId) {
        setExportState("error")
        setSaveMessage(`Export soumis à approbation : ${result.approvalId}`)
      } else if ("exported" in result) {
        setExportState("exported")
        setSaveMessage(`SVG exporté : ${result.exported.relativePath}`)
      }
    } catch (error) {
      setExportState("error")
      setSaveMessage(error instanceof Error ? error.message : "design render export failed")
    }
  }
  const versionPanel = createMemo(() => createArtifactVersionPanelState(history.data?.history ?? []))
  const latestDiff = createMemo(() => {
    const versions = versionPanel().history
    return diffArtifactVersions(versions.at(-2), versions.at(-1))
  })

  return (
    <section class="size-full" data-workbench-surface="design">
      <DesignSplit
        chat={
          <div class="flex h-full min-h-0 flex-col gap-4 overflow-auto p-6">
            <header class="space-y-2">
              <p class="text-12-medium uppercase tracking-wide text-text-weak">{t("workbench.design.title")}</p>
              <h1 class="text-24-medium">{t("workbench.design.heading")}</h1>
              <p class="max-w-2xl text-14-regular text-text-weak">{t("workbench.design.description")}</p>
            </header>
            <ConnectionBanner dataAttr="design-connection" dataRetryAttr="design-retry" />
            <WorkbenchChat
              mode="design"
              directory={mode.directory()}
              sessionId={mode.sessionId()}
              prompt={t("workbench.design.chatPrompt")}
              description={t("workbench.design.chatDescription")}
            />
          </div>
        }
        workspace={
          <div class="flex h-full min-h-0 flex-col gap-6 overflow-auto p-6">
            <DesignWorkspace />
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
                onInput={(event) => updateDraft(event.currentTarget.value)}
                spellcheck={false}
              />
            </label>
            <Show when={draftError()}><p data-design-draft="error" class="text-12-regular text-text-danger">{draftError()}</p></Show>
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
            <div class="flex flex-wrap items-center gap-3" data-design-versioning>
              <button type="button" data-design-save-version class="rounded border border-border-base px-3 py-2 text-12-medium disabled:opacity-50" disabled={!spec().spec || saveState() === "saving"} onClick={() => void saveDesignVersion()}>
                {saveState() === "saving" ? "Enregistrement…" : "Enregistrer une version"}
              </button>
              <button type="button" data-design-export-render class="rounded border border-border-base px-3 py-2 text-12-medium disabled:opacity-50" disabled={!spec().spec || exportState() === "exporting"} onClick={() => void exportDesignRender()}>
                {exportState() === "exporting" ? "Export…" : "Exporter le rendu SVG"}
              </button>
              <Show when={saveMessage()}><span data-design-save-result={saveState()} class="text-12-regular text-text-weak">{saveMessage()}</span></Show>
            </div>
            <Show when={versionPanel().history.length > 0}>
              <section class="rounded-lg border border-border-base bg-background-stronger p-4" data-design-history>
                <h2 class="text-14-medium">Historique Design</h2>
                <p class="mt-2 text-12-regular text-text-weak">{versionPanel().history.length} version(s) · provenance : {versionPanel().provenance?.sourceTool ?? "inconnue"}</p>
                <p data-design-diff class="mt-2 text-12-regular text-text-weak">Diff dernière version : {latestDiff().changed.join(", ") || "aucun changement structurel"}</p>
              </section>
            </Show>
          </div>
        }
      />
    </section>
  )
}
