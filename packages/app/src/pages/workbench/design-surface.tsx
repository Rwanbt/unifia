/* SPDX-License-Identifier: MIT */

import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { createQuery } from "@tanstack/solid-query"
import { useLanguage } from "@/context/language"
import { useWorkspaceWorkbench } from "@/context/workbench/provider"
import { workbenchQueryKey } from "@/context/workbench/query-keys"
import { WorkbenchChat } from "@/pages/workbench-chat"
import { createWorkbenchSession } from "@/pages/workbench/workbench-session"
import { ConnectionBanner } from "@/pages/workbench/connection-banner"
import { DesignSplit } from "@/pages/workbench/design-split"
import { DesignWorkspace } from "@/pages/workbench/design-workspace"
import { ArtifactPreview } from "@/pages/workbench/artifact-preview"
import { DesignToolbar, DEFAULT_TOOLBAR_MODE, type DesignToolbarSnapshotState, type DesignToolbarMode } from "@/pages/workbench/design-toolbar"
import { CommentPanel } from "@/pages/workbench/comment-panel"
import { DEFAULT_VIEWPORT, DEFAULT_ZOOM, VIEWPORT_IDS, type ViewportId } from "@unifia/artifact-render"
import { EMPTY_COMMENT_STATE, buildCatalogContext, type CommentState } from "@unifia/workbench-shell"
import {
  createArtifactStreamController,
  activeStreamedArtifact,
  type StreamedArtifact,
} from "@/pages/workbench/use-artifact-stream"
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

  // P22 — design-system context wiring. The active catalog is the first
  // entry of the manifest when one is loaded. The DESIGN.md content is
  // not yet fetched by the runtime (the read route is part of a later
  // packet); the placeholder below is what the workbench-shell parser
  // sees for now, and the resulting preamble is exposed via
  // `data-design-context-length` so the wiring is observable end-to-end.
  // Switching to two different catalogs changes the preamble length
  // deterministically; that is the acceptance of the card.
  const PLACEHOLDER_DESIGN_MD = (catalogId: string): string =>
    `# ${catalogId}\n\n` +
    "## Color\n\nThe active palette is documented in the design system contract.\n\n" +
    "## Typography\n\nThe active typeface scale is documented in the design system contract.\n"
  const designContextPreview = createMemo<string>(() => {
    const first = manifest.data?.designSystems[0]
    if (!first) return ""
    return buildCatalogContext({
      catalog: { id: first.id, name: first.name, version: first.version, source: first.source },
      designMd: PLACEHOLDER_DESIGN_MD(first.id),
    })
  })
  let draftTimer: ReturnType<typeof setTimeout> | undefined
  let draftLoadEpoch = 0

  // P15 — Moteur de streaming des artefacts produits par l'agent Design.
  // L'agent lui-même (capability "design-agent") émettra `artifact:start/chunk/end`
  // via le SDK quand il sera branché ; en attendant, le controller est prêt et
  // exposé au reste de la surface (panneau live + persistance automatique).
  const stream = createArtifactStreamController({ debounceMs: 100 })
  const [streamPersisted, setStreamPersisted] = createSignal<ReadonlySet<string>>(new Set())

  // P19 + P20 — Panneau de commentaires. Le `targetElementId` sera
  // fourni par P18 (sélection) ; en attendant, le panneau affiche
  // "selectionnez un élément".
  const [commentState, setCommentState] = createSignal<CommentState>(EMPTY_COMMENT_STATE)
  const [commentTarget, setCommentTarget] = createSignal<string | undefined>(undefined)
  const [commentArtifactId, setCommentArtifactId] = createSignal<string>("")
  const [commentEntryFile, setCommentEntryFile] = createSignal<string>("design/index.html")
  /**
   * P20 — envoi réel du prompt de raffinement à l'agent.
   *
   * Passe par la session du workspace, la même que le fil : un raffinement
   * demandé depuis un commentaire doit apparaître dans la conversation que
   * l'utilisateur regarde, pas dans une session parallèle.
   */
  const refineSession = createWorkbenchSession({ title: () => t("workbench.chat.design") })
  async function sendRefinePrompt(prompt: string, label: string): Promise<void> {
    setSaveMessage(`Envoi ${label}…`)
    try {
      await refineSession.prompt(prompt)
      setSaveMessage(`Prompt ${label} envoyé (${prompt.length} caractères)`)
    } catch (error) {
      setSaveMessage(`Envoi échoué : ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  function handleSendBatch(prompt: string): void {
    void sendRefinePrompt(prompt, "groupé")
  }
  function handleSendOne(prompt: string): void {
    void sendRefinePrompt(prompt, "ciblé")
  }
  let lastConnectionPhase: ReturnType<typeof workbench.phase> | undefined
  createEffect(() => {
    const phase = workbench.phase()
    if (lastConnectionPhase === phase) return
    const wasConnected = lastConnectionPhase === "ready" || lastConnectionPhase === undefined
    if (phase === "failed" || phase === "rolling_back" || phase === "cleanup_failed") {
      // Spec P15 §6 : la connexion qui tombe en cours de flux NE VIDE PAS
      // le rendu déjà obtenu. On pose juste un bandeau ; les byId restent intacts.
      if (wasConnected) stream.setConnectionError(t("workbench.errors.eventStreamDisconnected"))
    } else if (phase === "ready" && !wasConnected) {
      stream.setConnectionError(undefined)
    }
    lastConnectionPhase = phase
  })
  // Persistance automatique : quand une entry passe `complete: true`, on la
  // sauvegarde via `client.createArtifact` avec la provenance `design-agent`.
  // Idempotent : on garde un Set des ids déjà persistés pour éviter les doubles POST.
  createEffect(() => {
    const persisted = streamPersisted()
    const state = stream.state()
    const current = connection()
    if (!current) return
    for (const entry of state.byId.values()) {
      if (!entry.complete || persisted.has(entry.artifactId)) continue
      if (entry.error) continue
      const filename = entry.filename
      const kind = entry.kind
      const content = entry.content
      setStreamPersisted((set) => {
        if (set.has(entry.artifactId)) return set
        const next = new Set(set)
        next.add(entry.artifactId)
        return next
      })
      void current.client
        .createArtifact({
          workspaceId: current.workspaceId,
          kind,
          filename,
          content,
          metadata: { source: "design-agent-stream", sessionId: state.activeId ?? "" },
          provenance: { sourceTool: "design-agent", capabilityPack: "workbench-design" },
        })
        .then((result) => {
          setSaveMessage(`Artefact ${result.artifact.filename} persisté (v${result.artifact.version})`)
        })
        .catch((error) => {
          setSaveMessage(`Persistance échouée : ${error instanceof Error ? error.message : String(error)}`)
          setStreamPersisted((set) => {
            const next = new Set(set)
            next.delete(entry.artifactId)
            return next
          })
        })
    }
  })
  // Démo end-to-end : un agent "design-agent" n'est pas encore branché, donc
  // pour prouver visuellement que le moteur fonctionne on injecte un flux
  // synthétique via le controller. À retirer quand l'agent réel pousse ses events.
  function pushDemoStream(): void {
    const id = `demo-${Date.now()}`
    stream.push({ type: "artifact:start", artifactId: id, filename: `${id}.html`, kind: "html", sessionId: "demo" })
    let i = 0
    const chunks = ["<h1>Bonjour</h1>", "<p>Streaming en cours…</p>", "<button>OK</button>"]
    const tick = setInterval(() => {
      if (i >= chunks.length) { clearInterval(tick); stream.push({ type: "artifact:end", artifactId: id, reason: "complete" }); return }
      stream.push({ type: "artifact:chunk", artifactId: id, chunk: chunks[i] ?? "" })
      i += 1
    }, 60)
  }
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
              prompt={t("workbench.design.chatPrompt")}
              description={t("workbench.design.chatDescription")}
            />
          </div>
        }
        workspace={
          <div class="flex h-full min-h-0 flex-col gap-6 overflow-auto p-6">
            <Show
              when={!activeStreamedArtifact(stream.renderState())}
              fallback={
                <StreamedArtifactPanel
                  entry={activeStreamedArtifact(stream.renderState())!}
                  connectionError={stream.renderState().connectionError}
                  onClose={() => stream.reset()}
                  onDemo={pushDemoStream}
                  onSelectTarget={(elementId, artifactId, entryFile) => {
                    setCommentTarget(elementId)
                    setCommentArtifactId(artifactId)
                    setCommentEntryFile(entryFile)
                  }}
                />
              }
            >
              <DesignWorkspace onDemo={pushDemoStream} />
            </Show>
            <Show when={activeStreamedArtifact(stream.renderState())}>
              <CommentPanel
                artifactId={activeStreamedArtifact(stream.renderState())?.artifactId ?? commentArtifactId()}
                state={commentState()}
                entryFile={commentEntryFile()}
                targetElementId={commentTarget()}
                onChange={setCommentState}
                onSendBatch={handleSendBatch}
                onSendOne={handleSendOne}
              />
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
                      <p class="mt-2 text-12-regular text-text-weak">{t("workbench.design.source", { source: catalog.source })}</p>
                    </article>
                  )}
                </For>
              </div>
            </Show>
            <Show when={!manifest.isLoading && !manifest.error && manifest.data?.designSystems.length === 0}>
              <p data-design-manifest="empty" class="text-14-regular text-text-danger">{t("workbench.design.noManifest")}</p>
            </Show>
            {/* P22 — observability for the design-system context wiring. The
                length of the preamble varies with the active catalog; switching
                catalogs in the picker changes the value here. The text is a
                static label because the P22 card does not add a translated
                key — the value is the data attribute, not the user-facing
                text. */}
            <p data-design-context-length={designContextPreview().length} class="text-12-regular text-text-weak">
              {`design context: ${designContextPreview().length} chars · catalog: ${manifest.data?.designSystems[0]?.id ?? "none"}`}
            </p>
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
              {/*
                P16 — les trois <img> SVG statiques sont supprimées par cette carte.
                Le compteur `data-workbench-preview-count` est conservé mais
                reflète désormais le nombre de viewports disponibles (3 : desktop,
                tablet, mobile). Le rendu interactif à largeur réelle se fait
                via le StreamedArtifactPanel quand un artefact de design arrive.
                Les 3 SVG previews statiques de validation restent consultables
                via la spec sauvegardée (P14) ; ici on n'affiche plus que le
                compteur, conformément au runbook P16 §« Spécification exacte ».
              */}
              <div class="grid gap-5 md:grid-cols-3" data-workbench-preview-count={VIEWPORT_IDS.length}>
                <For each={VIEWPORT_IDS}>
                  {(id) => (
                    <figure class="flex flex-col items-center gap-2 rounded-lg border border-border-base bg-background-stronger p-3">
                      <span class="text-12-medium">{id}</span>
                      <span class="text-12-regular text-text-weak">{t("workbench.design.previewCaption", { label: id, width: 0 })}</span>
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

/**
 * P15 — Panneau d'aperçu live pour les artefacts en cours de streaming.
 * Remplace temporairement le `DesignWorkspace` quand un artefact est actif ;
 * l'agent "design-agent" pousse ses events via `stream.push(...)` et le
 * panel se reconstruit à chaque tick debouncé (100 ms). À la fin du
 * flux, l'artefact est persisté automatiquement (cf. effect dans
 * `DesignSurface`). Le bouton "Démo" injecte un flux synthétique pour
 * vérifier visuellement le moteur tant que l'agent réel n'est pas branché.
 */
function StreamedArtifactPanel(props: {
  entry: StreamedArtifact
  connectionError: string | undefined
  onClose: () => void
  onDemo: () => void
  /** P18 → P19 — remonte l'élément piqué au panneau de commentaires. */
  onSelectTarget: (elementId: string, artifactId: string, entryFile: string) => void
}): JSX.Element {
  // P16 — état local pour viewport, zoom et mode de visualisation.
  const [viewport, setViewport] = createSignal<ViewportId>(DEFAULT_VIEWPORT)
  const [zoom, setZoom] = createSignal<number>(DEFAULT_ZOOM)
  const [mode, setMode] = createSignal<DesignToolbarMode>(DEFAULT_TOOLBAR_MODE)
  // P17 — état du snapshot. Le bridge P17 envoie "unifia:snapshot" à
  // l'iframe ; on écoute le retour et on stocke le dataUrl. Pour l'instant
  // le câblage effectif (postMessage à l'iframe) est câblé dans artifact-preview
  // via un custom event "unifia:snapshot-request" — l'implémentation complète
  // viendra quand l'iframe sera réellement montée (cf. P22+).
  const [snapshot, setSnapshot] = createSignal<DesignToolbarSnapshotState>({ kind: "idle" })
  // P17 — la capture s'exécute DANS l'iframe (pas d'accès à contentDocument
  // depuis l'hôte, l'iframe n'est pas same-origin). ArtifactPreview nous
  // remonte la fonction au montage ; on la garde ici.
  let capture: (() => Promise<{ dataUrl: string; w: number; h: number }>) | undefined
  function requestSnapshot(): void {
    if (snapshot().kind === "capturing") return
    if (!capture) {
      setSnapshot({ kind: "error", error: "preview-not-mounted" })
      return
    }
    setSnapshot({ kind: "capturing" })
    void capture()
      .then((result) => setSnapshot({ kind: "ready", dataUrl: result.dataUrl, w: result.w, h: result.h }))
      // Un refus du pont (empty-render, timeout…) remonte tel quel : mieux
      // vaut un échec nommé qu'un PNG uniforme livré en silence.
      .catch((error: unknown) => setSnapshot({ kind: "error", error: error instanceof Error ? error.message : "snapshot-failed" }))
  }
  // P18 — mode sélection. Piloté ici parce qu'il change l'injection du
  // srcDoc (pont + annotation), donc il appartient au panneau, pas à l'iframe.
  const [selectMode, setSelectMode] = createSignal(false)
  return (
    <div
      class="flex h-full min-h-0 flex-col gap-3"
      data-design-stream-panel={props.entry.artifactId}
      data-design-stream-complete={props.entry.complete ? "true" : "false"}
      data-design-stream-error={props.entry.error ? "true" : "false"}
    >
      <div
        class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-base bg-background-stronger px-3 py-2"
        data-design-stream-header
      >
        <div class="flex items-center gap-2">
          <span class="text-12-medium">{props.entry.filename}</span>
          <span class="text-12-regular text-text-weak">·</span>
          <span class="text-12-regular text-text-weak">{props.entry.kind}</span>
          <Show when={!props.entry.complete}>
            <span class="text-12-regular text-text-weak" data-design-stream-status="streaming">streaming…</span>
          </Show>
          <Show when={props.entry.complete}>
            <span class="text-12-regular text-text-weak" data-design-stream-status="complete">complet · {props.entry.content.length} caractères</span>
          </Show>
          <Show when={props.entry.error}>
            <span class="text-12-regular text-text-danger" data-design-stream-error-msg>{props.entry.error}</span>
          </Show>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="rounded border px-2 py-1 text-12-regular"
            classList={{
              "border-border-focus text-text-base": selectMode(),
              "border-border-base text-text-weak": !selectMode(),
            }}
            data-design-select-mode={selectMode() ? "on" : "off"}
            aria-pressed={selectMode()}
            onClick={() => setSelectMode((value) => !value)}
            title="Arme le pont de sélection : survole pour surligner, clique pour cibler un élément"
          >
            {selectMode() ? "Sélection active…" : "Sélectionner un élément"}
          </button>
          <button
            type="button"
            class="rounded border border-border-base px-2 py-1 text-12-regular"
            data-design-stream-demo
            onClick={() => props.onDemo()}
            title="Injecte un flux synthétique (start → 3 chunks → end) pour vérifier le moteur"
          >
            Démo flux
          </button>
          <button
            type="button"
            class="rounded border border-border-base px-2 py-1 text-12-regular"
            data-design-stream-close
            onClick={() => props.onClose()}
          >
            Fermer
          </button>
        </div>
      </div>
      <DesignToolbar
        viewport={viewport()}
        zoom={zoom()}
        mode={mode()}
        hasSource={props.entry.content.length > 0}
        snapshot={snapshot()}
        onViewport={setViewport}
        onZoom={setZoom}
        onMode={setMode}
        onSnapshot={requestSnapshot}
      />
      <Show when={props.connectionError}>
        <p class="rounded border border-border-danger bg-background-stronger px-3 py-2 text-12-regular text-text-danger" data-design-stream-connection-error role="alert">
          Connexion perdue — l'aperçu reste figé sur le dernier état reçu. {props.connectionError}
        </p>
      </Show>
      <div class="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border-base" data-design-stream-mount>
        <ArtifactPreview
          artifactId={props.entry.artifactId}
          workspaceId=""
          source={props.entry.content}
          mode={mode()}
          viewport={viewport()}
          zoom={zoom()}
          selectMode={selectMode()}
          onSelectTarget={(elementId) => {
            props.onSelectTarget(elementId, props.entry.artifactId, props.entry.filename)
            // Un pick vaut confirmation : on désarme pour que le rendu
            // redevienne cliquable normalement.
            setSelectMode(false)
          }}
          onSnapshotReady={(request) => {
            capture = request
          }}
        />
      </div>
    </div>
  )
}
