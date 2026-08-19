/* SPDX-License-Identifier: MIT */

import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { createQuery } from "@tanstack/solid-query"
import { useLanguage } from "@/context/language"
import { useWorkspaceWorkbench } from "@/context/workbench/provider"
import { workbenchQueryKey } from "@/context/workbench/query-keys"
import { createWorkbenchSession } from "@/pages/workbench/workbench-session"
import { WorkbenchThread } from "@/pages/workbench/workbench-thread"
import { DesignSplit } from "@/pages/workbench/design-split"
import { DesignWorkspace, seedDesignTabState } from "@/pages/workbench/design-workspace"
import { ArtifactPreview } from "@/pages/workbench/artifact-preview"
import { DesignToolbar, DEFAULT_TOOLBAR_MODE, type DesignToolbarSnapshotState, type DesignToolbarMode } from "@/pages/workbench/design-toolbar"
import { DEFAULT_VIEWPORT, DEFAULT_ZOOM, VIEWPORT_IDS, type ViewportId } from "@unifia/artifact-render"
import {
  createArtifactStreamController,
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
import { openTab, type DesignTab } from "@/pages/workbench/design-tabs"

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

  // Phase 3 — `DesignSurface` holds the workshop's tab state. Before phase 3,
  // `DesignWorkspace` owned its own store and `createDesignWorkspaceController`
  // offered a sibling store that no caller ever imported (verified: zero
  // consumers). Two stores means two truths and no way to open an artifact
  // tab from a streaming event. The seed plants the two non-closable tabs
  // ("Fichiers" + "Spec") so the workshop is never empty when the surface
  // mounts.
  const [tabState, setTabState] = createStore(seedDesignTabState())

  // P4-4 — `designContextPreview` (P22) et son placeholder DESIGN.md sont
  // retirés. C'était une étiquette statique de P22 servant à valider
  // l'observabilité du câblage catalogue → preamble ; le câblage est
  // désormais porté par l'agent lui-même, et le fil rend le contenu réel.
  let draftTimer: ReturnType<typeof setTimeout> | undefined
  let draftLoadEpoch = 0

  // P15 — Moteur de streaming des artefacts produits par l'agent Design.
  // L'agent lui-même (capability "design-agent") émettra `artifact:start/chunk/end`
  // via le SDK quand il sera branché ; en attendant, le controller est prêt et
  // exposé au reste de la surface (panneau live + persistance automatique).
  const stream = createArtifactStreamController({ debounceMs: 100 })
  const [streamPersisted, setStreamPersisted] = createSignal<ReadonlySet<string>>(new Set())

  // Phase 4 — ouverture automatique d'un onglet artifact à chaque
  // `artifact:start`. Le Set local mémorise les ids déjà introduits : si
  // l'utilisateur ferme un onglet artifact puis qu'un nouveau chunk arrive
  // pour le même id, on ne le rouvre pas (l'utilisateur a exprimé un
  // choix de navigation explicite). Côté Phase 4, l'agent n'est pas
  // encore branché ; le câblage réel passe par `adaptRenderArtifactEvent`
  // quand l'adaptateur sera consommé par le controller.
  const seenArtifactIds = new Set<string>()
  // P3-5 — état du toolbar remonté au niveau de la surface. L'onglet
  // artifact rend `ArtifactPreview` ; le `DesignToolbar` qui le surplombe
  // est piloté ici pour que les sélections (viewport, zoom, mode, snapshot,
  // sélection) survivent à un changement d'onglet puis un retour, et pour
  // qu'une seule instance d'état existe par surface (et non par panneau
  // éphémère, comme avant P3-5).
  const [viewport, setViewport] = createSignal<ViewportId>(DEFAULT_VIEWPORT)
  const [zoom, setZoom] = createSignal<number>(DEFAULT_ZOOM)
  const [toolbarMode, setToolbarMode] = createSignal<DesignToolbarMode>(DEFAULT_TOOLBAR_MODE)
  const [snapshot, setSnapshot] = createSignal<DesignToolbarSnapshotState>({ kind: "idle" })
  const [selectMode, setSelectMode] = createSignal(false)
  // P3-5 / P17 — la fonction de capture vit dans l'iframe (postMessage
  // same-origin impossible depuis l'hôte). `ArtifactPreview` la remonte
  // via `onSnapshotReady` à chaque montage d'iframe ; on la garde ici
  // pour qu'un seul `requestSnapshot` (ci-dessous) puisse la déclencher
  // depuis le toolbar remonté. Une seule instance visible à la fois, donc
  // un seul `capture` survit à un changement d'onglet.
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

  // P19 + P20 — Panneau de commentaires. Le `CommentPanel` n'est plus
  // rendu dans le slot workspace depuis la phase 4. Les signaux qui
  // portaient sa mémoire sont retirés : sans `CommentPanel`, ils n'ont
  // pas de lecteur. `onSelectTarget` (P18 → P19) est conservé sur
  // `DesignArtifactTab` mais le câblage vers un futur panneau de
  // commentaires attendra la phase 4+ suivante.

  // P4-3 — chaque `artifact:start` du moteur de streaming ouvre (ou active)
  // un onglet `kind: "artifact"`. L'effet lit `stream.state()` (signal) et
  // itère sur les ids connus ; le Set local garantit qu'on n'ouvre pas
  // deux fois le même onglet et qu'on n'écrase pas la navigation explicite
  // de l'utilisateur (un onglet fermé n'est pas rouvert par un chunk
  // ultérieur). Le tracking fin de Solid gère la dépendance sur la
  // référence du `byId` (la Map est reconstruite à chaque event).
  createEffect(() => {
    const byId = stream.state().byId
    for (const [id, entry] of byId.entries()) {
      if (seenArtifactIds.has(id)) continue
      seenArtifactIds.add(id)
      setTabState(openTab(tabState, {
        id,
        kind: "artifact",
        title: entry.filename,
        closable: true,
      }))
    }
  })

  // P18 → P19 — callback de pick d'élément dans l'artefact. Le panneau
  // de commentaires qui le consomme a été retiré en phase 4 ; le
  // callback est conservé pour la phase 4+ qui le rebranchera. Pour
  // l'instant, le pick est un no-op (la cible n'est lue par personne).
  // Conserver le callback ici plutôt que dans `DesignArtifactTab`
  // évite de re-câbler le parent quand le panneau reviendra.
  function onArtifactSelectTarget(_elementId: string, _artifactId: string, _entryFile: string): void {
    // No-op until the comment panel re-lands.
  }
  /**
   * P4-5 — boucle commentaire → raffinement → fil.
   *
   * Le contrat est porté par `createWorkbenchSession` (P1-1) : une seule
   * session par workspace, partagée entre tous les consumers (fil,
   * raffinement, future CommentPanel). Quand le panneau de commentaires
   * reviendra, le câblage se résume à `await refineSession.prompt(text)` ;
   * la réponse de l'agent apparaîtra dans le fil parce que c'est la même
   * session. Le test de cette garantie vit dans
   * `workbench-session.test.ts` (couverture du ownership unique).
   *
   * Avant P20 + P4-5, ce code créait une seconde `WorkbenchSession` par
   * surface, ce qui doublait les conversations. La phase 1 a supprimé le
   * doublon ; la phase 4 acte que la boucle est garantie par le contrat.
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
  // Garder `refineSession` et `sendRefinePrompt` au chaud dans la closure
  // n'a pas de sens sans consumer : la phase 4 acte que le contrat est
  // tenu, le câblage réel reviendra avec la CommentPanel de la phase 4+
  // suivante. On annote l'intention en commentant, pas en gardant du
  // code mort qui fera crier Biome.
  void refineSession
  void sendRefinePrompt
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
  // P4-4 — `pushDemoStream` a été retiré : la démo manuelle n'a plus sa
  // place dans la surface. Le vrai câblage agent→artefact passe par
  // `adaptRenderArtifactEvent` (P4-2) branché sur le controller Solid via
  // l'effet P4-3 qui ouvre l'onglet. Tant que l'agent "design-agent" n'est
  // pas branché, la surface n'invente pas d'événements.
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
      // P6-2 — approbation ≠ erreur. Le chemin gouverné (qui exige une
      // approbation) retourne un `approvalId` et non un `exported` : du
      // point de vue de l'utilisateur qui a déclenché l'action, l'export
      // a été soumis avec succès ; le bandeau rouge était une fausse
      // alerte. On utilise `exported` (même état que le chemin nominal)
      // et on garde le message détaillé pour distinguer les deux cas
      // dans le bandeau de feedback.
      if ("approvalId" in result && result.approvalId) {
        setExportState("exported")
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

  // Phase 3 — `renderTabContent` resolves the body of the active tab. The
  // workshop's `kind` enum drives the routing: the spec editor lives behind
  // the "spec" tab (P3-4), the file listing will land in "file" (P-pending),
  // and the artifact preview keeps the "artifact" slot. Keeping the routing
  // in a single function makes the seam between tabs and the surface's own
  // signals (source, manifest, validation, …) obvious at a glance.
  function renderTabContent(tab: DesignTab): JSX.Element {
    if (tab.kind === "file") {
      return <DesignFilesTab />
    }
    if (tab.kind === "spec") {
      return <DesignSpecEditor
        source={source()}
        onInput={updateDraft}
        draftError={draftError()}
        specDiagnostics={spec().diagnostics}
        specEmpty={spec().diagnostics[0]?.message ?? t("workbench.design.specEmpty")}
        validationLoading={validation.isLoading}
        validationError={validation.error}
        validationValid={validation.data?.valid === true}
        validationDenied={validation.data?.capabilities.denied ?? []}
        previews={preview().previews}
        saveState={saveState()}
        saveMessage={saveMessage()}
        onSave={() => void saveDesignVersion()}
        exportState={exportState()}
        onExport={() => void exportDesignRender()}
        versionPanel={versionPanel()}
        latestDiff={latestDiff()}
        manifestError={manifest.error}
        manifestLoading={manifest.isLoading}
        catalogs={manifest.data?.designSystems ?? []}
      />
    }
    if (tab.kind === "artifact") {
      return <DesignArtifactTab
        entry={stream.state().byId.get(tab.id)}
        connectionError={stream.renderState().connectionError}
        viewport={viewport()}
        zoom={zoom()}
        toolbarMode={toolbarMode()}
        snapshot={snapshot()}
        selectMode={selectMode()}
        onViewport={setViewport}
        onZoom={setZoom}
        onToolbarMode={setToolbarMode}
        onSnapshot={requestSnapshot}
        onSelectMode={setSelectMode}
        onSelectTarget={onArtifactSelectTarget}
        onSnapshotReady={(request) => {
          capture = request
        }}
      />
    }
    return <div data-design-workspace-tab-empty={tab.id} />
  }

  return (
    <section class="size-full" data-workbench-surface="design">
      <DesignSplit
        chat={
          <WorkbenchThread
            mode="design"
            prompt={t("workbench.design.chatPrompt")}
            description={t("workbench.design.description")}
            connection={{ dataAttr: "design-connection", dataRetryAttr: "design-retry" }}
          />
        }
        workspace={
          <div class="flex h-full min-h-0 flex-col">
            <DesignWorkspace state={tabState} setState={setTabState} renderContent={renderTabContent} />
          </div>
        }
      />
    </section>
  )
}

/**
 * Phase 4 — Onglet artifact : remplace `StreamedArtifactPanel`.
 *
 * Avant la phase 4, ce panneau vivait à côté de `DesignWorkspace` et
 * possédait son propre état (viewport, zoom, mode, snapshot, sélection).
 * Le `DesignWorkspace` était alors *remplacé* par ce panneau quand un
 * stream était actif (P3-1 strict) — l'atelier disparaissait pendant un
 * flux, ce qui cassait la règle d'or d'Open Design : la conversation
 * produit un artefact qui s'ouvre dans l'atelier, sans le remplacer.
 *
 * Phase 4 inverse : l'atelier reste monté en permanence. Quand un
 * `artifact:start` arrive (P4-3), un onglet `kind: "artifact"` est ouvert
 * et `renderTabContent` route vers ce composant. L'état du toolbar (P3-5)
 * est promu dans `DesignSurface` pour survivre à un changement d'onglet
 * puis un retour, et pour qu'une seule instance existe par surface.
 *
 * Le panneau d'en-tête (statut streaming / complete / error) reste ici :
 * c'est l'info de cycle de vie de l'artefact, pas une décoration
 * d'interface générale.
 */
function DesignArtifactTab(props: {
  /** L'entry du moteur de streaming. `undefined` si l'artefact n'a jamais reçu d'event. */
  entry: StreamedArtifact | undefined
  /** Erreur de connexion globale (SSE coupé). */
  connectionError: string | undefined
  /** P3-5 — état du toolbar remonté. */
  viewport: ViewportId
  zoom: number
  toolbarMode: DesignToolbarMode
  snapshot: DesignToolbarSnapshotState
  selectMode: boolean
  onViewport: (id: ViewportId) => void
  onZoom: (zoom: number) => void
  onToolbarMode: (mode: DesignToolbarMode) => void
  onSnapshot: () => void
  onSelectMode: (value: boolean) => void
  /** P18 → P19 — remontée d'un pick vers le panneau de commentaires. */
  onSelectTarget: (elementId: string, artifactId: string, entryFile: string) => void
  /** P3-5 / P17 — l'iframe remonte sa fonction de capture au parent. */
  onSnapshotReady: (request: () => Promise<{ dataUrl: string; w: number; h: number }>) => void
}): JSX.Element {
  return (
    <div
      class="flex h-full min-h-0 flex-col gap-3"
      data-design-artifact-tab={props.entry?.artifactId ?? "missing"}
      data-design-artifact-complete={props.entry?.complete ? "true" : "false"}
      data-design-artifact-error={props.entry?.error ? "true" : "false"}
    >
      <Show when={props.entry}>
        {(entry) => (
          <div
            class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-base bg-background-stronger px-3 py-2"
            data-design-artifact-header
          >
            <div class="flex items-center gap-2">
              <span class="text-12-medium">{entry().filename}</span>
              <span class="text-12-regular text-text-weak">·</span>
              <span class="text-12-regular text-text-weak">{entry().kind}</span>
              <Show when={!entry().complete}>
                <span class="text-12-regular text-text-weak" data-design-artifact-status="streaming">streaming…</span>
              </Show>
              <Show when={entry().complete}>
                <span class="text-12-regular text-text-weak" data-design-artifact-status="complete">complet · {entry().content.length} caractères</span>
              </Show>
              <Show when={entry().error}>
                <span class="text-12-regular text-text-danger" data-design-artifact-error-msg>{entry().error}</span>
              </Show>
            </div>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="rounded border px-2 py-1 text-12-regular"
                classList={{
                  "border-border-focus text-text-base": props.selectMode,
                  "border-border-base text-text-weak": !props.selectMode,
                }}
                data-design-select-mode={props.selectMode ? "on" : "off"}
                aria-pressed={props.selectMode}
                onClick={() => props.onSelectMode(!props.selectMode)}
                title="Arme le pont de sélection : survole pour surligner, clique pour cibler un élément"
              >
                {props.selectMode ? "Sélection active…" : "Sélectionner un élément"}
              </button>
            </div>
          </div>
        )}
      </Show>
      <DesignToolbar
        viewport={props.viewport}
        zoom={props.zoom}
        mode={props.toolbarMode}
        hasSource={(props.entry?.content.length ?? 0) > 0}
        snapshot={props.snapshot}
        onViewport={props.onViewport}
        onZoom={props.onZoom}
        onMode={props.onToolbarMode}
        onSnapshot={props.onSnapshot}
      />
      <Show when={props.connectionError}>
        <p class="rounded border border-border-danger bg-background-stronger px-3 py-2 text-12-regular text-text-danger" data-design-artifact-connection-error role="alert">
          Connexion perdue — l'aperçu reste figé sur le dernier état reçu. {props.connectionError}
        </p>
      </Show>
      <div class="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border-base" data-design-artifact-mount>
        <ArtifactPreview
          artifactId={props.entry?.artifactId ?? ""}
          workspaceId=""
          source={props.entry?.content}
          mode={props.toolbarMode}
          viewport={props.viewport}
          zoom={props.zoom}
          selectMode={props.selectMode}
          onSelectTarget={(elementId) => {
            if (!props.entry) return
            props.onSelectTarget(elementId, props.entry.artifactId, props.entry.filename)
            // Un pick vaut confirmation : on désarme pour que le rendu
            // redevienne cliquable normalement.
            props.onSelectMode(false)
          }}
          onSnapshotReady={props.onSnapshotReady}
        />
      </div>
    </div>
  )
}

/**
 * Phase 3 — Onglet "Fichiers".
 *
 * Le contenu de cet onglet est volontairement vide pour l'instant. Le but
 * de P3-3 est de prouver qu'un onglet non-fermable, semé à l'ouverture,
 * reste en place quand l'utilisateur ferme l'onglet actif. La liste de
 * fichiers (avec recherche, sélection, ouverture d'un fichier comme
 * artefact) viendra quand le runtime exposera la query
 * `listFiles(connection.workspaceId, ".")` déjà consommée par Automate
 * (`automate-surface.tsx:19`) — la parité est de ne pas dupliquer la
 * requête ici sans raison.
 */
function DesignFilesTab(): JSX.Element {
  const language = useLanguage()
  const t = language.t
  return (
    <div class="flex h-full min-h-0 flex-col items-center justify-center gap-2 p-6 text-center" data-design-files-tab>
      <p class="text-14-medium text-text-weak">{t("design.workspace.empty")}</p>
      <p class="text-12-regular text-text-weak">{t("design.workspace.emptyHint")}</p>
    </div>
  )
}

type DesignCatalogSummary = {
  id: string
  name: string
  version: string
  source: string
}

/**
 * Phase 3 — Onglet "Spec" : l'éditeur de spec historique migré tel quel
 * (catalog, design context, textarea, diagnostics, validation, viewports,
 * versioning, history). On n'a rien réécrit : le contenu existait, on
 * l'a juste déplacé d'un slot inline vers un sous-composant adressable
 * par le workshop via `kind: "spec"`. La migration donne une cible de
 * tests (le sous-composant est importable, le slot inline ne l'était pas).
 */
function DesignSpecEditor(props: {
  source: string
  onInput: (value: string) => void
  draftError: string | undefined
  specDiagnostics: readonly { line: number; column: number; message: string }[]
  specEmpty: string
  validationLoading: boolean
  validationError: unknown
  validationValid: boolean
  validationDenied: readonly string[]
  previews: readonly unknown[]
  saveState: "idle" | "saving" | "saved" | "error"
  saveMessage: string
  onSave: () => void
  exportState: "idle" | "exporting" | "exported" | "error"
  onExport: () => void
  versionPanel: {
    history: readonly unknown[]
    provenance?: Record<string, string>
  }
  latestDiff: { changed: readonly string[]; added: readonly string[]; removed: readonly string[] }
  manifestError: unknown
  manifestLoading: boolean
  catalogs: readonly DesignCatalogSummary[]
}): JSX.Element {
  const language = useLanguage()
  const t = language.t
  return (
    <div class="flex h-full min-h-0 flex-col gap-6 overflow-auto p-6" data-design-spec-editor>
      <Show when={props.manifestError}>
        <p data-design-manifest="failed" class="text-14-regular text-text-danger">{props.manifestError instanceof Error ? props.manifestError.message : String(props.manifestError)}</p>
      </Show>
      <Show when={props.catalogs.length > 0}>
        <div class="grid gap-3 md:grid-cols-2" data-design-catalog-count={props.catalogs.length}>
          <For each={props.catalogs}>
            {(catalog) => (
              <article class="rounded-lg border border-border-base bg-background-stronger p-4" data-design-catalog={catalog.id}>
                <h2 class="text-14-medium">{catalog.name} · {catalog.version}</h2>
                <p class="mt-2 text-12-regular text-text-weak">{t("workbench.design.source", { source: catalog.source })}</p>
              </article>
            )}
          </For>
        </div>
      </Show>
      <Show when={!props.manifestLoading && !props.manifestError && props.catalogs.length === 0}>
        <p data-design-manifest="empty" class="text-14-regular text-text-danger">{t("workbench.design.noManifest")}</p>
      </Show>
      {/*
        P4-4 — la ligne « design context: N chars · catalog: none » est
        retirée. C'était une étiquette statique de P22 servant à valider
        l'observabilité du câblage catalogue → preamble ; le câblage est
        désormais prouvé par l'agent lui-même (l'agent choisit le catalogue
        quand il parle, et le fil en rend le contenu). Le data-attribute
        `data-design-context-length` n'a plus de support dans le JSX.
      */}
      <label class="block space-y-2" for="workbench-design-spec">
        <span class="text-14-medium">{t("workbench.design.specLabel")}</span>
        <textarea
          id="workbench-design-spec"
          class="min-h-48 w-full rounded-lg border border-border-base bg-background-stronger p-4 font-mono text-12-regular text-text-base"
          placeholder={t("workbench.design.specPlaceholder")}
          value={props.source}
          onInput={(event) => props.onInput(event.currentTarget.value)}
          spellcheck={false}
        />
      </label>
      <Show when={props.draftError}><p data-design-draft="error" class="text-12-regular text-text-danger">{props.draftError}</p></Show>
      <Show when={props.specDiagnostics.length > 0}>
        <aside class="rounded-lg border border-border-danger bg-background-stronger p-4" data-workbench-diagnostics>
          <h2 class="text-14-medium text-text-danger">{t("workbench.design.diagnostics")}</h2>
          <For each={props.specDiagnostics}>
            {(diagnostic) => <p class="mt-2 text-12-regular text-text-weak">{t("workbench.design.diagnosticLine", { line: diagnostic.line, column: diagnostic.column, message: diagnostic.message })}</p>}
          </For>
        </aside>
      </Show>
      <Show when={props.validationLoading}>
        <p data-design-validation="loading" class="text-12-regular text-text-weak">{t("workbench.design.validating")}</p>
      </Show>
      <Show when={props.validationError}>
        <p data-design-validation="failed" class="text-14-regular text-text-danger">{props.validationError instanceof Error ? props.validationError.message : String(props.validationError)}</p>
      </Show>
      <Show when={props.validationDenied.length > 0}>
        <p data-design-validation="denied" class="text-14-regular text-text-danger">{t("workbench.design.capabilitiesDenied", { list: props.validationDenied.join(", ") })}</p>
      </Show>
      <Show when={props.validationValid && props.validationDenied.length === 0 && props.previews.length > 0} fallback={<p class="text-14-regular text-text-danger">{props.specEmpty}</p>}>
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
        <button type="button" data-design-save-version class="rounded border border-border-base px-3 py-2 text-12-medium disabled:opacity-50" disabled={!props.source || props.saveState === "saving"} onClick={props.onSave}>
          {props.saveState === "saving" ? "Enregistrement…" : "Enregistrer une version"}
        </button>
        <button type="button" data-design-export-render class="rounded border border-border-base px-3 py-2 text-12-medium disabled:opacity-50" disabled={!props.source || props.exportState === "exporting"} onClick={props.onExport}>
          {props.exportState === "exporting" ? "Export…" : "Exporter le rendu SVG"}
        </button>
        <Show when={props.saveMessage}><span data-design-save-result={props.saveState} class="text-12-regular text-text-weak">{props.saveMessage}</span></Show>
      </div>
      <Show when={props.versionPanel.history.length > 0}>
        <section class="rounded-lg border border-border-base bg-background-stronger p-4" data-design-history>
          <h2 class="text-14-medium">Historique Design</h2>
          <p class="mt-2 text-12-regular text-text-weak">{props.versionPanel.history.length} version(s) · provenance : {props.versionPanel.provenance?.sourceTool ?? "inconnue"}</p>
          <p data-design-diff class="mt-2 text-12-regular text-text-weak">Diff dernière version : {props.latestDiff.changed.join(", ") || "aucun changement structurel"}</p>
        </section>
      </Show>
    </div>
  )
}
